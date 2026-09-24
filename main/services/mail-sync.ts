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

import { ipcMain, logger } from "@glaze/core/backend";
import {
  listLabels,
  getProfile,
  listMessageIdsPage,
  fetchMetadataForIds,
  getMessage,
  getAttachmentData,
  listHistory,
  isHistoryExpiredError,
} from "./gmail-api.js";
import { hasCachedAttachment } from "./attachment-cache.js";
import { listAccounts } from "./account-store.js";
import * as store from "./mail-store.js";
import { notifyNewMail, updateDockBadge } from "./notifier.js";
import type { GmailMessageSummary, SyncStatus } from "../gmail/types.js";

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

const lastFinishedAt = new Map<string, number>();
// Read-path triggers (list handlers refetching) must not restart a sync right
// after one finished: completion invalidates the renderer's queries, whose
// refetch hits those handlers again — without a cooldown that loops forever.
const READ_TRIGGER_COOLDOWN_MS = 20_000;

/** Kick off a background sync for one account (no-op if one is already running).
    Non-forced calls (read-path triggers) are skipped during the post-sync cooldown. */
export function syncAccount(accountId: string, opts?: { force?: boolean }): void {
  if (running.has(accountId)) return;
  // Re-added after removal: the old run has ended (not running), start fresh.
  removed.delete(accountId);
  if (
    !opts?.force &&
    Date.now() - (lastFinishedAt.get(accountId) ?? 0) < READ_TRIGGER_COOLDOWN_MS
  ) {
    return;
  }
  running.add(accountId);
  // Wake the renderer's idle status polls so even short syncs show up.
  ipcMain.broadcast("gmail:sync-started");
  void runSync(accountId).finally(() => {
    running.delete(accountId);
    lastFinishedAt.set(accountId, Date.now());
  });
}

/** Sync every connected account — launch, menu, and the auto timer force it. */
export async function syncAllAccounts(opts?: { force?: boolean }): Promise<void> {
  try {
    const accounts = await listAccounts();
    for (const account of accounts) syncAccount(account.id, opts);
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
    autoSyncTimer = setInterval(
      () => void syncAllAccounts({ force: true }),
      intervalSeconds * 1000,
    );
  }
  logger.info(
    "mail-sync",
    `auto-sync ${intervalSeconds > 0 ? `every ${intervalSeconds}s` : "disabled"}`,
  );
}

// ── Account removal ───────────────────────────────────────────────────────
// A sync already in flight for a removed account must not write its mail
// back into the cache: every write point checks `assertActive`, which aborts
// the run with a SyncCancelled.

const removed = new Set<string>();

class SyncCancelled extends Error {
  constructor(accountId: string) {
    super(`sync cancelled: ${accountId} was removed`);
  }
}

function assertActive(accountId: string): void {
  if (removed.has(accountId)) throw new SyncCancelled(accountId);
}

/** Stops syncing a removed account and drops its in-memory sync state. */
export function forgetAccount(accountId: string): void {
  removed.add(accountId);
  statuses.delete(accountId);
  lastFinishedAt.delete(accountId);
}

async function runSync(accountId: string): Promise<void> {
  const state = store.getSyncState(accountId);
  // Stamped as the run's START: mail arriving while a long run is busy (bodies,
  // attachments) is newer than this and still gets notified next time.
  const startedAt = Date.now();
  update(accountId, { syncing: true, error: null, synced: 0, phase: "labels" });

  try {
    // Labels first — the sidebar and message chips depend on them.
    const labels = await listLabels(accountId);
    assertActive(accountId);
    store.upsertLabels(accountId, labels);

    if (state.fullSyncDone && state.historyId) {
      const added = await incrementalSync(accountId, state.historyId);
      await notifyNewMail(accountId, added, state.lastSyncAt);
      // Accounts fully synced before spam/trash were included need a one-time
      // backfill; new accounts get them in the full sync itself.
      if (store.getKv(`spamTrashBackfilled:${accountId}`) !== "1") {
        await backfillSpamTrash(accountId);
      }
    } else {
      await fullSync(accountId);
    }

    // Download full bodies so the whole mailbox is readable offline.
    await backfillBodies(accountId);

    // Local-first drafts: warm attachment bytes so the composer opens instantly.
    await prefetchDraftAttachments(accountId);

    assertActive(accountId);
    store.setSyncState(accountId, { lastSyncAt: startedAt });
    update(accountId, {
      syncing: false,
      phase: "idle",
      lastSyncAt: startedAt,
      fullSyncDone: store.getSyncState(accountId).fullSyncDone,
    });
  } catch (err) {
    if (err instanceof SyncCancelled) {
      logger.info("mail-sync", err.message);
      return;
    }
    logger.error("mail-sync", `sync failed for ${accountId}: ${String(err)}`);
    update(accountId, { syncing: false, phase: "idle", error: String(err) });
  }

  updateDockBadge();
}

