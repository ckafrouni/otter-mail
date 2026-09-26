/**
 * Google sign-in, per account: the installed-app flow (RFC 8252) with PKCE,
 * through an ASWebAuthenticationSession. Google's "iOS" OAuth clients have no
 * secret and redirect to the client id's reversed form (registered as a URL
 * scheme in app.config.ts).
 *
 * Refresh tokens live in the Keychain (expo-secure-store); access tokens are
 * served from memory and refreshed a little before they expire.
 */

import * as AuthSession from "expo-auth-session";
import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";

import { base64Encode, utf8Encode } from "../lib/encoding";

const discovery: AuthSession.DiscoveryDocument = {
  authorizationEndpoint: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenEndpoint: "https://oauth2.googleapis.com/token",
  revocationEndpoint: "https://oauth2.googleapis.com/revoke",
};
const USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo";
const SCOPES = ["https://mail.google.com/", "openid", "email", "profile"];
/** Refresh this long before Google's expiry, so a request never races it. */
const EXPIRY_MARGIN_MS = 60_000;

export class SignInCancelledError extends Error {
  constructor() {
    super("Sign-in was cancelled.");
  }
}

export const SIGNED_OUT_MESSAGE = "Signed out of Google. Sign in to this account again.";

function clientId(): string {
  const id: unknown = Constants.expoConfig?.extra?.googleIosClientId;
  if (typeof id !== "string" || !id) {
    throw new Error(
      "This build has no Google OAuth client. Set OTTER_MAIL_GOOGLE_IOS_CLIENT_ID (see .env.example) and rebuild.",
    );
  }
  return id;
}

const redirectUri = () => `${clientId().split(".").toReversed().join(".")}:/oauth2redirect`;

/** SecureStore keys allow only [A-Za-z0-9._-]; an email has more. */
const storeKey = (accountId: string) =>
  `google-refresh-token.${base64Encode(utf8Encode(accountId)).replace(/[^A-Za-z0-9]/g, "_")}`;

const accessTokens = new Map<string, { token: string; expiresAt: number }>();
const refreshing = new Map<string, Promise<string>>();

export type GoogleProfile = { email: string; name: string; picture?: string };

/** Opens Google's sign-in sheet and stores the new account's refresh token. */
export async function signIn(loginHint?: string): Promise<GoogleProfile> {
  const request = new AuthSession.AuthRequest({
    clientId: clientId(),
    redirectUri: redirectUri(),
    scopes: SCOPES,
    usePKCE: true,
    extraParams: {
      access_type: "offline",
      prompt: "select_account",
      ...(loginHint ? { login_hint: loginHint } : {}),
    },
  });
  const result = await request.promptAsync(discovery);
  if (result.type === "cancel" || result.type === "dismiss") throw new SignInCancelledError();
  if (result.type !== "success") {
    const reason = result.type === "error" ? result.error?.message : null;
    throw new Error(reason ?? "Google sign-in didn't finish.");
  }

  const tokens = await AuthSession.exchangeCodeAsync(
    {
      clientId: clientId(),
      code: result.params.code!,
      redirectUri: redirectUri(),
      extraParams: { code_verifier: request.codeVerifier! },
    },
    discovery,
  );
  if (!tokens.refreshToken) throw new Error("Google did not return a refresh token. Try again.");

  const response = await fetch(USERINFO_URL, {
    headers: { Authorization: `Bearer ${tokens.accessToken}` },
  });
  if (!response.ok) throw new Error(`Couldn't read the Google profile (${response.status}).`);
  const profile = (await response.json()) as GoogleProfile;

  await SecureStore.setItemAsync(storeKey(profile.email), tokens.refreshToken);
  accessTokens.set(profile.email, {
    token: tokens.accessToken,
    expiresAt: Date.now() + (tokens.expiresIn ?? 3600) * 1000 - EXPIRY_MARGIN_MS,
  });
  return profile;
}

async function refresh(accountId: string): Promise<string> {
  const refreshToken = await SecureStore.getItemAsync(storeKey(accountId));
  if (!refreshToken) throw new Error(SIGNED_OUT_MESSAGE);
  try {
    const tokens = await AuthSession.refreshAsync(
      { clientId: clientId(), refreshToken },
      discovery,
    );
    accessTokens.set(accountId, {
      token: tokens.accessToken,
      expiresAt: Date.now() + (tokens.expiresIn ?? 3600) * 1000 - EXPIRY_MARGIN_MS,
    });
    return tokens.accessToken;
  } catch (err) {
    // Google revoked or expired the refresh token: only a new sign-in helps.
    if (err instanceof AuthSession.TokenError && err.code === "invalid_grant") {
      throw new Error(SIGNED_OUT_MESSAGE, { cause: err });
    }
    throw err;
  }
}

/**
 * A valid access token for the account, refreshing it when needed. Concurrent
 * callers share one refresh. `forceRefresh` drops the cached token (Gmail
 * answered 401).
 */
export function getAccessToken(accountId: string, forceRefresh = false): Promise<string> {
  const cached = accessTokens.get(accountId);
  if (!forceRefresh && cached && cached.expiresAt > Date.now()) {
    return Promise.resolve(cached.token);
  }
  let pending = refreshing.get(accountId);
  if (!pending) {
    pending = refresh(accountId).finally(() => refreshing.delete(accountId));
    refreshing.set(accountId, pending);
  }
  return pending;
}

/** Forgets the account's tokens and revokes them with Google (best effort). */
export async function signOut(accountId: string): Promise<void> {
  const refreshToken = await SecureStore.getItemAsync(storeKey(accountId));
  accessTokens.delete(accountId);
  await SecureStore.deleteItemAsync(storeKey(accountId));
  if (refreshToken) {
    await AuthSession.revokeAsync({ clientId: clientId(), token: refreshToken }, discovery).catch(
      () => undefined,
    );
  }
}
