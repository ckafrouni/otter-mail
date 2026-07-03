import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent, type ReactNode } from "react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  Text,
  toast,
} from "@glaze/core/components";
import { ChevronDownIcon, PaperclipIcon, Trash2Icon, XIcon } from "lucide-react";
import { useAccounts, useDebouncedValue, useSendMessage, useSuggestContacts } from "./hooks";
import { gmailApi } from "./api";
import { formatAddressEntry, parseAddressEntry, splitAddressList, type ParsedAddress } from "./address";
import type { ComposeAttachment, ContactSuggestion } from "./types";

const MAX_ATTACHMENT_TOTAL_BYTES = 25 * 1024 * 1024;

export type ComposePrefill = {
  to?: string;
  cc?: string;
  subject?: string;
  body?: string;
  attachments?: ComposeAttachment[];
};

type ComposeDialogProps = {
  accountId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  prefill?: ComposePrefill;
  /** Present for replies: threads the send into the original conversation. */
  replyTo?: { threadId: string; messageId: string };
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function readFileAsAttachment(file: File): Promise<ComposeAttachment> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const url = reader.result as string;
      resolve({
        name: file.name,
        mimeType: file.type || "application/octet-stream",
        size: file.size,
        base64: url.slice(url.indexOf(",") + 1),
      });
    };
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsDataURL(file);
  });
}

function parseAddressList(value: string | undefined): ParsedAddress[] {
  if (!value) return [];
  return splitAddressList(value).map(parseAddressEntry);
}

function joinAddresses(list: ParsedAddress[]): string {
  return list.map((a) => formatAddressEntry(a.name, a.email)).join(", ");
}

/** Gmail-style recipient row: label prefix, removable chips, inline input with
    contact suggestions. Backspace on an empty input pops the last chip. */
