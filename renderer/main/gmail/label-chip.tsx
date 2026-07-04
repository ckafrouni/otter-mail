import { ChevronsRightIcon, InboxIcon } from "lucide-react";
import type { GmailLabel } from "./types";

const PILL =
  "te-label inline-flex w-fit shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-[3px] px-1.5 py-0.5 leading-none";

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
        selected
          ? "bg-(--te-sel-fg)/25 text-(--te-sel-fg)"
          : "border border-(--te-outline) text-(--te-muted)"
      }`}
    >
      <InboxIcon className="size-3" />
      Inbox
    </span>
  );
}

/**
 * Colored chip for a label. Uncolored labels get a hairline outline, but on a
 * selected (accent-filled) row that is nearly invisible — `selected` switches
 * them to a translucent selection-foreground fill instead.
 */
export function LabelChip({ label, selected }: { label: GmailLabel; selected?: boolean }) {
  const displayName = label.name.split("/").pop() ?? label.name;
  if (label.color) {
    return (
      <span
        className={PILL}
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
      <span className={`${PILL} bg-(--te-sel-fg)/25 text-(--te-sel-fg)`}>{displayName}</span>
    );
  }
  return (
    <span className={`${PILL} border border-(--te-outline) text-(--te-muted)`}>{displayName}</span>
  );
}
