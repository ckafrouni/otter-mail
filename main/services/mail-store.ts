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
import type {
  GmailLabel,
  GmailMessageSummary,
  GmailMessageDetail,
  ViewRule,
  ContactSuggestion,
} from "../gmail/types.js";

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
    CREATE INDEX IF NOT EXISTS idx_messages_account_thread ON messages (accountId, threadId, date);

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

    CREATE TABLE IF NOT EXISTS kv (
      key   TEXT PRIMARY KEY,
      value TEXT
    );
  `);

  // Legacy rows synced before threading behave as single-message threads.
  handle.exec("UPDATE messages SET threadId = id WHERE threadId = '';");

  // Reply-threading headers, added after the initial schema shipped.
  const messageCols = new Set(
    (
      handle.prepare("SELECT name FROM pragma_table_info('messages')").all() as unknown as {
        name: string;
      }[]
    ).map((c) => c.name),
  );
  if (!messageCols.has("messageIdHeader")) {
    handle.exec("ALTER TABLE messages ADD COLUMN messageIdHeader TEXT;");
  }
  if (!messageCols.has("referencesHeader")) {
    handle.exec("ALTER TABLE messages ADD COLUMN referencesHeader TEXT;");
  }

  // Full-text search: external-content FTS5 over messages, kept in sync via
  // triggers. On first creation, rebuild indexes every already-cached row.
  const ftsExists =
    handle
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'messages_fts'")
      .get() !== undefined;
  if (!ftsExists) {
    handle.exec(`
      CREATE VIRTUAL TABLE messages_fts USING fts5(
        subject, fromName, fromEmail, snippet, bodyText,
        content='messages', content_rowid='rowid'
      );
    `);
  }
  handle.exec(`
    CREATE TRIGGER IF NOT EXISTS messages_fts_ai AFTER INSERT ON messages BEGIN
      INSERT INTO messages_fts(rowid, subject, fromName, fromEmail, snippet, bodyText)
      VALUES (new.rowid, new.subject, new.fromName, new.fromEmail, new.snippet, new.bodyText);
    END;
    CREATE TRIGGER IF NOT EXISTS messages_fts_ad AFTER DELETE ON messages BEGIN
      INSERT INTO messages_fts(messages_fts, rowid, subject, fromName, fromEmail, snippet, bodyText)
      VALUES ('delete', old.rowid, old.subject, old.fromName, old.fromEmail, old.snippet, old.bodyText);
    END;
    CREATE TRIGGER IF NOT EXISTS messages_fts_au
      AFTER UPDATE OF subject, fromName, fromEmail, snippet, bodyText ON messages
    BEGIN
      INSERT INTO messages_fts(messages_fts, rowid, subject, fromName, fromEmail, snippet, bodyText)
      VALUES ('delete', old.rowid, old.subject, old.fromName, old.fromEmail, old.snippet, old.bodyText);
      INSERT INTO messages_fts(rowid, subject, fromName, fromEmail, snippet, bodyText)
      VALUES (new.rowid, new.subject, new.fromName, new.fromEmail, new.snippet, new.bodyText);
    END;
  `);
  if (!ftsExists) {
    handle.exec("INSERT INTO messages_fts(messages_fts) VALUES('rebuild');");
  }

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
  messageIdHeader: string | null;
  referencesHeader: string | null;
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

interface ThreadRow extends MessageRow {
  threadCount: number;
  threadUnread: number;
  threadStarred: number;
}

function rowToThreadSummary(row: ThreadRow): GmailMessageSummary {
  return {
    ...rowToSummary(row),
    threadCount: row.threadCount,
    threadUnread: row.threadUnread === 1,
    threadStarred: row.threadStarred === 1,
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
      (accountId, id, threadId, fromName, fromEmail, toField, subject, snippet, date, unread, starred, hasAttachments, labelIds, messageIdHeader, referencesHeader)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      hasAttachments = CASE WHEN excluded.hasAttachments = 1 THEN 1 ELSE messages.hasAttachments END,
      messageIdHeader  = COALESCE(excluded.messageIdHeader, messages.messageIdHeader),
      referencesHeader = COALESCE(excluded.referencesHeader, messages.referencesHeader)
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
        m.threadId || m.id,
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
        m.messageIdHeader ?? null,
        m.referencesHeader ?? null,
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

/**
 * Recomputes and persists `labels.unread`/`total` for the given label ids from
 * the local message cache. This is the only place besides a Gmail label sync
 * (`upsertLabels`) that writes those counters — without it, a local mutation
 * (mark read/unread, star, archive, trash) updates the message rows but leaves
 * the cached label counters stale until the next full/incremental sync, which
 * is why sidebar/header unread badges could disagree with what the message
 * list actually showed until the app was relaunched.
 */
function recomputeLabelCounts(accountId: string, labelIds: string[]): void {
  if (labelIds.length === 0) return;
  const d = getDb();
  const placeholders = labelIds.map(() => "?").join(", ");
  const rows = d
    .prepare(`
      SELECT ml.labelId AS labelId, COUNT(*) AS total, SUM(m.unread) AS unread
        FROM message_labels ml
        JOIN messages m ON m.accountId = ml.accountId AND m.id = ml.messageId
       WHERE ml.accountId = ? AND ml.labelId IN (${placeholders})
       GROUP BY ml.labelId
    `)
    .all(accountId, ...labelIds) as unknown as { labelId: string; total: number; unread: number | null }[];
  const counts = new Map(rows.map((r) => [r.labelId, { total: r.total, unread: r.unread ?? 0 }]));
  const update = d.prepare("UPDATE labels SET unread = ?, total = ? WHERE accountId = ? AND id = ?");
  for (const labelId of labelIds) {
    const c = counts.get(labelId) ?? { total: 0, unread: 0 };
    update.run(c.unread, c.total, accountId, labelId);
  }
}

/** Draft updates mint a new message id — drop stale local draft rows of the
    same thread so the Drafts view doesn't show duplicates until sync. */
export function deleteOtherDraftsInThread(
  accountId: string,
  threadId: string,
  keepMessageId: string,
): void {
  const d = getDb();
  const rows = d
    .prepare(
      `SELECT m.id FROM messages m
        WHERE m.accountId = ? AND m.threadId = ? AND m.id != ?
          AND EXISTS (SELECT 1 FROM message_labels ml
                       WHERE ml.accountId = m.accountId AND ml.messageId = m.id
                         AND ml.labelId = 'DRAFT')`,
    )
    .all(accountId, threadId, keepMessageId) as unknown as { id: string }[];
  for (const row of rows) deleteMessage(accountId, row.id);
}

export function deleteMessage(accountId: string, messageId: string): void {
  const d = getDb();
  const existing = d
    .prepare("SELECT labelIds FROM messages WHERE accountId = ? AND id = ?")
    .get(accountId, messageId) as unknown as { labelIds: string } | undefined;
  const priorLabelIds = existing ? parseLabelIds(existing.labelIds) : [];

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

  recomputeLabelCounts(accountId, priorLabelIds);
}

/** Apply an optimistic label add/remove to a locally-cached message. */
export function applyLabelChange(
  accountId: string,
  messageId: string,
  addLabelIds: string[],
  removeLabelIds: string[],
): void {
  const d = getDb();
  const existing = d
    .prepare("SELECT labelIds FROM messages WHERE accountId = ? AND id = ?")
    .get(accountId, messageId) as unknown as { labelIds: string } | undefined;
  if (!existing) return;
  const priorLabelIds = parseLabelIds(existing.labelIds);

  let newLabelIds: string[] = priorLabelIds;
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
    newLabelIds = labelRows.map((r) => r.labelId);
    d.prepare(
      "UPDATE messages SET labelIds = ?, unread = ?, starred = ? WHERE accountId = ? AND id = ?",
    ).run(
      JSON.stringify(newLabelIds),
      newLabelIds.includes("UNREAD") ? 1 : 0,
      newLabelIds.includes("STARRED") ? 1 : 0,
      accountId,
      messageId,
    );
    d.exec("COMMIT");
  } catch (err) {
    d.exec("ROLLBACK");
    throw err;
  }

  recomputeLabelCounts(accountId, [...new Set([...priorLabelIds, ...newLabelIds])]);
}

// ── Messages: reads ───────────────────────────────────────────────────────────

/**
 * One row per thread: `matchedSql` selects the (accountId, threadId) pairs the
 * view includes; rollups (count/unread/starred) and the representative row (the
 * thread's latest message) are computed over EVERY locally-cached message of
 * the thread, so e.g. an Inbox thread counts your sent replies like Gmail does.
 */
function threadPageQuery(matchedSql: string): string {
  return `
    WITH matched AS (${matchedSql}),
    agg AS (
      SELECT t.accountId AS accountId, t.threadId AS threadId,
             COUNT(*) AS threadCount,
             MAX(t.unread) AS threadUnread,
             MAX(t.starred) AS threadStarred,
             MAX(t.date) AS repDate
        FROM messages t
        JOIN matched mt ON mt.accountId = t.accountId AND mt.threadId = t.threadId
       GROUP BY t.accountId, t.threadId
       ORDER BY repDate DESC
       LIMIT ? OFFSET ?
    )
    SELECT m.*, agg.threadCount AS threadCount,
           agg.threadUnread AS threadUnread,
           agg.threadStarred AS threadStarred
      FROM agg
      JOIN messages m
        ON m.accountId = agg.accountId AND m.threadId = agg.threadId AND m.date = agg.repDate
     GROUP BY agg.accountId, agg.threadId
     ORDER BY agg.repDate DESC
  `;
}

const NOT_SPAM_TRASH =
  "NOT EXISTS (SELECT 1 FROM message_labels mlx WHERE mlx.accountId = m.accountId AND mlx.messageId = m.id AND mlx.labelId IN ('SPAM', 'TRASH'))";

export function getThreadsPage(
  accountId: string,
  labelId: string,
  offset: number,
  limit: number,
): { messages: GmailMessageSummary[]; hasMore: boolean } {
  const d = getDb();
  // Gmail semantics: spam/trash stay out of every view except their own.
  const exclusion = labelId === "SPAM" || labelId === "TRASH" ? "" : `AND ${NOT_SPAM_TRASH}`;
  const rows = d
    .prepare(
      threadPageQuery(`
        SELECT DISTINCT m.accountId AS accountId, m.threadId AS threadId
          FROM messages m
          JOIN message_labels ml
            ON ml.accountId = m.accountId AND ml.messageId = m.id
         WHERE m.accountId = ? AND ml.labelId = ? ${exclusion}
      `),
    )
    .all(accountId, labelId, limit + 1, offset) as unknown as ThreadRow[];

  const hasMore = rows.length > limit;
  return { messages: rows.slice(0, limit).map(rowToThreadSummary), hasMore };
}

/** All locally-cached messages of a thread, oldest first. */
export function getThreadMessages(accountId: string, threadId: string): GmailMessageSummary[] {
  const d = getDb();
  const rows = d
    .prepare(
      "SELECT * FROM messages WHERE accountId = ? AND threadId = ? ORDER BY date ASC, id ASC",
    )
    .all(accountId, threadId) as unknown as MessageRow[];
  return rows.map(rowToSummary);
}

function getThreadMessageIds(accountId: string, threadId: string): string[] {
  const d = getDb();
  const rows = d
    .prepare("SELECT id FROM messages WHERE accountId = ? AND threadId = ?")
    .all(accountId, threadId) as unknown as { id: string }[];
  return rows.map((r) => r.id);
}

export function applyLabelChangeToThread(
  accountId: string,
  threadId: string,
  addLabelIds: string[],
  removeLabelIds: string[],
): void {
  for (const id of getThreadMessageIds(accountId, threadId)) {
    applyLabelChange(accountId, id, addLabelIds, removeLabelIds);
  }
}

export function deleteThread(accountId: string, threadId: string): void {
  for (const id of getThreadMessageIds(accountId, threadId)) {
    deleteMessage(accountId, id);
  }
}

export function getMessageDetail(accountId: string, messageId: string): GmailMessageDetail | null {
  const d = getDb();
  const row = d
    .prepare("SELECT * FROM messages WHERE accountId = ? AND id = ?")
    .get(accountId, messageId) as unknown as MessageRow | undefined;
  if (!row || row.detailFetched !== 1) return null;
  return rowToDetail(row);
}

export function getStoredReplyHeaders(
  accountId: string,
  messageId: string,
): { messageIdHeader: string | null; referencesHeader: string | null } {
  const d = getDb();
  const row = d
    .prepare("SELECT messageIdHeader, referencesHeader FROM messages WHERE accountId = ? AND id = ?")
    .get(accountId, messageId) as unknown as
    | { messageIdHeader: string | null; referencesHeader: string | null }
    | undefined;
  return {
    messageIdHeader: row?.messageIdHeader ?? null,
    referencesHeader: row?.referencesHeader ?? null,
  };
}

export function setReplyHeaders(
  accountId: string,
  messageId: string,
  messageIdHeader: string | null,
  referencesHeader: string | null,
): void {
  getDb()
    .prepare("UPDATE messages SET messageIdHeader = ?, referencesHeader = ? WHERE accountId = ? AND id = ?")
    .run(messageIdHeader, referencesHeader, accountId, messageId);
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

export function getMessageIdsForLabel(accountId: string, labelId: string): string[] {
  const d = getDb();
  const rows = d
    .prepare(`
      SELECT m.id FROM messages m
      JOIN message_labels ml
        ON ml.accountId = m.accountId AND ml.messageId = m.id AND ml.labelId = ?
     WHERE m.accountId = ?
     ORDER BY m.date DESC
    `)
    .all(labelId, accountId) as unknown as { id: string }[];
  return rows.map((r) => r.id);
}

/** Total unread INBOX messages across every account — drives the dock badge. */
export function countInboxUnreadAll(): number {
  const d = getDb();
  const row = d
    .prepare(`
      SELECT COUNT(*) AS n
        FROM messages m
        JOIN message_labels ml
          ON ml.accountId = m.accountId AND ml.messageId = m.id AND ml.labelId = 'INBOX'
       WHERE m.unread = 1
    `)
    .get() as unknown as { n: number } | undefined;
  return row?.n ?? 0;
}

/** Total unread INBOX messages for a single account — drives the tray menu sublabels. */
export function countInboxUnreadForAccount(accountId: string): number {
  const d = getDb();
  const row = d
    .prepare(`
      SELECT COUNT(*) AS n
        FROM messages m
        JOIN message_labels ml
          ON ml.accountId = m.accountId AND ml.messageId = m.id AND ml.labelId = 'INBOX'
       WHERE m.unread = 1 AND m.accountId = ?
    `)
    .get(accountId) as unknown as { n: number } | undefined;
  return row?.n ?? 0;
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

const HAS_LABEL =
  "EXISTS (SELECT 1 FROM message_labels ml WHERE ml.accountId = m.accountId AND ml.messageId = m.id AND ml.labelId = ?)";

/** WHERE fragment for a rule set: rules OR'd; within a rule, allOf AND'd and noneOf excluded. */
function rulesWhere(rules: ViewRule[]): { clause: string; params: string[] } {
  const parts: string[] = [];
  const params: string[] = [];
  for (const rule of rules) {
    const sub: string[] = ["m.accountId = ?"];
    params.push(rule.accountId);
    for (const labelId of rule.allOf) {
      sub.push(HAS_LABEL);
      params.push(labelId);
    }
    // Gmail semantics: spam/trash only surface when a rule asks for them.
    if (!rule.allOf.includes("SPAM") && !rule.allOf.includes("TRASH")) {
      sub.push(NOT_SPAM_TRASH);
    }
    if (rule.noneOf.length > 0) {
      sub.push(
        `NOT EXISTS (SELECT 1 FROM message_labels ml WHERE ml.accountId = m.accountId AND ml.messageId = m.id AND ml.labelId IN (${rule.noneOf.map(() => "?").join(", ")}))`,
      );
      params.push(...rule.noneOf);
    }
    parts.push(`(${sub.join(" AND ")})`);
  }
  return { clause: parts.join(" OR "), params };
}

/**
 * Combined-view query: one row per thread having any message matching any of
 * the given per-account rules. Label ids are exact and account-scoped, so the
 * same label *name* in two accounts stays two distinct choices.
 */
export function getCombinedThreadsByRules(
  rules: ViewRule[],
  offset: number,
  limit: number,
): { messages: GmailMessageSummary[]; hasMore: boolean } {
  if (rules.length === 0) return { messages: [], hasMore: false };
  const d = getDb();
  const { clause, params } = rulesWhere(rules);

  const rows = d
    .prepare(
      threadPageQuery(`
        SELECT DISTINCT m.accountId AS accountId, m.threadId AS threadId
          FROM messages m
         WHERE ${clause}
      `),
    )
    .all(...params, limit + 1, offset) as unknown as ThreadRow[];

  const hasMore = rows.length > limit;
  return { messages: rows.slice(0, limit).map(rowToThreadSummary), hasMore };
}

export function countCombinedByRules(rules: ViewRule[]): { total: number; unread: number } {
  if (rules.length === 0) return { total: 0, unread: 0 };
  const d = getDb();
  const { clause, params } = rulesWhere(rules);

  const row = d
    .prepare(`
      SELECT COUNT(*) AS total,
             COALESCE(SUM(CASE WHEN EXISTS (
               SELECT 1 FROM message_labels ml
                WHERE ml.accountId = m.accountId AND ml.messageId = m.id AND ml.labelId = 'UNREAD'
             ) THEN 1 ELSE 0 END), 0) AS unread
        FROM messages m
       WHERE ${clause}
    `)
    .get(...params) as { total: number; unread: number } | undefined;

  return { total: row?.total ?? 0, unread: row?.unread ?? 0 };
}

// ── Full-text search ──────────────────────────────────────────────────────────

/**
 * User input → FTS5 MATCH syntax: each whitespace token becomes a quoted phrase
 * (neutralizing operators like AND/NEAR/parens), the last one prefix-matched
 * for search-as-you-type.
 */
function toFtsMatch(query: string): string | null {
  const tokens = query
    .split(/\s+/)
    .map((t) => t.replace(/"/g, ""))
    .filter((t) => t.length > 0);
  if (tokens.length === 0) return null;
  return tokens.map((t, i) => `"${t}"${i === tokens.length - 1 ? "*" : ""}`).join(" ");
}

export type SearchScope = {
  /** Restrict to one label (view filter, account mode). */
  labelId?: string;
  /** Restrict to a Combined view's rules (carry their own spam/trash semantics). */
  rules?: ViewRule[];
  starred?: boolean;
  important?: boolean;
  hasAttachments?: boolean;
  /** Only messages newer than N days. */
  withinDays?: number;
};

/**
 * Local message-level search; accountId null searches every account. The scope
 * restricts results to the current view and/or structured filters — filters
 * work with an empty query too (browse-the-view-filtered), so the FTS match is
 * an optional condition rather than the query's spine.
 */
export function searchMessages(
  queryText: string,
  accountId: string | null,
  offset: number,
  limit: number,
  scope?: SearchScope,
): { messages: GmailMessageSummary[]; hasMore: boolean } {
  const match = toFtsMatch(queryText);
  const hasFilters = Boolean(
    scope?.starred || scope?.important || scope?.hasAttachments || scope?.withinDays,
  );
  if (!match && !hasFilters) return { messages: [], hasMore: false };
  if (scope?.rules && scope.rules.length === 0) return { messages: [], hasMore: false };
  const d = getDb();
  const conds: string[] = [];
  const params: (string | number)[] = [];
  if (match) {
    conds.push("m.rowid IN (SELECT rowid FROM messages_fts WHERE messages_fts MATCH ?)");
    params.push(match);
  }
  if (accountId) {
    conds.push("m.accountId = ?");
    params.push(accountId);
  }
  if (scope?.rules) {
    const { clause, params: ruleParams } = rulesWhere(scope.rules);
    conds.push(`(${clause})`);
    params.push(...ruleParams);
  } else if (scope?.labelId) {
    conds.push(HAS_LABEL);
    params.push(scope.labelId);
    if (scope.labelId !== "SPAM" && scope.labelId !== "TRASH") conds.push(NOT_SPAM_TRASH);
  } else {
    conds.push(NOT_SPAM_TRASH);
  }
  if (scope?.starred) conds.push("m.starred = 1");
  if (scope?.important) {
    conds.push(HAS_LABEL);
    params.push("IMPORTANT");
  }
  if (scope?.hasAttachments) conds.push("m.hasAttachments = 1");
  if (scope?.withinDays) {
    conds.push("m.date >= ?");
    params.push(Date.now() - scope.withinDays * 86_400_000);
  }
  const rows = d
    .prepare(`
      SELECT m.* FROM messages m
      WHERE ${conds.join(" AND ")}
      ORDER BY m.date DESC
      LIMIT ? OFFSET ?
    `)
    .all(...params, limit + 1, offset) as unknown as MessageRow[];
  const hasMore = rows.length > limit;
  return { messages: rows.slice(0, limit).map(rowToSummary), hasMore };
}

// ── Contact suggestions ───────────────────────────────────────────────────────

function parseAddressEntry(entry: string): { name: string; email: string } {
  const trimmed = entry.trim();
  const match = trimmed.match(/^(.*?)\s*<([^>]+)>$/);
  if (match) {
    return { name: match[1].trim().replace(/^"|"$/g, ""), email: match[2].trim() };
  }
  return { name: "", email: trimmed };
}

/** Split an address-list header on commas outside double quotes. */
function splitAddressEntries(list: string): { name: string; email: string }[] {
  const out: { name: string; email: string }[] = [];
  let current = "";
  let inQuotes = false;
  for (const ch of list) {
    if (ch === '"') inQuotes = !inQuotes;
    if (ch === "," && !inQuotes) {
      if (current.trim()) out.push(parseAddressEntry(current));
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim()) out.push(parseAddressEntry(current));
  return out.filter((e) => e.email.includes("@"));
}

/**
 * Recipient autocomplete from the local cache: senders aggregated across the
 * whole store plus To/Cc addressees from the most recent matching messages,
 * ranked by frequency then recency.
 */
export function suggestContacts(queryText: string, limit: number): ContactSuggestion[] {
  const q = queryText.trim().toLowerCase();
  if (!q) return [];
  const d = getDb();
  const like = `%${q.replace(/([\\%_])/g, "\\$1")}%`;

  type Entry = { name: string; email: string; freq: number; lastDate: number };
  const byEmail = new Map<string, Entry>();
  const bump = (name: string, email: string, freq: number, date: number) => {
    const key = email.toLowerCase();
    if (!key.includes("@")) return;
    const existing = byEmail.get(key);
    if (!existing) {
      byEmail.set(key, { name, email, freq, lastDate: date });
      return;
    }
    existing.freq += freq;
    if (date > existing.lastDate) existing.lastDate = date;
    if (!existing.name && name) existing.name = name;
  };

  const fromRows = d
    .prepare(`
      SELECT fromEmail AS email, MAX(fromName) AS name, COUNT(*) AS freq, MAX(date) AS lastDate
        FROM messages
       WHERE fromEmail LIKE ? ESCAPE '\\' OR fromName LIKE ? ESCAPE '\\'
       GROUP BY lower(fromEmail)
    `)
    .all(like, like) as unknown as {
    email: string;
    name: string | null;
    freq: number;
    lastDate: number;
  }[];
  for (const r of fromRows) bump(r.name ?? "", r.email, r.freq, r.lastDate);

  const recipientRows = d
    .prepare(`
      SELECT toField, cc, date FROM messages
       WHERE toField LIKE ? ESCAPE '\\' OR cc LIKE ? ESCAPE '\\'
       ORDER BY date DESC LIMIT 400
    `)
    .all(like, like) as unknown as { toField: string; cc: string | null; date: number }[];
  for (const r of recipientRows) {
    const list = r.cc ? `${r.toField},${r.cc}` : r.toField;
    for (const entry of splitAddressEntries(list)) {
      if (entry.email.toLowerCase().includes(q) || entry.name.toLowerCase().includes(q)) {
        bump(entry.name, entry.email, 1, r.date);
      }
    }
  }

  return [...byEmail.values()]
    .sort((a, b) => b.freq - a.freq || b.lastDate - a.lastDate)
    .slice(0, limit)
    .map((e) => ({ name: e.name === e.email ? "" : e.name, email: e.email }));
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

/** Drops a deleted label's message mappings (sync reconciles the rest). */
export function clearLabelMappings(accountId: string, labelId: string): void {
  getDb()
    .prepare("DELETE FROM message_labels WHERE accountId = ? AND labelId = ?")
    .run(accountId, labelId);
}

export function getKv(key: string): string | null {
  const d = getDb();
  const row = d.prepare("SELECT value FROM kv WHERE key = ?").get(key) as unknown as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

export function setKv(key: string, value: string): void {
  const d = getDb();
  d.prepare(
    "INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(key, value);
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
