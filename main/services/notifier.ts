/**
 * notifier.ts
 *
 * New-mail native notifications + dock unread badge.
 *
 * Notifications fire only for messages newly added by an incremental sync's
 * history feed (mail-sync calls notifyNewMail with them) — never for full
 * syncs, body backfills, or an account's first sync. The dock badge mirrors
 * total INBOX unread across accounts after syncs and local mutations.
 */

import { app, BrowserWindow, Notification, logger } from "@glaze/core/backend";
import { getAccount } from "./account-store.js";
import { getSettings } from "./settings-store.js";
import * as mailStore from "./mail-store.js";
import type { GmailAccount, GmailMessageSummary } from "../gmail/types.js";

const MAX_INDIVIDUAL_NOTIFICATIONS = 3;

function accountLabel(account: GmailAccount): string {
  return account.displayName?.trim() || account.name || account.email;
}

function focusMainWindow(): void {
  const win = BrowserWindow.getAllWindows().find((w) => w.windowKey === "main");
  win?.show();
  app.focus({ steal: true });
}

function showNotification(options: { title: string; subtitle?: string; body?: string }): void {
  const notification = new Notification(options);
  notification.on("click", () => focusMainWindow());
  notification.show();
}

/**
 * Notify about messages an incremental sync just stored. Filters by the
 * notifications setting, drops anything older than the account's previous
 * completed sync, and never notifies for the account's own outgoing mail.
 */
export async function notifyNewMail(
  accountId: string,
  added: GmailMessageSummary[],
  prevLastSyncAt: number | null,
): Promise<void> {
  try {
    if (added.length === 0 || !Notification.isSupported()) return;
    const settings = await getSettings();
    if (settings.notificationsMode === "off") return;
    const account = await getAccount(accountId);
    if (!account) return;

    const ownEmail = account.email.toLowerCase();
    const cutoff = prevLastSyncAt ?? 0;
    const fresh = added.filter(
      (m) =>
        m.date > cutoff &&
        m.fromEmail.toLowerCase() !== ownEmail &&
        (settings.notificationsMode === "all" || m.labelIds.includes("INBOX")),
    );
    if (fresh.length === 0) return;

    const subtitle = accountLabel(account);
    if (fresh.length <= MAX_INDIVIDUAL_NOTIFICATIONS) {
      for (const m of fresh) {
        showNotification({
          title: m.fromName || m.fromEmail,
          subtitle,
          body: m.subject || m.snippet,
        });
      }
    } else {
      showNotification({ title: `${fresh.length} new messages`, subtitle });
    }
  } catch (err) {
    logger.info("notifier", `notifyNewMail failed: ${String(err)}`);
  }
}

/** Mirror total INBOX unread (all accounts) onto the dock badge; clear at 0. */
export function updateDockBadge(): void {
  try {
    const unread = mailStore.countInboxUnreadAll();
    app.dock.setBadge(unread > 0 ? String(unread) : "");
  } catch (err) {
    logger.info("notifier", `badge update failed: ${String(err)}`);
  }
}
