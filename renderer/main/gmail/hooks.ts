import { useEffect, useRef } from "react";
import {
  useQuery,
  useQueries,
  useMutation,
  useInfiniteQuery,
  useQueryClient,
  type InfiniteData,
} from "@tanstack/react-query";
import { gmailApi, type ModifyMessageParams, type SendMessageParams } from "./api";
import type {
  GmailAccount,
  GmailLabel,
  GmailMessageDetail,
  GmailMessageSummary,
  LabelSelection,
  SyncStatus,
} from "./types";
import type { ListMessagesResult } from "./api";

const STALE_TIME = 30_000;

// ---- Query Keys ----
export const queryKeys = {
  credentials: () => ["gmail:credentials"] as const,
  accounts: () => ["gmail:accounts"] as const,
  labels: (accountId: string) => ["gmail:labels", accountId] as const,
  messages: (accountId: string, labelId?: string, q?: string) =>
    ["gmail:messages", accountId, labelId, q] as const,
  message: (accountId: string, messageId: string) =>
    ["gmail:message", accountId, messageId] as const,
  combinedMessages: (viewId: string, selections: LabelSelection[]) =>
    ["gmail:combinedMessages", viewId, selections] as const,
};

// ---- Credentials ----
export function useCredentials() {
  return useQuery({
    queryKey: queryKeys.credentials(),
    queryFn: () => {
      console.log("[hooks:useCredentials] fetching credentials");
      return gmailApi.getCredentials();
    },
    staleTime: STALE_TIME,
  });
}

// ---- Accounts ----
export function useAccounts() {
  const qc = useQueryClient();

  // Account edits (name/color) can happen in the Settings window, which has its
  // own QueryClient — listen for the backend broadcast so every window refreshes.
  useEffect(() => {
    const unsubscribe = window.glazeAPI.glaze.ipc.onNotification(
      "gmail:accounts-changed",
      () => {
        void qc.invalidateQueries({ queryKey: queryKeys.accounts() });
      },
    );
    return unsubscribe;
  }, [qc]);

  return useQuery<GmailAccount[]>({
    queryKey: queryKeys.accounts(),
    queryFn: () => {
      console.log("[hooks:useAccounts] fetching accounts");
      return gmailApi.listAccounts();
    },
    staleTime: STALE_TIME,
  });
}

export function useUpdateAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { accountId: string; displayName?: string; color?: string }) => {
      console.log("[hooks:useUpdateAccount] updating account", params);
      return gmailApi.updateAccount(params);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.accounts() });
    },
  });
}

// ---- Labels ----
export function useLabels(accountId: string | null) {
  return useQuery<GmailLabel[]>({
    queryKey: queryKeys.labels(accountId ?? ""),
    queryFn: () => {
      console.log("[hooks:useLabels] fetching labels", { accountId });
      return gmailApi.listLabels(accountId!);
    },
    enabled: accountId != null,
    staleTime: STALE_TIME,
  });
}

export function useCreateLabel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ accountId, name }: { accountId: string; name: string }) => {
      console.log("[hooks:useCreateLabel] creating label", { accountId, name });
      return gmailApi.createLabel(accountId, name);
    },
    onSuccess: (_data, { accountId }) => {
      void qc.invalidateQueries({ queryKey: queryKeys.labels(accountId) });
    },
  });
}

// ---- Messages (paginated) ----
export function useMessages(
  accountId: string | null,
  labelId?: string,
  q?: string,
) {
  return useInfiniteQuery<
    ListMessagesResult,
    Error,
    InfiniteData<ListMessagesResult>,
    ReturnType<typeof queryKeys.messages>,
    string | undefined
  >({
    queryKey: queryKeys.messages(accountId ?? "", labelId, q),
    queryFn: ({ pageParam }) => {
      console.log("[hooks:useMessages] fetching messages", {
        accountId,
        labelId,
        q,
        pageToken: pageParam,
      });
      return gmailApi.listMessages({
        accountId: accountId!,
        labelIds: labelId ? [labelId] : undefined,
        q: q || undefined,
        pageToken: pageParam,
        maxResults: 50,
      });
    },
    initialPageParam: undefined,
    getNextPageParam: (lastPage) => lastPage.nextPageToken,
    enabled: accountId != null,
    staleTime: STALE_TIME,
  });
}

