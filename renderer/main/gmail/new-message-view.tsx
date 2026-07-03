import { useEffect, useRef, useState } from "react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  toast,
} from "@glaze/core/components";
import { ChevronDownIcon, PenLineIcon, SendHorizontalIcon, XIcon } from "lucide-react";
import { useSendMessage } from "./hooks";
import { ComposeDialog } from "./compose-dialog";
import { parseAddressEntry, splitAddressList } from "./address";
import { getAccountColor } from "./account-style";
import { IconBtn, HintTooltip } from "./slack-ui";
import { RichTextArea, type RichTextRef } from "./rich-text";
import { RecipientInput } from "./recipient-input";
import type { GmailAccount } from "./types";

/**
 * Slack-style "new chat": replaces the reader pane when composing a fresh
 * email — recipients, subject, and body in the docked composer. The pen
 * button hands the draft to the full ComposeDialog (Bcc, attachments,
 * autosaved drafts).
 */
export function NewMessageView({
  accounts,
  defaultAccountId,
  onClose,
}: {
  accounts: GmailAccount[];
  defaultAccountId: string;
  onClose: () => void;
}) {
  const [fromId, setFromId] = useState(defaultAccountId);
  const [to, setTo] = useState("");
  const [cc, setCc] = useState("");
  const [ccVisible, setCcVisible] = useState(false);
  const [subject, setSubject] = useState("");
  const [text, setText] = useState("");
  const [expanded, setExpanded] = useState(false);
  const toRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<RichTextRef>(null);
  const sendMessage = useSendMessage();

  const fromAccount = accounts.find((a) => a.id === fromId) ?? accounts[0];

  useEffect(() => {
    toRef.current?.focus();
  }, []);

  // Escape discards the draft (capture phase beats home-view's Escape
  // handling; the expanded dialog keeps its own Escape behavior).
  const expandedRef = useRef(expanded);
  expandedRef.current = expanded;
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || expandedRef.current) return;
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
    sendMessage
      .mutateAsync({
        accountId: fromAccount.id,
        to,
        cc: cc.trim() || undefined,
        subject: subject.trim() || "(no subject)",
        body: editorRef.current?.getText() ?? text,
        bodyHtml: `<div dir="auto">${editorRef.current?.getHTML() ?? ""}</div>`,
      })
      .then(() => {
        toast.success("Sent");
        onClose();
      }, () => toast.error("Could not send the message"));
  };

  if (expanded && fromAccount) {
    return (
      <ComposeDialog
        accountId={fromAccount.id}
        open
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
        prefill={{
          to,
          cc: cc.trim() || undefined,
          subject,
          body: text,
        }}
      />
    );
  }

  return (
    <div className="flex h-full min-w-0 flex-col">
      <div className="drag-region flex h-[52px] shrink-0 items-center gap-2 border-b border-(--sk-border) px-4">
        <div className="min-w-0 flex-1 truncate text-[16px] font-extrabold leading-tight text-(--sk-strong)">
          New message
        </div>
        <HintTooltip label="Discard" hint="Esc">
          <IconBtn label="Discard" onClick={onClose}>
            <XIcon className="size-4" />
          </IconBtn>
        </HintTooltip>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center gap-1.5 px-6 text-center">
        <span className="flex size-11 items-center justify-center rounded-xl bg-(--sk-ctl)">
          <PenLineIcon className="size-5 text-(--sk-muted)" />
        </span>
        <span className="pt-1 text-[15px] font-bold text-(--sk-text)">Start a new conversation</span>
        <span className="text-[13px] text-(--sk-muted)">
          Add recipients and a subject, then say hi.
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
          {accounts.length > 1 && fromAccount ? (
            <div className="flex items-center gap-2 border-b border-(--sk-border) px-3 py-1.5">
              <span className="shrink-0 text-[12px] text-(--sk-faint)">From</span>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label="Send from"
                    className="flex min-w-0 items-center gap-1.5 rounded px-1 py-0.5 text-[13px] text-(--sk-text) hover:bg-(--sk-hover)"
                  >
                    <span
                      className="size-2 shrink-0 rounded-full"
                      style={{ backgroundColor: getAccountColor(fromAccount) }}
                    />
                    <span className="truncate">{fromAccount.email}</span>
                    <ChevronDownIcon className="size-3 shrink-0 text-(--sk-faint)" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  {accounts.map((account) => (
                    <DropdownMenuItem key={account.id} onSelect={() => setFromId(account.id)}>
                      <span className="flex min-w-0 items-center gap-2">
                        <span
                          className="size-2 shrink-0 rounded-full"
                          style={{ backgroundColor: getAccountColor(account) }}
                        />
                        <span className="truncate">{account.email}</span>
                      </span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ) : null}

          <div className="flex items-center gap-2 border-b border-(--sk-border) px-3 py-1.5">
            <span className="shrink-0 text-[12px] text-(--sk-faint)">To</span>
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
                className="shrink-0 text-[11px] text-(--sk-faint) hover:text-(--sk-strong)"
              >
                Cc
              </button>
            ) : null}
          </div>
          {ccVisible ? (
            <div className="flex items-center gap-2 border-b border-(--sk-border) px-3 py-1.5">
              <span className="shrink-0 text-[12px] text-(--sk-faint)">Cc</span>
              <RecipientInput value={cc} onChange={setCc} ariaLabel="Cc" />
            </div>
          ) : null}
          <div className="flex items-center gap-2 border-b border-(--sk-border) px-3 py-1.5">
            <span className="shrink-0 text-[12px] text-(--sk-faint)">Subject</span>
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="What's this about?"
              aria-label="Subject"
              className="min-w-0 flex-1 bg-transparent text-[13px] text-(--sk-strong) outline-none placeholder:text-(--sk-faint)"
            />
          </div>

          <RichTextArea
            ref={editorRef}
            placeholder="Write your message…"
            ariaLabel="Message"
            onTextChange={setText}
            minHeightClass="min-h-[72px]"
          />
          <div className="flex items-center gap-1 px-2 pb-1.5">
            <HintTooltip label="Open full composer" hint="Bcc, attachments, drafts…">
              <IconBtn label="Open full composer" className="size-7" onClick={() => setExpanded(true)}>
                <PenLineIcon className="size-3.5" />
              </IconBtn>
            </HintTooltip>
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
