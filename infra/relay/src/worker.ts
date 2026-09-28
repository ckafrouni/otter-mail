/**
 * The Otter Mail relay: Otter accounts (better-auth, auth.ts), the Gmail
 * accounts linked to them, realtime mail notifications, and the web app's
 * Gmail sign-in (gmail.ts). Gmail publishes mailbox changes to a Pub/Sub
 * topic, Pub/Sub pushes them here, and the relay forwards them to the
 * signed-in devices over WebSocket. The API is described in
 * packages/contracts/src/relay.ts.
 */

import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { bearerAuth } from "hono/bearer-auth";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import {
  GMAIL_SIGN_IN_CANCELLED,
  type ListAccountsResponse,
  type MeResponse,
  type PreferencesResponse,
  type RelayEvent,
  type RelayUser,
} from "@otter-mail/contracts/relay";

import { createAuth, googleClientIds, googleKeys, type Auth } from "./auth.ts";
import * as gmail from "./gmail.ts";
import { InvalidTokenError, verifyGoogleJwt } from "./google-jwt.ts";
import * as preferences from "./preferences.ts";
import * as store from "./store.ts";
import { SESSION_HEADER, type UserHub } from "./user-hub.ts";

export { UserHub } from "./user-hub.ts";

export interface Env {
  DB: D1Database;
  USER_HUB: DurableObjectNamespace<UserHub>;
  /** The desktop app's Google OAuth client ("Desktop app" type). */
  GOOGLE_CLIENT_ID: string;
  /** The web app's Google OAuth client ("Web application"): Otter and Gmail sign-in. */
  GOOGLE_WEB_CLIENT_ID: string;
  /** Its secret (a Worker secret). */
  GOOGLE_WEB_CLIENT_SECRET: string;
  /** Where the web app runs (https://mail.otterware.dev): trusted for CORS and redirects. */
  APP_ORIGIN: string;
  /** The session cookie's domain, shared with the web app ("mail.otterware.dev"); unset locally. */
  COOKIE_DOMAIN?: string;
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
  /** Google's OAuth token endpoint; only tests change it. */
  GOOGLE_TOKEN_URL?: string;
}

type Session = { id: string; user: RelayUser };

type App = { Bindings: Env; Variables: { db: store.Db; auth: Auth; session: Session } };

/** Verifies a Google ID token issued to one of the apps. */
async function verifyIdToken(env: Env, idToken: string) {
  try {
    return await verifyGoogleJwt(idToken, googleClientIds(env), googleKeys(env));
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

// The web app calls the relay from its own origin, with its session cookie.
app.use("/v1/*", (c, next) =>
  cors({ origin: c.env.APP_ORIGIN, credentials: true, maxAge: 86_400 })(c, next),
);

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

// ── Gmail sign-in for the web app (gmail.ts) ────────────────────────────────

authed.get("/gmail/authorize", (c) =>
  gmail
    .authorizeUrl(c.env, c.var.session.user.id, c.req.query("login_hint"))
    .then((url) => c.redirect(url)),
);

authed.get("/gmail/callback", async (c) => {
  const { code, state, error } = c.req.query();
  try {
    if (error === "access_denied")
      return gmail.popupResponse(c.env, { error: GMAIL_SIGN_IN_CANCELLED });
    if (error || !code || !state) throw new Error(error ?? "missing code");
    if ((await gmail.stateUser(c.env, state)) !== c.var.session.user.id) {
      throw new Error("signed in as someone else");
    }
    return gmail.popupResponse(c.env, {
      result: await gmail.completeSignIn(c.env, c.var.session.user.id, code),
    });
  } catch (err) {
    console.warn("Gmail sign-in failed", String(err));
    return gmail.popupResponse(c.env, { error: String(err) });
  }
});

authed.post(
  "/gmail/token",
  zValidator("json", z.object({ sealed: z.string() }), rejectInvalid),
  async (c) => {
    try {
      return c.json(await gmail.refresh(c.env, c.var.session.user.id, c.req.valid("json").sealed));
    } catch (err) {
      if (err instanceof gmail.GoogleTokenError && err.revoked) {
        throw new HTTPException(410, { message: "Google revoked this sign-in." });
      }
      if (err instanceof gmail.GoogleTokenError)
        throw new HTTPException(502, { message: err.message });
      throw new HTTPException(400, { message: "Invalid sealed token." });
    }
  },
);

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

authed.get("/preferences", async (c) =>
  c.json(
    (await preferences.read(
      c.var.db,
      c.env.BETTER_AUTH_SECRET,
      c.var.session.user.id,
    )) satisfies PreferencesResponse,
  ),
);

authed.put(
  "/preferences",
  zValidator(
    "json",
    z.object({
      preferences: z.record(z.string().max(64), z.unknown()).optional(),
      hermesKey: z.string().max(4096).nullable().optional(),
    }),
    rejectInvalid,
  ),
  async (c) => {
    const userId = c.var.session.user.id;
    if (
      !(await preferences.write(c.var.db, c.env.BETTER_AUTH_SECRET, userId, c.req.valid("json")))
    ) {
      throw new HTTPException(413, { message: "Preferences too large." });
    }
    await hub(c.env, userId).publish({ type: "preferences" });
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
