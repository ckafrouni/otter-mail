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
import { StarIcon, StarOffIcon } from "lucide-react";
import { useMessages, useModifyMessage, useLabels } from "./hooks";
import { LabelChip } from "./label-chip";
import type { GmailLabel, GmailMessageSummary } from "./types";

type MessageListProps = {
  accountId: string;
  labelId: string;
  selectedMessageId: string | null;
  onSelectMessage: (messageId: string) => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
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
  accountId: string;
  labelsById: Map<string, GmailLabel>;
};

function MessageRow({
  message,
  selected,
  onSelect,
  accountId,
  labelsById,
}: MessageRowProps) {
  const modifyMessage = useModifyMessage();

  const messageLabels = message.labelIds
    .map((id) => labelsById.get(id))
    .filter((l): l is GmailLabel => l != null && l.type === "user");

  const handleStarToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    console.log("[MessageList:starToggle]", {
      messageId: message.id,
      starred: message.starred,
    });
    if (message.starred) {
      void modifyMessage.mutateAsync({
        accountId,
        messageId: message.id,
        removeLabelIds: ["STARRED"],
      });
    } else {
      void modifyMessage.mutateAsync({
        accountId,
        messageId: message.id,
        addLabelIds: ["STARRED"],
      });
    }
  };

  return (
    <button
      type="button"
      onClick={onSelect}
      className={[
        "w-full text-left px-3 py-2.5 flex items-start gap-3 border-b border-separator",
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

      {/* Star toggle */}
      <button
        type="button"
        onClick={handleStarToggle}
        className="shrink-0 mt-0.5 text-tertiary hover:text-accent transition-colors"
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

export function MessageList({
  accountId,
  labelId,
  selectedMessageId,
  onSelectMessage,
  searchQuery,
  onSearchChange,
}: MessageListProps) {
  const messagesQuery = useMessages(accountId, labelId, searchQuery);
  const labelsQuery = useLabels(accountId);
  const labelsById = new Map(
    (labelsQuery.data ?? []).map((l) => [l.id, l]),
  );

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
              key={message.id}
              message={message}
              selected={selectedMessageId === message.id}
              onSelect={() => {
                console.log("[MessageList:selectMessage]", {
                  messageId: message.id,
                });
                onSelectMessage(message.id);
              }}
              accountId={accountId}
              labelsById={labelsById}
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
