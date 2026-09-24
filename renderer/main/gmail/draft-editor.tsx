import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { toast } from "@glaze/core/components";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FileIcon, PaperclipIcon, SendHorizontalIcon, Trash2Icon, XIcon } from "lucide-react";
import { useGetAttachment, usePruneThreadRows, useSendMessage } from "./hooks";
import { gmailApi } from "./api";
import { RichTextArea, textToHtml, type RichTextRef } from "./rich-text";
import { RecipientInput } from "./recipient-input";
import { IconBtn, HintTooltip } from "./ui";
import { parseAddressEntry, splitAddressList } from "./address";
import {
  CollapsedRow,
  DayDivider,
  ExpandedRow,
  dayKey,
  type DownloadAttachment,
} from "./message-reader";
import {
  AttachmentChips,
  ComposeDropOverlay,
  attachmentSignature,
  filesToComposeAttachments,
  pickComposeAttachments,
  useComposeFileDrop,
} from "./compose-attachments";
import type { ComposeAttachment, GmailMessageDetail, GmailMessageSummary } from "./types";

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
  titleTrailing,
}: {
  accountId: string;
  detail: GmailMessageDetail;
  threadMessages: GmailMessageSummary[];
  onDone: () => void;
  /** Right end of the window's title band (panel toggle). */
  titleTrailing?: ReactNode;
}) {
  const qc = useQueryClient();
  const [to, setTo] = useState(detail.to ?? "");
  const [cc, setCc] = useState(detail.cc ?? "");
  const [ccVisible, setCcVisible] = useState(!!detail.cc);
  const [bcc, setBcc] = useState(detail.bcc ?? "");
  const [bccVisible, setBccVisible] = useState(!!detail.bcc);
  const [subject, setSubject] = useState(detail.subject ?? "");
  const [text, setText] = useState(detail.bodyText ?? "");
  const [sending, setSending] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const editorRef = useRef<RichTextRef>(null);

  const sendMessage = useSendMessage();
  const pruneThreadRows = usePruneThreadRows();
  const getAttachment = useGetAttachment();

  // Reply drafts show their conversation above the composer, exactly like the
  // reader's in-thread reply flow. The draft itself stays out of the cards —
  // its content IS the composer.
  const conversation = threadMessages.filter((m) => !m.labelIds.includes("DRAFT"));
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(
    () => new Set(conversation.length > 0 ? [conversation[conversation.length - 1].id] : []),
  );
  const toggleExpanded = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  // Open on the latest message, like a fresh reply.
  const conversationRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = conversationRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  const handleDownloadAttachment: DownloadAttachment = (
    messageId,
    attachmentId,
    filename,
    mimeType,
  ) => {
    console.log("[DraftEditor:downloadAttachment]", { messageId, filename });
    void (async () => {
      try {
        const result = await getAttachment.mutateAsync({
          accountId,
          messageId,
          attachmentId,
          filename,
          mimeType,
        });
        if (result.saved && result.path) toast.success(`Saved to ${result.path}`);
        else toast.error("Failed to save attachment");
      } catch {
        toast.error("Could not download attachment");
      }
    })();
  };

  // The draft's files must be back in memory before any save: saveDraft
  // rewrites the whole message, so a save without them silently drops the
  // attachments server-side. null = still loading (autosave and send stay
  // suspended until then).
  const [attachments, setAttachments] = useState<ComposeAttachment[] | null>(
    detail.attachments.length === 0 ? [] : null,
  );
  const [attachLoadFailed, setAttachLoadFailed] = useState(false);
  // Baseline set once the originals are loaded, so merely opening a draft
  // never re-uploads it.
  const attSnapshotRef = useRef<string | null>(detail.attachments.length === 0 ? "" : null);

  const loadAttachments = async () => {
    setAttachLoadFailed(false);
    setAttachments(null);
    try {
      const out: ComposeAttachment[] = [];
      for (const att of detail.attachments) {
        const data = await gmailApi.getAttachmentData({
          accountId,
          messageId: detail.id,
          attachmentId: att.id,
        });
        out.push({
          name: att.filename,
          mimeType: att.mimeType,
          size: data.size,
          base64: data.base64,
        });
      }
      attSnapshotRef.current ??= attachmentSignature(out);
      setAttachments(out);
    } catch (err) {
      console.log("[DraftEditor:attachmentsLoadFailed]", { error: String(err) });
      setAttachLoadFailed(true);
      toast.error("Could not load the draft's attachments");
    }
  };
  const loadAttachmentsRef = useRef(loadAttachments);
  loadAttachmentsRef.current = loadAttachments;
  useEffect(() => {
    if (detail.attachments.length > 0) void loadAttachmentsRef.current();
  }, []);

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
      bcc,
      subject,
      plain: (editorRef.current?.getText() ?? "").trim(),
    });
  }, []);

  const save = async () => {
    if (doneRef.current || savingRef.current || snapshotRef.current == null) return;
    if (attachments == null || attSnapshotRef.current == null) return;
    const plain = editorRef.current?.getText() ?? text;
    const html = editorRef.current?.getHTML() ?? textToHtml(plain);
    const serialized = JSON.stringify({ to, cc, bcc, subject, plain: plain.trim() });
    const attSig = attachmentSignature(attachments);
    if (serialized === snapshotRef.current && attSig === attSnapshotRef.current) return;
    savingRef.current = true;
    setSaveState("saving");
    try {
      const res = await gmailApi.saveDraft({
        accountId,
        draftId: draftIdRef.current ?? undefined,
        to,
        cc: cc.trim() || undefined,
        bcc: bcc.trim() || undefined,
        subject,
        body: plain,
        bodyHtml: `<div dir="auto">${html}</div>`,
        attachments: attachments.length > 0 ? attachments : undefined,
        threadId: detail.threadId || undefined,
      });
      draftIdRef.current = res.draftId;
      snapshotRef.current = serialized;
      attSnapshotRef.current = attSig;
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
  }, [to, cc, bcc, subject, text, attachments, draftIdQuery.isFetched]);

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
  const canSend =
    !sending &&
    hasRecipient &&
    attachments != null &&
    (text.trim().length > 0 || subject.trim().length > 0);

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
        bcc: bcc.trim() || undefined,
        subject: subject.trim() || "(no subject)",
        body: plain,
        bodyHtml: html,
        attachments: attachments && attachments.length > 0 ? attachments : undefined,
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

  // Drop-to-attach is suspended until the draft's originals are back in memory
  // (attachments == null), so a drop can't drop them from the next save.
  const { isDragging, dropProps } = useComposeFileDrop((files) => {
    void filesToComposeAttachments(files, attachments ?? []).then((picked) => {
      if (picked.length > 0) setAttachments((prev) => [...(prev ?? []), ...picked]);
    });
  }, attachments == null);

  const recipientRow = "flex items-center gap-2 border-b border-border px-3 py-1.5";
  const fieldInput =
    "min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-placeholder";

  return (
    <div className="relative flex h-full min-w-0 flex-col" {...dropProps}>
      <ComposeDropOverlay visible={isDragging} />
      <div
        data-toolbar=""
        className="drag-region flex h-(--workspace-topbar-height) shrink-0 items-center gap-2 border-b border-border px-4"
      >
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium leading-tight text-foreground">
            {subject.trim() || "Draft"}
          </div>
          <div className="truncate text-xs leading-tight text-muted-foreground">
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
        <HintTooltip label="Close" hint="Esc" side="bottom">
          <IconBtn label="Close" onClick={onDone}>
            <XIcon className="size-4" />
          </IconBtn>
        </HintTooltip>
        {titleTrailing ? (
          <span className="ml-1 flex items-center gap-1">{titleTrailing}</span>
        ) : null}
      </div>

      {conversation.length > 0 ? (
        <div ref={conversationRef} className="te-scroll min-h-0 flex-1 overflow-y-auto pb-2">
          {conversation.map((m, i) => {
            const prev = conversation[i - 1];
            const newDay = !prev || dayKey(prev.date) !== dayKey(m.date);
            const isExpanded = expandedIds.has(m.id);
            return (
              <div key={m.id}>
                {newDay ? <DayDivider timestamp={m.date} /> : null}
                {isExpanded ? (
                  <ExpandedRow
                    accountId={accountId}
                    summary={m}
                    onCollapse={() => toggleExpanded(m.id)}
                    onDownload={handleDownloadAttachment}
                  />
                ) : (
                  <CollapsedRow
                    accountId={accountId}
                    summary={m}
                    onExpand={() => toggleExpanded(m.id)}
                  />
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-1.5 overflow-hidden px-6 text-center">
          <span className="flex size-11 items-center justify-center rounded-full border border-input">
            <FileIcon className="size-5 text-muted-foreground" />
          </span>
          <span className="pt-1 text-sm font-medium text-foreground">
            Pick up where you left off
          </span>
          <span className="text-sm text-muted-foreground">
            Changes save back to this draft as you type.
          </span>
        </div>
      )}

      <div className="shrink-0 px-5 pb-4 pt-1" data-inline-compose="">
        <div
          className="rounded-2xl border border-(--chat-composer-outline) bg-(--chat-composer-surface) shadow-composer transition-colors focus-within:border-input dark:shadow-none dark:inset-shadow-2xs dark:inset-shadow-(color:--chat-composer-highlight)"
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              handleSend();
            }
          }}
        >
          <div className={recipientRow}>
            <span className="shrink-0 text-xs font-medium text-muted-foreground">To</span>
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
                className="shrink-0 text-2xs text-muted-foreground/70 hover:text-foreground"
              >
                Cc
              </button>
            ) : null}
            {!bccVisible ? (
              <button
                type="button"
                onClick={() => setBccVisible(true)}
                className="shrink-0 text-2xs text-muted-foreground/70 hover:text-foreground"
              >
                Bcc
              </button>
            ) : null}
          </div>
          {ccVisible ? (
            <div className={recipientRow}>
              <span className="shrink-0 text-xs font-medium text-muted-foreground">Cc</span>
              <RecipientInput value={cc} onChange={setCc} ariaLabel="Cc" />
            </div>
          ) : null}
          {bccVisible ? (
            <div className={recipientRow}>
              <span className="shrink-0 text-xs font-medium text-muted-foreground">Bcc</span>
              <RecipientInput value={bcc} onChange={setBcc} ariaLabel="Bcc" />
            </div>
          ) : null}
          <div className={recipientRow}>
            <span className="shrink-0 text-xs font-medium text-muted-foreground">Subject</span>
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
            minHeightClass="min-h-[36vh]"
            initialHTML={
              detail.bodyHtml ?? (detail.bodyText ? textToHtml(detail.bodyText) : undefined)
            }
          />
          <AttachmentChips
            attachments={attachments}
            onRemove={(i) => setAttachments((prev) => (prev ?? []).filter((_, j) => j !== i))}
          />
          <div className="flex items-center gap-1 px-2 pb-1.5">
            <HintTooltip label="Attach files">
              <IconBtn
                label="Attach files"
                className="size-7"
                disabled={attachments == null}
                onClick={() => {
                  void pickComposeAttachments(attachments ?? []).then((picked) => {
                    if (picked.length > 0) setAttachments((prev) => [...(prev ?? []), ...picked]);
                  });
                }}
              >
                <PaperclipIcon className="size-3.5" />
              </IconBtn>
            </HintTooltip>
            <HintTooltip label="Delete draft">
              <IconBtn label="Delete draft" className="size-7" onClick={handleDiscard}>
                <Trash2Icon className="size-3.5" />
              </IconBtn>
            </HintTooltip>
            {attachments == null ? (
              attachLoadFailed ? (
                <span className="pl-1 text-xs text-destructive-foreground">
                  Couldn't load attachments —{" "}
                  <button
                    type="button"
                    onClick={() => void loadAttachments()}
                    className="underline hover:text-foreground"
                  >
                    retry
                  </button>
                </span>
              ) : (
                <span className="pl-1 text-xs text-muted-foreground">Loading attachments…</span>
              )
            ) : null}
            <span className="flex-1" />
            {canSend ? <span className="pr-1 text-xs text-muted-foreground">⌘↩ send</span> : null}
            <button
              type="button"
              onClick={handleSend}
              disabled={!canSend}
              aria-label="Send"
              className="inline-flex h-7 w-9 items-center justify-center rounded-[var(--control-radius)] border border-primary bg-primary text-primary-foreground shadow-xs shadow-primary/24 transition-[box-shadow,scale] not-disabled:inset-shadow-[0_1px_rgb(255_255_255/16%)] hover:bg-primary/90 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-64"
            >
              <SendHorizontalIcon className="size-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
