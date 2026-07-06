import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Tooltip, TooltipTrigger, TooltipContent } from "@glaze/core/components";

/** Ghost icon button used across the TE-style chrome. */
export const IconBtn = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean }
>(function IconBtn({ label, active, className, children, ...props }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      className={[
        "flex size-7 shrink-0 items-center justify-center rounded-[5px]",
        "disabled:opacity-35 disabled:pointer-events-none",
        active
          ? "bg-(--te-sel) text-(--te-sel-fg)"
          : "text-(--te-muted) hover:bg-(--te-hover) hover:text-(--te-strong)",
        className ?? "",
      ].join(" ")}
      {...props}
    >
      {children}
    </button>
  );
});

export function HintTooltip({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent>
        <span className="flex items-center gap-1.5">
          {label}
          {hint ? <span className="opacity-60">{hint}</span> : null}
        </span>
      </TooltipContent>
    </Tooltip>
  );
}

/** Unread count: a bare monospaced numeral in the brand color. */
export function UnreadPill({ count, selected }: { count: number; selected?: boolean }) {
  if (count <= 0) return null;
  return (
    <span
      className={[
        "te-num ml-auto shrink-0 text-[11px]",
        selected ? "text-(--te-selected-fg)" : "text-(--te-badge-bg)",
      ].join(" ")}
    >
      {count > 999 ? "999+" : count}
    </span>
  );
}
