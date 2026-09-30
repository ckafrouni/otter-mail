/**
 * Otter account sign-in, with better-auth (served under /v1/auth).
 *
 * The desktop and iPhone apps sign in to Google themselves and hand the relay the ID token
 * (`POST /v1/auth/sign-in/social`, `{ provider: "google", idToken }`); the
 * bearer plugin answers with a session token the app keeps. One session per
 * device, so Settings can list and sign out devices.
 */

import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { bearer } from "better-auth/plugins";

import { GOOGLE_JWKS_URL, remoteKeys, verifyGoogleJwt } from "./google-jwt.ts";
import * as schema from "./schema.ts";
import type { Db } from "./store.ts";
import type { Env } from "./worker.ts";

const DAY_S = 24 * 60 * 60;

export const googleKeys = (env: Env) => remoteKeys(env.GOOGLE_JWKS_URL || GOOGLE_JWKS_URL);

/** The audiences of ID tokens from Otter Mail's own Google sign-ins (desktop, web and iPhone). */
export const googleClientIds = (env: Env) =>
  [
    env.GOOGLE_WEB_CLIENT_ID,
    env.GOOGLE_CLIENT_ID,
    ...(env.GOOGLE_IOS_CLIENT_ID ?? "").split(","),
  ].filter((id): id is string => Boolean(id));

const hub = (env: Env, userId: string) => env.USER_HUB.get(env.USER_HUB.idFromName(userId));

export function createAuth(env: Env, db: Db) {
  return betterAuth({
    appName: "Otter Mail",
    baseURL: env.BETTER_AUTH_URL,
    basePath: "/v1/auth",
    secret: env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(db, { provider: "sqlite", schema }),
    // The web app signs in with Google by redirect, and comes back to its origin.
    trustedOrigins: [env.APP_ORIGIN],
    socialProviders: {
      google: {
        // The web client does the redirect sign-in; ID tokens may come from either app.
        clientId: googleClientIds(env),
        clientSecret: env.GOOGLE_WEB_CLIENT_SECRET ?? "",
        verifyIdToken: async (token) => {
          try {
            await verifyGoogleJwt(token, googleClientIds(env), googleKeys(env));
            return true;
          } catch {
            return false;
          }
        },
      },
    },
    session: {
      // A desktop app stays signed in: sessions last 90 days and renew with use.
      expiresIn: 90 * DAY_S,
      updateAge: DAY_S,
      // Deleting the account needs no recent sign-in; the app asks for confirmation.
      freshAge: 0,
    },
    user: { deleteUser: { enabled: true } },
    plugins: [bearer()],
    databaseHooks: {
      session: {
        delete: {
          // Signed out or revoked: close that device's event stream.
          after: async (session) => {
            await hub(env, session.userId).disconnect(session.id);
          },
        },
      },
      user: {
        delete: {
          after: async (user) => {
            await hub(env, user.id).disconnect();
          },
        },
      },
    },
    advanced: env.COOKIE_DOMAIN
      ? // The web app at mail.otterware.app sees the session cookie (and knows you're signed in).
        { crossSubDomainCookies: { enabled: true, domain: env.COOKIE_DOMAIN } }
      : {},
    telemetry: { enabled: false },
  });
}

export type Auth = ReturnType<typeof createAuth>;
