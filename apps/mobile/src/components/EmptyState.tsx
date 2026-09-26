import type { ReactNode } from "react";
import { View } from "react-native";

import { type SFSymbol, SymbolView } from "./AppSymbol";
import { AppText as Text } from "./AppText";

export function EmptyState(props: {
  symbol: SFSymbol;
  title: string;
  detail?: string;
  children?: ReactNode;
}) {
  return (
    <View className="flex-1 items-center justify-center gap-3 px-10 py-16">
      <SymbolView name={props.symbol} size={36} tintColorClassName="accent-icon-muted" />
      <Text className="text-center font-t3-bold text-lg">{props.title}</Text>
      {props.detail ? (
        <Text className="text-center text-sm text-foreground-muted">{props.detail}</Text>
      ) : null}
      {props.children}
    </View>
  );
}
