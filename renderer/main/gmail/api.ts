import type {
  GmailAccount,
  GmailLabel,
  GmailMessageSummary,
  GmailMessageDetail,
} from "./types";

const ipc = <T = unknown>(channel: string, params?: unknown): Promise<T> =>
  window.glazeAPI.glaze.ipc.invoke<T>(channel, params);

export type CredentialsResult = { hasCredentials: boolean; clientId: string };
export type SetCredentialsParams = { clientId: string; clientSecret: string };

export type ListMessagesParams = {
  accountId: string;
  labelIds?: string[];
  q?: string;
  pageToken?: string;
  maxResults?: number;
};

export type ListMessagesResult = {
  messages: GmailMessageSummary[];
  nextPageToken?: string;
};

export type ModifyMessageParams = {
  accountId: string;
  messageId: string;
  addLabelIds?: string[];
  removeLabelIds?: string[];
};

export type SendMessageParams = {
  accountId: string;
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  body: string;
};

export type GetAttachmentParams = {
  accountId: string;
  messageId: string;
  attachmentId: string;
  filename: string;
  mimeType: string;
};

export type GetAttachmentResult = { saved: boolean; path?: string };

export const gmailApi = {
  getCredentials: (): Promise<CredentialsResult> => ipc("gmail:getCredentials"),

  setCredentials: (params: SetCredentialsParams): Promise<CredentialsResult> =>
    ipc("gmail:setCredentials", params),

  listAccounts: (): Promise<GmailAccount[]> => ipc("gmail:listAccounts"),

  addAccount: (): Promise<GmailAccount> => ipc("gmail:addAccount"),

  removeAccount: (accountId: string): Promise<{ ok: boolean }> =>
    ipc("gmail:removeAccount", { accountId }),

  listLabels: (accountId: string): Promise<GmailLabel[]> =>
    ipc("gmail:listLabels", { accountId }),

  createLabel: (accountId: string, name: string): Promise<GmailLabel> =>
    ipc("gmail:createLabel", { accountId, name }),

  listMessages: (params: ListMessagesParams): Promise<ListMessagesResult> =>
    ipc("gmail:listMessages", params),

  getMessage: (accountId: string, messageId: string): Promise<GmailMessageDetail> =>
    ipc("gmail:getMessage", { accountId, messageId }),

  modifyMessage: (params: ModifyMessageParams): Promise<{ ok: boolean }> =>
    ipc("gmail:modifyMessage", params),

  trashMessage: (accountId: string, messageId: string): Promise<{ ok: boolean }> =>
    ipc("gmail:trashMessage", { accountId, messageId }),

  sendMessage: (params: SendMessageParams): Promise<{ ok: boolean }> =>
    ipc("gmail:sendMessage", params),

  getAttachment: (params: GetAttachmentParams): Promise<GetAttachmentResult> =>
    ipc("gmail:getAttachment", params),
};
