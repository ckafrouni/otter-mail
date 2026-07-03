import type { RefObject } from "react";
import { ChevronLeftIcon, ChevronRightIcon, CircleHelpIcon, SearchIcon, XIcon } from "lucide-react";
import { IconBtn, HintTooltip } from "./slack-ui";
import { COMBINED_ACCOUNT_ID } from "./custom-views";

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
  selectedAccountId: string | null;
  onOpenHelp: () => void;
};

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
  selectedAccountId,
  onOpenHelp,
}: TopBarProps) {
  const isCombined = selectedAccountId === COMBINED_ACCOUNT_ID;

  return (
    <div
      data-toolbar=""
      className="drag-region flex h-11 shrink-0 items-center gap-1 bg-(--sk-frame) pl-[84px] pr-2"
    >
      <IconBtn label="Back" disabled={!canGoBack} onClick={onBack} className="size-7">
        <ChevronLeftIcon className="size-4.5" />
      </IconBtn>
      <IconBtn label="Forward" disabled={!canGoForward} onClick={onForward} className="size-7">
        <ChevronRightIcon className="size-4.5" />
      </IconBtn>

      <div className="flex min-w-0 flex-1 justify-center px-4">
        <div className="relative w-full max-w-[600px]">
          <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-(--sk-faint)" />
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
            className="h-7 w-full rounded-md bg-(--sk-ctl) pl-8 pr-8 text-[13px] text-(--sk-strong) outline-none placeholder:text-(--sk-faint) hover:bg-(--sk-ctl-hover) focus:bg-(--sk-ctl-hover) focus:ring-1 focus:ring-(--sk-outline-hover)"
            aria-label="Search mail"
          />
          {searchQuery ? (
            <button
              type="button"
              onClick={() => onSearchChange("")}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-(--sk-faint) hover:text-(--sk-strong)"
            >
              <XIcon className="size-3.5" />
            </button>
          ) : null}
        </div>
      </div>

      {syncing ? (
        <div className="flex min-w-0 items-center gap-1.5 pr-1">
          <span className="size-3 shrink-0 animate-spin rounded-full border-2 border-(--sk-muted) border-t-transparent" />
          <span className="max-w-40 truncate text-[11px] text-(--sk-muted)">{syncLabel}</span>
        </div>
      ) : null}

      <HintTooltip label="Keyboard shortcuts" hint="?">
        <IconBtn label="Help" onClick={onOpenHelp} className="size-7">
          <CircleHelpIcon className="size-4" />
        </IconBtn>
      </HintTooltip>

    </div>
  );
}
