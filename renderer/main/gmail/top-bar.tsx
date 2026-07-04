import type { RefObject } from "react";
import { ChevronLeftIcon, ChevronRightIcon, CircleHelpIcon, SearchIcon, XIcon } from "lucide-react";
import { IconBtn, HintTooltip } from "./te-ui";
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
      className="drag-region flex h-11 shrink-0 items-center gap-1 bg-(--te-frame) pl-[84px] pr-2"
    >
      <IconBtn label="Back" disabled={!canGoBack} onClick={onBack} className="size-7">
        <ChevronLeftIcon className="size-4.5" />
      </IconBtn>
      <IconBtn label="Forward" disabled={!canGoForward} onClick={onForward} className="size-7">
        <ChevronRightIcon className="size-4.5" />
      </IconBtn>

      <span className="te-label hidden pl-2 text-(--te-muted) min-[720px]:block">
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

    </div>
  );
}
