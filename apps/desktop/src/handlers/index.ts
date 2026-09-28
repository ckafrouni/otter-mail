/**
 * Registers every IPC handler the renderer windows call: the mail backend's
 * (@otter-mail/core, served over Electron IPC) and the desktop's own.
 */

import { app, ipcMain, nativeImage, shell } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";

import {
  broadcast,
  getAttachmentBytes,
  KEYBINDINGS_FILE,
  onSettingsChanged,
  registeredHandlers,
  runAsTask,
} from "@otter-mail/core";

import { logger } from "../logger.js";
import { tempFile } from "../platform.js";
import { listMailApps, setDefaultMailHandler } from "../services/default-mail.js";
import { takePendingMailto } from "../services/mailto-target.js";
import { takePendingOpenMessage } from "../services/open-message-target.js";
import { createTray, destroyTray } from "../services/tray.js";
import { focusMainWindow } from "../windows/main-window.js";
import { setSettingsTarget, takeSettingsTarget } from "../windows/settings-window.js";
import { registerAssistantHandlers } from "./assistant.js";
import { registerTranslationHandlers } from "./translation.js";
import { registerTrayPopoverHandlers } from "./tray-popover.js";

/** Watches keybindings.json (editors replace files) so hand edits apply live. */
function watchKeybindings(): void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    fs.watch(app.getPath("userData"), (_event, name) => {
      if (name?.toString() !== KEYBINDINGS_FILE) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => broadcast("keybindings:updated"), 100);
    });
  } catch (err) {
    logger.info("keybindings", `watch failed: ${String(err)}`);
  }
}

export function registerHandlers(): void {
  for (const [channel, handler] of registeredHandlers()) {
    ipcMain.handle(channel, (_event, params: unknown) => handler(params));
  }

  onSettingsChanged((settings, patch) => {
    if (patch.launchAtLogin !== undefined) {
      app.setLoginItemSettings({ openAtLogin: settings.launchAtLogin });
    }
    if (patch.trayEnabled !== undefined) {
      if (settings.trayEnabled) void createTray();
      else destroyTray();
    }
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
      p?.pane === "assistant" ||
      p?.pane === "otter"
        ? p.pane
        : "general";
    setSettingsTarget({
      pane,
      viewId: typeof p?.viewId === "string" ? p.viewId : null,
      mailbox: typeof p?.mailbox === "string" ? p.mailbox : null,
    });
    await focusMainWindow();
    broadcast("settings:open");
  });

  ipcMain.handle("window:getSettingsTarget", async () => takeSettingsTarget());

  watchKeybindings();
  ipcMain.handle("keybindings:openFile", async () => {
    const error = await shell.openPath(path.join(app.getPath("userData"), KEYBINDINGS_FILE));
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
    const isDefault = app.isDefaultProtocolClient("mailto");
    return { isDefault };
  });

  // Without a bundleId this registers Otter Mail itself (macOS consent
  // dialog); with one it hands the default to that app instead
  // (Settings dropdown, LaunchServices via JXA).
  ipcMain.handle("app:setDefaultMailApp", async (_event, params: unknown) => {
    const bundleId = (params as { bundleId?: unknown } | undefined)?.bundleId;
    if (typeof bundleId === "string" && bundleId.length > 0) {
      await setDefaultMailHandler(bundleId);
      logger.info("handlers", "setDefaultMailApp", { bundleId });
      return { ok: true };
    }
    const ok = app.setAsDefaultProtocolClient("mailto");
    logger.info("handlers", "setDefaultMailApp", { ok });
    return { ok };
  });

  ipcMain.handle("app:listMailApps", async () => listMailApps());

  // gmail:dragAttachment — native drag-out to Finder (startDrag needs a real file on disk)
  ipcMain.handle("gmail:dragAttachment", async (event, params: unknown) => {
    const p = params as Record<string, unknown> | undefined;
    const { accountId, messageId, attachmentId, filename, taskId } = p ?? {};
    if (
      typeof accountId !== "string" ||
      typeof messageId !== "string" ||
      typeof attachmentId !== "string" ||
      typeof filename !== "string"
    ) {
      throw new Error("Invalid parameters for gmail:dragAttachment.");
    }
    return runAsTask(typeof taskId === "string" ? taskId : undefined, async () => {
      const bytes = await getAttachmentBytes(accountId, messageId, attachmentId);
      const file = await tempFile(filename, bytes);
      const icon = await nativeImage
        .createThumbnailFromPath(file, { width: 64, height: 64 })
        .catch(() => nativeImage.createEmpty());
      // Electron requires a non-empty drag image.
      event.sender.startDrag({
        file,
        icon: icon.isEmpty() ? await app.getFileIcon(file, { size: "normal" }) : icon,
      });
      return { ok: true };
    });
  });

  registerAssistantHandlers();
  registerTranslationHandlers();
  registerTrayPopoverHandlers();

  logger.info("handlers", "✓ IPC handlers registered");
}
