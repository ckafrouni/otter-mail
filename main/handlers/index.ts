/**
 * Handler Registration
 *
 * Register all your IPC handlers here
 */

import * as path from "path";
import { fileURLToPath } from "url";

import { appHandlers } from "./app.js";
import {
  getSettingsWindow,
  openSettingsWindow,
  setSettingsTarget,
  takeSettingsTarget,
} from "../windows/settings-window.js";
import { registerGmailHandlers } from "./gmail.js";
import { configureAutoSync, syncAllAccounts } from "../services/mail-sync.js";
import { getSettings } from "../services/settings-store.js";

import { ipcMain, logger } from "@glaze/core/backend";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function registerHandlers(): void {
  logger.info("handlers", "Registering IPC handlers...");

  // Register app handlers using ipcMain API
  ipcMain.handle("app:getInfo", async (_event) => {
    return await appHandlers.getInfo();
  });

  // Return the .glaze project path (used for deep links back to the host)
  // __dirname = build/main, so two levels up is the app root
  ipcMain.handle("app:getProjectPath", async () => {
    return path.join(__dirname, "..", "..");
  });

  // Settings window handlers. Accepts an optional navigation target so any
  // window can deep-link into a pane (e.g. edit a view from the main sidebar).
  ipcMain.handle("window:openSettings", async (_event, params: unknown) => {
    const p = params as { pane?: unknown; viewId?: unknown } | undefined;
    const pane =
      p?.pane === "general" || p?.pane === "accounts" || p?.pane === "views" || p?.pane === "oauth"
        ? p.pane
        : null;
    if (pane) {
      setSettingsTarget({ pane, viewId: typeof p?.viewId === "string" ? p.viewId : null });
    }
    const existed = getSettingsWindow() != null;
    await openSettingsWindow();
    if (existed && pane) ipcMain.broadcast("settings:navigate");
  });

  ipcMain.handle("window:getSettingsTarget", async () => takeSettingsTarget());

  ipcMain.handle("window:closeSettings", async (_event) => {
    getSettingsWindow()?.close();
  });

  // Register Gmail handlers
  registerGmailHandlers();

  logger.info("handlers", "✓ IPC handlers registered");

  // Warm the local cache for every connected account on launch.
  void syncAllAccounts();

  void getSettings().then((settings) => configureAutoSync(settings.syncIntervalSeconds));

  // TODO: Add more handlers here using ipcMain.handle()
  // Example:
  // ipcMain.handle('file:read', async (event, path) => {
  //   const fs = await import('fs/promises');
  //   return await fs.readFile(path, 'utf-8');
  // });
}
