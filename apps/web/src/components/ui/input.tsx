import type * as React from "react";

import { cn } from "~/lib/utils";

/** Single-line text field (the Otter Code input look: hairline border, focus ring). */
function Input({ className, type = "text", ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-7.5 w-full min-w-0 rounded-lg border border-input bg-canvas px-[calc(--spacing(2.5)-1px)] text-[13px] text-foreground shadow-xs/5 outline-none transition-shadow placeholder:text-placeholder focus-visible:border-focus-ring focus-visible:ring-[3px] focus-visible:ring-focus-ring/24 disabled:opacity-64 aria-invalid:border-destructive/36 dark:bg-input/32",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
