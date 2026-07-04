import { Badge } from "@glaze/core/components";
import { ChevronsRightIcon, InboxIcon } from "lucide-react";
import type { GmailLabel } from "./types";

const PILL =
  "inline-flex w-fit shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-pill text-small-strong px-1.5 py-0.5";

/** Gmail's category tabs, chipped in the reader header with Gmail's colors. */
const CATEGORY_CHIPS: Record<string, { name: string; bg: string }> = {
  CATEGORY_SOCIAL: { name: "Social", bg: "#1a73e8" },
  CATEGORY_PROMOTIONS: { name: "Promotions", bg: "#188038" },
  CATEGORY_UPDATES: { name: "Updates", bg: "#e37400" },
  CATEGORY_FORUMS: { name: "Forums", bg: "#7627bb" },
};

export function CategoryChip({ id }: { id: string }) {
  const meta = CATEGORY_CHIPS[id];
  if (!meta) return null;
  return (
    <span className={PILL} style={{ backgroundColor: meta.bg, color: "#ffffff" }}>
      {meta.name}
    </span>
  );
}

export function isCategoryLabelId(id: string): boolean {
  return id in CATEGORY_CHIPS;
}

/** Gmail's yellow importance marker. */
export function ImportantMarker() {
  return (
    <span title="Marked important" aria-label="Important" className="shrink-0">
      <ChevronsRightIcon className="size-3.5" strokeWidth={3} style={{ color: "#f4b400" }} />
    </span>
  );
}

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
