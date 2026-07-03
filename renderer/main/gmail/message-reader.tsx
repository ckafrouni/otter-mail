import { useEffect, useRef, useState } from "react";
import {
  ScrollArea,
  Toolbar,
  ToolbarContent,
  ToolbarTitle,
  ToolbarActions,
  Button,
  EmptyState,
  Text,
  toast,
  CollapsibleRoot,
  CollapsibleTrigger,
  CollapsibleContent,
  CollapsibleChevron,
} from "@glaze/core/components";
import {
  ArchiveIcon,
  Trash2Icon,
  MailOpenIcon,
  MailIcon,
  ReplyIcon,
  ReplyAllIcon,
  ForwardIcon,
  DownloadIcon,
  TagIcon,
} from "lucide-react";
import {
  useAccounts,
  useMessage,
  useThread,
  useModifyMessage,
  useTrashMessage,
  useModifyThread,
  useTrashThread,
  useGetAttachment,
  useLabels,
} from "./hooks";
import { gmailApi } from "./api";
import { ComposeDialog, type ComposePrefill } from "./compose-dialog";
import { LabelChip } from "./label-chip";
import { LabelPickerMenu } from "./label-picker-menu";
import { parseAddressEntry, splitAddressList } from "./address";
import type {
  ComposeAttachment,
  GmailLabel,
  GmailMessageDetail,
  GmailMessageSummary,
} from "./types";

type MessageReaderProps = {
  accountId: string;
  messageId: string | null;
};

type ComposeState = {
  title: string;
  prefill: ComposePrefill;
  replyTo?: { threadId: string; messageId: string };
};

