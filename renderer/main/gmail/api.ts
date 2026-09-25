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

/**
 * For calls that can outlast the 5s IPC timeout (file dialogs, big downloads):
 * the backend acknowledges at once and reports the outcome as a `task:done`
 * notification carrying our task id (see `runAsTask` in the gmail handlers).
 */
const task = <T>(channel: string, params: Record<string, unknown>): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const taskId = crypto.randomUUID();
    const off = window.glazeAPI.glaze.ipc.onNotification("task:done", (payload: unknown) => {
      const p = payload as { taskId?: string; result?: T; error?: string } | undefined;
      if (p?.taskId !== taskId) return;
      off();
      if (p.error) reject(new Error(p.error));
      else resolve(p.result as T);
    });
    ipc(channel, { ...params, taskId }).catch((err: unknown) => {
      off();
      reject(err);
    });
  });

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

export type RsvpResponse = "accepted" | "declined" | "tentative";

/** A calendar invitation found in a message (from its .ics). */
export type CalendarInvite = {
  uid: string;
  method: string;
  summary: string;
  start: string | null;
  end: string | null;
  allDay: boolean;
  location: string | null;
  organizer: { name: string; email: string } | null;
  sequence: number;
  response: RsvpResponse | "needsAction";
  /** False: this account hasn't granted calendar access (replies go by email). */
  calendarAccess: boolean;
  htmlLink: string | null;
  cancelled: boolean;
};

/** One page of Gmail's own search (conversation rows, newest first). */
export type GmailSearchResult = {
  messages: GmailMessageSummary[];
  /** Per-account cursors for the next page; undefined = no more results. */
  cursors?: Record<string, string | null>;
  /** Gmail's estimate of the total number of matches. */
  estimate: number;
  /** Gmail was unreachable: local results only. */
  offline?: boolean;
};

/** Parsed mailto: link, delivered when OtterMail is the default mail app. */
export type MailtoTarget = { to: string; cc: string; subject: string; body: string };

/** An installed mailto: handler (Settings default-mail dropdown). */
export type MailApp = { bundleId: string; name: string; path: string };
export type MailAppsResult = { apps: MailApp[]; defaultBundleId: string | null };

/*
 * Assistant providers (mirrors main/services/assistant/types.ts). A snapshot
 * is one provider's health; every provider streams the same ChatEvents.
 */
export type ProviderKind = "hermes" | "codex" | "claude";
export type ProviderState = "ready" | "warning" | "error" | "disabled";
export type ProviderOptionChoice = {
  id: string;
  label: string;
  description?: string;
  isDefault?: boolean;
};
/** A per-model option (Codex: Reasoning, Service Tier), like T3's option descriptors. */
export type ProviderModelOption = {
  id: "reasoningEffort" | "serviceTier";
  label: string;
  choices: ProviderOptionChoice[];
};
export type ProviderModel = {
  slug: string;
  name: string;
  /** Upstream provider behind an aggregating agent (Hermes: "OpenRouter"). */
  subProvider?: string;
  isDefault?: boolean;
  options?: ProviderModelOption[];
};
export type ProviderSnapshot = {
  kind: ProviderKind;
  displayName: string;
  enabled: boolean;
  installed: boolean;
  version: string | null;
  status: ProviderState;
  auth: {
    status: "authenticated" | "unauthenticated" | "unknown";
    label?: string;
    email?: string;
  };
  /** Epoch ms of the last check; null while the first check runs. */
  checkedAt: number | null;
  message?: string;
  models: ProviderModel[];
  model: string | null;
  /** Chats persist on the provider and can be listed/resumed. */
  sessions: boolean;
};
/** T3 Code's runtime modes: how much an agent may do without asking. */
export type RuntimeMode = "approval-required" | "auto-accept-edits" | "full-access";

export type ApprovalDecision = "once" | "session" | "always" | "deny";

/** An agent asking permission mid-turn (run a command, edit files, …). */
export type ApprovalRequest = {
  id: string;
  kind: "command" | "fileChange" | "permission" | "tool";
  title: string;
  detail?: string;
  reason?: string;
  choices: ApprovalDecision[];
};
export type ProviderSettingsView = {
  selected: ProviderKind;
  hermes: {
    enabled: boolean;
    baseUrl: string;
    agentModel: string;
    /** `provider::model`; empty → the gateway default. */
    model: string;
    reasoningEffort: string;
    serviceTier: string;
    sessions?: boolean;
  };
  claude: {
    enabled: boolean;
    binaryPath: string;
    homePath: string;
    model: string;
    reasoningEffort: string;
    serviceTier: string;
    runtimeMode: RuntimeMode;
  };
  codex: {
    enabled: boolean;
    binaryPath: string;
    homePath: string;
    launchArgs: string;
    model: string;
    reasoningEffort: string;
    serviceTier: string;
    runtimeMode: RuntimeMode;
  };
  hermesHasKey: boolean;
};
export type ProvidersState = {
  providers: ProviderSnapshot[];
  selected: ProviderKind;
  settings: ProviderSettingsView;
};
export type AssistantSettingsPatch = {
  selected?: ProviderKind;
  hermes?: { enabled?: boolean; model?: string; reasoningEffort?: string; serviceTier?: string };
  codex?: Partial<ProviderSettingsView["codex"]>;
  claude?: Partial<ProviderSettingsView["claude"]>;
};

