/**
 * Gmail REST client (https://gmail.googleapis.com/gmail/v1/users/me), the
 * slice of the desktop's gmail-api.ts a phone needs: thread lists, threads,
 * label changes and sending.
 */

import { getAccessToken } from "./oauth";
import type { Header, MimePart } from "./mime";

const BASE_URL = "https://gmail.googleapis.com/gmail/v1/users/me";
const REQUEST_TIMEOUT_MS = 30_000;
/** Gmail limits by the minute; the user's own requests wait out a short burst. */
const RATE_LIMIT_RETRY_DELAYS_MS = [1000, 3000];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Gmail reports per-user quota exhaustion as 403 as well as 429. */
const isRateLimited = (status: number, body: string) =>
  status === 429 ||
  (status === 403 && /rateLimitExceeded|userRateLimitExceeded|Quota exceeded/.test(body));

export class GmailApiError extends Error {
  constructor(
    readonly status: number,
    body: string,
  ) {
    let reason = "";
    try {
      reason = (JSON.parse(body) as { error?: { message?: string } }).error?.message ?? "";
    } catch {
      reason = body.slice(0, 200);
    }
    super(
      isRateLimited(status, body)
        ? "Gmail is limiting requests for this account right now. Try again in a minute."
        : `Gmail answered ${status}${reason ? `: ${reason}` : ""}`,
    );
    this.name = "GmailApiError";
  }
}

async function gmailFetch<T>(
  accountId: string,
  path: string,
  init: { method?: string; body?: string } = {},
  attempt = 0,
  tokenRefreshed = false,
): Promise<T> {
  const token = await getAccessToken(accountId, tokenRefreshed);
  // React Native has AbortController but not AbortSignal.timeout().
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const response = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    signal: controller.signal,
  }).finally(() => clearTimeout(timeout));
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    // The access token was revoked or expired early: refresh it once.
    if (response.status === 401 && !tokenRefreshed) {
      return gmailFetch(accountId, path, init, attempt, true);
    }
    const delay = RATE_LIMIT_RETRY_DELAYS_MS[attempt];
    if (isRateLimited(response.status, body) && delay !== undefined) {
      await sleep(delay);
      return gmailFetch(accountId, path, init, attempt + 1, tokenRefreshed);
    }
    throw new GmailApiError(response.status, body);
  }
  const text = await response.text();
  return (text ? JSON.parse(text) : {}) as T;
}

/**
 * Runs `fn` over `items` with at most `concurrency` calls in flight. Results
 * keep the order of `items`.
 */
export async function mapPool<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

// ── Threads ──────────────────────────────────────────────────────────────────

export type RawMessage = {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  payload?: MimePart & { headers?: Header[] };
};

export type RawThread = { id: string; historyId: string; messages?: RawMessage[] };

export async function listThreads(
  accountId: string,
  params: { labelId?: string; query?: string; pageToken?: string; maxResults?: number },
): Promise<{ threads: { id: string; historyId: string }[]; nextPageToken?: string }> {
  const query = new URLSearchParams({ maxResults: String(params.maxResults ?? 25) });
  if (params.labelId) query.set("labelIds", params.labelId);
  if (params.query) query.set("q", params.query);
  if (params.pageToken) query.set("pageToken", params.pageToken);
  const page = await gmailFetch<{
    threads?: { id: string; historyId: string }[];
    nextPageToken?: string;
  }>(accountId, `/threads?${query}`);
  return { threads: page.threads ?? [], nextPageToken: page.nextPageToken };
}

const METADATA_HEADERS = ["From", "To", "Cc", "Subject", "Message-ID", "References"]
  .map((name) => `metadataHeaders=${name}`)
  .join("&");

/** A thread with its messages' headers, or null when Gmail no longer has it. */
export async function getThread(
  accountId: string,
  threadId: string,
  format: "metadata" | "full",
): Promise<RawThread | null> {
  const query = format === "metadata" ? `format=metadata&${METADATA_HEADERS}` : "format=full";
  try {
    return await gmailFetch<RawThread>(accountId, `/threads/${threadId}?${query}`);
  } catch (err) {
    if (err instanceof GmailApiError && err.status === 404) return null;
    throw err;
  }
}

export async function modifyThread(
  accountId: string,
  threadId: string,
  change: { add?: string[]; remove?: string[] },
): Promise<void> {
  await gmailFetch(accountId, `/threads/${threadId}/modify`, {
    method: "POST",
    body: JSON.stringify({ addLabelIds: change.add ?? [], removeLabelIds: change.remove ?? [] }),
  });
}

export async function trashThread(accountId: string, threadId: string): Promise<void> {
  await gmailFetch(accountId, `/threads/${threadId}/trash`, { method: "POST" });
}

/** Sends a base64url RFC 822 message (see mime.ts), in `threadId` when replying. */
export async function sendRawMessage(
  accountId: string,
  raw: string,
  threadId?: string,
): Promise<{ id: string; threadId: string }> {
  return gmailFetch(accountId, "/messages/send", {
    method: "POST",
    body: JSON.stringify(threadId ? { raw, threadId } : { raw }),
  });
}
