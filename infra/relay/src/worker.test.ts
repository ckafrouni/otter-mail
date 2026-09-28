/**
 * The relay end to end, as a device and Pub/Sub see it: the real Worker in
 * workerd (wrangler's local runtime) with a local D1 and Durable Object.
 * Google is played by a local JWKS server whose key signs the ID tokens and
 * push tokens.
 */

import { execFileSync } from "node:child_process";
import * as http from "node:http";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { unstable_startWorker } from "wrangler";
import type { ListAccountsResponse, MeResponse, RelayEvent } from "@otter-mail/contracts/relay";

const CLIENT_ID = "test-client.apps.googleusercontent.com";
const PUSH_AUDIENCE = "https://relay.test/push/gmail";
const PUSH_SERVICE_ACCOUNT = "push@test.iam.gserviceaccount.com";
const root = path.resolve(import.meta.dirname, "..");

let signingKey: CryptoKey;
let jwks: http.Server;
let worker: Awaited<ReturnType<typeof unstable_startWorker>>;
let base: string;
let persistDir: string;

beforeAll(async () => {
  const pair = await generateKeyPair("RS256");
  signingKey = pair.privateKey;
  const publicJwk = { ...(await exportJWK(pair.publicKey)), kid: "test", alg: "RS256" };
  jwks = http.createServer((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ keys: [publicJwk] }));
  });
  await new Promise<void>((resolve) => jwks.listen(0, "127.0.0.1", resolve));
  const { port } = jwks.address() as { port: number };

  persistDir = fs.mkdtempSync(path.join(os.tmpdir(), "otter-relay-test-"));
  execFileSync(
    "pnpm",
    [
      "exec",
      "wrangler",
      "d1",
      "migrations",
      "apply",
      "otter-mail-relay",
      "--local",
      "--persist-to",
      persistDir,
    ],
    { cwd: root, stdio: "ignore", env: { ...process.env, CI: "1" } },
  );

  worker = await unstable_startWorker({
    config: path.join(root, "wrangler.jsonc"),
    bindings: {
      GOOGLE_CLIENT_ID: { type: "plain_text", value: CLIENT_ID },
      GOOGLE_JWKS_URL: { type: "plain_text", value: `http://127.0.0.1:${port}/certs` },
      PUSH_AUDIENCE: { type: "plain_text", value: PUSH_AUDIENCE },
      PUSH_SERVICE_ACCOUNT: { type: "plain_text", value: PUSH_SERVICE_ACCOUNT },
      BETTER_AUTH_SECRET: {
        type: "plain_text",
        value: "test-secret-that-is-long-enough-for-better-auth",
      },
    },
    dev: {
      server: { hostname: "127.0.0.1", port: 0 },
      inspector: false,
      persist: persistDir,
      watch: false,
      logLevel: "none",
    },
  });
  base = (await worker.url).toString().replace(/\/$/, "");
}, 60_000);

afterAll(async () => {
  await worker?.dispose();
  jwks?.close();
  fs.rmSync(persistDir, { recursive: true, force: true });
});

// ── Helpers ─────────────────────────────────────────────────────────────────

let nextSub = 1;

/** A Google ID token for `email`, as the desktop app would get one. */
function idToken(email: string, opts: { sub?: string; aud?: string } = {}) {
  return new SignJWT({ email, email_verified: true, name: "Test User" })
    .setProtectedHeader({ alg: "RS256", kid: "test" })
    .setIssuer("https://accounts.google.com")
    .setAudience(opts.aud ?? CLIENT_ID)
    .setSubject(opts.sub ?? `sub-${nextSub++}`)
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(signingKey);
}

