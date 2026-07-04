import type { CSSProperties, ReactNode } from "react";
import { LayersIcon, PlusIcon } from "lucide-react";
import { HintTooltip } from "./te-ui";
import { COMBINED_ACCOUNT_ID } from "./custom-views";
import { getAccountColor, getAccountDisplayName } from "./account-style";
import type { GmailAccount } from "./types";

type WorkspaceRailProps = {
  accounts: GmailAccount[];
  selectedAccountId: string | null;
  onSelectAccount: (accountId: string) => void;
  onAddAccount: () => void;
};

/** Round hardware-button account switcher, like a row of panel knobs. */
function RailKnob({
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
          "flex size-9 shrink-0 items-center justify-center rounded-full text-[14px] font-bold text-white",
          selected
            ? "ring-2 ring-(--te-strong) ring-offset-2 ring-offset-(--te-frame)"
            : "opacity-80 hover:opacity-100",
        ].join(" ")}
        style={style}
      >
        {children}
      </button>
    </HintTooltip>
  );
}

/** Left device rail: Combined + one knob per Gmail account. */
export function WorkspaceRail({
  accounts,
  selectedAccountId,
  onSelectAccount,
  onAddAccount,
}: WorkspaceRailProps) {
  return (
    <div className="flex w-[60px] shrink-0 flex-col items-center gap-2.5 bg-(--te-frame) pb-3 pt-1">
      {accounts.length > 1 ? (
        <RailKnob
          label="Combined"
          hint="⌘1"
          selected={selectedAccountId === COMBINED_ACCOUNT_ID}
          onClick={() => onSelectAccount(COMBINED_ACCOUNT_ID)}
          style={{ backgroundColor: "var(--te-strong)", color: "var(--te-card)" }}
        >
          <LayersIcon className="size-4.5" />
        </RailKnob>
      ) : null}

      {accounts.map((account, i) => (
        <RailKnob
          key={account.id}
          label={getAccountDisplayName(account)}
          hint={accounts.length > 1 ? `⌘${i + 2}` : "⌘1"}
          selected={selectedAccountId === account.id}
          onClick={() => onSelectAccount(account.id)}
          style={{ backgroundColor: getAccountColor(account) }}
        >
          {(getAccountDisplayName(account)[0] ?? "?").toUpperCase()}
        </RailKnob>
      ))}

      <HintTooltip label="Add Gmail account">
        <button
          type="button"
          aria-label="Add Gmail account"
          onClick={onAddAccount}
          className="flex size-9 shrink-0 items-center justify-center rounded-full border border-(--te-outline) text-(--te-muted) hover:border-(--te-outline-hover) hover:text-(--te-strong)"
        >
          <PlusIcon className="size-4.5" />
        </button>
      </HintTooltip>
    </div>
  );
}
