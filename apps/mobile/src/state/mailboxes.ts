import type { SFSymbol } from "expo-symbols";

/** A Gmail system label, or ALL_MAIL: everything but Spam and Trash. */
export type MailboxLabel = "INBOX" | "STARRED" | "SENT" | "DRAFT" | "ALL_MAIL" | "TRASH";

/** One mailbox of one account, or of every account (`accountId: null`). */
export type MailboxScope = { accountId: string | null; label: MailboxLabel };

export const MAILBOXES: readonly { label: MailboxLabel; title: string; symbol: SFSymbol }[] = [
  { label: "INBOX", title: "Inbox", symbol: "tray" },
  { label: "STARRED", title: "Starred", symbol: "star" },
  { label: "SENT", title: "Sent", symbol: "paperplane" },
  { label: "DRAFT", title: "Drafts", symbol: "doc" },
  { label: "ALL_MAIL", title: "All Mail", symbol: "archivebox" },
  { label: "TRASH", title: "Trash", symbol: "trash" },
];

export function mailboxTitle(scope: MailboxScope): string {
  const title = MAILBOXES.find((m) => m.label === scope.label)?.title ?? scope.label;
  if (scope.accountId !== null) return title;
  return scope.label === "INBOX" ? "All Inboxes" : `All ${title}`;
}

/** Sent mail and drafts list who they're to, not who they're from. */
export const listsRecipients = (label: MailboxLabel) => label === "SENT" || label === "DRAFT";
