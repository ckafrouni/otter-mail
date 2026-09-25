/**
 * gmail-api.ts
 *
 * Gmail REST API client.
 * Base URL: https://gmail.googleapis.com/gmail/v1/users/me
 *
 * gmailFetch: authenticated fetch that spends the account's Gmail quota through
 * gmail-quota.ts (user actions first, sync in the background) and backs off on
 * rate limits (429, and 403 per-user quota errors).
 */

import fs from "fs/promises";
import path from "path";
import { createHash, randomBytes } from "node:crypto";
import { app, dialog } from "@glaze/core/backend";
import { getAccessToken } from "./gmail-oauth.js";
import { getAccount } from "./account-store.js";
import { getCachedAttachment, putCachedAttachment } from "./attachment-cache.js";
import { acquireQuota, isBackgroundWork, quotaCost, reportQuotaExceeded } from "./gmail-quota.js";
import type {
  GmailLabel,
  GmailMessageSummary,
  GmailMessageDetail,
  ComposeAttachment,
} from "../gmail/types.js";

const BASE_URL = "https://gmail.googleapis.com/gmail/v1/users/me";

/**
 * Retries after a rate-limit error. The user's own requests must answer
 * inside the renderer's 5s IPC budget, so they get two quick retries; sync
 * (background) work can afford to wait the limit out.
 */
const FOREGROUND_RETRY_DELAYS_MS = [700, 1500];
const BACKGROUND_MAX_RETRIES = 6;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Gmail reports per-user quota exhaustion as 403 as well as 429. */
function isRateLimited(status: number, body: string): boolean {
  if (status === 429) return true;
  return (
    status === 403 &&
    /rateLimitExceeded|userRateLimitExceeded|RATE_LIMIT_EXCEEDED|Quota exceeded/.test(body)
  );
}

type GmailFetchInit = {
  method?: string;
  body?: string;
  headers?: Record<string, string>;
};

// ── gmailFetch ────────────────────────────────────────────────────────────────

async function gmailFetch(
  accountId: string,
  path: string,
  init: GmailFetchInit = {},
  retryCount = 0,
): Promise<unknown> {
  await acquireQuota(accountId, quotaCost(init.method ?? "GET", path));
  const token = await getAccessToken(accountId);

  const response = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      ...init.headers,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    if (isRateLimited(response.status, body)) {
      const retryAfter = parseInt(response.headers.get("Retry-After") ?? "", 10) * 1000;
      reportQuotaExceeded(accountId, retryAfter > 0 ? retryAfter : 0);
      const background = isBackgroundWork();
      const waitMs = background
        ? retryAfter > 0
          ? retryAfter
          : Math.min(1000 * 2 ** retryCount, 32_000)
        : FOREGROUND_RETRY_DELAYS_MS[retryCount];
      const canRetry = background ? retryCount < BACKGROUND_MAX_RETRIES : waitMs !== undefined;
      if (canRetry) {
        await sleep(waitMs);
        return gmailFetch(accountId, path, init, retryCount + 1);
      }
    }
    throw new Error(
      `Gmail API error: ${response.status} ${response.statusText}${body ? ` — ${body}` : ""}`,
    );
  }

  // DELETE endpoints (drafts) return an empty 204 body.
  const text = await response.text();
  return text ? JSON.parse(text) : {};
}

// ── listLabels ────────────────────────────────────────────────────────────────

export async function listLabels(accountId: string): Promise<GmailLabel[]> {
  const data = (await gmailFetch(accountId, "/labels")) as {
    labels?: { id: string; name: string; type: string }[];
  };

  const rawLabels = data.labels ?? [];

  // labels.list omits message counts and color — only labels.get returns them,
  // so fetch per-label detail for every label.
  const detailById = new Map<
    string,
    { unread?: number; total?: number; color?: { backgroundColor: string; textColor: string } }
  >();

  const CONCURRENCY = 8;
  for (let i = 0; i < rawLabels.length; i += CONCURRENCY) {
    const batch = rawLabels.slice(i, i + CONCURRENCY);
    const fetched = await Promise.all(
      batch.map(
        (l) =>
          gmailFetch(accountId, `/labels/${l.id}`) as Promise<{
            id: string;
            messagesUnread?: number;
            messagesTotal?: number;
            color?: { backgroundColor?: string; textColor?: string };
          }>,
      ),
    );
    for (const label of fetched) {
      detailById.set(label.id, {
        unread: label.messagesUnread,
        total: label.messagesTotal,
        color:
          label.color?.backgroundColor && label.color.textColor
            ? { backgroundColor: label.color.backgroundColor, textColor: label.color.textColor }
            : undefined,
      });
    }
  }

  return rawLabels.map((label) => {
    const detail = detailById.get(label.id);
    return {
      id: label.id,
      name: label.name,
      type: label.type === "system" ? "system" : "user",
      unread: detail?.unread,
      total: detail?.total,
      color: detail?.color,
    };
  });
}

// ── createLabel ──────────────────────────────────────────────────────────────

