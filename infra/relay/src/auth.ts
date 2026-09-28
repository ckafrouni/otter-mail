/**
 * Otter account sign-in, with better-auth (served under /v1/auth).
 *
 * The desktop app signs in to Google itself and hands the relay the ID token
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

const hub = (env: Env, userId: string) => env.USER_HUB.get(env.USER_HUB.idFromName(userId));

export function createAuth(env: Env, db: Db) {
  return betterAuth({
    appName: "Otter Mail",
    baseURL: env.BETTER_AUTH_URL,
    basePath: "/v1/auth",
    secret: env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(db, { provider: "sqlite", schema }),
    socialProviders: {
      google: {
        clientId: env.GOOGLE_CLIENT_ID,
        // Only the ID-token flow is used, which needs no secret.
        clientSecret: "",
        verifyIdToken: async (token) => {
          try {
            await verifyGoogleJwt(token, env.GOOGLE_CLIENT_ID, googleKeys(env));
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
    telemetry: { enabled: false },
  });
}

export type Auth = ReturnType<typeof createAuth>;
