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

/**
 * Returns a valid access token for the given accountId (email), auto-refreshing if expired.
 */
export async function getAccessToken(accountId: string): Promise<string> {
  const { clientId, clientSecret } = await getCredentials();
  const providerId = `google:${accountId}`;
  const service = makeService(providerId, clientId, clientSecret);
  return service.getAccessToken();
}

/**
 * Removes stored OAuth tokens for an account.
 */
export async function removeAccountTokens(accountId: string): Promise<void> {
  const { clientId, clientSecret } = await getCredentials();
  const providerId = `google:${accountId}`;
  const service = makeService(providerId, clientId, clientSecret);
  await service.removeTokens();
}