function call(method: string, route: string, token?: string, body?: unknown) {
  return fetch(`${base}${route}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

function signInRequest(token: string) {
  return call("POST", "/v1/auth/sign-in/social", undefined, {
    provider: "google",
    idToken: { token },
  });
}

/** Signs in as the desktop app does; returns the bearer token better-auth hands out. */
async function signIn(email: string, sub?: string) {
  const response = await signInRequest(await idToken(email, { sub }));
  expect(response.status).toBe(200);
  const token = response.headers.get("set-auth-token");
  expect(token).toBeTruthy();
  const { user } = (await response.json()) as { user: { id: string; email: string; name: string } };
  return { token: token!, user };
}

async function link(token: string, email: string, profile: Record<string, unknown> = {}) {
  return call("PUT", `/v1/accounts/${encodeURIComponent(email)}`, token, {
    idToken: await idToken(email),
    ...profile,
  });
}

async function listAccounts(token: string) {
  const response = await call("GET", "/v1/accounts", token);
  expect(response.status).toBe(200);
  return ((await response.json()) as ListAccountsResponse).accounts;
}

/** Publishes a Gmail notification the way Pub/Sub pushes it. */
async function push(notification: unknown, opts: { email?: string; aud?: string } = {}) {
  const token = await new SignJWT({
    email: opts.email ?? PUSH_SERVICE_ACCOUNT,
    email_verified: true,
  })
    .setProtectedHeader({ alg: "RS256", kid: "test" })
    .setIssuer("https://accounts.google.com")
    .setAudience(opts.aud ?? PUSH_AUDIENCE)
    .setSubject("pubsub")
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(signingKey);
  return call("POST", "/push/gmail", token, {
    message: { data: btoa(JSON.stringify(notification)), messageId: "1" },
    subscription: "projects/test/subscriptions/test",
  });
}

/** A device's event stream: collects what the relay sends. */
async function connect(token: string) {
  // Node's WebSocket (undici) takes headers, as the desktop app's does.
  const socket = new WebSocket(`${base.replace(/^http/, "ws")}/v1/events`, {
    headers: { authorization: `Bearer ${token}` },
  } as unknown as string[]);
  const events: (RelayEvent | string)[] = [];
  const closed = new Promise<number>((resolve) =>
    socket.addEventListener("close", (e) => resolve(e.code)),
  );
  socket.addEventListener("message", (e) => {
    const text = String(e.data);
    events.push(text === "pong" ? text : (JSON.parse(text) as RelayEvent));
  });
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener("open", () => resolve());
    socket.addEventListener("error", () => reject(new Error("WebSocket failed")));
  });
  return { socket, events, closed };
}

async function until(check: () => boolean, what: string) {
  for (let i = 0; i < 100; i++) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for ${what}`);
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("sign-in", () => {
  it("signs in with a Google ID token and reports who is signed in", async () => {
    const { token, user } = await signIn("Owner@Example.com", "owner-sub");
    expect(user).toMatchObject({ email: "owner@example.com", name: "Test User" });

    const me = (await (await call("GET", "/v1/me", token)).json()) as MeResponse;
    expect(me.user).toMatchObject({ id: user.id, email: "owner@example.com", name: "Test User" });
    expect(me.pushTopic).toBe("projects/otter-mail/topics/gmail-push");
  });

  it("signing in again (another Mac) is the same user, with its own session", async () => {
    const a = await signIn("same@example.com", "same-sub");
    const b = await signIn("same@example.com", "same-sub");
    expect(a.token).not.toBe(b.token);
    expect(a.user.id).toBe(b.user.id);
    await link(a.token, "shared-view@example.com");
    expect((await listAccounts(b.token)).map((x) => x.email)).toEqual(["shared-view@example.com"]);
  });

  it("rejects ID tokens for another OAuth client, and garbage", async () => {
    const other = await signInRequest(await idToken("x@example.com", { aud: "someone-else" }));
    expect(other.ok).toBe(false);
    expect((await signInRequest("nope")).ok).toBe(false);
  });

  it("needs a session for everything else", async () => {
    expect((await call("GET", "/v1/me")).status).toBe(401);
    expect((await call("GET", "/v1/accounts", "forged")).status).toBe(401);
  });
});

describe("devices", () => {
  it("lists each signed-in device", async () => {
    const mac1 = await signIn("devices@example.com", "devices-sub");
    await signIn("devices@example.com", "devices-sub");
    const sessions = (await (
      await call("GET", "/v1/auth/list-sessions", mac1.token)
    ).json()) as unknown[];
    expect(sessions).toHaveLength(2);
  });

  // The close frame goes out at once; the runtime drops the TCP connection
  // (when Node's WebSocket reports `close`) about 10s later.
  it("signing out ends the session and closes its sockets", { timeout: 20_000 }, async () => {
    const { token } = await signIn("leaving@example.com");
    const device = await connect(token);
    expect((await call("POST", "/v1/auth/sign-out", token, {})).status).toBe(200);
    expect((await call("GET", "/v1/me", token)).status).toBe(401);
    expect(await device.closed).toBe(4001);
  });

  it("signing another device out closes its sockets", { timeout: 20_000 }, async () => {
    const here = await signIn("revoker@example.com", "revoker-sub");
    const there = await signIn("revoker@example.com", "revoker-sub");
    const device = await connect(there.token);
    const sessions = (await (await call("GET", "/v1/auth/list-sessions", here.token)).json()) as {
      token: string;
    }[];
    const other = sessions.find((s) => s.token !== here.token.split(".")[0])!;
    const revoke = await call("POST", "/v1/auth/revoke-session", here.token, {
      token: other.token,
    });
    expect(revoke.status).toBe(200);
    expect((await call("GET", "/v1/me", there.token)).status).toBe(401);
    expect((await call("GET", "/v1/me", here.token)).status).toBe(200);
    expect(await device.closed).toBe(4001);
  });

  it(
    "deleting the account removes its linked accounts and signs every device out",
    { timeout: 20_000 },
    async () => {
      const mac1 = await signIn("deleting@example.com", "deleting-sub");
      const mac2 = await signIn("deleting@example.com", "deleting-sub");
      await link(mac1.token, "gone-mailbox@example.com");
      const device = await connect(mac2.token);
      expect((await call("POST", "/v1/auth/delete-user", mac1.token, {})).status).toBe(200);
      expect((await call("GET", "/v1/me", mac2.token)).status).toBe(401);
      expect(await device.closed).toBe(4001);

      // Signing in again starts from nothing; pushes for the old mailbox reach nobody.
      const again = await signIn("deleting@example.com", "deleting-sub");
      expect(await listAccounts(again.token)).toEqual([]);
    },
  );
});

describe("linked accounts", () => {
  it("links accounts with proof, lists them in order, and updates profiles", async () => {
    const { token } = await signIn("me@example.com");
    expect((await link(token, "Work@Example.com", { name: "Work", color: "#f00" })).status).toBe(
      204,
    );
    expect((await link(token, "home@example.com")).status).toBe(204);

    // Profile edits after linking need no proof; left-out fields keep their value.
    const edit = await call("PUT", "/v1/accounts/work%40example.com", token, {
      displayName: "Job",
    });
    expect(edit.status).toBe(204);

    expect(await listAccounts(token)).toEqual([
      { email: "work@example.com", name: "Work", picture: null, displayName: "Job", color: "#f00" },
      { email: "home@example.com", name: null, picture: null, displayName: null, color: null },
    ]);
  });

  it("refuses to link without proof, or with proof for another address", async () => {
    const { token } = await signIn("me2@example.com");
    const noProof = await call("PUT", "/v1/accounts/victim%40example.com", token, {});
    expect(noProof.status).toBe(403);
    const wrongProof = await call("PUT", "/v1/accounts/victim%40example.com", token, {
      idToken: await idToken("attacker@example.com"),
    });
    expect(wrongProof.status).toBe(403);
    expect(await listAccounts(token)).toEqual([]);
  });

  it("unlinks accounts", async () => {
    const { token } = await signIn("me3@example.com");
    await link(token, "gone@example.com");
    expect((await call("DELETE", "/v1/accounts/gone%40example.com", token)).status).toBe(204);
    expect((await call("DELETE", "/v1/accounts/gone%40example.com", token)).status).toBe(204);
    expect(await listAccounts(token)).toEqual([]);
  });

  it("rejects addresses that aren't one", async () => {
    const { token } = await signIn("me4@example.com");
    expect((await call("PUT", "/v1/accounts/not-an-address", token, {})).status).toBe(400);
  });

  it("tells every device when the accounts change", async () => {
    const { token } = await signIn("multi@example.com", "multi-sub");
    const other = await signIn("multi@example.com", "multi-sub");
    const device = await connect(other.token);
    await link(token, "new@example.com");
    await until(() => device.events.length > 0, "the accounts event");
    expect(device.events).toEqual([{ type: "accounts" }]);
    device.socket.close();
  });
});

describe("realtime", () => {
  it("answers ping with pong", async () => {
    const { token } = await signIn("pinger@example.com");
    const device = await connect(token);
    device.socket.send("ping");
    await until(() => device.events.includes("pong"), "pong");
    device.socket.close();
  });

  it("refuses sockets without a session", async () => {
    await expect(connect("oms_forged")).rejects.toThrow();
  });

  it("forwards Gmail pushes to the devices of everyone who linked the mailbox", async () => {
    const alice = await signIn("alice@example.com");
    const bob = await signIn("bob@example.com");
    await link(alice.token, "inbox@example.com");
    const aliceDevice = await connect(alice.token);
    const bobDevice = await connect(bob.token);

    const response = await push({ emailAddress: "Inbox@Example.com", historyId: 4242 });
    expect(response.status).toBe(204);
    await until(() => aliceDevice.events.length > 0, "the mail event");
    expect(aliceDevice.events).toEqual([
      { type: "mail", email: "inbox@example.com", historyId: "4242" },
    ]);

    // Bob never linked it; a mailbox nobody linked is acknowledged and dropped.
    expect((await push({ emailAddress: "nobody@example.com", historyId: "1" })).status).toBe(204);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(bobDevice.events).toEqual([]);
    aliceDevice.socket.close();
    bobDevice.socket.close();
  });

  it("only accepts pushes Pub/Sub signed for this endpoint", async () => {
    const note = { emailAddress: "inbox@example.com", historyId: "1" };
    expect((await push(note, { email: "someone@example.com" })).status).toBe(401);
    expect((await push(note, { aud: "https://elsewhere/push" })).status).toBe(401);
    expect((await call("POST", "/push/gmail", undefined, {})).status).toBe(401);
  });

  it("acknowledges pushes that aren't Gmail notifications", async () => {
    expect((await push({ hello: "world" })).status).toBe(204);
  });
});
