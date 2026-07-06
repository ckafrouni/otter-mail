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
  Dialog,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuSeparator,
  Text,
} from "@glaze/core/components";
import {
  ArchiveIcon,
  ArchiveXIcon,
  BotMessageSquareIcon,
  FlagIcon,
  ListFilterIcon,
  MailIcon,
  MailOpenIcon,
  RotateCcwIcon,
  SearchIcon,
  ShieldCheckIcon,
  SlidersHorizontalIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { IconBtn, HintTooltip } from "./te-ui";
import { SlackAiIcon } from "./assistant-icons";
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
  useUntrashThread,
  useDeleteThreadsForever,
  useLabelResolver,
  useSyncAccountLabels,
} from "./hooks";
import {
  AskAssistantDialog,
  contextFromMessages,
  type AssistantContext,
} from "./ask-assistant";
import { LabelChip, InboxChip, ImportantMarker } from "./label-chip";
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
  /** Reader actions (archive/trash) advance through here; false = no next row. */
  advanceRef: React.MutableRefObject<(fromMessageId: string) => boolean>;
  /** Reports the multi-selected rows so the chat panel can attach them. */
  onSelectionChange?: (rows: GmailMessageSummary[]) => void;
  /** Opens the in-app Hermes chat panel. */
  onOpenChat?: () => void;

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
  /** Part of the cmd/shift multi-selection. */
  checked: boolean;
  onRowClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
  /** Fallback owner id when a summary has no accountId (e.g. live search results). */
  accountId: string;
  resolveLabel: ResolveLabel;
  /** Mailbox + account line shown next to the date, only in Combined view. */
  combinedMeta: CombinedMeta | null;
  /** Mark rows still in the inbox (shown when browsing non-inbox views). */
  showInboxChip: boolean;
  /** Opens the permanent-delete confirm (offered on trashed/junk rows only). */
  onDeleteForever: () => void;
  /** Slack handoff seeded with this conversation. */
  onAskAssistant: () => void;
  /** Opens this conversation in the in-app Hermes chat panel. */
  onChatAssistant: () => void;
};

