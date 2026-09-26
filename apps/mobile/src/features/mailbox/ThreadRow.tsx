import { useRef } from "react";
import { Alert, Pressable, View } from "react-native";
import ReanimatedSwipeable, {
  type SwipeableMethods,
} from "react-native-gesture-handler/ReanimatedSwipeable";
import * as Haptics from "expo-haptics";

import { type SFSymbol, SymbolView } from "../../components/AppSymbol";
import { AppText as Text } from "../../components/AppText";
import { hueFor } from "../../components/Avatar";
import { cn } from "../../lib/cn";
import { errorMessage } from "../../lib/errors";
import { formatListDate } from "../../lib/time";
import * as actions from "../../state/actions";
import type { ThreadSummary } from "../../state/db";
import { parseAddress, splitAddressList } from "../../gmail/mime";

function SwipeAction(props: {
  symbol: SFSymbol;
  label: string;
  className: string;
  align: "left" | "right";
}) {
  return (
    <View
      className={cn(
        "flex-1 flex-row items-center px-7",
        props.align === "left" ? "justify-start" : "justify-end",
        props.className,
      )}
    >
      <View className="items-center gap-1">
        <SymbolView name={props.symbol} size={22} tintColorClassName="accent-white" />
        <Text className="font-t3-medium text-xs text-white">{props.label}</Text>
      </View>
    </View>
  );
}

/** "to Alice, Bob" for sent mail and drafts. */
function recipientsLabel(to: string): string {
  const names = splitAddressList(to).map((entry) => {
    const { name, email } = parseAddress(entry);
    return name && name !== email ? name.split(" ")[0] : email;
  });
  return names.length ? `to ${names.join(", ")}` : "No recipients";
}

/**
 * One conversation in a mailbox, laid out like the desktop list: an unread
 * dot, the sender, the thread's count and date, then subject and snippet.
 * Swipe left to archive (or trash, outside the Inbox), right to toggle read.
 */
export function ThreadRow(props: {
  thread: ThreadSummary;
  showRecipients: boolean;
  /** Shown in combined mailboxes: which account the thread belongs to. */
  showAccount: boolean;
  onPress: () => void;
}) {
  const { thread } = props;
  const swipeable = useRef<SwipeableMethods>(null);
  const inInbox = thread.labelIds.includes("INBOX");
  const inTrash = thread.labelIds.includes("TRASH");

  const run = (action: () => Promise<void>) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    swipeable.current?.close();
    action().catch((err) => Alert.alert("Gmail didn't take that", errorMessage(err)));
  };

  return (
    <ReanimatedSwipeable
      ref={swipeable}
      friction={1.5}
      overshootFriction={8}
      leftThreshold={80}
      rightThreshold={80}
      renderLeftActions={() => (
        <SwipeAction
          align="left"
          symbol={thread.unread ? "envelope.open" : "envelope.badge"}
          label={thread.unread ? "Read" : "Unread"}
          className="bg-swipe-read"
        />
      )}
      renderRightActions={() =>
        inTrash ? null : (
          <SwipeAction
            align="right"
            symbol={inInbox ? "archivebox" : "trash"}
            label={inInbox ? "Archive" : "Trash"}
            className={inInbox ? "bg-swipe-archive" : "bg-swipe-trash"}
          />
        )
      }
      onSwipeableWillOpen={(direction) => {
        if (direction === "left") run(() => actions.setRead(thread, thread.unread));
        else run(() => (inInbox ? actions.archive(thread) : actions.trash(thread)));
      }}
      containerStyle={{ width: "100%" }}
    >
      <Pressable
        accessibilityRole="button"
        onPress={props.onPress}
        className="flex-row bg-screen pr-4 active:bg-row-pressed"
      >
        <View className="w-7 items-center pt-[7px]">
          {thread.unread ? <View className="size-2.5 rounded-full bg-primary" /> : null}
        </View>
        <View className="flex-1 gap-0.5 border-b border-separator py-3">
          <View className="flex-row items-center gap-2">
            <Text
              className={cn("flex-1 text-base", thread.unread ? "font-t3-bold" : "font-t3-medium")}
              numberOfLines={1}
            >
              {props.showRecipients
                ? recipientsLabel(thread.to)
                : thread.fromName || thread.fromEmail}
            </Text>
            {thread.starred ? (
              <SymbolView name="star.fill" size={12} tintColorClassName="accent-star" />
            ) : null}
            {thread.messageCount > 1 ? (
              <Text className="text-xs text-foreground-muted">{thread.messageCount}</Text>
            ) : null}
            {props.showAccount ? (
              <View
                className="size-2 rounded-full"
                style={{ backgroundColor: `hsl(${hueFor(thread.accountId)}, 60%, 55%)` }}
              />
            ) : null}
            <Text className="text-sm text-foreground-muted">{formatListDate(thread.date)}</Text>
          </View>
          <Text
            className={cn("text-[15px]", thread.unread ? "font-t3-medium" : "text-foreground/80")}
            numberOfLines={1}
          >
            {thread.subject || "(no subject)"}
          </Text>
          <Text className="text-sm leading-[19px] text-foreground-muted" numberOfLines={2}>
            {thread.snippet || " "}
          </Text>
        </View>
      </Pressable>
    </ReanimatedSwipeable>
  );
}
