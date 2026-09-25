/**
 * Gmail's per-user quota, shared by everything the app does with an account.
 *
 * Every Gmail call costs quota units (messages.get 5, threads.get 10, send
 * 100, …) against a per-user, per-minute limit. For this app's Google project
 * that limit is 6,000 units a minute (Gmail's 403 "Quota exceeded … Units per
 * minute per user" reports `quota_limit_value: 6000`), not the 15,000 Gmail
 * documents as its default — budgeting for the latter made big syncs trip the
 * limit over and over, failing whole sync runs and the user's own actions.
 *
 * Every request draws from one token bucket per account, in three tiers:
 *
 *  - foreground work (what the user just did) takes units as soon as they're
 *    there and goes ahead of anything waiting;
 *  - sync work (keeping the mailbox current) only spends above a reserve kept
 *    for the user;
 *  - prefetch work (downloading bodies for offline reading) only spends above
 *    a larger reserve, and never while sync work is waiting.
 *
 * Background tiers pause entirely for a while after Gmail reports the quota
 * exhausted. Work is tagged by running it inside `asBackgroundWork` (sync) or
 * `asPrefetchWork`; anything else counts as foreground.
 */

import { AsyncLocalStorage } from "node:async_hooks";

/** Gmail's per-minute limit for this project, per user. */
const UNITS_PER_MINUTE_LIMIT = 6_000;
/** Burst capacity of the bucket. */
const CAPACITY = 250;
/** Sustained budget: a full minute of refill plus one full burst stays under the limit. */
const UNITS_PER_SEC = Math.floor((UNITS_PER_MINUTE_LIMIT * 0.92 - CAPACITY) / 60);
/** Units sync work leaves in the bucket for the user's next action. */
const SYNC_RESERVE = 100;
/** Units prefetch work leaves in the bucket (for the user and for sync). */
const PREFETCH_RESERVE = 175;
/** How long background work stands down after a quota error (Gmail's window is a minute). */
const COOLDOWN_MS = 30_000;

type Tier = "sync" | "prefetch";

type Bucket = {
  tokens: number;
  updatedAt: number;
  /** Background work waits until then after a quota error. */
  cooldownUntil: number;
  /** Foreground requests waiting for units; background yields to them. */
  foregroundWaiting: number;
  /** Sync requests waiting for units; prefetch yields to them. */
  syncWaiting: number;
};

const buckets = new Map<string, Bucket>();
const tier = new AsyncLocalStorage<Tier>();

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function bucketFor(accountId: string): Bucket {
  let bucket = buckets.get(accountId);
  if (!bucket) {
    bucket = {
      tokens: CAPACITY,
      updatedAt: Date.now(),
      cooldownUntil: 0,
      foregroundWaiting: 0,
      syncWaiting: 0,
    };
    buckets.set(accountId, bucket);
  }
  const now = Date.now();
  bucket.tokens = Math.min(
    CAPACITY,
    bucket.tokens + ((now - bucket.updatedAt) / 1000) * UNITS_PER_SEC,
  );
  bucket.updatedAt = now;
  return bucket;
}

/** Runs `fn` as sync work: it yields quota to the user's own actions. */
export function asBackgroundWork<T>(fn: () => Promise<T>): Promise<T> {
  return tier.run("sync", fn);
}

/** Runs `fn` as prefetch work: it yields quota to the user and to sync. */
export function asPrefetchWork<T>(fn: () => Promise<T>): Promise<T> {
  return tier.run("prefetch", fn);
}

/** True for sync and prefetch work (anything the user isn't waiting on). */
export function isBackgroundWork(): boolean {
  return tier.getStore() !== undefined;
}

/** Background work is standing down after a quota error (prefetch checks this to pause). */
export function isCoolingDown(accountId: string): boolean {
  return Date.now() < bucketFor(accountId).cooldownUntil;
}

/** Waits until `units` can be spent on this account, then spends them. */
export async function acquireQuota(accountId: string, units: number): Promise<void> {
  const current = tier.getStore();
  if (current === undefined) {
    let bucket = bucketFor(accountId);
    if (bucket.tokens >= units) {
      bucket.tokens -= units;
      return;
    }
    bucket.foregroundWaiting += 1;
    try {
      while (bucket.tokens < units) {
        await sleep(((units - bucket.tokens) / UNITS_PER_SEC) * 1000);
        bucket = bucketFor(accountId);
      }
      bucket.tokens -= units;
    } finally {
      bucket.foregroundWaiting -= 1;
    }
    return;
  }

  const isSync = current === "sync";
  const reserve = isSync ? SYNC_RESERVE : PREFETCH_RESERVE;
  const counted = bucketFor(accountId);
  if (isSync) counted.syncWaiting += 1;
  try {
    for (;;) {
      const bucket = bucketFor(accountId);
      const now = Date.now();
      if (now < bucket.cooldownUntil) {
        await sleep(bucket.cooldownUntil - now);
        continue;
      }
      const needed = units + reserve;
      // Sync counts itself in syncWaiting, so prefetch alone checks it.
      const yielding = bucket.foregroundWaiting > 0 || (!isSync && bucket.syncWaiting > 0);
      if (!yielding && bucket.tokens >= needed) {
        bucket.tokens -= units;
        return;
      }
      await sleep(Math.max(50, ((needed - bucket.tokens) / UNITS_PER_SEC) * 1000));
    }
  } finally {
    if (isSync) counted.syncWaiting -= 1;
  }
}

/**
 * Gmail said the quota is exhausted: drain the bucket so everyone slows down,
 * and keep background work away for `retryAfterMs` (at least COOLDOWN_MS).
 */
export function reportQuotaExceeded(accountId: string, retryAfterMs: number): void {
  const bucket = bucketFor(accountId);
  bucket.tokens = 0;
  bucket.cooldownUntil = Math.max(
    bucket.cooldownUntil,
    Date.now() + Math.max(retryAfterMs, COOLDOWN_MS),
  );
}

/** Quota units of one Gmail REST call (developers.google.com/gmail/api/reference/quota). */
export function quotaCost(method: string, path: string): number {
  const p = path.split("?")[0];
  const write = method !== "GET";
  if (p === "/profile") return 1;
  if (p.startsWith("/labels")) return write ? 5 : 1;
  if (p.startsWith("/history")) return 2;
  if (p === "/messages/send" || /^\/drafts\/send/.test(p)) return 100;
  if (/^\/messages\/batch(Delete|Modify)/.test(p)) return 50;
  if (p.startsWith("/threads")) return method === "DELETE" ? 20 : 10;
  if (p.startsWith("/drafts")) return method === "PUT" ? 15 : write ? 10 : 5;
  return 5; // messages.get / list / modify / trash / attachments
}
