import { Badge } from "@glaze/core/components";
import type { GmailLabel } from "./types";

/**
 * Colored pill for a label. Uncolored labels normally use the neutral Badge,
 * but on a selected (accent-filled) row that is nearly invisible — `selected`
 * switches them to a translucent selection-foreground pill instead.
 */
export function LabelChip({ label, selected }: { label: GmailLabel; selected?: boolean }) {
  const displayName = label.name.split("/").pop() ?? label.name;
  const pill =
    "inline-flex w-fit shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-pill text-small-strong px-1.5 py-0.5";
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
