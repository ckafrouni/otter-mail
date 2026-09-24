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
import * as assistantChat from "../services/assistant-chat.js";
import { openMessageWindow } from "../windows/message-window.js";
import { focusMainWindow } from "../services/tray.js";
import { listMailApps, setDefaultMailHandler } from "../services/default-mail.js";
import { configureAutoSync, syncAllAccounts } from "../services/mail-sync.js";
import { takePendingMailto } from "../services/mailto-target.js";
import { getSettings } from "../services/settings-store.js";

import { app, ipcMain, logger } from "@glaze/core/backend";

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
      p?.pane === "accounts" ||
      p?.pane === "views" ||
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

  // Cmd+click a message → standalone single-message window.
  ipcMain.handle("window:openMessage", async (_event, params: unknown) => {
    const p = params as Record<string, unknown>;
    const accountId = typeof p?.accountId === "string" ? p.accountId : "";
    const messageId = typeof p?.messageId === "string" ? p.messageId : "";
    if (accountId && messageId) await openMessageWindow(accountId, messageId);
  });

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

  ipcMain.handle("assistant:chatStatus", async () => assistantChat.chatStatus());

  ipcMain.handle("assistant:chatConfigure", async (_event, params: unknown) => {
    const p = params as Record<string, unknown>;
    const baseUrl = typeof p?.baseUrl === "string" ? p.baseUrl.trim() : "";
    const apiKey = typeof p?.apiKey === "string" ? p.apiKey.trim() : "";
    if (!baseUrl || !apiKey) throw new Error("Base URL and API key are both required.");
    return assistantChat.chatConfigure(baseUrl, apiKey);
  });

  ipcMain.handle("assistant:chatSend", async (_event, params: unknown) => {
    const p = params as Record<string, unknown>;
    const requestId = typeof p?.requestId === "string" ? p.requestId : "";
    const input = typeof p?.input === "string" ? p.input : "";
    if (!requestId || !input.trim()) throw new Error("Nothing to send.");
    return assistantChat.chatSend({
      requestId,
      input,
      sessionId: typeof p?.sessionId === "string" && p.sessionId ? p.sessionId : undefined,
      previousResponseId:
        typeof p?.previousResponseId === "string" && p.previousResponseId
          ? p.previousResponseId
          : undefined,
    });
  });

  ipcMain.handle("assistant:chatCancel", async (_event, params: unknown) => {
    const p = params as Record<string, unknown>;
    if (typeof p?.requestId === "string") assistantChat.chatCancel(p.requestId);
    return { ok: true };
  });

  ipcMain.handle("assistant:chatSkills", async () => assistantChat.listSkills());

  // Native Sessions API: one persistent server-side session per conversation.
  ipcMain.handle("assistant:chatSessionCreate", async (_event, params: unknown) => {
    const p = params as Record<string, unknown> | undefined;
    const title = typeof p?.title === "string" ? p.title.trim() : "";
    return assistantChat.sessionCreate(title ? { title } : {});
  });

  ipcMain.handle("assistant:chatSessionDelete", async (_event, params: unknown) => {
    const p = params as Record<string, unknown>;
    const sessionId = typeof p?.sessionId === "string" ? p.sessionId.trim() : "";
    if (!sessionId) throw new Error("A session id is required.");
    return assistantChat.sessionDelete(sessionId);
  });

  ipcMain.handle("assistant:chatSessionRename", async (_event, params: unknown) => {
    const p = params as Record<string, unknown>;
    const sessionId = typeof p?.sessionId === "string" ? p.sessionId.trim() : "";
    const title = typeof p?.title === "string" ? p.title.trim() : "";
    if (!sessionId || !title) throw new Error("A session id and title are required.");
    return assistantChat.sessionRename(sessionId, title);
  });

  ipcMain.handle("assistant:chatSessionList", async (_event, params: unknown) => {
    const p = params as Record<string, unknown> | undefined;
    const limit = typeof p?.limit === "number" && Number.isFinite(p.limit) ? p.limit : undefined;
    return assistantChat.sessionList(limit ? { limit } : {});
  });

  ipcMain.handle("assistant:chatSessionMessages", async (_event, params: unknown) => {
    const p = params as Record<string, unknown>;
    const sessionId = typeof p?.sessionId === "string" ? p.sessionId.trim() : "";
    if (!sessionId) throw new Error("A session id is required.");
    return assistantChat.sessionMessages(sessionId);
  });

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
