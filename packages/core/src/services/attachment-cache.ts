/**
 * attachment-cache.ts
 *
 * Local-first byte cache for Gmail attachments (the app's attachment-cache/
 * folder). File names hash accountId:messageId:attachmentId — Gmail
 * attachment ids run far past filesystem name limits. getAttachmentBytes
 * writes through it, and mail-sync prefetches draft attachments so resuming a
 * draft is instant. Best-effort throughout: a cache failure must never break
 * the mail flow.
 */

import { sha256Hex } from "../bytes.js";
import { platform } from "../platform.js";

const DIR = "attachment-cache";
const MAX_CACHE_BYTES = 512 * 1024 * 1024;

async function pathFor(accountId: string, messageId: string, attachmentId: string) {
  return `${DIR}/${await sha256Hex(`${accountId}:${messageId}:${attachmentId}`)}`;
}

export async function getCachedAttachment(
  accountId: string,
  messageId: string,
  attachmentId: string,
): Promise<Uint8Array | null> {
  try {
    const bytes = await platform().files.read(await pathFor(accountId, messageId, attachmentId));
    return bytes && bytes.length > 0 ? bytes : null;
  } catch {
    return null;
  }
}

export async function hasCachedAttachment(
  accountId: string,
  messageId: string,
  attachmentId: string,
): Promise<boolean> {
  return (await getCachedAttachment(accountId, messageId, attachmentId)) !== null;
}

export async function putCachedAttachment(
  accountId: string,
  messageId: string,
  attachmentId: string,
  bytes: Uint8Array,
): Promise<void> {
  try {
    await platform().files.write(await pathFor(accountId, messageId, attachmentId), bytes);
  } catch {
    // best-effort
  }
}

/** Drop oldest files once the cache passes the size cap (run at startup). */
export async function pruneAttachmentCache(): Promise<void> {
  try {
    const files = await platform().files.list(DIR);
    let total = files.reduce((sum, f) => sum + f.size, 0);
    if (total <= MAX_CACHE_BYTES) return;
    files.sort((a, b) => a.modifiedAt - b.modifiedAt);
    for (const f of files) {
      if (total <= MAX_CACHE_BYTES) break;
      await platform()
        .files.remove(`${DIR}/${f.name}`)
        .catch(() => {});
      total -= f.size;
    }
  } catch {
    // best-effort
  }
}
