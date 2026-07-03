import { BrowserWindow, logger } from "@glaze/core/backend";
import { getPreloadPath, getWindowUrl } from "./window-paths.js";

let settingsWindow: BrowserWindow | null = null;

export type SettingsTarget = {
  pane: "general" | "accounts" | "views" | "oauth";
  /** For the views pane: a view id to edit, or "new" to create one. */
  viewId?: string | null;
  /** For "new": which mailbox (account id or "__combined__") owns the view. */
  mailbox?: string | null;
};

// Where the settings window should navigate on (re)open. The renderer pulls
// this via window:getSettingsTarget on mount and on settings:navigate.
let pendingTarget: SettingsTarget | null = null;

export function setSettingsTarget(target: SettingsTarget): void {
  pendingTarget = target;
}

export function takeSettingsTarget(): SettingsTarget | null {
  const target = pendingTarget;
  pendingTarget = null;
  return target;
}

export async function openSettingsWindow(): Promise<void> {
  // If window exists and is not destroyed, just show it
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    logger.debug("settings", "Settings window already exists, showing it");
    settingsWindow.show();
    return;
  }

  logger.info("settings", "Creating settings window");

  settingsWindow = new BrowserWindow({
    windowKey: "settings",
    width: 820,
    height: 600,
    minWidth: 700,
    minHeight: 480,
    title: "Settings",
    show: false,
    center: true,
    webPreferences: {
      preload: getPreloadPath(),
    },
  });

  settingsWindow.once("ready-to-show", () => {
    settingsWindow?.show();
  });

  settingsWindow.on("closed", () => {
    settingsWindow = null;
  });

  const url = await getWindowUrl("settings-window.html");
  logger.info("settings", "Loading settings URL", { url });

  await settingsWindow.loadURL(url);
}

export function getSettingsWindow(): BrowserWindow | null {
  return settingsWindow;
}
