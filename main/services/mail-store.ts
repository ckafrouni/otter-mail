/**
 * mail-store.ts
 *
 * Local-first mail cache backed by the built-in `node:sqlite` module
 * (Node 24+, ships with Glaze — no native bindings to bundle).
 *
 * Stores message metadata, lazily-fetched full bodies, labels, and a
 * per-account sync cursor so the UI renders instantly from disk and Gmail
 * is only hit to refresh in the background.
 *
 * DB file: userData/mail-cache.db
 */

import path from "path";
import { DatabaseSync } from "node:sqlite";
import { app } from "@glaze/core/backend";
import type { GmailLabel, GmailMessageSummary, GmailMessageDetail } from "../gmail/types.js";

// ── DB bootstrap ────────────────────────────────────────────────────────────

let db: DatabaseSync | null = null;

function getDb(): DatabaseSync {
  if (db) return db;

  const dbPath = path.join(app.getPath("userData"), "mail-cache.db");
  const handle = new DatabaseSync(dbPath);
  handle.exec("PRAGMA journal_mode = WAL;");
  handle.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      accountId      TEXT NOT NULL,
      id             TEXT NOT NULL,
      threadId       TEXT NOT NULL DEFAULT '',
      fromName       TEXT NOT NULL DEFAULT '',
      fromEmail      TEXT NOT NULL DEFAULT '',
      toField        TEXT NOT NULL DEFAULT '',
      subject        TEXT NOT NULL DEFAULT '',
      snippet        TEXT NOT NULL DEFAULT '',
      date           INTEGER NOT NULL DEFAULT 0,
      unread         INTEGER NOT NULL DEFAULT 0,
      starred        INTEGER NOT NULL DEFAULT 0,
      hasAttachments INTEGER NOT NULL DEFAULT 0,
      labelIds       TEXT NOT NULL DEFAULT '[]',
      cc             TEXT,
      bodyHtml       TEXT,
      bodyText       TEXT,
      attachments    TEXT,
      detailFetched  INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (accountId, id)
    );
    CREATE INDEX IF NOT EXISTS idx_messages_account_date ON messages (accountId, date DESC);

    CREATE TABLE IF NOT EXISTS message_labels (
      accountId TEXT NOT NULL,
      messageId TEXT NOT NULL,
      labelId   TEXT NOT NULL,
      PRIMARY KEY (accountId, messageId, labelId)
    );
    CREATE INDEX IF NOT EXISTS idx_mlabels_lookup ON message_labels (accountId, labelId, messageId);

    CREATE TABLE IF NOT EXISTS labels (
      accountId TEXT NOT NULL,
      id        TEXT NOT NULL,
      name      TEXT NOT NULL,
      type      TEXT NOT NULL,
      unread    INTEGER,
      total     INTEGER,
      bgColor   TEXT,
      textColor TEXT,
      PRIMARY KEY (accountId, id)
    );

    CREATE TABLE IF NOT EXISTS sync_state (
      accountId    TEXT PRIMARY KEY,
      historyId    TEXT,
      fullSyncDone INTEGER NOT NULL DEFAULT 0,
      lastSyncAt   INTEGER
    );
  `);

  db = handle;
  return handle;
}

// ── Row mapping ───────────────────────────────────────────────────────────────

interface MessageRow {
  accountId: string;
  id: string;
  threadId: string;
  fromName: string;
  fromEmail: string;
  toField: string;
  subject: string;
  snippet: string;
  date: number;
  unread: number;
  starred: number;
  hasAttachments: number;
  labelIds: string;
  cc: string | null;
  bodyHtml: string | null;
  bodyText: string | null;
  attachments: string | null;
  detailFetched: number;
}

function parseLabelIds(json: string): string[] {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

function rowToSummary(row: MessageRow): GmailMessageSummary {
  return {
    id: row.id,
    accountId: row.accountId,
    threadId: row.threadId,
    fromName: row.fromName,
    fromEmail: row.fromEmail,
    to: row.toField,
    subject: row.subject,
    snippet: row.snippet,
    date: row.date,
    unread: row.unread === 1,
    starred: row.starred === 1,
    labelIds: parseLabelIds(row.labelIds),
    hasAttachments: row.hasAttachments === 1,
  };
}

function rowToDetail(row: MessageRow): GmailMessageDetail {
  let attachments: GmailMessageDetail["attachments"] = [];
  if (row.attachments) {
    try {
      attachments = JSON.parse(row.attachments) as GmailMessageDetail["attachments"];
    } catch {
      attachments = [];
    }
  }
  return {
    ...rowToSummary(row),
    cc: row.cc ?? undefined,
    bodyHtml: row.bodyHtml,
    bodyText: row.bodyText,
    attachments,
  };
}

// ── Messages: writes ────────────────────────────────────────────────────────

export function upsertMessages(accountId: string, messages: GmailMessageSummary[]): void {
  if (messages.length === 0) return;
  const d = getDb();

  // hasAttachments from a list response is always false; never clobber a `true`
  // already established by a full-message fetch.
  const upsert = d.prepare(`
    INSERT INTO messages
      (accountId, id, threadId, fromName, fromEmail, toField, subject, snippet, date, unread, starred, hasAttachments, labelIds)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(accountId, id) DO UPDATE SET
      threadId       = excluded.threadId,
      fromName       = excluded.fromName,
      fromEmail      = excluded.fromEmail,
      toField        = excluded.toField,
      subject        = excluded.subject,
      snippet        = excluded.snippet,
      date           = excluded.date,
      unread         = excluded.unread,
      starred        = excluded.starred,
      labelIds       = excluded.labelIds,
      hasAttachments = CASE WHEN excluded.hasAttachments = 1 THEN 1 ELSE messages.hasAttachments END
  `);
  const delLabels = d.prepare("DELETE FROM message_labels WHERE accountId = ? AND messageId = ?");
  const insLabel = d.prepare(
    "INSERT OR IGNORE INTO message_labels (accountId, messageId, labelId) VALUES (?, ?, ?)",
  );

  d.exec("BEGIN");
  try {
    for (const m of messages) {
      upsert.run(
        accountId,
        m.id,
        m.threadId,
        m.fromName,
        m.fromEmail,
        m.to,
        m.subject,
        m.snippet,
        m.date,
        m.unread ? 1 : 0,
        m.starred ? 1 : 0,
        m.hasAttachments ? 1 : 0,
        JSON.stringify(m.labelIds),
      );
      delLabels.run(accountId, m.id);
      for (const lid of m.labelIds) insLabel.run(accountId, m.id, lid);
    }
    d.exec("COMMIT");
  } catch (err) {
    d.exec("ROLLBACK");
    throw err;
  }
}

export function upsertMessageDetail(accountId: string, detail: GmailMessageDetail): void {
  // Refresh metadata + labels first, then attach the body/attachments.
  upsertMessages(accountId, [detail]);
  const d = getDb();
  d.prepare(`
    UPDATE messages
       SET cc = ?, bodyHtml = ?, bodyText = ?, attachments = ?, hasAttachments = ?, detailFetched = 1
     WHERE accountId = ? AND id = ?
  `).run(
    detail.cc ?? null,
    detail.bodyHtml,
    detail.bodyText,
    JSON.stringify(detail.attachments),
    detail.hasAttachments ? 1 : 0,
    accountId,
    detail.id,
  );
}

export function deleteMessage(accountId: string, messageId: string): void {
  const d = getDb();
  d.exec("BEGIN");
  try {
    d.prepare("DELETE FROM messages WHERE accountId = ? AND id = ?").run(accountId, messageId);
    d.prepare("DELETE FROM message_labels WHERE accountId = ? AND messageId = ?").run(
      accountId,
      messageId,
    );
    d.exec("COMMIT");
  } catch (err) {
    d.exec("ROLLBACK");
    throw err;
  }
}

/** Apply an optimistic label add/remove to a locally-cached message. */
export function applyLabelChange(
  accountId: string,
  messageId: string,
  addLabelIds: string[],
  removeLabelIds: string[],
): void {
  const d = getDb();
  const exists = d
    .prepare("SELECT 1 FROM messages WHERE accountId = ? AND id = ?")
    .get(accountId, messageId);
  if (!exists) return;

  d.exec("BEGIN");
  try {
    for (const lid of removeLabelIds) {
      d.prepare(
        "DELETE FROM message_labels WHERE accountId = ? AND messageId = ? AND labelId = ?",
      ).run(accountId, messageId, lid);
    }
    for (const lid of addLabelIds) {
      d.prepare(
        "INSERT OR IGNORE INTO message_labels (accountId, messageId, labelId) VALUES (?, ?, ?)",
      ).run(accountId, messageId, lid);
    }
    const labelRows = d
      .prepare("SELECT labelId FROM message_labels WHERE accountId = ? AND messageId = ?")
      .all(accountId, messageId) as unknown as { labelId: string }[];
    const labelIds = labelRows.map((r) => r.labelId);
    d.prepare(
      "UPDATE messages SET labelIds = ?, unread = ?, starred = ? WHERE accountId = ? AND id = ?",
    ).run(
      JSON.stringify(labelIds),
      labelIds.includes("UNREAD") ? 1 : 0,
      labelIds.includes("STARRED") ? 1 : 0,
      accountId,
      messageId,
    );
    d.exec("COMMIT");
  } catch (err) {
    d.exec("ROLLBACK");
    throw err;
  }
}

// ── Messages: reads ───────────────────────────────────────────────────────────

export function getMessagesPage(
  accountId: string,
  labelId: string,
  offset: number,
  limit: number,
): { messages: GmailMessageSummary[]; hasMore: boolean } {
  const d = getDb();
  const rows = d
    .prepare(`
      SELECT m.* FROM messages m
        JOIN message_labels ml
          ON ml.accountId = m.accountId AND ml.messageId = m.id
       WHERE m.accountId = ? AND ml.labelId = ?
       ORDER BY m.date DESC
       LIMIT ? OFFSET ?
    `)
    .all(accountId, labelId, limit + 1, offset) as unknown as MessageRow[];

  const hasMore = rows.length > limit;
  return { messages: rows.slice(0, limit).map(rowToSummary), hasMore };
}

export function getMessageDetail(accountId: string, messageId: string): GmailMessageDetail | null {
  const d = getDb();
  const row = d
    .prepare("SELECT * FROM messages WHERE accountId = ? AND id = ?")
    .get(accountId, messageId) as unknown as MessageRow | undefined;
  if (!row || row.detailFetched !== 1) return null;
  return rowToDetail(row);
}

/** Ids of messages whose full body hasn't been downloaded yet (newest first). */
export function getUndownloadedMessageIds(accountId: string): string[] {
  const d = getDb();
  const rows = d
    .prepare(
      "SELECT id FROM messages WHERE accountId = ? AND detailFetched = 0 ORDER BY date DESC",
    )
    .all(accountId) as unknown as { id: string }[];
  return rows.map((r) => r.id);
}

export function countMessagesForLabel(accountId: string, labelId: string): number {
  const d = getDb();
  const row = d
    .prepare(
      "SELECT COUNT(*) AS n FROM message_labels WHERE accountId = ? AND labelId = ?",
    )
    .get(accountId, labelId) as unknown as { n: number };
  return row?.n ?? 0;
}

// ── Combined (cross-account) reads ──────────────────────────────────────────

export interface LabelSelection {
  accountId: string;
  labelId: string;
}

/**
 * Combined-view query: unions messages matching any of the given
 * (accountId, labelId) selections. Each selection is scoped to one account and
 * one exact label id — so the same label *name* in two accounts is two distinct
 * selections, giving the user per-account control.
 */
export function getCombinedMessagesBySelections(
  selections: LabelSelection[],
  offset: number,
  limit: number,
): { messages: GmailMessageSummary[]; hasMore: boolean } {
  if (selections.length === 0) return { messages: [], hasMore: false };
  const d = getDb();
  const clause = selections
    .map(() => "(ml.accountId = ? AND ml.labelId = ?)")
    .join(" OR ");
  const params: (string | number)[] = [];
  for (const sel of selections) params.push(sel.accountId, sel.labelId);
  params.push(limit + 1, offset);

  const rows = d
    .prepare(`
      SELECT DISTINCT m.* FROM messages m
        JOIN message_labels ml
          ON ml.accountId = m.accountId AND ml.messageId = m.id
       WHERE ${clause}
       ORDER BY m.date DESC
       LIMIT ? OFFSET ?
    `)
    .all(...params) as unknown as MessageRow[];

  const hasMore = rows.length > limit;
  return { messages: rows.slice(0, limit).map(rowToSummary), hasMore };
}

// ── Labels ──────────────────────────────────────────────────────────────────

export function upsertLabels(accountId: string, labels: GmailLabel[]): void {
  const d = getDb();
  d.exec("BEGIN");
  try {
    d.prepare("DELETE FROM labels WHERE accountId = ?").run(accountId);
    const ins = d.prepare(`
      INSERT INTO labels (accountId, id, name, type, unread, total, bgColor, textColor)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const l of labels) {
      ins.run(
        accountId,
        l.id,
        l.name,
        l.type,
        l.unread ?? null,
        l.total ?? null,
        l.color?.backgroundColor ?? null,
        l.color?.textColor ?? null,
      );
    }
    d.exec("COMMIT");
  } catch (err) {
    d.exec("ROLLBACK");
    throw err;
  }
}

