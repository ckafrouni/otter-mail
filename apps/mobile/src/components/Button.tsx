import { ActivityIndicator, Pressable } from "react-native";

import { AppText as Text } from "./AppText";
import { cn } from "../lib/cn";

/** A full-width pill button, primary (solid blue) or secondary (grouped gray). */
export function Button(props: {
  label: string;
  onPress: () => void;
  variant?: "primary" | "secondary" | "danger";
  busy?: boolean;
  disabled?: boolean;
}) {
  const variant = props.variant ?? "primary";
  return (
    <Pressable
      accessibilityRole="button"
      disabled={props.disabled || props.busy}
      onPress={props.onPress}
      className={cn(
        "h-12 flex-row items-center justify-center gap-2 rounded-full px-6 active:opacity-80",
        variant === "primary" ? "bg-primary" : "bg-grouped-card",
        (props.disabled || props.busy) && "opacity-50",
      )}
    >
      {props.busy ? (
        <ActivityIndicator
          colorClassName={variant === "primary" ? "accent-white" : "accent-icon"}
        />
      ) : null}
      <Text
        className={cn(
          "font-t3-medium text-base",
          variant === "primary" && "text-primary-foreground",
          variant === "danger" && "text-danger-foreground",
        )}
      >
        {props.label}
      </Text>
    </Pressable>
  );
}
