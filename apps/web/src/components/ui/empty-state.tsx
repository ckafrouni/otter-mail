import type * as React from "react";

import { cn } from "~/lib/utils";

/**
 * Centered placeholder for an empty screen: a title, a line of explanation,
 * and optional actions (layout adapted from Otter Code's components/ui/empty.tsx).
 */
function EmptyState({
  title,
  description,
  actions,
  media,
  className,
  children,
  ...props
}: Omit<React.ComponentProps<"div">, "title"> & {
  title?: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  media?: React.ReactNode;
}) {
  return (
    <div
      data-slot="empty-state"
      className={cn(
        "flex min-w-0 flex-col items-center justify-center gap-5 p-6 text-center text-balance",
        className,
      )}
      {...props}
    >
      {media ? <div className="flex items-center justify-center">{media}</div> : null}
      {title || description ? (
        <div className="flex max-w-sm flex-col items-center gap-1.5">
          {title ? (
            <h1 className="text-2xl leading-[30px] font-normal tracking-[-0.01em] text-foreground">
              {title}
            </h1>
          ) : null}
          {description ? (
            <p className="text-[13px] leading-[18px] text-muted-foreground">{description}</p>
          ) : null}
        </div>
      ) : null}
      {actions ? <div className="flex flex-col items-center gap-2">{actions}</div> : null}
      {children}
    </div>
  );
}

export { EmptyState };
