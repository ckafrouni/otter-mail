import type React from "react";
import { useEffect, useRef, useState } from "react";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuCheckboxItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ScrollArea,
  Toolbar,
  ToolbarRow,
  ToolbarTitle,
  ToolbarDescription,
  ToolbarActions,
  Button,
  ToggleButton,
  EmptyState,
  Text,
} from "@glaze/core/components";
import { FlagIcon, ListFilterIcon } from "lucide-react";
import {
  useMessages,
  useCombinedMessages,
  useCombinedCounts,
  useSearchMessages,
  useDebouncedValue,
  useLabels,
  useModifyMessage,
  useModifyThread,
  useTrashThread,
  useLabelResolver,
  useSyncAccountLabels,
} from "./hooks";
import { LabelChip } from "./label-chip";
import { LabelOverlay, type LabelOverlayMode } from "./label-overlay";
import { renderLabelMenuNodes } from "./label-picker-menu";
import {
  INBOX_VIEW_ID,
  STARRED_VIEW_ID,
  SENT_VIEW_ID,
  DRAFTS_VIEW_ID,
} from "./custom-views";
import { buildLabelTree } from "./label-tree";
import { isTypingTarget } from "./keyboard";
import { getAccountColor, getAccountDisplayName } from "./account-style";
import { SYSTEM_LABEL_NAMES, labelDisplayName } from "./label-names";
import type { GmailAccount, GmailLabel, GmailMessageSummary, ViewRule } from "./types";

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
  /** Clears the selection (mark-unread returns to the list, Gmail-style). */
  onDeselect: () => void;

  searchQuery: string;
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
  // Account-scoped view slices read like plain label browsing — naming the
  // (only) account on every row would be noise.
  if (
    combined.rules.length > 0 &&
    combined.rules.every((r) => r.accountId === combined.rules[0].accountId)
  ) {
    return null;
  }
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

  const ownerLabels = useLabels(ownerAccountId);
  const labelTree = buildLabelTree((ownerLabels.data ?? []).filter((l) => l.type === "user"));
  const appliedLabels = new Set(message.labelIds);

  const handleLabelToggle = (labelId: string, checked: boolean) => {
    console.log("[MessageList:labelToggle]", { messageId: message.id, labelId, checked });
    void modifyMessage.mutateAsync({
      accountId: ownerAccountId,
      messageId: message.id,
      addLabelIds: checked ? [labelId] : undefined,
      removeLabelIds: checked ? undefined : [labelId],
    });
  };

  const handleToggleRead = () => {
    const isUnread = message.threadUnread ?? message.unread;
    console.log("[MessageList:toggleRead]", { threadId, isUnread });
    if (isUnread) {
      void modifyThread.mutateAsync({
        accountId: ownerAccountId,
        threadId,
        removeLabelIds: ["UNREAD"],
      });
    } else {
      void modifyMessage.mutateAsync({
        accountId: ownerAccountId,
        messageId: message.id,
        addLabelIds: ["UNREAD"],
      });
    }
  };

  const handleJunk = () => {
    console.log("[MessageList:junk]", { threadId });
    void modifyThread.mutateAsync({
      accountId: ownerAccountId,
      threadId,
      addLabelIds: ["SPAM"],
      removeLabelIds: ["INBOX"],
    });
  };

  const handleStarToggle = (e?: React.MouseEvent) => {
    e?.stopPropagation();
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

  const handleArchive = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    console.log("[MessageList:archive]", { threadId });
    void modifyThread.mutateAsync({
      accountId: ownerAccountId,
      threadId,
      removeLabelIds: ["INBOX"],
    });
  };

  const handleTrash = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    console.log("[MessageList:trash]", { threadId });
    void trashThread.mutateAsync({ accountId: ownerAccountId, threadId });
  };

  // Keyboard selection (j/k) can land on a row outside the viewport — keep the
  // selected row visible. "nearest" makes this a no-op for click selection;
  // "instant" keeps held-down j/k from queueing smooth-scroll animations that
  // continue after the key is released.
  const rowRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (selected) rowRef.current?.scrollIntoView({ block: "nearest", behavior: "instant" });
  }, [selected]);

  const unread = message.threadUnread ?? message.unread;
  // Selected rows sit on a solid accent block (Apple Mail-style); every text/icon
  // color below is force-overridden to white via inline style so it stays legible
  // regardless of the semantic (light/dark) color the row would otherwise use.
  const onAccent = selected ? { color: "#fff" } : undefined;
  const onAccentMuted = selected ? { color: "rgba(255,255,255,0.75)" } : undefined;
  const onAccentFaint = selected ? { color: "rgba(255,255,255,0.65)" } : undefined;

  return (
    <div className="px-2">
      <ContextMenu>
        <ContextMenuTrigger asChild>
      <button
        ref={rowRef}
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
            {message.snippet || " "}
          </Text>
          {/* Fixed-height single-line chip strip so every row measures the same. */}
          <div className="flex items-center gap-1 h-5 mt-0.5 overflow-hidden">
            {messageLabels.map((label) => (
              <LabelChip key={label.id} label={label} />
            ))}
          </div>
        </div>

        {message.starred ? (
          <button
            type="button"
            onClick={handleStarToggle}
            className={[
              "shrink-0 mt-0.5 transition-colors",
              selected ? "text-white" : "text-tertiary hover:text-support-red",
            ].join(" ")}
            aria-label="Unflag"
          >
            <FlagIcon className={["size-4 fill-current", selected ? "text-white" : "text-support-red"].join(" ")} />
          </button>
        ) : null}
      </button>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem
            icon={unread ? "envelope.open" : "envelope.badge"}
            onSelect={handleToggleRead}
          >
            {unread ? "Mark as Read" : "Mark as Unread"}
          </ContextMenuItem>
          <ContextMenuItem
            icon={message.starred ? "flag.slash" : "flag"}
            onSelect={() => handleStarToggle()}
          >
            {message.starred ? "Unflag" : "Flag"}
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuSub label="Move to Label">
            {labelTree.length === 0 ? (
              <ContextMenuItem disabled>No labels</ContextMenuItem>
            ) : (
              renderLabelMenuNodes(labelTree, appliedLabels, handleLabelToggle, {
                CheckboxItem: ContextMenuCheckboxItem,
                Sub: ContextMenuSub,
                Separator: ContextMenuSeparator,
              })
            )}
          </ContextMenuSub>
          <ContextMenuSeparator />
          <ContextMenuItem icon="archivebox" onSelect={() => handleArchive()}>
            Archive
          </ContextMenuItem>
          <ContextMenuItem icon="xmark.bin" onSelect={handleJunk}>
            Move to Junk
          </ContextMenuItem>
          <ContextMenuItem icon="trash" color="red" onSelect={() => handleTrash()}>
            Move to Trash
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    </div>
  );
}

