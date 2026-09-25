/**
 * Search, Gmail's way: every query runs through Gmail's own search engine
 * (all operators, all mail, attachments and recipients included), so results
 * are the truth rather than whatever this Mac happens to have cached. Results
 * are conversations, newest first, merged across the accounts in scope; only
 * matches missing from the cache are fetched. Offline, it falls back to the
 * local index and says so.
 */

import { ipcMain, logger } from "@glaze/core/backend";
import { fetchMetadataForIds, searchGmailPage } from "../services/gmail-api.js";
import * as mailStore from "../services/mail-store.js";
import { runAsTask } from "./ipc-budget.js";
import type { GmailMessageSummary } from "../gmail/types.js";

const PAGE_SIZE = 50;

/** Per-account Gmail page cursor; null once that account has no more results. */
type Cursors = Record<string, string | null>;

type SearchResult = {
  messages: GmailMessageSummary[];
  /** Next page's cursors; undefined when every account is exhausted. */
  cursors?: Cursors;
  /** Gmail's estimate of total matches across the accounts. */
  estimate: number;
  /** Gmail was unreachable: these are local results only. */
  offline?: boolean;
};

/** One account's page: Gmail's matches, cached first, as conversation rows. */
async function searchAccount(
  accountId: string,
  q: string,
  cursor: string | undefined,
): Promise<{ rows: GmailMessageSummary[]; next: string | null; estimate: number }> {
  const page = await searchGmailPage(accountId, q, cursor, PAGE_SIZE);
  const unknown = mailStore.filterUnknownIds(
    accountId,
    page.refs.map((r) => r.id),
  );
  if (unknown.length > 0) {
    mailStore.upsertMessages(accountId, await fetchMetadataForIds(accountId, unknown));
  }
  const threadIds = [...new Set(page.refs.map((r) => r.threadId))];
  const rows = mailStore.getThreadSummaries(accountId, threadIds).map((m) => ({ ...m, accountId }));
  return { rows, next: page.nextPageToken ?? null, estimate: page.resultSizeEstimate };
}

/** Network failures (not Gmail errors) mean offline. */
function isOffline(error: unknown): boolean {
  const text = String(error);
  return /fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|network/i.test(text);
}

/** Free text of a Gmail query, for the offline fallback (operators dropped). */
function freeText(q: string): string {
  return q
    .replace(/(^|\s)-?[a-z_]+:("[^"]*"|\([^)]*\)|\S+)/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function searchGmail(
  q: string,
  accountIds: string[],
  cursors?: Cursors,
): Promise<SearchResult> {
  const active = accountIds.filter((id) => !cursors || cursors[id] !== null);
  const settled = await Promise.allSettled(
    active.map((id) => searchAccount(id, q, cursors?.[id] ?? undefined)),
  );

  const failures = settled.filter((s) => s.status === "rejected");
  if (failures.length === settled.length && failures.length > 0) {
    const reason = (failures[0] as PromiseRejectedResult).reason;
    if (!isOffline(reason)) throw reason;
    logger.info("search", "offline, using the local index", { q });
    const text = freeText(q);
    const local = text
      ? mailStore.searchMessages(text, accountIds.length === 1 ? accountIds[0] : null, 0, PAGE_SIZE)
      : { messages: [] };
    return { messages: local.messages, estimate: local.messages.length, offline: true };
  }

  const next: Cursors = { ...cursors };
  let estimate = 0;
  const rows: GmailMessageSummary[] = [];
  settled.forEach((s, i) => {
    const accountId = active[i];
    if (s.status === "fulfilled") {
      rows.push(...s.value.rows);
      next[accountId] = s.value.next;
      estimate += s.value.estimate;
    } else {
      logger.info("search", "account search failed", { accountId, error: String(s.reason) });
      next[accountId] = null;
    }
  });
  for (const id of accountIds) if (!(id in next)) next[id] = null;
  rows.sort((a, b) => b.date - a.date);
  const more = Object.values(next).some((c) => c !== null);
  return { messages: rows, cursors: more ? next : undefined, estimate };
}

export function registerSearchHandlers(): void {
  // gmail:search — Gmail's own search. Runs as a task: a cold query can fetch
  // up to 50 uncached matches per account, past the 5s IPC budget.
  ipcMain.handle("gmail:search", async (_event, params: unknown) => {
    const p = params as Record<string, unknown> | undefined;
    const q = typeof p?.q === "string" ? p.q.trim() : "";
    const accountIds = Array.isArray(p?.accountIds)
      ? p.accountIds.filter((id): id is string => typeof id === "string")
      : [];
    const cursors =
      p?.cursors && typeof p.cursors === "object" ? (p.cursors as Cursors) : undefined;
    const taskId = typeof p?.taskId === "string" ? p.taskId : undefined;
    if (!q || accountIds.length === 0) return { messages: [], estimate: 0 };
    logger.info("search", "gmail search", { accounts: accountIds.length, paged: Boolean(cursors) });
    return runAsTask(taskId, () => searchGmail(q, accountIds, cursors));
  });
}
