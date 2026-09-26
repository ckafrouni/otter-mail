import type { GmailMessageDetail } from "@otter-mail/contracts/gmail";
import { type StaticScreenProps } from "@react-navigation/native";
import { GlassView as ExpoGlassView } from "expo-glass-effect";
import { withUniwind } from "uniwind";
import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { type SFSymbol, SymbolView } from "../../components/AppSymbol";
import { AppText as Text } from "../../components/AppText";
import { Avatar } from "../../components/Avatar";
import { EmptyState } from "../../components/EmptyState";
import { ErrorBanner } from "../../components/ErrorBanner";
import { errorMessage } from "../../lib/errors";
import { formatListDate, formatMessageDate } from "../../lib/time";
import * as actions from "../../state/actions";
import * as store from "../../state/db";
import { loadThread, needsBodies } from "../../state/sync";
import { NATIVE_LIQUID_GLASS_SUPPORTED } from "../../native/native-glass";
import { MessageBody } from "./MessageBody";
import { useStackNavigation } from "../../lib/navigation";

const GlassView = withUniwind(ExpoGlassView);

type Props = StaticScreenProps<{ accountId: string; threadId: string }>;

const report = (err: unknown) => Alert.alert("Gmail didn't take that", errorMessage(err));

export function ThreadScreen({ route }: Props) {
  const navigation = useStackNavigation();
  const insets = useSafeAreaInsets();
  const { accountId, threadId } = route.params;
  const revision = store.useRevision();
  const thread = useMemo(
    () => store.getThread(accountId, threadId),
    [accountId, threadId, revision],
  );
  const messages = useMemo(
    () => store.listMessages(accountId, threadId),
    [accountId, threadId, revision],
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch the bodies when they're missing or stale, and mark the thread read.
  useEffect(() => {
    const current = store.getThread(accountId, threadId);
    // Quietly: if Gmail refuses, the thread just stays unread (the list says why).
    if (current?.unread) actions.setRead(current, true).catch(() => undefined);
    if (current && !needsBodies(current)) return;
    setLoading(true);
    loadThread(accountId, threadId)
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  }, [accountId, threadId]);

  useLayoutEffect(() => {
    if (!thread) {
      navigation.setOptions({ unstable_headerRightItems: () => [] });
      return;
    }
    const inInbox = thread.labelIds.includes("INBOX");
    const inTrash = thread.labelIds.includes("TRASH");
    const leave = (action: Promise<void>) => {
      navigation.goBack();
      action.catch(report);
    };
    navigation.setOptions({
      unstable_headerRightItems: () => [
        {
          type: "button",
          label: "",
          accessibilityLabel: thread.starred ? "Unstar" : "Star",
          icon: { type: "sfSymbol", name: thread.starred ? "star.fill" : "star" },
          onPress: () => actions.setStarred(thread, !thread.starred).catch(report),
        },
        ...(inInbox
          ? [
              {
                type: "button" as const,
                label: "",
                accessibilityLabel: "Archive",
                icon: { type: "sfSymbol" as const, name: "archivebox" as const },
                onPress: () => leave(actions.archive(thread)),
              },
            ]
          : []),
        {
          type: "menu",
          label: "",
          accessibilityLabel: "More",
          icon: { type: "sfSymbol", name: "ellipsis" },
          menu: {
            items: [
              {
                type: "action",
                label: "Mark as Unread",
                icon: { type: "sfSymbol", name: "envelope.badge" },
                onPress: () => leave(actions.setRead(thread, false)),
              },
              ...(inTrash
                ? []
                : [
                    {
                      type: "action" as const,
                      label: "Move to Trash",
                      icon: { type: "sfSymbol" as const, name: "trash" as const },
                      destructive: true,
                      onPress: () => leave(actions.trash(thread)),
                    },
                  ]),
            ],
          },
        },
      ],
    });
  }, [navigation, thread]);

  if (!thread) {
    return loading ? (
      <View className="flex-1 items-center justify-center bg-screen">
        <ActivityIndicator colorClassName="accent-icon-muted" />
      </View>
    ) : (
      <View className="flex-1 bg-screen">
        {error ? <ErrorBanner message={error} /> : null}
        <EmptyState symbol="tray" title="This conversation is gone" />
      </View>
    );
  }

  const reply = (mode: "reply" | "replyAll" | "forward") =>
    navigation.navigate("Compose", { mode, accountId, threadId });

  return (
    <View className="flex-1 bg-screen">
      <ScrollView
        className="flex-1"
        contentInsetAdjustmentBehavior="automatic"
        contentContainerClassName="gap-3 px-3"
        contentContainerStyle={{ paddingBottom: insets.bottom + 88 }}
      >
        <Text selectable className="px-1 pt-1 font-t3-bold text-2xl">
          {thread.subject || "(no subject)"}
        </Text>
        {error ? <ErrorBanner message={error} /> : null}
        {messages.length === 0 ? (
          <View className="py-16">
            {loading ? <ActivityIndicator colorClassName="accent-icon-muted" /> : null}
          </View>
        ) : (
          messages.map((message, index) => (
            <MessageCard
              key={message.id}
              message={message}
              // The newest message, and any unread one, start open.
              initiallyExpanded={index === messages.length - 1 || message.unread}
            />
          ))
        )}
      </ScrollView>
      <GlassView
        isInteractive
        style={{
          position: "absolute",
          alignSelf: "center",
          bottom: insets.bottom + 8,
          flexDirection: "row",
          borderRadius: 999,
          paddingHorizontal: 8,
        }}
        // Before Liquid Glass, GlassView is a plain view: give it a surface.
        className={NATIVE_LIQUID_GLASS_SUPPORTED ? undefined : "border border-border bg-card"}
      >
        <ReplyButton
          symbol="arrowshape.turn.up.left"
          label="Reply"
          onPress={() => reply("reply")}
        />
        <ReplyButton
          symbol="arrowshape.turn.up.left.2"
          label="Reply All"
          onPress={() => reply("replyAll")}
        />
        <ReplyButton
          symbol="arrowshape.turn.up.right"
          label="Forward"
          onPress={() => reply("forward")}
        />
      </GlassView>
    </View>
  );
}

function ReplyButton(props: { symbol: SFSymbol; label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.label}
      onPress={props.onPress}
      className="h-12 w-16 items-center justify-center active:opacity-60"
    >
      <SymbolView name={props.symbol} size={20} tintColorClassName="accent-primary-text" />
    </Pressable>
  );
}

