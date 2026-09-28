/**
 * The Otter Mail relay: Otter accounts (better-auth, auth.ts), the Gmail
 * accounts linked to them, and realtime mail notifications. Gmail publishes mailbox changes to a
 * Pub/Sub topic, Pub/Sub pushes them here, and the relay forwards them to the
 * signed-in devices over WebSocket. The API is described in
 * packages/contracts/src/relay.ts.
 */

import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { bearerAuth } from "hono/bearer-auth";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type {
  ListAccountsResponse,
  MeResponse,
  RelayEvent,
  RelayUser,
} from "@otter-mail/contracts/relay";

import { createAuth, googleKeys, type Auth } from "./auth.ts";
import { InvalidTokenError, verifyGoogleJwt } from "./google-jwt.ts";
import * as store from "./store.ts";
import { SESSION_HEADER, type UserHub } from "./user-hub.ts";

export { UserHub } from "./user-hub.ts";

export interface Env {
  DB: D1Database;
  USER_HUB: DurableObjectNamespace<UserHub>;
  /** The desktop app's Google OAuth client: the audience of its ID tokens. */
  GOOGLE_CLIENT_ID: string;
  /** Pub/Sub topic Gmail publishes to (`projects/…/topics/…`). */
  PUSH_TOPIC: string;
  /** Audience of the OIDC token on Pub/Sub push requests (the push route's URL). */
  PUSH_AUDIENCE: string;
  /** Service account Pub/Sub signs push requests as. */
  PUSH_SERVICE_ACCOUNT: string;
  /** This Worker's public URL, for better-auth. */
  BETTER_AUTH_URL: string;
  /** Signs better-auth's tokens (a Worker secret). */
  BETTER_AUTH_SECRET: string;
  /** Where Google's signing keys are published; only tests change it. */
  GOOGLE_JWKS_URL?: string;
}

type Session = { id: string; user: RelayUser };

type App = { Bindings: Env; Variables: { db: store.Db; auth: Auth; session: Session } };

/** Verifies a Google ID token issued to the desktop app. */
async function verifyIdToken(env: Env, idToken: string) {
  try {
    return await verifyGoogleJwt(idToken, env.GOOGLE_CLIENT_ID, googleKeys(env));
  } catch (err) {
    if (err instanceof InvalidTokenError) {
      throw new HTTPException(401, { message: `Invalid ID token (${err.message}).` });
    }
    throw err;
  }
}

const hub = (env: Env, userId: string) => env.USER_HUB.get(env.USER_HUB.idFromName(userId));

/** Malformed input answers 400 in the relay's `{ error }` shape. */
const rejectInvalid = (result: { success: boolean }) => {
  if (!result.success) throw new HTTPException(400, { message: "Invalid request." });
};

const profileField = z.string().max(2048).nullable().optional();
const mailbox = z
  .string()
  .transform((value) => value.trim().toLowerCase())
  .pipe(z.email());

const app = new Hono<App>();

app.use(async (c, next) => {
  const db = store.openDb(c.env.DB);
  c.set("db", db);
  c.set("auth", createAuth(c.env, db));
  await next();
});

app.onError((err, c) => {
  if (err instanceof HTTPException) return c.json({ error: err.message }, err.status);
  console.error("Unhandled error", err);
  return c.json({ error: "Something went wrong." }, 500);
});

app.notFound((c) => c.json({ error: "Not found." }, 404));

app.get("/", (c) => c.text("Otter Mail relay\n"));

/** Sign-in, sign-out, devices and account deletion. */
app.on(["GET", "POST"], "/v1/auth/*", (c) => c.var.auth.handler(c.req.raw));

// ── Signed-in routes ────────────────────────────────────────────────────────

const authed = new Hono<App>();

authed.use(async (c, next) => {
  const found = await c.var.auth.api.getSession({ headers: c.req.raw.headers });
  if (!found) throw new HTTPException(401, { message: "Not signed in." });
  const { session, user } = found;
  c.set("session", {
    id: session.id,
    user: { id: user.id, email: user.email, name: user.name || null, picture: user.image ?? null },
  });
  await next();
});

