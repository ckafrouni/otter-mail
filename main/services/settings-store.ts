/**
 * settings-store.ts
 *
 * Persists non-sensitive app settings to userData/settings.json.
 * Missing keys fall back to defaults; unknown keys are preserved on write.
 */

import fs from "fs/promises";
import path from "path";
import { app } from "@glaze/core/backend";

export type AppSettings = {
  /** Periodic pull-sync interval in seconds; 0 disables the timer. */
  syncIntervalSeconds: number;
};

export const DEFAULT_SETTINGS: AppSettings = {
  syncIntervalSeconds: 30,
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
