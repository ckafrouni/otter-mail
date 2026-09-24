import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArchiveIcon,
  PowerIcon,
  RotateCwIcon,
  SquareArrowOutUpRightIcon,
  SquarePenIcon,
  Trash2Icon,
} from "lucide-react";
import { getAccountColor, getAccountDisplayName } from "../main/gmail/account-style";
import { decodeEntities } from "../main/gmail/text";
import { HintTooltip, IconBtn, buttonClass, cn } from "../main/gmail/ui";
import { MailboxSwitcher } from "../main/gmail/top-bar";
import { COMBINED_ACCOUNT_ID } from "../main/gmail/custom-views";
import { applyAppTheme, startAppTheme } from "../main/theme/apply-theme";
import { gmailApi } from "../main/gmail/api";
import { trayApi } from "./api";
import type { GmailMessageSummary } from "../main/gmail/types";

// Color theme (Settings → Appearance), applied before first paint.
applyAppTheme();

function formatRelativeDate(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return date.toLocaleDateString([], { weekday: "short" });
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

/** One conversation, in the main list's row recipe (no avatar, quiet meta). */
function InboxRow({
  message,
  accountColor,
  accountName,
  showAccountLabel,
  onOpen,
  onArchive,
  onTrash,
}: {
  message: GmailMessageSummary;
  accountColor: string;
  accountName: string;
  showAccountLabel: boolean;
  onOpen: () => void;
  onArchive: () => void;
  onTrash: () => void;
}) {
  const unread = message.threadUnread ?? message.unread;
  return (
    <div className="py-0.5">
      <div
        role="button"
        tabIndex={0}
        onClick={onOpen}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onOpen();
          }
        }}
        className="group relative flex w-full cursor-pointer select-none flex-col gap-px rounded-md px-(--sidebar-row-content-inset) py-2 text-left outline-none transition-colors hover:bg-sidebar-row-hover focus-visible:ring-2 focus-visible:ring-focus-ring"
      >
        <div className="flex h-5 min-w-0 items-center gap-1.5">
          {unread ? (
            <span className="size-1.5 shrink-0 rounded-full bg-primary" aria-hidden />
          ) : null}
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-sm leading-snug",
              unread ? "font-semibold text-foreground" : "font-medium text-foreground/90",
            )}
          >
            {message.fromName || message.fromEmail}
          </span>
          {/* Meta at rest; row actions take its place on hover. */}
          <span className="relative flex h-5 shrink-0 items-center">
            <span className="flex items-center gap-1.5 group-focus-within:invisible group-hover:invisible">
              {showAccountLabel ? (
                <span
                  className="max-w-20 truncate text-xs font-medium"
                  style={{ color: accountColor }}
                >
                  {accountName}
                </span>
              ) : null}
              <span className="text-xs tabular-nums text-muted-foreground/55">
                {formatRelativeDate(message.date)}
              </span>
            </span>
            <span className="absolute inset-y-0 right-0 flex items-center gap-0.5 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100">
              <HintTooltip label="Archive">
                <IconBtn
                  label="Archive"
                  className="size-6"
                  onClick={(e) => {
                    e.stopPropagation();
                    onArchive();
                  }}
                >
                  <ArchiveIcon className="size-3.5" />
                </IconBtn>
              </HintTooltip>
              <HintTooltip label="Move to Trash">
                <IconBtn
                  label="Move to Trash"
                  className="size-6 hover:text-destructive"
                  onClick={(e) => {
                    e.stopPropagation();
                    onTrash();
                  }}
                >
                  <Trash2Icon className="size-3.5" />
                </IconBtn>
              </HintTooltip>
            </span>
          </span>
        </div>
        <div
          className={cn(
            "truncate text-sm leading-snug",
            unread ? "font-medium text-foreground/90" : "text-muted-foreground",
          )}
        >
          {message.subject || "(no subject)"}
        </div>
        <div className="truncate text-xs leading-snug text-muted-foreground/70">
          {decodeEntities(message.snippet) || " "}
        </div>
      </div>
    </div>
  );
}