export async function createLabel(accountId: string, name: string): Promise<GmailLabel> {
  const data = (await gmailFetch(accountId, "/labels", {
    method: "POST",
    body: JSON.stringify({
      name,
      labelListVisibility: "labelShow",
      messageListVisibility: "show",
    }),
  })) as { id: string; name: string };

  return { id: data.id, name: data.name, type: "user" };
}

// ── updateLabel / deleteLabel ────────────────────────────────────────────────

/**
 * Rename and/or recolor a label. Gmail nests by "/" path but a patch does not
 * move children, so renames cascade to every nested label.
 */
export async function updateLabel(
  accountId: string,
  params: {
    labelId: string;
    name?: string;
    color?: { backgroundColor: string; textColor: string };
  },
): Promise<{ ok: true }> {
  const body: Record<string, unknown> = {};
  if (params.name) body.name = params.name;
  if (params.color) body.color = params.color;

  let children: { id: string; name: string }[] = [];
  let oldName: string | undefined;
  if (params.name) {
    const list = (await gmailFetch(accountId, "/labels")) as {
      labels?: { id: string; name: string; type: string }[];
    };
    oldName = (list.labels ?? []).find((l) => l.id === params.labelId)?.name;
    if (oldName) {
      const prefix = `${oldName}/`;
      children = (list.labels ?? []).filter((l) => l.type === "user" && l.name.startsWith(prefix));
    }
  }

  await gmailFetch(accountId, `/labels/${params.labelId}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
  if (params.name && oldName) {
    for (const child of children) {
      await gmailFetch(accountId, `/labels/${child.id}`, {
        method: "PATCH",
        body: JSON.stringify({ name: `${params.name}${child.name.slice(oldName.length)}` }),
      });
    }
  }
  return { ok: true };
}

export async function deleteLabel(accountId: string, labelId: string): Promise<{ ok: true }> {
  await gmailFetch(accountId, `/labels/${labelId}`, { method: "DELETE" });
  return { ok: true };
}

// ── parseFrom ─────────────────────────────────────────────────────────────────

function parseFrom(from: string): { fromName: string; fromEmail: string } {
  const match = from.match(/^(.*?)\s*<([^>]+)>$/);
  if (match) {
    return { fromName: match[1].trim().replace(/^"|"$/g, ""), fromEmail: match[2].trim() };
  }
  return { fromName: from, fromEmail: from };
}

// ── getHeaderValue ─────────────────────────────────────────────────────────────

function getHeaderValue(headers: { name: string; value: string }[], name: string): string {
  return headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";
}

// ── mapMessageSummary ─────────────────────────────────────────────────────────

interface RawMessageMetadata {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  payload?: {
    headers?: { name: string; value: string }[];
    parts?: unknown[];
  };
}

function mapMessageSummary(msg: RawMessageMetadata): GmailMessageSummary {
  const headers = msg.payload?.headers ?? [];
  const from = getHeaderValue(headers, "From");
  const { fromName, fromEmail } = parseFrom(from);
  const labelIds = msg.labelIds ?? [];

  return {
    id: msg.id,
    threadId: msg.threadId,
    fromName,
    fromEmail,
    to: getHeaderValue(headers, "To"),
    subject: getHeaderValue(headers, "Subject"),
    snippet: msg.snippet ?? "",
    date: msg.internalDate ? parseInt(msg.internalDate, 10) : 0,
    unread: labelIds.includes("UNREAD"),
    starred: labelIds.includes("STARRED"),
    labelIds,
    hasAttachments: false, // metadata format does not expose attachment info reliably
    messageIdHeader: getHeaderValue(headers, "Message-ID") || undefined,
    referencesHeader: getHeaderValue(headers, "References") || undefined,
  };
}

// ── fetchMetadataForIds ─────────────────────────────────────────────────────

/**
 * Fetch metadata-format summaries for a set of message ids, capped at 5
 * concurrent requests. Shared by listMessages (live cold-cache warm-up) and the
 * background sync engine (gmail-quota paces the latter behind user actions).
 */
export async function fetchMetadataForIds(
  accountId: string,
  ids: string[],
): Promise<GmailMessageSummary[]> {
  // messages.get costs 5 quota units against Gmail's ~250 units/s per user;
  // 5 in flight (~30 req/s) stays clear of 429 backoffs and leaves headroom
  // for what the user opens while a big sync runs.
  const CONCURRENCY = 5;
  const results: GmailMessageSummary[] = [];

  for (let i = 0; i < ids.length; i += CONCURRENCY) {
    const batch = ids.slice(i, i + CONCURRENCY);
    const fetched = await Promise.all(
      batch.map(async (id) => {
        try {
          return (await gmailFetch(
            accountId,
            `/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Cc&metadataHeaders=Subject&metadataHeaders=Date&metadataHeaders=Message-ID&metadataHeaders=References`,
          )) as RawMessageMetadata;
        } catch (err) {
          // A message can be purged between the history feed listing it and this
          // fetch; a dead id must not kill the sync (the cursor would never
          // advance and every tick would replay the same failure).
          if (err instanceof Error && err.message.includes("Gmail API error: 404")) return null;
          throw err;
        }
      }),
    );
    results.push(
      ...fetched.filter((m): m is RawMessageMetadata => m !== null).map(mapMessageSummary),
    );
  }

  return results;
}

// ── listMessages ──────────────────────────────────────────────────────────────

export async function listMessages(
  accountId: string,
  params: {
    labelIds?: string[];
    pageToken?: string;
    maxResults?: number;
  },
): Promise<{ messages: GmailMessageSummary[]; nextPageToken?: string }> {
  const query = new URLSearchParams();
  if (params.labelIds?.length) {
    for (const lid of params.labelIds) {
      query.append("labelIds", lid);
    }
  }
  if (params.pageToken) query.set("pageToken", params.pageToken);
  query.set("maxResults", String(params.maxResults ?? 25));

  const list = (await gmailFetch(accountId, `/messages?${query.toString()}`)) as {
    messages?: { id: string; threadId: string }[];
    nextPageToken?: string;
  };

  if (!list.messages?.length) {
    return { messages: [], nextPageToken: list.nextPageToken };
  }

  const messages = await fetchMetadataForIds(
    accountId,
    list.messages.map((m) => m.id),
  );
  return { messages, nextPageToken: list.nextPageToken };
}

// ── Sync primitives ───────────────────────────────────────────────────────────

/** Mailbox profile — used to seed/track the incremental-sync history cursor. */
export async function getProfile(
  accountId: string,
): Promise<{ historyId: string; messagesTotal: number }> {
  const data = (await gmailFetch(accountId, "/profile")) as {
    historyId?: string;
    messagesTotal?: number;
  };
  return { historyId: data.historyId ?? "", messagesTotal: data.messagesTotal ?? 0 };
}

/** A single page of message ids (no metadata) for full-mailbox sync. */
export async function listMessageIdsPage(
  accountId: string,
  params: { pageToken?: string; maxResults?: number; labelIds?: string[] },
): Promise<{ ids: string[]; nextPageToken?: string; resultSizeEstimate: number }> {
  const query = new URLSearchParams();
  query.set("maxResults", String(params.maxResults ?? 500));
  // Spam/Trash are synced too — the Junk and Trash views read the local cache.
  query.set("includeSpamTrash", "true");
  for (const lid of params.labelIds ?? []) query.append("labelIds", lid);
  if (params.pageToken) query.set("pageToken", params.pageToken);

  const list = (await gmailFetch(accountId, `/messages?${query.toString()}`)) as {
    messages?: { id: string }[];
    nextPageToken?: string;
    resultSizeEstimate?: number;
  };

  return {
    ids: (list.messages ?? []).map((m) => m.id),
    nextPageToken: list.nextPageToken,
    resultSizeEstimate: list.resultSizeEstimate ?? 0,
  };
}

/**
 * One page of Gmail's own search (the same engine and operators as the Gmail
 * web search box). Spam and Trash are left out unless the query asks for them,
 * like Gmail does.
 */
export async function searchGmailPage(
  accountId: string,
  q: string,
  pageToken?: string,
  maxResults = 50,
): Promise<{
  refs: { id: string; threadId: string }[];
  nextPageToken?: string;
  resultSizeEstimate: number;
}> {
  const query = new URLSearchParams({ q, maxResults: String(maxResults) });
  if (/\b(in|label):(spam|trash|anywhere)\b/i.test(q)) query.set("includeSpamTrash", "true");
  if (pageToken) query.set("pageToken", pageToken);
  const list = (await gmailFetch(accountId, `/messages?${query.toString()}`)) as {
    messages?: { id: string; threadId: string }[];
    nextPageToken?: string;
    resultSizeEstimate?: number;
  };
  return {
    refs: list.messages ?? [],
    nextPageToken: list.nextPageToken,
    resultSizeEstimate: list.resultSizeEstimate ?? 0,
  };
}

export interface GmailHistoryPage {
  historyId?: string;
  nextPageToken?: string;
  history?: {
    messagesAdded?: { message: { id: string } }[];
    messagesDeleted?: { message: { id: string } }[];
    labelsAdded?: { message: { id: string }; labelIds: string[] }[];
    labelsRemoved?: { message: { id: string }; labelIds: string[] }[];
  }[];
}

/** One page of the history feed since `startHistoryId`. */
export async function listHistory(
  accountId: string,
  startHistoryId: string,
  pageToken?: string,
): Promise<GmailHistoryPage> {
  const query = new URLSearchParams();
  query.set("startHistoryId", startHistoryId);
  query.set("maxResults", "500");
  if (pageToken) query.set("pageToken", pageToken);
  return (await gmailFetch(accountId, `/history?${query.toString()}`)) as GmailHistoryPage;
}

/** Distinguish an expired-history-cursor (HTTP 404) from other failures. */
export function isHistoryExpiredError(err: unknown): boolean {
  return err instanceof Error && err.message.includes("Gmail API error: 404");
}

// ── getMessage ────────────────────────────────────────────────────────────────

interface MimePart {
  mimeType?: string;
  filename?: string;
  headers?: { name: string; value: string }[];
  body?: { data?: string; attachmentId?: string; size?: number };
  parts?: MimePart[];
}

function decodeBase64url(data: string): string {
  const base64 = data.replace(/-/g, "+").replace(/_/g, "/");
  const padding = (4 - (base64.length % 4)) % 4;
  const padded = base64 + "=".repeat(padding);
  return Buffer.from(padded, "base64").toString("utf-8");
}

function walkParts(
  parts: MimePart[],
  result: {
    bodyHtml: string | null;
    bodyText: string | null;
    attachments: {
      id: string;
      filename: string;
      mimeType: string;
      size: number;
      contentId?: string;
    }[];
  },
): void {
  for (const part of parts) {
    const mimeType = part.mimeType ?? "";

    if (part.filename && part.body?.attachmentId) {
      result.attachments.push({
        id: part.body.attachmentId,
        filename: part.filename,
        mimeType,
        size: part.body.size ?? 0,
        // Inline images are referenced from the HTML as `cid:<Content-ID>`.
        contentId:
          getHeaderValue(part.headers ?? [], "Content-ID").replace(/^<|>$/g, "") || undefined,
      });
      continue;
    }

    if (mimeType === "text/html" && result.bodyHtml === null && part.body?.data) {
      result.bodyHtml = decodeBase64url(part.body.data);
    } else if (mimeType === "text/plain" && result.bodyText === null && part.body?.data) {
      result.bodyText = decodeBase64url(part.body.data);
    }

    if (part.parts?.length) {
      walkParts(part.parts, result);
    }
  }
}

interface RawMessageFull extends RawMessageMetadata {
  payload?: RawMessageMetadata["payload"] & {
    body?: { data?: string };
    parts?: MimePart[];
    mimeType?: string;
  };
}

export async function getMessage(
  accountId: string,
  messageId: string,
): Promise<GmailMessageDetail> {
  const msg = (await gmailFetch(accountId, `/messages/${messageId}?format=full`)) as RawMessageFull;

  const summary = mapMessageSummary(msg);
  const headers = msg.payload?.headers ?? [];

  const bodyResult: {
    bodyHtml: string | null;
    bodyText: string | null;
    attachments: {
      id: string;
      filename: string;
      mimeType: string;
      size: number;
      contentId?: string;
    }[];
  } = { bodyHtml: null, bodyText: null, attachments: [] };

  const payload = msg.payload;
  if (payload) {
    const topMime = payload.mimeType ?? "";
    if (topMime === "text/html" && payload.body?.data) {
      bodyResult.bodyHtml = decodeBase64url(payload.body.data);
    } else if (topMime === "text/plain" && payload.body?.data) {
      bodyResult.bodyText = decodeBase64url(payload.body.data);
    }

    if (payload.parts?.length) {
      walkParts(payload.parts, bodyResult);
    }
  }

  return {
    ...summary,
    cc: getHeaderValue(headers, "Cc") || undefined,
    bcc: getHeaderValue(headers, "Bcc") || undefined,
    bodyHtml: bodyResult.bodyHtml,
    bodyText: bodyResult.bodyText,
    hasAttachments: bodyResult.attachments.length > 0,
    attachments: bodyResult.attachments,
  };
}

// ── modifyMessage ─────────────────────────────────────────────────────────────

export async function modifyMessage(
  accountId: string,
  messageId: string,
  params: { addLabelIds?: string[]; removeLabelIds?: string[] },
): Promise<{ ok: true }> {
  await gmailFetch(accountId, `/messages/${messageId}/modify`, {
    method: "POST",
    body: JSON.stringify({
      addLabelIds: params.addLabelIds ?? [],
      removeLabelIds: params.removeLabelIds ?? [],
    }),
  });
  return { ok: true };
}

// ── trashMessage ──────────────────────────────────────────────────────────────

export async function trashMessage(accountId: string, messageId: string): Promise<{ ok: true }> {
  await gmailFetch(accountId, `/messages/${messageId}/trash`, { method: "POST" });
  return { ok: true };
}

// ── Thread actions ────────────────────────────────────────────────────────────

export async function modifyThread(
  accountId: string,
  threadId: string,
  params: { addLabelIds?: string[]; removeLabelIds?: string[] },
): Promise<{ ok: true }> {
  await gmailFetch(accountId, `/threads/${threadId}/modify`, {
    method: "POST",
    body: JSON.stringify({
      addLabelIds: params.addLabelIds ?? [],
      removeLabelIds: params.removeLabelIds ?? [],
    }),
  });
  return { ok: true };
}

export async function trashThread(accountId: string, threadId: string): Promise<{ ok: true }> {
  await gmailFetch(accountId, `/threads/${threadId}/trash`, { method: "POST" });
  return { ok: true };
}

/** Restores a trashed thread and returns fresh summaries — trashing deleted the
    local rows, so the caller re-upserts them. */
export async function untrashThread(
  accountId: string,
  threadId: string,
): Promise<GmailMessageSummary[]> {
  const res = (await gmailFetch(accountId, `/threads/${threadId}/untrash`, {
    method: "POST",
  })) as { messages?: { id: string }[] };
  const ids = (res.messages ?? []).map((m) => m.id);
  return ids.length > 0 ? fetchMetadataForIds(accountId, ids) : [];
}

/** PERMANENT bulk delete — one messages.batchDelete per 1000 ids. Gmail has
    no threads.batchDelete, so callers resolve threads to message ids first. */
export async function batchDeleteMessages(accountId: string, messageIds: string[]): Promise<void> {
  for (let i = 0; i < messageIds.length; i += 1000) {
    await gmailFetch(accountId, "/messages/batchDelete", {
      method: "POST",
      body: JSON.stringify({ ids: messageIds.slice(i, i + 1000) }),
    });
  }
}

/** PERMANENT thread delete — fallback for threads with no locally-known messages. */
export async function deleteThreadPermanently(
  accountId: string,
  threadId: string,
): Promise<{ ok: boolean }> {
  await gmailFetch(accountId, `/threads/${threadId}`, { method: "DELETE" });
  return { ok: true };
}

export async function untrashMessage(
  accountId: string,
  messageId: string,
): Promise<GmailMessageSummary[]> {
  await gmailFetch(accountId, `/messages/${messageId}/untrash`, { method: "POST" });
  return fetchMetadataForIds(accountId, [messageId]);
}

// ── Reply headers ─────────────────────────────────────────────────────────────

/** Live fetch of the RFC 2822 reply headers for a message not yet cached with them. */
export async function fetchReplyHeaders(
  accountId: string,
  messageId: string,
): Promise<{ messageIdHeader: string | null; referencesHeader: string | null }> {
  const msg = (await gmailFetch(
    accountId,
    `/messages/${messageId}?format=metadata&metadataHeaders=Message-ID&metadataHeaders=References`,
  )) as RawMessageMetadata;
  const headers = msg.payload?.headers ?? [];
  return {
    messageIdHeader: getHeaderValue(headers, "Message-ID") || null,
    referencesHeader: getHeaderValue(headers, "References") || null,
  };
}

// ── sendMessage ───────────────────────────────────────────────────────────────

const CRLF = "\r\n";

function isPrintableAscii(value: string): boolean {
  return /^[\x20-\x7e]*$/.test(value);
}

/**
 * RFC 2047 B-encoded word(s), chunked by code point so UTF-8 byte sequences
 * never split across words; continuation words are folded onto new lines.
 */
function encodeWords(value: string): string {
  const MAX_BYTES = 45; // "=?UTF-8?B?" + base64(45B → 60ch) + "?=" = 72 chars ≤ 75
  const chunks: string[] = [];
  let current = "";
  for (const ch of value) {
    if (current && Buffer.byteLength(current + ch, "utf-8") > MAX_BYTES) {
      chunks.push(current);
      current = ch;
    } else {
      current += ch;
    }
  }
  if (current) chunks.push(current);
  return chunks
    .map((c) => `=?UTF-8?B?${Buffer.from(c, "utf-8").toString("base64")}?=`)
    .join(`${CRLF} `);
}

function encodeHeaderValue(value: string): string {
  return isPrintableAscii(value) ? value : encodeWords(value);
}

function formatAddress(name: string, email: string): string {
  if (!name || name === email) return email;
  if (!isPrintableAscii(name)) return `${encodeWords(name)} <${email}>`;
  if (/[^A-Za-z0-9 !#$%&'*+\-/=?^_`{|}~.]/.test(name)) {
    return `"${name.replace(/(["\\])/g, "\\$1")}" <${email}>`;
  }
  return `${name} <${email}>`;
}

