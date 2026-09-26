import type { ReactNode } from "react";
import { Pressable, View } from "react-native";

import { AppText as Text } from "./AppText";

/** A titled, rounded group of rows (Otter Code Mobile's settings sections). */
export function Section(props: { title: string; children: ReactNode }) {
  return (
    <View className="gap-2">
      <Text className="px-2 font-t3-medium text-sm text-foreground-muted" numberOfLines={1}>
        {props.title}
      </Text>
      <View className="overflow-hidden rounded-[24px] border-continuous bg-grouped-card">
        {props.children}
      </View>
    </View>
  );
}

/** A row in a Section; rows after the first draw a separator above their content. */
export function Row(props: {
  first?: boolean;
  disabled?: boolean;
  onPress?: () => void;
  children: ReactNode;
}) {
  return (
    <Pressable
      accessibilityRole={props.onPress ? "button" : undefined}
      disabled={props.disabled || !props.onPress}
      onPress={props.onPress}
      className="pl-4 active:bg-row-pressed"
    >
      <View
        className={
          props.first
            ? "min-h-14 flex-row items-center gap-4 py-2.5 pr-4"
            : "min-h-14 flex-row items-center gap-4 border-t border-separator py-2.5 pr-4"
        }
      >
        {props.children}
      </View>
    </Pressable>
  );
}
