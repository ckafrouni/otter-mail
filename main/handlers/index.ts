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
import * as assistant from "../services/assistant.js";
import * as assistantChat from "../services/assistant-chat.js";
import { openMessageWindow } from "../windows/message-window.js";
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

  // Settings window handlers. Accepts an optional navigation target so any
  // window can deep-link into a pane (e.g. edit a view from the main sidebar).
  ipcMain.handle("window:openSettings", async (_event, params: unknown) => {
    const p = params as { pane?: unknown; viewId?: unknown; mailbox?: unknown } | undefined;
    const pane =
      p?.pane === "general" || p?.pane === "accounts" || p?.pane === "views" || p?.pane === "oauth"
        ? p.pane
        : null;
    if (pane) {
      setSettingsTarget({
        pane,
        viewId: typeof p?.viewId === "string" ? p.viewId : null,
        mailbox: typeof p?.mailbox === "string" ? p.mailbox : null,
      });
    }
    const existed = getSettingsWindow() != null;
    await openSettingsWindow();
    if (existed && pane) ipcMain.broadcast("settings:navigate");
  });

  ipcMain.handle("window:getSettingsTarget", async () => takeSettingsTarget());

  ipcMain.handle("window:closeSettings", async (_event) => {
    getSettingsWindow()?.close();
  });

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

  // Hermes handoff (Slack): post the question into the assistant DM as the
  // user, then deep-link Slack to that conversation.
  ipcMain.handle("assistant:getStatus", async () => assistant.getStatus());

  ipcMain.handle("assistant:configure", async (_event, params: unknown) => {
    const p = params as Record<string, unknown>;
    const token = typeof p?.token === "string" ? p.token.trim() : "";
    const botUserId = typeof p?.botUserId === "string" ? p.botUserId.trim() : "";
    if (!token || !botUserId) throw new Error("Both the Slack token and the bot member ID are required.");
    logger.info("handlers", "assistant:configure", { botUserId });
    return assistant.configure(token, botUserId);
  });

  ipcMain.handle("assistant:send", async (_event, params: unknown) => {
    const p = params as Record<string, unknown>;
    const text = typeof p?.text === "string" ? p.text.trim() : "";
    if (!text) throw new Error("Nothing to send.");
    logger.info("handlers", "assistant:send", { chars: text.length });
    return assistant.send(text);
  });

  // Hermes chat panel: streaming Responses API bridge. Events flow back via
  // the assistant:chatEvent broadcast; the key never leaves the backend.
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

  // Register Gmail handlers
  registerGmailHandlers();

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