/**
 * The menu-bar popover: a pocket version of the main window. A mailbox
 * switcher and Unread toggle up top, the conversation list, and a footer of
 * utilities. Opening a row hands off to the standalone message window;
 * everything else routes through main/handlers/tray-popover.ts.
 */
export function TrayPopoverView() {
  const queryClient = useQueryClient();
  const [mailbox, setMailbox] = useState<string>(COMBINED_ACCOUNT_ID);
  const [syncing, setSyncing] = useState(false);
  const [unreadOnly, setUnreadOnly] = useState(true);

  const snapshotQuery = useQuery({
    queryKey: ["tray:snapshot", unreadOnly],
    queryFn: () => trayApi.getSnapshot(unreadOnly),
  });

  // Re-theme on appearance switches and on theme picks from any window.
  useEffect(() => startAppTheme(), []);

  // Reopening the popover re-activates its window, and WebKit restores focus
  // to the last-clicked control drawn as keyboard focus (a ring around the
  // mailbox switcher). Start every opening with nothing focused.
  useEffect(() => {
    const clearFocus = () =>
      requestAnimationFrame(() => {
        const el = document.activeElement;
        if (el instanceof HTMLElement && el !== document.body) el.blur();
      });
    clearFocus();
    window.addEventListener("focus", clearFocus);
    return () => window.removeEventListener("focus", clearFocus);
  }, []);

  useEffect(() => {
    const refetch = () => void queryClient.invalidateQueries({ queryKey: ["tray:snapshot"] });
    window.addEventListener("focus", refetch);
    const unsub = window.glazeAPI.glaze.ipc.onNotification("tray:refresh", refetch);
    return () => {
      window.removeEventListener("focus", refetch);
      unsub();
    };
  }, [queryClient]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) void trayApi.hide();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const snapshots = snapshotQuery.data?.accounts ?? [];
  const accounts = snapshots.map((s) => s.account);
  const totalUnread = snapshotQuery.data?.totalUnread ?? 0;
  const combined = accounts.length > 1;
  // A single account has no "All mailboxes"; a vanished account falls back.
  const effectiveMailbox =
    combined && (mailbox === COMBINED_ACCOUNT_ID || accounts.some((a) => a.id === mailbox))
      ? mailbox
      : (accounts[0]?.id ?? COMBINED_ACCOUNT_ID);
  const isCombined = effectiveMailbox === COMBINED_ACCOUNT_ID;

  const rows = useMemo(() => {
    const scoped = isCombined
      ? snapshots
      : snapshots.filter((s) => s.account.id === effectiveMailbox);
    return scoped
      .flatMap((s) =>
        s.messages.map((message) => ({
          message,
          accountId: s.account.id,
          accountColor: getAccountColor(s.account),
          accountName: getAccountDisplayName(s.account),
        })),
      )
      .sort((a, b) => b.message.date - a.message.date)
      .slice(0, 40);
  }, [snapshots, isCombined, effectiveMailbox]);

  async function handleSync() {
    if (syncing) return;
    setSyncing(true);
    try {
      await trayApi.sync();
      await queryClient.invalidateQueries({ queryKey: ["tray:snapshot"] });
    } finally {
      setSyncing(false);
    }
  }

  /** Runs a row action, then refreshes this popover and the main window. A
      failure that surfaces later is toasted by the main window. */
  async function runAction(label: string, action: () => Promise<unknown>) {
    try {
      await action();
    } catch (error) {
      console.log(`[TrayPopover:${label}] failed`, { error: String(error) });
    }
    void trayApi.mailChanged().catch(() => {});
    await queryClient.invalidateQueries({ queryKey: ["tray:snapshot"] });
  }

  const handleArchive = (accountId: string, threadId: string) =>
    runAction("archive", () =>
      gmailApi.modifyThread({ accountId, threadId, removeLabelIds: ["INBOX"] }),
    );

  const handleTrash = (accountId: string, threadId: string) =>
    runAction("trash", () => gmailApi.trashThread(accountId, threadId));

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl border border-border bg-canvas text-foreground">
      {/* Header: mailbox switcher, unread toggle, compose. */}
      <div className="flex h-11 shrink-0 items-center gap-1 border-b border-border px-(--sidebar-content-inset)">
        <div className="min-w-0 flex-1">
          {accounts.length > 0 ? (
            <MailboxSwitcher
              accounts={accounts}
              selectedAccountId={effectiveMailbox}
              onSelectAccount={setMailbox}
            />
          ) : (
            <span className="inline-flex items-baseline gap-1 px-(--sidebar-row-content-inset) text-sm font-medium tracking-tight">
              <span className="text-foreground">Otter</span>
              <span className="text-muted-foreground">Mail</span>
            </span>
          )}
        </div>
        <HintTooltip label={unreadOnly ? "Show all messages" : "Show unread only"} side="bottom">
          <button
            type="button"
            aria-pressed={unreadOnly}
            onClick={() => setUnreadOnly((v) => !v)}
            className={cn(
              buttonClass("ghost-muted", "xs"),
              "gap-1 font-medium tabular-nums",
              unreadOnly && "bg-accent-surface text-foreground",
            )}
          >
            Unread
            {totalUnread > 0 ? (
              <span className="text-muted-foreground">
                {totalUnread > 999 ? "999+" : totalUnread}
              </span>
            ) : null}
          </button>
        </HintTooltip>
        <HintTooltip label="New message" side="bottom">
          <IconBtn label="New message" onClick={() => void trayApi.compose()}>
            <SquarePenIcon className="size-4" />
          </IconBtn>
        </HintTooltip>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-(--sidebar-content-inset) py-1">
        {snapshotQuery.isLoading ? null : accounts.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-1 px-6 text-center">
            <span className="text-sm font-medium text-foreground">No accounts yet</span>
            <span className="text-xs text-muted-foreground">
              Open Otter Mail to connect a Gmail account.
            </span>
          </div>
        ) : rows.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-1 px-6 text-center">
            <span className="text-sm font-medium text-foreground">
              {unreadOnly ? "All caught up" : "No mail"}
            </span>
            <span className="text-xs text-muted-foreground">
              {unreadOnly ? "Nothing unread in the inbox." : "This inbox is empty."}
            </span>
          </div>
        ) : (
          rows.map(({ message, accountId, accountColor, accountName }) => (
            <InboxRow
              key={`${accountId}:${message.id}`}
              message={message}
              accountColor={accountColor}
              accountName={accountName}
              showAccountLabel={isCombined}
              onOpen={() => void trayApi.openThread(accountId, message.id)}
              onArchive={() => void handleArchive(accountId, message.threadId)}
              onTrash={() => void handleTrash(accountId, message.threadId)}
            />
          ))
        )}
      </div>

      {/* Footer utilities, like the main sidebar's bottom row. */}
      <div className="flex shrink-0 items-center gap-1 border-t border-border px-(--sidebar-content-inset) py-1">
        <HintTooltip label="Open Otter Mail">
          <IconBtn
            label="Open Otter Mail"
            onClick={() => void trayApi.openApp()}
            className="size-8"
          >
            <SquareArrowOutUpRightIcon className="size-4" />
          </IconBtn>
        </HintTooltip>
        <HintTooltip label={syncing ? "Syncing…" : "Sync now"}>
          <IconBtn
            label="Sync now"
            onClick={() => void handleSync()}
            disabled={syncing}
            className="size-8"
          >
            <RotateCwIcon className={syncing ? "size-4 animate-spin" : "size-4"} />
          </IconBtn>
        </HintTooltip>
        <span className="flex-1" />
        <HintTooltip label="Quit Otter Mail">
          <IconBtn
            label="Quit Otter Mail"
            onClick={() => void trayApi.quit()}
            className="size-8 hover:text-destructive"
          >
            <PowerIcon className="size-4" />
          </IconBtn>
        </HintTooltip>
      </div>
    </div>
  );
}
