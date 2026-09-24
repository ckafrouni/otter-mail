import { useEffect, useState, type ReactNode } from "react";
import { DropdownMenu as RadixMenu } from "radix-ui";
import {
  CheckIcon,
  ChevronDownIcon,
  LayersIcon,
  PanelLeftCloseIcon,
  PanelLeftIcon,
  PanelRightIcon,
} from "lucide-react";
import { IconBtn, HintTooltip, buttonClass, cn, restoreFocusForKeyboardOnly } from "./ui";
import { COMBINED_ACCOUNT_ID } from "./custom-views";
import { getAccountColor, getAccountDisplayName } from "./account-style";
import { gmailApi } from "./api";
import type { GmailAccount } from "./types";
import type { KeybindingCommand } from "../keybindings/commands";
import { shortcutLabelFor, useKeybindingsState } from "../keybindings/store";

/**
 * Every column owns the slice of the title band above it, so the pane
 * separators run all the way up. These pieces fill those slices: the window
 * title (traffic lights, sidebar toggle, wordmark), the mailbox breadcrumb,
 * and the right-hand controls.
 */

/** Traffic-light clearance + sidebar toggle + wordmark. */
export function WindowTitle({
  sidebarOpen,
  onToggleSidebar,
  className,
}: {
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "drag-region flex h-(--workspace-topbar-height) shrink-0 items-center gap-2 pl-[84px] pr-3",
        className,
      )}
    >
      <HintTooltip label={sidebarOpen ? "Hide sidebar" : "Show sidebar"} shortcut="sidebar.toggle">
        <IconBtn label="Toggle sidebar" onClick={onToggleSidebar}>
          {sidebarOpen ? (
            <PanelLeftCloseIcon className="size-4" />
          ) : (
            <PanelLeftIcon className="size-4" />
          )}
        </IconBtn>
      </HintTooltip>
      {/* Wordmark in Otter Code's style: brand word, then the product muted. */}
      <span className="inline-flex min-w-0 select-none items-baseline gap-1 whitespace-nowrap text-sm font-medium tracking-tight">
        <span className="text-foreground">Otter</span>
        <span className="truncate text-muted-foreground">Mail</span>
      </span>
    </div>
  );
}

/** Small square mark for a mailbox, like a project favicon in the breadcrumb. */
function MailboxMark({ account, className }: { account: GmailAccount | null; className?: string }) {
  if (!account) {
    return <LayersIcon className={cn("size-4 shrink-0", className)} aria-hidden />;
  }
  return (
    <span
      className={cn(
        "flex size-4 shrink-0 items-center justify-center rounded-[4px] text-[9px] font-bold leading-none text-white",
        className,
      )}
      style={{ background: getAccountColor(account) }}
      aria-hidden
    >
      {(getAccountDisplayName(account)[0] ?? "?").toUpperCase()}
    </span>
  );
}

