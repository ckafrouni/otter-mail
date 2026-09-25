/**
 * gmail-oauth.ts
 *
 * Google OAuth per account using @glaze/core/oauth OAuthService.
 * - providerId format: "google:<email>" (or "google:pending" for the initial flow)
 * - Requires clientId + clientSecret from credentials-store
 * - Tokens are stored/refreshed automatically via OAuthService (safeStorage)
 */

import { OAuthService } from "@glaze/core/oauth";
import type { OAuthServiceOptions } from "@glaze/core/oauth";
import { getCredentials } from "./credentials-store.js";
import { addAccount as storeAddAccount } from "./account-store.js";
import type { GmailAccount } from "../gmail/types.js";

const AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo";

const SCOPES = [
  "https://mail.google.com/",
  "openid",
  "email",
  "profile",
  // People API, for sender avatars. Tokens issued before these scopes were
  // added simply 403 on People calls (the avatar cascade skips to Gravatar);
  // re-adding the account upgrades its consent in place.
  "https://www.googleapis.com/auth/contacts.readonly",
  "https://www.googleapis.com/auth/contacts.other.readonly",
  // Calendar, for answering invitations in place. Older tokens lack it: RSVP
  // then falls back to an email reply; re-adding the account upgrades it.
  "https://www.googleapis.com/auth/calendar.events",
];

function buildServiceOptions(
  providerId: string,
  clientId: string,
  clientSecret: string,
): OAuthServiceOptions {
  return {
    providerId,
    clientId,
    clientSecret,
    authorizeUrl: AUTHORIZE_URL,
    tokenUrl: TOKEN_URL,
    scopes: SCOPES,
    extraAuthorizationParameters: {
      access_type: "offline",
      prompt: "consent",
    },
  };
}

function makeService(providerId: string, clientId: string, clientSecret: string): OAuthService {
  return new OAuthService(buildServiceOptions(providerId, clientId, clientSecret));
}

/**
 * Initiates the OAuth flow for a new account.
 * - Uses a transient "google:pending" service for the initial auth
 * - Fetches userinfo to get email/name/picture
 * - Creates the real "google:<email>" service and transfers tokens
 * - Saves metadata to account-store
 */
export async function addAccount(): Promise<GmailAccount> {
  const { clientId, clientSecret } = await getCredentials();

  // Use pending service for the initial flow
  const pendingService = makeService("google:pending", clientId, clientSecret);

  let tokens;
  try {
    tokens = await pendingService.authorize();
  } catch (err) {
    throw new Error(`Google OAuth authorization failed: ${String(err)}`);
  }

  // Fetch userinfo using the access token
  const userInfoResponse = await fetch(USERINFO_URL, {
    headers: { Authorization: `Bearer ${tokens.accessToken}` },
  });

  if (!userInfoResponse.ok) {
    await pendingService.removeTokens();
    throw new Error(
      `Failed to fetch Google user info: ${userInfoResponse.status} ${userInfoResponse.statusText}`,
    );
  }

  const userInfo = (await userInfoResponse.json()) as {
    email?: string;
    name?: string;
    picture?: string;
  };

  if (!userInfo.email) {
    await pendingService.removeTokens();
    throw new Error("Google user info did not return an email address.");
  }

  const email = userInfo.email;
  const realProviderId = `google:${email}`;

  // Transfer tokens to the real account service
  const realService = makeService(realProviderId, clientId, clientSecret);
  await realService.setTokens(tokens);
  // Re-adding an account (e.g. to grant new scopes) replaces its tokens.
  tokenCache.delete(email);

  // Clean up the pending service tokens
  await pendingService.removeTokens();

  const account: GmailAccount = {
    id: email,
    email,
    name: userInfo.name ?? email,
    picture: userInfo.picture,
  };

  // Persist non-sensitive metadata
  await storeAddAccount(account);

  return account;
}

