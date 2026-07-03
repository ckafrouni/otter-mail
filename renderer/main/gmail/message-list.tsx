import type React from "react";
import { useState } from "react";
import {
  ScrollArea,
  Toolbar,
  ToolbarRow,
  ToolbarTitle,
  ToolbarDescription,
  ToolbarActions,
  ToolbarSearchButton,
  Button,
  ToggleButton,
  EmptyState,
  Text,
} from "@glaze/core/components";
import { ArchiveIcon, CircleDotIcon, StarIcon, StarOffIcon, TagIcon, Trash2Icon } from "lucide-react";
import {
  useMessages,
  useCombinedMessages,
  useCombinedCounts,
  useSearchMessages,
  useDebouncedValue,
  useModifyMessage,
  useModifyThread,
  useTrashThread,
  useLabelResolver,
  useSyncAccountLabels,
} from "./hooks";
import { LabelChip } from "./label-chip";
import { LabelPickerMenu } from "./label-picker-menu";
import { SenderAvatar } from "./sender-avatar";
import { getAccountColor, getAccountDisplayName } from "./account-style";
import { SYSTEM_LABEL_NAMES, labelDisplayName } from "./label-names";
import type { GmailAccount, GmailLabel, GmailMessageSummary, SyncStatus, ViewRule } from "./types";

type ResolveLabel = (accountId: string | undefined, labelId: string) => GmailLabel | undefined;

/** Cross-account query descriptor for the Combined mailbox. */
export type CombinedList = { viewId: string; name: string; rules: ViewRule[] };

/** Mailbox + account identity shown next to the date in Combined view rows.
    mailbox is null when every selection in the view is the same mailbox (e.g.
    built-in Inbox), where naming it on every row would be redundant. */
type CombinedMeta = { mailbox: string | null; accountName: string; accountColor: string };

type MessageListProps = {
  /** Active account — used for account-mode queries and as a fallback owner id. */
  accountId: string;
  labelId: string;
  /** When set, the list is cross-account (Combined mailbox). */
  combined: CombinedList | null;
  /** All connected account ids, for resolving label chips across accounts. */
  accountIds: string[];
  /** Connected accounts (name/color), for the Combined view's mailbox-account line. */
  accounts: GmailAccount[];
  selectedMessageId: string | null;
  onSelectMessage: (messageId: string, accountId: string) => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  syncStatus: SyncStatus | null;
};

function ruleMailboxName(rule: ViewRule, resolveLabel: ResolveLabel): string | null {
  if (rule.allOf.length === 0) return null;
  return rule.allOf
    .map((labelId) => {
      const label = resolveLabel(rule.accountId, labelId);
      return label ? labelDisplayName(label) : (SYSTEM_LABEL_NAMES[labelId] ?? labelId);
    })
    .join(" + ");
}

function resolveCombinedMeta(
  message: GmailMessageSummary,
  combined: CombinedList | null,
  accounts: GmailAccount[],
  resolveLabel: ResolveLabel,
): CombinedMeta | null {
  if (!combined || !message.accountId) return null;
  const account = accounts.find((a) => a.id === message.accountId);
  if (!account) return null;
  const matched = combined.rules.find(
    (r) =>
      r.accountId === message.accountId &&
      r.allOf.every((id) => message.labelIds.includes(id)) &&
      !r.noneOf.some((id) => message.labelIds.includes(id)),
  );
  // Thread representatives may not carry the matched labels themselves (e.g.
  // your own reply in an Inbox view) — still show which account the row is from.
  if (!matched) {
    return {
      mailbox: null,
      accountName: getAccountDisplayName(account),
      accountColor: getAccountColor(account),
    };
  }
  // When the whole view is one mailbox (built-in Inbox/Sent, or the same
  // labels required everywhere), the mailbox prefix is obvious — omit it.
  const mailbox = ruleMailboxName(matched, resolveLabel);
  const uniform = combined.rules.every((r) => ruleMailboxName(r, resolveLabel) === mailbox);
  return {
    mailbox: uniform ? null : mailbox,
    accountName: getAccountDisplayName(account),
    accountColor: getAccountColor(account),
  };
}

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
  /** Mailbox + account line shown next to the date, only in Combined view. */
  combinedMeta: CombinedMeta | null;
};

