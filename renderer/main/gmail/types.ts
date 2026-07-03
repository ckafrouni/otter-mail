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

/** One picked label, scoped to a specific account (per-account, by exact id). */
export type LabelSelection = {
  accountId: string;
  labelId: string;
};

export type ViewKind = "inbox" | "sent" | "custom";

/**
 * A Combined-mailbox view. Shows the union of messages matching any of its
 * label `selections`. Built-in "inbox"/"sent" views use dynamic defaults when
 * `selections` is null (every account's INBOX/SENT) and can be reset back to it.
 */
export type MailView = {
  id: string;
  name: string;
  kind: ViewKind;
  /** null = use the dynamic default for this kind (only for inbox/sent). */
  selections: LabelSelection[] | null;
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
