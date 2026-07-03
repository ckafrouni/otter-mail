/**
 * mail-sync.ts
 *
 * Background sync engine that keeps the local SQLite cache (mail-store) in
 * step with Gmail. First run does a full-mailbox metadata sync; subsequent
 * runs use Gmail's history feed for cheap incremental deltas. Full message
 * bodies are fetched lazily on open (see gmail handlers) and cached.
 *
 * Sync is fire-and-forget; the renderer polls getSyncStatus() to show
 * progress and refresh its views as the local store fills in.
 */

import { logger } from "@glaze/core/backend";
import {
  listLabels,
  getProfile,
  listMessageIdsPage,
  fetchMetadataForIds,
  getMessage,
  listHistory,
  isHistoryExpiredError,
} from "./gmail-api.js";
import { listAccounts } from "./account-store.js";
import * as store from "./mail-store.js";
import type { SyncStatus } from "../gmail/types.js";

const statuses = new Map<string, SyncStatus>();
const running = new Set<string>();

function ensureStatus(accountId: string): SyncStatus {
  const existing = statuses.get(accountId);
  if (existing) return existing;
  const state = store.getSyncState(accountId);
  const status: SyncStatus = {
    accountId,
    syncing: false,
    phase: "idle",
    synced: 0,
    total: null,
    lastSyncAt: state.lastSyncAt,
    fullSyncDone: state.fullSyncDone,
    error: null,
  };
  statuses.set(accountId, status);
  return status;
}

function update(accountId: string, patch: Partial<SyncStatus>): void {
  Object.assign(ensureStatus(accountId), patch);
}

export function getSyncStatus(accountId: string): SyncStatus {
  return { ...ensureStatus(accountId) };
}

/** Kick off a background sync for one account (no-op if one is already running). */
export function syncAccount(accountId: string): void {
  if (running.has(accountId)) return;
  running.add(accountId);
  void runSync(accountId).finally(() => running.delete(accountId));
}

/** Sync every connected account — used on app launch. */
export async function syncAllAccounts(): Promise<void> {
  try {
    const accounts = await listAccounts();
    for (const account of accounts) syncAccount(account.id);
  } catch (err) {
    logger.error("mail-sync", `syncAllAccounts failed: ${String(err)}`);
  }
}

let autoSyncTimer: ReturnType<typeof setInterval> | null = null;

/** (Re)start the periodic pull-sync timer; 0 disables it. */
export function configureAutoSync(intervalSeconds: number): void {
  if (autoSyncTimer) {
    clearInterval(autoSyncTimer);
    autoSyncTimer = null;
  }
  if (intervalSeconds > 0) {
    autoSyncTimer = setInterval(() => void syncAllAccounts(), intervalSeconds * 1000);
  }
  logger.info("mail-sync", `auto-sync ${intervalSeconds > 0 ? `every ${intervalSeconds}s` : "disabled"}`);
}

async function runSync(accountId: string): Promise<void> {
  const state = store.getSyncState(accountId);
  update(accountId, { syncing: true, error: null, synced: 0, phase: "labels" });

  try {
    // Labels first — the sidebar and message chips depend on them.
    const labels = await listLabels(accountId);
    store.upsertLabels(accountId, labels);

    if (state.fullSyncDone && state.historyId) {
      await incrementalSync(accountId, state.historyId);
    } else {
      await fullSync(accountId);
    }

    // Download full bodies so the whole mailbox is readable offline.
    await backfillBodies(accountId);

    const now = Date.now();
    store.setSyncState(accountId, { lastSyncAt: now });
    update(accountId, {
      syncing: false,
      phase: "idle",
      lastSyncAt: now,
      fullSyncDone: store.getSyncState(accountId).fullSyncDone,
    });
  } catch (err) {
    logger.error("mail-sync", `sync failed for ${accountId}: ${String(err)}`);
    update(accountId, { syncing: false, phase: "idle", error: String(err) });
  }
}

