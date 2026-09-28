/**
 * gmail-watch.ts
 *
 * Gmail push notifications: `users.watch` asks Gmail to publish a mailbox's
 * changes to the relay's Pub/Sub topic. A watch lasts 7 days and Gmail
 * recommends renewing it daily; every device signed in to the account renews
 * the same watch, which is harmless. Watches aren't stopped on sign-out:
 * another device may still rely on them, and they lapse on their own.
 */

import { logger } from "../logger.js";
import { watchMailbox } from "./gmail-api.js";
import * as mailStore from "./mail-store.js";

const RENEW_AFTER_MS = 24 * 60 * 60_000;

type Watch = { topic: string; renewedAt: number; expiration: number };

const watchKey = (accountId: string) => `gmailWatch:${accountId}`;

function readWatch(accountId: string): Watch | null {
  const saved = mailStore.getKv(watchKey(accountId));
  if (!saved) return null;
  try {
    return JSON.parse(saved) as Watch;
  } catch {
    return null;
  }
}

/**
 * Starts or renews the watch on each account that needs it. Returns the
 * accounts Gmail is publishing for; one that fails (signed out, offline)
 * is left to polling and retried next time.
 */
export async function renewWatches(accountIds: string[], topic: string): Promise<string[]> {
  const watched: string[] = [];
  for (const accountId of accountIds) {
    const watch = readWatch(accountId);
    if (watch?.topic === topic && Date.now() - watch.renewedAt < RENEW_AFTER_MS) {
      if (watch.expiration > Date.now()) watched.push(accountId);
      continue;
    }
    try {
      const { expiration } = await watchMailbox(accountId, topic);
      mailStore.setKv(
        watchKey(accountId),
        JSON.stringify({ topic, renewedAt: Date.now(), expiration } satisfies Watch),
      );
      watched.push(accountId);
      logger.info("gmail-watch", "Watching", {
        accountId,
        until: new Date(expiration).toISOString(),
      });
    } catch (err) {
      logger.info("gmail-watch", `Couldn't watch ${accountId}: ${String(err)}`);
    }
  }
  return watched;
}
