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
  AggregatedLabel,
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
  allUserLabels: () => ["gmail:allUserLabels"] as const,
  combinedMessages: (kind: string, labelNames?: string[]) =>
    ["gmail:combinedMessages", kind, labelNames] as const,
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
  return useQuery<GmailAccount[]>({
    queryKey: queryKeys.accounts(),
    queryFn: () => {
      console.log("[hooks:useAccounts] fetching accounts");
      return gmailApi.listAccounts();
    },
    staleTime: STALE_TIME,
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

export type CombinedQuery =
  | { kind: "inbox" }
  | { kind: "view"; viewId: string; labelNames: string[] };

export function useCombinedMessages(query: CombinedQuery, enabled = true) {
  const isView = query.kind === "view";
  const labelNames = isView ? query.labelNames : undefined;
  return useInfiniteQuery<
    ListMessagesResult,
    Error,
    InfiniteData<ListMessagesResult>,
    ReturnType<typeof queryKeys.combinedMessages>,
    string | undefined
  >({
    queryKey: queryKeys.combinedMessages(
      isView ? `view:${query.viewId}` : "inbox",
      labelNames,
    ),
    queryFn: ({ pageParam }) => {
      console.log("[hooks:useCombinedMessages] fetching", { query, pageToken: pageParam });
      return gmailApi.listCombinedMessages({
        labelIds: isView ? undefined : ["INBOX"],
        labelNames,
        pageToken: pageParam,
        maxResults: 50,
      });
    },
    initialPageParam: undefined,
    getNextPageParam: (lastPage) => lastPage.nextPageToken,
    enabled: enabled && (!isView || (labelNames?.length ?? 0) > 0),
    staleTime: STALE_TIME,
  });
}

export function useAllUserLabels(enabled = true) {
  return useQuery<AggregatedLabel[]>({
    queryKey: queryKeys.allUserLabels(),
    queryFn: () => {
      console.log("[hooks:useAllUserLabels] fetching aggregated labels");
      return gmailApi.listAllUserLabels();
    },
    enabled,
    staleTime: STALE_TIME,
  });
}

/**
 * Resolves a message's label id back to its GmailLabel across accounts.
 * Fetches labels for each account and returns a lookup keyed by
 * `${accountId}:${labelId}` (user-label ids differ per account).
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
    onSuccess: (_data, params) => {
      void qc.invalidateQueries({
        queryKey: queryKeys.message(params.accountId, params.messageId),
      });
      void qc.invalidateQueries({
        queryKey: ["gmail:messages", params.accountId],
      });
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
    onSuccess: (_data, { accountId }) => {
      void qc.invalidateQueries({
        queryKey: ["gmail:messages", accountId],
      });
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
    refetchInterval: (query) => (query.state.data?.syncing ? 1500 : false),
  });

  // Start a sync whenever the active account changes.
  useEffect(() => {
    if (!accountId) return;
    console.log("[hooks:useAccountSync] starting sync", { accountId });
    void gmailApi.syncAccount(accountId).then(() => {
      void qc.invalidateQueries({ queryKey: ["gmail:syncStatus", accountId] });
    });
  }, [accountId, qc]);

  // Refresh views as sync progresses or finishes.
  const prevRef = useRef<{ synced: number; syncing: boolean } | null>(null);
  useEffect(() => {
    const status = statusQuery.data;
    if (!status || !accountId) return;
    const prev = prevRef.current;
    const progressed =
      prev != null &&
      (status.synced !== prev.synced || (prev.syncing && !status.syncing));
    if (progressed) {
      void qc.invalidateQueries({ queryKey: ["gmail:messages", accountId] });
      void qc.invalidateQueries({ queryKey: queryKeys.labels(accountId) });
    }
    prevRef.current = { synced: status.synced, syncing: status.syncing };
  }, [statusQuery.data, accountId, qc]);

  return statusQuery.data ?? null;
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
