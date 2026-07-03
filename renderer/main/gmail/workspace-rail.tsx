import type { CSSProperties, ReactNode } from "react";
import { LayersIcon, PlusIcon, SettingsIcon } from "lucide-react";
import { HintTooltip } from "./slack-ui";
import { COMBINED_ACCOUNT_ID } from "./custom-views";
import { getAccountColor, getAccountDisplayName } from "./account-style";
import { gmailApi } from "./api";
import type { GmailAccount } from "./types";

type WorkspaceRailProps = {
  accounts: GmailAccount[];
  selectedAccountId: string | null;
  onSelectAccount: (accountId: string) => void;
  onAddAccount: () => void;
};

function RailTile({
  label,
  hint,
  selected,
  onClick,
  children,
  style,
}: {
  label: string;
  hint?: string;
  selected?: boolean;
  onClick: () => void;
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <HintTooltip label={label} hint={hint}>
      <button
        type="button"
        aria-label={label}
        onClick={onClick}
        className={[
          "flex size-9 shrink-0 items-center justify-center rounded-lg text-[15px] font-bold text-white",
          selected
            ? "ring-2 ring-(--sk-strong) ring-offset-2 ring-offset-(--sk-frame)"
            : "opacity-80 hover:opacity-100",
        ].join(" ")}
        style={style}
      >
        {children}
      </button>
    </HintTooltip>
  );
}

/** Slack-style workspace rail: Combined + one tile per Gmail account. */
export function WorkspaceRail({
  accounts,
  selectedAccountId,
  onSelectAccount,
  onAddAccount,
}: WorkspaceRailProps) {
  return (
    <div className="flex w-[60px] shrink-0 flex-col items-center gap-2.5 bg-(--sk-frame) pb-3 pt-1">
      {accounts.length > 1 ? (
        <RailTile
          label="Combined"
          hint="⌘1"
          selected={selectedAccountId === COMBINED_ACCOUNT_ID}
          onClick={() => onSelectAccount(COMBINED_ACCOUNT_ID)}
          style={{ background: "linear-gradient(135deg, #36c5f0 0%, #1164a3 100%)" }}
        >
          <LayersIcon className="size-4.5" />
        </RailTile>
      ) : null}

      {accounts.map((account, i) => (
        <RailTile
          key={account.id}
          label={getAccountDisplayName(account)}
          hint={accounts.length > 1 ? `⌘${i + 2}` : "⌘1"}
          selected={selectedAccountId === account.id}
          onClick={() => onSelectAccount(account.id)}
          style={{ backgroundColor: getAccountColor(account) }}
        >
          {(getAccountDisplayName(account)[0] ?? "?").toUpperCase()}
        </RailTile>
      ))}

      <HintTooltip label="Add Gmail account">
        <button
          type="button"
          aria-label="Add Gmail account"
          onClick={onAddAccount}
          className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-(--sk-ctl) text-(--sk-muted) hover:bg-(--sk-ctl-hover) hover:text-(--sk-strong)"
        >
          <PlusIcon className="size-4.5" />
        </button>
      </HintTooltip>

      <div className="flex-1" />

      <HintTooltip label="Settings" hint="⌘,">
        <button
          type="button"
          aria-label="Open Settings"
          onClick={() => void gmailApi.openSettings({ pane: "general" })}
          className="flex size-9 shrink-0 items-center justify-center rounded-lg text-(--sk-muted) hover:bg-(--sk-hover) hover:text-(--sk-strong)"
        >
          <SettingsIcon className="size-5" />
        </button>
      </HintTooltip>
    </div>
  );
}
