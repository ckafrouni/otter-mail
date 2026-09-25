import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "~/lib/utils";

/**
 * Push button in the app's control style (adapted from Otter Code's
 * components/ui/button.tsx): 8px radius, hairline border, one solid blue
 * primary. `accent` is the solid call to action.
 */
const buttonVariants = cva(
  "relative inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-[var(--control-radius)] border font-medium outline-none transition-[box-shadow,scale,background-color] active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-1 focus-visible:ring-offset-canvas disabled:pointer-events-none disabled:opacity-64 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    defaultVariants: { size: "default", variant: "outline" },
    variants: {
      variant: {
        accent:
          "border-primary bg-primary text-primary-foreground shadow-xs shadow-primary/24 not-disabled:inset-shadow-[0_1px_rgb(255_255_255/16%)] hover:bg-primary/90 active:shadow-none",
        destructive:
          "border-destructive bg-destructive text-white shadow-xs shadow-destructive/24 not-disabled:inset-shadow-[0_1px_rgb(255_255_255/16%)] hover:bg-destructive/90 active:shadow-none",
        outline:
          "border-input bg-popover text-foreground shadow-xs/5 hover:bg-accent-surface/50 dark:bg-input/32 dark:hover:bg-input/64",
        ghost: "border-transparent text-foreground hover:bg-accent-surface",
      },
      size: {
        small: "h-7 px-[calc(--spacing(2.5)-1px)] text-xs [&_svg:not([class*='size-'])]:size-3.5",
        default: "h-8 px-[calc(--spacing(3)-1px)] text-sm [&_svg:not([class*='size-'])]:size-4",
        large: "h-9 px-[calc(--spacing(3.5)-1px)] text-sm [&_svg:not([class*='size-'])]:size-4",
      },
    },
  },
);

type ButtonProps = React.ComponentProps<"button"> & VariantProps<typeof buttonVariants>;

function Button({ className, variant, size, type, ...props }: ButtonProps) {
  return (
    <button
      type={type ?? "button"}
      data-slot="button"
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}

export { Button, buttonVariants, type ButtonProps };
