import type React from "react";
import {
  ScrollArea,
  Toolbar,
  ToolbarRow,
  ToolbarSearchButton,
  Button,
  EmptyState,
  Text,
} from "@glaze/core/components";
import { ArchiveIcon, StarIcon, StarOffIcon, Trash2Icon } from "lucide-react";
import {
  useMessages,
  useCombinedMessages,
  useModifyMessage,
  useTrashMessage,
  useLabelResolver,
  type CombinedQuery,
} from "./hooks";
import { LabelChip } from "./label-chip";
import type { GmailLabel, GmailMessageSummary, SyncStatus } from "./types";

type ResolveLabel = (accountId: string | undefined, labelId: string) => GmailLabel | undefined;

type MessageListProps = {
  /** Active account — used for account-mode queries and as a fallback owner id. */
  accountId: string;
  labelId: string;
  /** When set, the list is cross-account (Combined mailbox). */
  combined: CombinedQuery | null;
  /** All connected account ids, for resolving label chips across accounts. */
  accountIds: string[];
  selectedMessageId: string | null;
  onSelectMessage: (messageId: string, accountId: string) => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  syncStatus: SyncStatus | null;
};

function formatRelativeDate(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } else if (diffDays === 1) {
    return "Yesterday";
  } else if (diffDays < 7) {
    return date.toLocaleDateString([], { weekday: "short" });
  } else {
    return date.toLocaleDateString([], { month: "short", day: "numeric" });
  }
}

type MessageRowProps = {
  message: GmailMessageSummary;
  selected: boolean;
  onSelect: () => void;
  /** Fallback owner id when a summary has no accountId (e.g. live search results). */
  accountId: string;
  resolveLabel: ResolveLabel;
};

function MessageRow({
  message,
  selected,
  onSelect,
  accountId,
  resolveLabel,
}: MessageRowProps) {
  const modifyMessage = useModifyMessage();
  const trashMessage = useTrashMessage();

  const ownerAccountId = message.accountId ?? accountId;

  const messageLabels = message.labelIds
    .map((id) => resolveLabel(ownerAccountId, id))
    .filter((l): l is GmailLabel => l != null && l.type === "user");

  const handleStarToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    console.log("[MessageList:starToggle]", {
      messageId: message.id,
      starred: message.starred,
    });
    if (message.starred) {
      void modifyMessage.mutateAsync({
        accountId: ownerAccountId,
        messageId: message.id,
        removeLabelIds: ["STARRED"],
      });
    } else {
      void modifyMessage.mutateAsync({
        accountId: ownerAccountId,
        messageId: message.id,
        addLabelIds: ["STARRED"],
      });
    }
  };

  const handleArchive = (e: React.MouseEvent) => {
    e.stopPropagation();
    console.log("[MessageList:archive]", { messageId: message.id });
    void modifyMessage.mutateAsync({
      accountId: ownerAccountId,
      messageId: message.id,
      removeLabelIds: ["INBOX"],
    });
  };

  const handleTrash = (e: React.MouseEvent) => {
    e.stopPropagation();
    console.log("[MessageList:trash]", { messageId: message.id });
    void trashMessage.mutateAsync({ accountId: ownerAccountId, messageId: message.id });
  };

  return (
    <button
      type="button"
      onClick={onSelect}
      className={[
        "group w-full text-left px-3 py-2.5 flex items-start gap-3 border-b border-separator",
        "hover:bg-control-subtle transition-colors",
        selected ? "bg-control" : "",
      ].join(" ")}
    >
      {/* Unread dot */}
      <div className="shrink-0 mt-1.5 size-2 flex items-center justify-center">
        {message.unread ? (
          <span className="size-2 rounded-full bg-accent" />
        ) : null}
      </div>

      <div className="flex flex-col min-w-0 flex-1 gap-0.5">
        <div className="flex items-center justify-between gap-2">
          <Text
            variant={message.unread ? "small-strong" : "small"}
            truncate
            className="flex-1 min-w-0"
          >
            {message.fromName || message.fromEmail}
          </Text>
          <Text
            variant="mini"
            color="secondary"
            className="shrink-0 tabular-nums"
          >
            {formatRelativeDate(message.date)}
          </Text>
        </div>
        <Text
          variant={message.unread ? "small-strong" : "small"}
          color={message.unread ? "primary" : "secondary"}
          truncate
        >
          {message.subject || "(no subject)"}
        </Text>
        <Text variant="mini" color="tertiary" truncate>
          {message.snippet}
        </Text>
        {messageLabels.length > 0 ? (
          <div className="flex items-center gap-1 flex-wrap pt-0.5">
            {messageLabels.map((label) => (
              <LabelChip key={label.id} label={label} />
            ))}
          </div>
        ) : null}
      </div>

      {/* Hover-revealed quick actions */}
      <div className="shrink-0 mt-0.5 flex items-center gap-1 max-w-0 opacity-0 overflow-hidden group-hover:max-w-[52px] group-hover:opacity-100 transition-all duration-150">
        <button
          type="button"
          onClick={handleArchive}
          className="text-tertiary hover:text-primary transition-colors"
          aria-label="Archive"
        >
          <ArchiveIcon className="size-4" />
        </button>
        <button
          type="button"
          onClick={handleTrash}
          className="text-tertiary hover:text-support-red transition-colors"
          aria-label="Move to trash"
        >
          <Trash2Icon className="size-4" />
        </button>
      </div>

      {/* Star toggle */}
      <button
        type="button"
        onClick={handleStarToggle}
        className={[
          "shrink-0 mt-0.5 text-tertiary hover:text-accent transition-colors",
          message.starred ? "" : "opacity-0 group-hover:opacity-100",
        ].join(" ")}
        aria-label={message.starred ? "Unstar" : "Star"}
      >
        {message.starred ? (
          <StarIcon className="size-4 fill-current text-accent" />
        ) : (
          <StarOffIcon className="size-4" />
        )}
      </button>
    </button>
  );
}

