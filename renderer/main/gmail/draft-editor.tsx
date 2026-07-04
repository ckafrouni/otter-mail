import { useEffect, useRef, useState } from "react";
import { toast } from "@glaze/core/components";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FileIcon, SendHorizontalIcon, Trash2Icon, XIcon } from "lucide-react";
import { useSendMessage } from "./hooks";
import { gmailApi } from "./api";
import { RichTextArea, textToHtml, type RichTextRef } from "./rich-text";
import { RecipientInput } from "./recipient-input";
import { IconBtn, HintTooltip } from "./slack-ui";
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
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const editorRef = useRef<RichTextRef>(null);

  const sendMessage = useSendMessage();

  // Which Gmail draft owns this message row (drafts.list lookup).
  const draftIdRef = useRef<string | null>(null);
  const draftIdQuery = useQuery({
    queryKey: ["gmail:draftId", accountId, detail.id],
    queryFn: () => gmailApi.getDraftForMessage(accountId, detail.id),
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
  const snapshotRef = useRef(
    JSON.stringify({
      to: detail.to ?? "",
      cc: detail.cc ?? "",
      subject: detail.subject ?? "",
      plain: (detail.bodyText ?? "").trim(),
    }),
  );

  const save = async () => {
    if (doneRef.current || savingRef.current) return;
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
      refreshDraftLists();
    } catch {
      setSaveState("idle"); // retried on the next edit tick
    } finally {
      savingRef.current = false;
    }
  };
  const saveRef = useRef(save);
  saveRef.current = save;

  useEffect(() => {
    if (!draftIdQuery.isFetched) return;
    const timer = setTimeout(() => void saveRef.current(), 1500);
    return () => clearTimeout(timer);
  }, [to, cc, subject, text, draftIdQuery.isFetched]);

  useEffect(() => () => void saveRef.current(), []);

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
    doneRef.current = true;
    setSending(true);
    const plain = editorRef.current?.getText() ?? text;
    const html = `<div dir="auto">${editorRef.current?.getHTML() ?? textToHtml(plain)}</div>`;
    // Reply drafts thread onto the newest non-draft message in the conversation.
    const others = threadMessages.filter((m) => !m.labelIds.includes("DRAFT"));
    const last = others[others.length - 1];
    console.log("[DraftEditor:send]", { draftId: draftIdRef.current, threaded: !!last });
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
          onDone();
        },
        () => {
          doneRef.current = false;
          setSending(false);
          toast.error("Could not send the message");
        },
      );
  };

  const handleDiscard = () => {
    doneRef.current = true;
    console.log("[DraftEditor:discard]", { draftId: draftIdRef.current });
    void (async () => {
      try {
        if (draftIdRef.current) await gmailApi.deleteDraft(accountId, draftIdRef.current);
      } catch {
        toast.error("Could not delete the draft");
      }
      refreshDraftLists();
      onDone();
    })();
  };

  const recipientRow = "flex items-center gap-2 border-b border-(--sk-border) px-3 py-1.5";
  const fieldInput =
    "min-w-0 flex-1 bg-transparent text-[13px] text-(--sk-strong) outline-none placeholder:text-(--sk-faint)";

  return (
    <div className="flex h-full min-w-0 flex-col">
      <div className="drag-region flex h-[52px] shrink-0 items-center gap-2 border-b border-(--sk-border) px-4">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[16px] font-extrabold leading-tight text-(--sk-strong)">
            {subject.trim() || "Draft"}
          </div>
          <div className="truncate text-[11px] leading-tight text-(--sk-muted)">
            Draft · {saveState === "saving" ? "saving…" : "saves automatically"}
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
        <span className="flex size-11 items-center justify-center rounded-xl bg-(--sk-ctl)">
          <FileIcon className="size-5 text-(--sk-muted)" />
        </span>
        <span className="pt-1 text-[15px] font-bold text-(--sk-text)">Pick up where you left off</span>
        <span className="text-[13px] text-(--sk-muted)">
          Changes save back to this draft as you type.
        </span>
      </div>

      <div className="shrink-0 px-5 pb-4 pt-1" data-inline-compose="">
        <div
          className="rounded-lg border border-(--sk-outline) bg-(--sk-panel) focus-within:border-(--sk-outline-hover)"
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              handleSend();
            }
          }}
        >
          <div className={recipientRow}>
            <span className="shrink-0 text-[12px] text-(--sk-faint)">To</span>
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
                className="shrink-0 text-[11px] text-(--sk-faint) hover:text-(--sk-strong)"
              >
                Cc
              </button>
            ) : null}
          </div>
          {ccVisible ? (
            <div className={recipientRow}>
              <span className="shrink-0 text-[12px] text-(--sk-faint)">Cc</span>
              <RecipientInput value={cc} onChange={setCc} ariaLabel="Cc" />
            </div>
          ) : null}
          <div className={recipientRow}>
            <span className="shrink-0 text-[12px] text-(--sk-faint)">Subject</span>
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
            {canSend ? <span className="pr-1 text-[11px] text-(--sk-faint)">⌘↩ to send</span> : null}
            <button
              type="button"
              onClick={handleSend}
              disabled={!canSend}
              aria-label="Send"
              className="flex h-7 w-9 items-center justify-center rounded-md bg-(--sk-green) text-white hover:brightness-110 disabled:bg-(--sk-ctl) disabled:text-(--sk-faint)"
            >
              <SendHorizontalIcon className="size-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
