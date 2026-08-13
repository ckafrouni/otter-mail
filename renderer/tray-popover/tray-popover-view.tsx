import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { injectActiveTheme } from "@glaze/core/components";
import { SquarePen, RotateCw, ExternalLink, Power } from "lucide-react";
import { SenderAvatar } from "../main/gmail/sender-avatar";
import { getAccountColor, getAccountDisplayName } from "../main/gmail/account-style";
import { decodeEntities } from "../main/gmail/text";
import { IconBtn, HintTooltip, UnreadPill } from "../main/gmail/te-ui";
import { TE_DARK_THEME, TE_LIGHT_THEME } from "../main/gmail/te-theme";
import { trayApi, type TrayAccountSnapshot } from "./api";
import type { GmailMessageSummary } from "../main/gmail/types";

const ALL_TAB = "__all__";

// Same TE glass skin as the main/message windows, following system appearance.
function applyTeTheme() {
  const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  injectActiveTheme(dark ? TE_DARK_THEME : TE_LIGHT_THEME);
}
applyTeTheme();

function formatRelativeDate(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return date.toLocaleDateString([], { weekday: "short" });
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

/** Circular colored tab, same shape as the main window's account switcher. */
function TabKnob({
  label,
  selected,
  onClick,
  background,
  children,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
  background: string;
  children: ReactNode;
}) {
  return (
    <HintTooltip label={label}>
      <button
        type="button"
        aria-label={label}
        onClick={onClick}
        className={[
          "flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white",
          selected ? "ring-2 ring-(--te-strong) ring-offset-1 ring-offset-(--te-frame)" : "opacity-75 hover:opacity-100",
        ].join(" ")}
        style={{ background }}
      >
        {children}
      </button>
    </HintTooltip>
  );
}

function InboxRow({
  message,
  accountColor,
  showAccountColor,
  onOpen,
}: {
  message: GmailMessageSummary;
  accountColor: string;
  showAccountColor: boolean;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-start gap-2 rounded-[6px] px-2 py-1.5 text-left hover:bg-(--te-hover)"
      style={showAccountColor ? { boxShadow: `inset 2px 0 0 ${accountColor}` } : undefined}
    >
      <SenderAvatar name={message.fromName} email={message.fromEmail} accountId={message.accountId} size="sm" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-[12.5px] font-semibold text-(--te-strong)">
            {message.fromName || message.fromEmail}
          </span>
          <span className="shrink-0 text-[10.5px] text-(--te-muted)">{formatRelativeDate(message.date)}</span>
        </div>
        <div className="truncate text-[12px] text-(--te-text)">{message.subject || "(no subject)"}</div>
        <div className="truncate text-[11.5px] text-(--te-muted)">{decodeEntities(message.snippet)}</div>
      </div>
    </button>
  );
}

/**
 * The tray popover's mini inbox: one tab per connected account (plus "All"
 * when there's more than one) showing that account's unread INBOX threads.
 * Opening a row hands off to the standalone message window; everything else
 * routes through main/handlers/tray-popover.ts.
 */
export function TrayPopoverView() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<string>(ALL_TAB);
  const [syncing, setSyncing] = useState(false);

  const snapshotQuery = useQuery({
    queryKey: ["tray:snapshot"],
    queryFn: () => trayApi.getSnapshot(),
  });

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTeTheme();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
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
      if (e.key === "Escape") void trayApi.hide();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const accounts = snapshotQuery.data?.accounts ?? [];
  const totalUnread = snapshotQuery.data?.totalUnread ?? 0;
  const showTabs = accounts.length > 1;
  const effectiveTab = showTabs ? activeTab : (accounts[0]?.account.id ?? ALL_TAB);

  const activeAccount: TrayAccountSnapshot | null = accounts.find((a) => a.account.id === effectiveTab) ?? null;

  const rows = useMemo(() => {
    if (effectiveTab === ALL_TAB || !activeAccount) {
      return accounts
        .flatMap((a) =>
          a.messages.map((message) => ({
            message,
            accountId: a.account.id,
            accountColor: getAccountColor(a.account),
          })),
        )
        .sort((a, b) => b.message.date - a.message.date)
        .slice(0, 25);
    }
    return activeAccount.messages.map((message) => ({
      message,
      accountId: activeAccount.account.id,
      accountColor: getAccountColor(activeAccount.account),
    }));
  }, [effectiveTab, activeAccount, accounts]);

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

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-[10px] bg-(--te-frame) text-(--te-text)">
      <div className="flex shrink-0 items-center justify-between px-3 pb-1 pt-3">
        <span className="te-label text-[13px] font-semibold text-(--te-strong)">OtterMail</span>
        <UnreadPill count={totalUnread} />
      </div>

      {showTabs ? (
        <div className="flex shrink-0 items-center px-3 pb-2">
          <div className="flex items-center gap-1 rounded-full border border-(--te-border) bg-(--te-ctl) p-1">
            <TabKnob
              label="All accounts"
              selected={activeTab === ALL_TAB}
              onClick={() => setActiveTab(ALL_TAB)}
              background="var(--te-strong)"
            >
              {totalUnread > 0 ? (totalUnread > 99 ? "99+" : totalUnread) : "—"}
            </TabKnob>
            {accounts.map((a) => (
              <TabKnob
                key={a.account.id}
                label={getAccountDisplayName(a.account)}
                selected={activeTab === a.account.id}
                onClick={() => setActiveTab(a.account.id)}
                background={getAccountColor(a.account)}
              >
                {(getAccountDisplayName(a.account)[0] ?? "?").toUpperCase()}
              </TabKnob>
            ))}
          </div>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-1.5">
        {accounts.length === 0 ? (
          <div className="flex h-full items-center justify-center px-4 text-center">
            <span className="text-[12.5px] text-(--te-muted)">No accounts connected.</span>
          </div>
        ) : rows.length === 0 ? (
          <div className="flex h-full items-center justify-center px-4 text-center">
            <span className="text-[12.5px] text-(--te-muted)">No unread mail.</span>
          </div>
        ) : (
          rows.map(({ message, accountId, accountColor }) => (
            <InboxRow
              key={`${accountId}:${message.id}`}
              message={message}
              accountColor={accountColor}
              showAccountColor={effectiveTab === ALL_TAB}
              onOpen={() => void trayApi.openThread(accountId, message.id)}
            />
          ))
        )}
      </div>

      <div className="flex shrink-0 items-center justify-between border-t border-(--te-border) px-2 py-1.5">
        <div className="flex items-center gap-0.5">
          <IconBtn label="New Message" onClick={() => void trayApi.compose()}>
            <SquarePen className="size-4" />
          </IconBtn>
          <IconBtn label="Synchronize All Mailboxes" onClick={() => void handleSync()} disabled={syncing}>
            <RotateCw className={syncing ? "size-4 animate-spin" : "size-4"} />
          </IconBtn>
        </div>
        <div className="flex items-center gap-0.5">
          <IconBtn label="Open OtterMail" onClick={() => void trayApi.openApp()}>
            <ExternalLink className="size-4" />
          </IconBtn>
          <IconBtn label="Quit" onClick={() => void trayApi.quit()}>
            <Power className="size-4" />
          </IconBtn>
        </div>
      </div>
    </div>
  );
}
