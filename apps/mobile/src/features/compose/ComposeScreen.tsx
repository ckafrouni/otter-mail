import { type StaticScreenProps, usePreventRemove } from "@react-navigation/native";
import { useLayoutEffect, useMemo, useState } from "react";
import { ActionSheetIOS, Alert, Pressable, ScrollView, View } from "react-native";

import { AppText as Text, AppTextInput as TextInput } from "../../components/AppText";
import { errorMessage } from "../../lib/errors";
import { useAccounts } from "../../state/accounts";
import * as actions from "../../state/actions";
import * as store from "../../state/db";
import { draftFor, type ComposeMode, type Draft } from "./compose-draft";
import { useStackNavigation } from "../../lib/navigation";

type Props = StaticScreenProps<
  | { mode: "new"; accountId?: string; to?: string }
  | { mode: Exclude<ComposeMode, "new">; accountId: string; threadId: string }
>;

const TITLES: Record<ComposeMode, string> = {
  new: "New Message",
  reply: "Reply",
  replyAll: "Reply All",
  forward: "Forward",
};

export function ComposeScreen({ route }: Props) {
  const navigation = useStackNavigation();
  const params = route.params;
  const accounts = useAccounts();

  // The message being answered: the newest one in the thread that isn't a draft.
  const original = useMemo(() => {
    if (params.mode === "new") return undefined;
    const messages = store.listMessages(params.accountId, params.threadId);
    return messages.findLast((m) => !m.labelIds.includes("DRAFT")) ?? messages.at(-1);
  }, [params]);

  const [accountId, setAccountId] = useState(params.accountId ?? accounts[0]?.id ?? "");
  const [draft, setDraft] = useState<Draft>(() =>
    params.mode !== "new" && original
      ? draftFor(params.mode, original, params.accountId)
      : { to: params.mode === "new" ? (params.to ?? "") : "", cc: "", subject: "", body: "" },
  );
  const [sending, setSending] = useState(false);
  // Replies start the cursor above the quoted original; then it's the user's.
  const [selection, setSelection] = useState(
    params.mode === "new" ? undefined : { start: 0, end: 0 },
  );
  const [initialDraft] = useState(draft);
  const edited = JSON.stringify(draft) !== JSON.stringify(initialDraft);

  const update = (field: keyof Draft) => (value: string) =>
    setDraft((current) => ({ ...current, [field]: value }));

  // Swiping the sheet away (or Cancel) asks before throwing away typed mail.
  usePreventRemove(edited && !sending, ({ data }) => {
    Alert.alert("Discard this message?", undefined, [
      { text: "Keep Editing", style: "cancel" },
      {
        text: "Discard",
        style: "destructive",
        onPress: () => navigation.dispatch(data.action),
      },
    ]);
  });

  const send = async () => {
    if (!draft.to.trim()) {
      Alert.alert("Add a recipient", "Who should this go to?");
      return;
    }
    setSending(true);
    try {
      await actions.send({
        accountId,
        ...draft,
        replyTo: params.mode === "reply" || params.mode === "replyAll" ? original : undefined,
      });
      navigation.goBack();
    } catch (err) {
      setSending(false);
      Alert.alert("Couldn't send", errorMessage(err));
    }
  };

  useLayoutEffect(() => {
    navigation.setOptions({
      title: TITLES[params.mode],
      unstable_headerLeftItems: () => [
        {
          type: "button",
          label: "Cancel",
          onPress: () => navigation.goBack(),
        },
      ],
      unstable_headerRightItems: () => [
        {
          type: "button",
          label: "",
          accessibilityLabel: "Send",
          icon: { type: "sfSymbol", name: "arrow.up" },
          variant: "prominent",
          disabled: sending,
          onPress: () => void send(),
        },
      ],
    });
  });

  const account = accounts.find((a) => a.id === accountId);
  const pickAccount = () => {
    // Replies stay on the account that received the mail.
    if (params.mode !== "new" || accounts.length < 2) return;
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: "Send from",
        options: [...accounts.map((a) => a.email), "Cancel"],
        cancelButtonIndex: accounts.length,
      },
      (index) => {
        const picked = accounts[index];
        if (picked) setAccountId(picked.id);
      },
    );
  };

  return (
    <ScrollView
      className="flex-1 bg-sheet"
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      automaticallyAdjustKeyboardInsets
    >
      <Field label="To">
        <TextInput
          className="flex-1 py-3"
          value={draft.to}
          onChangeText={update("to")}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          textContentType="emailAddress"
          autoFocus={params.mode === "new" || params.mode === "forward"}
        />
      </Field>
      <Field label="Cc">
        <TextInput
          className="flex-1 py-3"
          value={draft.cc}
          onChangeText={update("cc")}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
        />
      </Field>
      <Pressable onPress={pickAccount}>
        <Field label="From">
          <Text className="flex-1 py-3 text-base" numberOfLines={1}>
            {account?.email ?? "No account"}
          </Text>
        </Field>
      </Pressable>
      <Field label="Subject">
        <TextInput className="flex-1 py-3" value={draft.subject} onChangeText={update("subject")} />
      </Field>
      <TextInput
        className="min-h-80 px-4 py-3 leading-[23px]"
        value={draft.body}
        onChangeText={update("body")}
        multiline
        scrollEnabled={false}
        textAlignVertical="top"
        autoFocus={params.mode === "reply" || params.mode === "replyAll"}
        selection={selection}
        onSelectionChange={() => setSelection(undefined)}
      />
    </ScrollView>
  );
}

function Field(props: { label: string; children: React.ReactNode }) {
  return (
    <View className="mx-4 flex-row items-center gap-2 border-b border-separator">
      <Text className="text-base text-foreground-muted">{props.label}:</Text>
      {props.children}
    </View>
  );
}
