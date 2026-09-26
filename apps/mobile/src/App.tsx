import {
  createStaticNavigation,
  DarkTheme,
  DefaultTheme,
  type Theme,
} from "@react-navigation/native";
import * as SplashScreen from "expo-splash-screen";
import { useEffect, useMemo, useState } from "react";
import { StatusBar } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { useCSSVariable, useUniwind } from "uniwind";

import { RootStack } from "./Stack";
import { listAccounts } from "./state/db";
import "./state/appearance";

import "../global.css";

void SplashScreen.preventAutoHideAsync().catch(() => undefined);

const Navigation = createStaticNavigation(RootStack);

// ottermail://thread/<account>/<thread> and friends (paths live in Stack.tsx).
const linking = { prefixes: ["ottermail://", "ottermail-dev://"] };

/** Opens on the inbox when signed in, with Mailboxes one step back (like Mail). */
function initialState() {
  const accounts = listAccounts();
  if (accounts.length === 0) return undefined;
  return {
    routes: [
      { name: "Mailboxes" as const },
      {
        name: "Mailbox" as const,
        params: { accountId: accounts.length === 1 ? accounts[0]!.id : null, label: "INBOX" },
      },
    ],
  };
}

/**
 * React Navigation needs a JS theme; it drives the native header's colors and
 * its light/dark style. Derive it from the same CSS variables as the screens.
 */
function useNavigationTheme(): Theme {
  const { theme } = useUniwind();
  const [primary, screen, card, text, border, danger] = useCSSVariable([
    "--color-primary-text",
    "--color-screen",
    "--color-sheet",
    "--color-foreground",
    "--color-border",
    "--color-danger-foreground",
  ]);
  return useMemo(() => {
    const base = theme === "dark" ? DarkTheme : DefaultTheme;
    return {
      ...base,
      colors: {
        primary: String(primary),
        background: String(screen),
        card: String(card),
        text: String(text),
        border: String(border),
        notification: String(danger),
      },
    };
  }, [theme, primary, screen, card, text, border, danger]);
}

export default function App() {
  const { theme } = useUniwind();
  const navigationTheme = useNavigationTheme();
  const [state] = useState(initialState);

  useEffect(() => {
    void SplashScreen.hideAsync();
  }, []);

  return (
    <GestureHandlerRootView className="flex-1">
      <SafeAreaProvider>
        <StatusBar barStyle={theme === "dark" ? "light-content" : "dark-content"} />
        <Navigation theme={navigationTheme} initialState={state} linking={linking} />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