function syncLabel(status: SyncStatus): string {
  if (status.phase === "full" && status.total) {
    return `Syncing ${status.synced.toLocaleString()} of ~${status.total.toLocaleString()}`;
  }
  if (status.phase === "bodies" && status.total) {
    return `Downloading messages ${status.synced.toLocaleString()} of ${status.total.toLocaleString()}`;
  }
  if (status.phase === "incremental") return "Checking for new mail…";
  return "Syncing…";
}

export function MessageList({
  accountId,
  labelId,
  combined,
  accountIds,
  selectedMessageId,
  onSelectMessage,
  searchQuery,
  onSearchChange,
  syncStatus,
}: MessageListProps) {
  const isCombined = combined != null;

  // Both hooks are always called (rules of hooks); the inactive one is disabled.
  const accountMessages = useMessages(isCombined ? null : accountId, labelId, searchQuery);
  const combinedMessages = useCombinedMessages(combined ?? { kind: "inbox" }, isCombined);
  const messagesQuery = isCombined ? combinedMessages : accountMessages;

  const resolveLabel = useLabelResolver(isCombined ? accountIds : [accountId]);

  const allMessages: GmailMessageSummary[] =
    messagesQuery.data?.pages.flatMap((p) => p.messages) ?? [];
  const hasNextPage = messagesQuery.hasNextPage;
  const isFetchingNextPage = messagesQuery.isFetchingNextPage;

  const handleLoadMore = () => {
    console.log("[MessageList:loadMore]");
    void messagesQuery.fetchNextPage();
  };

  const isLoading = messagesQuery.isLoading;

  return (
    <ScrollArea
      toolbar={
        <Toolbar>
          {!isCombined ? (
            <ToolbarRow>
              <ToolbarSearchButton
                value={searchQuery}
                onChange={(v) => {
                  console.log("[MessageList:searchChange]", { q: v });
                  onSearchChange(v);
                }}
                size="large"
              />
            </ToolbarRow>
          ) : null}
          {syncStatus?.syncing ? (
            <ToolbarRow>
              <div className="flex items-center gap-1.5 px-1 py-0.5">
                <span className="size-3 rounded-full border-2 border-accent border-t-transparent animate-spin" />
                <Text variant="mini" color="tertiary">
                  {syncLabel(syncStatus)}
                </Text>
              </div>
            </ToolbarRow>
          ) : null}
        </Toolbar>
      }
      className="h-full"
    >
      {isLoading ? (
        <div className="flex flex-col gap-0">
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="w-full px-3 py-2.5 flex items-start gap-3 border-b border-separator"
            >
              <div className="shrink-0 mt-1.5 size-2" />
              <div className="flex flex-col min-w-0 flex-1 gap-1.5">
                <div className="h-3.5 w-32 rounded-pill bg-control animate-pulse" />
                <div className="h-3 w-48 rounded-pill bg-control animate-pulse" />
                <div className="h-3 w-40 rounded-pill bg-control animate-pulse" />
              </div>
            </div>
          ))}
        </div>
      ) : allMessages.length === 0 ? (
        <EmptyState
          title="No messages"
          description={
            searchQuery
              ? "No messages match your search."
              : "This label is empty."
          }
        />
      ) : (
        <>
          {allMessages.map((message) => (
            <MessageRow
              key={`${message.accountId ?? accountId}:${message.id}`}
              message={message}
              selected={selectedMessageId === message.id}
              onSelect={() => {
                console.log("[MessageList:selectMessage]", {
                  messageId: message.id,
                });
                onSelectMessage(message.id, message.accountId ?? accountId);
              }}
              accountId={accountId}
              resolveLabel={resolveLabel}
            />
          ))}
          {hasNextPage ? (
            <div className="flex justify-center py-3">
              <Button
                variant="filled"
                size="small"
                onClick={handleLoadMore}
                disabled={isFetchingNextPage}
              >
                {isFetchingNextPage ? "Loading..." : "Load more"}
              </Button>
            </div>
          ) : null}
        </>
      )}
    </ScrollArea>
  );
}