const META_CHUNK = 100;

/**
 * Whole-mailbox sync, newest first. Resumable: the Gmail page cursor and the
 * starting history id are kept in kv after every page, so a failure (rate
 * limits, sleep, quit) continues where it stopped instead of starting over.
 * Metadata is written every 100 messages so lists fill in steadily.
 *
 * First sync skips ids already cached. Refresh mode (after the history feed
 * expired) re-reads every message, and — when one run listed the whole
 * mailbox — deletes cached mail Gmail no longer has.
 */
async function fullSync(accountId: string): Promise<void> {
  const cursorKey = `fullSyncCursor:${accountId}`;
  const seedKey = `fullSyncSeed:${accountId}`;
  const refreshKey = `fullSyncRefresh:${accountId}`;
  const refresh = store.getKv(refreshKey) === "1";

  // The history cursor from BEFORE the first attempt, so the incremental pass
  // afterwards replays everything that changed while the full sync ran.
  let seedHistoryId = store.getKv(seedKey) || null;
  let total: number | null = null;
  try {
    const profile = await getProfile(accountId);
    total = profile.messagesTotal || null;
    if (!seedHistoryId) {
      seedHistoryId = profile.historyId || null;
      if (seedHistoryId) store.setKv(seedKey, seedHistoryId);
    }
  } catch {
    // keep going without a total; the seed is retried next run
  }

  let pageToken = store.getKv(cursorKey) || undefined;
  // Pruning is only safe when this run saw every id from page one.
  let listedFromStart = !pageToken;
  const seen = new Set<string>();
  let synced = store.countAllMessages(accountId);
  update(accountId, { phase: "full", synced, total });
  if (pageToken) logger.info("mail-sync", `full sync resuming for ${accountId} at ${synced}`);

  for (;;) {
    let page: Awaited<ReturnType<typeof listMessageIdsPage>>;
    try {
      page = await listMessageIdsPage(accountId, { pageToken, maxResults: 500 });
    } catch (err) {
      // A stale saved cursor: start the listing over (cached ids are skipped).
      if (pageToken && err instanceof Error && err.message.includes("Gmail API error: 400")) {
        store.setKv(cursorKey, "");
        pageToken = undefined;
        listedFromStart = true;
        seen.clear();
        continue;
      }
      throw err;
    }

    if (total === null && page.resultSizeEstimate)
      update(accountId, { total: page.resultSizeEstimate });

    for (const id of page.ids) seen.add(id);
    const fresh = refresh ? page.ids : store.filterUnknownIds(accountId, page.ids);
    for (let i = 0; i < fresh.length; i += META_CHUNK) {
      const summaries = await fetchMetadataForIds(accountId, fresh.slice(i, i + META_CHUNK));
      assertActive(accountId);
      store.upsertMessages(accountId, summaries);
      synced += summaries.length;
      update(accountId, { synced });
    }

    pageToken = page.nextPageToken;
    store.setKv(cursorKey, pageToken ?? "");
    if (!pageToken) break;
  }

  if (refresh && listedFromStart) {
    assertActive(accountId);
    const gone = store.pruneMessagesNotIn(accountId, seen);
    if (gone > 0) logger.info("mail-sync", `removed ${gone} messages deleted in Gmail`);
  }

  assertActive(accountId);
  store.setSyncState(accountId, { fullSyncDone: true, historyId: seedHistoryId });
  store.setKv(seedKey, "");
  store.setKv(refreshKey, "");
  store.setKv(`spamTrashBackfilled:${accountId}`, "1");
}

const PREFETCH_MAX_FILE_BYTES = 15 * 1024 * 1024;

/**
 * Cache the attachment bytes of every draft (drafts are few and editing one
 * re-uploads its files, so they must be in memory before the composer can
 * save). Other mail keeps fetching attachments lazily — getAttachmentData
 * write-through means anything opened once is cached from then on.
 */