function MessageCard(props: { message: GmailMessageDetail; initiallyExpanded: boolean }) {
  const { message } = props;
  const [expanded, setExpanded] = useState(props.initiallyExpanded);
  const isDraft = message.labelIds.includes("DRAFT");

  return (
    <View className="overflow-hidden rounded-[22px] border-continuous bg-card">
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        onPress={() => setExpanded((open) => !open)}
        className="flex-row items-start gap-3 p-4"
      >
        <Avatar name={message.fromName} email={message.fromEmail} />
        <View className="flex-1 gap-0.5">
          <View className="flex-row items-center gap-2">
            <Text className="flex-1 font-t3-bold text-base" numberOfLines={1}>
              {isDraft ? "Draft" : message.fromName || message.fromEmail}
            </Text>
            <Text className="text-xs text-foreground-muted">
              {expanded ? formatMessageDate(message.date) : formatListDate(message.date)}
            </Text>
          </View>
          <Text className="text-sm text-foreground-muted" numberOfLines={expanded ? undefined : 1}>
            {expanded
              ? [
                  message.fromName ? message.fromEmail : null,
                  message.to ? `to ${message.to}` : null,
                  message.cc ? `cc ${message.cc}` : null,
                ]
                  .filter(Boolean)
                  .join("\n")
              : message.snippet}
          </Text>
        </View>
      </Pressable>
      {expanded ? (
        <View className="gap-2 px-2 pb-2">
          <MessageBody html={message.bodyHtml} text={message.bodyText} />
          {message.attachments.length > 0 ? (
            <View className="flex-row flex-wrap gap-2 px-2 pb-2">
              {message.attachments.map((attachment) => (
                <View
                  key={attachment.id}
                  className="flex-row items-center gap-1.5 rounded-full bg-grouped-card px-3 py-1.5"
                >
                  <SymbolView name="paperclip" size={13} tintColorClassName="accent-icon-muted" />
                  <Text className="max-w-[220px] text-xs" numberOfLines={1}>
                    {attachment.filename}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
