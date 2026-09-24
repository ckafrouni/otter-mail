/**
 * tray-popover.ts
 *
 * IPC surface for the tray popover's mini inbox (see
 * renderer/tray-popover/). Reads are served from the local mail cache — the
 * popover doesn't trigger its own syncs, it just reflects whatever the
 * normal sync/notifier pipeline already wrote there.
 */

import { app, ipcMain, logger } from "@glaze/core/backend";
import { setPendingMailto } from "../services/mailto-target.js";
import { listAccounts } from "../services/account-store.js";
import {
  countInboxUnreadAll,
  countInboxUnreadForAccount,
  listInboxPreview,
} from "../services/mail-store.js";
import { syncAllAccounts } from "../services/mail-sync.js";
import { focusMainWindow } from "../services/tray.js";
import { hideTrayPopover } from "../windows/tray-popover-window.js";
import { setPendingOpenMessage } from "../services/open-message-target.js";
import type { GmailAccount, GmailMessageSummary } from "../gmail/types.js";

const PREVIEW_LIMIT = 15;

export type TrayAccountSnapshot = {
  account: GmailAccount;
  unreadCount: number;
  messages: GmailMessageSummary[];
};

export type TraySnapshot = {
  accounts: TrayAccountSnapshot[];
  totalUnread: number;
};

function assertString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value) throw new Error(`${name} is required`);
  return value;
}

export function registerTrayPopoverHandlers(): void {
  ipcMain.handle("tray:getSnapshot", async (_event, params: unknown): Promise<TraySnapshot> => {
    const p = params as Record<string, unknown> | undefined;
    const unreadOnly = p?.unreadOnly !== false;
    const accounts = await listAccounts();
    return {
      accounts: accounts.map((account) => ({
        account,
        unreadCount: countInboxUnreadForAccount(account.id),
        messages: listInboxPreview(account.id, PREVIEW_LIMIT, unreadOnly),
      })),
      totalUnread: countInboxUnreadAll(),
    };
  });

  // Row click: open the thread's latest message in its own window, same as
  // Cmd+click in the main list.
  ipcMain.handle("tray:openThread", async (_event, params: unknown) => {
    const p = params as Record<string, unknown>;
    try {
      const accountId = assertString(p?.accountId, "accountId");
      const messageId = assertString(p?.messageId, "messageId");
      // Opens in the main window's reader (there is no standalone window).
      setPendingOpenMessage({ accountId, messageId });
      hideTrayPopover();
      await focusMainWindow();
      ipcMain.broadcast("mail:open");
    } catch (err) {
      logger.info("tray-popover", `openThread failed: ${String(err)}`);
      throw err;
    }
  });

  // A blank mailto target through the same pull handoff as mailto: links —
  // a main window that's still loading picks it up on mount (a bare broadcast
  // would be lost before its listener exists).
  ipcMain.handle("tray:compose", async () => {
    setPendingMailto({ to: "", cc: "", subject: "", body: "" });
    hideTrayPopover();
    await focusMainWindow();
    ipcMain.broadcast("compose:mailto");
  });

  // The popover changed mail through the shared gmail:* handlers; the main
  // window has its own query cache, so tell it to refresh.
  ipcMain.handle("tray:mailChanged", async () => {
    ipcMain.broadcast("gmail:mail-changed");
  });

  ipcMain.handle("tray:sync", async () => {
    await syncAllAccounts({ force: true });
    return { ok: true };
  });

  ipcMain.handle("tray:openApp", async () => {
    await focusMainWindow();
    hideTrayPopover();
  });

  ipcMain.handle("tray:quit", async () => {
    app.quit();
  });

  ipcMain.handle("tray:hide", async () => {
    hideTrayPopover();
  });
}
