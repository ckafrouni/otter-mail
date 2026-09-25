/**
 * mail-sync.ts
 *
 * Background sync engine that keeps the local SQLite cache (mail-store) in
 * step with Gmail. First run does a full-mailbox metadata sync; subsequent
 * runs use Gmail's history feed for cheap incremental deltas.
 *
 * Two independent lanes per account:
 *  - sync: history delta (or full sync), labels, draft ids. Short once the
 *    mailbox is synced, so new mail shows up every tick and the account reads
 *    as synced as soon as it finishes.
 *  - downloads: full bodies for offline reading, newest first, at the lowest
 *    quota priority. It can take a long time on a big mailbox and never holds
 *    up the sync lane or the "Syncing…" status.
 *
 * Sync is fire-and-forget; the renderer polls getSyncStatus() to show
 * progress and refreshes its views when `revision` says the cache changed.
 */

import { logger } from "../logger.js";
import { broadcast } from "../ipc.js";
import {
  listLabels,
  listLabelNames,
  getProfile,
  listMessageIdsPage,
  fetchMetadataForIds,
  getMessage,
  getAttachmentData,
  listHistory,
  isHistoryExpiredError,
  isNetworkError,
  isRateLimitError,
  listDraftIds,
  mapPool,
  GmailApiError,
} from "./gmail-api.js";
import { asBackgroundWork, asPrefetchWork, isCoolingDown } from "./gmail-quota.js";
import { hasCachedAttachment } from "./attachment-cache.js";
import { listAccounts } from "./account-store.js";
import { isSignedIn, SIGNED_OUT_MESSAGE } from "./gmail-oauth.js";
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
    download: null,
    revision: 0,
  };
  statuses.set(accountId, status);
  return status;
}

function update(accountId: string, patch: Partial<SyncStatus>): void {
  Object.assign(ensureStatus(accountId), patch);
}

/** The cache changed in a way lists show: the renderer refetches on a new revision. */
function bumpRevision(accountId: string): void {
  const status = ensureStatus(accountId);
  status.revision += 1;
}

export function getSyncStatus(accountId: string): SyncStatus {
  const status = ensureStatus(accountId);
  return { ...status, download: status.download ? { ...status.download } : null };
}

const lastFinishedAt = new Map<string, number>();
// Read-path triggers (list handlers refetching) must not restart a sync right
// after one finished: completion invalidates the renderer's queries, whose
// refetch hits those handlers again — without a cooldown that loops forever.
const READ_TRIGGER_COOLDOWN_MS = 20_000;

// ── Failure backoff ──────────────────────────────────────────────────────
// A failing account (offline, revoked sign-in, Gmail rate limits) is retried
// on a growing delay instead of on every timer tick and list refetch. Asking
// explicitly (Sync button, menu, switching to the account) always runs.

const BACKOFF_BASE_MS = 30_000;
const BACKOFF_MAX_MS = 10 * 60_000;
const failures = new Map<string, { count: number; retryAt: number }>();
/** A sync was requested while one ran: run once more when it ends. */
const rerun = new Set<string>();

function recordFailure(accountId: string): void {
  const count = (failures.get(accountId)?.count ?? 0) + 1;
  const delay = Math.min(BACKOFF_BASE_MS * 2 ** (count - 1), BACKOFF_MAX_MS);
  failures.set(accountId, { count, retryAt: Date.now() + delay });
}

/**
 * Kick off a background sync for one account (no-op if one is already running).
 * `force` skips the post-sync cooldown (launch, timer, user); non-forced calls
 * are read-path triggers. `trigger: "timer"` still respects failure backoff,
 * which only an explicit request (`force` without a trigger) skips.
 */
export function syncAccount(
  accountId: string,
  opts?: { force?: boolean; trigger?: "timer" },
): void {
  const explicit = opts?.force === true && opts.trigger !== "timer";
  if (running.has(accountId)) {
    if (explicit) rerun.add(accountId);
    return;
  }
  // Re-added after removal: the old run has ended (not running), start fresh.
  removed.delete(accountId);
  // Nothing to sync with until the account signs in again (Settings → Accounts).
  if (!isSignedIn(accountId)) {
    update(accountId, { syncing: false, error: SIGNED_OUT_MESSAGE });
    return;
  }
  if (!explicit && Date.now() < (failures.get(accountId)?.retryAt ?? 0)) return;
  if (
    !opts?.force &&
    Date.now() - (lastFinishedAt.get(accountId) ?? 0) < READ_TRIGGER_COOLDOWN_MS
  ) {
    return;
  }
  running.add(accountId);
  // Wake the renderer's idle status polls so even short syncs show up.
  broadcast("gmail:sync-started");
  void runSync(accountId).finally(() => {
    running.delete(accountId);
    lastFinishedAt.set(accountId, Date.now());
    if (rerun.delete(accountId) && !removed.has(accountId)) {
      syncAccount(accountId, { force: true });
    }
  });
}