function MessageRow({
  message,
  selected,
  onSelect,
  accountId,
  resolveLabel,
  combinedMeta,
}: MessageRowProps) {
  const modifyMessage = useModifyMessage();
  const modifyThread = useModifyThread();
  const trashThread = useTrashThread();

  const ownerAccountId = message.accountId ?? accountId;
  const threadId = message.threadId || message.id;
  const threadCount = message.threadCount ?? 1;

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
    console.log("[MessageList:archive]", { threadId });
    void modifyThread.mutateAsync({
      accountId: ownerAccountId,
      threadId,
      removeLabelIds: ["INBOX"],
    });
  };

  const handleTrash = (e: React.MouseEvent) => {
    e.stopPropagation();
    console.log("[MessageList:trash]", { threadId });
    void trashThread.mutateAsync({ accountId: ownerAccountId, threadId });
  };

  const unread = message.threadUnread ?? message.unread;
  // Selected rows sit on a solid accent block (Apple Mail-style); every text/icon
  // color below is force-overridden to white via inline style so it stays legible
  // regardless of the semantic (light/dark) color the row would otherwise use.
  const onAccent = selected ? { color: "#fff" } : undefined;
  const onAccentMuted = selected ? { color: "rgba(255,255,255,0.75)" } : undefined;
  const onAccentFaint = selected ? { color: "rgba(255,255,255,0.65)" } : undefined;

  return (
    <div className="px-2">
      <button
        type="button"
        onClick={onSelect}
        className={[
          "group w-full text-left rounded-lg px-3 py-2.5 my-0.5 flex items-start gap-3",
          selected
            ? "bg-accent"
            : unread
              ? "bg-accent/[0.06] hover:bg-accent/[0.12]"
              : "hover:bg-control-subtle",
        ].join(" ")}
      >
        <span className="mt-0.5">
          <SenderAvatar name={message.fromName} email={message.fromEmail} />
        </span>
        <div className="flex flex-col min-w-0 flex-1 gap-0.5">
          <div className="flex items-center justify-between gap-2">
            <Text
              variant={unread ? "small-strong" : "small"}
              color={selected ? undefined : unread ? "primary" : "secondary"}
              truncate
              className="flex-1 min-w-0"
              style={onAccent}
            >
              {message.fromName || message.fromEmail}
            </Text>
            <div className="flex items-center gap-1 shrink-0">
              {combinedMeta ? (
                <span className="flex items-center gap-1">
                  {combinedMeta.mailbox ? (
                    <Text variant="mini" color={selected ? undefined : "secondary"} style={onAccentMuted}>
                      {combinedMeta.mailbox} -
                    </Text>
                  ) : null}
                  <Text
                    variant="mini"
                    className="font-medium"
                    style={{ color: selected ? "rgba(255,255,255,0.95)" : combinedMeta.accountColor }}
                  >
                    {combinedMeta.accountName}
                  </Text>
                </span>
              ) : null}
              {threadCount > 1 ? (
                <span
                  className={[
                    "shrink-0 rounded-pill px-1.5 text-mini tabular-nums",
                    selected ? "bg-white/20 text-white" : "bg-control text-secondary",
                  ].join(" ")}
                >
                  {threadCount}
                </span>
              ) : null}
              <Text
                variant="mini"
                color={selected ? undefined : "secondary"}
                className="tabular-nums"
                style={onAccentMuted}
              >
                {formatRelativeDate(message.date)}
              </Text>
            </div>
          </div>
          <Text
            variant={unread ? "small-strong" : "small"}
            color={selected ? undefined : unread ? "primary" : "secondary"}
            truncate
            style={onAccent}
          >
            {message.subject || "(no subject)"}
          </Text>
          <Text variant="mini" color={selected ? undefined : "tertiary"} truncate style={onAccentFaint}>
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

        {message.starred ? (
          <button
            type="button"
            onClick={handleStarToggle}
            className={[
              "shrink-0 mt-0.5 transition-colors",
              selected ? "text-white" : "text-tertiary hover:text-accent",
            ].join(" ")}
            aria-label="Unstar"
          >
            <StarIcon className={["size-4 fill-current", selected ? "text-white" : "text-accent"].join(" ")} />
          </button>
        ) : (
          /* Hover-revealed quick actions */
          <div className="shrink-0 mt-0.5 flex items-center gap-1 max-w-0 opacity-0 overflow-hidden group-hover:max-w-[100px] group-hover:opacity-100 transition-all duration-150">
            <button
              type="button"
              onClick={handleStarToggle}
              className={[
                "transition-colors",
                selected ? "text-white/90 hover:text-white" : "text-tertiary hover:text-accent",
              ].join(" ")}
              aria-label="Star"
            >
              <StarOffIcon className="size-4" />
            </button>
            <LabelPickerMenu
              accountId={ownerAccountId}
              messageId={message.id}
              labelIds={message.labelIds}
            >
              <button
                type="button"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
                className={[
                  "transition-colors",
                  selected ? "text-white/90 hover:text-white" : "text-tertiary hover:text-primary",
                ].join(" ")}
                aria-label="Labels"
              >
                <TagIcon className="size-4" />
              </button>
            </LabelPickerMenu>
            <button
              type="button"
              onClick={handleArchive}
              className={[
                "transition-colors",
                selected ? "text-white/90 hover:text-white" : "text-tertiary hover:text-primary",
              ].join(" ")}
              aria-label="Archive"
            >
              <ArchiveIcon className="size-4" />
            </button>
            <button
              type="button"
              onClick={handleTrash}
              className={[
                "transition-colors",
                selected ? "text-white/90 hover:text-white" : "text-tertiary hover:text-support-red",
              ].join(" ")}
              aria-label="Move to trash"
            >
              <Trash2Icon className="size-4" />
            </button>
          </div>
        )}
      </button>
    </div>
  );
}

