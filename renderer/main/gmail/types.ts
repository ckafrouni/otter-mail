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
  /** Owning account — populated on reads so combined (cross-account) views can route. */
  accountId?: string;
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

/** A distinct user-label name aggregated across all accounts (custom-view picker). */
export type AggregatedLabel = {
  name: string;
  unread: number;
  color?: { backgroundColor: string; textColor: string };
};

/** A user-defined combined view: shows messages carrying any of these label names. */
export type CustomView = {
  id: string;
  name: string;
  labelNames: string[];
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