async function prefetchDraftAttachments(accountId: string): Promise<void> {
  for (const id of store.getMessageIdsForLabel(accountId, "DRAFT")) {
    assertActive(accountId);
    try {
      let detail = store.getMessageDetail(accountId, id);
      if (!detail) {
        detail = await getMessage(accountId, id);
        assertActive(accountId);
        store.upsertMessageDetail(accountId, detail);
      }
      for (const att of detail.attachments) {
        if (att.size > PREFETCH_MAX_FILE_BYTES) continue;
        if (await hasCachedAttachment(accountId, id, att.id)) continue;
        await getAttachmentData(accountId, id, att.id);
      }
    } catch (err) {
      logger.info("mail-sync", `draft attachment prefetch skipped ${id}: ${String(err)}`);
    }
  }
}

async function backfillSpamTrash(accountId: string): Promise<void> {
  for (const labelId of ["SPAM", "TRASH"]) {
    let pageToken: string | undefined;
    do {
      const page = await listMessageIdsPage(accountId, { pageToken, labelIds: [labelId] });
      if (page.ids.length > 0) {
        const summaries = await fetchMetadataForIds(accountId, page.ids);
        assertActive(accountId);
        store.upsertMessages(accountId, summaries);
      }
      pageToken = page.nextPageToken;
    } while (pageToken);
  }
  store.setKv(`spamTrashBackfilled:${accountId}`, "1");
  logger.info("mail-sync", `spam/trash backfill done for ${accountId}`);
}

/**
 * Fetch and cache the full body of every message whose body isn't stored yet
 * (newest first), so the entire mailbox can be read offline. Resumable: each
 * run only touches messages still missing a body. Individual failures (e.g. a
 * message deleted since metadata sync) are skipped and retried next run.
 */
/** Bodies fetched per sync run (newest first): huge mailboxes backfill over
    several runs instead of holding the sync — and new mail — for hours. */
const BODIES_PER_RUN = 300;

async function backfillBodies(accountId: string): Promise<void> {
  const ids = store.getUndownloadedMessageIds(accountId).slice(0, BODIES_PER_RUN);
  if (ids.length === 0) return;

  update(accountId, { phase: "bodies", synced: 0, total: ids.length });

  // Full-message fetches share the per-user Gmail quota with everything else.
  const CONCURRENCY = 4;
  let done = 0;

  for (let i = 0; i < ids.length; i += CONCURRENCY) {
    // Per-message errors are skipped below, so check removal between batches.
    assertActive(accountId);
    const batch = ids.slice(i, i + CONCURRENCY);
    await Promise.all(
      batch.map(async (id) => {
        try {
          const detail = await getMessage(accountId, id);
          assertActive(accountId);
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

/** Returns the summaries of messages newly added by the history feed. */
async function incrementalSync(
  accountId: string,
  startHistoryId: string,
): Promise<GmailMessageSummary[]> {
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
          assertActive(accountId);
          store.deleteMessage(accountId, deleted.message.id);
          addedIds.delete(deleted.message.id);
        }
        for (const change of entry.labelsAdded ?? []) {
          assertActive(accountId);
          store.applyLabelChange(accountId, change.message.id, change.labelIds, []);
        }
        for (const change of entry.labelsRemoved ?? []) {
          assertActive(accountId);
          store.applyLabelChange(accountId, change.message.id, [], change.labelIds);
        }
      }

      pageToken = page.nextPageToken;
    } while (pageToken);
  } catch (err) {
    // Gmail purges history older than ~1 week; fall back to a full resync.
    if (isHistoryExpiredError(err)) {
      // Changes made while we were away can't be replayed: re-read the whole
      // mailbox (labels/read state of cached mail too) and drop deleted mail.
      // Marked durable so a long refresh resumes across runs.
      logger.info("mail-sync", `history expired for ${accountId}; refreshing the mailbox`);
      store.setKv(`fullSyncRefresh:${accountId}`, "1");
      store.setKv(`fullSyncCursor:${accountId}`, "");
      store.setKv(`fullSyncSeed:${accountId}`, "");
      assertActive(accountId);
      store.setSyncState(accountId, { fullSyncDone: false });
      await fullSync(accountId);
      return [];
    }
    throw err;
  }

  let added: GmailMessageSummary[] = [];
  const ids = [...addedIds];
  if (ids.length > 0) {
    added = await fetchMetadataForIds(accountId, ids);
    assertActive(accountId);
    store.upsertMessages(accountId, added);
    update(accountId, { synced: added.length });
  }

  assertActive(accountId);
  store.setSyncState(accountId, { historyId: latestHistoryId });
  return added;
}
