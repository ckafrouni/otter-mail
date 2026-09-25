/**
 * attachment-cache.ts
 *
 * Local-first byte cache for Gmail attachments (userData/attachment-cache).
 * File names hash accountId:messageId:attachmentId — Gmail attachment ids run
 * far past filesystem name limits. getAttachmentData writes through it, and
 * mail-sync prefetches draft attachments so resuming a draft is instant.
 * Best-effort throughout: a cache failure must never break the mail flow.
 */

import { app } from "electron";
import { createHash } from "crypto";
import fs from "fs/promises";
import path from "path";

const MAX_CACHE_BYTES = 512 * 1024 * 1024;

let dirPromise: Promise<string> | null = null;
function getDir(): Promise<string> {
  dirPromise ??= (async () => {
    const dir = path.join(app.getPath("userData"), "attachment-cache");
    await fs.mkdir(dir, { recursive: true });
    return dir;
  })();
  return dirPromise;
}

function keyFor(accountId: string, messageId: string, attachmentId: string): string {
  return createHash("sha256").update(`${accountId}:${messageId}:${attachmentId}`).digest("hex");
}

export async function getCachedAttachment(
  accountId: string,
  messageId: string,
  attachmentId: string,
): Promise<Buffer | null> {
  try {
    const buf = await fs.readFile(
      path.join(await getDir(), keyFor(accountId, messageId, attachmentId)),
    );
    return buf.length > 0 ? buf : null;
  } catch {
    return null;
  }
}

export async function hasCachedAttachment(
  accountId: string,
  messageId: string,
  attachmentId: string,
): Promise<boolean> {
  try {
    const st = await fs.stat(path.join(await getDir(), keyFor(accountId, messageId, attachmentId)));
    return st.size > 0;
  } catch {
    return false;
  }
}

export async function putCachedAttachment(
  accountId: string,
  messageId: string,
  attachmentId: string,
  bytes: Buffer,
): Promise<void> {
  try {
    await fs.writeFile(
      path.join(await getDir(), keyFor(accountId, messageId, attachmentId)),
      bytes,
    );
  } catch {
    // best-effort
  }
}

/** Drop oldest files once the cache passes the size cap (run at startup). */
export async function pruneAttachmentCache(): Promise<void> {
  try {
    const dir = await getDir();
    const names = await fs.readdir(dir);
    const files: { p: string; size: number; mtime: number }[] = [];
    for (const name of names) {
      const p = path.join(dir, name);
      const st = await fs.stat(p).catch(() => null);
      if (st?.isFile()) files.push({ p, size: st.size, mtime: st.mtimeMs });
    }
    let total = files.reduce((sum, f) => sum + f.size, 0);
    if (total <= MAX_CACHE_BYTES) return;
    files.sort((a, b) => a.mtime - b.mtime);
    for (const f of files) {
      if (total <= MAX_CACHE_BYTES) break;
      await fs.unlink(f.p).catch(() => {});
      total -= f.size;
    }
  } catch {
    // best-effort
  }
}
