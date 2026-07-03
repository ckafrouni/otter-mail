import type {
  ComposeAttachment,
  ContactSuggestion,
  GmailAccount,
  GmailLabel,
  GmailMessageSummary,
  GmailMessageDetail,
  MailView,
  SyncStatus,
  ViewRule,
} from "./types";

const ipc = <T = unknown>(channel: string, params?: unknown): Promise<T> =>
  window.glazeAPI.glaze.ipc.invoke<T>(channel, params);

export type CredentialsResult = { hasCredentials: boolean; clientId: string };
export type SetCredentialsParams = { clientId: string; clientSecret: string };

export type ListMessagesParams = {
  accountId: string;
  labelIds?: string[];
  pageToken?: string;
  maxResults?: number;
};

export type ListMessagesResult = {
  messages: GmailMessageSummary[];
  nextPageToken?: string;
};

export type SearchMessagesParams = {
  q: string;
  /** Omit to search every account (Combined mode / command palette). */
  accountId?: string;
  pageToken?: string;
  maxResults?: number;
};

export type ListCombinedMessagesParams = {
  rules: ViewRule[];
  pageToken?: string;
  maxResults?: number;
};

export type CombinedCounts = { total: number; unread: number };

export type ModifyMessageParams = {
  accountId: string;
  messageId: string;
  addLabelIds?: string[];
  removeLabelIds?: string[];
};

export type ModifyThreadParams = {
  accountId: string;
  threadId: string;
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
  /** HTML alternative body — sent as multipart/alternative when present. */
  bodyHtml?: string;
  /** Threads the sent message into an existing conversation (replies). */
  threadId?: string;
  /** Original message a reply targets; backend resolves In-Reply-To/References. */
  replyToMessageId?: string;
  attachments?: ComposeAttachment[];
};

export type SaveDraftParams = {
  accountId: string;
  draftId?: string;
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  body: string;
  threadId?: string;
  attachments?: ComposeAttachment[];
};

export type GetAttachmentParams = {
  accountId: string;
  messageId: string;
  attachmentId: string;
  filename: string;
  mimeType: string;
};

export type GetAttachmentResult = { saved: boolean; path?: string };

export type GetAttachmentDataParams = {
  accountId: string;
  messageId: string;
  attachmentId: string;
};

export type PickAttachmentsResult = { attachments: ComposeAttachment[]; error?: string };

export type AttachmentFileParams = {
  accountId: string;
  messageId: string;
  attachmentId: string;
  filename: string;
};

export type UpdateAccountParams = {
  accountId: string;
  displayName?: string;
  color?: string;
};

export type NotificationsMode = "off" | "inbox" | "all";

export type SyncSettings = {
  syncIntervalSeconds: number;
  notificationsMode: NotificationsMode;
};

export type SaveViewParams = { id?: string; name: string; rules: ViewRule[]; mailbox?: string };

export type SettingsPane = "general" | "accounts" | "views" | "oauth";
export type SettingsTarget = { pane: SettingsPane; viewId?: string | null; mailbox?: string | null };