/** Sync every connected account — launch, menu, and the auto timer force it. */
export async function syncAllAccounts(opts?: {
  force?: boolean;
  trigger?: "timer";
}): Promise<void> {
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
      () => void syncAllAccounts({ force: true, trigger: "timer" }),
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
  failures.delete(accountId);
  rerun.delete(accountId);
  labelRefresh.delete(accountId);
  draftCheckAt.delete(accountId);
}

/** A short, readable reason for the status line (Gmail errors carry whole JSON bodies). */
function describeSyncError(err: unknown): string {
  if (isRateLimitError(err)) return "Gmail is limiting requests right now — retrying shortly";
  if (isNetworkError(err)) return "Can't reach Gmail — retrying when the connection is back";
  const text = String(err);
  if (text.includes(SIGNED_OUT_MESSAGE) || text.includes("Google sign-in expired")) {
    return SIGNED_OUT_MESSAGE;
  }
  if (err instanceof GmailApiError) {
    if (err.status === 401) {
      return "Gmail rejected this account's sign-in — try removing and re-adding it";
    }
    if (err.status >= 500) return "Gmail is having trouble right now — retrying shortly";
    let detail = "";
    try {
      detail = (JSON.parse(err.body) as { error?: { message?: string } }).error?.message ?? "";
    } catch {
      // not JSON: fall back to the status alone
    }
    return `Gmail error ${err.status}${detail ? `: ${detail.slice(0, 160)}` : ""}`;
  }
  return text.length > 240 ? `${text.slice(0, 240)}…` : text;
}

/** A sync run is background work: it only spends Gmail quota the user isn't using. */
function runSync(accountId: string): Promise<void> {
  return asBackgroundWork(() => runSyncNow(accountId));
}

async function runSyncNow(accountId: string): Promise<void> {
  const state = store.getSyncState(accountId);
  // Stamped as the run's START: mail arriving while the run is busy is newer
  // than this and still gets notified next time.
  const startedAt = Date.now();
  const incremental = state.fullSyncDone && state.historyId !== null;
  update(accountId, {
    syncing: true,
    error: null,
    synced: 0,
    total: null,
    phase: incremental ? "incremental" : "labels",
  });

  try {
    let mailChanged = true;
    if (incremental && state.historyId) {
      const delta = await incrementalSync(accountId, state.historyId);
      mailChanged = delta.changed;
      if (await refreshLabels(accountId, mailChanged)) bumpRevision(accountId);
      await notifyNewMail(accountId, delta.added, state.lastSyncAt);
      // Accounts fully synced before spam/trash were included need a one-time
      // backfill; new accounts get them in the full sync itself.
      if (store.getKv(`spamTrashBackfilled:${accountId}`) !== "1") {
        await backfillSpamTrash(accountId);
      }
    } else {
      // Labels first — the sidebar and message chips depend on them.
      if (await refreshLabels(accountId, true)) bumpRevision(accountId);
      await fullSync(accountId);
    }

    // Local-first drafts: know every draft's id, so opening one needs no
    // Gmail round trip.
    await learnDraftIds(accountId, mailChanged);

    assertActive(accountId);
    store.setSyncState(accountId, { lastSyncAt: startedAt });
    failures.delete(accountId);
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
    recordFailure(accountId);
    logger.error("mail-sync", `sync failed for ${accountId}: ${describeSyncError(err)}`);
    update(accountId, { syncing: false, phase: "idle", error: describeSyncError(err) });
  }

  updateDockBadge();
  // Offline bodies download in their own lane, after the mailbox is current.
  startDownloads(accountId);
}

// ── Labels ───────────────────────────────────────────────────────────────
// labels.get per label (names, colors, Gmail's counts) is ~30 requests per
// account — too much for every 30s tick. Each tick does one labels.list to
// catch labels created/renamed/deleted elsewhere; the per-label detail is
// re-read when mail changed (at most once a minute) and every 10 minutes.
// Between detail reads, applyHistoryChanges keeps counts current locally.

const LABEL_DETAIL_MIN_GAP_MS = 60_000;
const LABEL_DETAIL_MAX_AGE_MS = 10 * 60_000;
const labelRefresh = new Map<string, { refreshedAt: number; dirty: boolean }>();

