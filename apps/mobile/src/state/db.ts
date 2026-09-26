/**
 * The local mail cache (expo-sqlite), the phone's counterpart to the desktop's
 * mail-store.ts. Screens read it synchronously and re-read when `notify()`
 * bumps the revision; sync and actions write it, then notify.
 */

import type { GmailAccount, GmailMessageDetail } from "@otter-mail/contracts/gmail";
import * as SQLite from "expo-sqlite";
import { useSyncExternalStore } from "react";

export const db = SQLite.openDatabaseSync("otter-mail.db");

db.execSync(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    name TEXT NOT NULL,
    picture TEXT,
    added_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS threads (
    account_id TEXT NOT NULL,
    id TEXT NOT NULL,
    history_id TEXT NOT NULL,
    subject TEXT NOT NULL,
    snippet TEXT NOT NULL,
    from_name TEXT NOT NULL,
    from_email TEXT NOT NULL,
    to_addr TEXT NOT NULL,
    date INTEGER NOT NULL,
    unread INTEGER NOT NULL,
    starred INTEGER NOT NULL,
    label_ids TEXT NOT NULL,
    message_count INTEGER NOT NULL,
    -- history_id when the messages' bodies were last fetched
    bodies_history_id TEXT,
    PRIMARY KEY (account_id, id)
  );
  CREATE INDEX IF NOT EXISTS threads_by_date ON threads (date DESC);
  CREATE TABLE IF NOT EXISTS messages (
    account_id TEXT NOT NULL,
    id TEXT NOT NULL,
    thread_id TEXT NOT NULL,
    from_name TEXT NOT NULL,
    from_email TEXT NOT NULL,
    to_addr TEXT NOT NULL,
    cc TEXT,
    subject TEXT NOT NULL,
    snippet TEXT NOT NULL,
    date INTEGER NOT NULL,
    label_ids TEXT NOT NULL,
    body_html TEXT,
    body_text TEXT,
    attachments TEXT NOT NULL,
    message_id_header TEXT,
    references_header TEXT,
    PRIMARY KEY (account_id, id)
  );
  CREATE INDEX IF NOT EXISTS messages_by_thread ON messages (account_id, thread_id, date);
  CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`);

// ── Change notification ──────────────────────────────────────────────────────

let revision = 0;
const listeners = new Set<() => void>();

/** Tells mounted screens the cache changed, so their reads run again. */
export function notify(): void {
  revision++;
  for (const listener of listeners) listener();
}

/** A number that moves whenever the cache changed; use it as a memo dependency. */
export function useRevision(): number {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => revision,
  );
}

// ── Rows ─────────────────────────────────────────────────────────────────────

export type ThreadSummary = {
  accountId: string;
  id: string;
  historyId: string;
  subject: string;
  snippet: string;
  fromName: string;
  fromEmail: string;
  to: string;
  date: number;
  unread: boolean;
  starred: boolean;
  labelIds: string[];
  messageCount: number;
};

type ThreadRow = {
  account_id: string;
  id: string;
  history_id: string;
  subject: string;
  snippet: string;
  from_name: string;
  from_email: string;
  to_addr: string;
  date: number;
  unread: number;
  starred: number;
  label_ids: string;
  message_count: number;
};

const toThread = (row: ThreadRow): ThreadSummary => ({
  accountId: row.account_id,
  id: row.id,
  historyId: row.history_id,
  subject: row.subject,
  snippet: row.snippet,
  fromName: row.from_name,
  fromEmail: row.from_email,
  to: row.to_addr,
  date: row.date,
  unread: row.unread === 1,
  starred: row.starred === 1,
  labelIds: JSON.parse(row.label_ids) as string[],
  messageCount: row.message_count,
});

type MessageRow = {
  account_id: string;
  id: string;
  thread_id: string;
  from_name: string;
  from_email: string;
  to_addr: string;
  cc: string | null;
  subject: string;
  snippet: string;
  date: number;
  label_ids: string;
  body_html: string | null;
  body_text: string | null;
  attachments: string;
  message_id_header: string | null;
  references_header: string | null;
};

const toMessage = (row: MessageRow): GmailMessageDetail => {
  const labelIds = JSON.parse(row.label_ids) as string[];
  const attachments = JSON.parse(row.attachments) as GmailMessageDetail["attachments"];
  return {
    id: row.id,
    accountId: row.account_id,
    threadId: row.thread_id,
    fromName: row.from_name,
    fromEmail: row.from_email,
    to: row.to_addr,
    cc: row.cc ?? undefined,
    subject: row.subject,
    snippet: row.snippet,
    date: row.date,
    unread: labelIds.includes("UNREAD"),
    starred: labelIds.includes("STARRED"),
    labelIds,
    hasAttachments: attachments.length > 0,
    attachments,
    bodyHtml: row.body_html,
    bodyText: row.body_text,
    messageIdHeader: row.message_id_header ?? undefined,
    referencesHeader: row.references_header ?? undefined,
  };
};

// ── Accounts ─────────────────────────────────────────────────────────────────

export function listAccounts(): GmailAccount[] {
  return db
    .getAllSync<{ id: string; email: string; name: string; picture: string | null }>(
      "SELECT id, email, name, picture FROM accounts ORDER BY added_at",
    )
    .map((row) => ({ ...row, picture: row.picture ?? undefined }));
}

export function saveAccount(account: GmailAccount): void {
  db.runSync(
    `INSERT INTO accounts (id, email, name, picture, added_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET name = excluded.name, picture = excluded.picture`,
    account.id,
    account.email,
    account.name,
    account.picture ?? null,
    Date.now(),
  );
}

export function deleteAccount(accountId: string): void {
  db.withTransactionSync(() => {
    db.runSync("DELETE FROM accounts WHERE id = ?", accountId);
    db.runSync("DELETE FROM threads WHERE account_id = ?", accountId);
    db.runSync("DELETE FROM messages WHERE account_id = ?", accountId);
  });
}

// ── Threads ──────────────────────────────────────────────────────────────────

/** The SQL condition for a mailbox's threads; `label` is a Gmail label id or ALL_MAIL. */
function labelCondition(label: string): { sql: string; params: string[] } {
  const has = "EXISTS (SELECT 1 FROM json_each(threads.label_ids) WHERE value = ?)";
  if (label === "ALL_MAIL") return { sql: `NOT ${has} AND NOT ${has}`, params: ["TRASH", "SPAM"] };
  return { sql: has, params: [label] };
}

export function listThreads(scope: { accountId: string | null; label: string }): ThreadSummary[] {
  const condition = labelCondition(scope.label);
  const params: string[] = [...condition.params];
  let sql = `SELECT * FROM threads WHERE ${condition.sql}`;
  if (scope.accountId) {
    sql += " AND account_id = ?";
    params.push(scope.accountId);
  }
  return db.getAllSync<ThreadRow>(`${sql} ORDER BY date DESC`, ...params).map(toThread);
}

export function getThread(accountId: string, threadId: string): ThreadSummary | null {
  const row = db.getFirstSync<ThreadRow>(
    "SELECT * FROM threads WHERE account_id = ? AND id = ?",
    accountId,
    threadId,
  );
  return row ? toThread(row) : null;
}

export function threadIdsWithLabel(accountId: string, label: string): string[] {
  const condition = labelCondition(label);
  return db
    .getAllSync<{
      id: string;
    }>(
      `SELECT id FROM threads WHERE account_id = ? AND ${condition.sql}`,
      accountId,
      ...condition.params,
    )
    .map((row) => row.id);
}

export function cachedHistoryIds(accountId: string): Map<string, string> {
  const rows = db.getAllSync<{ id: string; history_id: string }>(
    "SELECT id, history_id FROM threads WHERE account_id = ?",
    accountId,
  );
  return new Map(rows.map((row) => [row.id, row.history_id]));
}

export function bodiesHistoryId(accountId: string, threadId: string): string | null {
  return (
    db.getFirstSync<{ bodies_history_id: string | null }>(
      "SELECT bodies_history_id FROM threads WHERE account_id = ? AND id = ?",
      accountId,
      threadId,
    )?.bodies_history_id ?? null
  );
}

export function saveThread(thread: ThreadSummary): void {
  db.runSync(
    `INSERT INTO threads (account_id, id, history_id, subject, snippet, from_name, from_email,
       to_addr, date, unread, starred, label_ids, message_count)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (account_id, id) DO UPDATE SET
       history_id = excluded.history_id, subject = excluded.subject, snippet = excluded.snippet,
       from_name = excluded.from_name, from_email = excluded.from_email, to_addr = excluded.to_addr,
       date = excluded.date, unread = excluded.unread, starred = excluded.starred,
       label_ids = excluded.label_ids, message_count = excluded.message_count`,
    thread.accountId,
    thread.id,
    thread.historyId,
    thread.subject,
    thread.snippet,
    thread.fromName,
    thread.fromEmail,
    thread.to,
    thread.date,
    thread.unread ? 1 : 0,
    thread.starred ? 1 : 0,
    JSON.stringify(thread.labelIds),
    thread.messageCount,
  );
}

export function deleteThread(accountId: string, threadId: string): void {
  db.runSync("DELETE FROM threads WHERE account_id = ? AND id = ?", accountId, threadId);
  db.runSync("DELETE FROM messages WHERE account_id = ? AND thread_id = ?", accountId, threadId);
}

/** Adds and removes labels on a cached thread and its messages (optimistic actions). */
export function relabelThread(
  accountId: string,
  threadId: string,
  change: { add?: string[]; remove?: string[] },
): void {
  const relabel = (labelIds: string[]) => [
    ...new Set([...labelIds.filter((id) => !change.remove?.includes(id)), ...(change.add ?? [])]),
  ];
  db.withTransactionSync(() => {
    const thread = getThread(accountId, threadId);
    if (thread) {
      const labelIds = relabel(thread.labelIds);
      saveThread({
        ...thread,
        labelIds,
        unread: labelIds.includes("UNREAD"),
        starred: labelIds.includes("STARRED"),
      });
    }
    for (const message of listMessages(accountId, threadId)) {
      db.runSync(
        "UPDATE messages SET label_ids = ? WHERE account_id = ? AND id = ?",
        JSON.stringify(relabel(message.labelIds)),
        accountId,
        message.id,
      );
    }
  });
}

// ── Messages ─────────────────────────────────────────────────────────────────

export function listMessages(accountId: string, threadId: string): GmailMessageDetail[] {
  return db
    .getAllSync<MessageRow>(
      "SELECT * FROM messages WHERE account_id = ? AND thread_id = ? ORDER BY date",
      accountId,
      threadId,
    )
    .map(toMessage);
}

/** Replaces a thread's cached messages with a full fetch of it. */
export function saveThreadMessages(
  accountId: string,
  threadId: string,
  historyId: string,
  messages: GmailMessageDetail[],
): void {
  db.withTransactionSync(() => {
    db.runSync("DELETE FROM messages WHERE account_id = ? AND thread_id = ?", accountId, threadId);
    for (const m of messages) {
      db.runSync(
        `INSERT INTO messages (account_id, id, thread_id, from_name, from_email, to_addr, cc,
           subject, snippet, date, label_ids, body_html, body_text, attachments,
           message_id_header, references_header)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        accountId,
        m.id,
        threadId,
        m.fromName,
        m.fromEmail,
        m.to,
        m.cc ?? null,
        m.subject,
        m.snippet,
        m.date,
        JSON.stringify(m.labelIds),
        m.bodyHtml,
        m.bodyText,
        JSON.stringify(m.attachments),
        m.messageIdHeader ?? null,
        m.referencesHeader ?? null,
      );
    }
    db.runSync(
      "UPDATE threads SET bodies_history_id = ? WHERE account_id = ? AND id = ?",
      historyId,
      accountId,
      threadId,
    );
  });
}

// ── Settings ─────────────────────────────────────────────────────────────────

export function getSetting(key: string): string | null {
  return (
    db.getFirstSync<{ value: string }>("SELECT value FROM settings WHERE key = ?", key)?.value ??
    null
  );
}

export function setSetting(key: string, value: string): void {
  db.runSync(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
    key,
    value,
  );
}