function MessageRow({
  message,
  selected,
  checked,
  onRowClick,
  accountId,
  resolveLabel,
  combinedMeta,
  showInboxChip,
  onDeleteForever,
  onAskAssistant,
  onChatAssistant,
}: MessageRowProps) {
  const modifyMessage = useModifyMessage();
  const modifyThread = useModifyThread();
  const trashThread = useTrashThread();
  const untrashThread = useUntrashThread();

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

  const junk = message.labelIds.includes("SPAM");

  const handleJunk = () => {
    console.log("[MessageList:junkToggle]", { threadId, junk });
    void modifyThread.mutateAsync({
      accountId: ownerAccountId,
      threadId,
      addLabelIds: junk ? ["INBOX"] : ["SPAM"],
      removeLabelIds: junk ? ["SPAM"] : ["INBOX"],
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

  const inInbox = message.labelIds.includes("INBOX");

  const handleArchive = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    console.log("[MessageList:archiveToggle]", { threadId, inInbox });
    void modifyThread.mutateAsync({
      accountId: ownerAccountId,
      threadId,
      addLabelIds: inInbox ? undefined : ["INBOX"],
      removeLabelIds: inInbox ? ["INBOX"] : undefined,
    });
  };

  const trashed = message.labelIds.includes("TRASH");

  const handleTrash = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    console.log("[MessageList:trashToggle]", { threadId, trashed });
    if (trashed) {
      void untrashThread.mutateAsync({ accountId: ownerAccountId, threadId });
      return;
    }
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
        onClick={onRowClick}
        // shift-click must not start a text selection
        onMouseDown={(e) => {
          if (e.shiftKey) e.preventDefault();
        }}
        className={[
          "group my-px flex w-full items-start gap-2.5 rounded-[6px] px-3 py-2 text-left",
          selected
            ? "bg-(--te-sel)"
            : checked
              ? "bg-(--te-hover) ring-1 ring-inset ring-(--te-outline-hover)"
              : "hover:bg-(--te-hover)",
        ].join(" ")}
      >
        <div className="flex min-w-0 flex-1 flex-col gap-px">
          <div className="flex items-center justify-between gap-2">
            <span className="flex min-w-0 flex-1 items-center gap-1.5">
              {unread && !selected ? (
                <span className="size-1.5 shrink-0 bg-(--te-blue)" aria-hidden />
              ) : null}
              {message.labelIds.includes("IMPORTANT") ? <ImportantMarker /> : null}
              <span
                className={[
                  "min-w-0 truncate text-[14px] leading-snug",
                  selected
                    ? "font-bold text-(--te-sel-fg)"
                    : unread
                      ? "font-bold text-(--te-strong)"
                      : "font-medium text-(--te-text)",
                ].join(" ")}
              >
                {message.fromName || message.fromEmail}
              </span>
            </span>
            <div className="flex shrink-0 items-center gap-1.5">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onAskAssistant();
                }}
                onMouseDown={(e) => e.stopPropagation()}
                aria-label="Send to Hermes in Slack"
                className={[
                  "shrink-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
                  selected
                    ? "text-(--te-sel-fg)/80 hover:text-(--te-sel-fg)"
                    : "text-(--te-faint) hover:text-(--te-strong)",
                ].join(" ")}
              >
                <SlackAiIcon className="size-3.5" />
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onChatAssistant();
                }}
                onMouseDown={(e) => e.stopPropagation()}
                aria-label="Open in Hermes chat"
                className={[
                  "shrink-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
                  selected
                    ? "text-(--te-sel-fg)/80 hover:text-(--te-sel-fg)"
                    : "text-(--te-faint) hover:text-(--te-strong)",
                ].join(" ")}
              >
                <BotMessageSquareIcon className="size-3.5" />
              </button>
              {combinedMeta ? (
                <span className="flex items-center gap-1 text-[11px]">
                  {combinedMeta.mailbox ? (
                    <span className={selected ? "text-(--te-sel-fg)/70" : "text-(--te-faint)"}>
                      {combinedMeta.mailbox} -
                    </span>
                  ) : null}
                  <span
                    className="font-semibold"
                    style={{
                      color: selected ? "var(--te-sel-fg)" : combinedMeta.accountColor,
                    }}
                  >
                    {combinedMeta.accountName}
                  </span>
                </span>
              ) : null}
              {threadCount > 1 ? (
                <span
                  className={[
                    "te-num rounded-[3px] px-1 py-px text-[10px]",
                    selected
                      ? "bg-(--te-sel-fg)/25 text-(--te-sel-fg)"
                      : "border border-(--te-outline) text-(--te-muted)",
                  ].join(" ")}
                >
                  {threadCount}
                </span>
              ) : null}
              <span
                className={[
                  "te-num text-[10px]",
                  selected ? "text-(--te-sel-fg)/75" : "text-(--te-faint)",
                ].join(" ")}
              >
                {formatRelativeDate(message.date)}
              </span>
            </div>
          </div>
          <span
            className={[
              "truncate text-[13px] leading-snug",
              selected ? "text-(--te-sel-fg)/95" : unread ? "font-semibold text-(--te-strong)" : "text-(--te-muted)",
            ].join(" ")}
          >
            {message.subject || "(no subject)"}
          </span>
          <span
            className={[
              "truncate text-[12px] leading-snug",
              selected ? "text-(--te-sel-fg)/70" : "text-(--te-faint)",
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
              className={["size-4 fill-current", selected ? "text-(--te-sel-fg)" : "text-(--red)"].join(" ")}
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
          <ContextMenuItem icon="paperplane" onSelect={onAskAssistant}>
            Send to Hermes in Slack…
          </ContextMenuItem>
          <ContextMenuItem icon="bubble.left" onSelect={onChatAssistant}>
            Open in Hermes chat
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
          {trashed || junk ? null : (
            <ContextMenuItem
              icon={inInbox ? "archivebox" : "tray.and.arrow.down"}
              onSelect={() => handleArchive()}
            >
              {inInbox ? "Archive" : "Move to Inbox"}
            </ContextMenuItem>
          )}
          {trashed ? null : (
            <ContextMenuItem
              icon={junk ? "checkmark.shield" : "xmark.bin"}
              onSelect={handleJunk}
            >
              {junk ? "Not Junk" : "Move to Junk"}
            </ContextMenuItem>
          )}
          {trashed ? (
            <ContextMenuItem icon="trash.slash" onSelect={() => handleTrash()}>
              Restore from Trash
            </ContextMenuItem>
          ) : (
            <ContextMenuItem icon="trash" color="red" onSelect={() => handleTrash()}>
              Move to Trash
            </ContextMenuItem>
          )}
          {trashed || junk ? (
            <ContextMenuItem icon="trash.fill" color="red" onSelect={onDeleteForever}>
              Delete Forever…
            </ContextMenuItem>
          ) : null}
        </ContextMenuContent>
      </ContextMenu>
    </div>
  );
}

