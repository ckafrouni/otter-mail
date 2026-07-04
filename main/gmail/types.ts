/**
 * Shared Gmail types — used by backend services/handlers.
 * The frontend duplicates these; keep names exact.
 */

export interface GmailAccount {
  id: string;
  email: string;
  name: string;
  picture?: string;
  /** User-set override for the Google profile name, edited in Settings. */
  displayName?: string;
  /** User-set accent color (hex) for this account, edited in Settings. */
  color?: string;
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
  /** Thread rollups — set on threaded list reads (one representative row per thread). */
  threadCount?: number;
  threadUnread?: boolean;
  threadStarred?: boolean;
  /** RFC 2822 reply headers — captured on Gmail fetches and persisted, never returned by store reads. */
  messageIdHeader?: string;
  referencesHeader?: string;
}

export interface GmailMessageDetail extends GmailMessageSummary {
  bodyHtml: string | null;
  bodyText: string | null;
  cc?: string;
  /** Only present on your own drafts/sent mail (Gmail echoes the header back). */
  bcc?: string;
  attachments: {
    id: string;
    filename: string;
    mimeType: string;
    size: number;
  }[];
}

/** An outgoing attachment for compose/forward — base64 is standard (not url-safe). */
export interface ComposeAttachment {
  name: string;
  mimeType: string;
  size: number;
  base64: string;
}

/** A recipient-autocomplete suggestion derived from the local mail cache. */
export interface ContactSuggestion {
  name: string;
  email: string;
}

/** Per-account local-sync progress, exposed to the renderer for status UI. */
export interface SyncStatus {
  accountId: string;
  syncing: boolean;
  phase: "idle" | "labels" | "full" | "incremental" | "bodies";
  /** Messages written to the local store during the current/last run. */
  synced: number;
  /** Best-effort mailbox size estimate (from Gmail), or null if unknown. */
  total: number | null;
  lastSyncAt: number | null;
  fullSyncDone: boolean;
  error: string | null;
}

/**
 * One account's filter within a Combined-mailbox view. A message matches when
 * it belongs to the account, carries every label in `allOf` (empty = any mail
 * from the account), and carries none of the labels in `noneOf`.
 */
export interface ViewRule {
  accountId: string;
  allOf: string[];
  noneOf: string[];
}

export type ViewKind = "inbox" | "starred" | "sent" | "drafts" | "important" | "junk" | "trash" | "custom";

/** A Combined-mailbox view. null rules = the dynamic built-in default. */
export interface MailView {
  id: string;
  name: string;
  kind: ViewKind;
  rules: ViewRule[] | null;
  /** Owning mailbox: an account id, or "__combined__". Absent = combined. */
  mailbox?: string;
}
