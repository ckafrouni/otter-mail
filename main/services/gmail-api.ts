/**
 * gmail-api.ts
 *
 * Gmail REST API client.
 * Base URL: https://gmail.googleapis.com/gmail/v1/users/me
 *
 * gmailFetch: authenticated fetch with 429 retry-after / exponential backoff.
 */

import fs from "fs/promises";
import { dialog } from "@glaze/core/backend";
import { getAccessToken } from "./gmail-oauth.js";
import { getAccount } from "./account-store.js";
import type { GmailLabel, GmailMessageSummary, GmailMessageDetail } from "../gmail/types.js";

const BASE_URL = "https://gmail.googleapis.com/gmail/v1/users/me";
const MAX_RETRIES = 4;

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
  const token = await getAccessToken(accountId);

  const response = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      ...init.headers,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });

  if (response.status === 429 && retryCount < MAX_RETRIES) {
    const retryAfterHeader = response.headers.get("Retry-After");
    const waitMs = retryAfterHeader
      ? parseInt(retryAfterHeader, 10) * 1000
      : Math.min(1000 * 2 ** retryCount, 32000);
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    return gmailFetch(accountId, path, init, retryCount + 1);
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Gmail API error: ${response.status} ${response.statusText}${body ? ` — ${body}` : ""}`,
    );
  }

  return response.json();
}

// ── listLabels ────────────────────────────────────────────────────────────────

export async function listLabels(accountId: string): Promise<GmailLabel[]> {
  const data = (await gmailFetch(accountId, "/labels")) as {
    labels?: {
      id: string;
      name: string;
      type: string;
      messagesUnread?: number;
      messagesTotal?: number;
    }[];
  };

  const rawLabels = data.labels ?? [];

  // labels.list omits color — only labels.get returns it, so fetch per user label.
  const userLabelIds = rawLabels.filter((l) => l.type !== "system").map((l) => l.id);
  const colorById = new Map<string, { backgroundColor: string; textColor: string }>();

  const CONCURRENCY = 8;
  for (let i = 0; i < userLabelIds.length; i += CONCURRENCY) {
    const batch = userLabelIds.slice(i, i + CONCURRENCY);
    const fetched = await Promise.all(
      batch.map((id) =>
        gmailFetch(accountId, `/labels/${id}`) as Promise<{
          id: string;
          color?: { backgroundColor?: string; textColor?: string };
        }>,
      ),
    );
    for (const label of fetched) {
      if (label.color?.backgroundColor && label.color.textColor) {
        colorById.set(label.id, {
          backgroundColor: label.color.backgroundColor,
          textColor: label.color.textColor,
        });
      }
    }
  }

  return rawLabels.map((label) => ({
    id: label.id,
    name: label.name,
    type: label.type === "system" ? "system" : "user",
    unread: label.messagesUnread,
    total: label.messagesTotal,
    color: colorById.get(label.id),
  }));
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

// ── parseFrom ─────────────────────────────────────────────────────────────────

function parseFrom(from: string): { fromName: string; fromEmail: string } {
  const match = from.match(/^(.*?)\s*<([^>]+)>$/);
  if (match) {
    return { fromName: match[1].trim().replace(/^"|"$/g, ""), fromEmail: match[2].trim() };
  }
  return { fromName: from, fromEmail: from };
}

// ── getHeaderValue ─────────────────────────────────────────────────────────────

function getHeaderValue(
  headers: { name: string; value: string }[],
  name: string,
): string {
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
  };
}

// ── fetchMetadataForIds ─────────────────────────────────────────────────────

/**
 * Fetch metadata-format summaries for a set of message ids, capped at 8
 * concurrent requests. Shared by listMessages (live browse/search) and the
 * background sync engine.
 */
export async function fetchMetadataForIds(
  accountId: string,
  ids: string[],
): Promise<GmailMessageSummary[]> {
  const CONCURRENCY = 8;
  const results: GmailMessageSummary[] = [];

  for (let i = 0; i < ids.length; i += CONCURRENCY) {
    const batch = ids.slice(i, i + CONCURRENCY);
    const fetched = await Promise.all(
      batch.map((id) =>
        gmailFetch(
          accountId,
          `/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Cc&metadataHeaders=Subject&metadataHeaders=Date`,
        ) as Promise<RawMessageMetadata>,
      ),
    );
    results.push(...fetched.map(mapMessageSummary));
  }

  return results;
}

// ── listMessages ──────────────────────────────────────────────────────────────

export async function listMessages(
  accountId: string,
  params: {
    labelIds?: string[];
    q?: string;
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
  if (params.q) query.set("q", params.q);
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
  params: { pageToken?: string; maxResults?: number },
): Promise<{ ids: string[]; nextPageToken?: string; resultSizeEstimate: number }> {
  const query = new URLSearchParams();
  query.set("maxResults", String(params.maxResults ?? 500));
  query.set("includeSpamTrash", "false");
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
    attachments: { id: string; filename: string; mimeType: string; size: number }[];
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

export async function getMessage(accountId: string, messageId: string): Promise<GmailMessageDetail> {
  const msg = (await gmailFetch(
    accountId,
    `/messages/${messageId}?format=full`,
  )) as RawMessageFull;

  const summary = mapMessageSummary(msg);
  const headers = msg.payload?.headers ?? [];

  const bodyResult: {
    bodyHtml: string | null;
    bodyText: string | null;
    attachments: { id: string; filename: string; mimeType: string; size: number }[];
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

// ── sendMessage ───────────────────────────────────────────────────────────────

function buildRfc2822(params: {
  from: string;
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  body: string;
}): string {
  const lines: string[] = [
    `From: ${params.from}`,
    `To: ${params.to}`,
  ];
  if (params.cc) lines.push(`Cc: ${params.cc}`);
  if (params.bcc) lines.push(`Bcc: ${params.bcc}`);
  lines.push(`Subject: ${params.subject}`);
  lines.push("MIME-Version: 1.0");
  lines.push("Content-Type: text/plain; charset=UTF-8");
  lines.push("Content-Transfer-Encoding: 7bit");
  lines.push("");
  lines.push(params.body);
  return lines.join("\r\n");
}

function encodeBase64url(data: string): string {
  return Buffer.from(data).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function sendMessage(
  accountId: string,
  params: { to: string; cc?: string; bcc?: string; subject: string; body: string },
): Promise<{ ok: true }> {
  const account = await getAccount(accountId);
  const fromAddress = account ? `${account.name} <${account.email}>` : accountId;

  const raw = buildRfc2822({
    from: fromAddress,
    to: params.to,
    cc: params.cc,
    bcc: params.bcc,
    subject: params.subject,
    body: params.body,
  });

  await gmailFetch(accountId, "/messages/send", {
    method: "POST",
    body: JSON.stringify({ raw: encodeBase64url(raw) }),
  });

  return { ok: true };
}

// ── getAttachment ─────────────────────────────────────────────────────────────

export async function getAttachment(
  accountId: string,
  messageId: string,
  attachmentId: string,
  filename: string,
  _mimeType: string,
): Promise<{ saved: boolean; path?: string }> {
  const data = (await gmailFetch(
    accountId,
    `/messages/${messageId}/attachments/${attachmentId}`,
  )) as { data?: string; size?: number };

  if (!data.data) {
    throw new Error(`Attachment ${attachmentId} returned no data.`);
  }

  const buffer = Buffer.from(
    data.data.replace(/-/g, "+").replace(/_/g, "/"),
    "base64",
  );

  const saveResult = await dialog.showSaveDialog({ defaultPath: filename });

  if (saveResult.canceled || !saveResult.filePath) {
    return { saved: false };
  }

  await fs.writeFile(saveResult.filePath, buffer);

  return { saved: true, path: saveResult.filePath };
}

export type { GmailLabel, GmailMessageSummary, GmailMessageDetail };
