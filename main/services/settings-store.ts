/**
 * settings-store.ts
 *
 * Persists non-sensitive app settings to userData/settings.json.
 * Missing keys fall back to defaults; unknown keys are preserved on write.
 */

import fs from "fs/promises";
import path from "path";
import { app } from "@glaze/core/backend";

export type NotificationsMode = "off" | "inbox" | "all";

export type AppSettings = {
  /** Periodic pull-sync interval in seconds; 0 disables the timer. */
  syncIntervalSeconds: number;
  /** New-mail notifications: off, inbox-only, or every new message. */
  notificationsMode: NotificationsMode;
  /** Automatically open the app when the user logs in. */
  launchAtLogin: boolean;
  /** Show the menu-bar icon and mini-inbox popover (opt-in). */
  trayEnabled: boolean;
  /** Languages the user reads (BCP-47 codes, first = where translations go).
      Empty until set: the renderer then falls back to the system languages. */
  readLanguages: string[];
  /** Translate mail in other languages without asking. */
  autoTranslate: boolean;
};

export const DEFAULT_SETTINGS: AppSettings = {
  syncIntervalSeconds: 30,
  notificationsMode: "inbox",
  launchAtLogin: false,
  trayEnabled: false,
  readLanguages: [],
  autoTranslate: false,
};

async function getSettingsPath(): Promise<string> {
  const userDataPath = app.getPath("userData");
  await fs.mkdir(userDataPath, { recursive: true });
  return path.join(userDataPath, "settings.json");
}

export async function getSettings(): Promise<AppSettings> {
  try {
    const filePath = await getSettingsPath();
    const data = await fs.readFile(filePath, "utf-8");
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(data) as Partial<AppSettings>) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function updateSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const updated = { ...(await getSettings()), ...patch };
  const filePath = await getSettingsPath();
  await fs.writeFile(filePath, JSON.stringify(updated, null, 2), "utf-8");
  return updated;
}
