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
} from "@glaze/core/components";
import { FlagIcon, ListFilterIcon } from "lucide-react";
import { IconBtn, HintTooltip } from "./slack-ui";
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
import { LabelChip, InboxChip } from "./label-chip";
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
  /** Mark rows still in the inbox (shown when browsing non-inbox views). */
  showInboxChip: boolean;
};

function MessageRow({
  message,
  selected,
  onSelect,
  accountId,
  resolveLabel,
  combinedMeta,
  showInboxChip,
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

  return (
    <div className="px-2">
      <ContextMenu>
        <ContextMenuTrigger asChild>
      <button
        ref={rowRef}
        type="button"
        onClick={onSelect}
        className={[
          "group my-px flex w-full items-start gap-2.5 rounded-lg px-3 py-2 text-left",
          selected ? "bg-(--sk-selblue)" : "hover:bg-(--sk-hover)",
        ].join(" ")}
      >
        <div className="flex min-w-0 flex-1 flex-col gap-px">
          <div className="flex items-center justify-between gap-2">
            <span className="flex min-w-0 flex-1 items-center gap-1.5">
              {unread && !selected ? (
                <span className="size-2 shrink-0 rounded-full bg-(--sk-blue)" aria-hidden />
              ) : null}
              <span
                className={[
                  "min-w-0 truncate text-[15px] leading-snug",
                  selected
                    ? "font-bold text-(--sk-sel-fg)"
                    : unread
                      ? "font-bold text-(--sk-strong)"
                      : "font-medium text-(--sk-text)",
                ].join(" ")}
              >
                {message.fromName || message.fromEmail}
              </span>
            </span>
            <div className="flex shrink-0 items-center gap-1.5">
              {combinedMeta ? (
                <span className="flex items-center gap-1 text-[11px]">
                  {combinedMeta.mailbox ? (
                    <span className={selected ? "text-(--sk-sel-fg)/70" : "text-(--sk-faint)"}>
                      {combinedMeta.mailbox} -
                    </span>
                  ) : null}
                  <span
                    className="font-semibold"
                    style={{
                      color: selected ? "var(--sk-sel-fg)" : combinedMeta.accountColor,
                    }}
                  >
                    {combinedMeta.accountName}
                  </span>
                </span>
              ) : null}
              {threadCount > 1 ? (
                <span
                  className={[
                    "rounded-full px-1.5 py-px text-[11px] font-semibold tabular-nums",
                    selected ? "bg-(--sk-sel-fg)/25 text-(--sk-sel-fg)" : "bg-(--sk-ctl) text-(--sk-muted)",
                  ].join(" ")}
                >
                  {threadCount}
                </span>
              ) : null}
              <span
                className={[
                  "text-[11px] tabular-nums",
                  selected ? "text-(--sk-sel-fg)/75" : "text-(--sk-faint)",
                ].join(" ")}
              >
                {formatRelativeDate(message.date)}
              </span>
            </div>
          </div>
          <span
            className={[
              "truncate text-[14px] leading-snug",
              selected ? "text-(--sk-sel-fg)/95" : unread ? "font-semibold text-(--sk-strong)" : "text-(--sk-muted)",
            ].join(" ")}
          >
            {message.subject || "(no subject)"}
          </span>
          <span
            className={[
              "truncate text-[13px] leading-snug",
              selected ? "text-(--sk-sel-fg)/70" : "text-(--sk-faint)",
            ].join(" ")}
          >
            {message.snippet || " "}
          </span>
          {/* Fixed-height single-line chip strip so every row measures the same. */}
          <div className="mt-0.5 flex h-5 items-center gap-1 overflow-hidden">
            {showInboxChip && message.labelIds.includes("INBOX") ? (
              <InboxChip selected={selected} />
            ) : null}
            {messageLabels.map((label) => (
              <LabelChip key={label.id} label={label} selected={selected} />
            ))}
          </div>
        </div>

        {message.starred ? (
          <button
            type="button"
            onClick={handleStarToggle}
            className="mt-0.5 shrink-0"
            aria-label="Unflag"
          >
            <FlagIcon
              className={["size-4 fill-current", selected ? "text-(--sk-sel-fg)" : "text-(--red)"].join(" ")}
            />
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

  // Outside the Inbox (labels, views, search), rows still in the inbox say so.
  const inInboxContext =
    !searching && (isCombined ? combined.viewId === INBOX_VIEW_ID : labelId === "INBOX");

  return (
    <div className="flex h-full min-w-0 flex-col">
      {/* Header */}
      <div className="drag-region flex h-[52px] shrink-0 items-center gap-2 border-b border-(--sk-border) px-4">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[16px] font-extrabold leading-tight text-(--sk-strong)">
            {mailboxTitle}
          </div>
          <div className="truncate text-[11px] leading-tight text-(--sk-muted)">
            {formatMailboxSummary(mailboxTotal, mailboxUnread)}
          </div>
        </div>
        <HintTooltip label={unreadOnly ? "Show all messages" : "Filter unread"}>
          <IconBtn
            label={unreadOnly ? "Show all messages" : "Filter unread"}
            active={unreadOnly}
            onClick={() => setUnreadOnly((o) => !o)}
          >
            <ListFilterIcon className="size-4" />
          </IconBtn>
        </HintTooltip>
      </div>

      <div className="sk-scroll min-h-0 flex-1 overflow-y-auto py-1.5">
        {isLoading ? (
          <div className="flex flex-col gap-0">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex w-full items-start gap-3 px-5 py-2.5">
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <div className="h-3.5 w-32 animate-pulse rounded-full bg-(--sk-ctl)" />
                  <div className="h-3 w-48 animate-pulse rounded-full bg-(--sk-hover)" />
                  <div className="h-3 w-40 animate-pulse rounded-full bg-(--sk-hover)" />
                </div>
              </div>
            ))}
          </div>
        ) : visibleMessages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-1 px-6 text-center">
            <span className="text-[15px] font-bold text-(--sk-text)">
              {unreadOnly ? "No unread messages" : "No messages"}
            </span>
            <span className="text-[13px] text-(--sk-muted)">
              {unreadOnly
                ? "Everything here has been read."
                : searchQuery
                  ? "No messages match your search."
                  : "This label is empty."}
            </span>
          </div>
        ) : (
          <>
            {visibleMessages.map((message) => (
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
                combinedMeta={resolveCombinedMeta(message, combined, accounts, resolveLabel)}
                showInboxChip={!inInboxContext}
              />
            ))}
            {hasNextPage ? (
              <div className="flex justify-center py-3">
                <button
                  type="button"
                  onClick={handleLoadMore}
                  disabled={isFetchingNextPage}
                  className="h-7 rounded-md bg-(--sk-ctl) px-3 text-[13px] font-medium text-(--sk-text) hover:bg-(--sk-ctl-hover) disabled:opacity-50"
                >
                  {isFetchingNextPage ? "Loading..." : "Load more"}
                </button>
              </div>
            ) : null}
          </>
        )}
      </div>

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
    </div>
  );
}
