import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  Dialog,
  Text,
  toast,
} from "@glaze/core/components";
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  ArchiveXIcon,
  ChevronDownIcon,
  DownloadIcon,
  FlagIcon,
  FolderIcon,
  ForwardIcon,
  ImageIcon,
  MailIcon,
  MailOpenIcon,
  PaperclipIcon,
  BotMessageSquareIcon,
  ReplyIcon,
  ReplyAllIcon,
  RotateCcwIcon,
  SendHorizontalIcon,
  ShieldCheckIcon,
  TextQuoteIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { SlackAiIcon } from "./assistant-icons";
import {
  useAccounts,
  useMessage,
  useThread,
  useModifyMessage,
  useTrashMessage,
  useModifyThread,
  useTrashThread,
  useUntrashThread,
  useUntrashMessage,
  useDeleteThreadsForever,
  useGetAttachment,
  useLabels,
  useSendMessage,
} from "./hooks";
import { gmailApi } from "./api";
import { CategoryChip, InboxChip, LabelChip, isCategoryLabelId } from "./label-chip";
import { SenderAvatar } from "./sender-avatar";
import { LabelPickerMenu } from "./label-picker-menu";
import { parseAddressEntry, splitAddressList } from "./address";
import { isTypingTarget } from "./keyboard";
import { IconBtn, HintTooltip } from "./te-ui";
import { RichTextArea, textToHtml, type RichTextRef } from "./rich-text";
import { RecipientInput } from "./recipient-input";
import {
  AttachmentChips,
  attachmentSignature,
  pickComposeAttachments,
} from "./compose-attachments";
import {
  AskAssistantDialog,
  contextFromQuote,
  type AssistantContext,
  type QuoteContext,
} from "./ask-assistant";
import { DraftEditor } from "./draft-editor";
import { useDraftAutosave } from "./use-draft-autosave";
import type {
  ComposeAttachment,
  GmailLabel,
  GmailMessageDetail,
  GmailMessageSummary,
} from "./types";

type MessageReaderProps = {
  accountId: string;
  messageId: string | null;
  /** Clears the selection (drafts return to the list after send/discard). */
  onDeselect?: () => void;
  /** Toolbar archive/trash move on to the next conversation through this. */
  onAdvance?: () => void;
  /** Opens the in-app Hermes chat panel (this conversation becomes its context). */
  onOpenChat?: () => void;
  /** A selected excerpt was sent to the chat panel as a quote. */
  onQuote?: (quote: QuoteContext) => void;
};

