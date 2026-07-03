import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import {
  Button,
  Dialog,
  Field,
  Input,
  Text,
  Textarea,
  toast,
} from "@glaze/core/components";
import { PaperclipIcon, XIcon } from "lucide-react";
import { useDebouncedValue, useSendMessage, useSuggestContacts } from "./hooks";
import { gmailApi } from "./api";
import { formatAddressEntry, parseAddressEntry } from "./address";
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

function RecipientInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [highlight, setHighlight] = useState(0);

  const tokens = value.split(",");
  const activeToken = (tokens[tokens.length - 1] ?? "").trim();
  const debounced = useDebouncedValue(activeToken, 150);
  const suggestQuery = useSuggestContacts(debounced, focused && !dismissed);

  const priorEmails = new Set(
    tokens
      .slice(0, -1)
      .map((t) => parseAddressEntry(t).email.toLowerCase())
      .filter((e) => e.length > 0),
  );
  const suggestions = (suggestQuery.data ?? [])
    .filter((s) => !priorEmails.has(s.email.toLowerCase()))
    .slice(0, 6);
  const open = focused && !dismissed && activeToken.length > 0 && suggestions.length > 0;

  useEffect(() => setHighlight(0), [debounced]);

  const pick = (suggestion: ContactSuggestion) => {
    const parts = value.split(",");
    parts[parts.length - 1] =
      (parts.length > 1 ? " " : "") + formatAddressEntry(suggestion.name, suggestion.email);
    onChange(parts.join(",") + ", ");
    setDismissed(false);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!open) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => (h + 1) % suggestions.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => (h - 1 + suggestions.length) % suggestions.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      pick(suggestions[Math.min(highlight, suggestions.length - 1)]);
    } else if (e.key === "Escape") {
      // Dismiss only the suggestions, not the dialog.
      e.preventDefault();
      e.stopPropagation();
      setDismissed(true);
    }
  };

  return (
    <div className="relative flex-1 min-w-0">
      <Input
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setDismissed(false);
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className="w-full"
      />
      {open ? (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-popover bg-popover ring-1 ring-foreground-20 p-1 shadow-lg">
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
              <span
                className={`text-small truncate ${i === highlight ? "text-white" : "text-primary"}`}
              >
                {suggestion.name || suggestion.email}
              </span>
              {suggestion.name ? (
                <span
                  className={`text-mini truncate ${i === highlight ? "text-white/70" : "text-tertiary"}`}
                >
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
  const [to, setTo] = useState(prefill?.to ?? "");
  const [cc, setCc] = useState(prefill?.cc ?? "");
  const [bcc, setBcc] = useState("");
  const [showCcBcc, setShowCcBcc] = useState(Boolean(prefill?.cc));
  const [subject, setSubject] = useState(prefill?.subject ?? "");
  const [body, setBody] = useState(prefill?.body ?? "");
  const [attachments, setAttachments] = useState<ComposeAttachment[]>(
    prefill?.attachments ?? [],
  );
  const [dragOver, setDragOver] = useState(false);
  const dragDepth = useRef(0);

  const sendMessage = useSendMessage();

  const totalAttachmentBytes = attachments.reduce((sum, a) => sum + a.size, 0);

  const handleSend = async () => {
    console.log("[ComposeDialog:send]", { to, subject, replyTo });
    try {
      await sendMessage.mutateAsync({
        accountId,
        to,
        cc: cc.trim() || undefined,
        bcc: bcc.trim() || undefined,
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

  const canSend = to.trim().length > 0 && subject.trim().length > 0;

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title ?? "New Message"}
      confirmLabel="Send"
      confirmVariant="accent"
      confirmDisabled={!canSend || sendMessage.isPending}
      onConfirm={handleSend}
      size="large"
    >
      <div
        className={`flex flex-col gap-3 p-1 rounded-card ${dragOver ? "outline-2 outline-dashed outline-accent" : ""}`}
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
      >
        <Field label="To" orientation="vertical">
          <div className="flex items-center gap-2">
            <RecipientInput
              value={to}
              onChange={setTo}
              placeholder="recipient@example.com"
            />
            {!showCcBcc ? (
              <button
                type="button"
                onClick={() => setShowCcBcc(true)}
                className="shrink-0 text-mini text-tertiary hover:text-secondary transition-colors"
              >
                Cc/Bcc
              </button>
            ) : null}
          </div>
        </Field>
        {showCcBcc ? (
          <>
            <Field label="Cc" orientation="vertical">
              <RecipientInput value={cc} onChange={setCc} placeholder="cc@example.com" />
            </Field>
            <Field label="Bcc" orientation="vertical">
              <RecipientInput value={bcc} onChange={setBcc} placeholder="bcc@example.com" />
            </Field>
          </>
        ) : null}
        <Field label="Subject" orientation="vertical">
          <Input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Subject"
          />
        </Field>
        <Field label="Body" orientation="vertical">
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <Button variant="glass" size="small" onClick={handleAttachClick}>
                <PaperclipIcon className="size-3.5" />
                Attach files
              </Button>
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
                    onClick={() =>
                      setAttachments((prev) => prev.filter((_, idx) => idx !== i))
                    }
                    className="shrink-0 text-tertiary hover:text-primary transition-colors"
                    aria-label={`Remove ${att.name}`}
                  >
                    <XIcon className="size-3" />
                  </button>
                </span>
              ))}
            </div>
            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Write your message..."
              rows={8}
            />
          </div>
        </Field>
      </div>
    </Dialog>
  );
}
