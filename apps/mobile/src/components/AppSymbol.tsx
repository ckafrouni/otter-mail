import { SymbolView as ExpoSymbolView } from "expo-symbols";
import { withUniwind } from "uniwind";

export type { SFSymbol } from "expo-symbols";

/** SF Symbols, tinted with a className (`tintColorClassName="accent-icon"`). */
export const SymbolView = withUniwind(ExpoSymbolView);