type DownloadAttachment = (
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

function formatCardDate(timestamp: number): string {
  return new Date(timestamp).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function MessageBody({
  bodyHtml,
  bodyText,
}: {
  bodyHtml: string | null;
  bodyText: string | null;
}) {
  if (bodyHtml) {
    return (
      <iframe
        sandbox="allow-same-origin"
        srcDoc={bodyHtml}
        className="w-full border-none rounded-card"
        title="Message body"
        onLoad={(e) => {
          const iframe = e.currentTarget;
          const doc = iframe.contentDocument || iframe.contentWindow?.document;
          if (doc) {
            iframe.style.height = doc.documentElement.scrollHeight + "px";
          }
        }}
      />
    );
  }
  if (bodyText) {
    return (
      <pre className="whitespace-pre-wrap font-sans text-regular text-primary leading-relaxed">
        {bodyText}
      </pre>
    );
  }
  return (
    <Text variant="small" color="tertiary">
      (No message body)
    </Text>
  );
}

function AttachmentList({
  messageId,
  attachments,
  onDownload,
}: {
  messageId: string;
  attachments: GmailMessageDetail["attachments"];
  onDownload: DownloadAttachment;
}) {
  if (attachments.length === 0) return null;
  return (
    <div className="flex flex-col gap-2 border-t border-separator pt-4">
      <Text variant="small-strong">Attachments ({attachments.length})</Text>
      <div className="flex flex-col gap-1">
        {attachments.map((att) => (
          <div
            key={att.id}
            className="flex items-center justify-between gap-3 px-3 py-2 rounded-card bg-well"
          >
            <div className="flex flex-col min-w-0">
              <Text variant="small" truncate>
                {att.filename}
              </Text>
              <Text variant="mini" color="tertiary">
                {att.mimeType} · {formatBytes(att.size)}
              </Text>
            </div>
            <Button
              variant="filled"
              size="small"
              iconOnly
              onClick={() => onDownload(messageId, att.id, att.filename, att.mimeType)}
              aria-label={`Download ${att.filename}`}
            >
              <DownloadIcon className="size-4" />
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}

function CollapsedMessageCard({
  summary,
  onExpand,
}: {
  summary: GmailMessageSummary;
  onExpand: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onExpand}
      className="w-full text-left rounded-card border border-separator px-4 py-3 flex items-start gap-3 hover:bg-control-subtle transition-colors"
    >
      {summary.unread ? (
        <span className="size-1.5 rounded-full bg-accent shrink-0 mt-1.5" />
      ) : null}
      <div className="flex flex-col min-w-0 flex-1 gap-0.5">
        <div className="flex items-center justify-between gap-2">
          <Text
            variant={summary.unread ? "small-strong" : "small"}
            truncate
            className="flex-1 min-w-0"
          >
            {summary.fromName || summary.fromEmail}
          </Text>
          <Text variant="mini" color="tertiary" className="shrink-0 tabular-nums">
            {formatCardDate(summary.date)}
          </Text>
        </div>
        <Text variant="mini" color="tertiary" truncate>
          {summary.snippet}
        </Text>
      </div>
    </button>
  );
}

function ExpandedMessageCard({
  accountId,
  summary,
  onCollapse,
  onDownload,
}: {
  accountId: string;
  summary: GmailMessageSummary;
  onCollapse: () => void;
  onDownload: DownloadAttachment;
}) {
  const detailQuery = useMessage(accountId, summary.id);
  const modifyMessage = useModifyMessage();
  const markedRead = useRef(false);

  // Expanding an unread message marks it read, like opening a single message.
  useEffect(() => {
    if (markedRead.current || !summary.unread) return;
    markedRead.current = true;
    console.log("[MessageReader:cardMarkRead]", { messageId: summary.id });
    void modifyMessage.mutateAsync({
      accountId,
      messageId: summary.id,
      removeLabelIds: ["UNREAD"],
    });
  }, [summary.unread, summary.id, accountId, modifyMessage]);

  const detail = detailQuery.data;

  return (
    <div className="rounded-card border border-separator">
      <button
        type="button"
        onClick={onCollapse}
        className="w-full text-left px-4 py-3 flex items-start gap-3"
      >
        <div className="flex flex-col min-w-0 flex-1 gap-0.5">
          <Text variant="small-strong" truncate>
            {summary.fromName || summary.fromEmail}
          </Text>
          <Text variant="mini" color="secondary" truncate>
            to {summary.to}
          </Text>
        </div>
        <Text variant="mini" color="tertiary" className="shrink-0 tabular-nums">
          {formatCardDate(summary.date)}
        </Text>
      </button>
      <div className="px-4 pb-4 flex flex-col gap-3">
        {detailQuery.isLoading ? (
          <div className="flex flex-col gap-2">
            <div className="h-4 w-3/4 rounded-pill bg-control animate-pulse" />
            <div className="h-4 w-1/2 rounded-pill bg-control animate-pulse" />
          </div>
        ) : detail ? (
          <>
            <MessageBody bodyHtml={detail.bodyHtml} bodyText={detail.bodyText} />
            <AttachmentList
              messageId={summary.id}
              attachments={detail.attachments}
              onDownload={onDownload}
            />
          </>
        ) : (
          <Text variant="small" color="tertiary">
            Could not load this message.
          </Text>
        )}
      </div>
    </div>
  );
}

export function MessageReader({ accountId, messageId }: MessageReaderProps) {
  const messageQuery = useMessage(accountId, messageId);
  const labelsQuery = useLabels(accountId);
  const accountsQuery = useAccounts();
  const modifyMessage = useModifyMessage();
  const trashMessage = useTrashMessage();
  const modifyThread = useModifyThread();
  const trashThread = useTrashThread();
  const getAttachment = useGetAttachment();

  const message = messageQuery.data;
  const threadId = message?.threadId || null;
  const threadQuery = useThread(messageId ? accountId : null, threadId);
  const threadMessages = threadQuery.data ?? [];
  const isThread = threadMessages.length > 1;

  const [compose, setCompose] = useState<ComposeState | null>(null);
  const [forwardPending, setForwardPending] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(new Set());

  const hasAutoMarked = useRef<string | null>(null);
  const seededRef = useRef<string | null>(null);

  useEffect(() => {
    setDetailsOpen(false);
  }, [messageId]);

  // Seed which conversation cards start expanded: the last message, every
  // unread one, and the opened message itself (differs when opened via search).
  useEffect(() => {
    if (!isThread || !messageId || !threadId) return;
    const seedKey = `${accountId}:${threadId}:${messageId}`;
    if (seededRef.current === seedKey) return;
    seededRef.current = seedKey;
    const ids = new Set<string>();
    for (const m of threadMessages) if (m.unread) ids.add(m.id);
    const last = threadMessages[threadMessages.length - 1];
    if (last) ids.add(last.id);
    ids.add(messageId);
    setExpandedIds(ids);
  }, [isThread, accountId, threadId, messageId, threadMessages]);

  // Auto-mark as read when a single message opens (conversation cards mark
  // themselves as they expand).
  useEffect(() => {
    if (!message || !messageId) return;
    if (threadQuery.isLoading || isThread) return;
    if (hasAutoMarked.current === messageId) return;
    if (!message.unread) return;

    hasAutoMarked.current = messageId;
    console.log("[MessageReader:autoMarkRead]", { messageId });
    void modifyMessage.mutateAsync({
      accountId,
      messageId,
      removeLabelIds: ["UNREAD"],
    });
  }, [message, messageId, accountId, modifyMessage, threadQuery.isLoading, isThread]);

  if (!messageId) {
    return (
      <div className="h-full flex flex-col">
        <Toolbar>
          <ToolbarContent>
            <ToolbarTitle>Gmail</ToolbarTitle>
          </ToolbarContent>
        </Toolbar>
        <div className="relative flex-1">
          <EmptyState
            title="Select a message"
            description="Choose a message from the list to read it."
          />
        </div>
      </div>
    );
  }

  if (messageQuery.isLoading || threadQuery.isLoading) {
    return (
      <div className="h-full flex flex-col">
        <Toolbar>
          <ToolbarContent>
            <ToolbarTitle>Loading...</ToolbarTitle>
          </ToolbarContent>
        </Toolbar>
        <div className="flex flex-col gap-3 p-4">
          <div className="h-5 w-64 rounded-pill bg-control animate-pulse" />
          <div className="h-4 w-48 rounded-pill bg-control animate-pulse" />
          <div className="h-4 w-40 rounded-pill bg-control animate-pulse" />
        </div>
      </div>
    );
  }

  if (!message) {
    return (
      <div className="h-full flex flex-col">
        <Toolbar>
          <ToolbarContent>
            <ToolbarTitle>Error</ToolbarTitle>
          </ToolbarContent>
        </Toolbar>
        <div className="relative flex-1">
          <EmptyState
            title="Could not load message"
            description="The message could not be retrieved. Try again."
          />
        </div>
      </div>
    );
  }

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

  const handleTrash = () => {
    console.log("[MessageReader:trash]", { messageId, isThread });
    if (isThread && threadId) {
      void trashThread.mutateAsync({ accountId, threadId });
      return;
    }
    void trashMessage.mutateAsync({ accountId, messageId });
  };

  const replySubject = message.subject.startsWith("Re:")
    ? message.subject
    : `Re: ${message.subject}`;
  const quotedReplyBody = `\n\n---\nOn ${formatFullDate(message.date)}, ${message.fromName || message.fromEmail} wrote:\n${message.bodyText ?? ""}`;
  const replyTarget = { threadId: message.threadId || message.id, messageId: message.id };

  const handleReply = () => {
    console.log("[MessageReader:reply]", { messageId });
    setCompose({
      title: "Reply",
      prefill: { to: message.fromEmail, subject: replySubject, body: quotedReplyBody },
      replyTo: replyTarget,
    });
  };

  const handleReplyAll = () => {
    console.log("[MessageReader:replyAll]", { messageId });
    const ownEmail =
      accountsQuery.data?.find((a) => a.id === accountId)?.email.toLowerCase() ?? "";
    const seen = new Set<string>([ownEmail, message.fromEmail.toLowerCase()]);
    const ccEntries: string[] = [];
    const recipients = [message.to, message.cc ?? ""].filter(Boolean).join(",");
    for (const entry of splitAddressList(recipients)) {
      const email = parseAddressEntry(entry).email.toLowerCase();
      if (!email || seen.has(email)) continue;
      seen.add(email);
      ccEntries.push(entry);
    }
    setCompose({
      title: "Reply All",
      prefill: {
        to: message.fromEmail,
        cc: ccEntries.join(", ") || undefined,
        subject: replySubject,
        body: quotedReplyBody,
      },
      replyTo: replyTarget,
    });
  };

  const handleForward = () => {
    console.log("[MessageReader:forward]", { messageId });
    const fromDisplay = message.fromName
      ? `${message.fromName} <${message.fromEmail}>`
      : message.fromEmail;
    const forwardBody = `\n\n---------- Forwarded message ----------\nFrom: ${fromDisplay}\nDate: ${formatFullDate(message.date)}\nSubject: ${message.subject}\nTo: ${message.to}\n\n${message.bodyText ?? ""}`;
    void (async () => {
      setForwardPending(true);
      try {
        const attachments: ComposeAttachment[] = [];
        for (const att of message.attachments) {
          const data = await gmailApi.getAttachmentData({
            accountId,
            messageId: message.id,
            attachmentId: att.id,
          });
          attachments.push({
            name: att.filename,
            mimeType: att.mimeType,
            size: data.size,
            base64: data.base64,
          });
        }
        setCompose({
          title: "Forward",
          prefill: {
            subject: message.subject.startsWith("Fwd:")
              ? message.subject
              : `Fwd: ${message.subject}`,
            body: forwardBody,
            attachments: attachments.length > 0 ? attachments : undefined,
          },
        });
      } catch {
        toast.error("Could not load the original attachments");
      } finally {
        setForwardPending(false);
      }
    })();
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

  const toolbar = (
    <Toolbar>
      <ToolbarContent>
        <ToolbarTitle>{message.subject || "(no subject)"}</ToolbarTitle>
      </ToolbarContent>
      <ToolbarActions>
        <Button
          variant="glass"
          size="large"
          iconOnly
          onClick={handleReply}
          aria-label="Reply"
        >
          <ReplyIcon className="size-4.5" />
        </Button>
        <Button
          variant="glass"
          size="large"
          iconOnly
          onClick={handleReplyAll}
          aria-label="Reply all"
        >
          <ReplyAllIcon className="size-4.5" />
        </Button>
        <Button
          variant="glass"
          size="large"
          iconOnly
          onClick={handleForward}
          disabled={forwardPending}
          aria-label="Forward"
        >
          <ForwardIcon className="size-4.5" />
        </Button>
        <LabelPickerMenu
          accountId={accountId}
          messageId={message.id}
          labelIds={message.labelIds}
        >
          <Button variant="glass" size="large" iconOnly aria-label="Labels">
            <TagIcon className="size-4.5" />
          </Button>
        </LabelPickerMenu>
        <Button
          variant="glass"
          size="large"
          iconOnly
          onClick={handleToggleRead}
          aria-label={isUnread ? "Mark as read" : "Mark as unread"}
        >
          {isUnread ? (
            <MailOpenIcon className="size-4.5" />
          ) : (
            <MailIcon className="size-4.5" />
          )}
        </Button>
        <Button
          variant="glass"
          size="large"
          iconOnly
          onClick={handleArchive}
          aria-label={isThread ? "Archive conversation" : "Archive"}
        >
          <ArchiveIcon className="size-4.5" />
        </Button>
        <Button
          variant="glass"
          size="large"
          iconOnly
          onClick={handleTrash}
          aria-label={isThread ? "Trash conversation" : "Trash"}
        >
          <Trash2Icon className="size-4.5" />
        </Button>
      </ToolbarActions>
    </Toolbar>
  );

  return (
    <>
      <ScrollArea className="h-full" toolbar={toolbar}>
        {isThread ? (
          <div className="flex flex-col gap-3 p-4">
            <div className="flex flex-col gap-0.5">
              <Text variant="large-strong" as="h1">
                {message.subject || "(no subject)"}
              </Text>
              <Text variant="mini" color="tertiary">
                {threadMessages.length} messages
              </Text>
            </div>
            <div className="flex flex-col gap-2">
              {threadMessages.map((m) =>
                expandedIds.has(m.id) ? (
                  <ExpandedMessageCard
                    key={m.id}
                    accountId={accountId}
                    summary={m}
                    onCollapse={() => toggleExpanded(m.id)}
                    onDownload={handleDownloadAttachment}
                  />
                ) : (
                  <CollapsedMessageCard
                    key={m.id}
                    summary={m}
                    onExpand={() => toggleExpanded(m.id)}
                  />
                ),
              )}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4 p-4">
            {/* Header */}
            <div className="flex flex-col gap-1 border-b border-separator pb-4">
              <Text variant="large-strong" as="h1">
                {message.subject || "(no subject)"}
              </Text>
              <Text variant="small-strong">
                {message.fromName || message.fromEmail}
              </Text>

              <CollapsibleRoot open={detailsOpen} onOpenChange={setDetailsOpen}>
                <CollapsibleTrigger className="-ml-1 flex items-center gap-1 rounded-control px-1 py-0.5 hover:bg-control-subtle transition-colors">
                  <CollapsibleChevron />
                  <Text variant="small" color="secondary" truncate>
                    {detailsOpen ? "Hide details" : `to ${message.to}`}
                  </Text>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="flex flex-col gap-0.5 pt-1 pl-1">
                    {message.fromName ? (
                      <Text variant="small" color="secondary">
                        From: {message.fromName} &lt;{message.fromEmail}&gt;
                      </Text>
                    ) : null}
                    <Text variant="small" color="secondary">
                      To: {message.to}
                    </Text>
                    {message.cc ? (
                      <Text variant="small" color="secondary">
                        Cc: {message.cc}
                      </Text>
                    ) : null}
                  </div>
                </CollapsibleContent>
              </CollapsibleRoot>

              <Text variant="mini" color="tertiary">
                {formatFullDate(message.date)}
              </Text>
              {messageLabels.length > 0 ? (
                <div className="flex items-center gap-1.5 flex-wrap pt-1">
                  {messageLabels.map((label) => (
                    <LabelChip key={label.id} label={label} />
                  ))}
                </div>
              ) : null}
            </div>

            {/* Body */}
            <div className="flex-1">
              <MessageBody bodyHtml={message.bodyHtml} bodyText={message.bodyText} />
            </div>

            <AttachmentList
              messageId={messageId}
              attachments={message.attachments}
              onDownload={handleDownloadAttachment}
            />
          </div>
        )}
      </ScrollArea>

      {compose ? (
        <ComposeDialog
          accountId={accountId}
          open
          onOpenChange={(open) => {
            if (!open) setCompose(null);
          }}
          title={compose.title}
          prefill={compose.prefill}
          replyTo={compose.replyTo}
        />
      ) : null}
    </>
  );
}
