import { type StaticScreenProps, useFocusEffect } from "@react-navigation/native";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, AppState, FlatList, RefreshControl, View } from "react-native";

import { EmptyState } from "../../components/EmptyState";
import { ErrorBanner } from "../../components/ErrorBanner";
import { errorMessage } from "../../lib/errors";
import { useAccounts } from "../../state/accounts";
import * as store from "../../state/db";
import { listsRecipients, mailboxTitle, type MailboxLabel } from "../../state/mailboxes";
import { search, syncMailbox } from "../../state/sync";
import { ThreadRow } from "./ThreadRow";
import { useStackNavigation } from "../../lib/navigation";

type Props = StaticScreenProps<{ accountId: string | null; label: MailboxLabel }>;

export function MailboxScreen({ route }: Props) {
  const navigation = useStackNavigation();
  const { accountId, label } = route.params;
  const scope = useMemo(() => ({ accountId, label }), [accountId, label]);
  const accounts = useAccounts();
  const revision = store.useRevision();
  const threads = useMemo(() => store.listThreads(scope), [scope, revision]);

  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [synced, setSynced] = useState(false);

  // Search replaces the list while a query is submitted.
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<store.ThreadSummary[] | null>(null);
  const [searching, setSearching] = useState(false);
  const searchRun = useRef(0);

  const refresh = useCallback(async () => {
    try {
      setHasMore(await syncMailbox(scope));
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSynced(true);
    }
  }, [scope]);

  // Catch up whenever the mailbox comes into view or the app comes back.
  useFocusEffect(
    useCallback(() => {
      void refresh();
      const subscription = AppState.addEventListener("change", (state) => {
        if (state === "active") void refresh();
      });
      return () => subscription.remove();
    }, [refresh]),
  );

  const runSearch = useCallback(
    async (text: string) => {
      const run = ++searchRun.current;
      setSearching(true);
      try {
        const found = await search(text, accountId);
        if (run === searchRun.current) setResults(found);
      } catch (err) {
        if (run === searchRun.current) setError(errorMessage(err));
      } finally {
        if (run === searchRun.current) setSearching(false);
      }
    },
    [accountId],
  );

  useLayoutEffect(() => {
    navigation.setOptions({
      title: mailboxTitle(scope),
      headerSearchBarOptions: {
        placeholder: "Search",
        autoCapitalize: "none",
        onChangeText: (event) => {
          setQuery(event.nativeEvent.text);
          if (!event.nativeEvent.text) {
            searchRun.current++;
            setResults(null);
            setSearching(false);
          }
        },
        onSearchButtonPress: (event) => void runSearch(event.nativeEvent.text),
        onCancelButtonPress: () => {
          searchRun.current++;
          setQuery("");
          setResults(null);
          setSearching(false);
        },
      },
      unstable_headerRightItems: () => [
        {
          type: "button",
          label: "",
          accessibilityLabel: "New message",
          icon: { type: "sfSymbol", name: "square.and.pencil" },
          onPress: () =>
            navigation.navigate("Compose", { mode: "new", accountId: accountId ?? undefined }),
        },
      ],
    });
  }, [accountId, navigation, runSearch, scope]);

  const loadMore = async () => {
    if (!hasMore || loadingMore || results) return;
    setLoadingMore(true);
    try {
      setHasMore(await syncMailbox(scope, true));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoadingMore(false);
    }
  };

  // Search results re-read from the cache so actions on them show at once.
  const shown = useMemo(
    () =>
      results
        ?.map((t) => store.getThread(t.accountId, t.id))
        .filter((t): t is store.ThreadSummary => t !== null) ?? threads,
    [results, threads, revision],
  );

  return (
    <FlatList
      className="flex-1 bg-screen"
      contentInsetAdjustmentBehavior="automatic"
      data={shown}
      keyExtractor={(thread) => `${thread.accountId}:${thread.id}`}
      renderItem={({ item }) => (
        <ThreadRow
          thread={item}
          showRecipients={listsRecipients(label)}
          showAccount={accountId === null && accounts.length > 1}
          onPress={() =>
            navigation.navigate("Thread", { accountId: item.accountId, threadId: item.id })
          }
        />
      )}
      ListHeaderComponent={error ? <ErrorBanner message={error} /> : null}
      ListEmptyComponent={
        searching || (!synced && threads.length === 0) ? (
          <View className="py-16">
            <ActivityIndicator colorClassName="accent-icon-muted" />
          </View>
        ) : results ? (
          <EmptyState
            symbol="magnifyingglass"
            title="No results"
            detail={`Nothing matches “${query}”.`}
          />
        ) : (
          <EmptyState symbol="tray" title="Nothing here" detail="You're all caught up." />
        )
      }
      ListFooterComponent={
        loadingMore ? (
          <View className="py-6">
            <ActivityIndicator colorClassName="accent-icon-muted" />
          </View>
        ) : null
      }
      onEndReached={loadMore}
      onEndReachedThreshold={0.5}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={async () => {
            setRefreshing(true);
            await refresh();
            setRefreshing(false);
          }}
        />
      }
    />
  );
}
