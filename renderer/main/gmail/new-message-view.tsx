import { useEffect, useRef, useState } from "react";
import { toast } from "@glaze/core/components";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "./menu";
import {
  ChevronDownIcon,
  PaperclipIcon,
  PenLineIcon,
  SendHorizontalIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { useSendMessage } from "./hooks";
import { parseAddressEntry, splitAddressList } from "./address";
import { getAccountColor } from "./account-style";
import { IconBtn, HintTooltip } from "./ui";
import { matchesCommand } from "../keybindings/dispatch";
import { ShortcutText } from "../keybindings/store";
import { RichTextArea, textToHtml, type RichTextRef } from "./rich-text";
import {
  AttachmentChips,
  ComposeDropOverlay,
  attachmentSignature,
  filesToComposeAttachments,
  pickComposeAttachments,
  useComposeFileDrop,
} from "./compose-attachments";
import { useDraftAutosave } from "./use-draft-autosave";
import { RecipientInput } from "./recipient-input";
import type { ComposeAttachment, GmailAccount } from "./types";

/**
 * "New chat" pane: replaces the reader when composing a fresh email —
 * recipients, subject, attachments, and body in the docked composer,
 * autosaving to a Gmail draft as you type.
 */
export function NewMessageView({
  accounts,
  defaultAccountId,
  onClose,
  prefill,
}: {
  accounts: GmailAccount[];
  defaultAccountId: string;
  onClose: () => void;
  /** Seeds the composer once at mount (mailto: links); remount to re-seed. */
  prefill?: { to?: string; cc?: string; subject?: string; body?: string };
}) {
  const [fromId, setFromId] = useState(defaultAccountId);
  const [to, setTo] = useState(prefill?.to ?? "");
  const [cc, setCc] = useState(prefill?.cc ?? "");
  const [ccVisible, setCcVisible] = useState(Boolean(prefill?.cc));
  const [bcc, setBcc] = useState("");
  const [bccVisible, setBccVisible] = useState(false);
  const [subject, setSubject] = useState(prefill?.subject ?? "");
  const [text, setText] = useState(prefill?.body ?? "");
  const [attachments, setAttachments] = useState<ComposeAttachment[]>([]);
  const toRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<RichTextRef>(null);
  const sendMessage = useSendMessage();

  const fromAccount = accounts.find((a) => a.id === fromId) ?? accounts[0];

  const { isDragging, dropProps } = useComposeFileDrop((files) => {
    void filesToComposeAttachments(files, attachments).then((picked) => {
      if (picked.length > 0) setAttachments((prev) => [...prev, ...picked]);
    });
  });

  const draft = useDraftAutosave({
    accountId: fromAccount?.id ?? null,
    signal: JSON.stringify({
      fromId,
      to,
      cc,
      bcc,
      subject,
      text,
      att: attachmentSignature(attachments),
    }),
    getPayload: () => {
      if (!to.trim() && !subject.trim() && !text.trim() && attachments.length === 0) return null;
      const plain = editorRef.current?.getText() ?? text;
      const html = editorRef.current?.getHTML() ?? textToHtml(plain);
      return {
        to,
        cc: cc.trim() || undefined,
        bcc: bcc.trim() || undefined,
        subject,
        body: plain,
        bodyHtml: `<div dir="auto">${html}</div>`,
        attachments: attachments.length > 0 ? attachments : undefined,
      };
    },
  });

  useEffect(() => {
    toRef.current?.focus();
  }, []);

  // Escape closes, keeping the autosaved draft (capture phase beats
  // home-view's Escape handling).
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const el = e.target as Element | null;
      if (el && typeof el.closest === "function" && el.closest('[role="dialog"]')) return;
      // An open autocomplete popup owns Escape (it dismisses itself).
      if (el && typeof el.closest === "function" && el.closest('[data-ac-open="true"]')) return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", down, true);
    return () => window.removeEventListener("keydown", down, true);
  }, [onClose]);

  const hasRecipient = splitAddressList(to).some((e) => parseAddressEntry(e).email.includes("@"));
  const canSend =
    !sendMessage.isPending &&
    !!fromAccount &&
    hasRecipient &&
    (text.trim().length > 0 || subject.trim().length > 0);

  const handleSend = () => {
    if (!canSend || !fromAccount) return;
    console.log("[NewMessageView:send]", { from: fromAccount.id, to });
    // Optimistic: close now; the unmount flush keeps a draft backup, so a
    // failed send degrades to "still in Drafts" instead of lost work.
    onClose();
    sendMessage
      .mutateAsync({
        accountId: fromAccount.id,
        to,
        cc: cc.trim() || undefined,
        bcc: bcc.trim() || undefined,
        subject: subject.trim() || "(no subject)",
        body: editorRef.current?.getText() ?? text,
        bodyHtml: `<div dir="auto">${editorRef.current?.getHTML() ?? textToHtml(text)}</div>`,
        attachments: attachments.length > 0 ? attachments : undefined,
      })
      .then(
        async () => {
          await draft.finalize({ deleteDraft: true });
          toast.success("Sent");
        },
        () => toast.error("Couldn't send — kept in Drafts"),
      );
  };

  return (
    <div className="relative flex h-full min-w-0 flex-col" {...dropProps}>
      <ComposeDropOverlay visible={isDragging} />
      <div className="drag-region flex h-11 shrink-0 items-center gap-2 border-b border-border px-4">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium leading-tight text-foreground">
            New message
          </div>
          <div className="truncate text-xs leading-tight text-muted-foreground">
            {draft.saveState === "saving"
              ? "Draft · saving…"
              : draft.saveState === "saved"
                ? "Draft · saved"
                : draft.saveState === "error"
                  ? "Draft · couldn't save — retrying"
                  : "Drafts save automatically"}
          </div>
        </div>
        <HintTooltip label="Close (keeps the draft)" hint="Esc">
          <IconBtn label="Close" onClick={onClose}>
            <XIcon className="size-3.5" />
          </IconBtn>
        </HintTooltip>
      </div>

      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-1.5 overflow-hidden px-6 text-center">
        <span className="flex size-11 items-center justify-center rounded-full border border-input">
          <PenLineIcon className="size-5 text-muted-foreground" />
        </span>
        <span className="pt-1 text-sm font-medium text-foreground">Start a new conversation</span>
        <span className="text-sm text-muted-foreground">
          Add recipients and a subject, then say hi.
        </span>
      </div>

      <div className="shrink-0 px-5 pb-4 pt-1" data-inline-compose="">
        <div
          className="rounded-2xl border border-(--chat-composer-outline) bg-(--chat-composer-surface) shadow-composer transition-colors focus-within:border-input dark:shadow-none dark:inset-shadow-2xs dark:inset-shadow-(color:--chat-composer-highlight)"
          onKeyDown={(e) => {
            if (matchesCommand(e.nativeEvent, "composer.send")) {
              e.preventDefault();
              handleSend();
            }
          }}
        >
          {accounts.length > 1 && fromAccount ? (
            <div className="flex items-center gap-2 border-b border-border px-3 py-1.5">
              <span className="shrink-0 text-xs font-medium text-muted-foreground">From</span>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label="Send from"
                    className="flex min-w-0 items-center gap-1.5 rounded px-1 py-0.5 text-sm text-foreground/90 hover:bg-accent-surface"
                  >
                    <span
                      className="size-2 shrink-0 rounded-full"
                      style={{ backgroundColor: getAccountColor(fromAccount) }}
                    />
                    <span className="truncate">{fromAccount.email}</span>
                    <ChevronDownIcon className="size-3 shrink-0 text-muted-foreground/70" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  {accounts.map((account) => (
                    <DropdownMenuItem
                      key={account.id}
                      icon={
                        <span
                          className="size-2 shrink-0 rounded-full"
                          style={{ backgroundColor: getAccountColor(account) }}
                          aria-hidden
                        />
                      }
                      onSelect={() => setFromId(account.id)}
                    >
                      {account.email}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ) : null}

          <div className="flex items-center gap-2 border-b border-border px-3 py-1.5">
            <span className="shrink-0 text-xs font-medium text-muted-foreground">To</span>
            <RecipientInput
              ref={toRef}
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
            <div className="flex items-center gap-2 border-b border-border px-3 py-1.5">
              <span className="shrink-0 text-xs font-medium text-muted-foreground">Cc</span>
              <RecipientInput value={cc} onChange={setCc} ariaLabel="Cc" />
            </div>
          ) : null}
          {bccVisible ? (
            <div className="flex items-center gap-2 border-b border-border px-3 py-1.5">
              <span className="shrink-0 text-xs font-medium text-muted-foreground">Bcc</span>
              <RecipientInput value={bcc} onChange={setBcc} ariaLabel="Bcc" />
            </div>
          ) : null}
          <div className="flex items-center gap-2 border-b border-border px-3 py-1.5">
            <span className="shrink-0 text-xs font-medium text-muted-foreground">Subject</span>
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="What's this about?"
              aria-label="Subject"
              className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-placeholder"
            />
          </div>

          <RichTextArea
            ref={editorRef}
            placeholder="Write your message…"
            ariaLabel="Message"
            onTextChange={setText}
            minHeightClass="min-h-[36vh]"
            initialHTML={prefill?.body ? textToHtml(prefill.body) : undefined}
            signatureHTML={fromAccount?.signature}
          />
          <AttachmentChips
            attachments={attachments}
            onRemove={(i) => setAttachments((prev) => prev.filter((_, j) => j !== i))}
          />
          <div className="flex items-center gap-1 px-2 pb-1.5">
            <HintTooltip label="Attach files">
              <IconBtn
                label="Attach files"
                className="size-7"
                onClick={() => {
                  void pickComposeAttachments(attachments).then((picked) => {
                    if (picked.length > 0) setAttachments((prev) => [...prev, ...picked]);
                  });
                }}
              >
                <PaperclipIcon className="size-3.5" />
              </IconBtn>
            </HintTooltip>
            <HintTooltip label="Delete draft">
              <IconBtn
                label="Delete draft"
                className="size-7"
                onClick={() => {
                  onClose();
                  void draft.finalize({ deleteDraft: true });
                }}
              >
                <Trash2Icon className="size-3.5" />
              </IconBtn>
            </HintTooltip>
            <span className="flex-1" />
            {canSend ? (
              <ShortcutText
                command="composer.send"
                suffix="send"
                className="pr-1 text-xs text-muted-foreground"
              />
            ) : null}
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
