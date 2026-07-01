import {
  useQuery,
  useMutation,
  useInfiniteQuery,
  useQueryClient,
  type InfiniteData,
} from "@tanstack/react-query";
import { gmailApi, type ModifyMessageParams, type SendMessageParams } from "./api";
import type { GmailAccount, GmailLabel, GmailMessageDetail } from "./types";
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