/** Refreshes the cached labels when due. Returns whether they were rewritten. */
async function refreshLabels(accountId: string, mailChanged: boolean): Promise<boolean> {
  let state = labelRefresh.get(accountId);
  if (!state) {
    state = { refreshedAt: 0, dirty: true };
    labelRefresh.set(accountId, state);
  }
  if (mailChanged) state.dirty = true;
  const age = Date.now() - state.refreshedAt;
  let due = age > LABEL_DETAIL_MAX_AGE_MS || (state.dirty && age > LABEL_DETAIL_MIN_GAP_MS);
  if (!due) {
    const names = await listLabelNames(accountId);
    const cached = new Map(store.getLabels(accountId).map((l) => [l.id, l.name]));
    due = names.length !== cached.size || names.some((l) => cached.get(l.id) !== l.name);
  }
  if (!due) return false;
  const labels = await listLabels(accountId);
  assertActive(accountId);
  store.upsertLabels(accountId, labels);
  state.refreshedAt = Date.now();
  state.dirty = false;
  return true;
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
      bumpRevision(accountId);
    }

    pageToken = page.nextPageToken;
    store.setKv(cursorKey, pageToken ?? "");
    if (!pageToken) break;
  }

  if (refresh && listedFromStart) {
    assertActive(accountId);
    const gone = store.pruneMessagesNotIn(accountId, seen);
    if (gone > 0) {
      logger.info("mail-sync", `removed ${gone} messages deleted in Gmail`);
      bumpRevision(accountId);
    }
  }

  assertActive(accountId);
  store.setSyncState(accountId, { fullSyncDone: true, historyId: seedHistoryId });
  store.setKv(seedKey, "");
  store.setKv(refreshKey, "");
  store.setKv(`spamTrashBackfilled:${accountId}`, "1");
}

/** Draft ids are re-checked when mail changed, else at most this often. */
const DRAFT_CHECK_MAX_AGE_MS = 10 * 60_000;
const draftCheckAt = new Map<string, number>();

/**
 * One cheap drafts.list: records each cached draft's id (opening a draft then
 * needs no Gmail lookup) and removes stale local draft rows — every draft
 * edit mints a new message id, so older copies (and drafts sent or deleted
 * elsewhere) would otherwise linger in Drafts and its count. Runs when the
 * history feed reported changes (drafts show up there) or every 10 minutes.
 */
async function learnDraftIds(accountId: string, mailChanged: boolean): Promise<void> {
  if (!mailChanged && Date.now() - (draftCheckAt.get(accountId) ?? 0) < DRAFT_CHECK_MAX_AGE_MS) {
    return;
  }
  const local = store.getMessageIdsForLabel(accountId, "DRAFT");
  if (local.length === 0) return;
  try {
    const listedAt = Date.now();
    const drafts = await listDraftIds(accountId);
    assertActive(accountId);
    draftCheckAt.set(accountId, listedAt);
    for (const d of drafts) store.setDraftId(accountId, d.messageId, d.draftId);
    // Only prune against a complete list (listDraftIds stops at 500).
    if (drafts.length < 500) {
      // Rows saved around the listing (a composer autosaving right now) may be
      // newer than it — leave anything from the last minute alone.
      const current = new Set(drafts.map((d) => d.messageId));
      const stale = store
        .getMessageDates(accountId, local)
        .filter((m) => !current.has(m.id) && m.date < listedAt - 60_000)
        .map((m) => m.id);
      for (const id of stale) store.deleteMessage(accountId, id);
      if (stale.length > 0) {
        logger.info("mail-sync", `removed ${stale.length} stale draft rows`);
        bumpRevision(accountId);
      }
    }
  } catch (err) {
    if (err instanceof SyncCancelled) throw err;
    logger.info("mail-sync", `draft id refresh skipped: ${describeSyncError(err)}`);
  }
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
      if (err instanceof SyncCancelled) throw err;
      logger.info(
        "mail-sync",
        `draft attachment prefetch skipped ${id}: ${describeSyncError(err)}`,
      );
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
        bumpRevision(accountId);
      }
      pageToken = page.nextPageToken;
    } while (pageToken);
  }
  store.setKv(`spamTrashBackfilled:${accountId}`, "1");
  logger.info("mail-sync", `spam/trash backfill done for ${accountId}`);
}

// ── Offline downloads ────────────────────────────────────────────────────
// Full bodies for every message, newest first, so the whole mailbox reads
// offline. Runs as prefetch work (after the user and sync in the quota
// queue), in its own lane: a big backlog takes a while and must not keep the
// account "syncing" or delay new mail. A pass stops when Gmail pushes back
// (rate limit, offline) and the next sync starts a new one.

