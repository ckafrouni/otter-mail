/**
 * Catching the cache up with Gmail. Screens render from SQLite right away and
 * call these to refresh: a mailbox's newest threads (and older pages on
 * demand), a thread's bodies when it opens, and search.
 */

import type { GmailMessageDetail } from "@otter-mail/contracts/gmail";

import * as api from "../gmail/api";
import { decodeEntities, getHeader, parseAddress, readPayload } from "../gmail/mime";
import * as store from "./db";
import type { MailboxLabel, MailboxScope } from "./mailboxes";

/** The next page of each account's mailbox, by `${accountId}:${label}`; absent = no more. */
const pageTokens = new Map<string, string>();

function summarize(accountId: string, raw: api.RawThread): store.ThreadSummary | null {
  const messages = raw.messages ?? [];
  const first = messages[0];
  // The row shows the newest message, but not a draft of a reply to it.
  const latest = messages.findLast((m) => !m.labelIds?.includes("DRAFT")) ?? messages.at(-1);
  if (!first || !latest) return null;
  const labelIds = [...new Set(messages.flatMap((m) => m.labelIds ?? []))];
  const from = parseAddress(getHeader(latest.payload?.headers, "From"));
  return {
    accountId,
    id: raw.id,
    historyId: raw.historyId,
    subject: getHeader(first.payload?.headers, "Subject"),
    snippet: decodeEntities(latest.snippet ?? ""),
    fromName: from.name,
    fromEmail: from.email,
    to: getHeader(latest.payload?.headers, "To"),
    date: Number(latest.internalDate ?? 0),
    unread: labelIds.includes("UNREAD"),
    starred: labelIds.includes("STARRED"),
    labelIds,
    messageCount: messages.length,
  };
}

function toDetail(accountId: string, raw: api.RawMessage): GmailMessageDetail {
  const headers = raw.payload?.headers;
  const from = parseAddress(getHeader(headers, "From"));
  const labelIds = raw.labelIds ?? [];
  const { bodyHtml, bodyText, attachments } = readPayload(raw.payload);
  return {
    id: raw.id,
    accountId,
    threadId: raw.threadId,
    fromName: from.name,
    fromEmail: from.email,
    to: getHeader(headers, "To"),
    cc: getHeader(headers, "Cc") || undefined,
    subject: getHeader(headers, "Subject"),
    snippet: decodeEntities(raw.snippet ?? ""),
    date: Number(raw.internalDate ?? 0),
    unread: labelIds.includes("UNREAD"),
    starred: labelIds.includes("STARRED"),
    labelIds,
    hasAttachments: attachments.length > 0,
    attachments,
    bodyHtml,
    bodyText,
    messageIdHeader: getHeader(headers, "Message-ID") || undefined,
    referencesHeader: getHeader(headers, "References") || undefined,
  };
}

/** Fetches these threads' headers and caches them; threads Gmail no longer has are dropped. */
async function refreshThreadHeaders(accountId: string, threadIds: string[]): Promise<void> {
  const fetched = await api.mapPool(threadIds, 6, async (id) => ({
    id,
    raw: await api.getThread(accountId, id, "metadata"),
  }));
  store.db.withTransactionSync(() => {
    for (const { id, raw } of fetched) {
      const summary = raw && summarize(accountId, raw);
      if (summary) store.saveThread(summary);
      else store.deleteThread(accountId, id);
    }
  });
}

async function syncAccountMailbox(
  accountId: string,
  label: MailboxLabel,
  more: boolean,
): Promise<void> {
  const key = `${accountId}:${label}`;
  const pageToken = pageTokens.get(key);
  if (more && !pageToken) return;

  const page = await api.listThreads(accountId, {
    labelId: label === "ALL_MAIL" ? undefined : label,
    pageToken: more ? pageToken : undefined,
  });
  if (page.nextPageToken) pageTokens.set(key, page.nextPageToken);
  else pageTokens.delete(key);

  const cached = store.cachedHistoryIds(accountId);
  await refreshThreadHeaders(
    accountId,
    page.threads.filter((t) => cached.get(t.id) !== t.historyId).map((t) => t.id),
  );
  if (more) return;

  // Cached threads that should have been on this first page but weren't were
  // archived, relabelled or deleted elsewhere: look at them again.
  const listed = new Set(page.threads.map((t) => t.id));
  const oldestListed = page.nextPageToken
    ? Math.min(...page.threads.map((t) => store.getThread(accountId, t.id)?.date ?? Infinity))
    : 0;
  const moved = store
    .threadIdsWithLabel(accountId, label)
    .filter((id) => !listed.has(id) && (store.getThread(accountId, id)?.date ?? 0) >= oldestListed);
  await refreshThreadHeaders(accountId, moved.slice(0, 50));
}

/**
 * Brings a mailbox's newest threads up to date, or with `more` fetches the
 * next older page. Resolves whether older pages remain.
 */
export async function syncMailbox(scope: MailboxScope, more = false): Promise<boolean> {
  const accountIds = scope.accountId
    ? [scope.accountId]
    : store.listAccounts().map((account) => account.id);
  const results = await Promise.allSettled(
    accountIds.map((id) => syncAccountMailbox(id, scope.label, more)),
  );
  store.notify();
  const failure = results.find((r) => r.status === "rejected");
  if (failure) throw failure.reason;
  return accountIds.some((id) => pageTokens.has(`${id}:${scope.label}`));
}

/** Whether a thread's cached bodies are missing or older than its headers. */
export function needsBodies(thread: store.ThreadSummary): boolean {
  return store.bodiesHistoryId(thread.accountId, thread.id) !== thread.historyId;
}

/** Fetches a thread in full (every message's body) into the cache. */
export async function loadThread(accountId: string, threadId: string): Promise<void> {
  const raw = await api.getThread(accountId, threadId, "full");
  const summary = raw && summarize(accountId, raw);
  if (!raw || !summary) {
    store.deleteThread(accountId, threadId);
  } else {
    store.saveThread(summary);
    store.saveThreadMessages(
      accountId,
      threadId,
      raw.historyId,
      (raw.messages ?? []).map((m) => toDetail(accountId, m)),
    );
  }
  store.notify();
}

/** Gmail search across the given accounts; results are cached like any thread. */
export async function search(
  query: string,
  accountId: string | null,
): Promise<store.ThreadSummary[]> {
  const accountIds = accountId ? [accountId] : store.listAccounts().map((a) => a.id);
  const found = await Promise.all(
    accountIds.map(async (id) => {
      const page = await api.listThreads(id, { query, maxResults: 30 });
      const cached = store.cachedHistoryIds(id);
      await refreshThreadHeaders(
        id,
        page.threads.filter((t) => cached.get(t.id) !== t.historyId).map((t) => t.id),
      );
      return page.threads.flatMap((t) => store.getThread(id, t.id) ?? []);
    }),
  );
  store.notify();
  return found.flat().sort((a, b) => b.date - a.date);
}