// ---- Combined (cross-account) views ----

/**
 * Cross-account message list for the Combined mailbox. `selections` is the set
 * of (accountId, labelId) pairs to union; `viewId` keys the cache per view.
 */
export function useCombinedMessages(
  selections: LabelSelection[],
  viewId: string,
  enabled = true,
) {
  return useInfiniteQuery<
    ListMessagesResult,
    Error,
    InfiniteData<ListMessagesResult>,
    ReturnType<typeof queryKeys.combinedMessages>,
    string | undefined
  >({
    queryKey: queryKeys.combinedMessages(viewId, selections),
    queryFn: ({ pageParam }) => {
      console.log("[hooks:useCombinedMessages] fetching", {
        viewId,
        selectionCount: selections.length,
        pageToken: pageParam,
      });
      return gmailApi.listCombinedMessages({
        selections,
        pageToken: pageParam,
        maxResults: 50,
      });
    },
    initialPageParam: undefined,
    getNextPageParam: (lastPage) => lastPage.nextPageToken,
    enabled: enabled && selections.length > 0,
    staleTime: STALE_TIME,
  });
}

/** Full label list per account, keyed by accountId, for the view-editor picker. */
export function useAllAccountLabels(
  accountIds: string[],
  enabled = true,
): { accountId: string; labels: GmailLabel[]; isLoading: boolean }[] {
  const results = useQueries({
    queries: accountIds.map((id) => ({
      queryKey: queryKeys.labels(id),
      queryFn: () => gmailApi.listLabels(id),
      enabled,
      staleTime: STALE_TIME,
    })),
  });
  return accountIds.map((id, i) => ({
    accountId: id,
    labels: (results[i]?.data as GmailLabel[] | undefined) ?? [],
    isLoading: results[i]?.isLoading ?? false,
  }));
}

/**
 * Resolves a message's label id back to its GmailLabel across accounts.
 * Fetches labels for each account and returns a lookup keyed by
 * `${accountId}:${labelId}` (label ids differ per account).
 */
export function useLabelResolver(accountIds: string[]): (
  accountId: string | undefined,
  labelId: string,
) => GmailLabel | undefined {
  const results = useQueries({
    queries: accountIds.map((id) => ({
      queryKey: queryKeys.labels(id),
      queryFn: () => gmailApi.listLabels(id),
      staleTime: STALE_TIME,
    })),
  });

  const map = new Map<string, GmailLabel>();
  results.forEach((r, i) => {
    const acc = accountIds[i];
    for (const label of (r.data as GmailLabel[] | undefined) ?? []) {
      map.set(`${acc}:${label.id}`, label);
    }
  });

  return (accountId, labelId) =>
    accountId ? map.get(`${accountId}:${labelId}`) : undefined;
}

// ---- Message Detail ----
export function useMessage(accountId: string | null, messageId: string | null) {
  return useQuery<GmailMessageDetail>({
    queryKey: queryKeys.message(accountId ?? "", messageId ?? ""),
    queryFn: () => {
      console.log("[hooks:useMessage] fetching message", {
        accountId,
        messageId,
      });
      return gmailApi.getMessage(accountId!, messageId!);
    },
    enabled: accountId != null && messageId != null,
    staleTime: STALE_TIME,
  });
}

// ---- Optimistic update helpers ----
//
// Mutations below patch the cache in `onMutate` so the UI reacts instantly
// (star/read/archive/trash felt laggy waiting on the Gmail round trip),
// then reconcile with the server-confirmed state in `onSuccess`/`onError`.
// The label-count delta math mirrors the backend's local-cache recompute in
// `mail-store.ts`'s `applyLabelChange`/`deleteMessage`, so sidebar/header
// unread badges move in lockstep with the message list instead of only
// updating once the next label sync happens.

