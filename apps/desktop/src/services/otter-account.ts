/**
 * otter-account.ts
 *
 * The Otter account, signed in to the relay (infra/relay,
 * relay.mail.otterware.dev), which keeps the list of linked Gmail accounts
 * and pushes new-mail events. Sign-in, devices and account deletion go
 * through better-auth's client; the relay's own routes through
 * relayRequest. linked-accounts.ts and realtime.ts build on this module.
 *
 * The session (one per Mac) lives in userData/otter-account.json, its token
 * encrypted with safeStorage like the Google tokens.
 */

import { app, safeStorage } from "electron";
import { createAuthClient } from "better-auth/client";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import type { OtterDevice } from "@otter-mail/contracts";
import type { RelayUser } from "@otter-mail/contracts/relay";

import { logger } from "../logger.js";

export const RELAY_URL =
  process.env.OTTER_MAIL_RELAY_URL?.trim() || "https://relay.mail.otterware.dev";

type SessionFile = { version: 1; token: string; user: RelayUser };

let session: { token: string; user: RelayUser } | null = null;
const listeners = new Set<() => void>();

function sessionFilePath(): string {
  return path.join(app.getPath("userData"), "otter-account.json");
}

/** Runs `listener` whenever the Otter account signs in or out. */
export function onOtterAccountChange(listener: () => void): void {
  listeners.add(listener);
}

async function setSession(next: typeof session): Promise<void> {
  session = next;
  const file = sessionFilePath();
  if (next) {
    const body: SessionFile = {
      version: 1,
      token: safeStorage.encryptString(next.token).toString("base64"),
      user: next.user,
    };
    await fs.writeFile(`${file}.tmp`, JSON.stringify(body, null, 2), { mode: 0o600 });
    await fs.rename(`${file}.tmp`, file);
  } else {
    await fs.rm(file, { force: true });
  }
  for (const listener of listeners) listener();
}

/** Reads the stored session; call once at startup. */
export async function loadOtterAccount(): Promise<void> {
  try {
    const file = JSON.parse(await fs.readFile(sessionFilePath(), "utf-8")) as SessionFile;
    const token = safeStorage.decryptString(Buffer.from(file.token, "base64"));
    session = { token, user: file.user };
  } catch {
    session = null;
  }
}

/** Who is signed in to Otter Mail, or null. */
export function getOtterUser(): RelayUser | null {
  return session?.user ?? null;
}

/** The relay's session token, for the event stream. */
export function getSessionToken(): string | null {
  return session?.token ?? null;
}

/** The relay answered with an error (`status` 0: it couldn't be reached). */
export class RelayError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "RelayError";
  }
}