/**
 * Split a user-typed address list on commas outside double quotes. CR/LF are
 * collapsed to spaces — a raw newline in an entry would otherwise terminate
 * the To/Cc/Bcc header line mid-value (header injection).
 */
function splitAddressList(value: string): string[] {
  const parts: string[] = [];
  let current = "";
  let inQuotes = false;
  for (const ch of value) {
    if (ch === '"') inQuotes = !inQuotes;
    if (ch === "," && !inQuotes) {
      parts.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  parts.push(current);
  return parts.map((p) => p.replace(/[\r\n]+/g, " ").trim()).filter((p) => p.length > 0);
}

/** Re-emit an address list with display names RFC 2047-encoded when non-ASCII. */
function encodeAddressList(value: string): string {
  return splitAddressList(value)
    .map((entry) => {
      const match = entry.match(/^(.*?)\s*<([^>]+)>$/);
      if (!match) return entry;
      const name = match[1].trim().replace(/^"|"$/g, "").replace(/\\(.)/g, "$1");
      return formatAddress(name, match[2].trim());
    })
    .join(", ");
}

function wrapBase64(base64: string): string {
  return base64.match(/.{1,76}/g)?.join(CRLF) ?? "";
}

function attachmentHeaders(att: { name: string; mimeType: string }): string[] {
  const mimeType = att.mimeType || "application/octet-stream";
  if (isPrintableAscii(att.name) && !/["\\]/.test(att.name)) {
    return [
      `Content-Type: ${mimeType}; name="${att.name}"`,
      `Content-Disposition: attachment; filename="${att.name}"`,
    ];
  }
  // RFC 2231 extended parameter + RFC 2047 fallback for legacy clients.
  const extended = `UTF-8''${encodeURIComponent(att.name).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`;
  const fallback = encodeWords(att.name).split(`${CRLF} `).join(" ");
  return [
    `Content-Type: ${mimeType}`,
    `Content-Disposition: attachment; filename="${fallback}"; filename*=${extended}`,
  ];
}

interface OutgoingMessage {
  /** Already formatted, e.g. via formatAddress(). */
  from: string;
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  body: string;
  /** When present, the message is sent as multipart/alternative (text + html). */
  bodyHtml?: string;
  inReplyTo?: string;
  references?: string;
  attachments?: ComposeAttachment[];
}

function buildMime(params: OutgoingMessage): string {
  // Drafts may not have recipients yet.
  const headers: string[] = [`From: ${params.from}`];
  if (params.to) headers.push(`To: ${encodeAddressList(params.to)}`);
  if (params.cc) headers.push(`Cc: ${encodeAddressList(params.cc)}`);
  if (params.bcc) headers.push(`Bcc: ${encodeAddressList(params.bcc)}`);
  headers.push(`Subject: ${encodeHeaderValue(params.subject)}`);
  if (params.inReplyTo) headers.push(`In-Reply-To: ${params.inReplyTo}`);
  if (params.references) {
    // One message id per folded line keeps long reply chains within line limits.
    headers.push(`References: ${params.references.split(/\s+/).filter(Boolean).join(`${CRLF} `)}`);
  }
  headers.push("MIME-Version: 1.0");

  const bodyBase64 = wrapBase64(Buffer.from(params.body, "utf-8").toString("base64"));
  const textPart = [
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    bodyBase64,
  ];

  // Rich mail: text/plain + text/html under multipart/alternative.
  let bodyEntity = textPart;
  if (params.bodyHtml) {
    const altBoundary = `glaze_alt_${randomBytes(12).toString("hex")}`;
    const htmlPart = [
      "Content-Type: text/html; charset=UTF-8",
      "Content-Transfer-Encoding: base64",
      "",
      wrapBase64(Buffer.from(params.bodyHtml, "utf-8").toString("base64")),
    ];
    bodyEntity = [
      `Content-Type: multipart/alternative; boundary="${altBoundary}"`,
      "",
      [`--${altBoundary}`, ...textPart].join(CRLF),
      [`--${altBoundary}`, ...htmlPart].join(CRLF),
      `--${altBoundary}--`,
    ];
  }

  const attachments = params.attachments ?? [];
  if (attachments.length === 0) {
    return [...headers, ...bodyEntity].join(CRLF);
  }

  const boundary = `glaze_${randomBytes(12).toString("hex")}`;
  headers.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
  const parts: string[] = [[`--${boundary}`, ...bodyEntity].join(CRLF)];
  for (const att of attachments) {
    parts.push(
      [
        `--${boundary}`,
        ...attachmentHeaders(att),
        "Content-Transfer-Encoding: base64",
        "",
        // Round-trip through Buffer normalizes url-safe/whitespaced input.
        wrapBase64(Buffer.from(att.base64, "base64").toString("base64")),
      ].join(CRLF),
    );
  }
  return [headers.join(CRLF), "", parts.join(CRLF), `--${boundary}--`].join(CRLF);
}

function encodeBase64url(data: string): string {
  return Buffer.from(data)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export async function sendMessage(
  accountId: string,
  params: {
    to: string;
    cc?: string;
    bcc?: string;
    subject: string;
    body: string;
    bodyHtml?: string;
    threadId?: string;
    inReplyTo?: string;
    references?: string;
    attachments?: ComposeAttachment[];
  },
): Promise<{ ok: true; messageId?: string }> {
  const account = await getAccount(accountId);
  const fromAddress = account ? formatAddress(account.name, account.email) : accountId;

  const raw = buildMime({
    from: fromAddress,
    to: params.to,
    cc: params.cc,
    bcc: params.bcc,
    subject: params.subject,
    body: params.body,
    bodyHtml: params.bodyHtml,
    inReplyTo: params.inReplyTo,
    references: params.references,
    attachments: params.attachments,
  });

  const payload: { raw: string; threadId?: string } = { raw: encodeBase64url(raw) };
  if (params.threadId) payload.threadId = params.threadId;

  const sent = (await gmailFetch(accountId, "/messages/send", {
    method: "POST",
    body: JSON.stringify(payload),
  })) as { id?: string };

  return { ok: true, messageId: sent.id };
}

/** Creates or updates a Gmail draft with the same MIME builder as sends. */
export async function saveDraft(
  accountId: string,
  params: {
    draftId?: string;
    to: string;
    cc?: string;
    bcc?: string;
    subject: string;
    body: string;
    bodyHtml?: string;
    threadId?: string;
    attachments?: ComposeAttachment[];
  },
): Promise<{ draftId: string; messageId?: string; threadId?: string }> {
  const account = await getAccount(accountId);
  const fromAddress = account ? formatAddress(account.name, account.email) : accountId;

  const raw = buildMime({
    from: fromAddress,
    to: params.to,
    cc: params.cc,
    bcc: params.bcc,
    subject: params.subject,
    body: params.body,
    bodyHtml: params.bodyHtml,
    attachments: params.attachments,
  });
  const message: { raw: string; threadId?: string } = { raw: encodeBase64url(raw) };
  if (params.threadId) message.threadId = params.threadId;

  const res = (await gmailFetch(
    accountId,
    params.draftId ? `/drafts/${params.draftId}` : "/drafts",
    {
      method: params.draftId ? "PUT" : "POST",
      body: JSON.stringify(params.draftId ? { id: params.draftId, message } : { message }),
    },
  )) as { id: string; message?: { id?: string; threadId?: string } };
  return {
    draftId: res.id,
    messageId: res.message?.id,
    threadId: res.message?.threadId,
  };
}

/**
 * The message currently backing a draft (every edit mints a new one), or null
 * when the draft no longer exists (sent or deleted elsewhere).
 */
export async function getDraftVersion(accountId: string, draftId: string): Promise<string | null> {
  try {
    const res = (await gmailFetch(accountId, `/drafts/${draftId}?format=minimal`)) as {
      message?: { id?: string };
    };
    return res.message?.id ?? null;
  } catch (err) {
    if (err instanceof Error && err.message.includes("Gmail API error: 404")) return null;
    throw err;
  }
}

/** Every draft's id with its current message (up to 500 drafts). */
export async function listDraftIds(
  accountId: string,
): Promise<{ draftId: string; messageId: string; threadId?: string }[]> {
  const out: { draftId: string; messageId: string; threadId?: string }[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < 5; page++) {
    const query = new URLSearchParams({ maxResults: "100" });
    if (pageToken) query.set("pageToken", pageToken);
    const res = (await gmailFetch(accountId, `/drafts?${query.toString()}`)) as {
      drafts?: { id: string; message?: { id?: string; threadId?: string } }[];
      nextPageToken?: string;
    };
    for (const d of res.drafts ?? []) {
      if (d.message?.id)
        out.push({ draftId: d.id, messageId: d.message.id, threadId: d.message.threadId });
    }
    if (!res.nextPageToken) break;
    pageToken = res.nextPageToken;
  }
  return out;
}

/**
 * The draft id owning a message id, or null. Draft updates mint new message
 * ids, so a stale row can miss — then a draft in the same thread is the
 * best match.
 */
export async function findDraftIdByMessageId(
  accountId: string,
  messageId: string,
  threadId?: string,
): Promise<string | null> {
  const drafts = await listDraftIds(accountId);
  return (
    drafts.find((d) => d.messageId === messageId)?.draftId ??
    (threadId ? (drafts.find((d) => d.threadId === threadId)?.draftId ?? null) : null)
  );
}

export async function deleteDraft(
  accountId: string,
  draftId: string,
): Promise<{ ok: true; messageId?: string }> {
  // Learn the draft's message id first so the local row can be removed too.
  let messageId: string | undefined;
  try {
    const draft = (await gmailFetch(accountId, `/drafts/${draftId}?format=minimal`)) as {
      message?: { id?: string };
    };
    messageId = draft.message?.id;
  } catch {
    // already gone
  }
  await gmailFetch(accountId, `/drafts/${draftId}`, { method: "DELETE" });
  return { ok: true, messageId };
}

// ── getAttachment ─────────────────────────────────────────────────────────────

/** Attachment bytes as standard base64 (for forwarding / in-memory use).
    Local-first: served from the disk cache when present, write-through otherwise. */
export async function getAttachmentData(
  accountId: string,
  messageId: string,
  attachmentId: string,
): Promise<{ base64: string; size: number }> {
  const cached = await getCachedAttachment(accountId, messageId, attachmentId);
  if (cached) return { base64: cached.toString("base64"), size: cached.length };

  const data = (await gmailFetch(
    accountId,
    `/messages/${messageId}/attachments/${attachmentId}`,
  )) as { data?: string; size?: number };

  if (!data.data) {
    throw new Error(`Attachment ${attachmentId} returned no data.`);
  }

  const buffer = Buffer.from(data.data.replace(/-/g, "+").replace(/_/g, "/"), "base64");
  await putCachedAttachment(accountId, messageId, attachmentId, buffer);
  return { base64: buffer.toString("base64"), size: buffer.length };
}

export async function getAttachment(
  accountId: string,
  messageId: string,
  attachmentId: string,
  filename: string,
  _mimeType: string,
): Promise<{ saved: boolean; path?: string }> {
  const { base64 } = await getAttachmentData(accountId, messageId, attachmentId);

  const saveResult = await dialog.showSaveDialog({ defaultPath: filename });

  if (saveResult.canceled || !saveResult.filePath) {
    return { saved: false };
  }

  await fs.writeFile(saveResult.filePath, Buffer.from(base64, "base64"));

  return { saved: true, path: saveResult.filePath };
}

function sanitizeFilename(name: string): string {
  const cleaned = name.replace(/[/\\]/g, "_").replace(/^\.+/, "").trim();
  return cleaned || "attachment";
}

const MAX_PROXY_IMAGE_BYTES = 10 * 1024 * 1024;

/**
 * Fetch a remote email image in the backend and return it as a data URL. The
 * renderer's iframe can't load some remote images directly — e.g. anything
 * served with `Cross-Origin-Resource-Policy: same-origin` (Anthropic/Cloudflare
 * do this) is blocked by WebKit because the frame's origin isn't the image's.
 * The backend has no such policy, so it can act as the image proxy every mail
 * client uses. Rejects non-image / oversized responses.
 */
export async function proxyRemoteImage(url: string): Promise<{ dataUrl: string }> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("invalid url");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`unsupported protocol: ${parsed.protocol}`);
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        // A browser-like UA + Accept so CDNs don't reject a bare fetch.
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
        Accept: "image/avif,image/webp,image/png,image/svg+xml,image/*,*/*;q=0.8",
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.startsWith("image/"))
      throw new Error(`not an image: ${contentType || "unknown"}`);
    const declared = Number(res.headers.get("content-length") ?? "0");
    if (declared > MAX_PROXY_IMAGE_BYTES) throw new Error("image too large");
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.byteLength > MAX_PROXY_IMAGE_BYTES) throw new Error("image too large");
    const mime = contentType.split(";")[0].trim() || "image/png";
    return { dataUrl: `data:${mime};base64,${bytes.toString("base64")}` };
  } finally {
    clearTimeout(timeout);
  }
}

