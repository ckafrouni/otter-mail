import { Badge } from "@glaze/core/components";
import { InboxIcon } from "lucide-react";
import type { GmailLabel } from "./types";

const PILL =
  "inline-flex w-fit shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-pill text-small-strong px-1.5 py-0.5";

/** "Still in the inbox" marker, shown when browsing non-inbox views. */
export function InboxChip({ selected }: { selected?: boolean }) {
  return (
    <span
      className={`${PILL} ${
        selected ? "bg-(--sk-sel-fg)/25 text-(--sk-sel-fg)" : "bg-(--sk-ctl) text-(--sk-muted)"
      }`}
    >
      <InboxIcon className="size-3" />
      Inbox
    </span>
  );
}

/**
 * Colored pill for a label. Uncolored labels normally use the neutral Badge,
 * but on a selected (accent-filled) row that is nearly invisible — `selected`
 * switches them to a translucent selection-foreground pill instead.
 */
export function LabelChip({ label, selected }: { label: GmailLabel; selected?: boolean }) {
  const displayName = label.name.split("/").pop() ?? label.name;
  const pill = PILL;
  if (label.color) {
    return (
      <span
        className={pill}
        style={{
          backgroundColor: label.color.backgroundColor,
          color: label.color.textColor,
        }}
      >
        {displayName}
      </span>
    );
  }
  if (selected) {
    return (
      <span className={`${pill} bg-(--sk-sel-fg)/25 text-(--sk-sel-fg)`}>{displayName}</span>
    );
  }
  return <Badge color="secondary">{displayName}</Badge>;
}