interface LabelRow {
  id: string;
  name: string;
  type: string;
  unread: number | null;
  total: number | null;
  bgColor: string | null;
  textColor: string | null;
}

export function getLabels(accountId: string): GmailLabel[] {
  const d = getDb();
  const rows = d
    .prepare("SELECT * FROM labels WHERE accountId = ?")
    .all(accountId) as unknown as LabelRow[];
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    type: r.type === "system" ? "system" : "user",
    unread: r.unread ?? undefined,
    total: r.total ?? undefined,
    color:
      r.bgColor && r.textColor
        ? { backgroundColor: r.bgColor, textColor: r.textColor }
        : undefined,
  }));
}

// ── Sync state ────────────────────────────────────────────────────────────────

export interface SyncStateRow {
  historyId: string | null;
  fullSyncDone: boolean;
  lastSyncAt: number | null;
}

export function getSyncState(accountId: string): SyncStateRow {
  const d = getDb();
  const row = d
    .prepare("SELECT historyId, fullSyncDone, lastSyncAt FROM sync_state WHERE accountId = ?")
    .get(accountId) as unknown as
    | { historyId: string | null; fullSyncDone: number; lastSyncAt: number | null }
    | undefined;
  if (!row) return { historyId: null, fullSyncDone: false, lastSyncAt: null };
  return {
    historyId: row.historyId,
    fullSyncDone: row.fullSyncDone === 1,
    lastSyncAt: row.lastSyncAt,
  };
}