export type DownloadAttachment = (
  messageId: string,
  attachmentId: string,
  filename: string,
  mimeType: string,
) => void;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatFullDate(timestamp: number): string {
  return new Date(timestamp).toLocaleString([], {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** Day-divider label: Today, Yesterday, weekday, or a date. */
function formatDayLabel(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const dayDiff = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);
  if (dayDiff === 0) return "Today";
  if (dayDiff === 1) return "Yesterday";
  if (dayDiff < 7) return date.toLocaleDateString([], { weekday: "long" });
  return date.toLocaleDateString([], {
    month: "long",
    day: "numeric",
    ...(date.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}),
  });
}

export function dayKey(timestamp: number): string {
  const d = new Date(timestamp);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/**
 * The email canvas is always light (HTML mail is designed for white), but in
 * a dark-appearance window the iframe document inherits dark UA defaults —
 * default text renders WHITE on our white card. This prelude pins the
 * document to light rendering and sane typography; email-supplied CSS comes
 * after it and still wins.
 */
const MESSAGE_BODY_PRELUDE = `<style>
:root { color-scheme: light; }
body {
  margin: 10px;
  background: #ffffff;
  color: #1f1f1f;
  font-family: -apple-system, system-ui, Helvetica, Arial, sans-serif;
  font-size: 15px;
  line-height: 1.45;
  word-break: break-word;
}
a { color: #e34500; }
blockquote { border-left: 3px solid #d6d6d6; padding-left: 12px; margin: 4px 0; color: #555555; }
</style>`;

function MessageBody({
  bodyHtml,
  bodyText,
  onQuoteText,
}: {
  bodyHtml: string | null;
  bodyText: string | null;
  /** Reports a selection inside the (same-origin) HTML iframe, in page coords. */
  onQuoteText?: (text: string, rect: { x: number; y: number }) => void;
}) {
  if (bodyHtml) {
    // Marketing/HTML mail is designed for a white canvas — give it a light
    // card inside the dark conversation, like an unfurled preview card.
    return (
      <iframe
        sandbox="allow-same-origin"
        srcDoc={MESSAGE_BODY_PRELUDE + bodyHtml}
        className="w-full rounded-[6px] border border-(--te-border) bg-white"
        title="Message body"
        onLoad={(e) => {
          const iframe = e.currentTarget;
          const doc = iframe.contentDocument || iframe.contentWindow?.document;
          if (!doc) return;
          iframe.style.height = doc.documentElement.scrollHeight + "px";
          if (onQuoteText) {
            doc.addEventListener("mouseup", () => {
              const sel = doc.getSelection();
              const text = sel?.toString().trim() ?? "";
              if (!text || !sel || sel.rangeCount === 0) return;
              const r = sel.getRangeAt(0).getBoundingClientRect();
              const ir = iframe.getBoundingClientRect();
              onQuoteText(text, { x: ir.left + r.left + r.width / 2, y: ir.top + r.top });
            });
          }
        }}
      />
    );
  }
  if (bodyText) {
    // Same opaque card as HTML mail so text messages stay readable on the
    // glass reader background.
    return (
      <pre className="whitespace-pre-wrap rounded-[6px] border border-(--te-border) bg-(--te-panel) px-4 py-3 font-sans text-[15px] leading-relaxed text-(--te-text)">
        {bodyText}
      </pre>
    );
  }
  return <span className="text-[13px] text-(--te-muted)">(No message body)</span>;
}

type MessageAttachment = GmailMessageDetail["attachments"][number];

const MAX_THUMBNAIL_FETCHES = 3;
let activeThumbnailFetches = 0;
const thumbnailFetchQueue: (() => void)[] = [];

async function withThumbnailSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (activeThumbnailFetches >= MAX_THUMBNAIL_FETCHES) {
    await new Promise<void>((resolve) => thumbnailFetchQueue.push(resolve));
  }
  activeThumbnailFetches += 1;
  try {
    return await fn();
  } finally {
    activeThumbnailFetches -= 1;
    thumbnailFetchQueue.shift()?.();
  }
}

function useAttachmentActions(
  accountId: string,
  messageId: string,
  attachment: MessageAttachment,
) {
  const [opening, setOpening] = useState(false);
  const pressRef = useRef<{ x: number; y: number } | null>(null);
  const draggedRef = useRef(false);

  const params = {
    accountId,
    messageId,
    attachmentId: attachment.id,
    filename: attachment.filename,
  };

  const handleOpen = () => {
    if (draggedRef.current || opening) return;
    console.log("[MessageReader:openAttachment]", { messageId, filename: attachment.filename });
    setOpening(true);
    void (async () => {
      try {
        await gmailApi.openAttachment(params);
      } catch {
        toast.error("Could not open attachment");
      } finally {
        setOpening(false);
      }
    })();
  };

  // Native drag-out starts once the pointer travels past a small threshold with
  // the button held; a plain click (no travel) opens the file instead.
  const dragProps = {
    onPointerDown: (e: PointerEvent<HTMLElement>) => {
      if (e.button !== 0) return;
      pressRef.current = { x: e.clientX, y: e.clientY };
      draggedRef.current = false;
    },
    onPointerMove: (e: PointerEvent<HTMLElement>) => {
      const press = pressRef.current;
      if (!press) return;
      if ((e.buttons & 1) === 0) {
        pressRef.current = null;
        return;
      }
      if (Math.abs(e.clientX - press.x) + Math.abs(e.clientY - press.y) < 5) return;
      pressRef.current = null;
      draggedRef.current = true;
      console.log("[MessageReader:dragAttachment]", {
        messageId,
        filename: attachment.filename,
      });
      void gmailApi.dragAttachment(params).catch(() => {
        toast.error("Could not export attachment");
      });
    },
    onPointerUp: () => {
      pressRef.current = null;
    },
  };

  return { handleOpen, dragProps, opening };
}

function ImageAttachmentTile({
  accountId,
  messageId,
  attachment,
  onDownload,
}: {
  accountId: string;
  messageId: string;
  attachment: MessageAttachment;
  onDownload: DownloadAttachment;
}) {
  const { handleOpen, dragProps, opening } = useAttachmentActions(
    accountId,
    messageId,
    attachment,
  );
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    setUrl(null);
    setFailed(false);
    void (async () => {
      try {
        const data = await withThumbnailSlot(() =>
          gmailApi.getAttachmentData({ accountId, messageId, attachmentId: attachment.id }),
        );
        const bytes = Uint8Array.from(atob(data.base64), (c) => c.charCodeAt(0));
        const blobUrl = URL.createObjectURL(new Blob([bytes], { type: attachment.mimeType }));
        if (cancelled) {
          URL.revokeObjectURL(blobUrl);
          return;
        }
        objectUrl = blobUrl;
        setUrl(blobUrl);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [accountId, messageId, attachment.id, attachment.mimeType]);

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div className="group relative w-36 select-none">
          <div
            role="button"
            aria-label={`Open ${attachment.filename}`}
            onClick={handleOpen}
            {...dragProps}
            className={`h-28 w-36 cursor-pointer overflow-hidden rounded-[6px] border border-(--te-border) bg-(--te-ctl)${opening ? " opacity-60" : ""}`}
          >
            {url ? (
              <img
                src={url}
                alt={attachment.filename}
                draggable={false}
                className="h-full w-full object-cover"
              />
            ) : failed ? (
              <div className="flex h-full items-center justify-center">
                <ImageIcon className="size-6 text-(--te-faint)" />
              </div>
            ) : (
              <div className="h-full w-full animate-pulse bg-(--te-ctl)" />
            )}
          </div>
          <button
            type="button"
            onClick={() =>
              onDownload(messageId, attachment.id, attachment.filename, attachment.mimeType)
            }
            aria-label={`Download ${attachment.filename}`}
            className="absolute right-1.5 top-1.5 flex size-6 items-center justify-center rounded-md bg-black/60 text-white opacity-0 hover:bg-black/80 focus-visible:opacity-100 group-hover:opacity-100"
          >
            <DownloadIcon className="size-3.5" />
          </button>
          <div className="mt-1 truncate text-[11px] text-(--te-muted)">{attachment.filename}</div>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem icon="arrow.up.forward.app" onSelect={handleOpen}>
          Open
        </ContextMenuItem>
        <ContextMenuItem
          icon="square.and.arrow.down"
          onSelect={() =>
            onDownload(messageId, attachment.id, attachment.filename, attachment.mimeType)
          }
        >
          Save…
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

function FileAttachmentRow({
  accountId,
  messageId,
  attachment,
  onDownload,
}: {
  accountId: string;
  messageId: string;
  attachment: MessageAttachment;
  onDownload: DownloadAttachment;
}) {
  const { handleOpen, dragProps, opening } = useAttachmentActions(
    accountId,
    messageId,
    attachment,
  );
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          role="button"
          aria-label={`Open ${attachment.filename}`}
          onClick={handleOpen}
          {...dragProps}
          className={`flex cursor-pointer select-none items-center justify-between gap-3 rounded-[6px] border border-(--te-border) bg-(--te-ctl) px-3 py-2 hover:bg-(--te-ctl-hover)${opening ? " opacity-60" : ""}`}
        >
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-[13px] text-(--te-text)">{attachment.filename}</span>
            <span className="text-[11px] text-(--te-faint)">
              {attachment.mimeType} · {formatBytes(attachment.size)}
            </span>
          </div>
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onDownload(messageId, attachment.id, attachment.filename, attachment.mimeType);
            }}
            aria-label={`Download ${attachment.filename}`}
            className="flex size-7 shrink-0 items-center justify-center rounded-md text-(--te-muted) hover:bg-(--te-hover) hover:text-(--te-strong)"
          >
            <DownloadIcon className="size-4" />
          </button>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem icon="arrow.up.forward.app" onSelect={handleOpen}>
          Open
        </ContextMenuItem>
        <ContextMenuItem
          icon="square.and.arrow.down"
          onSelect={() =>
            onDownload(messageId, attachment.id, attachment.filename, attachment.mimeType)
          }
        >
          Save…
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

function AttachmentList({
  accountId,
  messageId,
  attachments,
  onDownload,
}: {
  accountId: string;
  messageId: string;
  attachments: GmailMessageDetail["attachments"];
  onDownload: DownloadAttachment;
}) {
  if (attachments.length === 0) return null;
  const images = attachments.filter((a) => a.mimeType.startsWith("image/"));
  const files = attachments.filter((a) => !a.mimeType.startsWith("image/"));
  return (
    <div className="mt-2 flex flex-col gap-2">
      <span className="te-label text-(--te-muted)">
        {attachments.length} attachment{attachments.length === 1 ? "" : "s"}
      </span>
      {images.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {images.map((att) => (
            <ImageAttachmentTile
              key={att.id}
              accountId={accountId}
              messageId={messageId}
              attachment={att}
              onDownload={onDownload}
            />
          ))}
        </div>
      ) : null}
      {files.length > 0 ? (
        <div className="flex flex-col gap-1">
          {files.map((att) => (
            <FileAttachmentRow
              key={att.id}
              accountId={accountId}
              messageId={messageId}
              attachment={att}
              onDownload={onDownload}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

// DayDivider/CollapsedRow/ExpandedRow are shared with DraftEditor, which
// renders the same conversation above its composer.
export function DayDivider({ timestamp }: { timestamp: number }) {
  return (
    <div className="relative flex items-center justify-center py-3">
      <div className="absolute inset-x-0 top-1/2 h-px bg-(--te-border)" />
      <span className="te-label relative rounded-[4px] border border-(--te-border) bg-(--te-card) px-2.5 py-1 text-(--te-text)">
        {formatDayLabel(timestamp)}
      </span>
    </div>
  );
}

export function CollapsedRow({
  accountId,
  summary,
  onExpand,
}: {
  accountId: string;
  summary: GmailMessageSummary;
  onExpand: () => void;
}) {
  return (
    <div className="px-5 py-0.5">
      <button
        type="button"
        onClick={onExpand}
        aria-label="Expand message"
        className="flex w-full items-center gap-2.5 rounded-[6px] border border-(--te-border) bg-(--te-ctl) px-3 py-2 text-left hover:bg-(--te-ctl-hover)"
      >
        <SenderAvatar name={summary.fromName} email={summary.fromEmail} accountId={accountId} size="sm" />
        <span
          className={[
            "shrink-0 text-[13px] leading-snug",
            summary.unread ? "font-bold text-(--te-strong)" : "font-semibold text-(--te-text)",
          ].join(" ")}
        >
          {summary.fromName || summary.fromEmail}
        </span>
        <span className="min-w-0 flex-1 truncate text-[13px] text-(--te-faint)">
          {summary.snippet}
        </span>
        <span className="te-num shrink-0 text-[10px] text-(--te-faint)">
          {formatTime(summary.date)}
        </span>
        <ChevronDownIcon className="size-3.5 shrink-0 -rotate-90 text-(--te-faint)" />
      </button>
    </div>
  );
}

export function ExpandedRow({
  accountId,
  summary,
  onCollapse,
  onDownload,
  onQuoteText,
}: {
  accountId: string;
  summary: GmailMessageSummary;
  /** Absent for single-message conversations, which always stay expanded. */
  onCollapse?: () => void;
  onDownload: DownloadAttachment;
  onQuoteText?: (text: string, rect: { x: number; y: number }) => void;
}) {
  const detailQuery = useMessage(accountId, summary.id);
  const modifyMessage = useModifyMessage();
  const markedRead = useRef(false);

  // Reading a message marks it read — debounced so j/k scrubbing through the
  // list (which mounts and unmounts expanded rows) doesn't fire per row.
  useEffect(() => {
    if (markedRead.current || !summary.unread) return;
    const timer = setTimeout(() => {
      markedRead.current = true;
      console.log("[MessageReader:markRead]", { messageId: summary.id });
      void modifyMessage.mutateAsync({
        accountId,
        messageId: summary.id,
        removeLabelIds: ["UNREAD"],
      });
    }, 300);
    return () => clearTimeout(timer);
  }, [summary.unread, summary.id, accountId, modifyMessage]);

  const detail = detailQuery.data;

  return (
    <div className="group flex gap-2.5 px-5 py-2">
      <SenderAvatar
        name={summary.fromName}
        email={summary.fromEmail}
        accountId={accountId}
        className="mt-0.5 shrink-0"
      />
      <div className="min-w-0 flex-1">
        <button
          type="button"
          onClick={onCollapse}
          disabled={!onCollapse}
          className="flex w-full items-baseline gap-2 text-left"
          aria-label={onCollapse ? "Collapse message" : undefined}
        >
          <span className="truncate text-[15px] font-bold leading-snug text-(--te-strong)">
            {summary.fromName || summary.fromEmail}
          </span>
          <span
            className="te-num shrink-0 text-[10px] text-(--te-faint)"
            title={formatFullDate(summary.date)}
          >
            {formatTime(summary.date)}
          </span>
          {onCollapse ? (
            <ChevronDownIcon className="size-3.5 shrink-0 rotate-180 self-center text-(--te-faint) opacity-0 group-hover:opacity-100" />
          ) : null}
        </button>
        <div className="truncate text-[12px] text-(--te-faint)" title={`to ${summary.to}`}>
          to {summary.to}
          {detail?.cc ? ` · cc ${detail.cc}` : ""}
        </div>
        <div className="mt-1.5">
          {detailQuery.isLoading ? (
            <div className="flex flex-col gap-2">
              <div className="h-4 w-3/4 animate-pulse rounded-[3px] bg-(--te-ctl)" />
              <div className="h-4 w-1/2 animate-pulse rounded-[3px] bg-(--te-hover)" />
            </div>
          ) : detail ? (
            <>
              <MessageBody
                bodyHtml={detail.bodyHtml}
                bodyText={detail.bodyText}
                onQuoteText={onQuoteText}
              />
              <AttachmentList
                accountId={accountId}
                messageId={summary.id}
                attachments={detail.attachments}
                onDownload={onDownload}
              />
            </>
          ) : (
            <span className="text-[13px] text-(--te-muted)">Could not load this message.</span>
          )}
        </div>
      </div>
    </div>
  );
}

/** Reply-all recipients for the latest message, from this account's viewpoint. */
function computeReplyAll(
  last: GmailMessageSummary & { cc?: string },
  ownEmail: string,
): { to: string; cc: string | undefined } {
  const own = ownEmail.toLowerCase();
  const fromSelf = last.fromEmail.toLowerCase() === own;
  const seen = new Set<string>([own]);
  const to: string[] = [];
  const cc: string[] = [];
  if (!fromSelf) {
    to.push(last.fromEmail);
    seen.add(last.fromEmail.toLowerCase());
  }
  for (const entry of splitAddressList(last.to)) {
    const email = parseAddressEntry(entry).email.toLowerCase();
    if (!email || seen.has(email)) continue;
    seen.add(email);
    // Replying to your own message keeps its recipients in To.
    (fromSelf ? to : cc).push(entry);
  }
  for (const entry of splitAddressList(last.cc ?? "")) {
    const email = parseAddressEntry(entry).email.toLowerCase();
    if (!email || seen.has(email)) continue;
    seen.add(email);
    cc.push(entry);
  }
  if (to.length === 0) to.push(last.fromEmail);
  return { to: to.join(", "), cc: cc.length > 0 ? cc.join(", ") : undefined };
}

type InlineMode = "reply" | "replyAll" | "forward";

const INLINE_MODE_LABEL: Record<InlineMode, string> = {
  reply: "Reply",
  replyAll: "Reply all",
  forward: "Forward",
};

/** Reply-to-sender recipients for the latest message. */
function computeReply(
  last: GmailMessageSummary,
  ownEmail: string,
): { to: string; cc: string | undefined } {
  const fromSelf = last.fromEmail.toLowerCase() === ownEmail.toLowerCase();
  // Replying to your own message targets its recipients instead of yourself.
  return { to: fromSelf ? last.to : last.fromEmail, cc: undefined };
}

function forwardBlock(source: GmailMessageSummary & { bodyText?: string | null }): string {
  const fromDisplay = source.fromName
    ? `${source.fromName} <${source.fromEmail}>`
    : source.fromEmail;
  return `\n\n---------- Forwarded message ----------\nFrom: ${fromDisplay}\nDate: ${formatFullDate(source.date)}\nSubject: ${source.subject}\nTo: ${source.to}\n\n${source.bodyText ?? ""}`;
}

/**
 * The in-thread composer: reply, reply-all, or forward the latest message
 * without leaving the conversation, autosaving to a thread draft as you type.
 */
function InlineComposer({
  accountId,
  mode,
  lastMessage,
  baseSubject,
  threadId,
  onClose,
}: {
  accountId: string;
  mode: InlineMode;
  lastMessage: GmailMessageSummary;
  baseSubject: string;
  threadId: string;
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  const [to, setTo] = useState("");
  const [cc, setCc] = useState("");
  const [ccVisible, setCcVisible] = useState(false);
  const [bcc, setBcc] = useState("");
  const [bccVisible, setBccVisible] = useState(false);
  const recipientsDirty = useRef(false);
  // null = still fetching the forwarded original's files.
  const [attachments, setAttachments] = useState<ComposeAttachment[] | null>(
    mode === "forward" ? null : [],
  );
  const editorRef = useRef<RichTextRef>(null);
  const toRef = useRef<HTMLInputElement>(null);
  const sendMessage = useSendMessage();
  const accountsQuery = useAccounts();
  // The latest message's detail carries its Cc line and body text (summaries
  // don't); usually already cached since the last message renders expanded.
  const lastDetailQuery = useMessage(accountId, lastMessage.id);
  const lastDetail = lastDetailQuery.data;

  const ownEmail = accountsQuery.data?.find((a) => a.id === accountId)?.email ?? "";

  // Prefill recipients per mode; refine once the detail arrives, unless the
  // user already edited the fields.
  useEffect(() => {
    if (recipientsDirty.current) return;
    const source = lastDetail ?? lastMessage;
    if (mode === "forward") {
      setTo("");
      setCc("");
      setCcVisible(false);
      return;
    }
    const r = mode === "reply" ? computeReply(source, ownEmail) : computeReplyAll(source, ownEmail);
    setTo(r.to);
    setCc(r.cc ?? "");
    setCcVisible(!!r.cc);
  }, [mode, lastMessage, lastDetail, ownEmail]);

  // Forward seeds the original's attachments; other modes keep manual picks.
  useEffect(() => {
    if (mode !== "forward") return;
    if (!lastDetail) {
      setAttachments(null);
      return;
    }
    if (lastDetail.attachments.length === 0) {
      setAttachments([]);
      return;
    }
    let cancelled = false;
    setAttachments(null);
    void (async () => {
      try {
        const out: ComposeAttachment[] = [];
        for (const att of lastDetail.attachments) {
          const data = await gmailApi.getAttachmentData({
            accountId,
            messageId: lastMessage.id,
            attachmentId: att.id,
          });
          out.push({ name: att.filename, mimeType: att.mimeType, size: data.size, base64: data.base64 });
        }
        if (!cancelled) setAttachments(out);
      } catch {
        if (!cancelled) {
          setAttachments([]);
          toast.error("Could not load the original attachments");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mode, accountId, lastMessage.id, lastDetail]);

  useEffect(() => {
    if (mode === "forward") toRef.current?.focus();
    else editorRef.current?.focus();
  }, [mode]);

  const subject =
    mode === "forward"
      ? baseSubject.startsWith("Fwd:")
        ? baseSubject
        : `Fwd: ${baseSubject}`
      : baseSubject.startsWith("Re:")
        ? baseSubject
        : `Re: ${baseSubject}`;

  // Half-written replies/forwards persist as thread drafts.
  const draft = useDraftAutosave({
    accountId,
    threadId,
    signal: JSON.stringify({ to, cc, bcc, subject, text, att: attachmentSignature(attachments) }),
    getPayload: () => {
      if (!text.trim() || attachments == null) return null;
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

  const hasRecipient = splitAddressList(to).some((e) => parseAddressEntry(e).email.includes("@"));
  const forwardReady = attachments != null && (mode !== "forward" || lastDetail != null);
  const canSend =
    !sendMessage.isPending &&
    hasRecipient &&
    forwardReady &&
    (mode === "forward" || text.trim().length > 0);

  const handleSend = () => {
    if (!canSend) return;
    const plain = editorRef.current?.getText() ?? text;
    const html = editorRef.current?.getHTML() ?? textToHtml(text);
    const quoted = mode === "forward" ? forwardBlock(lastDetail ?? lastMessage) : "";
    const body = `${plain}${quoted}`;
    const bodyHtml = `<div dir="auto">${html}${textToHtml(quoted)}</div>`;
    console.log("[MessageReader:inlineSend]", { mode, threadId });
    // Optimistic: close now — the unmount flush keeps a draft backup, so a
    // failed send degrades to "still in Drafts" instead of lost work.
    onClose();
    sendMessage
      .mutateAsync({
        accountId,
        to,
        cc: cc.trim() || undefined,
        bcc: bcc.trim() || undefined,
        subject,
        body,
        bodyHtml,
        attachments: attachments && attachments.length > 0 ? attachments : undefined,
        ...(mode === "forward" ? {} : { threadId, replyToMessageId: lastMessage.id }),
      })
      .then(
        () => void draft.finalize({ deleteDraft: true }),
        () => toast.error("Couldn't send — kept in Drafts"),
      );
  };

  const senderFirstName =
    (lastMessage.fromName || lastMessage.fromEmail).split(" ")[0] || "thread";
  const placeholder =
    mode === "reply"
      ? `Reply to ${senderFirstName}…`
      : mode === "replyAll"
        ? "Reply to everyone…"
        : "Add a note (optional)…";

  return (
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
        <div className="flex items-center gap-2 border-b border-(--te-border) px-3 py-1.5">
          <span className="te-label shrink-0 rounded-[3px] bg-(--te-strong) px-1.5 py-1 text-(--te-card)">
            {INLINE_MODE_LABEL[mode]}
          </span>
          <span className="te-label shrink-0 text-(--te-faint)">To</span>
          <RecipientInput
            ref={toRef}
            value={to}
            onChange={(v) => {
              recipientsDirty.current = true;
              setTo(v);
            }}
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
          {!bccVisible ? (
            <button
              type="button"
              onClick={() => setBccVisible(true)}
              className="shrink-0 text-[11px] text-(--te-faint) hover:text-(--te-strong)"
            >
              Bcc
            </button>
          ) : null}
          <IconBtn
            label="Discard"
            className="size-6"
            onClick={() => {
              onClose();
              void draft.finalize({ deleteDraft: true });
            }}
          >
            <XIcon className="size-3.5" />
          </IconBtn>
        </div>
        {ccVisible ? (
          <div className="flex items-center gap-2 border-b border-(--te-border) px-3 py-1.5">
            <span className="te-label shrink-0 text-(--te-faint)">Cc</span>
            <RecipientInput
              value={cc}
              onChange={(v) => {
                recipientsDirty.current = true;
                setCc(v);
              }}
              ariaLabel="Cc"
            />
          </div>
        ) : null}
        {bccVisible ? (
          <div className="flex items-center gap-2 border-b border-(--te-border) px-3 py-1.5">
            <span className="te-label shrink-0 text-(--te-faint)">Bcc</span>
            <RecipientInput value={bcc} onChange={setBcc} ariaLabel="Bcc" />
          </div>
        ) : null}
        <RichTextArea
          ref={editorRef}
          placeholder={placeholder}
          ariaLabel={INLINE_MODE_LABEL[mode]}
          onTextChange={setText}
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
              onClick={() => {
                void pickComposeAttachments(attachments ?? []).then((picked) => {
                  if (picked.length > 0) setAttachments((prev) => [...(prev ?? []), ...picked]);
                });
              }}
            >
              <PaperclipIcon className="size-3.5" />
            </IconBtn>
          </HintTooltip>
          {mode === "forward" && attachments == null ? (
            <span className="te-label pl-1 text-(--te-faint)">Loading attachments…</span>
          ) : null}
          {draft.saveState === "saving" ? (
            <span className="te-label pl-1 text-(--te-faint)">Saving draft…</span>
          ) : draft.saveState === "saved" ? (
            <span className="te-label pl-1 text-(--te-faint)">Draft saved</span>
          ) : draft.saveState === "error" ? (
            <span className="te-label pl-1 text-(--red)">Couldn't save draft</span>
          ) : null}
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
  );
}

function ReaderShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full min-w-0 flex-col">
      <div className="drag-region h-[52px] shrink-0 border-b border-(--te-border)" />
      {children}
    </div>
  );
}

export function MessageReader({
  accountId,
  messageId,
  onDeselect,
  onAdvance,
  onOpenChat,
  onQuote,
}: MessageReaderProps) {
  // Reply/reply-all/forward handlers exist only when a message is open; the
  // render below refreshes this ref so the once-mounted listener stays current.
  const readerActions = useRef<{ reply?: () => void; replyAll?: () => void; forward?: () => void }>(
    {},
  );
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e)) return;
      if (e.key === "r") {
        e.preventDefault();
        readerActions.current.reply?.();
      } else if (e.key === "a") {
        e.preventDefault();
        readerActions.current.replyAll?.();
      } else if (e.key === "f") {
        e.preventDefault();
        readerActions.current.forward?.();
      }
    };
    window.addEventListener("keydown", down);
    return () => window.removeEventListener("keydown", down);
  }, []);
  // Cleared every render; the message-open path below re-populates it, so the
  // shortcuts are inert when no message is on screen.
  readerActions.current = {};

  const messageQuery = useMessage(accountId, messageId);
  const labelsQuery = useLabels(accountId);
  const modifyMessage = useModifyMessage();
  const trashMessage = useTrashMessage();
  const modifyThread = useModifyThread();
  const trashThread = useTrashThread();
  const untrashThread = useUntrashThread();
  const untrashMessage = useUntrashMessage();
  const deleteForever = useDeleteThreadsForever();
  const getAttachment = useGetAttachment();

  const message = messageQuery.data;
  const threadId = message?.threadId || null;
  const threadQuery = useThread(messageId ? accountId : null, threadId);
  const threadMessages = threadQuery.data ?? [];
  const isThread = threadMessages.length > 1;

  const [inline, setInline] = useState<InlineMode | null>(null);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(new Set());
  const seededRef = useRef<string | null>(null);

  // Ask-Hermes handoff for the open conversation (pointer-only context).
  const [askContext, setAskContext] = useState<AssistantContext | null>(null);
  const readerAccounts = useAccounts();
  const handleAskAssistant = () => {
    if (!message) return;
    const rows = threadMessages.length > 0 ? threadMessages : [message];
    console.log("[MessageReader:askAssistant]", { threadId: message.threadId || message.id });
    setAskContext({
      conversations: [
        {
          account: readerAccounts.data?.find((a) => a.id === accountId)?.email ?? accountId,
          threadId: message.threadId || message.id,
          subject: message.subject || "(no subject)",
          from: rows[rows.length - 1].fromEmail,
          messageIds: rows.map((m) => m.id),
        },
      ],
    });
  };

  // Quote-from-selection: a highlighted excerpt (parent DOM or an HTML iframe)
  // becomes a "quote" context item for the chat panel or the Slack handoff.
  const [quotePopover, setQuotePopover] = useState<{ text: string; x: number; y: number } | null>(
    null,
  );
  const buildQuote = (text: string): QuoteContext | null => {
    if (!message) return null;
    return {
      text: text.length > 600 ? `${text.slice(0, 600)}…` : text,
      account: readerAccounts.data?.find((a) => a.id === accountId)?.email ?? accountId,
      accountId,
      threadId: message.threadId || message.id,
      subject: message.subject || "(no subject)",
      messageId: message.id,
    };
  };
  const onParentMouseUp = () => {
    const sel = window.getSelection();
    const text = sel?.toString().trim() ?? "";
    if (!text || !sel || sel.rangeCount === 0) {
      setQuotePopover(null);
      return;
    }
    const r = sel.getRangeAt(0).getBoundingClientRect();
    setQuotePopover({ text, x: r.left + r.width / 2, y: r.top });
  };
  const quoteToChat = () => {
    const q = quotePopover && buildQuote(quotePopover.text);
    if (q) onQuote?.(q);
    setQuotePopover(null);
  };
  const quoteToSlack = () => {
    const q = quotePopover && buildQuote(quotePopover.text);
    if (q) setAskContext(contextFromQuote(q));
    setQuotePopover(null);
  };
  // Dismiss the popover on scroll/Escape (its fixed coords would go stale).
  useEffect(() => {
    if (!quotePopover) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setQuotePopover(null);
    };
    const onScroll = () => setQuotePopover(null);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [quotePopover]);

  useEffect(() => {
    setInline(null);
    setQuotePopover(null);
  }, [messageId]);

  // Escape closes the inline composer before anything else: registered in the
  // capture phase so home-view's Escape-deselects-message listener never fires
  // while a draft is open (dialogs keep their own Escape handling).
  const inlineRef = useRef<InlineMode | null>(null);
  inlineRef.current = inline;
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || !inlineRef.current) return;
      const el = e.target as Element | null;
      if (el && typeof el.closest === "function" && el.closest('[role="dialog"]')) return;
      // An open autocomplete popup owns Escape (it dismisses itself).
      if (el && typeof el.closest === "function" && el.closest('[data-ac-open="true"]')) return;
      e.preventDefault();
      e.stopPropagation();
      setInline(null);
    };
    window.addEventListener("keydown", down, true);
    return () => window.removeEventListener("keydown", down, true);
  }, []);

  // Seed which conversation rows start expanded: the last message, every
  // unread one, and the opened message itself (differs when opened via search).
  useEffect(() => {
    if (!messageId || !threadId || threadMessages.length === 0) return;
    const seedKey = `${accountId}:${threadId}:${messageId}`;
    if (seededRef.current === seedKey) return;
    seededRef.current = seedKey;
    const ids = new Set<string>();
    for (const m of threadMessages) if (m.unread) ids.add(m.id);
    const last = threadMessages[threadMessages.length - 1];
    if (last) ids.add(last.id);
    ids.add(messageId);
    setExpandedIds(ids);
  }, [accountId, threadId, messageId, threadMessages]);

  if (!messageId) {
    return (
      <ReaderShell>
        <div className="flex flex-1 flex-col items-center justify-center gap-1 px-6 text-center">
          <span className="text-[15px] font-bold text-(--te-text)">Select a conversation</span>
          <span className="text-[13px] text-(--te-muted)">
            Choose a message from the list to read it here.
          </span>
        </div>
      </ReaderShell>
    );
  }

  if (messageQuery.isLoading || threadQuery.isLoading) {
    return (
      <ReaderShell>
        <div className="flex flex-col gap-3 p-5">
          <div className="h-5 w-64 animate-pulse rounded-[3px] bg-(--te-ctl)" />
          <div className="h-4 w-48 animate-pulse rounded-[3px] bg-(--te-hover)" />
          <div className="h-4 w-40 animate-pulse rounded-[3px] bg-(--te-hover)" />
        </div>
      </ReaderShell>
    );
  }

  if (!message) {
    return (
      <ReaderShell>
        <div className="flex flex-1 flex-col items-center justify-center gap-1 px-6 text-center">
          <span className="text-[15px] font-bold text-(--te-text)">Could not load message</span>
          <span className="text-[13px] text-(--te-muted)">
            The message could not be retrieved. Try again.
          </span>
        </div>
      </ReaderShell>
    );
  }

  // Drafts resume in the composer pane instead of rendering read-only.
  if (message.labelIds.includes("DRAFT")) {
    return (
      <DraftEditor
        key={`${accountId}:${message.id}`}
        accountId={accountId}
        detail={message}
        threadMessages={threadMessages}
        onDone={onDeselect ?? (() => {})}
      />
    );
  }

  // From here on the conversation is renderable — a thread of one message
  // falls back to the opened message itself.
  const rows: GmailMessageSummary[] = threadMessages.length > 0 ? threadMessages : [message];
  const lastRow = rows[rows.length - 1];

  const isUnread = isThread ? threadMessages.some((m) => m.unread) : message.unread;

  const labelsById = new Map((labelsQuery.data ?? []).map((l) => [l.id, l]));
  const messageLabels = message.labelIds
    .map((id) => labelsById.get(id))
    .filter((l): l is GmailLabel => l != null && l.type === "user");

  const toggleExpanded = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleToggleRead = () => {
    console.log("[MessageReader:toggleRead]", { messageId, isUnread, isThread });
    if (isThread && threadId) {
      if (isUnread) {
        void modifyThread.mutateAsync({
          accountId,
          threadId,
          removeLabelIds: ["UNREAD"],
        });
      } else {
        // Marking a read conversation unread flags only its latest message.
        const last = threadMessages[threadMessages.length - 1];
        void modifyMessage.mutateAsync({
          accountId,
          messageId: last.id,
          addLabelIds: ["UNREAD"],
        });
      }
      return;
    }
    void modifyMessage.mutateAsync({
      accountId,
      messageId,
      addLabelIds: isUnread ? undefined : ["UNREAD"],
      removeLabelIds: isUnread ? ["UNREAD"] : undefined,
    });
  };

  const handleArchive = () => {
    console.log("[MessageReader:archive]", { messageId, isThread });
    if (isThread && threadId) {
      void modifyThread.mutateAsync({ accountId, threadId, removeLabelIds: ["INBOX"] });
      return;
    }
    void modifyMessage.mutateAsync({
      accountId,
      messageId,
      removeLabelIds: ["INBOX"],
    });
  };

  const handleUnarchive = () => {
    console.log("[MessageReader:unarchive]", { messageId, isThread });
    if (isThread && threadId) {
      void modifyThread.mutateAsync({ accountId, threadId, addLabelIds: ["INBOX"] });
      return;
    }
    void modifyMessage.mutateAsync({
      accountId,
      messageId,
      addLabelIds: ["INBOX"],
    });
  };

  const handleTrash = () => {
    console.log("[MessageReader:trash]", { messageId, isThread });
    if (isThread && threadId) {
      void trashThread.mutateAsync({ accountId, threadId });
      return;
    }
    void trashMessage.mutateAsync({ accountId, messageId });
  };

  const handleDeleteForever = () => {
    setConfirmDeleteOpen(false);
    console.log("[MessageReader:deleteForever]", { messageId });
    onAdvance?.();
    void deleteForever.mutateAsync({ accountId, threadIds: [message.threadId || message.id] });
  };

  const handleUntrash = () => {
    console.log("[MessageReader:untrash]", { messageId, isThread });
    if (isThread && threadId) {
      void untrashThread.mutateAsync({ accountId, threadId });
      return;
    }
    void untrashMessage.mutateAsync({ accountId, messageId });
  };

  const handleReply = () => {
    console.log("[MessageReader:reply]", { messageId });
    setInline("reply");
  };

  const handleReplyAll = () => {
    console.log("[MessageReader:replyAll]", { messageId });
    setInline("replyAll");
  };

  const handleForward = () => {
    console.log("[MessageReader:forward]", { messageId });
    setInline("forward");
  };

  const handleDownloadAttachment: DownloadAttachment = (
    attachmentMessageId,
    attachmentId,
    filename,
    mimeType,
  ) => {
    console.log("[MessageReader:downloadAttachment]", {
      messageId: attachmentMessageId,
      filename,
    });
    void (async () => {
      try {
        const result = await getAttachment.mutateAsync({
          accountId,
          messageId: attachmentMessageId,
          attachmentId,
          filename,
          mimeType,
        });
        if (result.saved && result.path) {
          toast.success(`Saved to ${result.path}`);
        } else {
          toast.error("Failed to save attachment");
        }
      } catch {
        toast.error("Could not download attachment");
      }
    })();
  };

  readerActions.current = {
    reply: handleReply,
    replyAll: handleReplyAll,
    forward: handleForward,
  };

  const isFlagged = message.labelIds.includes("STARRED");
  const isTrashed = message.labelIds.includes("TRASH");

  const handleToggleFlag = () => {
    console.log("[MessageReader:toggleFlag]", { messageId, isFlagged });
    void modifyMessage.mutateAsync({
      accountId,
      messageId: message.id,
      ...(isFlagged ? { removeLabelIds: ["STARRED"] } : { addLabelIds: ["STARRED"] }),
    });
  };

  const isJunk = message.labelIds.includes("SPAM");

  const handleJunk = () => {
    console.log("[MessageReader:junkToggle]", { messageId, isThread, isJunk });
    const addLabelIds = isJunk ? ["INBOX"] : ["SPAM"];
    const removeLabelIds = isJunk ? ["SPAM"] : ["INBOX"];
    if (isThread && threadId) {
      void modifyThread.mutateAsync({ accountId, threadId, addLabelIds, removeLabelIds });
      return;
    }
    void modifyMessage.mutateAsync({
      accountId,
      messageId: message.id,
      addLabelIds,
      removeLabelIds,
    });
  };

  const groupDivider = <span className="mx-1 h-5 w-px shrink-0 bg-(--te-border)" aria-hidden />;

  return (
    <>
      <div className="flex h-full min-w-0 flex-col">
        {/* Conversation header */}
        <div className="drag-region flex h-[52px] shrink-0 items-center gap-1 border-b border-(--te-border) px-4">
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              <span className="truncate text-[15px] font-bold leading-tight tracking-tight text-(--te-strong)">
                {message.subject || "(no subject)"}
              </span>
              {message.labelIds.includes("INBOX") ||
              message.labelIds.some(isCategoryLabelId) ||
              messageLabels.length > 0 ? (
                <span className="flex max-w-[45%] shrink-0 items-center gap-1 overflow-hidden">
                  {message.labelIds.includes("INBOX") ? (
                    <InboxChip onRemove={handleArchive} />
                  ) : null}
                  {message.labelIds.filter(isCategoryLabelId).map((id) => (
                    <CategoryChip key={id} id={id} />
                  ))}
                  {messageLabels.map((label) => (
                    <LabelChip
                      key={label.id}
                      label={label}
                      onRemove={() => {
                        console.log("[MessageReader:removeLabelChip]", { labelId: label.id });
                        void modifyMessage.mutateAsync({
                          accountId,
                          messageId: message.id,
                          removeLabelIds: [label.id],
                        });
                      }}
                    />
                  ))}
                </span>
              ) : null}
            </div>
            <div className="te-label truncate leading-tight text-(--te-muted)">
              {isThread ? `${rows.length} messages` : formatFullDate(message.date)}
            </div>
          </div>

          <HintTooltip label="Reply" hint="R">
            <IconBtn label="Reply" onClick={handleReply}>
              <ReplyIcon className="size-4" />
            </IconBtn>
          </HintTooltip>
          <HintTooltip label="Reply all" hint="A">
            <IconBtn label="Reply all" onClick={handleReplyAll}>
              <ReplyAllIcon className="size-4" />
            </IconBtn>
          </HintTooltip>
          <HintTooltip label="Forward" hint="F">
            <IconBtn label="Forward" onClick={handleForward}>
              <ForwardIcon className="size-4" />
            </IconBtn>
          </HintTooltip>

          {groupDivider}

          {isTrashed ? null : (isThread ? rows.some((m) => m.labelIds.includes("INBOX")) : message.labelIds.includes("INBOX")) ? (
            <HintTooltip label="Archive" hint="E">
              <IconBtn
                label="Archive"
                onClick={() => {
                  onAdvance?.();
                  handleArchive();
                }}
              >
                <ArchiveIcon className="size-4" />
              </IconBtn>
            </HintTooltip>
          ) : (
            <HintTooltip label="Move to Inbox" hint="E">
              <IconBtn label="Move to Inbox" onClick={handleUnarchive}>
                <ArchiveRestoreIcon className="size-4" />
              </IconBtn>
            </HintTooltip>
          )}
          {isTrashed || isJunk ? (
            <HintTooltip label="Delete Forever">
              <IconBtn label="Delete Forever" onClick={() => setConfirmDeleteOpen(true)}>
                <Trash2Icon className="size-4 text-(--red)" />
              </IconBtn>
            </HintTooltip>
          ) : null}
          {isTrashed ? (
            <HintTooltip label="Restore from Trash" hint="#">
              <IconBtn label="Restore from Trash" onClick={handleUntrash}>
                <RotateCcwIcon className="size-4" />
              </IconBtn>
            </HintTooltip>
          ) : (
            <HintTooltip label="Move to Trash" hint="#">
              <IconBtn
                label="Move to Trash"
                onClick={() => {
                  onAdvance?.();
                  handleTrash();
                }}
              >
                <Trash2Icon className="size-4" />
              </IconBtn>
            </HintTooltip>
          )}
          {isJunk ? (
            <HintTooltip label="Not Junk — move to Inbox" hint="!">
              <IconBtn label="Not Junk" onClick={handleJunk}>
                <ShieldCheckIcon className="size-4" />
              </IconBtn>
            </HintTooltip>
          ) : (
            <HintTooltip label="Move to Junk" hint="!">
              <IconBtn
                label="Move to Junk"
                onClick={() => {
                  onAdvance?.();
                  handleJunk();
                }}
              >
                <ArchiveXIcon className="size-4" />
              </IconBtn>
            </HintTooltip>
          )}

          {groupDivider}

          <LabelPickerMenu accountId={accountId} messageId={message.id} labelIds={message.labelIds}>
            <IconBtn label="Move to label">
              <span className="flex items-center gap-0.5">
                <FolderIcon className="size-4" />
                <ChevronDownIcon className="size-3" />
              </span>
            </IconBtn>
          </LabelPickerMenu>

          {groupDivider}

          <HintTooltip label={isFlagged ? "Unflag" : "Flag"} hint="S">
            <IconBtn label={isFlagged ? "Unflag" : "Flag"} onClick={handleToggleFlag}>
              <FlagIcon
                className={["size-4 text-(--red)", isFlagged ? "fill-current" : ""].join(" ")}
              />
            </IconBtn>
          </HintTooltip>
          <HintTooltip label={isUnread ? "Mark as read" : "Mark as unread"}>
            <IconBtn
              label={isUnread ? "Mark as read" : "Mark as unread"}
              onClick={handleToggleRead}
            >
              {isUnread ? <MailOpenIcon className="size-4" /> : <MailIcon className="size-4" />}
            </IconBtn>
          </HintTooltip>

          {groupDivider}

          <HintTooltip label="Send to Hermes in Slack">
            <IconBtn label="Send to Hermes in Slack" onClick={handleAskAssistant}>
              <SlackAiIcon className="size-4" />
            </IconBtn>
          </HintTooltip>
          <HintTooltip label="Chat about this in Hermes">
            <IconBtn label="Open in Hermes chat" onClick={() => onOpenChat?.()}>
              <BotMessageSquareIcon className="size-4" />
            </IconBtn>
          </HintTooltip>
        </div>

        {isTrashed ? (
          <div className="mx-5 mt-3 flex shrink-0 items-center gap-2 rounded-[6px] border border-(--te-outline) bg-(--te-ctl) px-3 py-2">
            <Trash2Icon className="size-3.5 shrink-0 text-(--te-muted)" />
            <span className="te-label text-(--te-muted)">This conversation is in the Trash</span>
            <span className="flex-1" />
            <button
              type="button"
              onClick={handleUntrash}
              className="te-label h-6 shrink-0 rounded-[4px] border border-(--te-outline) px-2 text-(--te-text) hover:border-(--te-outline-hover) hover:text-(--te-strong)"
            >
              Restore
            </button>
            <button
              type="button"
              onClick={() => setConfirmDeleteOpen(true)}
              className="te-label h-6 shrink-0 rounded-[4px] border border-(--te-outline) px-2 text-(--red) hover:border-(--te-outline-hover)"
            >
              Delete forever
            </button>
          </div>
        ) : null}

        {/* Conversation */}
        <div className="te-scroll min-h-0 flex-1 overflow-y-auto pb-2" onMouseUp={onParentMouseUp}>
          {rows.map((m, i) => {
            const prev = rows[i - 1];
            const newDay = !prev || dayKey(prev.date) !== dayKey(m.date);
            const isExpanded = expandedIds.has(m.id) || rows.length === 1;
            const prevExpanded = prev ? expandedIds.has(prev.id) : false;
            return (
              <div key={m.id}>
                {newDay ? <DayDivider timestamp={m.date} /> : null}
                {!newDay && isExpanded && prevExpanded ? (
                  <div className="mx-5 my-1 border-t border-(--te-border)" />
                ) : null}
                {isExpanded ? (
                  <ExpandedRow
                    accountId={accountId}
                    summary={m}
                    onCollapse={rows.length === 1 ? undefined : () => toggleExpanded(m.id)}
                    onDownload={handleDownloadAttachment}
                    onQuoteText={(text, rect) => setQuotePopover({ text, x: rect.x, y: rect.y })}
                  />
                ) : (
                  <CollapsedRow accountId={accountId} summary={m} onExpand={() => toggleExpanded(m.id)} />
                )}
              </div>
            );
          })}
        </div>

        {quotePopover ? (
          <div
            className="fixed z-50 flex -translate-x-1/2 -translate-y-full items-center gap-0.5 rounded-[8px] border border-(--te-outline) bg-(--te-panel) p-0.5 shadow-lg"
            style={{ left: quotePopover.x, top: quotePopover.y - 8 }}
            onMouseDown={(e) => e.preventDefault()}
          >
            <button
              type="button"
              onClick={quoteToChat}
              className="flex h-7 items-center gap-1.5 rounded-[6px] px-2 text-[12px] text-(--te-text) hover:bg-(--te-hover)"
            >
              <TextQuoteIcon className="size-3.5" />
              Quote in chat
            </button>
            <span className="h-4 w-px shrink-0 bg-(--te-border)" aria-hidden />
            <button
              type="button"
              onClick={quoteToSlack}
              aria-label="Send quote to Hermes in Slack"
              className="flex size-7 items-center justify-center rounded-[6px] text-(--te-text) hover:bg-(--te-hover)"
            >
              <SlackAiIcon className="size-4" />
            </button>
          </div>
        ) : null}

        {/* In-thread composer, hidden until replying/forwarding */}
        {lastRow && inline ? (
          <InlineComposer
            key={inline}
            accountId={accountId}
            mode={inline}
            lastMessage={lastRow}
            baseSubject={message.subject}
            threadId={message.threadId || message.id}
            onClose={() => setInline(null)}
          />
        ) : null}
      </div>

      <AskAssistantDialog
        context={askContext}
        onOpenChange={(o) => {
          if (!o) setAskContext(null);
        }}
      />

      <Dialog
        open={confirmDeleteOpen}
        onOpenChange={setConfirmDeleteOpen}
        title="Delete Forever"
        confirmLabel="Delete Forever"
        confirmVariant="accent"
        onConfirm={handleDeleteForever}
      >
        <Text variant="small">
          Permanently delete this conversation? This cannot be undone.
        </Text>
      </Dialog>
    </>
  );
}