export type ChatEvent =
  | { requestId: string; type: "session"; sessionId: string }
  | { requestId: string; type: "delta"; text: string }
  | { requestId: string; type: "tool"; name: string }
  | { requestId: string; type: "toolResult"; output: string }
  | { requestId: string; type: "approval"; approval: ApprovalRequest }
  | { requestId: string; type: "approvalResolved"; approvalId: string }
  | { requestId: string; type: "steerReturned"; text: string }
  | { requestId: string; type: "done"; responseId: string | null }
  | { requestId: string; type: "error"; message: string };

/** A file attached to an assistant turn (staged by the backend). */
export type ChatAttachment = {
  id: string;
  name: string;
  mime: string;
  size: number;
  path: string;
  kind: "image" | "file";
};

/** An installed agent skill, for the composer's "/" picker. */
export type Skill = { name: string; description: string; category: string | null; path?: string };

/** A persisted provider-side chat (Hermes session / Codex thread). */
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
  /** Stable per composer: the backend serializes its saves and remembers its
      draft id, so a timed-out first save never leads to a duplicate draft. */
  sessionKey?: string;
  /** The draft version this edit is based on: the backend refuses to
      overwrite a newer one (changed elsewhere) and reports a conflict. */
  expectMessageId?: string;
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  body: string;
  bodyHtml?: string;
  threadId?: string;
  attachments?: ComposeAttachment[];
};

export type SaveDraftResult =
  | { draftId: string; messageId?: string; threadId?: string }
  /** Edited elsewhere since `expectMessageId`: nothing was saved. */
  | { conflict: true; draftId: string; messageId: string }
  /** Sent or deleted elsewhere: nothing was saved. */
  | { gone: true; draftId: string };

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