type LabelCountDelta = { total: number; unread: number };

function computeLabelCountDeltas(
  priorLabelIds: string[],
  addLabelIds: string[],
  removeLabelIds: string[],
): Map<string, LabelCountDelta> {
  const priorUnread = priorLabelIds.includes("UNREAD");
  const labelSet = new Set(priorLabelIds);
  for (const lid of removeLabelIds) labelSet.delete(lid);
  for (const lid of addLabelIds) labelSet.add(lid);
  const newLabelIds = [...labelSet];
  const newUnread = newLabelIds.includes("UNREAD");

  const deltas = new Map<string, LabelCountDelta>();
  const bump = (labelId: string, total: number, unread: number) => {
    const cur = deltas.get(labelId) ?? { total: 0, unread: 0 };
    deltas.set(labelId, { total: cur.total + total, unread: cur.unread + unread });
  };

  for (const lid of addLabelIds) {
    if (!priorLabelIds.includes(lid)) bump(lid, 1, newUnread ? 1 : 0);
  }
  for (const lid of removeLabelIds) {
    if (priorLabelIds.includes(lid)) bump(lid, -1, priorUnread ? -1 : 0);
  }
  // Toggling UNREAD itself changes the unread count of every *other* label the
  // message already carries (Gmail's per-label unread counters aggregate across
  // all labels on a message), so sweep those separately from the add/remove diff.
  if (priorUnread !== newUnread) {
    const sign = newUnread ? 1 : -1;
    for (const lid of newLabelIds) {
      if (lid === "UNREAD" || addLabelIds.includes(lid) || removeLabelIds.includes(lid)) continue;
      bump(lid, 0, sign);
    }
  }
  return deltas;
}

function applyLabelCountDeltas(
  labels: GmailLabel[] | undefined,
  deltas: Map<string, LabelCountDelta>,
): GmailLabel[] | undefined {
  if (!labels || deltas.size === 0) return labels;
  return labels.map((l) => {
    const delta = deltas.get(l.id);
    if (!delta) return l;
    return {
      ...l,
      total: Math.max(0, (l.total ?? 0) + delta.total),
      unread: Math.max(0, (l.unread ?? 0) + delta.unread),
    };
  });
}

function messagesFromInfiniteData(
  data: InfiniteData<ListMessagesResult> | undefined,
): GmailMessageSummary[] {
  return data?.pages.flatMap((p) => p.messages) ?? [];
}

function patchMessageInInfiniteData(
  data: InfiniteData<ListMessagesResult> | undefined,
  messageId: string,
  patch: (m: GmailMessageSummary) => GmailMessageSummary,
): InfiniteData<ListMessagesResult> | undefined {
  if (!data) return data;
  return {
    ...data,
    pages: data.pages.map((page) => ({
      ...page,
      messages: page.messages.map((m) => (m.id === messageId ? patch(m) : m)),
    })),
  };
}

function removeMessageFromInfiniteData(
  data: InfiniteData<ListMessagesResult> | undefined,
  messageId: string,
): InfiniteData<ListMessagesResult> | undefined {
  if (!data) return data;
  return {
    ...data,
    pages: data.pages.map((page) => ({
      ...page,
      messages: page.messages.filter((m) => m.id !== messageId),
    })),
  };
}

// ---- Mutations ----

export function useAddAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => {
      console.log("[hooks:useAddAccount] adding account");
      return gmailApi.addAccount();
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.accounts() });
    },
  });
}

export function useRemoveAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (accountId: string) => {
      console.log("[hooks:useRemoveAccount] removing account", { accountId });
      return gmailApi.removeAccount(accountId);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.accounts() });
    },
  });
}

