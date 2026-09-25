/**
 * Handler Registration
 *
 * Register all your IPC handlers here
 */

import * as path from "path";
import { fileURLToPath } from "url";

import { appHandlers } from "./app.js";
import { setSettingsTarget, takeSettingsTarget } from "../windows/settings-window.js";
import { registerGmailHandlers } from "./gmail.js";
import { registerTrayPopoverHandlers } from "./tray-popover.js";
import { registerAssistantHandlers } from "./assistant.js";
import { registerSearchHandlers } from "./search.js";
import { takePendingOpenMessage } from "../services/open-message-target.js";
import { focusMainWindow } from "../services/tray.js";
import { listMailApps, setDefaultMailHandler } from "../services/default-mail.js";
import { configureAutoSync, syncAllAccounts } from "../services/mail-sync.js";
import { takePendingMailto } from "../services/mailto-target.js";
import { getSettings } from "../services/settings-store.js";
import {
  readKeybindings,
  watchKeybindings,
  writeKeybindings,
} from "../services/keybindings-store.js";

import { app, ipcMain, logger, shell } from "@glaze/core/backend";

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

  // Settings live in the main window. Any window can deep-link into a pane
  // (e.g. edit a view from the tray); the main window pulls the target on
  // mount and whenever settings:open is broadcast.
  ipcMain.handle("window:openSettings", async (_event, params: unknown) => {
    const p = params as { pane?: unknown; viewId?: unknown; mailbox?: unknown } | undefined;
    const pane =
      p?.pane === "general" ||
      p?.pane === "appearance" ||
      p?.pane === "accounts" ||
      p?.pane === "views" ||
      p?.pane === "keybindings" ||
      p?.pane === "assistant"
        ? p.pane
        : "general";
    setSettingsTarget({
      pane,
      viewId: typeof p?.viewId === "string" ? p.viewId : null,
      mailbox: typeof p?.mailbox === "string" ? p.mailbox : null,
    });
    await focusMainWindow();
    ipcMain.broadcast("settings:open");
  });

  ipcMain.handle("window:getSettingsTarget", async () => takeSettingsTarget());

  // Keybindings: userData/keybindings.json, watched so hand edits apply live.
  watchKeybindings();
  ipcMain.handle("keybindings:read", async () => readKeybindings());
  ipcMain.handle("keybindings:write", async (_event, params: unknown) => {
    const result = await writeKeybindings((params as { rules?: unknown } | undefined)?.rules);
    ipcMain.broadcast("keybindings:updated");
    return result;
  });
  ipcMain.handle("keybindings:openFile", async () => {
    const { path: filePath } = await readKeybindings();
    const error = await shell.openPath(filePath);
    if (error) throw new Error(error);
    return { ok: true };
  });

  // A conversation the menu-bar popover asked the main window to open.
  ipcMain.handle("window:takePendingOpenMessage", async () => takePendingOpenMessage());

  // Default-mail-app plumbing: the renderer pulls pending mailto targets on
  // mount and on the compose:mailto broadcast; Settings offers a "set as
  // default" button (macOS shows its own consent dialog).
  ipcMain.handle("app:takePendingMailto", async () => takePendingMailto());

  ipcMain.handle("app:getDefaultMailStatus", async () => {
    const isDefault = await app.isDefaultProtocolClientAsync("mailto");
    return { isDefault };
  });

  // Without a bundleId this registers OtterMail itself (SDK call, macOS
  // consent dialog); with one it hands the default to that app instead
  // (Settings dropdown, LaunchServices via JXA).
  ipcMain.handle("app:setDefaultMailApp", async (_event, params: unknown) => {
    const bundleId = (params as { bundleId?: unknown } | undefined)?.bundleId;
    if (typeof bundleId === "string" && bundleId.length > 0) {
      await setDefaultMailHandler(bundleId);
      logger.info("handlers", "setDefaultMailApp", { bundleId });
      return { ok: true };
    }
    const ok = await app.setAsDefaultProtocolClient("mailto");
    logger.info("handlers", "setDefaultMailApp", { ok });
    return { ok };
  });

  ipcMain.handle("app:listMailApps", async () => listMailApps());

  registerAssistantHandlers();
  registerSearchHandlers();

  // Register Gmail handlers
  registerGmailHandlers();

  // Tray popover (mini inbox) handlers
  registerTrayPopoverHandlers();

  logger.info("handlers", "✓ IPC handlers registered");

  // Warm the local cache for every connected account on launch.
  void syncAllAccounts({ force: true });

  void getSettings().then((settings) => configureAutoSync(settings.syncIntervalSeconds));

  // TODO: Add more handlers here using ipcMain.handle()
  // Example:
  // ipcMain.handle('file:read', async (event, path) => {
  //   const fs = await import('fs/promises');
  //   return await fs.readFile(path, 'utf-8');
  // });
}