/** Mailbox switcher row for the sidebar; aligned with the rows below it. */
export function MailboxSwitcher({
  accounts,
  selectedAccountId,
  onSelectAccount,
  className,
}: {
  accounts: GmailAccount[];
  selectedAccountId: string | null;
  onSelectAccount: (accountId: string) => void;
  className?: string;
}) {
  const { resolved: keybindings } = useKeybindingsState();
  const jump = (digit: number) =>
    shortcutLabelFor(keybindings, `mailbox.jump.${digit}` as KeybindingCommand) ?? "";
  const isCombined = selectedAccountId === COMBINED_ACCOUNT_ID;
  const selectedAccount = isCombined
    ? null
    : (accounts.find((a) => a.id === selectedAccountId) ?? null);
  const mailboxName = isCombined
    ? "All mailboxes"
    : selectedAccount
      ? getAccountDisplayName(selectedAccount)
      : "Mailbox";
  const options: { id: string; account: GmailAccount | null; name: string; shortcut: string }[] = [
    ...(accounts.length > 1
      ? [{ id: COMBINED_ACCOUNT_ID, account: null, name: "All mailboxes", shortcut: jump(1) }]
      : []),
    ...accounts.map((account, i) => ({
      id: account.id,
      account,
      name: getAccountDisplayName(account),
      shortcut: jump(accounts.length > 1 ? i + 2 : 1),
    })),
  ];

  return (
    <RadixMenu.Root>
      <RadixMenu.Trigger asChild>
        <button
          type="button"
          aria-label="Switch mailbox"
          className={cn(
            "group/switcher flex h-8 w-full min-w-0 cursor-pointer items-center gap-(--sidebar-control-gap) rounded-[var(--control-radius)] px-(--sidebar-row-content-inset) text-left text-sm font-medium text-sidebar-foreground outline-none transition-colors hover:bg-sidebar-row-hover focus-visible:ring-2 focus-visible:ring-focus-ring data-[state=open]:bg-sidebar-row-hover",
            className,
          )}
        >
          <span className="flex size-4 shrink-0 items-center justify-center">
            <MailboxMark account={selectedAccount} className="text-(--sidebar-icon-color)" />
          </span>
          <span className="min-w-0 flex-1 truncate">{mailboxName}</span>
          <ChevronDownIcon
            className="size-3.5 shrink-0 text-(--sidebar-icon-color) transition-transform group-data-[state=open]/switcher:rotate-180"
            aria-hidden
          />
        </button>
      </RadixMenu.Trigger>
      <RadixMenu.Portal>
        <RadixMenu.Content
          align="start"
          sideOffset={4}
          onCloseAutoFocus={restoreFocusForKeyboardOnly}
          className="dropdown-glass z-[130] w-(--radix-dropdown-menu-trigger-width) min-w-52 rounded-lg p-1 text-foreground shadow-[0_16px_40px_-18px_rgb(0_0_0/55%)] outline-none dark:shadow-[0_18px_44px_-18px_rgb(0_0_0/80%)]"
        >
          {options.map((option) => {
            const selected = option.id === (selectedAccountId ?? "");
            return (
              <RadixMenu.Item
                key={option.id}
                onSelect={() => onSelectAccount(option.id)}
                className={cn(
                  "flex min-h-7 cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1 text-sm outline-none data-[highlighted]:bg-accent-surface data-[highlighted]:text-foreground",
                  selected && "bg-foreground/[0.08]",
                )}
              >
                <span className="flex size-4 shrink-0 items-center justify-center">
                  <MailboxMark account={option.account} className="text-muted-foreground" />
                </span>
                <span className="min-w-0 flex-1 truncate">{option.name}</span>
                {selected ? (
                  <CheckIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                ) : null}
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  {option.shortcut}
                </span>
              </RadixMenu.Item>
            );
          })}
        </RadixMenu.Content>
      </RadixMenu.Portal>
    </RadixMenu.Root>
  );
}

/**
 * Outline nudge shown only while Otter Mail is not the macOS default mail app;
 * clicking asks the OS (consent dialog) and the button hides once granted.
 */
function DefaultMailButton() {
  const [isDefault, setIsDefault] = useState<boolean | null>(null);

  const refresh = async () => {
    try {
      const status = await gmailApi.getDefaultMailStatus();
      setIsDefault(status.isDefault);
    } catch (err) {
      console.log("[TopBar:defaultMailStatus] failed", { error: String(err) });
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  if (isDefault !== false) return null;

  const request = async () => {
    console.log("[TopBar:setDefaultMailApp]");
    try {
      await gmailApi.setDefaultMailApp();
    } catch (err) {
      console.log("[TopBar:setDefaultMailApp] failed", { error: String(err) });
    }
    void refresh();
  };

  return (
    <HintTooltip label="Use Otter Mail for email links">
      <button type="button" onClick={() => void request()} className={buttonClass("outline", "xs")}>
        Set as default
      </button>
    </HintTooltip>
  );
}

/**
 * Right end of the content column's title band: default-mail nudge and the
 * Hermes panel toggle. Views that own the band (the reader) render it at the
 * end of their own header so the toggle never moves.
 */
export function TitleTrailing({
  showPanelToggle,
  onToggleChat,
}: {
  showPanelToggle: boolean;
  onToggleChat: () => void;
}) {
  return (
    <>
      <DefaultMailButton />
      {showPanelToggle ? (
        <HintTooltip label="Show Hermes panel" shortcut="assistant.toggle" side="bottom">
          <IconBtn label="Toggle Hermes panel" onClick={onToggleChat}>
            <PanelRightIcon className="size-4" />
          </IconBtn>
        </HintTooltip>
      ) : null}
    </>
  );
}

/** Title band of the content column: optional breadcrumb, sync status, trailing controls. */
export function TitleControls({
  leading,
  syncing,
  syncLabel,
  showPanelToggle,
  onToggleChat,
}: {
  leading?: ReactNode;
  syncing: boolean;
  syncLabel: string;
  showPanelToggle: boolean;
  onToggleChat: () => void;
}) {
  return (
    <div
      data-toolbar=""
      className="drag-region flex h-(--workspace-topbar-height) shrink-0 items-center gap-3 px-4"
    >
      {leading}
      {syncing ? (
        <div className="flex min-w-0 items-center gap-1.5">
          <span
            className="size-1.5 shrink-0 rounded-full bg-primary animate-status-pulse"
            aria-hidden
          />
          <span className="max-w-64 truncate text-xs text-muted-foreground">{syncLabel}</span>
        </div>
      ) : null}
      <span className="min-w-0 flex-1" />
      <TitleTrailing showPanelToggle={showPanelToggle} onToggleChat={onToggleChat} />
    </div>
  );
}
