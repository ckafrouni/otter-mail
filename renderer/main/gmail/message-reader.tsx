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
  DownloadIcon,
} from "lucide-react";
import {
  useMessage,
  useModifyMessage,
  useTrashMessage,
  useGetAttachment,
  useLabels,
} from "./hooks";
import { ComposeDialog } from "./compose-dialog";
import { LabelChip } from "./label-chip";
import type { GmailLabel } from "./types";

type MessageReaderProps = {
  accountId: string;
  messageId: string | null;
};

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

export function MessageReader({ accountId, messageId }: MessageReaderProps) {
  const messageQuery = useMessage(accountId, messageId);
  const labelsQuery = useLabels(accountId);
  const modifyMessage = useModifyMessage();
  const trashMessage = useTrashMessage();
  const getAttachment = useGetAttachment();

  const [composeOpen, setComposeOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [replyPrefill, setReplyPrefill] = useState<{
    to: string;
    subject: string;
    body: string;
  } | null>(null);

  const hasAutoMarked = useRef<string | null>(null);

  const message = messageQuery.data;

  useEffect(() => {
    setDetailsOpen(false);
  }, [messageId]);

  // Auto-mark as read when message opens
  useEffect(() => {
    if (!message || !messageId) return;
    if (hasAutoMarked.current === messageId) return;
    if (!message.unread) return;

    hasAutoMarked.current = messageId;
    console.log("[MessageReader:autoMarkRead]", { messageId });
    void modifyMessage.mutateAsync({
      accountId,
      messageId,
      removeLabelIds: ["UNREAD"],
    });
  }, [message, messageId, accountId, modifyMessage]);

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

  if (messageQuery.isLoading) {
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

  const isUnread = message.unread;

  const labelsById = new Map((labelsQuery.data ?? []).map((l) => [l.id, l]));
  const messageLabels = message.labelIds
    .map((id) => labelsById.get(id))
    .filter((l): l is GmailLabel => l != null && l.type === "user");

  const handleToggleRead = () => {
    console.log("[MessageReader:toggleRead]", { messageId, isUnread });
    void modifyMessage.mutateAsync({
      accountId,
      messageId,
      addLabelIds: isUnread ? undefined : ["UNREAD"],
      removeLabelIds: isUnread ? ["UNREAD"] : undefined,
    });
  };

  const handleArchive = () => {
    console.log("[MessageReader:archive]", { messageId });
    void modifyMessage.mutateAsync({
      accountId,
      messageId,
      removeLabelIds: ["INBOX"],
    });
  };

  const handleTrash = () => {
    console.log("[MessageReader:trash]", { messageId });
    void trashMessage.mutateAsync({ accountId, messageId });
  };

  const handleReply = () => {
    console.log("[MessageReader:reply]", { messageId });
    setReplyPrefill({
      to: message.fromEmail,
      subject: message.subject.startsWith("Re:")
        ? message.subject
        : `Re: ${message.subject}`,
      body: `\n\n---\nOn ${formatFullDate(message.date)}, ${message.fromName || message.fromEmail} wrote:\n${message.bodyText ?? ""}`,
    });
    setComposeOpen(true);
  };

  const handleDownloadAttachment = async (
    attachmentId: string,
    filename: string,
    mimeType: string,
  ) => {
    console.log("[MessageReader:downloadAttachment]", {
      messageId,
      filename,
    });
    try {
      const result = await getAttachment.mutateAsync({
        accountId,
        messageId,
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
  };

  return (
    <>
      <ScrollArea
        className="h-full"
        toolbar={
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
                aria-label="Archive"
              >
                <ArchiveIcon className="size-4.5" />
              </Button>
              <Button
                variant="glass"
                size="large"
                iconOnly
                onClick={handleTrash}
                aria-label="Trash"
              >
                <Trash2Icon className="size-4.5" />
              </Button>
            </ToolbarActions>
          </Toolbar>
        }
      >
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
            {message.bodyHtml ? (
              <iframe
                sandbox="allow-same-origin"
                srcDoc={message.bodyHtml}
                className="w-full border-none rounded-card"
                title="Message body"
                onLoad={(e) => {
                  const iframe = e.currentTarget;
                  const doc =
                    iframe.contentDocument || iframe.contentWindow?.document;
                  if (doc) {
                    iframe.style.height =
                      doc.documentElement.scrollHeight + "px";
                  }
                }}
              />
            ) : message.bodyText ? (
              <pre className="whitespace-pre-wrap font-sans text-regular text-primary leading-relaxed">
                {message.bodyText}
              </pre>
            ) : (
              <Text variant="small" color="tertiary">
                (No message body)
              </Text>
            )}
          </div>

          {/* Attachments */}
          {message.attachments.length > 0 ? (
            <div className="flex flex-col gap-2 border-t border-separator pt-4">
              <Text variant="small-strong">
                Attachments ({message.attachments.length})
              </Text>
              <div className="flex flex-col gap-1">
                {message.attachments.map((att) => (
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
                      onClick={() =>
                        void handleDownloadAttachment(
                          att.id,
                          att.filename,
                          att.mimeType,
                        )
                      }
                      aria-label={`Download ${att.filename}`}
                    >
                      <DownloadIcon className="size-4" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </ScrollArea>

      {composeOpen && replyPrefill ? (
        <ComposeDialog
          accountId={accountId}
          open={composeOpen}
          onOpenChange={setComposeOpen}
          prefill={replyPrefill}
        />
      ) : null}
    </>
  );
}