export function useModifyMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: ModifyMessageParams) => {
      console.log("[hooks:useModifyMessage] modifying message", params);
      return gmailApi.modifyMessage(params);
    },
    onMutate: async (params) => {
      const { accountId, messageId, addLabelIds = [], removeLabelIds = [] } = params;
      const messageKey = queryKeys.message(accountId, messageId);
      const labelsKey = queryKeys.labels(accountId);

      await Promise.all([
        qc.cancelQueries({ queryKey: messageKey }),
        qc.cancelQueries({ queryKey: ["gmail:messages", accountId] }),
        qc.cancelQueries({ queryKey: ["gmail:combinedMessages"] }),
        qc.cancelQueries({ queryKey: labelsKey }),
      ]);

      const prevMessage = qc.getQueryData<GmailMessageDetail>(messageKey);
      const prevMessagesQueries = qc.getQueriesData<InfiniteData<ListMessagesResult>>({
        queryKey: ["gmail:messages", accountId],
      });
      const prevCombinedQueries = qc.getQueriesData<InfiniteData<ListMessagesResult>>({
        queryKey: ["gmail:combinedMessages"],
      });
      const prevLabels = qc.getQueryData<GmailLabel[]>(labelsKey);

      const priorLabelIds =
        prevMessage?.labelIds ??
        prevMessagesQueries.flatMap(([, data]) => messagesFromInfiniteData(data)).find((m) => m.id === messageId)
          ?.labelIds ??
        prevCombinedQueries.flatMap(([, data]) => messagesFromInfiniteData(data)).find((m) => m.id === messageId)
          ?.labelIds ??
        [];

      const applyPatch = (m: GmailMessageSummary): GmailMessageSummary => {
        const labelSet = new Set(m.labelIds);
        for (const lid of removeLabelIds) labelSet.delete(lid);
        for (const lid of addLabelIds) labelSet.add(lid);
        const labelIds = [...labelSet];
        return {
          ...m,
          labelIds,
          unread: labelIds.includes("UNREAD"),
          starred: labelIds.includes("STARRED"),
        };
      };

      if (prevMessage) qc.setQueryData(messageKey, applyPatch(prevMessage));
      qc.setQueriesData(
        { queryKey: ["gmail:messages", accountId] },
        (old: InfiniteData<ListMessagesResult> | undefined) =>
          patchMessageInInfiniteData(old, messageId, applyPatch),
      );
      qc.setQueriesData(
        { queryKey: ["gmail:combinedMessages"] },
        (old: InfiniteData<ListMessagesResult> | undefined) =>
          patchMessageInInfiniteData(old, messageId, applyPatch),
      );

      const deltas = computeLabelCountDeltas(priorLabelIds, addLabelIds, removeLabelIds);
      qc.setQueryData<GmailLabel[]>(labelsKey, (old) => applyLabelCountDeltas(old, deltas));

      return { messageKey, labelsKey, prevMessage, prevMessagesQueries, prevCombinedQueries, prevLabels };
    },
    onError: (_err, _params, context) => {
      if (!context) return;
      if (context.prevMessage) qc.setQueryData(context.messageKey, context.prevMessage);
      for (const [key, data] of context.prevMessagesQueries) qc.setQueryData(key, data);
      for (const [key, data] of context.prevCombinedQueries) qc.setQueryData(key, data);
      if (context.prevLabels) qc.setQueryData(context.labelsKey, context.prevLabels);
    },
    onSuccess: (_data, params) => {
      void qc.invalidateQueries({
        queryKey: queryKeys.message(params.accountId, params.messageId),
      });
      void qc.invalidateQueries({
        queryKey: ["gmail:messages", params.accountId],
      });
      // Combined ("All Inboxes") lists are keyed by viewId, not accountId, so the
      // prefix invalidation above never reaches them — without this, read/unread
      // and star changes never show up there until the 30s staleTime lapses.
      void qc.invalidateQueries({ queryKey: ["gmail:combinedMessages"] });
      // Reconcile the optimistic label-count patch with the backend's own
      // recompute (mail-store.ts), which is the source of truth.
      void qc.invalidateQueries({ queryKey: queryKeys.labels(params.accountId) });
    },
  });
}

