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

import { Tray } from "electron";
import { logger } from "../logger.js";
import { broadcast } from "../ipc.js";
import { countInboxUnreadAll } from "./mail-store.js";
import {
  toggleTrayPopover,
  destroyTrayPopover,
  setTrayPopoverVisibilityListener,
} from "../windows/tray-popover-window.js";
import { trayIcons } from "./tray-icons.js";

let tray: Tray | null = null;

/** Refresh the tray tooltip and nudge any open popover to refetch. No-op if the tray isn't created yet. */
export async function refreshTray(): Promise<void> {
  if (!tray) return;
  try {
    const unread = countInboxUnreadAll();
    tray.setToolTip(unread > 0 ? `Otter Mail — ${unread} unread` : "Otter Mail");
    broadcast("tray:refresh");
  } catch (err) {
    logger.info("tray", `refresh failed: ${String(err)}`);
  }
}

export async function createTray(): Promise<void> {
  if (tray) return;
  tray = new Tray(trayIcons().normal);
  // Selected look while the popover is open, like a native status-item menu.
  setTrayPopoverVisibilityListener((open) => {
    tray?.setImage(open ? trayIcons().selected : trayIcons().normal);
  });
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
