/**
 * linked-accounts.ts
 *
 * Keeps this device's Gmail accounts and the Otter account's linked accounts in
 * step, so signing in on another device brings every account along. The relay
 * only learns addresses and profiles; each device signs in to Gmail itself,
 * so an account that arrives from the relay shows up signed out here until
 * the user signs in to it (one click, with the address prefilled).
 *
 * Reconciling compares the local accounts, the relay's list, and the
 * accounts both had last time (the snapshot): that is what tells "added on
 * another device" apart from "removed on this one".
 */

import type { ListAccountsResponse, RelayAccount } from "@otter-mail/contracts/relay";

import { logger } from "../logger.js";
import { broadcast } from "../ipc.js";
import * as accountStore from "./account-store.js";
import { platform } from "../platform.js";
import * as mailStore from "./mail-store.js";
import { getOtterUser, relayRequest, RelayError } from "./otter-account.js";
import type { GmailAccount } from "../types.js";

export type LocalAccount = Pick<GmailAccount, "email" | "displayName" | "color"> & {
  signedIn: boolean;
};

export type ReconcilePlan = {
  /** On this device only, and new: link them (needs a Gmail sign-in to prove it). */
  link: string[];
  /** Removed on this device since the last reconcile: unlink them. */
  unlink: string[];
  /** Linked on another device: add them here, signed out. */
  add: RelayAccount[];
  /** Unlinked on another device: remove them here. */
  remove: string[];
  /** Linked on both, with a profile edited elsewhere. */
  update: RelayAccount[];
};

const key = (email: string) => email.toLowerCase();

/** What to do to bring both sides together. Addresses compare case-insensitively. */
export function planReconcile(
  local: LocalAccount[],
  remote: RelayAccount[],
  snapshot: ReadonlySet<string>,
): ReconcilePlan {
  const plan: ReconcilePlan = { link: [], unlink: [], add: [], remove: [], update: [] };
  const localByKey = new Map(local.map((account) => [key(account.email), account]));
  const remoteKeys = new Set(remote.map((account) => key(account.email)));

  for (const account of remote) {
    const here = localByKey.get(key(account.email));
    if (!here) {
      if (snapshot.has(key(account.email))) plan.unlink.push(account.email);
      else plan.add.push(account);
    } else if (
      (here.displayName ?? null) !== account.displayName ||
      (here.color ?? null) !== account.color
    ) {
      plan.update.push(account);
    }
  }
  for (const account of local) {
    if (remoteKeys.has(key(account.email))) continue;
    if (snapshot.has(key(account.email))) plan.remove.push(account.email);
    else if (account.signedIn) plan.link.push(account.email);
  }
  return plan;
}

// ── Snapshot ────────────────────────────────────────────────────────────────

const SNAPSHOT_KEY = "otter:linkedAccounts";

function readSnapshot(): Set<string> {
  const saved = mailStore.getKv(SNAPSHOT_KEY);
  if (!saved) return new Set();
  try {
    return new Set(JSON.parse(saved) as string[]);
  } catch {
    return new Set();
  }
}

function writeSnapshot(emails: Iterable<string>): void {
  mailStore.setKv(SNAPSHOT_KEY, JSON.stringify([...new Set([...emails].map(key))]));
}

/** Forgets what was linked (signing out): the next Otter account starts by merging. */
export function clearLinkedSnapshot(): void {
  mailStore.setKv(SNAPSHOT_KEY, "");
}

/** Local accounts the relay has linked, as of the last reconcile. */
export function linkedAccountIds(): Set<string> {
  return readSnapshot();
}

// ── Relay calls ─────────────────────────────────────────────────────────────

const accountRoute = (email: string) => `/v1/accounts/${encodeURIComponent(key(email))}`;

const profile = (account: GmailAccount) => ({
  name: account.name,
  picture: account.picture ?? null,
  displayName: account.displayName ?? null,
  color: account.color ?? null,
});

