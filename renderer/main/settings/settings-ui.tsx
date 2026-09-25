import { forwardRef, type ComponentProps, type ReactNode } from "react";
import { Undo2Icon } from "lucide-react";
import { cn, HintTooltip } from "../gmail/ui";

/** Shared settings card surface, with separators between rows. */
export function SettingsGroup({
  variant = "grouped",
  divided = true,
  className,
  ...props
}: ComponentProps<"div"> & { variant?: "grouped" | "plain"; divided?: boolean }) {
  return (
    <div
      {...props}
      className={cn(
        "relative overflow-visible text-foreground",
        variant === "grouped"
          ? "rounded-xl border border-border/60 bg-card/40 shadow-xs/5"
          : "space-y-1",
        variant === "grouped" &&
          divided &&
          "[&>*+*]:border-t [&>*+*]:border-border/50 [&>[data-slot=settings-row]]:rounded-none",
        className,
      )}
    />
  );
}

/** A titled group of rows. */
export function SettingsSection({
  title,
  icon,
  headerAction,
  variant = "grouped",
  children,
  className,
  ...props
}: Omit<ComponentProps<"section">, "title"> & {
  title: string;
  icon?: ReactNode;
  headerAction?: ReactNode;
  variant?: "grouped" | "plain";
  children: ReactNode;
}) {
  return (
    <section {...props} className={cn("space-y-2.5", className)}>
      <div className="flex min-h-7 items-start justify-between gap-4 px-3 sm:px-4">
        <div className="min-w-0">
          <h2 className="flex min-h-7 items-center gap-2 text-sm font-normal text-foreground/70">
            {icon}
            {title}
          </h2>
        </div>
        <div className="flex min-h-7 min-w-7 items-center justify-end">{headerAction}</div>
      </div>
      <SettingsGroup variant={variant}>{children}</SettingsGroup>
    </section>
  );
}

/**
 * One setting: title + description on the left, the control on the right.
 * Children render below the row (expanded editors, lists).
 */
export function SettingsRow({
  title,
  description,
  status,
  control,
  resetAction,
  children,
  className,
  ...props
}: Omit<ComponentProps<"div">, "title"> & {
  title: ReactNode;
  description?: ReactNode;
  status?: ReactNode;
  control?: ReactNode;
  /** Shown beside the title while the setting differs from its default. */
  resetAction?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div
      {...props}
      data-slot="settings-row"
      className={cn(
        "@container/settings-row rounded-xl px-3 sm:px-4",
        children ? "pt-3 pb-1" : "py-3",
        className,
      )}
    >
      <div className="flex flex-col gap-3 @min-[32rem]/settings-row:grid @min-[32rem]/settings-row:grid-cols-[minmax(0,1fr)_minmax(10rem,auto)] @min-[32rem]/settings-row:items-center @min-[32rem]/settings-row:gap-8">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex min-h-5 items-center gap-1.5">
            <h3 className="text-sm font-medium text-foreground">{title}</h3>
            {resetAction ? (
              <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center">
                {resetAction}
              </span>
            ) : null}
          </div>
          {description ? (
            <p className="max-w-xl text-xs leading-normal text-muted-foreground/80">
              {description}
            </p>
          ) : null}
          {status ? <div className="pt-0.5 text-xs text-muted-foreground">{status}</div> : null}
        </div>
        {control ? (
          <div className="flex w-full min-w-0 shrink-0 items-center gap-2 @min-[32rem]/settings-row:w-auto @min-[32rem]/settings-row:justify-end">
            {control}
          </div>
        ) : null}
      </div>
      {children}
    </div>
  );
}

/** Small undo button that puts one setting back to its default. */
export function SettingResetButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <HintTooltip label="Reset to default">
      <button
        type="button"
        aria-label={`Reset ${label} to default`}
        onClick={(event) => {
          event.stopPropagation();
          onClick();
        }}
        className="inline-flex size-5 cursor-pointer items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-accent-surface hover:text-foreground focus-visible:ring-2 focus-visible:ring-focus-ring"
      >
        <Undo2Icon className="size-3" />
      </button>
    </HintTooltip>
  );
}

/** Scrollable page body with the settings column width. */
export function SettingsPageContainer({ className, ...props }: ComponentProps<"div">) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div
        {...props}
        className={cn("mx-auto w-full max-w-3xl space-y-8 px-4 pb-16 pt-4 sm:px-6", className)}
      />
    </div>
  );
}

/** Text input in the app's control style (small size). */
export const TextInput = forwardRef<HTMLInputElement, ComponentProps<"input">>(function TextInput(
  { className, ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      {...props}
      className={cn(
        "h-7.5 w-full min-w-0 rounded-lg border border-input bg-canvas px-[calc(--spacing(2.5)-1px)] text-sm text-foreground shadow-xs/5 outline-none transition-shadow placeholder:text-placeholder focus-visible:border-focus-ring focus-visible:ring-[3px] focus-visible:ring-focus-ring/24 disabled:opacity-64 dark:bg-input/32",
        className,
      )}
    />
  );
});