authed.get("/me", (c) =>
  c.json({ user: c.var.session.user, pushTopic: c.env.PUSH_TOPIC } satisfies MeResponse),
);

authed.get("/accounts", async (c) => {
  const accounts = await store.listAccounts(c.var.db, c.var.session.user.id);
  return c.json({ accounts } satisfies ListAccountsResponse);
});

/**
 * Link a Gmail account, or update its profile. Linking needs an ID token
 * for that address (the caller signed in to it); later edits don't.
 */
authed.put(
  "/accounts/:email",
  zValidator("param", z.object({ email: mailbox }), rejectInvalid),
  zValidator(
    "json",
    z.object({
      idToken: z.string().optional(),
      name: profileField,
      picture: profileField,
      displayName: profileField,
      color: profileField,
    }),
    rejectInvalid,
  ),
  async (c) => {
    const { email } = c.req.valid("param");
    const { idToken, ...patch } = c.req.valid("json");
    const { db, session } = c.var;
    if (!(await store.isLinked(db, session.user.id, email))) {
      if (!idToken) throw new HTTPException(403, { message: "Linking needs an ID token." });
      if ((await verifyIdToken(c.env, idToken)).email !== email) {
        throw new HTTPException(403, { message: "The ID token is for another address." });
      }
    }
    await store.putAccount(db, session.user.id, email, patch);
    await hub(c.env, session.user.id).publish({ type: "accounts" });
    return c.body(null, 204);
  },
);

authed.delete(
  "/accounts/:email",
  zValidator("param", z.object({ email: mailbox }), rejectInvalid),
  async (c) => {
    const userId = c.var.session.user.id;
    if (await store.deleteAccount(c.var.db, userId, c.req.valid("param").email)) {
      await hub(c.env, userId).publish({ type: "accounts" });
    }
    return c.body(null, 204);
  },
);

/** The device's event stream, handed to the user's Durable Object. */
authed.get("/events", async (c) => {
  if (c.req.header("upgrade")?.toLowerCase() !== "websocket") {
    throw new HTTPException(426, { message: "Expected a WebSocket upgrade." });
  }
  const { id, user } = c.var.session;
  const headers = new Headers(c.req.raw.headers);
  headers.set(SESSION_HEADER, id);
  return hub(c.env, user.id).fetch(new Request(c.req.raw, { headers }));
});

app.route("/v1", authed);

// ── Gmail push ──────────────────────────────────────────────────────────────

const gmailNotification = z.object({
  emailAddress: z.string(),
  historyId: z.union([z.string(), z.number()]).transform(String),
});

/**
 * Pub/Sub push of a Gmail notification (`{ emailAddress, historyId }`), sent
 * on to every device of everyone who linked that address. Anything else is
 * acknowledged and dropped: Pub/Sub would only redeliver it.
 */
app.post(
  "/push/gmail",
  bearerAuth({
    verifyToken: async (token, c) => {
      const env = c.env as Env;
      try {
        const claims = await verifyGoogleJwt(token, env.PUSH_AUDIENCE, googleKeys(env));
        return claims.email === env.PUSH_SERVICE_ACCOUNT;
      } catch (err) {
        if (err instanceof InvalidTokenError) return false;
        throw err;
      }
    },
  }),
  async (c) => {
    const body = (await c.req.json().catch(() => null)) as { message?: { data?: string } } | null;
    let data: unknown = null;
    try {
      data = JSON.parse(atob(body?.message?.data ?? ""));
    } catch {
      // not a Gmail notification
    }
    const parsed = gmailNotification.safeParse(data);
    if (!parsed.success) return c.body(null, 204);

    const email = parsed.data.emailAddress.toLowerCase();
    const event: RelayEvent = { type: "mail", email, historyId: parsed.data.historyId };
    const users = await store.usersWithMailbox(c.var.db, email);
    await Promise.all(users.map((userId) => hub(c.env, userId).publish(event)));
    return c.body(null, 204);
  },
);

export default app;