export function setSyncState(
  accountId: string,
  patch: Partial<SyncStateRow>,
): void {
  const d = getDb();
  const current = getSyncState(accountId);
  const next = {
    historyId: patch.historyId !== undefined ? patch.historyId : current.historyId,
    fullSyncDone:
      patch.fullSyncDone !== undefined ? patch.fullSyncDone : current.fullSyncDone,
    lastSyncAt: patch.lastSyncAt !== undefined ? patch.lastSyncAt : current.lastSyncAt,
  };
  d.prepare(`
    INSERT INTO sync_state (accountId, historyId, fullSyncDone, lastSyncAt)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(accountId) DO UPDATE SET
      historyId    = excluded.historyId,
      fullSyncDone = excluded.fullSyncDone,
      lastSyncAt   = excluded.lastSyncAt
  `).run(accountId, next.historyId, next.fullSyncDone ? 1 : 0, next.lastSyncAt);
}

// ── Account teardown ──────────────────────────────────────────────────────────

export function removeAccountData(accountId: string): void {
  const d = getDb();
  d.exec("BEGIN");
  try {
    d.prepare("DELETE FROM messages WHERE accountId = ?").run(accountId);
    d.prepare("DELETE FROM message_labels WHERE accountId = ?").run(accountId);
    d.prepare("DELETE FROM labels WHERE accountId = ?").run(accountId);
    d.prepare("DELETE FROM sync_state WHERE accountId = ?").run(accountId);
    d.exec("COMMIT");
  } catch (err) {
    d.exec("ROLLBACK");
    throw err;
  }
}