const downloading = new Set<string>();
const DOWNLOAD_CHUNK = 60;
const DOWNLOAD_CONCURRENCY = 6;

function startDownloads(accountId: string): void {
  if (downloading.has(accountId) || removed.has(accountId)) return;
  downloading.add(accountId);
  void asPrefetchWork(() => downloadBodies(accountId))
    .catch((err: unknown) => {
      if (err instanceof SyncCancelled) return;
      logger.info(
        "mail-sync",
        `offline download paused for ${accountId}: ${describeSyncError(err)}`,
      );
    })
    .finally(() => {
      downloading.delete(accountId);
      if (statuses.has(accountId)) update(accountId, { download: null });
    });
}

async function downloadBodies(accountId: string): Promise<void> {
  const total = store.countUndownloaded(accountId);
  if (total > 0) {
    let done = 0;
    const attempted = new Set<string>();
    update(accountId, { download: { done, total } });
    for (;;) {
      assertActive(accountId);
      if (isCoolingDown(accountId)) break;
      const ids = store
        .getUndownloadedMessageIds(accountId, DOWNLOAD_CHUNK)
        .filter((id) => !attempted.has(id));
      if (ids.length === 0) break;
      let pushedBack = false;
      await mapPool(ids, DOWNLOAD_CONCURRENCY, async (id) => {
        if (pushedBack || removed.has(accountId)) return;
        attempted.add(id);
        try {
          const detail = await getMessage(accountId, id);
          assertActive(accountId);
          store.upsertMessageDetail(accountId, detail);
        } catch (err) {
          if (err instanceof SyncCancelled) throw err;
          if (isRateLimitError(err) || isNetworkError(err)) {
            // Not the message's fault: leave it queued and end this pass.
            attempted.delete(id);
            pushedBack = true;
          } else if (err instanceof GmailApiError && err.status === 404) {
            // Deleted in Gmail since it was listed (sync may have dropped it already).
            if (store.deleteMessage(accountId, id)) bumpRevision(accountId);
          } else {
            logger.info("mail-sync", `body fetch failed for ${id}: ${describeSyncError(err)}`);
            store.markBodyFetchFailed(accountId, id);
          }
        }
        done += 1;
        update(accountId, { download: { done: Math.min(done, total), total } });
      });
      if (pushedBack) break;
    }
  }

  // Drafts' attachment bytes must be in memory before the composer can save.
  await prefetchDraftAttachments(accountId);
}

/**
 * Replays the history feed since `startHistoryId`. All pages are read before
 * anything is written, so a failure mid-feed leaves the cursor and cache
 * untouched and the next run replays the same delta. Returns the summaries of
 * newly added messages and whether anything changed.
 */
async function incrementalSync(
  accountId: string,
  startHistoryId: string,
): Promise<{ added: GmailMessageSummary[]; changed: boolean }> {
  update(accountId, { phase: "incremental", synced: 0 });

  const addedIds = new Set<string>();
  const ops: store.HistoryOp[] = [];
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
          ops.push({ kind: "deleted", id: deleted.message.id });
          addedIds.delete(deleted.message.id);
        }
        for (const change of entry.labelsAdded ?? []) {
          ops.push({ kind: "labelsAdded", id: change.message.id, labelIds: change.labelIds });
        }
        for (const change of entry.labelsRemoved ?? []) {
          ops.push({ kind: "labelsRemoved", id: change.message.id, labelIds: change.labelIds });
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
      return { added: [], changed: true };
    }
    throw err;
  }

  assertActive(accountId);
  const { unknownIds } = store.applyHistoryChanges(accountId, ops);

  // New mail, plus mail the feed changed that the cache never got (an
  // earlier run missed it): both are fetched and stored with current labels.
  const ids = [...new Set([...addedIds, ...unknownIds])];
  let added: GmailMessageSummary[] = [];
  if (ids.length > 0) {
    const summaries = await fetchMetadataForIds(accountId, ids);
    assertActive(accountId);
    store.upsertMessages(accountId, summaries);
    store.recountLabels(
      accountId,
      summaries.flatMap((m) => m.labelIds),
    );
    added = summaries.filter((m) => addedIds.has(m.id));
    update(accountId, { synced: summaries.length });
  }

  const changed = ops.length > 0 || ids.length > 0;
  if (changed) bumpRevision(accountId);
  store.setSyncState(accountId, { historyId: latestHistoryId });
  return { added, changed };
}
