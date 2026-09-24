/**
 * Draft sessions: one per open composer. Saves for a session run in order and
 * reuse its draft id, so a first save whose reply never reached the renderer
 * (IPC timeout) can't lead to a second draft.
 */

import { fetchMetadataForIds } from "../services/gmail-api.js";
import * as mailStore from "../services/mail-store.js";

// ── Draft sessions (one per open composer) ──────────────────────────────────

/** Draft id per composer session, `${accountId}|${sessionKey}`. */
const draftSessions = new Map<string, string>();
/** The tail of each session's save queue. */
const draftSaveQueues = new Map<string, Promise<unknown>>();

export const draftSessionId = (accountId: string, sessionKey: string | undefined) =>
  sessionKey ? `${accountId}|${sessionKey}` : "";

/** Runs a session's saves one after another (no session: runs directly). */
export function queueDraftSave<T>(sessionId: string, save: () => Promise<T>): Promise<T> {
  if (!sessionId) return save();
  const previous = draftSaveQueues.get(sessionId) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(save);
  draftSaveQueues.set(sessionId, next);
  void next
    .finally(() => {
      if (draftSaveQueues.get(sessionId) === next) draftSaveQueues.delete(sessionId);
    })
    .catch(() => {});
  return next;
}

/** Mirrors a saved draft into the cache so Drafts updates before the next
    sync. Best effort: the draft is already saved in Gmail. */
export async function mirrorDraft(
  accountId: string,
  res: { messageId?: string; threadId?: string },
): Promise<void> {
  if (!res.messageId) return;
  try {
    mailStore.upsertMessages(accountId, await fetchMetadataForIds(accountId, [res.messageId]));
    if (res.threadId) mailStore.deleteOtherDraftsInThread(accountId, res.threadId, res.messageId);
  } catch (err) {
    console.log("[gmail:saveDraft] saved; local mirror failed", { error: String(err) });
  }
}

/** The draft id a session's saves have produced so far, if any. */
export function sessionDraftId(sessionId: string): string | undefined {
  return sessionId ? draftSessions.get(sessionId) : undefined;
}

export function rememberSessionDraft(sessionId: string, draftId: string): void {
  if (sessionId) draftSessions.set(sessionId, draftId);
}

/** Ends a session: waits for its queued saves, then returns (and forgets) the
    draft id they produced. */
export async function takeSessionDraft(sessionId: string): Promise<string | undefined> {
  if (!sessionId) return undefined;
  await draftSaveQueues.get(sessionId)?.catch(() => {});
  const draftId = draftSessions.get(sessionId);
  draftSessions.delete(sessionId);
  return draftId;
}
