export type GmailAccount = {
  id: string;
  email: string;
  name: string;
  picture?: string;
};

export type GmailLabel = {
  id: string;
  name: string;
  type: "system" | "user";
  unread?: number;
  total?: number;
  color?: { backgroundColor: string; textColor: string };
};

export type GmailMessageSummary = {
  id: string;
  threadId: string;
  fromName: string;
  fromEmail: string;
  to: string;
  subject: string;
  snippet: string;
  date: number;
  unread: boolean;
  starred: boolean;
  labelIds: string[];
  hasAttachments: boolean;
};

export type GmailMessageDetail = GmailMessageSummary & {
  bodyHtml: string | null;
  bodyText: string | null;
  cc?: string;
  attachments: { id: string; filename: string; mimeType: string; size: number }[];
};

/** Per-account local-sync progress, exposed to the renderer for status UI. */
export type SyncStatus = {
  accountId: string;
  syncing: boolean;
  phase: "idle" | "labels" | "full" | "incremental" | "bodies";
  synced: number;
  total: number | null;
  lastSyncAt: number | null;
  fullSyncDone: boolean;
  error: string | null;
};
