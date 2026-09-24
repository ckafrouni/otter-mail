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
  /** May be empty when structured filters are set. */
  q: string;
  /** Omit to search every account (Combined mode / command palette). */
  accountId?: string;
  /** Restrict to messages carrying this label (view filter, account mode). */
  labelId?: string;
  /** Restrict to messages matching these rules (view filter, Combined mode). */
  rules?: ViewRule[];
  starred?: boolean;
  important?: boolean;
  hasAttachments?: boolean;
  /** Only messages newer than N days. */
  withinDays?: number;
  pageToken?: string;
  maxResults?: number;
};

export type ListCombinedMessagesParams = {
  rules: ViewRule[];
  pageToken?: string;
  maxResults?: number;
};

export type CombinedCounts = { total: number; unread: number };

/** Parsed mailto: link, delivered when OtterMail is the default mail app. */
export type MailtoTarget = { to: string; cc: string; subject: string; body: string };

/** An installed mailto: handler (Settings default-mail dropdown). */
export type MailApp = { bundleId: string; name: string; path: string };
export type MailAppsResult = { apps: MailApp[]; defaultBundleId: string | null };

/** Hermes chat panel (built-in API server) state and stream events. */
export type ChatStatus = {
  configured: boolean;
  baseUrl: string | null;
  model: string | null;
  /** The server exposes the native Sessions API (/api/sessions). */
  sessions: boolean;
};
export type ChatEvent =
  | { requestId: string; type: "delta"; text: string }
  | { requestId: string; type: "tool"; name: string }
  | { requestId: string; type: "toolResult"; output: string }
  | { requestId: string; type: "done"; responseId: string | null }
  | { requestId: string; type: "error"; message: string };

/** An installed Hermes skill, for the composer's "/" picker. */
export type Skill = { name: string; description: string; category: string | null };

/** A persisted Hermes session (native Sessions API). */
export type ChatSession = {
  id: string;
  title: string | null;
  source: string;
  /** Epoch ms. */
  lastActive: number;
  messageCount: number;
  preview: string | null;
};

/** One stored session message, flattened for the transcript. */
export type ChatSessionMessage = {
  role: "user" | "assistant" | "tool" | "system";
  text: string;
  toolName?: string;
  toolCalls?: string[];
};

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
  bodyHtml?: string;
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
  signature?: string;
};

export type NotificationsMode = "off" | "inbox" | "all";

export type SyncSettings = {
  syncIntervalSeconds: number;
  notificationsMode: NotificationsMode;
  launchAtLogin: boolean;
  trayEnabled: boolean;
};

export type SaveViewParams = { id?: string; name: string; rules: ViewRule[]; mailbox?: string };

export type SettingsPane = "general" | "accounts" | "views" | "assistant";
export type SettingsTarget = {
  pane: SettingsPane;
  viewId?: string | null;
  mailbox?: string | null;
};