async function request<T>(
  method: string,
  route: string,
  opts: { body?: unknown; token?: string | null } = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${RELAY_URL}${route}`, {
      method,
      headers: {
        ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
        ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: AbortSignal.timeout(20_000),
    });
  } catch (err) {
    throw new RelayError(0, `Can't reach Otter Mail's servers (${String(err)}).`);
  }
  if (!response.ok) {
    const { error } = (await response.json().catch(() => ({}))) as { error?: string };
    throw new RelayError(response.status, error || `The relay answered ${response.status}.`);
  }
  return (response.status === 204 ? null : await response.json()) as T;
}

/**
 * A signed-in call to the relay. A 401 means the session is gone (signed out
 * elsewhere, or revoked): this device signs out too.
 */
export async function relayRequest<T = null>(
  method: string,
  route: string,
  body?: unknown,
): Promise<T> {
  const token = session?.token;
  if (!token) throw new RelayError(401, "Not signed in to Otter Mail.");
  try {
    return await request<T>(method, route, { body, token });
  } catch (err) {
    if (err instanceof RelayError && err.status === 401 && session?.token === token) {
      logger.warn("otter-account", "The relay ended this session; signing out");
      await setSession(null);
    }
    throw err;
  }
}

// ── better-auth ─────────────────────────────────────────────────────────────

let userAgent: string | null = null;

/** How this Mac appears in the account's device list: "Otter Mail/0.1.3 (<the Mac's name>)". */
function deviceUserAgent(): string {
  if (userAgent) return userAgent;
  let name = os.hostname().replace(/\.local$/, "");
  try {
    name = execFileSync("/usr/sbin/scutil", ["--get", "ComputerName"], { encoding: "utf8" }).trim();
  } catch {
    // keep the host name
  }
  userAgent = `Otter Mail/${app.getVersion()} (${name})`;
  return userAgent;
}

const auth = createAuthClient({
  baseURL: RELAY_URL,
  basePath: "/v1/auth",
  fetchOptions: {
    auth: { type: "Bearer", token: () => session?.token },
    onRequest: (context) => {
      context.headers.set("User-Agent", deviceUserAgent());
    },
  },
});

/** better-auth answers `{ data, error }`; turn an error into a RelayError. */
async function unwrap<T>(
  call: Promise<
    { data: T; error: null } | { data: null; error: { status: number; message?: string } }
  >,
): Promise<T> {
  const { data, error } = await call;
  if (error) {
    if (error.status === 401 && session) await setSession(null);
    throw new RelayError(error.status, error.message || `The relay answered ${error.status}.`);
  }
  return data;
}

/**
 * Signs in to the relay with a Google ID token. ID tokens from a refresh
 * carry no name or picture; `profile` (the Gmail account's) fills them in.
 */
export async function signIn(
  idToken: string,
  profile?: { name: string; picture?: string },
): Promise<RelayUser> {
  let token: string | null = null;
  const data = await unwrap(
    auth.signIn.social(
      { provider: "google", idToken: { token: idToken } },
      { onSuccess: (ctx) => void (token = ctx.response.headers.get("set-auth-token")) },
    ),
  );
  if (!token || !data || !("user" in data)) {
    throw new RelayError(0, "The relay didn't return a session.");
  }
  const { user } = data;
  const relayUser: RelayUser = {
    id: user.id,
    email: user.email,
    name: user.name || profile?.name || null,
    picture: user.image || profile?.picture || null,
  };
  await setSession({ token, user: relayUser });
  if (profile && (!user.name || !user.image)) {
    await auth
      .updateUser({ name: relayUser.name ?? undefined, image: relayUser.picture })
      .catch((err: unknown) =>
        logger.info("otter-account", `Couldn't set the profile: ${String(err)}`),
      );
  }
  logger.info("otter-account", "Signed in", { user: user.email });
  return relayUser;
}

/** Signs out here, and ends the session on the relay when it can be reached. */
export async function signOut(): Promise<void> {
  if (!session) return;
  await auth.signOut().catch((err: unknown) => {
    logger.info("otter-account", `Couldn't end the relay session: ${String(err)}`);
  });
  await setSession(null);
}

/** The Macs signed in to this Otter account, this one first. */
export async function listDevices(): Promise<OtterDevice[]> {
  const sessions = (await unwrap(auth.listSessions())) ?? [];
  const current = session?.token.split(".")[0];
  return sessions
    .map((s) => ({
      token: s.token,
      name: /\((.+)\)$/.exec(s.userAgent ?? "")?.[1] ?? "Unknown device",
      current: s.token === current,
      lastActiveAt: new Date(s.updatedAt).getTime(),
    }))
    .sort((a, b) => Number(b.current) - Number(a.current) || b.lastActiveAt - a.lastActiveAt);
}

/** Signs another Mac out of this Otter account. */
export async function signOutDevice(token: string): Promise<void> {
  await unwrap(auth.revokeSession({ token }));
}

/** Deletes the Otter account and everything the relay keeps for it; signs every Mac out. */
export async function deleteOtterAccount(): Promise<void> {
  await unwrap(auth.deleteUser({}));
  await setSession(null);
}
