import { useLayoutEffect, useMemo, useState } from "react";
import { Alert, Image, ScrollView, View } from "react-native";

import { type SFSymbol, SymbolView } from "../../components/AppSymbol";
import { AppText as Text } from "../../components/AppText";
import { Button } from "../../components/Button";
import { Row, Section } from "../../components/GroupedList";
import { errorMessage } from "../../lib/errors";
import { SignInCancelledError } from "../../gmail/oauth";
import { addAccount, useAccounts } from "../../state/accounts";
import { db, useRevision } from "../../state/db";
import { MAILBOXES, type MailboxLabel } from "../../state/mailboxes";
import { useStackNavigation } from "../../lib/navigation";

const COMBINED_MAILBOXES: readonly MailboxLabel[] = ["INBOX", "STARRED", "SENT"];

/** Unread inbox threads per account, from the cache. */
function useUnreadCounts(): Map<string, number> {
  const revision = useRevision();
  return useMemo(() => {
    const rows = db.getAllSync<{ account_id: string; count: number }>(
      `SELECT account_id, COUNT(*) AS count FROM threads
       WHERE unread = 1 AND EXISTS (SELECT 1 FROM json_each(label_ids) WHERE value = 'INBOX')
       GROUP BY account_id`,
    );
    return new Map(rows.map((row) => [row.account_id, row.count]));
  }, [revision]);
}

export function MailboxesScreen() {
  const navigation = useStackNavigation();
  const accounts = useAccounts();
  const unread = useUnreadCounts();
  const hasAccounts = accounts.length > 0;

  useLayoutEffect(() => {
    navigation.setOptions({
      title: hasAccounts ? "Mailboxes" : "",
      unstable_headerRightItems: () =>
        hasAccounts
          ? [
              {
                type: "button",
                label: "",
                accessibilityLabel: "Settings",
                icon: { type: "sfSymbol", name: "gearshape" },
                onPress: () => navigation.navigate("Settings"),
              },
              {
                type: "button",
                label: "",
                accessibilityLabel: "New message",
                icon: { type: "sfSymbol", name: "square.and.pencil" },
                onPress: () => navigation.navigate("Compose", { mode: "new" }),
              },
            ]
          : [],
    });
  }, [hasAccounts, navigation]);

  if (!hasAccounts) return <Welcome />;

  const totalUnread = [...unread.values()].reduce((sum, n) => sum + n, 0);
  return (
    <ScrollView
      className="flex-1 bg-screen"
      contentInsetAdjustmentBehavior="automatic"
      contentContainerClassName="gap-6 px-4 pb-12 pt-2"
    >
      {accounts.length > 1 ? (
        <Section title="All accounts">
          {COMBINED_MAILBOXES.map((label, index) => {
            const mailbox = MAILBOXES.find((m) => m.label === label)!;
            return (
              <MailboxRow
                key={label}
                symbol={mailbox.symbol}
                title={label === "INBOX" ? "All Inboxes" : mailbox.title}
                count={label === "INBOX" ? totalUnread : 0}
                first={index === 0}
                onPress={() => navigation.navigate("Mailbox", { accountId: null, label })}
              />
            );
          })}
        </Section>
      ) : null}
      {accounts.map((account) => (
        <Section key={account.id} title={account.email}>
          {MAILBOXES.map((mailbox, index) => (
            <MailboxRow
              key={mailbox.label}
              symbol={mailbox.symbol}
              title={mailbox.title}
              count={mailbox.label === "INBOX" ? (unread.get(account.id) ?? 0) : 0}
              first={index === 0}
              onPress={() =>
                navigation.navigate("Mailbox", { accountId: account.id, label: mailbox.label })
              }
            />
          ))}
        </Section>
      ))}
    </ScrollView>
  );
}

function MailboxRow(props: {
  symbol: SFSymbol;
  title: string;
  count: number;
  first: boolean;
  onPress: () => void;
}) {
  return (
    <Row first={props.first} onPress={props.onPress}>
      <SymbolView name={props.symbol} size={22} tintColorClassName="accent-primary-text" />
      <Text className="flex-1 text-lg" numberOfLines={1}>
        {props.title}
      </Text>
      {props.count > 0 ? (
        <Text className="text-base text-foreground-muted">{props.count.toLocaleString()}</Text>
      ) : null}
      <SymbolView
        name="chevron.right"
        size={14}
        weight="semibold"
        tintColorClassName="accent-chevron"
      />
    </Row>
  );
}

function Welcome() {
  const navigation = useStackNavigation();
  const [busy, setBusy] = useState(false);

  const signIn = async () => {
    setBusy(true);
    try {
      const account = await addAccount();
      navigation.navigate("Mailbox", { accountId: account.id, label: "INBOX" });
    } catch (err) {
      if (!(err instanceof SignInCancelledError)) {
        Alert.alert("Couldn't sign in", errorMessage(err));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <View className="flex-1 items-center justify-center gap-10 bg-screen px-8">
      <View className="items-center gap-4">
        <Image
          source={require("../../../../../assets/prod/otter-mail-ios-1024.png")}
          className="size-28 rounded-[26px]"
        />
        <Text className="font-t3-bold text-3xl">Otter Mail</Text>
        <Text className="text-center text-base text-foreground-muted">Gmail, calm and fast.</Text>
      </View>
      <View className="w-full max-w-sm gap-3">
        <Button label="Sign in with Google" busy={busy} onPress={signIn} />
        <Text className="text-center text-xs text-foreground-muted">
          Your mail goes straight between this phone and Google. Nothing passes through our servers.
        </Text>
      </View>
    </View>
  );
}