export const gmailApi = {
  listAccounts: (): Promise<GmailAccount[]> => ipc("gmail:listAccounts"),

  addAccount: (): Promise<GmailAccount> => ipc("gmail:addAccount"),

  removeAccount: (accountId: string): Promise<{ ok: boolean }> =>
    ipc("gmail:removeAccount", { accountId }),

  updateAccount: (params: UpdateAccountParams): Promise<GmailAccount> =>
    ipc("gmail:updateAccount", params),

  listLabels: (accountId: string): Promise<GmailLabel[]> => ipc("gmail:listLabels", { accountId }),

  createLabel: (accountId: string, name: string): Promise<GmailLabel> =>
    ipc("gmail:createLabel", { accountId, name }),

  updateLabel: (params: {
    accountId: string;
    labelId: string;
    name?: string;
    color?: { backgroundColor: string; textColor: string };
  }): Promise<{ ok: boolean }> => ipc("gmail:updateLabel", params),

  deleteLabel: (accountId: string, labelId: string): Promise<{ ok: boolean }> =>
    ipc("gmail:deleteLabel", { accountId, labelId }),

  listMessages: (params: ListMessagesParams): Promise<ListMessagesResult> =>
    ipc("gmail:listMessages", params),

  listCombinedMessages: (params: ListCombinedMessagesParams): Promise<ListMessagesResult> =>
    ipc("gmail:listCombinedMessages", params),

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

  deleteThreadsForever: (accountId: string, threadIds: string[]): Promise<{ ok: boolean }> =>
    ipc("gmail:deleteThreadsForever", { accountId, threadIds }),

  sendMessage: (params: SendMessageParams): Promise<{ ok: boolean }> =>
    ipc("gmail:sendMessage", params),

  saveDraft: (
    params: SaveDraftParams,
  ): Promise<{ draftId: string; messageId?: string; threadId?: string }> =>
    ipc("gmail:saveDraft", params),

  deleteDraft: (accountId: string, draftId: string): Promise<{ ok: boolean }> =>
    ipc("gmail:deleteDraft", { accountId, draftId }),

  getDraftForMessage: (
    accountId: string,
    messageId: string,
    threadId?: string,
  ): Promise<{ draftId: string | null }> =>
    ipc("gmail:getDraftForMessage", { accountId, messageId, threadId }),

  getAttachment: (params: GetAttachmentParams): Promise<GetAttachmentResult> =>
    ipc("gmail:getAttachment", params),

  getAttachmentData: (params: GetAttachmentDataParams): Promise<{ base64: string; size: number }> =>
    ipc("gmail:getAttachmentData", params),

  openComposeAttachment: (params: { name: string; base64: string }): Promise<{ ok: boolean }> =>
    ipc("gmail:openComposeAttachment", params),

  /** Fetch a remote email image server-side (bypasses the iframe's CORP block). */
  proxyImage: (url: string): Promise<{ dataUrl: string }> => ipc("gmail:proxyImage", { url }),

  openAttachment: (params: AttachmentFileParams): Promise<{ ok: boolean }> =>
    ipc("gmail:openAttachment", params),

  dragAttachment: (params: AttachmentFileParams): Promise<{ ok: boolean }> =>
    ipc("gmail:dragAttachment", params),

  pickAttachments: (existingBytes: number): Promise<PickAttachmentsResult> =>
    ipc("gmail:pickAttachments", { existingBytes }),

  suggestContacts: (params: { q: string; limit?: number }): Promise<ContactSuggestion[]> =>
    ipc("gmail:suggestContacts", params),

  syncAccount: (accountId: string): Promise<SyncStatus> => ipc("gmail:syncAccount", { accountId }),

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

  /** Cmd+click: open a single message in its own window. */
  openMessageWindow: (accountId: string, messageId: string): Promise<void> =>
    ipc("window:openMessage", { accountId, messageId }),

  takePendingMailto: (): Promise<MailtoTarget | null> => ipc("app:takePendingMailto"),

  getDefaultMailStatus: (): Promise<{ isDefault: boolean }> => ipc("app:getDefaultMailStatus"),

  /** No bundleId = register OtterMail (consent dialog); with one, hand the default to that app. */
  setDefaultMailApp: (bundleId?: string): Promise<{ ok: boolean }> =>
    ipc("app:setDefaultMailApp", bundleId ? { bundleId } : undefined),

  listMailApps: (): Promise<MailAppsResult> => ipc("app:listMailApps"),

  chatStatus: (): Promise<ChatStatus> => ipc("assistant:chatStatus"),

  chatConfigure: (params: { baseUrl: string; apiKey: string }): Promise<ChatStatus> =>
    ipc("assistant:chatConfigure", params),

  /**
   * Streams via the assistant:chatEvent broadcast; resolves when the turn ends.
   * With `sessionId` the turn runs in that native session; otherwise it chains
   * the legacy Responses API via `previousResponseId`.
   */
  chatSend: (params: {
    requestId: string;
    input: string;
    sessionId?: string;
    previousResponseId?: string;
  }): Promise<{ ok: boolean }> => ipc("assistant:chatSend", params),

  chatCancel: (requestId: string): Promise<{ ok: boolean }> =>
    ipc("assistant:chatCancel", { requestId }),

  chatSkills: (): Promise<Skill[]> => ipc("assistant:chatSkills"),

  chatSessionCreate: (params: { title?: string }): Promise<ChatSession> =>
    ipc("assistant:chatSessionCreate", params),

  chatSessionDelete: (sessionId: string): Promise<{ ok: boolean }> =>
    ipc("assistant:chatSessionDelete", { sessionId }),

  chatSessionRename: (sessionId: string, title: string): Promise<{ ok: boolean }> =>
    ipc("assistant:chatSessionRename", { sessionId, title }),

  chatSessionList: (params: { limit?: number } = {}): Promise<ChatSession[]> =>
    ipc("assistant:chatSessionList", params),

  chatSessionMessages: (sessionId: string): Promise<ChatSessionMessage[]> =>
    ipc("assistant:chatSessionMessages", { sessionId }),
};
