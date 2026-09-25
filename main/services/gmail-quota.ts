/**
 * Gmail's per-user quota, shared by everything the app does with an account.
 *
 * Gmail allows ~250 quota units per second per user (15,000 per minute), and
 * every call costs units (messages.get 5, threads.get 10, send 100, …). When
 * background sync spends it all, even opening a message fails with a 403
 * "Quota exceeded" — so every request draws from one token bucket per account:
 *
 *  - foreground work (what the user just did) takes units as soon as they're
 *    there and goes ahead of any waiting background work;
 *  - background work (mail sync) only spends above a reserve kept for the
 *    user, and pauses entirely for a while after Gmail reports the quota
 *    exhausted.
 *
 * Background work is marked by running it inside `asBackgroundWork`; anything
 * else counts as foreground.
 */

import { AsyncLocalStorage } from "node:async_hooks";

/** Sustained budget, below Gmail's 250 units/s so bursts never tip it over. */
const UNITS_PER_SEC = 200;
/** Burst capacity of the bucket. */
const CAPACITY = 250;
/** Units background work leaves in the bucket for the user's next action. */
const FOREGROUND_RESERVE = 100;
/** How long background work stands down after a quota error. */
const COOLDOWN_MS = 30_000;

type Bucket = {
  tokens: number;
  updatedAt: number;
  /** Background work waits until then after a quota error. */
  cooldownUntil: number;
  /** Foreground requests waiting for units; background yields to them. */
  foregroundWaiting: number;
};

const buckets = new Map<string, Bucket>();
const background = new AsyncLocalStorage<true>();

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function bucketFor(accountId: string): Bucket {
  let bucket = buckets.get(accountId);
  if (!bucket) {
    bucket = { tokens: CAPACITY, updatedAt: Date.now(), cooldownUntil: 0, foregroundWaiting: 0 };
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

/** Runs `fn` as background work: it yields quota to the user's own actions. */
export function asBackgroundWork<T>(fn: () => Promise<T>): Promise<T> {
  return background.run(true, fn);
}

export function isBackgroundWork(): boolean {
  return background.getStore() === true;
}

/** Waits until `units` can be spent on this account, then spends them. */
export async function acquireQuota(accountId: string, units: number): Promise<void> {
  if (!isBackgroundWork()) {
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
  for (;;) {
    const bucket = bucketFor(accountId);
    const now = Date.now();
    if (now < bucket.cooldownUntil) {
      await sleep(bucket.cooldownUntil - now);
      continue;
    }
    const needed = units + FOREGROUND_RESERVE;
    if (bucket.foregroundWaiting === 0 && bucket.tokens >= needed) {
      bucket.tokens -= units;
      return;
    }
    await sleep(Math.max(50, ((needed - bucket.tokens) / UNITS_PER_SEC) * 1000));
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