function RecipientRow({
  label,
  recipients,
  onChange,
  trailing,
  autoFocus,
}: {
  label: string;
  recipients: ParsedAddress[];
  onChange: (next: ParsedAddress[]) => void;
  trailing?: ReactNode;
  autoFocus?: boolean;
}) {
  const [text, setText] = useState("");
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const debounced = useDebouncedValue(text.trim(), 150);
  const suggestQuery = useSuggestContacts(debounced, focused && !dismissed);
  const existing = new Set(recipients.map((r) => r.email.toLowerCase()));
  const suggestions = (suggestQuery.data ?? [])
    .filter((s) => !existing.has(s.email.toLowerCase()))
    .slice(0, 6);
  const suggestionsOpen = focused && !dismissed && text.trim().length > 0 && suggestions.length > 0;

  useEffect(() => setHighlight(0), [debounced]);

  const addChip = (address: ParsedAddress) => {
    if (!address.email || existing.has(address.email.toLowerCase())) return;
    onChange([...recipients, address]);
  };

  const commitText = (): boolean => {
    const trimmed = text.trim().replace(/,$/, "");
    if (!trimmed) return false;
    const parsed = parseAddressEntry(trimmed);
    if (!parsed.email.includes("@")) return false;
    addChip(parsed);
    setText("");
    return true;
  };

  const pick = (suggestion: ContactSuggestion) => {
    addChip({ name: suggestion.name, email: suggestion.email });
    setText("");
    setDismissed(false);
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (suggestionsOpen && e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => (h + 1) % suggestions.length);
    } else if (suggestionsOpen && e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => (h - 1 + suggestions.length) % suggestions.length);
    } else if (e.key === "Enter" || e.key === "," || e.key === "Tab") {
      if (suggestionsOpen && e.key !== ",") {
        e.preventDefault();
        pick(suggestions[Math.min(highlight, suggestions.length - 1)]);
      } else if (text.trim()) {
        if (e.key !== "Tab") e.preventDefault();
        if (e.key === ",") e.preventDefault();
        commitText();
      }
    } else if (e.key === "Backspace" && text.length === 0 && recipients.length > 0) {
      e.preventDefault();
      onChange(recipients.slice(0, -1));
    } else if (e.key === "Escape" && suggestionsOpen) {
      e.preventDefault();
      e.stopPropagation();
      setDismissed(true);
    }
  };

  return (
    <div
      className="relative flex min-h-10 cursor-text items-center gap-2 border-b border-separator px-4"
      onClick={() => inputRef.current?.focus()}
    >
      <Text variant="small" color="tertiary" className="w-10 shrink-0 select-none">
        {label}
      </Text>
      <div className="flex flex-1 min-w-0 flex-wrap items-center gap-1 py-1.5">
        {recipients.map((r, i) => (
          <span
            key={`${r.email}:${i}`}
            className="inline-flex max-w-full items-center gap-1 rounded-pill bg-control px-2 py-0.5"
          >
            <Text variant="mini" truncate className="max-w-56">
              {r.name || r.email}
            </Text>
            <button
              type="button"
              aria-label={`Remove ${r.email}`}
              onClick={(e) => {
                e.stopPropagation();
                onChange(recipients.filter((_, idx) => idx !== i));
              }}
              className="shrink-0 text-tertiary hover:text-primary"
            >
              <XIcon className="size-3" />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setDismissed(false);
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            commitText();
          }}
          onKeyDown={handleKeyDown}
          autoFocus={autoFocus}
          className="min-w-28 flex-1 bg-transparent text-small text-primary outline-none placeholder:text-tertiary"
          placeholder={recipients.length === 0 ? "Recipients" : undefined}
        />
      </div>
      {trailing}
      {suggestionsOpen ? (
        <div className="absolute left-12 right-4 top-full z-50 mt-1 overflow-hidden rounded-popover bg-popover p-1 ring-1 ring-foreground-20 shadow-lg">
          {suggestions.map((suggestion, i) => (
            <button
              key={suggestion.email}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(suggestion)}
              onMouseEnter={() => setHighlight(i)}
              className={`flex w-full items-baseline gap-2 rounded-control px-2 py-1.5 text-left ${
                i === highlight ? "bg-accent" : ""
              }`}
            >
              <span className={`text-small truncate ${i === highlight ? "text-white" : "text-primary"}`}>
                {suggestion.name || suggestion.email}
              </span>
              {suggestion.name ? (
                <span className={`text-mini truncate ${i === highlight ? "text-white/70" : "text-tertiary"}`}>
                  {suggestion.email}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function ComposeDialog({
  accountId,
  open,
  onOpenChange,
  title,
  prefill,
  replyTo,
}: ComposeDialogProps) {
  const [fromAccountId, setFromAccountId] = useState(accountId);
  const [to, setTo] = useState<ParsedAddress[]>(() => parseAddressList(prefill?.to));
  const [cc, setCc] = useState<ParsedAddress[]>(() => parseAddressList(prefill?.cc));
  const [bcc, setBcc] = useState<ParsedAddress[]>([]);
  const [showCc, setShowCc] = useState(Boolean(prefill?.cc));
  const [showBcc, setShowBcc] = useState(false);
  const [subject, setSubject] = useState(prefill?.subject ?? "");
  const [body, setBody] = useState(prefill?.body ?? "");
  const [attachments, setAttachments] = useState<ComposeAttachment[]>(
    prefill?.attachments ?? [],
  );
  const [dragOver, setDragOver] = useState(false);
  const dragDepth = useRef(0);

  const accountsQuery = useAccounts();
  const accounts = accountsQuery.data ?? [];
  const fromAccount = accounts.find((a) => a.id === fromAccountId);
  // Replies must send from the conversation's own account.
  const canPickFrom = !replyTo && accounts.length > 1;

  const sendMessage = useSendMessage();
  const totalAttachmentBytes = attachments.reduce((sum, a) => sum + a.size, 0);
  const canSend = to.length > 0 && !sendMessage.isPending;

  const handleSend = async () => {
    if (!canSend) return;
    console.log("[ComposeDialog:send]", { to: to.length, subject, replyTo, from: fromAccountId });
    try {
      await sendMessage.mutateAsync({
        accountId: fromAccountId,
        to: joinAddresses(to),
        cc: cc.length > 0 ? joinAddresses(cc) : undefined,
        bcc: bcc.length > 0 ? joinAddresses(bcc) : undefined,
        subject,
        body,
        threadId: replyTo?.threadId,
        replyToMessageId: replyTo?.messageId,
        attachments: attachments.length > 0 ? attachments : undefined,
      });
      toast.success("Message sent");
      onOpenChange(false);
    } catch (err) {
      console.log("[ComposeDialog:send] error", { error: String(err) });
      toast.error("Could not send message");
    }
  };

  const handleAttachClick = () => {
    void (async () => {
      try {
        const result = await gmailApi.pickAttachments(totalAttachmentBytes);
        if (result.error) {
          toast.error(result.error);
          return;
        }
        if (result.attachments.length > 0) {
          setAttachments((prev) => [...prev, ...result.attachments]);
        }
      } catch {
        toast.error("Could not attach files");
      }
    })();
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    dragDepth.current = 0;
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;
    const incoming = files.reduce((sum, f) => sum + f.size, 0);
    if (totalAttachmentBytes + incoming > MAX_ATTACHMENT_TOTAL_BYTES) {
      toast.error("Attachments can total at most 25 MB.");
      return;
    }
    void (async () => {
      try {
        const read = await Promise.all(files.map(readFileAsAttachment));
        setAttachments((prev) => [...prev, ...read]);
      } catch {
        toast.error("Could not read dropped files");
      }
    })();
  };

  const ccBccToggles = (
    <span className="flex shrink-0 items-center gap-2">
      {!showCc ? (
        <button
          type="button"
          onClick={() => setShowCc(true)}
          className="text-mini text-tertiary hover:text-secondary"
        >
          Cc
        </button>
      ) : null}
      {!showBcc ? (
        <button
          type="button"
          onClick={() => setShowBcc(true)}
          className="text-mini text-tertiary hover:text-secondary"
        >
          Bcc
        </button>
      ) : null}
    </span>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogHeader className="sr-only">
        <DialogTitle>{title ?? "New Message"}</DialogTitle>
        <DialogDescription>Compose an email</DialogDescription>
      </DialogHeader>
      <DialogContent size="large" className="p-0 overflow-hidden" showCloseButton={false}>
        <div
          className={`flex h-[65vh] max-h-[680px] flex-col ${dragOver ? "outline-2 -outline-offset-2 outline-dashed outline-accent" : ""}`}
          onDragEnter={(e) => {
            e.preventDefault();
            dragDepth.current += 1;
            setDragOver(true);
          }}
          onDragLeave={() => {
            dragDepth.current = Math.max(0, dragDepth.current - 1);
            if (dragDepth.current === 0) setDragOver(false);
          }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleDrop}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void handleSend();
            }
          }}
        >
          {/* Header bar */}
          <div className="flex items-center justify-between bg-control-subtle px-4 py-2.5">
            <Text variant="small-strong">{title ?? "New Message"}</Text>
            <Button
              variant="transparent"
              size="small"
              iconOnly
              aria-label="Close"
              onClick={() => onOpenChange(false)}
            >
              <XIcon className="size-4" />
            </Button>
          </div>

          {canPickFrom ? (
            <div className="flex min-h-10 items-center gap-2 border-b border-separator px-4">
              <Text variant="small" color="tertiary" className="w-10 shrink-0 select-none">
                From
              </Text>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="flex min-w-0 items-center gap-1 rounded-control px-1 py-0.5 hover:bg-control-subtle"
                  >
                    <Text variant="small" truncate>
                      {fromAccount?.email ?? fromAccountId}
                    </Text>
                    <ChevronDownIcon className="size-3.5 shrink-0 text-tertiary" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  {accounts.map((account) => (
                    <DropdownMenuCheckboxItem
                      key={account.id}
                      checked={account.id === fromAccountId}
                      onCheckedChange={() => setFromAccountId(account.id)}
                    >
                      {account.email}
                    </DropdownMenuCheckboxItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ) : null}

          <RecipientRow
            label="To"
            recipients={to}
            onChange={setTo}
            trailing={ccBccToggles}
            autoFocus={to.length === 0}
          />
          {showCc ? <RecipientRow label="Cc" recipients={cc} onChange={setCc} /> : null}
          {showBcc ? <RecipientRow label="Bcc" recipients={bcc} onChange={setBcc} /> : null}

          <div className="flex min-h-10 items-center border-b border-separator px-4">
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Subject"
              className="w-full bg-transparent text-small font-medium text-primary outline-none placeholder:text-tertiary"
            />
          </div>

          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Write your message…"
            autoFocus={to.length > 0}
            className="min-h-0 flex-1 resize-none bg-transparent px-4 py-3 text-small leading-relaxed text-primary outline-none placeholder:text-tertiary"
          />

          {attachments.length > 0 ? (
            <div className="flex flex-wrap items-center gap-1.5 border-t border-separator px-4 py-2">
              {attachments.map((att, i) => (
                <span
                  key={`${att.name}:${i}`}
                  className="inline-flex max-w-full items-center gap-1.5 rounded-pill bg-control px-2 py-1"
                >
                  <Text variant="mini" truncate className="max-w-48">
                    {att.name}
                  </Text>
                  <Text variant="mini" color="tertiary" className="shrink-0">
                    {formatBytes(att.size)}
                  </Text>
                  <button
                    type="button"
                    onClick={() => setAttachments((prev) => prev.filter((_, idx) => idx !== i))}
                    className="shrink-0 text-tertiary hover:text-primary"
                    aria-label={`Remove ${att.name}`}
                  >
                    <XIcon className="size-3" />
                  </button>
                </span>
              ))}
            </div>
          ) : null}

          {/* Footer bar */}
          <div className="flex items-center gap-2 border-t border-separator px-3 py-2.5">
            <Button
              variant="accent"
              size="small"
              disabled={!canSend}
              onClick={() => void handleSend()}
            >
              {sendMessage.isPending ? "Sending…" : "Send"}
            </Button>
            <Button
              variant="transparent"
              size="small"
              iconOnly
              aria-label="Attach files"
              onClick={handleAttachClick}
            >
              <PaperclipIcon className="size-4" />
            </Button>
            <Text variant="mini" color="tertiary" className="select-none">
              ⌘↵ to send
            </Text>
            <div className="flex-1" />
            <Button
              variant="transparent"
              size="small"
              iconOnly
              aria-label="Discard draft"
              className="text-tertiary hover:text-support-red"
              onClick={() => onOpenChange(false)}
            >
              <Trash2Icon className="size-4" />
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
