import { Badge } from "@glaze/core/components";
import type { GmailLabel } from "./types";

export function LabelChip({ label }: { label: GmailLabel }) {
  const displayName = label.name.split("/").pop() ?? label.name;
  if (label.color) {
    return (
      <span
        className="inline-flex w-fit shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-pill text-small-strong px-1.5 py-0.5"
        style={{
          backgroundColor: label.color.backgroundColor,
          color: label.color.textColor,
        }}
      >
        {displayName}
      </span>
    );
  }
  return <Badge color="secondary">{displayName}</Badge>;
}