/** Writes in-memory compose bytes (draft/new-mail chips) to the temp cache and returns the path. */
export async function saveComposeAttachmentToTemp(name: string, base64: string): Promise<string> {
  const bytes = Buffer.from(base64, "base64");
  const key = createHash("sha256").update(bytes).digest("hex").slice(0, 16);
  const dir = path.join(app.getPath("temp"), "gmail-inbox-attachments", `compose-${key}`);
  const filePath = path.join(dir, sanitizeFilename(name));
  const existing = await fs.stat(filePath).catch(() => null);
  if (existing && existing.size > 0) return filePath;
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(filePath, bytes);
  return filePath;
}

/** Writes the attachment to a temp cache dir (keyed by identity hash) and reuses it on later opens/drags. */
export async function saveAttachmentToTemp(
  accountId: string,
  messageId: string,
  attachmentId: string,
  filename: string,
): Promise<string> {
  const key = createHash("sha256")
    .update(`${accountId}:${messageId}:${attachmentId}`)
    .digest("hex")
    .slice(0, 16);
  const dir = path.join(app.getPath("temp"), "gmail-inbox-attachments", key);
  const filePath = path.join(dir, sanitizeFilename(filename));
  const existing = await fs.stat(filePath).catch(() => null);
  if (existing && existing.size > 0) return filePath;

  const { base64 } = await getAttachmentData(accountId, messageId, attachmentId);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(filePath, Buffer.from(base64, "base64"));
  return filePath;
}