export const gmailApi = {
  getCredentials: (): Promise<CredentialsResult> => ipc("gmail:getCredentials"),

  setCredentials: (params: SetCredentialsParams): Promise<CredentialsResult> =>
    ipc("gmail:setCredentials", params),

  listAccounts: (): Promise<GmailAccount[]> => ipc("gmail:listAccounts"),

  addAccount: (): Promise<GmailAccount> => ipc("gmail:addAccount"),

  removeAccount: (accountId: string): Promise<{ ok: boolean }> =>
    ipc("gmail:removeAccount", { accountId }),

  updateAccount: (params: UpdateAccountParams): Promise<GmailAccount> =>
    ipc("gmail:updateAccount", params),

  listLabels: (accountId: string): Promise<GmailLabel[]> =>
    ipc("gmail:listLabels", { accountId }),

  createLabel: (accountId: string, name: string): Promise<GmailLabel> =>
    ipc("gmail:createLabel", { accountId, name }),

  listMessages: (params: ListMessagesParams): Promise<ListMessagesResult> =>
    ipc("gmail:listMessages", params),

  listCombinedMessages: (
    params: ListCombinedMessagesParams,
  ): Promise<ListMessagesResult> => ipc("gmail:listCombinedMessages", params),

  searchMessages: (params: SearchMessagesParams): Promise<ListMessagesResult> =>
    ipc("gmail:searchMessages", params),

  countCombinedMessages: (params: { rules: ViewRule[] }): Promise<CombinedCounts> =>
    ipc("gmail:countCombinedMessages", params),

  getMessage: (accountId: string, messageId: string): Promise<GmailMessageDetail> =>
    ipc("gmail:getMessage", { accountId, messageId }),

  modifyMessage: (params: ModifyMessageParams): Promise<{ ok: boolean }> =>
    ipc("gmail:modifyMessage", params),

  trashMessage: (accountId: string, messageId: string): Promise<{ ok: boolean }> =>
    ipc("gmail:trashMessage", { accountId, messageId }),

  getThread: (accountId: string, threadId: string): Promise<GmailMessageSummary[]> =>
    ipc("gmail:getThread", { accountId, threadId }),

  modifyThread: (params: ModifyThreadParams): Promise<{ ok: boolean }> =>
    ipc("gmail:modifyThread", params),

  trashThread: (accountId: string, threadId: string): Promise<{ ok: boolean }> =>
    ipc("gmail:trashThread", { accountId, threadId }),

  untrashThread: (accountId: string, threadId: string): Promise<{ ok: boolean }> =>
    ipc("gmail:untrashThread", { accountId, threadId }),

  untrashMessage: (accountId: string, messageId: string): Promise<{ ok: boolean }> =>
    ipc("gmail:untrashMessage", { accountId, messageId }),

  sendMessage: (params: SendMessageParams): Promise<{ ok: boolean }> =>
    ipc("gmail:sendMessage", params),

  saveDraft: (params: SaveDraftParams): Promise<{ draftId: string }> =>
    ipc("gmail:saveDraft", params),

  deleteDraft: (accountId: string, draftId: string): Promise<{ ok: boolean }> =>
    ipc("gmail:deleteDraft", { accountId, draftId }),

  getAttachment: (params: GetAttachmentParams): Promise<GetAttachmentResult> =>
    ipc("gmail:getAttachment", params),

  getAttachmentData: (
    params: GetAttachmentDataParams,
  ): Promise<{ base64: string; size: number }> => ipc("gmail:getAttachmentData", params),

  openAttachment: (params: AttachmentFileParams): Promise<{ ok: boolean }> =>
    ipc("gmail:openAttachment", params),

  dragAttachment: (params: AttachmentFileParams): Promise<{ ok: boolean }> =>
    ipc("gmail:dragAttachment", params),

  pickAttachments: (existingBytes: number): Promise<PickAttachmentsResult> =>
    ipc("gmail:pickAttachments", { existingBytes }),

  suggestContacts: (params: { q: string; limit?: number }): Promise<ContactSuggestion[]> =>
    ipc("gmail:suggestContacts", params),

  syncAccount: (accountId: string): Promise<SyncStatus> =>
    ipc("gmail:syncAccount", { accountId }),

  getSyncStatus: (accountId: string): Promise<SyncStatus> =>
    ipc("gmail:getSyncStatus", { accountId }),

  getSenderAvatar: (accountId: string, email: string): Promise<{ dataUrl: string | null }> =>
    ipc("gmail:getSenderAvatar", { accountId, email }),

  getSyncSettings: (): Promise<SyncSettings> => ipc("gmail:getSyncSettings"),

  setSyncSettings: (params: Partial<SyncSettings>): Promise<SyncSettings> =>
    ipc("gmail:setSyncSettings", params),

  listViews: (): Promise<MailView[]> => ipc("gmail:listViews"),

  saveView: (params: SaveViewParams): Promise<MailView> => ipc("gmail:saveView", params),

  deleteView: (viewId: string): Promise<{ ok: boolean }> => ipc("gmail:deleteView", { viewId }),

  resetView: (viewId: string): Promise<{ ok: boolean }> => ipc("gmail:resetView", { viewId }),

  importViews: (views: MailView[]): Promise<MailView[]> => ipc("gmail:importViews", { views }),

  openSettings: (target?: SettingsTarget): Promise<void> => ipc("window:openSettings", target),

  getSettingsTarget: (): Promise<SettingsTarget | null> => ipc("window:getSettingsTarget"),
};
