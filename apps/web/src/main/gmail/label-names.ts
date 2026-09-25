import type { GmailLabel } from "./types";

/** Pseudo label id for "All Mail" (every message but Spam/Trash) — mirrors the backend. */
export const ALL_MAIL_LABEL_ID = "ALL_MAIL";

/** Friendly display names for Gmail's system labels. */
export const SYSTEM_LABEL_NAMES: Record<string, string> = {
  INBOX: "Inbox",
  SENT: "Sent",
  DRAFT: "Drafts",
  SPAM: "Spam",
  TRASH: "Trash",
  UNREAD: "Unread",
  STARRED: "Starred",
  IMPORTANT: "Important",
  CATEGORY_PERSONAL: "Personal",
  CATEGORY_SOCIAL: "Social",
  CATEGORY_PROMOTIONS: "Promotions",
  CATEGORY_UPDATES: "Updates",
  CATEGORY_FORUMS: "Forums",
  CHAT: "Chat",
};

export const SYSTEM_LABEL_ORDER = Object.keys(SYSTEM_LABEL_NAMES);

export function labelDisplayName(label: GmailLabel): string {
  if (label.type === "system") {
    return SYSTEM_LABEL_NAMES[label.id] ?? label.name;
  }
  return label.name;
}