// ── Compose attachments ───────────────────────────────────────────────────────

export const MAX_ATTACHMENT_TOTAL_BYTES = 25 * 1024 * 1024;

const MIME_BY_EXT: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  heic: "image/heic",
  svg: "image/svg+xml",
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
  html: "text/html",
  json: "application/json",
  xml: "application/xml",
  ics: "text/calendar",
  zip: "application/zip",
  gz: "application/gzip",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  wav: "audio/wav",
  mp4: "video/mp4",
  mov: "video/quicktime",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

function mimeTypeForFile(filePath: string): string {
  const ext = path.extname(filePath).slice(1).toLowerCase();
  return MIME_BY_EXT[ext] ?? "application/octet-stream";
}

/**
 * Backend open-file dialog for compose attachments. `existingBytes` is the
 * size already attached, so the 25 MB total cap covers the whole message.
 */
export async function pickComposeAttachments(
  existingBytes: number,
): Promise<{ attachments: ComposeAttachment[]; error?: string }> {
  const result = await dialog.showOpenDialog({
    properties: ["openFile", "multiSelections"],
  });
  if (result.canceled || result.filePaths.length === 0) return { attachments: [] };

  const attachments: ComposeAttachment[] = [];
  let total = existingBytes;
  for (const filePath of result.filePaths) {
    const buffer = await fs.readFile(filePath);
    total += buffer.length;
    if (total > MAX_ATTACHMENT_TOTAL_BYTES) {
      return { attachments: [], error: "Attachments can total at most 25 MB." };
    }
    attachments.push({
      name: path.basename(filePath),
      mimeType: mimeTypeForFile(filePath),
      size: buffer.length,
      base64: buffer.toString("base64"),
    });
  }
  return { attachments };
}

export type { GmailLabel, GmailMessageSummary, GmailMessageDetail };
