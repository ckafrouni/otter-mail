/**
 * settings-store.ts
 *
 * Persists non-sensitive app settings to settings.json.
 * Missing keys fall back to defaults; unknown keys are preserved on write.
 */

import { readJson, writeJson } from "../json-file.js";

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

export async function getSettings(): Promise<AppSettings> {
  return { ...DEFAULT_SETTINGS, ...(await readJson<Partial<AppSettings>>("settings.json")) };
}

type SettingsListener = (settings: AppSettings, patch: Partial<AppSettings>) => void;
const listeners = new Set<SettingsListener>();

/** Runs `listener` after every settings change (the desktop applies launch-at-login and the tray). */
export function onSettingsChanged(listener: SettingsListener): void {
  listeners.add(listener);
}

export async function updateSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const updated = { ...(await getSettings()), ...patch };
  await writeJson("settings.json", updated);
  for (const listener of listeners) listener(updated, patch);
  return updated;
}