/** "260 messages, 7 unread" — omits the unread clause when nothing is unread. */
function formatMailboxSummary(total: number, unread: number): string {
  const messages = `${total.toLocaleString()} message${total === 1 ? "" : "s"}`;
  return unread > 0 ? `${messages}, ${unread.toLocaleString()} unread` : messages;
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
  accounts,
  selectedMessageId,
  onSelectMessage,
  searchQuery,
  onSearchChange,
  syncStatus,
}: MessageListProps) {
  const isCombined = combined != null;
  const [unreadOnly, setUnreadOnly] = useState(false);

  // Search is local (FTS5 over the mail cache): account-scoped in account mode,
  // across every account in Combined mode. Results are message-level rows.
  const debouncedQuery = useDebouncedValue(searchQuery.trim(), 150);
  const searching = debouncedQuery.length > 0;

  // All hooks are always called (rules of hooks); the inactive ones are disabled.
  const accountMessages = useMessages(isCombined || searching ? null : accountId, labelId);
  const combinedMessages = useCombinedMessages(
    combined?.rules ?? [],
    combined?.viewId ?? "",
    isCombined && !searching,
  );
  const searchResults = useSearchMessages(debouncedQuery, isCombined ? null : accountId, searching);
  const messagesQuery = searching ? searchResults : isCombined ? combinedMessages : accountMessages;

  const resolveLabel = useLabelResolver(isCombined ? accountIds : [accountId]);
  // Combined mode has no single "active account" to drive per-account label
  // sync (see useAccountSync), so the header's counts need their own refresh loop.
  useSyncAccountLabels(accountIds, isCombined);

  // Header title + "N messages, M unread". Combined counts come from the local
  // store (rules can't be summed from Gmail's per-label counters); account mode
  // still uses Gmail's own label counters.
  const combinedCounts = useCombinedCounts(combined?.rules ?? [], combined?.viewId ?? "", isCombined);
  const activeLabel = resolveLabel(accountId, labelId);
  const mailboxTitle = isCombined
    ? combined.name
    : (activeLabel ? labelDisplayName(activeLabel) : (SYSTEM_LABEL_NAMES[labelId] ?? labelId));
  const { mailboxTotal, mailboxUnread } = isCombined
    ? {
        mailboxTotal: combinedCounts.data?.total ?? 0,
        mailboxUnread: combinedCounts.data?.unread ?? 0,
      }
    : { mailboxTotal: activeLabel?.total ?? 0, mailboxUnread: activeLabel?.unread ?? 0 };

  const allMessages: GmailMessageSummary[] =
    messagesQuery.data?.pages.flatMap((p) => p.messages) ?? [];
  const visibleMessages = unreadOnly
    ? allMessages.filter((m) => m.threadUnread ?? m.unread)
    : allMessages;
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
            <div>
              <ToolbarTitle>{mailboxTitle}</ToolbarTitle>
              <ToolbarDescription>{formatMailboxSummary(mailboxTotal, mailboxUnread)}</ToolbarDescription>
            </div>
            <ToolbarActions>
              <ToggleButton
                iconOnly
                size="small"
                pressed={unreadOnly}
                onPressedChange={setUnreadOnly}
                aria-label={unreadOnly ? "Show all messages" : "Show unread only"}
              >
                <CircleDotIcon className="size-4.5" />
              </ToggleButton>
            </ToolbarActions>
          </ToolbarRow>
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
            <div key={i} className="w-full px-3 py-2.5 flex items-start gap-3">
              <div className="flex flex-col min-w-0 flex-1 gap-1.5">
                <div className="h-3.5 w-32 rounded-pill bg-control animate-pulse" />
                <div className="h-3 w-48 rounded-pill bg-control animate-pulse" />
                <div className="h-3 w-40 rounded-pill bg-control animate-pulse" />
              </div>
            </div>
          ))}
        </div>
      ) : visibleMessages.length === 0 ? (
        <EmptyState
          title={unreadOnly ? "No unread messages" : "No messages"}
          description={
            unreadOnly
              ? "Everything here has been read."
              : searchQuery
                ? "No messages match your search."
                : "This label is empty."
          }
        />
      ) : (
        <>
          {visibleMessages.map((message, i) => {
            const isSelected = selectedMessageId === message.id;
            const next = visibleMessages[i + 1];
            const nextSelected = next ? selectedMessageId === next.id : false;
            const showDivider = i < visibleMessages.length - 1 && !isSelected && !nextSelected;
            return (
              <div key={`${message.accountId ?? accountId}:${message.id}`}>
                <MessageRow
                  message={message}
                  selected={isSelected}
                  onSelect={() => {
                    console.log("[MessageList:selectMessage]", {
                      messageId: message.id,
                    });
                    onSelectMessage(message.id, message.accountId ?? accountId);
                  }}
                  accountId={accountId}
                  resolveLabel={resolveLabel}
                  combinedMeta={resolveCombinedMeta(message, combined, accounts, resolveLabel)}
                />
                {showDivider ? <div className="h-px bg-separator ml-[64px] mr-5" /> : null}
              </div>
            );
          })}
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