/** "260 messages, 7 unread" — omits the unread clause when nothing is unread. */
function formatMailboxSummary(total: number, unread: number): string {
  const messages = `${total.toLocaleString()} message${total === 1 ? "" : "s"}`;
  return unread > 0 ? `${messages} · ${unread.toLocaleString()} unread` : messages;
}

export function MessageList({
  accountId,
  labelId,
  combined,
  accountIds,
  accounts,
  selectedMessageId,
  onSelectMessage,
  onDeselect,
  searchQuery,
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

  // Gmail-style list shortcuts: j/k move the selection, e/#/! archive/trash/
  // junk the selected thread (advancing to the next row), s toggles the flag,
  // Shift+U/Shift+I set unread/read. Latest state is read through a ref so the
  // window listener mounts once.
  const listModifyMessage = useModifyMessage();
  const listModifyThread = useModifyThread();
  const listTrashThread = useTrashThread();

  const selectedRow = visibleMessages.find((m) => m.id === selectedMessageId) ?? null;
  const selectedOwner = selectedRow ? (selectedRow.accountId ?? accountId) : null;

  // The single label the current view IS (Gmail's v "move" needs a label to
  // leave). Built-in combined views map to their system label; rule-based
  // custom views and search results have no single label, so v is unavailable.
  const COMBINED_VIEW_LABELS: Record<string, string> = {
    [INBOX_VIEW_ID]: "INBOX",
    [STARRED_VIEW_ID]: "STARRED",
    [SENT_VIEW_ID]: "SENT",
    [DRAFTS_VIEW_ID]: "DRAFT",
  };
  const moveContextLabelId = searching
    ? null
    : isCombined
      ? (COMBINED_VIEW_LABELS[combined.viewId] ?? null)
      : labelId;

  const [labelOverlay, setLabelOverlay] = useState<LabelOverlayMode | null>(null);

  const advanceFrom = (rowId: string) => {
    const idx = visibleMessages.findIndex((m) => m.id === rowId);
    const next = visibleMessages[idx + 1] ?? visibleMessages[idx - 1];
    if (next) onSelectMessage(next.id, next.accountId ?? accountId);
  };

  const handleOverlayPick = (pickedId: string, wasApplied: boolean) => {
    const row = selectedRow;
    if (!row || !labelOverlay) return;
    const owner = row.accountId ?? accountId;
    const rowThreadId = row.threadId || row.id;
    if (labelOverlay === "label") {
      console.log("[MessageList:labelAs]", { rowThreadId, pickedId, wasApplied });
      void listModifyThread.mutateAsync({
        accountId: owner,
        threadId: rowThreadId,
        addLabelIds: wasApplied ? undefined : [pickedId],
        removeLabelIds: wasApplied ? [pickedId] : undefined,
      });
      return;
    }
    // Move: apply the picked label and leave the current one. SENT/DRAFT are
    // immutable in Gmail, so moving out of those views only applies the label.
    const removable =
      moveContextLabelId &&
      moveContextLabelId !== pickedId &&
      moveContextLabelId !== "SENT" &&
      moveContextLabelId !== "DRAFT";
    console.log("[MessageList:moveTo]", { rowThreadId, pickedId, from: moveContextLabelId });
    if (removable) advanceFrom(row.id);
    void listModifyThread.mutateAsync({
      accountId: owner,
      threadId: rowThreadId,
      addLabelIds: pickedId === moveContextLabelId ? undefined : [pickedId],
      removeLabelIds: removable ? [moveContextLabelId] : undefined,
    });
  };

  const shortcutState = useRef({ visibleMessages, selectedMessageId, accountId, moveContextLabelId });
  shortcutState.current = { visibleMessages, selectedMessageId, accountId, moveContextLabelId };
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e)) return;
      // Held-down key repeats can outpace rendering and pile up in the event
      // queue, replaying moves long after the key is released — drop repeats
      // that have been waiting more than a beat.
      if (e.repeat && performance.now() - e.timeStamp > 80) return;
      const { visibleMessages: rows, selectedMessageId: selId, accountId: fallbackAccount } =
        shortcutState.current;
      if (rows.length === 0) return;
      const idx = rows.findIndex((m) => m.id === selId);
      const selectedRow = idx >= 0 ? rows[idx] : undefined;
      const select = (m: GmailMessageSummary) => onSelectMessage(m.id, m.accountId ?? fallbackAccount);
      const advance = () => {
        const next = rows[idx + 1] ?? rows[idx - 1];
        if (next) select(next);
      };
      const owner = selectedRow ? (selectedRow.accountId ?? fallbackAccount) : "";
      const selThreadId = selectedRow ? selectedRow.threadId || selectedRow.id : "";

      switch (e.key) {
        case "j": {
          const next = idx === -1 ? rows[0] : rows[idx + 1];
          if (next) {
            e.preventDefault();
            select(next);
          }
          break;
        }
        case "k": {
          const prev = idx > 0 ? rows[idx - 1] : undefined;
          if (prev) {
            e.preventDefault();
            select(prev);
          }
          break;
        }
        case "e": {
          if (!selectedRow) return;
          e.preventDefault();
          advance();
          void listModifyThread.mutateAsync({
            accountId: owner,
            threadId: selThreadId,
            removeLabelIds: ["INBOX"],
          });
          break;
        }
        case "#": {
          if (!selectedRow) return;
          e.preventDefault();
          advance();
          void listTrashThread.mutateAsync({ accountId: owner, threadId: selThreadId });
          break;
        }
        case "!": {
          if (!selectedRow) return;
          e.preventDefault();
          advance();
          void listModifyThread.mutateAsync({
            accountId: owner,
            threadId: selThreadId,
            addLabelIds: ["SPAM"],
            removeLabelIds: ["INBOX"],
          });
          break;
        }
        case "s": {
          if (!selectedRow) return;
          e.preventDefault();
          void listModifyMessage.mutateAsync({
            accountId: owner,
            messageId: selectedRow.id,
            addLabelIds: selectedRow.starred ? undefined : ["STARRED"],
            removeLabelIds: selectedRow.starred ? ["STARRED"] : undefined,
          });
          break;
        }
        case "U": {
          if (!selectedRow) return;
          e.preventDefault();
          void listModifyMessage.mutateAsync({
            accountId: owner,
            messageId: selectedRow.id,
            addLabelIds: ["UNREAD"],
          });
          // Gmail returns to the list on mark-unread; also keeps the open
          // reader from immediately re-marking it read.
          onDeselect();
          break;
        }
        case "I": {
          if (!selectedRow) return;
          e.preventDefault();
          void listModifyThread.mutateAsync({
            accountId: owner,
            threadId: selThreadId,
            removeLabelIds: ["UNREAD"],
          });
          break;
        }
        case "l": {
          if (!selectedRow) return;
          e.preventDefault();
          setLabelOverlay("label");
          break;
        }
        case "v": {
          if (!selectedRow || !shortcutState.current.moveContextLabelId) return;
          e.preventDefault();
          setLabelOverlay("move");
          break;
        }
      }
    };
    window.addEventListener("keydown", down);
    return () => window.removeEventListener("keydown", down);
  }, []);

  const handleLoadMore = () => {
    console.log("[MessageList:loadMore]");
    void messagesQuery.fetchNextPage();
  };

  const isLoading = messagesQuery.isLoading;

  return (
    <>
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
                aria-label={unreadOnly ? "Show all messages" : "Filter unread"}
              >
                <ListFilterIcon className="size-4.5" />
              </ToggleButton>
            </ToolbarActions>
          </ToolbarRow>
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
            const hasDivider = i < visibleMessages.length - 1;
            // Dividers adjacent to the selection go transparent instead of
            // unmounting — removing the 1px element shifts every row below.
            const dividerVisible = !isSelected && !nextSelected;
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
                {hasDivider ? (
                  <div
                    className={[
                      "h-px mx-5",
                      dividerVisible ? "bg-separator" : "bg-transparent",
                    ].join(" ")}
                  />
                ) : null}
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
      <LabelOverlay
        open={labelOverlay != null}
        onOpenChange={(o) => {
          if (!o) setLabelOverlay(null);
        }}
        mode={labelOverlay ?? "label"}
        accountId={selectedOwner}
        appliedLabelIds={selectedRow?.labelIds ?? []}
        currentLabelId={moveContextLabelId}
        onPick={handleOverlayPick}
      />
    </>
  );
}