export function useTrashMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      accountId,
      messageId,
    }: {
      accountId: string;
      messageId: string;
    }) => {
      console.log("[hooks:useTrashMessage] trashing message", {
        accountId,
        messageId,
      });
      return gmailApi.trashMessage(accountId, messageId);
    },
    onMutate: async ({ accountId, messageId }) => {
      const labelsKey = queryKeys.labels(accountId);
      await Promise.all([
        qc.cancelQueries({ queryKey: ["gmail:messages", accountId] }),
        qc.cancelQueries({ queryKey: ["gmail:combinedMessages"] }),
        qc.cancelQueries({ queryKey: labelsKey }),
      ]);

      const prevMessagesQueries = qc.getQueriesData<InfiniteData<ListMessagesResult>>({
        queryKey: ["gmail:messages", accountId],
      });
      const prevCombinedQueries = qc.getQueriesData<InfiniteData<ListMessagesResult>>({
        queryKey: ["gmail:combinedMessages"],
      });
      const prevLabels = qc.getQueryData<GmailLabel[]>(labelsKey);

      const priorMessage =
        prevMessagesQueries.flatMap(([, data]) => messagesFromInfiniteData(data)).find((m) => m.id === messageId) ??
        prevCombinedQueries.flatMap(([, data]) => messagesFromInfiniteData(data)).find((m) => m.id === messageId);

      qc.setQueriesData(
        { queryKey: ["gmail:messages", accountId] },
        (old: InfiniteData<ListMessagesResult> | undefined) => removeMessageFromInfiniteData(old, messageId),
      );
      qc.setQueriesData(
        { queryKey: ["gmail:combinedMessages"] },
        (old: InfiniteData<ListMessagesResult> | undefined) => removeMessageFromInfiniteData(old, messageId),
      );

      if (priorMessage) {
        const deltas = new Map<string, LabelCountDelta>(
          priorMessage.labelIds.map((lid) => [lid, { total: -1, unread: priorMessage.unread ? -1 : 0 }]),
        );
        qc.setQueryData<GmailLabel[]>(labelsKey, (old) => applyLabelCountDeltas(old, deltas));
      }

      return { labelsKey, prevMessagesQueries, prevCombinedQueries, prevLabels };
    },
    onError: (_err, _vars, context) => {
      if (!context) return;
      for (const [key, data] of context.prevMessagesQueries) qc.setQueryData(key, data);
      for (const [key, data] of context.prevCombinedQueries) qc.setQueryData(key, data);
      if (context.prevLabels) qc.setQueryData(context.labelsKey, context.prevLabels);
    },
    onSuccess: (_data, { accountId }) => {
      void qc.invalidateQueries({ queryKey: ["gmail:messages", accountId] });
      void qc.invalidateQueries({ queryKey: ["gmail:combinedMessages"] });
      void qc.invalidateQueries({ queryKey: queryKeys.labels(accountId) });
    },
  });
}

export function useSendMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: SendMessageParams) => {
      console.log("[hooks:useSendMessage] sending message", {
        to: params.to,
        subject: params.subject,
      });
      return gmailApi.sendMessage(params);
    },
    onSuccess: (_data, params) => {
      void qc.invalidateQueries({
        queryKey: ["gmail:messages", params.accountId],
      });
    },
  });
}

// ---- Local-first sync ----

/**
 * Drives background sync for the active account: starts a sync when the
 * account changes, polls progress while syncing, and invalidates the message
 * and label queries as the local store fills in so views refresh live.
 * Returns the current sync status for display.
 */
