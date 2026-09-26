import { View } from "react-native";

import { SymbolView } from "./AppSymbol";
import { AppText as Text } from "./AppText";

export function ErrorBanner(props: { message: string }) {
  return (
    <View className="mx-4 my-2 flex-row items-center gap-2.5 rounded-2xl bg-danger px-3.5 py-2.5">
      <SymbolView
        name="exclamationmark.triangle"
        size={16}
        tintColorClassName="accent-danger-foreground"
      />
      <Text className="flex-1 text-sm text-danger-foreground" numberOfLines={3}>
        {props.message}
      </Text>
    </View>
  );
}
