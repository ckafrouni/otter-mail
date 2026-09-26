/**
 * Mail actions. Each one changes the cache first, so the UI answers at once,
 * then tells Gmail; if Gmail refuses, the cache goes back and the error is
 * rethrown for the screen to show.
 */

import type { GmailMessageDetail } from "@otter-mail/contracts/gmail";

import * as api from "../gmail/api";
import { buildRawMessage, formatAddress } from "../gmail/mime";
import * as store from "./db";
import { loadThread } from "./sync";

type Thread = Pick<store.ThreadSummary, "accountId" | "id" | "labelIds">;

async function relabel(
  thread: Thread,
  change: { add?: string[]; remove?: string[] },
  remote: () => Promise<void>,
): Promise<void> {
  const before = new Set(thread.labelIds);
  store.relabelThread(thread.accountId, thread.id, change);
  store.notify();
  try {
    await remote();
  } catch (err) {
    store.relabelThread(thread.accountId, thread.id, {
      add: change.remove?.filter((id) => before.has(id)),
      remove: change.add?.filter((id) => !before.has(id)),
    });
    store.notify();
    throw err;
  }
}

export const archive = (thread: Thread) =>
  relabel(thread, { remove: ["INBOX"] }, () =>
    api.modifyThread(thread.accountId, thread.id, { remove: ["INBOX"] }),
  );

export const trash = (thread: Thread) =>
  relabel(thread, { add: ["TRASH"], remove: ["INBOX"] }, () =>
    api.trashThread(thread.accountId, thread.id),
  );

export function setStarred(thread: Thread, starred: boolean) {
  const change = starred ? { add: ["STARRED"] } : { remove: ["STARRED"] };
  return relabel(thread, change, () => api.modifyThread(thread.accountId, thread.id, change));
}

export function setRead(thread: Thread, read: boolean) {
  const change = read ? { remove: ["UNREAD"] } : { add: ["UNREAD"] };
  return relabel(thread, change, () => api.modifyThread(thread.accountId, thread.id, change));
}

export type OutgoingMail = {
  accountId: string;
  to: string;
  cc: string;
  subject: string;
  body: string;
  /** The message being answered: the reply joins its thread. */
  replyTo?: GmailMessageDetail;
};

export async function send(mail: OutgoingMail): Promise<void> {
  const account = store.listAccounts().find((a) => a.id === mail.accountId);
  if (!account) throw new Error("That account is no longer signed in.");
  const { replyTo } = mail;
  const raw = buildRawMessage({
    from: formatAddress(account.name, account.email),
    to: mail.to,
    cc: mail.cc,
    subject: mail.subject,
    body: mail.body,
    inReplyTo: replyTo?.messageIdHeader,
    references: replyTo
      ? [replyTo.referencesHeader, replyTo.messageIdHeader].filter(Boolean).join(" ")
      : undefined,
  });
  const sent = await api.sendRawMessage(mail.accountId, raw, replyTo?.threadId);
  // Show the reply in its thread (and new mail in Sent) without waiting for a sync.
  await loadThread(mail.accountId, sent.threadId).catch(() => undefined);
}
