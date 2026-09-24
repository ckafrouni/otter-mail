import type { CSSProperties } from "react";
import { ChevronsRightIcon, InboxIcon, XIcon } from "lucide-react";
import type { GmailLabel } from "./types";

/** Badge chrome shared by every chip (Otter Code's `Badge`, size sm). */
const PILL =
  "group relative inline-flex h-4.5 w-fit max-w-32 shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-sm border px-1 text-2xs font-medium leading-none";

/** Neutral outline chip. */
const OUTLINE = "border-input bg-canvas text-muted-foreground dark:bg-input/32";

/**
 * Tinted chip driven by a `--label` color: a faint wash of the label over the
 * surface and text that leans towards it, so colored labels stay quiet next
 * to the list copy (Otter Code's `label` badge variant).
 */
const TINTED =
  "border-transparent bg-[color-mix(in_srgb,var(--label)_8%,transparent)] text-[color-mix(in_srgb,var(--label)_30%,var(--foreground))] dark:bg-[color-mix(in_srgb,var(--label)_12%,transparent)] dark:text-[color-mix(in_srgb,var(--label)_45%,var(--foreground))]";

function tint(color: string): CSSProperties {
  return { "--label": color } as CSSProperties;
}

/** Hover-revealed remove control: overlays the chip's right edge (bg-inherit
    paints over the text below), so the chip never changes size. */
function RemoveButton({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={(e) => {
        e.stopPropagation();
        onRemove();
      }}
      className="absolute inset-y-0 right-0 hidden w-4 items-center justify-center rounded-r-sm bg-inherit group-hover:flex"
    >
      <XIcon className="size-2.5" strokeWidth={3} />
    </button>
  );
}

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
    <span className={`${PILL} ${TINTED}`} style={tint(meta.bg)}>
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

/** "Still in the inbox" marker, shown when browsing non-inbox views.
    `onRemove` (reader header) reveals a hover ✕ that archives. */
export function InboxChip({ selected, onRemove }: { selected?: boolean; onRemove?: () => void }) {
  return (
    <span className={`${PILL} ${OUTLINE} ${selected ? "border-foreground/20" : ""}`}>
      <InboxIcon className="size-3" />
      Inbox
      {onRemove ? <RemoveButton label="Archive" onRemove={onRemove} /> : null}
    </span>
  );
}

/**
 * Chip for a label: tinted with the label's Gmail color, or a neutral outline
 * when the label has none. Selection only firms up the outline, since the
 * selected row is a quiet surface rather than a filled block.
 */
export function LabelChip({
  label,
  selected,
  onRemove,
}: {
  label: GmailLabel;
  selected?: boolean;
  onRemove?: () => void;
}) {
  const displayName = label.name.split("/").pop() ?? label.name;
  const remove = onRemove ? (
    <RemoveButton label={`Remove "${displayName}"`} onRemove={onRemove} />
  ) : null;
  const text = <span className="min-w-0 truncate">{displayName}</span>;
  if (label.color) {
    return (
      <span className={`${PILL} ${TINTED}`} style={tint(label.color.backgroundColor)}>
        {text}
        {remove}
      </span>
    );
  }
  return (
    <span className={`${PILL} ${OUTLINE} ${selected ? "border-foreground/20" : ""}`}>
      {text}
      {remove}
    </span>
  );
}