async function fullSync(accountId: string): Promise<void> {
  // Capture the history cursor BEFORE the (long) full sync so a later
  // incremental pass can replay anything that changed in the meantime.
  let seedHistoryId: string | null = null;
  try {
    seedHistoryId = (await getProfile(accountId)).historyId || null;
  } catch {
    seedHistoryId = null;
  }

  update(accountId, { phase: "full", synced: 0 });

  let pageToken: string | undefined;
  let synced = 0;

  do {
    const page = await listMessageIdsPage(accountId, { pageToken, maxResults: 500 });

    if (page.resultSizeEstimate && ensureStatus(accountId).total === null) {
      update(accountId, { total: page.resultSizeEstimate });
    }

    if (page.ids.length > 0) {
      const summaries = await fetchMetadataForIds(accountId, page.ids);
      store.upsertMessages(accountId, summaries);
      synced += summaries.length;
      update(accountId, { synced });
    }

    pageToken = page.nextPageToken;
  } while (pageToken);

  store.setSyncState(accountId, { fullSyncDone: true, historyId: seedHistoryId });
}

/**
 * Fetch and cache the full body of every message whose body isn't stored yet
 * (newest first), so the entire mailbox can be read offline. Resumable: each
 * run only touches messages still missing a body. Individual failures (e.g. a
 * message deleted since metadata sync) are skipped and retried next run.
 */
async function backfillBodies(accountId: string): Promise<void> {
  const ids = store.getUndownloadedMessageIds(accountId);
  if (ids.length === 0) return;

  update(accountId, { phase: "bodies", synced: 0, total: ids.length });

  const CONCURRENCY = 8;
  let done = 0;

  for (let i = 0; i < ids.length; i += CONCURRENCY) {
    const batch = ids.slice(i, i + CONCURRENCY);
    await Promise.all(
      batch.map(async (id) => {
        try {
          const detail = await getMessage(accountId, id);
          store.upsertMessageDetail(accountId, detail);
        } catch (err) {
          logger.info("mail-sync", `body fetch skipped for ${id}: ${String(err)}`);
        }
      }),
    );
    done += batch.length;
    update(accountId, { synced: done });
  }
}

async function incrementalSync(accountId: string, startHistoryId: string): Promise<void> {
  update(accountId, { phase: "incremental", synced: 0 });

  const addedIds = new Set<string>();
  let latestHistoryId = startHistoryId;
  let pageToken: string | undefined;

  try {
    do {
      const page = await listHistory(accountId, startHistoryId, pageToken);
      if (page.historyId) latestHistoryId = page.historyId;

      for (const entry of page.history ?? []) {
        for (const added of entry.messagesAdded ?? []) {
          addedIds.add(added.message.id);
        }
        for (const deleted of entry.messagesDeleted ?? []) {
          store.deleteMessage(accountId, deleted.message.id);
          addedIds.delete(deleted.message.id);
        }
        for (const change of entry.labelsAdded ?? []) {
          store.applyLabelChange(accountId, change.message.id, change.labelIds, []);
        }
        for (const change of entry.labelsRemoved ?? []) {
          store.applyLabelChange(accountId, change.message.id, [], change.labelIds);
        }
      }

      pageToken = page.nextPageToken;
    } while (pageToken);
  } catch (err) {
    // Gmail purges history older than ~1 week; fall back to a full resync.
    if (isHistoryExpiredError(err)) {
      logger.info("mail-sync", `history expired for ${accountId}; running full sync`);
      await fullSync(accountId);
      return;
    }
    throw err;
  }

  const ids = [...addedIds];
  if (ids.length > 0) {
    const summaries = await fetchMetadataForIds(accountId, ids);
    store.upsertMessages(accountId, summaries);
    update(accountId, { synced: summaries.length });
  }

  store.setSyncState(accountId, { historyId: latestHistoryId });
}
