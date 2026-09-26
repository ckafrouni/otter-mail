import type { StaticParamList } from "@react-navigation/native";
import {
  createNativeStackNavigator,
  createNativeStackScreen,
  type NativeStackNavigationOptions,
} from "@react-navigation/native-stack";

import { ComposeScreen } from "./features/compose/ComposeScreen";
import { MailboxScreen } from "./features/mailbox/MailboxScreen";
import { MailboxesScreen } from "./features/mailboxes/MailboxesScreen";
import { SettingsScreen } from "./features/settings/SettingsScreen";
import { ThreadScreen } from "./features/thread/ThreadScreen";
import { NATIVE_LIQUID_GLASS_SUPPORTED } from "./native/native-glass";

// GLASS (Otter Code's preset): a transparent header over the screen's primary
// scroll view where iOS has Liquid Glass; a solid bar before that.
const GLASS_HEADER_OPTIONS: NativeStackNavigationOptions = {
  headerBackButtonDisplayMode: "minimal",
  headerShadowVisible: false,
  headerTransparent: NATIVE_LIQUID_GLASS_SUPPORTED,
  headerStyle: NATIVE_LIQUID_GLASS_SUPPORTED ? { backgroundColor: "transparent" } : undefined,
  headerLargeTitleShadowVisible: false,
  headerLargeTitleStyle: { fontFamily: "DMSans-Bold" },
  headerTitleStyle: { fontFamily: "DMSans-Bold", fontSize: 17 },
  scrollEdgeEffects: NATIVE_LIQUID_GLASS_SUPPORTED
    ? { top: "automatic", bottom: "hidden", left: "hidden", right: "hidden" }
    : undefined,
};

export const RootStack = createNativeStackNavigator({
  screenOptions: GLASS_HEADER_OPTIONS,
  screens: {
    Mailboxes: createNativeStackScreen({
      screen: MailboxesScreen,
      linking: "",
      options: { title: "Mailboxes", headerLargeTitleEnabled: true },
    }),
    Mailbox: createNativeStackScreen({
      screen: MailboxScreen,
      linking: "mailbox/:label",
      options: { headerLargeTitleEnabled: true },
    }),
    Thread: createNativeStackScreen({
      screen: ThreadScreen,
      linking: "thread/:accountId/:threadId",
      options: { title: "" },
    }),
    Compose: createNativeStackScreen({
      screen: ComposeScreen,
      linking: "compose",
      options: { presentation: "modal", title: "New Message" },
    }),
    Settings: createNativeStackScreen({
      screen: SettingsScreen,
      linking: "settings",
      options: { presentation: "modal", title: "Settings" },
    }),
  },
});

declare global {
  namespace ReactNavigation {
    interface RootParamList extends StaticParamList<typeof RootStack> {}
  }
}
