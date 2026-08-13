/**
 * tray.ts
 *
 * macOS menu-bar ("top menu") status item. Clicking it toggles the rich
 * popover window (tray-popover-window.ts) — a mini inbox with a tab per
 * account — anchored under the icon. The icon itself only owns the tooltip
 * (total unread count) and the click-to-toggle wiring.
 *
 * refreshTray() — called from notifier.updateDockBadge() (covers syncs and
 * every message-state mutation) and after account rename/color changes —
 * keeps the tooltip current and tells any open popover to refetch, so
 * neither the icon nor the popover need their own polling.
 */

import { app, BrowserWindow, Tray, ipcMain, logger } from "@glaze/core/backend";
import { countInboxUnreadAll } from "./mail-store.js";
import { toggleTrayPopover, destroyTrayPopover } from "../windows/tray-popover-window.js";

// Stable app-specific identifier for the status item; must not change across runs.
const TRAY_UUID = "b8b6e6b0-2b2d-4c7a-9b7a-5c6a6b6b0f3d";

let tray: Tray | null = null;

export function focusMainWindow(): void {
  const win = BrowserWindow.getAllWindows().find((w) => w.windowKey === "main");
  win?.show();
  app.focus({ steal: true });
}

/** Refresh the tray tooltip and nudge any open popover to refetch. No-op if the tray isn't created yet. */
export async function refreshTray(): Promise<void> {
  if (!tray) return;
  try {
    const unread = countInboxUnreadAll();
    tray.setToolTip(unread > 0 ? `OtterMail — ${unread} unread` : "OtterMail");
    ipcMain.broadcast("tray:refresh");
  } catch (err) {
    logger.info("tray", `refresh failed: ${String(err)}`);
  }
}

export async function createTray(): Promise<void> {
  if (tray) return;
  tray = new Tray("envelope.fill", TRAY_UUID);
  tray.on("click", (_event, bounds) => {
    void toggleTrayPopover(bounds);
  });
  await refreshTray();
}

export function destroyTray(): void {
  tray?.destroy();
  tray = null;
  destroyTrayPopover();
}