export function useAccountSync(accountId: string | null): SyncStatus | null {
  const qc = useQueryClient();

  const statusQuery = useQuery<SyncStatus>({
    queryKey: ["gmail:syncStatus", accountId],
    queryFn: () => gmailApi.getSyncStatus(accountId!),
    enabled: accountId != null,
    // Idle poll (vs false) so timer-driven backend syncs are still noticed.
    refetchInterval: (query) => (query.state.data?.syncing ? 1500 : 10_000),
  });

  // Start a sync whenever the active account changes.
  useEffect(() => {
    if (!accountId) return;
    console.log("[hooks:useAccountSync] starting sync", { accountId });
    void gmailApi.syncAccount(accountId).then(() => {
      void qc.invalidateQueries({ queryKey: ["gmail:syncStatus", accountId] });
    });
  }, [accountId, qc]);

  // Refresh views as sync progresses or finishes (lastSyncAt catches syncs
  // that start and finish entirely between polls).
  const prevRef = useRef<{ synced: number; syncing: boolean; lastSyncAt: number | null } | null>(null);
  useEffect(() => {
    const status = statusQuery.data;
    if (!status || !accountId) return;
    const prev = prevRef.current;
    const progressed =
      prev != null &&
      (status.synced !== prev.synced ||
        (prev.syncing && !status.syncing) ||
        status.lastSyncAt !== prev.lastSyncAt);
    if (progressed) {
      void qc.invalidateQueries({ queryKey: ["gmail:messages", accountId] });
      void qc.invalidateQueries({ queryKey: queryKeys.labels(accountId) });
    }
    prevRef.current = { synced: status.synced, syncing: status.syncing, lastSyncAt: status.lastSyncAt };
  }, [statusQuery.data, accountId, qc]);

  return statusQuery.data ?? null;
}

/**
 * Same as `useAccountSync` but for every account at once — the Combined mailbox
 * has no single "active account" to drive `useAccountSync`, so its per-account
 * label counts (used by the mailbox header) would otherwise never refresh once
 * the background sync fills them in.
 */
export function useSyncAccountLabels(accountIds: string[], enabled: boolean): void {
  const qc = useQueryClient();

  const results = useQueries({
    queries: accountIds.map((id) => ({
      queryKey: ["gmail:syncStatus", id],
      queryFn: () => gmailApi.getSyncStatus(id),
      enabled,
      refetchInterval: (query: { state: { data?: SyncStatus } }) =>
        query.state.data?.syncing ? 1500 : 10_000,
    })),
  });

  const accountIdsKey = accountIds.join(",");
  useEffect(() => {
    if (!enabled) return;
    for (const id of accountIdsKey ? accountIdsKey.split(",") : []) {
      void gmailApi.syncAccount(id);
    }
  }, [enabled, accountIdsKey]);

  const prevRef = useRef<Map<string, { synced: number; syncing: boolean; lastSyncAt: number | null }>>(
    new Map(),
  );
  const progressKey = results
    .map((r) => {
      const s = r.data as SyncStatus | undefined;
      return s ? `${s.synced}:${s.syncing}:${s.lastSyncAt ?? 0}` : "";
    })
    .join(",");
  useEffect(() => {
    if (!enabled) return;
    let anyProgressed = false;
    results.forEach((r, i) => {
      const accountId = accountIds[i];
      const status = r.data as SyncStatus | undefined;
      if (!status) return;
      const prev = prevRef.current.get(accountId);
      const progressed =
        prev != null &&
        (status.synced !== prev.synced ||
          (prev.syncing && !status.syncing) ||
          status.lastSyncAt !== prev.lastSyncAt);
      if (progressed) {
        anyProgressed = true;
        void qc.invalidateQueries({ queryKey: queryKeys.labels(accountId) });
      }
      prevRef.current.set(accountId, {
        synced: status.synced,
        syncing: status.syncing,
        lastSyncAt: status.lastSyncAt,
      });
    });
    // The combined list isn't reachable by any per-account invalidation.
    if (anyProgressed) {
      void qc.invalidateQueries({ queryKey: ["gmail:combinedMessages"] });
    }
  }, [progressKey, enabled, accountIdsKey, qc]);
}

export function useGetAttachment() {
  return useMutation({
    mutationFn: (params: {
      accountId: string;
      messageId: string;
      attachmentId: string;
      filename: string;
      mimeType: string;
    }) => {
      console.log("[hooks:useGetAttachment] downloading attachment", {
        filename: params.filename,
      });
      return gmailApi.getAttachment(params);
    },
  });
}