/** Structured criteria of the view filter bar, compiled into the scoped search. */
type ViewFilters = {
  starred: boolean;
  important: boolean;
  hasAttachments: boolean;
  withinDays: number | null;
};

const NO_FILTERS: ViewFilters = {
  starred: false,
  important: false,
  hasAttachments: false,
  withinDays: null,
};

const WITHIN_DAYS_OPTIONS: { days: number; label: string }[] = [
  { days: 1, label: "Last 24 hours" },
  { days: 7, label: "Last 7 days" },
  { days: 30, label: "Last 30 days" },
];

function withinDaysLabel(days: number): string {
  return WITHIN_DAYS_OPTIONS.find((o) => o.days === days)?.label ?? `Last ${days} days`;
}

/** Removable filter token shown inside the filter bar. */
function FilterPill({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <button
      type="button"
      onClick={onRemove}
      aria-label={`Remove filter: ${label}`}
      className="te-label flex shrink-0 items-center gap-1 rounded-[4px] border border-(--te-outline) px-1.5 py-0.5 text-(--te-muted) hover:bg-(--te-hover) hover:text-(--te-strong)"
    >
      {label}
      <XIcon className="size-3" />
    </button>
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
  advanceRef,
  onSelectionChange,
  onOpenChat,
  searchQuery,
}: MessageListProps) {
  const isCombined = combined != null;
  const [unreadOnly, setUnreadOnly] = useState(false);

  // Search is local (FTS5 over the mail cache): account-scoped in account mode,
  // across every account in Combined mode. Results are message-level rows.
  // Two entry points: the TopBar search (app-wide) and the header's filter bar
  // (same FTS, restricted to the current view, plus structured criteria that
  // work with an empty query); an active filter wins.
  const debouncedQuery = useDebouncedValue(searchQuery.trim(), 150);
  const globalSearching = debouncedQuery.length > 0;

  // Search and criteria are independent: filterOpen is ONLY the text input's
  // state (search icon), criteria live in `filters` (sliders menu). Each gets
  // its own row under the header with its own dismiss.
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterQuery, setFilterQuery] = useState("");
  const [filters, setFilters] = useState<ViewFilters>(NO_FILTERS);
  const filtersActive =
    filters.starred || filters.important || filters.hasAttachments || filters.withinDays != null;
  const debouncedFilter = useDebouncedValue(filterOpen ? filterQuery.trim() : "", 150);
  const filtering = debouncedFilter.length > 0 || filtersActive;
  const searching = filtering || globalSearching;

  const closeSearch = () => {
    setFilterOpen(false);
    setFilterQuery("");
  };
  const clearFilters = () => setFilters(NO_FILTERS);
  const patchFilters = (patch: Partial<ViewFilters>) => {
    console.log("[MessageList:patchFilters]", patch);
    setFilters((f) => ({ ...f, ...patch }));
  };

  // All hooks are always called (rules of hooks); the inactive ones are disabled.
  const accountMessages = useMessages(isCombined || searching ? null : accountId, labelId);
  const combinedMessages = useCombinedMessages(
    combined?.rules ?? [],
    combined?.viewId ?? "",
    isCombined && !searching,
  );
  const searchResults = useSearchMessages(
    debouncedQuery,
    isCombined ? null : accountId,
    globalSearching && !filtering,
  );
  const filterResults = useSearchMessages(
    debouncedFilter,
    isCombined ? null : accountId,
    filtering,
    {
      ...(combined ? { rules: combined.rules } : { labelId }),
      starred: filters.starred || undefined,
      important: filters.important || undefined,
      hasAttachments: filters.hasAttachments || undefined,
      withinDays: filters.withinDays ?? undefined,
    },
  );
  const messagesQuery = filtering
    ? filterResults
    : globalSearching
      ? searchResults
      : isCombined
        ? combinedMessages
        : accountMessages;

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

  // Gmail-style list shortcuts: j/k and the arrow keys move the selection
  // (Apple Mail-style — arrows never scroll the list), e/#/! archive/trash/
  // junk the selected thread (advancing to the next row), s toggles the flag,
  // Shift+U/Shift+I set unread/read. Latest state is read through a ref so the
  // window listener mounts once.
  const listModifyMessage = useModifyMessage();
  const listModifyThread = useModifyThread();
  const listTrashThread = useTrashThread();
  const listUntrashThread = useUntrashThread();

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

  // Ask-Hermes handoff: one conversation from a row, several from the
  // multi-selection. Context is pointer-only; Hermes fetches via gog.
  const [askContext, setAskContext] = useState<AssistantContext | null>(null);
  const accountEmailById = (id: string | undefined) =>
    accounts.find((a) => a.id === (id ?? accountId))?.email ?? id ?? accountId;
  const askAbout = (rows: GmailMessageSummary[]) => {
    console.log("[MessageList:askAssistant]", { count: rows.length });
    setAskContext(contextFromMessages(rows, accountEmailById));
  };

  // Cmd/shift multi-selection (bulk action bar). Anchor = last plain/cmd click,
  // falling back to the open message, so shift-click ranges feel native.
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());
  const anchorRef = useRef<string | null>(null);
  const clearChecked = () => {
    setChecked(new Set());
    anchorRef.current = null;
  };
  useEffect(() => {
    clearChecked();
  }, [labelId, combined?.viewId, searching, unreadOnly]);

  const checkedRef = useRef(checked);
  checkedRef.current = checked;
  // Capture phase: Escape clears the multi-selection before home-view's
  // Escape closes the reader.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || checkedRef.current.size === 0 || isTypingTarget(e)) return;
      e.preventDefault();
      e.stopPropagation();
      setChecked(new Set());
      anchorRef.current = null;
    };
    window.addEventListener("keydown", down, true);
    return () => window.removeEventListener("keydown", down, true);
  }, []);

  const toggleChecked = (id: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    anchorRef.current = id;
  };

  const rangeSelect = (id: string) => {
    const ids = visibleMessages.map((m) => m.id);
    const from = anchorRef.current ?? selectedMessageId ?? id;
    const a = ids.indexOf(from);
    const b = ids.indexOf(id);
    if (a === -1 || b === -1) {
      toggleChecked(id);
      return;
    }
    const [lo, hi] = a < b ? [a, b] : [b, a];
    setChecked((prev) => {
      const next = new Set(prev);
      for (let i = lo; i <= hi; i++) next.add(ids[i]);
      return next;
    });
  };

  const handleRowClick = (e: React.MouseEvent, message: GmailMessageSummary) => {
    if (e.metaKey || e.ctrlKey) {
      toggleChecked(message.id);
      return;
    }
    if (e.shiftKey) {
      rangeSelect(message.id);
      return;
    }
    clearChecked();
    anchorRef.current = message.id;
    console.log("[MessageList:selectMessage]", { messageId: message.id });
    onSelectMessage(message.id, message.accountId ?? accountId);
  };

  const checkedRows = visibleMessages.filter((m) => checked.has(m.id));

  // Surface the multi-selection to the chat panel. Keyed on the id signature
  // so it only fires when the set actually changes (checkedRows is a fresh
  // array every render).
  const selectionSig = checkedRows.map((m) => `${m.accountId ?? accountId}:${m.id}`).join(",");
  const selectionRef = useRef(onSelectionChange);
  selectionRef.current = onSelectionChange;
  const checkedRowsRef = useRef(checkedRows);
  checkedRowsRef.current = checkedRows;
  useEffect(() => {
    selectionRef.current?.(checkedRowsRef.current);
  }, [selectionSig]);
  const bulk = (label: string, run: (m: GmailMessageSummary) => void) => {
    console.log("[MessageList:bulk]", { action: label, count: checkedRows.length });
    for (const m of checkedRows) run(m);
    clearChecked();
  };
  const bulkArchive = () =>
    bulk("archive", (m) =>
      void listModifyThread.mutateAsync({
        accountId: m.accountId ?? accountId,
        threadId: m.threadId || m.id,
        removeLabelIds: ["INBOX"],
      }),
    );
  const bulkTrash = () =>
    bulk("trash", (m) =>
      void listTrashThread.mutateAsync({
        accountId: m.accountId ?? accountId,
        threadId: m.threadId || m.id,
      }),
    );
  const bulkJunk = () =>
    bulk("junk", (m) =>
      void listModifyThread.mutateAsync({
        accountId: m.accountId ?? accountId,
        threadId: m.threadId || m.id,
        addLabelIds: ["SPAM"],
        removeLabelIds: ["INBOX"],
      }),
    );
  const bulkMarkRead = () =>
    bulk("read", (m) =>
      void listModifyThread.mutateAsync({
        accountId: m.accountId ?? accountId,
        threadId: m.threadId || m.id,
        removeLabelIds: ["UNREAD"],
      }),
    );
  const bulkUntrash = () =>
    bulk("untrash", (m) =>
      void listUntrashThread.mutateAsync({
        accountId: m.accountId ?? accountId,
        threadId: m.threadId || m.id,
      }),
    );
  const listDeleteForever = useDeleteThreadsForever();
  const [confirmDeleteRows, setConfirmDeleteRows] = useState<GmailMessageSummary[] | null>(null);
  const handleDeleteForeverConfirm = () => {
    const rows = confirmDeleteRows ?? [];
    setConfirmDeleteRows(null);
    console.log("[MessageList:deleteForever]", { count: rows.length });
    const byAccount = new Map<string, string[]>();
    for (const m of rows) {
      const owner = m.accountId ?? accountId;
      const threadIds = byAccount.get(owner) ?? [];
      threadIds.push(m.threadId || m.id);
      byAccount.set(owner, threadIds);
    }
    for (const [owner, threadIds] of byAccount) {
      void listDeleteForever.mutateAsync({ accountId: owner, threadIds });
    }
    clearChecked();
  };
  const bulkNotJunk = () =>
    bulk("notJunk", (m) =>
      void listModifyThread.mutateAsync({
        accountId: m.accountId ?? accountId,
        threadId: m.threadId || m.id,
        addLabelIds: ["INBOX"],
        removeLabelIds: ["SPAM"],
      }),
    );
  // Trash/spam rows only surface in their own views, so a uniform selection
  // decides the bar's vocabulary; mixed selections fall back to the default.
  const allTrashed = checkedRows.length > 0 && checkedRows.every((m) => m.labelIds.includes("TRASH"));
  const allJunk =
    !allTrashed && checkedRows.length > 0 && checkedRows.every((m) => m.labelIds.includes("SPAM"));

  const bulkMarkUnread = () => {
    // Gmail-style: marking the open conversation unread returns to the list
    // (and keeps the reader from instantly re-marking it read).
    if (selectedMessageId && checked.has(selectedMessageId)) onDeselect();
    bulk("unread", (m) =>
      void listModifyMessage.mutateAsync({
        accountId: m.accountId ?? accountId,
        messageId: m.id,
        addLabelIds: ["UNREAD"],
      }),
    );
  };

  const advanceFrom = (rowId: string) => {
    const idx = visibleMessages.findIndex((m) => m.id === rowId);
    const next = visibleMessages[idx + 1] ?? visibleMessages[idx - 1];
    if (next) onSelectMessage(next.id, next.accountId ?? accountId);
  };
  advanceRef.current = (fromMessageId: string) => {
    const idx = visibleMessages.findIndex((m) => m.id === fromMessageId);
    if (idx === -1) return false;
    const next = visibleMessages[idx + 1] ?? visibleMessages[idx - 1];
    if (!next) return false;
    onSelectMessage(next.id, next.accountId ?? accountId);
    return true;
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
        case "j":
        case "ArrowDown": {
          // preventDefault even at the end of the list — arrows must never
          // fall through to scrolling.
          e.preventDefault();
          const next = idx === -1 ? rows[0] : rows[idx + 1];
          if (next) select(next);
          break;
        }
        case "k":
        case "ArrowUp": {
          e.preventDefault();
          const prev = idx === -1 ? rows[0] : rows[idx - 1];
          if (prev) select(prev);
          break;
        }
        case "e": {
          if (!selectedRow) return;
          e.preventDefault();
          // Archived rows un-archive; rows still in the inbox archive (and
          // advance, since they leave the current view).
          const rowInInbox = selectedRow.labelIds.includes("INBOX");
          if (rowInInbox) advance();
          void listModifyThread.mutateAsync({
            accountId: owner,
            threadId: selThreadId,
            addLabelIds: rowInInbox ? undefined : ["INBOX"],
            removeLabelIds: rowInInbox ? ["INBOX"] : undefined,
          });
          break;
        }
        case "#": {
          if (!selectedRow) return;
          e.preventDefault();
          // Trashed rows restore in place; live rows trash and advance.
          if (selectedRow.labelIds.includes("TRASH")) {
            void listUntrashThread.mutateAsync({ accountId: owner, threadId: selThreadId });
          } else {
            advance();
            void listTrashThread.mutateAsync({ accountId: owner, threadId: selThreadId });
          }
          break;
        }
        case "!": {
          if (!selectedRow) return;
          e.preventDefault();
          // Junk rows come back to the inbox; either way the row leaves the view.
          const rowJunk = selectedRow.labelIds.includes("SPAM");
          advance();
          void listModifyThread.mutateAsync({
            accountId: owner,
            threadId: selThreadId,
            addLabelIds: rowJunk ? ["INBOX"] : ["SPAM"],
            removeLabelIds: rowJunk ? ["SPAM"] : ["INBOX"],
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

  // Infinite scroll: pull the next page whenever the bottom comes within
  // reach — on scroll, and after each render so short pages keep filling
  // until the viewport has headroom.
  const scrollRef = useRef<HTMLDivElement>(null);
  const maybeLoadMore = () => {
    const el = scrollRef.current;
    if (!el || !hasNextPage || isFetchingNextPage) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 600) {
      console.log("[MessageList:autoLoadMore]");
      void messagesQuery.fetchNextPage();
    }
  };
  useEffect(maybeLoadMore);

  const isLoading = messagesQuery.isLoading;

  // Outside the Inbox (labels, views, global search), rows still in the inbox
  // say so. The view filter stays inside the current view, so its rows carry
  // the view's labels by construction — no chip needed there.
  const inInboxContext =
    !globalSearching && (isCombined ? combined.viewId === INBOX_VIEW_ID : labelId === "INBOX");

  return (
    <div className="relative flex h-full min-w-0 flex-col">
      {/* Header */}
      <div className="drag-region flex h-[52px] shrink-0 items-center gap-2 border-b border-(--te-border) px-4">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-bold leading-tight tracking-tight text-(--te-strong)">
            {mailboxTitle}
          </div>
          <div className="te-label truncate leading-tight text-(--te-muted)">
            {formatMailboxSummary(mailboxTotal, mailboxUnread)}
          </div>
        </div>
        <HintTooltip label={filterOpen ? "Hide search" : "Search this mailbox"}>
          <IconBtn
            label={filterOpen ? "Hide search" : "Search this mailbox"}
            active={filterOpen}
            onClick={() => (filterOpen ? closeSearch() : setFilterOpen(true))}
          >
            <SearchIcon className="size-4" />
          </IconBtn>
        </HintTooltip>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconBtn label="Filters" active={filtersActive}>
              <SlidersHorizontalIcon className="size-4" />
            </IconBtn>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuCheckboxItem
              checked={filters.starred}
              onCheckedChange={(c) => patchFilters({ starred: c })}
            >
              Flagged
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={filters.important}
              onCheckedChange={(c) => patchFilters({ important: c })}
            >
              Important
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={filters.hasAttachments}
              onCheckedChange={(c) => patchFilters({ hasAttachments: c })}
            >
              With Attachments
            </DropdownMenuCheckboxItem>
            <DropdownMenuSeparator />
            {WITHIN_DAYS_OPTIONS.map((o) => (
              <DropdownMenuCheckboxItem
                key={o.days}
                checked={filters.withinDays === o.days}
                onCheckedChange={(c) => patchFilters({ withinDays: c ? o.days : null })}
              >
                {o.label}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
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

      {filterOpen ? (
        <div className="flex h-9 shrink-0 items-center gap-1.5 border-b border-(--te-border) px-4">
          <SearchIcon className="size-3.5 shrink-0 text-(--te-faint)" />
          <input
            autoFocus
            value={filterQuery}
            onChange={(e) => setFilterQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.stopPropagation();
                closeSearch();
              }
            }}
            placeholder={`Search in ${mailboxTitle}`}
            className="h-6 min-w-24 flex-1 bg-transparent text-[13px] text-(--te-text) outline-none placeholder:text-(--te-faint)"
          />
          <button
            type="button"
            onClick={closeSearch}
            aria-label="Close search"
            className="shrink-0 text-(--te-faint) hover:text-(--te-strong)"
          >
            <XIcon className="size-3.5" />
          </button>
        </div>
      ) : null}

      {filtersActive ? (
        <div className="flex min-h-9 shrink-0 flex-wrap items-center gap-1.5 border-b border-(--te-border) px-4 py-1.5">
          {filters.starred ? (
            <FilterPill label="Flagged" onRemove={() => patchFilters({ starred: false })} />
          ) : null}
          {filters.important ? (
            <FilterPill label="Important" onRemove={() => patchFilters({ important: false })} />
          ) : null}
          {filters.hasAttachments ? (
            <FilterPill
              label="Attachments"
              onRemove={() => patchFilters({ hasAttachments: false })}
            />
          ) : null}
          {filters.withinDays != null ? (
            <FilterPill
              label={withinDaysLabel(filters.withinDays)}
              onRemove={() => patchFilters({ withinDays: null })}
            />
          ) : null}
          <span className="h-6 flex-1" aria-hidden />
          <button
            type="button"
            onClick={clearFilters}
            aria-label="Clear filters"
            className="shrink-0 text-(--te-faint) hover:text-(--te-strong)"
          >
            <XIcon className="size-3.5" />
          </button>
        </div>
      ) : null}

      <div
        ref={scrollRef}
        onScroll={maybeLoadMore}
        className={[
          "te-scroll min-h-0 flex-1 overflow-y-auto py-1.5",
          checked.size > 0 ? "pb-16" : "",
        ].join(" ")}
      >
        {isLoading ? (
          <div className="flex flex-col gap-0">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex w-full items-start gap-3 px-5 py-2.5">
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <div className="h-3.5 w-32 animate-pulse rounded-[3px] bg-(--te-ctl)" />
                  <div className="h-3 w-48 animate-pulse rounded-[3px] bg-(--te-hover)" />
                  <div className="h-3 w-40 animate-pulse rounded-[3px] bg-(--te-hover)" />
                </div>
              </div>
            ))}
          </div>
        ) : visibleMessages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-1 px-6 text-center">
            <span className="text-[15px] font-bold text-(--te-text)">
              {unreadOnly ? "No unread messages" : "No messages"}
            </span>
            <span className="text-[13px] text-(--te-muted)">
              {unreadOnly
                ? "Everything here has been read."
                : filtering
                  ? "No messages match your filters."
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
                checked={checked.has(message.id)}
                onRowClick={(e) => handleRowClick(e, message)}
                accountId={accountId}
                resolveLabel={resolveLabel}
                combinedMeta={resolveCombinedMeta(message, combined, accounts, resolveLabel)}
                showInboxChip={!inInboxContext}
                onDeleteForever={() => setConfirmDeleteRows([message])}
                onAskAssistant={() => askAbout([message])}
                onChatAssistant={() => {
                  // Open this conversation in the reader so it becomes the
                  // chat panel's attached context, then reveal the panel.
                  onSelectMessage(message.id, message.accountId ?? accountId);
                  onOpenChat?.();
                }}
              />
            ))}
            {isFetchingNextPage ? (
              <div className="flex items-center justify-center gap-1.5 py-3">
                <span className="te-blink size-1.5 shrink-0 bg-(--te-accent)" aria-hidden />
                <span className="te-label text-(--te-faint)">Loading more</span>
              </div>
            ) : null}
          </>
        )}
      </div>

      {checked.size > 0 ? (
        <div className="absolute inset-x-0 bottom-3 z-10 flex justify-center px-3">
          <div className="flex items-center gap-0.5 rounded-[6px] border border-(--te-outline) bg-(--te-panel) px-2 py-1 shadow-lg">
            <span className="te-num pl-1 text-[11px] text-(--te-badge-bg)">{checked.size}</span>
            <span className="te-label pr-1 text-(--te-faint)">selected</span>
            <span className="mx-1 h-5 w-px shrink-0 bg-(--te-border)" aria-hidden />
            {allTrashed ? (
              <>
                <HintTooltip label="Restore from Trash">
                  <IconBtn label="Restore from Trash" className="size-7" onClick={bulkUntrash}>
                    <RotateCcwIcon className="size-4" />
                  </IconBtn>
                </HintTooltip>
                <HintTooltip label="Delete Forever">
                  <IconBtn
                    label="Delete Forever"
                    className="size-7"
                    onClick={() => setConfirmDeleteRows(checkedRows)}
                  >
                    <Trash2Icon className="size-4 text-(--red)" />
                  </IconBtn>
                </HintTooltip>
              </>
            ) : allJunk ? (
              <>
                <HintTooltip label="Not Junk — move to Inbox">
                  <IconBtn label="Not Junk" className="size-7" onClick={bulkNotJunk}>
                    <ShieldCheckIcon className="size-4" />
                  </IconBtn>
                </HintTooltip>
                <HintTooltip label="Move to Trash">
                  <IconBtn label="Move to Trash" className="size-7" onClick={bulkTrash}>
                    <Trash2Icon className="size-4" />
                  </IconBtn>
                </HintTooltip>
                <HintTooltip label="Delete Forever">
                  <IconBtn
                    label="Delete Forever"
                    className="size-7"
                    onClick={() => setConfirmDeleteRows(checkedRows)}
                  >
                    <Trash2Icon className="size-4 text-(--red)" />
                  </IconBtn>
                </HintTooltip>
              </>
            ) : (
              <>
                <HintTooltip label="Archive">
                  <IconBtn label="Archive" className="size-7" onClick={bulkArchive}>
                    <ArchiveIcon className="size-4" />
                  </IconBtn>
                </HintTooltip>
                <HintTooltip label="Move to Trash">
                  <IconBtn label="Move to Trash" className="size-7" onClick={bulkTrash}>
                    <Trash2Icon className="size-4" />
                  </IconBtn>
                </HintTooltip>
                <HintTooltip label="Move to Junk">
                  <IconBtn label="Move to Junk" className="size-7" onClick={bulkJunk}>
                    <ArchiveXIcon className="size-4" />
                  </IconBtn>
                </HintTooltip>
              </>
            )}
            <span className="mx-1 h-5 w-px shrink-0 bg-(--te-border)" aria-hidden />
            <HintTooltip label="Mark as read">
              <IconBtn label="Mark as read" className="size-7" onClick={bulkMarkRead}>
                <MailOpenIcon className="size-4" />
              </IconBtn>
            </HintTooltip>
            <HintTooltip label="Mark as unread">
              <IconBtn label="Mark as unread" className="size-7" onClick={bulkMarkUnread}>
                <MailIcon className="size-4" />
              </IconBtn>
            </HintTooltip>
            <span className="mx-1 h-5 w-px shrink-0 bg-(--te-border)" aria-hidden />
            <HintTooltip label="Send selection to Hermes in Slack">
              <IconBtn label="Send to Slack" className="size-7" onClick={() => askAbout(checkedRows)}>
                <SlackAiIcon className="size-4" />
              </IconBtn>
            </HintTooltip>
            <HintTooltip label="Chat about the selection in Hermes">
              <IconBtn
                label="Open in Hermes chat"
                className="size-7"
                onClick={() => onOpenChat?.()}
              >
                <BotMessageSquareIcon className="size-4" />
              </IconBtn>
            </HintTooltip>
            <span className="mx-1 h-5 w-px shrink-0 bg-(--te-border)" aria-hidden />
            <HintTooltip label="Clear selection" hint="Esc">
              <IconBtn label="Clear selection" className="size-7" onClick={clearChecked}>
                <XIcon className="size-4" />
              </IconBtn>
            </HintTooltip>
          </div>
        </div>
      ) : null}

      <Dialog
        open={confirmDeleteRows != null}
        onOpenChange={(o) => {
          if (!o) setConfirmDeleteRows(null);
        }}
        title="Delete Forever"
        confirmLabel="Delete Forever"
        confirmVariant="accent"
        onConfirm={handleDeleteForeverConfirm}
      >
        <Text variant="small">
          Permanently delete{" "}
          {confirmDeleteRows && confirmDeleteRows.length === 1
            ? "this conversation"
            : `${confirmDeleteRows?.length ?? 0} conversations`}
          ? This cannot be undone.
        </Text>
      </Dialog>

      <AskAssistantDialog
        context={askContext}
        onOpenChange={(o) => {
          if (!o) setAskContext(null);
        }}
      />

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