/** Links a signed-in Gmail account to the Otter account. */
async function link(account: GmailAccount): Promise<void> {
  const idToken = await platform().google.getIdToken(account.id);
  await relayRequest("PUT", accountRoute(account.email), { idToken, ...profile(account) });
}

/** After adding (or signing back in to) a Gmail account here. No-op when signed out of Otter. */
export async function accountAdded(account: GmailAccount): Promise<void> {
  if (!getOtterUser()) return;
  try {
    await link(account);
    writeSnapshot([...readSnapshot(), account.email]);
  } catch (err) {
    // The next reconcile links it.
    logger.info("linked-accounts", `Couldn't link ${account.email}: ${String(err)}`);
  }
}

/** After removing a Gmail account here. */
export async function accountRemoved(email: string): Promise<void> {
  if (!getOtterUser()) return;
  try {
    await relayRequest("DELETE", accountRoute(email));
    const snapshot = readSnapshot();
    snapshot.delete(key(email));
    writeSnapshot(snapshot);
  } catch (err) {
    // Still in the snapshot, so the next reconcile unlinks it.
    logger.info("linked-accounts", `Couldn't unlink ${email}: ${String(err)}`);
  }
}

/** After editing an account's name or color here. */
export async function accountEdited(account: GmailAccount): Promise<void> {
  if (!getOtterUser() || !readSnapshot().has(key(account.email))) return;
  await relayRequest("PUT", accountRoute(account.email), profile(account)).catch((err: unknown) => {
    logger.info("linked-accounts", `Couldn't update ${account.email}: ${String(err)}`);
  });
}

// ── Reconcile ───────────────────────────────────────────────────────────────

/**
 * Brings this device and the relay together (see planReconcile). `removeLocal`
 * deletes an account and its cached mail from this device.
 */
export async function reconcileAccounts(
  removeLocal: (accountId: string) => Promise<void>,
): Promise<void> {
  if (!getOtterUser()) return;
  const { accounts: remote } = await relayRequest<ListAccountsResponse>("GET", "/v1/accounts");
  const localAccounts = await accountStore.listAccounts();
  const byKey = new Map(localAccounts.map((account) => [key(account.email), account]));
  const plan = planReconcile(
    localAccounts.map((account) => ({
      ...account,
      signedIn: platform().google.isSignedIn(account.id),
    })),
    remote,
    readSnapshot(),
  );

  const linked = new Set(remote.map((account) => key(account.email)));
  for (const email of plan.unlink) {
    await relayRequest("DELETE", accountRoute(email));
    linked.delete(key(email));
  }
  for (const email of plan.link) {
    try {
      await link(byKey.get(key(email))!);
      linked.add(key(email));
    } catch (err) {
      if (err instanceof RelayError && err.status === 401) throw err;
      logger.info("linked-accounts", `Couldn't link ${email}: ${String(err)}`);
    }
  }
  for (const account of plan.add) {
    await accountStore.addAccount({
      id: account.email,
      email: account.email,
      name: account.name ?? account.email,
      picture: account.picture ?? undefined,
      displayName: account.displayName ?? undefined,
      color: account.color ?? undefined,
    });
  }
  for (const email of plan.remove) {
    await removeLocal(byKey.get(key(email))!.id);
  }
  for (const account of plan.update) {
    await accountStore.updateAccount(byKey.get(key(account.email))!.id, {
      displayName: account.displayName ?? "",
      color: account.color ?? "",
    });
  }
  writeSnapshot(linked);

  const changed = plan.add.length + plan.remove.length + plan.update.length > 0;
  if (changed) broadcast("gmail:accounts-changed");
  if (Object.values(plan).some((list) => list.length > 0)) {
    logger.info("linked-accounts", "Reconciled", {
      linked: plan.link.length,
      unlinked: plan.unlink.length,
      added: plan.add.length,
      removed: plan.remove.length,
      updated: plan.update.length,
    });
  }
}
