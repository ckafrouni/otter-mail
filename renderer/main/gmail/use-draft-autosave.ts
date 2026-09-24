import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { gmailApi } from "./api";
import type { ComposeAttachment } from "./types";

export type DraftSaveState = "idle" | "saving" | "saved" | "error";

/**
 * Debounced Gmail-draft autosave for the inline composers. Creates a draft on
 * the first meaningful edit, updates it in place afterwards (moving it when
 * the From account changes), retries failures, flushes on unmount, and
 * refreshes the mail lists once on the way out — never mid-edit, since every
 * draft update mints a new message id.
 */
export function useDraftAutosave({
  accountId,
  threadId,
  signal,
  getPayload,
}: {
  accountId: string | null;
  threadId?: string;
  /** Serialized editing state; every change re-arms the debounce. */
  signal: string;
  /** null = nothing worth persisting yet (e.g. empty composer). */
  getPayload: () => {
    to: string;
    cc?: string;
    bcc?: string;
    subject: string;
    body: string;
    bodyHtml: string;
    attachments?: ComposeAttachment[];
  } | null;
}) {
  const qc = useQueryClient();
  const [saveState, setSaveState] = useState<DraftSaveState>("idle");
  const draftIdRef = useRef<string | null>(null);
  const draftAccountRef = useRef<string | null>(null);
  // Thread Gmail assigned on the first save. Without pinning it, every update
  // re-threads the draft — a new list row per save until sync reconciles.
  const adoptedThreadRef = useRef<string | null>(null);
  const doneRef = useRef(false);
  const savingRef = useRef(false);
  const unmountedRef = useRef(false);
  const sessionKeyRef = useRef(crypto.randomUUID());
  const snapshotRef = useRef(signal);

  const signalRef = useRef(signal);
  signalRef.current = signal;
  const accountRef = useRef(accountId);
  accountRef.current = accountId;
  const threadRef = useRef(threadId);
  threadRef.current = threadId;
  const getPayloadRef = useRef(getPayload);
  getPayloadRef.current = getPayload;

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["gmail:messages"] });
    void qc.invalidateQueries({ queryKey: ["gmail:combinedMessages"] });
    void qc.invalidateQueries({ queryKey: ["gmail:combinedCounts"] });
    void qc.invalidateQueries({ queryKey: ["gmail:thread"] });
    void qc.invalidateQueries({ queryKey: ["gmail:labels"] });
  };
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  const save = async () => {
    const account = accountRef.current;
    if (!account || doneRef.current || savingRef.current) return;
    if (signalRef.current === snapshotRef.current) return;
    const payload = getPayloadRef.current();
    if (!payload) return;
    const snapshotAtSave = signalRef.current;
    savingRef.current = true;
    setSaveState("saving");
    try {
      // The From account changed under an existing draft — move it over.
      if (draftIdRef.current && draftAccountRef.current && draftAccountRef.current !== account) {
        try {
          await gmailApi.deleteDraft(draftAccountRef.current, draftIdRef.current);
        } catch {
          // orphan gets reconciled by sync
        }
        draftIdRef.current = null;
        adoptedThreadRef.current = null;
      }
      const res = await gmailApi.saveDraft({
        accountId: account,
        draftId: draftIdRef.current ?? undefined,
        sessionKey: sessionKeyRef.current,
        ...payload,
        threadId: threadRef.current ?? adoptedThreadRef.current ?? undefined,
      });
      draftIdRef.current = res.draftId;
      draftAccountRef.current = account;
      if (!threadRef.current && res.threadId) adoptedThreadRef.current = res.threadId;
      snapshotRef.current = snapshotAtSave;
      setSaveState("saved");
    } catch (err) {
      console.log("[useDraftAutosave:saveFailed]", { error: String(err) });
      setSaveState("error");
      // Retry while the composer is open; a closed one's last save carries on
      // in the backend (same session, so no duplicate draft).
      if (!unmountedRef.current) setTimeout(() => void triggerRef.current(), 5000);
    } finally {
      savingRef.current = false;
    }
  };
  const saveRef = useRef(save);
  saveRef.current = save;
  // The in-flight save, so finalize can await the unmount flush before
  // deleting (send path closes the composer first, optimistically).
  const pendingRef = useRef<Promise<void> | null>(null);
  const trigger = () => {
    const p = saveRef.current();
    pendingRef.current = p;
    return p;
  };
  const triggerRef = useRef(trigger);
  triggerRef.current = trigger;

  useEffect(() => {
    const timer = setTimeout(() => void triggerRef.current(), 1500);
    return () => clearTimeout(timer);
  }, [signal]);

  // Flush the last edits and refresh the lists once, on the way out.
  useEffect(
    () => () => {
      unmountedRef.current = true;
      void Promise.resolve(triggerRef.current()).finally(() => refreshRef.current());
    },
    [],
  );

  /** Stop autosaving (send/discard); optionally delete the persisted draft. */
  const finalize = async (opts?: { deleteDraft?: boolean }) => {
    doneRef.current = true;
    // A flush kicked off by unmounting may still be creating the draft.
    if (pendingRef.current) await pendingRef.current;
    // Delete through the session: the backend waits for any save still in
    // flight and removes whatever draft it became (even if its id never
    // reached us).
    const account = draftAccountRef.current ?? accountRef.current;
    if (opts?.deleteDraft && account) {
      try {
        await gmailApi.deleteSessionDraft(account, sessionKeyRef.current);
      } catch {
        // sync reconciles leftovers
      }
      draftIdRef.current = null;
    }
    refreshRef.current();
  };

  /** Re-enable autosave after a failed send. */
  const reopen = () => {
    doneRef.current = false;
  };

  return { saveState, finalize, reopen };
}