// ── Access-token cache ───────────────────────────────────────────────────────
// OAuthService keeps tokens encrypted on disk: every getAccessToken() re-reads
// oauth-tokens.json and decrypts through a native safeStorage call. Doing that
// for every Gmail request (a big sync makes thousands) added a native round
// trip to each call and, under load, timed out ("Native call timeout:
// safeStorage.decryptString") and failed whole sync runs. Tokens are valid for
// an hour, so keep them in memory and only touch secure storage to load or
// refresh one.

/** Refresh a little before Google expires the token, never mid-request. */
const REFRESH_AHEAD_MS = 2 * 60_000;
/** Re-check stored tokens this often when the provider gave no lifetime. */
const UNKNOWN_LIFETIME_MS = 10 * 60_000;

type CachedToken = { accessToken: string; expiresAt: number };

const tokenCache = new Map<string, CachedToken>();
const tokenLoads = new Map<string, Promise<string>>();
const services = new Map<string, OAuthService>();

async function serviceFor(accountId: string): Promise<OAuthService> {
  const existing = services.get(accountId);
  if (existing) return existing;
  const { clientId, clientSecret } = await getCredentials();
  const service = makeService(`google:${accountId}`, clientId, clientSecret);
  services.set(accountId, service);
  return service;
}

function expiryOf(tokens: { updatedAt: Date; expiresIn?: number }): number {
  return tokens.expiresIn == null
    ? Date.now() + UNKNOWN_LIFETIME_MS
    : tokens.updatedAt.getTime() + tokens.expiresIn * 1000;
}

/** Marks the stored token expired so OAuthService refreshes it on next use. */
async function expireStoredToken(service: OAuthService): Promise<boolean> {
  const tokens = await service.getTokens();
  if (!tokens?.refreshToken) return false;
  await service.setTokens({ ...tokens, expiresIn: 0 });
  return true;
}

async function loadAccessToken(accountId: string, forceRefresh: boolean): Promise<string> {
  const service = await serviceFor(accountId);
  if (forceRefresh) await expireStoredToken(service);
  let accessToken = await service.getAccessToken();
  let tokens = await service.getTokens();
  // OAuthService only refreshes in the last 10s; refresh ahead of that so a
  // cached token never expires while requests are still using it.
  if (
    tokens?.accessToken === accessToken &&
    expiryOf(tokens) - Date.now() < REFRESH_AHEAD_MS &&
    (await expireStoredToken(service))
  ) {
    accessToken = await service.getAccessToken();
    tokens = await service.getTokens();
  }
  const expiresAt =
    tokens?.accessToken === accessToken ? expiryOf(tokens) : Date.now() + UNKNOWN_LIFETIME_MS;
  tokenCache.set(accountId, { accessToken, expiresAt });
  return accessToken;
}

/**
 * Returns a valid access token for the given accountId (email), auto-refreshing
 * if expired. Served from memory; concurrent callers share one load/refresh.
 * `forceRefresh` discards the current token (Gmail answered 401 with it).
 */
export async function getAccessToken(
  accountId: string,
  opts?: { forceRefresh?: boolean },
): Promise<string> {
  const cached = tokenCache.get(accountId);
  if (!opts?.forceRefresh && cached && cached.expiresAt - REFRESH_AHEAD_MS > Date.now()) {
    return cached.accessToken;
  }
  const pending = tokenLoads.get(accountId);
  // A 401 on a token that a running load is about to replace: join that load.
  if (pending && !(opts?.forceRefresh && cached)) return pending;
  if (opts?.forceRefresh) tokenCache.delete(accountId);
  const load = loadAccessToken(accountId, opts?.forceRefresh === true).finally(() => {
    if (tokenLoads.get(accountId) === load) tokenLoads.delete(accountId);
  });
  tokenLoads.set(accountId, load);
  return load;
}

/**
 * Removes stored OAuth tokens for an account.
 */
export async function removeAccountTokens(accountId: string): Promise<void> {
  const service = await serviceFor(accountId);
  tokenCache.delete(accountId);
  services.delete(accountId);
  await service.removeTokens();
}
