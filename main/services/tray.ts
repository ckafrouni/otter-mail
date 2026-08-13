/**
 * tray.ts
 *
 * macOS menu-bar ("top menu") status item. Shows the total unread INBOX
 * count across accounts as a tooltip and lists each account's unread count
 * in the dropdown, plus quick actions (new message, sync, open, quit).
 *
 * Rebuilt via refreshTrayMenu() — called from notifier.updateDockBadge()
 * (covers syncs and every message-state mutation) and after account
 * rename/color changes — so the menu never needs its own polling.
 */

import { app, BrowserWindow, Tray, Menu, ipcMain, logger } from "@glaze/core/backend";
import { listAccounts } from "./account-store.js";
import { countInboxUnreadForAccount, countInboxUnreadAll } from "./mail-store.js";
import type { GmailAccount } from "../gmail/types.js";

// Stable app-specific identifier for the status item; must not change across runs.
const TRAY_UUID = "b8b6e6b0-2b2d-4c7a-9b7a-5c6a6b6b0f3d";

let tray: Tray | null = null;
let onSync: (() => void) | null = null;

function focusMainWindow(): void {
  const win = BrowserWindow.getAllWindows().find((w) => w.windowKey === "main");
  win?.show();
  app.focus({ steal: true });
}

function accountLabel(account: GmailAccount): string {
  return account.displayName?.trim() || account.name || account.email;
}

async function buildMenu(): Promise<Menu> {
  const accounts = await listAccounts();
  const accountItems =
    accounts.length > 0
      ? accounts.map((account) => {
          const unread = countInboxUnreadForAccount(account.id);
          return {
            label: accountLabel(account),
            sublabel: unread > 0 ? `${unread} unread` : "No unread mail",
            enabled: false,
          };
        })
      : [{ label: "No accounts connected", enabled: false }];

  return Menu.buildFromTemplate([
    ...accountItems,
    { type: "separator" },
    {
      label: "New Message",
      icon: "square.and.pencil",
      click: () => {
        focusMainWindow();
        ipcMain.broadcast("compose:new");
      },
    },
    {
      label: "Synchronize All Mailboxes",
      icon: "arrow.triangle.2.circlepath",
      click: () => onSync?.(),
    },
    { type: "separator" },
    {
      label: "Open OtterMail",
      click: () => focusMainWindow(),
    },
    { type: "separator" },
    { role: "quit" },
  ]);
}

/** Rebuild the tray tooltip + menu from current accounts/unread state. No-op if the tray isn't created yet. */
export async function refreshTrayMenu(): Promise<void> {
  if (!tray) return;
  try {
    const unread = countInboxUnreadAll();
    tray.setToolTip(unread > 0 ? `OtterMail — ${unread} unread` : "OtterMail");
    tray.setContextMenu(await buildMenu());
  } catch (err) {
    logger.info("tray", `refresh failed: ${String(err)}`);
  }
}

export async function createTray(options: { onSync: () => void }): Promise<void> {
  if (tray) return;
  onSync = options.onSync;
  tray = new Tray("envelope.fill", TRAY_UUID);
  await refreshTrayMenu();
}

export function destroyTray(): void {
  tray?.destroy();
  tray = null;
}
