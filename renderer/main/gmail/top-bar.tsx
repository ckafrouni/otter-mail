import type { ReactNode, RefObject } from "react";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  CircleHelpIcon,
  LayersIcon,
  PlusIcon,
  SearchIcon,
  SettingsIcon,
  XIcon,
} from "lucide-react";
import { IconBtn, HintTooltip } from "./te-ui";
import { COMBINED_ACCOUNT_ID } from "./custom-views";
import { getAccountColor, getAccountDisplayName } from "./account-style";
import { gmailApi } from "./api";
import type { GmailAccount } from "./types";

type TopBarProps = {
  canGoBack: boolean;
  canGoForward: boolean;
  onBack: () => void;
  onForward: () => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  searchRef: RefObject<HTMLInputElement | null>;
  syncing: boolean;
  syncLabel: string;
  accounts: GmailAccount[];
  selectedAccountId: string | null;
  onSelectAccount: (accountId: string) => void;
  onAddAccount: () => void;
  onOpenHelp: () => void;
};

/** Round mailbox-switcher button, sized for the header row. */
function AccountKnob({
  label,
  hint,
  selected,
  onClick,
  children,
  background,
}: {
  label: string;
  hint?: string;
  selected?: boolean;
  onClick: () => void;
  children: ReactNode;
  background: string;
}) {
  return (
    <HintTooltip label={label} hint={hint}>
      <button
        type="button"
        aria-label={label}
        onClick={onClick}
        className={[
          "flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white",
          selected
            ? "ring-2 ring-(--te-strong) ring-offset-1 ring-offset-(--te-frame)"
            : "opacity-75 hover:opacity-100",
        ].join(" ")}
        style={{ background }}
      >
        {children}
      </button>
    </HintTooltip>
  );
}

export function TopBar({
  canGoBack,
  canGoForward,
  onBack,
  onForward,
  searchQuery,
  onSearchChange,
  searchRef,
  syncing,
  syncLabel,
  accounts,
  selectedAccountId,
  onSelectAccount,
  onAddAccount,
  onOpenHelp,
}: TopBarProps) {
  const isCombined = selectedAccountId === COMBINED_ACCOUNT_ID;

  return (
    <div
      data-toolbar=""
      className="drag-region flex h-11 shrink-0 items-center gap-1 bg-(--te-frame) pl-[84px] pr-2"
    >
      <IconBtn label="Back" disabled={!canGoBack} onClick={onBack} className="size-7">
        <ChevronLeftIcon className="size-4.5" />
      </IconBtn>
      <IconBtn label="Forward" disabled={!canGoForward} onClick={onForward} className="size-7">
        <ChevronRightIcon className="size-4.5" />
      </IconBtn>

      {/* Mailbox knobs: Combined + one per account, like the old left rail. */}
      <div className="flex shrink-0 items-center gap-1.5 px-2">
        {accounts.length > 1 ? (
          <AccountKnob
            label="Combined"
            hint="⌘1"
            selected={isCombined}
            onClick={() => onSelectAccount(COMBINED_ACCOUNT_ID)}
            background="var(--te-strong)"
          >
            <LayersIcon className="size-3.5" style={{ color: "var(--te-card)" }} />
          </AccountKnob>
        ) : null}
        {accounts.map((account, i) => (
          <AccountKnob
            key={account.id}
            label={getAccountDisplayName(account)}
            hint={accounts.length > 1 ? `⌘${i + 2}` : "⌘1"}
            selected={selectedAccountId === account.id}
            onClick={() => onSelectAccount(account.id)}
            background={getAccountColor(account)}
          >
            {(getAccountDisplayName(account)[0] ?? "?").toUpperCase()}
          </AccountKnob>
        ))}
        <HintTooltip label="Add Gmail account">
          <button
            type="button"
            aria-label="Add Gmail account"
            onClick={onAddAccount}
            className="flex size-6 shrink-0 items-center justify-center rounded-full border border-(--te-outline) text-(--te-muted) hover:border-(--te-outline-hover) hover:text-(--te-strong)"
          >
            <PlusIcon className="size-3.5" />
          </button>
        </HintTooltip>
      </div>

      <span className="te-label hidden pl-1 text-(--te-muted) min-[840px]:block">
        gmail inbox
      </span>

      <div className="flex min-w-0 flex-1 justify-center px-4">
        <div className="relative w-full max-w-[600px]">
          <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-(--te-faint)" />
          <input
            ref={searchRef}
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                onSearchChange("");
                e.currentTarget.blur();
              }
            }}
            placeholder={isCombined ? "Search all mailboxes" : "Search mail"}
            className="h-7 w-full rounded-[5px] border border-(--te-outline) bg-(--te-panel) pl-8 pr-8 text-[13px] text-(--te-strong) outline-none placeholder:text-(--te-faint) hover:border-(--te-outline-hover) focus:border-(--te-outline-hover)"
            aria-label="Search mail"
          />
          {searchQuery ? (
            <button
              type="button"
              onClick={() => onSearchChange("")}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-(--te-faint) hover:text-(--te-strong)"
            >
              <XIcon className="size-3.5" />
            </button>
          ) : null}
        </div>
      </div>

      {syncing ? (
        <div className="flex min-w-0 items-center gap-1.5 pr-1">
          <span className="te-blink size-1.5 shrink-0 bg-(--te-accent)" aria-hidden />
          <span className="te-label max-w-40 truncate text-(--te-muted)">{syncLabel}</span>
        </div>
      ) : null}

      <HintTooltip label="Keyboard shortcuts" hint="?">
        <IconBtn label="Help" onClick={onOpenHelp} className="size-7">
          <CircleHelpIcon className="size-4" />
        </IconBtn>
      </HintTooltip>

      <HintTooltip label="Settings" hint="⌘,">
        <IconBtn
          label="Open Settings"
          onClick={() => void gmailApi.openSettings({ pane: "general" })}
          className="size-7"
        >
          <SettingsIcon className="size-4" />
        </IconBtn>
      </HintTooltip>

    </div>
  );
}
