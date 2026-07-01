/**
 * Shared Gmail types — used by backend services/handlers.
 * The frontend duplicates these; keep names exact.
 */

export interface GmailAccount {
  id: string;
  email: string;
  name: string;
  picture?: string;
}

export interface GmailLabel {
  id: string;
  name: string;
  type: "system" | "user";
  unread?: number;
  total?: number;
  color?: { backgroundColor: string; textColor: string };
}

export interface GmailMessageSummary {
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
}

export interface GmailMessageDetail extends GmailMessageSummary {
  bodyHtml: string | null;
  bodyText: string | null;
  cc?: string;
  attachments: {
    id: string;
    filename: string;
    mimeType: string;
    size: number;
  }[];
}

/** Per-account local-sync progress, exposed to the renderer for status UI. */
export interface SyncStatus {
  accountId: string;
  syncing: boolean;
  phase: "idle" | "labels" | "full" | "incremental";
  /** Messages written to the local store during the current/last run. */
  synced: number;
  /** Best-effort mailbox size estimate (from Gmail), or null if unknown. */
  total: number | null;
  lastSyncAt: number | null;
  fullSyncDone: boolean;
  error: string | null;
}