export type SettingsPane =
  "general" | "appearance" | "keybindings" | "accounts" | "views" | "assistant";
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

  /** The calendar invitation in a message, with your current answer (null: none). */
  getCalendarInvite: (accountId: string, messageId: string): Promise<CalendarInvite | null> =>
    task("calendar:getInvite", { accountId, messageId }),

  /** RSVP to an invitation (Calendar API, or an email reply to the organizer). */
  respondToInvite: (
    accountId: string,
    messageId: string,
    response: RsvpResponse,
  ): Promise<CalendarInvite | null> =>
    task("calendar:respond", { accountId, messageId, response }),

  /** Gmail's own search (all operators, all mail) across the given accounts. */
  gmailSearch: (params: {
    q: string;
    accountIds: string[];
    cursors?: Record<string, string | null>;
  }): Promise<GmailSearchResult> => task("gmail:search", params),

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

  saveDraft: (params: SaveDraftParams): Promise<SaveDraftResult> => ipc("gmail:saveDraft", params),

  /** The message backing a draft right now; null = the draft is gone. */
  getDraftVersion: (accountId: string, draftId: string): Promise<{ messageId: string | null }> =>
    ipc("gmail:getDraftVersion", { accountId, draftId }),

  /** A draft's content at a given version (also refreshes the cache). */
  loadDraftVersion: (
    accountId: string,
    draftId: string,
    messageId: string,
  ): Promise<GmailMessageDetail> =>
    ipc("gmail:loadDraftVersion", { accountId, draftId, messageId }),

  deleteDraft: (accountId: string, draftId: string): Promise<{ ok: boolean }> =>
    ipc("gmail:deleteDraft", { accountId, draftId }),

  /** Deletes a composer's draft: by id when known, else whatever its session's
      saves created (even if that id never reached the renderer). */
  deleteSessionDraft: (
    accountId: string,
    sessionKey: string,
    draftId?: string,
  ): Promise<{ ok: boolean }> => ipc("gmail:deleteDraft", { accountId, sessionKey, draftId }),

  getDraftForMessage: (
    accountId: string,
    messageId: string,
    threadId?: string,
  ): Promise<{ draftId: string | null }> =>
    ipc("gmail:getDraftForMessage", { accountId, messageId, threadId }),

  getAttachment: (params: GetAttachmentParams): Promise<GetAttachmentResult> =>
    task("gmail:getAttachment", params),

  getAttachmentData: (params: GetAttachmentDataParams): Promise<{ base64: string; size: number }> =>
    task("gmail:getAttachmentData", params),

  openComposeAttachment: (params: { name: string; base64: string }): Promise<{ ok: boolean }> =>
    ipc("gmail:openComposeAttachment", params),

  /** Fetch a remote email image server-side (bypasses the iframe's CORP block). */
  proxyImage: (url: string): Promise<{ dataUrl: string }> => ipc("gmail:proxyImage", { url }),

  openAttachment: (params: AttachmentFileParams): Promise<{ ok: boolean }> =>
    task("gmail:openAttachment", params),

  dragAttachment: (params: AttachmentFileParams): Promise<{ ok: boolean }> =>
    task("gmail:dragAttachment", params),

  pickAttachments: (existingBytes: number): Promise<PickAttachmentsResult> =>
    task("gmail:pickAttachments", { existingBytes }),

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
  /** A conversation the menu-bar popover asked this window to open, if any. */
  takePendingOpenMessage: (): Promise<{ accountId: string; messageId: string } | null> =>
    ipc("window:takePendingOpenMessage"),

  takePendingMailto: (): Promise<MailtoTarget | null> => ipc("app:takePendingMailto"),

  getDefaultMailStatus: (): Promise<{ isDefault: boolean }> => ipc("app:getDefaultMailStatus"),

  /** No bundleId = register OtterMail (consent dialog); with one, hand the default to that app. */
  setDefaultMailApp: (bundleId?: string): Promise<{ ok: boolean }> =>
    ipc("app:setDefaultMailApp", bundleId ? { bundleId } : undefined),

  listMailApps: (): Promise<MailAppsResult> => ipc("app:listMailApps"),

  /** Cached provider snapshots; stale ones re-check and arrive as `assistant:providersChanged`. */
  assistantProviders: (): Promise<ProvidersState> => ipc("assistant:providers"),

  refreshAssistantProviders: (): Promise<{ ok: boolean }> => ipc("assistant:refreshProviders"),

  updateAssistantSettings: (patch: AssistantSettingsPatch): Promise<ProvidersState> =>
    ipc("assistant:updateSettings", patch),

  connectHermes: (params: { baseUrl: string; apiKey: string }): Promise<ProvidersState> =>
    ipc("assistant:connectHermes", params),

  /**
   * Starts a turn and returns at once; it streams as `assistant:chatEvent`.
   * Without `sessionId` the provider opens a session and reports it in a
   * `session` event; Hermes legacy chats chain via `previousResponseId`.
   */
  assistantSend: (params: {
    provider: ProviderKind;
    requestId: string;
    input: string;
    sessionId?: string;
    title?: string;
    skill?: { name: string; path?: string };
    attachments?: ChatAttachment[];
    previousResponseId?: string;
  }): Promise<{ ok: boolean }> => ipc("assistant:send", params),

  /** Copies dropped (by path) or pasted (bytes) files into the attachments folder. */
  assistantStageAttachments: (
    items: ({ path: string } | { name: string; mime: string; base64: string })[],
  ): Promise<{ attachments: ChatAttachment[]; errors: string[] }> =>
    ipc("assistant:stageAttachments", { items }),

  assistantRespondApproval: (params: {
    provider: ProviderKind;
    requestId: string;
    approvalId: string;
    decision: ApprovalDecision;
  }): Promise<{ ok: boolean }> => ipc("assistant:respondApproval", params),

  /** Adds a message to the running turn; `accepted: false` → queue it instead. */
  assistantSteer: (
    provider: ProviderKind,
    requestId: string,
    input: string,
  ): Promise<{ accepted: boolean }> => ipc("assistant:steer", { provider, requestId, input }),

  assistantCancel: (provider: ProviderKind, requestId: string): Promise<{ ok: boolean }> =>
    ipc("assistant:cancel", { provider, requestId }),

  assistantSkills: (provider: ProviderKind): Promise<Skill[]> =>
    ipc("assistant:skills", { provider }),

  assistantSessions: (provider: ProviderKind, limit = 40): Promise<ChatSession[]> =>
    ipc("assistant:sessions", { provider, limit }),

  assistantSessionMessages: (
    provider: ProviderKind,
    sessionId: string,
  ): Promise<ChatSessionMessage[]> => ipc("assistant:sessionMessages", { provider, sessionId }),

  assistantDeleteSession: (provider: ProviderKind, sessionId: string): Promise<{ ok: boolean }> =>
    ipc("assistant:deleteSession", { provider, sessionId }),
};
