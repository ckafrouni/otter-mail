import { useEffect, useRef, useState } from "react";
import { toast } from "@glaze/core/components";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FileIcon, SendHorizontalIcon, Trash2Icon, XIcon } from "lucide-react";
import { usePruneThreadRows, useSendMessage } from "./hooks";
import { gmailApi } from "./api";
import { RichTextArea, textToHtml, type RichTextRef } from "./rich-text";
import { RecipientInput } from "./recipient-input";
import { IconBtn, HintTooltip } from "./te-ui";
import { parseAddressEntry, splitAddressList } from "./address";
import type { GmailMessageDetail, GmailMessageSummary } from "./types";

/**
 * Resume editing a Gmail draft in the composer pane. Autosaves over the same
 * draft (updates mint new message ids — the pane stays keyed to the opened
 * row while the lists refresh); sending deletes the draft.
 */
export function DraftEditor({
  accountId,
  detail,
  threadMessages,
  onDone,
}: {
  accountId: string;
  detail: GmailMessageDetail;
  threadMessages: GmailMessageSummary[];
  onDone: () => void;
}) {
  const qc = useQueryClient();
  const [to, setTo] = useState(detail.to ?? "");
  const [cc, setCc] = useState(detail.cc ?? "");
  const [ccVisible, setCcVisible] = useState(!!detail.cc);
  const [subject, setSubject] = useState(detail.subject ?? "");
  const [text, setText] = useState(detail.bodyText ?? "");
  const [sending, setSending] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const editorRef = useRef<RichTextRef>(null);

  const sendMessage = useSendMessage();
  const pruneThreadRows = usePruneThreadRows();

  // Which Gmail draft owns this message row (drafts.list lookup).
  const draftIdRef = useRef<string | null>(null);
  const draftIdQuery = useQuery({
    queryKey: ["gmail:draftId", accountId, detail.id],
    queryFn: () => gmailApi.getDraftForMessage(accountId, detail.id, detail.threadId),
    staleTime: Infinity,
    retry: false,
  });
  useEffect(() => {
    if (draftIdQuery.data && draftIdRef.current == null) {
      draftIdRef.current = draftIdQuery.data.draftId;
    }
  }, [draftIdQuery.data]);

  const refreshDraftLists = () => {
    void qc.invalidateQueries({ queryKey: ["gmail:messages", accountId] });
    void qc.invalidateQueries({ queryKey: ["gmail:combinedMessages"] });
    void qc.invalidateQueries({ queryKey: ["gmail:combinedCounts"] });
    void qc.invalidateQueries({ queryKey: ["gmail:thread", accountId] });
    void qc.invalidateQueries({ queryKey: ["gmail:labels", accountId] });
  };

  // Autosave: debounced while editing, flushed on unmount, suppressed once
  // sent/discarded.
  const doneRef = useRef(false);
  const savingRef = useRef(false);
  const snapshotRef = useRef<string | null>(null);
  // Baseline AFTER the editor seeds (child mount effects run first): the
  // editor's own text extraction never matches bodyText byte-for-byte, and a
  // bodyText baseline made merely opening a draft look dirty and re-save it.
  useEffect(() => {
    snapshotRef.current = JSON.stringify({
      to,
      cc,
      subject,
      plain: (editorRef.current?.getText() ?? "").trim(),
    });
  }, []);

  const save = async () => {
    if (doneRef.current || savingRef.current || snapshotRef.current == null) return;
    const plain = editorRef.current?.getText() ?? text;
    const html = editorRef.current?.getHTML() ?? textToHtml(plain);
    const serialized = JSON.stringify({ to, cc, subject, plain: plain.trim() });
    if (serialized === snapshotRef.current) return;
    savingRef.current = true;
    setSaveState("saving");
    try {
      const res = await gmailApi.saveDraft({
        accountId,
        draftId: draftIdRef.current ?? undefined,
        to,
        cc: cc.trim() || undefined,
        subject,
        body: plain,
        bodyHtml: `<div dir="auto">${html}</div>`,
        threadId: detail.threadId || undefined,
      });
      draftIdRef.current = res.draftId;
      snapshotRef.current = serialized;
      setSaveState("saved");
      // Lists refresh on close, not per save — every save mints a new message
      // id, and refetching mid-edit made the selected row vanish.
    } catch (err) {
      console.log("[DraftEditor:saveFailed]", { error: String(err) });
      setSaveState("error");
      setTimeout(() => void triggerRef.current(), 5000);
    } finally {
      savingRef.current = false;
    }
  };
  const saveRef = useRef(save);
  saveRef.current = save;
  const pendingSaveRef = useRef<Promise<void> | null>(null);
  const trigger = () => {
    const p = saveRef.current();
    pendingSaveRef.current = p;
    return p;
  };
  const triggerRef = useRef(trigger);
  triggerRef.current = trigger;

  useEffect(() => {
    if (!draftIdQuery.isFetched) return;
    const timer = setTimeout(() => void triggerRef.current(), 1500);
    return () => clearTimeout(timer);
  }, [to, cc, subject, text, draftIdQuery.isFetched]);

  // Flush the last edits and refresh the draft lists once, on the way out.
  const refreshRef = useRef(refreshDraftLists);
  refreshRef.current = refreshDraftLists;
  useEffect(
    () => () => {
      void Promise.resolve(triggerRef.current()).finally(() => refreshRef.current());
    },
    [],
  );

  // Escape returns to the list (the draft keeps autosaving).
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const el = e.target as Element | null;
      if (el && typeof el.closest === "function" && el.closest('[role="dialog"]')) return;
      if (el && typeof el.closest === "function" && el.closest('[data-ac-open="true"]')) return;
      e.preventDefault();
      e.stopPropagation();
      onDone();
    };
    window.addEventListener("keydown", down, true);
    return () => window.removeEventListener("keydown", down, true);
  }, [onDone]);

  const hasRecipient = splitAddressList(to).some((e) => parseAddressEntry(e).email.includes("@"));
  const canSend = !sending && hasRecipient && (text.trim().length > 0 || subject.trim().length > 0);

  const handleSend = () => {
    if (!canSend) return;
    setSending(true);
    const plain = editorRef.current?.getText() ?? text;
    const html = `<div dir="auto">${editorRef.current?.getHTML() ?? textToHtml(plain)}</div>`;
    // Reply drafts thread onto the newest non-draft message in the conversation.
    const others = threadMessages.filter((m) => !m.labelIds.includes("DRAFT"));
    const last = others[others.length - 1];
    console.log("[DraftEditor:send]", { draftId: draftIdRef.current, threaded: !!last });
    // Optimistic: the draft row leaves the list and the editor closes now; a
    // failed send restores the row (the draft still exists server-side).
    pruneThreadRows(accountId, detail.threadId || detail.id);
    onDone();
    sendMessage
      .mutateAsync({
        accountId,
        to,
        cc: cc.trim() || undefined,
        subject: subject.trim() || "(no subject)",
        body: plain,
        bodyHtml: html,
        ...(last ? { threadId: detail.threadId, replyToMessageId: last.id } : {}),
      })
      .then(
        async () => {
          doneRef.current = true;
          // The unmount flush may still be saving a backup — let it land first.
          if (pendingSaveRef.current) await pendingSaveRef.current;
          const draftId = draftIdRef.current;
          if (draftId) {
            try {
              await gmailApi.deleteDraft(accountId, draftId);
            } catch {
              // the sent copy exists either way; sync reconciles the leftover
            }
          }
          refreshDraftLists();
          toast.success("Sent");
        },
        () => {
          refreshDraftLists();
          toast.error("Couldn't send — kept in Drafts");
        },
      );
  };

  const handleDiscard = () => {
    doneRef.current = true;
    console.log("[DraftEditor:discard]", { draftId: draftIdRef.current });
    // Optimistic: the row disappears and the editor closes immediately.
    pruneThreadRows(accountId, detail.threadId || detail.id);
    onDone();
    void (async () => {
      try {
        if (draftIdRef.current) await gmailApi.deleteDraft(accountId, draftIdRef.current);
      } catch {
        toast.error("Could not delete the draft");
      }
      refreshDraftLists();
    })();
  };

  const recipientRow = "flex items-center gap-2 border-b border-(--te-border) px-3 py-1.5";
  const fieldInput =
    "min-w-0 flex-1 bg-transparent text-[13px] text-(--te-strong) outline-none placeholder:text-(--te-faint)";

  return (
    <div className="flex h-full min-w-0 flex-col">
      <div className="drag-region flex h-[52px] shrink-0 items-center gap-2 border-b border-(--te-border) px-4">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-bold leading-tight tracking-tight text-(--te-strong)">
            {subject.trim() || "Draft"}
          </div>
          <div className="te-label truncate leading-tight text-(--te-muted)">
            Draft ·{" "}
            {saveState === "saving"
              ? "saving…"
              : saveState === "saved"
                ? "saved"
                : saveState === "error"
                  ? "couldn't save — retrying"
                  : "saves automatically"}
          </div>
        </div>
        <HintTooltip label="Delete draft">
          <IconBtn label="Delete draft" onClick={handleDiscard}>
            <Trash2Icon className="size-4" />
          </IconBtn>
        </HintTooltip>
        <HintTooltip label="Close" hint="Esc">
          <IconBtn label="Close" onClick={onDone}>
            <XIcon className="size-4" />
          </IconBtn>
        </HintTooltip>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center gap-1.5 px-6 text-center">
        <span className="flex size-11 items-center justify-center rounded-full border border-(--te-outline)">
          <FileIcon className="size-5 text-(--te-muted)" />
        </span>
        <span className="pt-1 text-[15px] font-bold text-(--te-text)">Pick up where you left off</span>
        <span className="text-[13px] text-(--te-muted)">
          Changes save back to this draft as you type.
        </span>
      </div>

      <div className="shrink-0 px-5 pb-4 pt-1" data-inline-compose="">
        <div
          className="rounded-[6px] border border-(--te-outline) bg-(--te-panel) focus-within:border-(--te-outline-hover)"
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              handleSend();
            }
          }}
        >
          <div className={recipientRow}>
            <span className="te-label shrink-0 text-(--te-faint)">To</span>
            <RecipientInput
              value={to}
              onChange={setTo}
              placeholder="recipient@example.com"
              ariaLabel="To"
            />
            {!ccVisible ? (
              <button
                type="button"
                onClick={() => setCcVisible(true)}
                className="shrink-0 text-[11px] text-(--te-faint) hover:text-(--te-strong)"
              >
                Cc
              </button>
            ) : null}
          </div>
          {ccVisible ? (
            <div className={recipientRow}>
              <span className="te-label shrink-0 text-(--te-faint)">Cc</span>
              <RecipientInput value={cc} onChange={setCc} ariaLabel="Cc" />
            </div>
          ) : null}
          <div className={recipientRow}>
            <span className="te-label shrink-0 text-(--te-faint)">Subject</span>
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="What's this about?"
              aria-label="Subject"
              className={fieldInput}
            />
          </div>

          <RichTextArea
            ref={editorRef}
            placeholder="Write your message…"
            ariaLabel="Message"
            onTextChange={setText}
            autoFocus
            minHeightClass="min-h-[72px]"
            initialHTML={
              detail.bodyHtml ?? (detail.bodyText ? textToHtml(detail.bodyText) : undefined)
            }
          />
          <div className="flex items-center gap-1 px-2 pb-1.5">
            <span className="flex-1" />
            {canSend ? <span className="te-label pr-1 text-(--te-faint)">⌘↩ send</span> : null}
            <button
              type="button"
              onClick={handleSend}
              disabled={!canSend}
              aria-label="Send"
              className="flex h-7 w-9 items-center justify-center rounded-[5px] bg-(--te-accent) text-white hover:brightness-110 disabled:bg-(--te-ctl) disabled:text-(--te-faint)"
            >
              <SendHorizontalIcon className="size-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
