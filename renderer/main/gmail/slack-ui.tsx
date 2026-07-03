import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Tooltip, TooltipTrigger, TooltipContent } from "@glaze/core/components";

/** Ghost icon button used across the Slack-style chrome. */
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
        "flex size-8 shrink-0 items-center justify-center rounded-lg",
        "disabled:opacity-35 disabled:pointer-events-none",
        active
          ? "bg-(--sk-selblue) text-(--sk-sel-fg)"
          : "text-(--sk-muted) hover:bg-(--sk-hover) hover:text-(--sk-strong)",
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

/** Slack-style unread count pill, contrast-inverted against the current theme. */
export function UnreadPill({ count, selected }: { count: number; selected?: boolean }) {
  if (count <= 0) return null;
  return (
    <span
      className={[
        "ml-auto flex h-[18px] min-w-[20px] shrink-0 items-center justify-center rounded-full px-1.5",
        "text-[11px] font-bold tabular-nums",
        selected
          ? "bg-(--sk-selected-fg)/85 text-(--sk-selected)"
          : "bg-(--sk-badge-bg) text-(--sk-badge-fg)",
      ].join(" ")}
    >
      {count > 999 ? "999+" : count}
    </span>
  );
}
