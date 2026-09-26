import Constants from "expo-constants";
import * as WebBrowser from "expo-web-browser";
import { useLayoutEffect, useState } from "react";
import { ActionSheetIOS, Alert, ScrollView, View } from "react-native";

import { type SFSymbol, SymbolView } from "../../components/AppSymbol";
import { AppText as Text } from "../../components/AppText";
import { Avatar } from "../../components/Avatar";
import { Row, Section } from "../../components/GroupedList";
import { errorMessage } from "../../lib/errors";
import { SignInCancelledError } from "../../gmail/oauth";
import { addAccount, removeAccount, useAccounts } from "../../state/accounts";
import { type Appearance, setAppearance, useAppearance } from "../../state/appearance";
import { useStackNavigation } from "../../lib/navigation";

const SITE = "https://mail.otterware.dev";

const APPEARANCES: readonly { value: Appearance; label: string; symbol: SFSymbol }[] = [
  { value: "system", label: "System", symbol: "circle.lefthalf.filled" },
  { value: "light", label: "Light", symbol: "sun.max" },
  { value: "dark", label: "Dark", symbol: "moon" },
];

export function SettingsScreen() {
  const navigation = useStackNavigation();
  const accounts = useAccounts();
  const appearance = useAppearance();
  const [adding, setAdding] = useState(false);

  useLayoutEffect(() => {
    navigation.setOptions({
      unstable_headerRightItems: () => [
        { type: "button", label: "Done", variant: "done", onPress: () => navigation.goBack() },
      ],
    });
  }, [navigation]);

  const add = async () => {
    setAdding(true);
    try {
      await addAccount();
    } catch (err) {
      if (!(err instanceof SignInCancelledError)) {
        Alert.alert("Couldn't sign in", errorMessage(err));
      }
    } finally {
      setAdding(false);
    }
  };

  const confirmRemove = (accountId: string) => {
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: accountId,
        message: "Its mail stays in Gmail; this phone forgets it.",
        options: ["Sign Out", "Cancel"],
        destructiveButtonIndex: 0,
        cancelButtonIndex: 1,
      },
      (index) => {
        if (index !== 0) return;
        removeAccount(accountId)
          .then(() => {
            // The last account gone: back to the welcome screen.
            if (accounts.length === 1) navigation.popToTop();
          })
          .catch((err) => Alert.alert("Couldn't sign out", errorMessage(err)));
      },
    );
  };

  return (
    <ScrollView
      className="flex-1 bg-sheet"
      contentInsetAdjustmentBehavior="automatic"
      contentContainerClassName="gap-6 px-4 pb-12 pt-4"
    >
      <Section title="Accounts">
        {accounts.map((account, index) => (
          <Row key={account.id} first={index === 0} onPress={() => confirmRemove(account.id)}>
            <Avatar name={account.name} email={account.email} picture={account.picture} size={32} />
            <View className="flex-1">
              <Text className="text-base" numberOfLines={1}>
                {account.name}
              </Text>
              <Text className="text-sm text-foreground-muted" numberOfLines={1}>
                {account.email}
              </Text>
            </View>
          </Row>
        ))}
        <Row first={accounts.length === 0} onPress={add} disabled={adding}>
          <SymbolView name="plus.circle" size={22} tintColorClassName="accent-primary-text" />
          <Text className="flex-1 text-lg text-primary-text">
            {adding ? "Signing in…" : "Add Google Account"}
          </Text>
        </Row>
      </Section>

      <Section title="Appearance">
        {APPEARANCES.map((option, index) => (
          <Row key={option.value} first={index === 0} onPress={() => setAppearance(option.value)}>
            <SymbolView name={option.symbol} size={22} tintColorClassName="accent-icon" />
            <Text className="flex-1 text-lg">{option.label}</Text>
            {appearance === option.value ? (
              <SymbolView
                name="checkmark"
                size={16}
                weight="semibold"
                tintColorClassName="accent-primary-text"
              />
            ) : null}
          </Row>
        ))}
      </Section>

      <Section title="About">
        <Row first>
          <SymbolView name="info.circle" size={22} tintColorClassName="accent-icon" />
          <Text className="flex-1 text-lg">Version</Text>
          <Text className="text-base text-foreground-muted">
            {Constants.expoConfig?.version ?? "—"}
          </Text>
        </Row>
        <Row onPress={() => void WebBrowser.openBrowserAsync(`${SITE}/privacy`)}>
          <SymbolView name="hand.raised" size={22} tintColorClassName="accent-icon" />
          <Text className="flex-1 text-lg">Privacy Policy</Text>
        </Row>
        <Row onPress={() => void WebBrowser.openBrowserAsync(`${SITE}/terms`)}>
          <SymbolView name="doc.text" size={22} tintColorClassName="accent-icon" />
          <Text className="flex-1 text-lg">Terms</Text>
        </Row>
      </Section>
    </ScrollView>
  );
}
