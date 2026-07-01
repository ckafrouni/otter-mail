/**
 * gmail.ts — IPC handler registration for the Gmail client.
 *
 * All channels proxy to services (credentials-store, account-store,
 * gmail-oauth, gmail-api). Handlers are thin; business logic lives in services.
 *
 * NOTE: gmail:getCredentials NEVER returns the client secret.
 */

import { ipcMain } from "@glaze/core/backend";
import { getCredentials, setCredentials, hasCredentials } from "../services/credentials-store.js";
import {
  listAccounts,
  removeAccount as storeRemoveAccount,
} from "../services/account-store.js";
import {
  addAccount as oauthAddAccount,
  removeAccountTokens,
} from "../services/gmail-oauth.js";
import {
  listLabels,
  createLabel,
  listMessages,
  getMessage,
  modifyMessage,
  trashMessage,
  sendMessage,
  getAttachment,
} from "../services/gmail-api.js";

// ── Type guards ───────────────────────────────────────────────────────────────

function assertString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Invalid parameter: "${name}" must be a non-empty string.`);
  }
  return value;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asStringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((v) => typeof v === "string")
    ? (value as string[])
    : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

// ── Registration ──────────────────────────────────────────────────────────────

export function registerGmailHandlers(): void {

  // gmail:getCredentials — returns hasCredentials + clientId (never clientSecret)
  ipcMain.handle("gmail:getCredentials", async (_event) => {
    console.log("[gmail:getCredentials]", {});
    try {
      const { clientId } = await getCredentials();
      const has = await hasCredentials();
      return { hasCredentials: has, clientId };
    } catch (err) {
      console.log("[gmail:getCredentials] error", { error: String(err) });
      throw err;
    }
  });

  // gmail:setCredentials — saves both fields, returns hasCredentials + clientId only
  ipcMain.handle("gmail:setCredentials", async (_event, params: unknown) => {
    const p = params as Record<string, unknown>;
    console.log("[gmail:setCredentials]", { clientId: p?.clientId });
    try {
      const clientId = assertString(p?.clientId, "clientId");
      const clientSecret = assertString(p?.clientSecret, "clientSecret");
      await setCredentials({ clientId, clientSecret });
      const has = await hasCredentials();
      return { hasCredentials: has, clientId };
    } catch (err) {
      console.log("[gmail:setCredentials] error", { error: String(err) });
      throw err;
    }
  });

  // gmail:listAccounts
  ipcMain.handle("gmail:listAccounts", async (_event) => {
    console.log("[gmail:listAccounts]", {});
    try {
      return await listAccounts();
    } catch (err) {
      console.log("[gmail:listAccounts] error", { error: String(err) });
      throw err;
    }
  });

  // gmail:addAccount — opens browser OAuth flow
  ipcMain.handle("gmail:addAccount", async (_event) => {
    console.log("[gmail:addAccount]", {});
    try {
      return await oauthAddAccount();
    } catch (err) {
      console.log("[gmail:addAccount] error", { error: String(err) });
      throw err;
    }
  });

  // gmail:removeAccount
  ipcMain.handle("gmail:removeAccount", async (_event, params: unknown) => {
    const p = params as Record<string, unknown>;
    console.log("[gmail:removeAccount]", { accountId: p?.accountId });
    try {
      const accountId = assertString(p?.accountId, "accountId");
      await removeAccountTokens(accountId);
      await storeRemoveAccount(accountId);
      return { ok: true as const };
    } catch (err) {
      console.log("[gmail:removeAccount] error", { error: String(err) });
      throw err;
    }
  });

  // gmail:listLabels
  ipcMain.handle("gmail:listLabels", async (_event, params: unknown) => {
    const p = params as Record<string, unknown>;
    console.log("[gmail:listLabels]", { accountId: p?.accountId });
    try {
      const accountId = assertString(p?.accountId, "accountId");
      return await listLabels(accountId);
    } catch (err) {
      console.log("[gmail:listLabels] error", { error: String(err) });
      throw err;
    }
  });

  // gmail:createLabel
  ipcMain.handle("gmail:createLabel", async (_event, params: unknown) => {
    const p = params as Record<string, unknown>;
    console.log("[gmail:createLabel]", { accountId: p?.accountId, name: p?.name });
    try {
      const accountId = assertString(p?.accountId, "accountId");
      const name = assertString(p?.name, "name");
      return await createLabel(accountId, name);
    } catch (err) {
      console.log("[gmail:createLabel] error", { error: String(err) });
      throw err;
    }
  });

  // gmail:listMessages
  ipcMain.handle("gmail:listMessages", async (_event, params: unknown) => {
    const p = params as Record<string, unknown>;
    console.log("[gmail:listMessages]", {
      accountId: p?.accountId,
      labelIds: p?.labelIds,
      q: p?.q,
      pageToken: p?.pageToken,
      maxResults: p?.maxResults,
    });
    try {
      const accountId = assertString(p?.accountId, "accountId");
      return await listMessages(accountId, {
        labelIds: asStringArray(p?.labelIds),
        q: asString(p?.q),
        pageToken: asString(p?.pageToken),
        maxResults: asNumber(p?.maxResults),
      });
    } catch (err) {
      console.log("[gmail:listMessages] error", { error: String(err) });
      throw err;
    }
  });

  // gmail:getMessage
  ipcMain.handle("gmail:getMessage", async (_event, params: unknown) => {
    const p = params as Record<string, unknown>;
    console.log("[gmail:getMessage]", { accountId: p?.accountId, messageId: p?.messageId });
    try {
      const accountId = assertString(p?.accountId, "accountId");
      const messageId = assertString(p?.messageId, "messageId");
      return await getMessage(accountId, messageId);
    } catch (err) {
      console.log("[gmail:getMessage] error", { error: String(err) });
      throw err;
    }
  });

  // gmail:modifyMessage
  ipcMain.handle("gmail:modifyMessage", async (_event, params: unknown) => {
    const p = params as Record<string, unknown>;
    console.log("[gmail:modifyMessage]", {
      accountId: p?.accountId,
      messageId: p?.messageId,
    });
    try {
      const accountId = assertString(p?.accountId, "accountId");
      const messageId = assertString(p?.messageId, "messageId");
      return await modifyMessage(accountId, messageId, {
        addLabelIds: asStringArray(p?.addLabelIds),
        removeLabelIds: asStringArray(p?.removeLabelIds),
      });
    } catch (err) {
      console.log("[gmail:modifyMessage] error", { error: String(err) });
      throw err;
    }
  });

  // gmail:trashMessage
  ipcMain.handle("gmail:trashMessage", async (_event, params: unknown) => {
    const p = params as Record<string, unknown>;
    console.log("[gmail:trashMessage]", { accountId: p?.accountId, messageId: p?.messageId });
    try {
      const accountId = assertString(p?.accountId, "accountId");
      const messageId = assertString(p?.messageId, "messageId");
      return await trashMessage(accountId, messageId);
    } catch (err) {
      console.log("[gmail:trashMessage] error", { error: String(err) });
      throw err;
    }
  });

  // gmail:sendMessage
  ipcMain.handle("gmail:sendMessage", async (_event, params: unknown) => {
    const p = params as Record<string, unknown>;
    console.log("[gmail:sendMessage]", {
      accountId: p?.accountId,
      to: p?.to,
      subject: p?.subject,
    });
    try {
      const accountId = assertString(p?.accountId, "accountId");
      const to = assertString(p?.to, "to");
      const subject = assertString(p?.subject, "subject");
      const body = assertString(p?.body, "body");
      return await sendMessage(accountId, {
        to,
        cc: asString(p?.cc),
        bcc: asString(p?.bcc),
        subject,
        body,
      });
    } catch (err) {
      console.log("[gmail:sendMessage] error", { error: String(err) });
      throw err;
    }
  });

  // gmail:getAttachment
  ipcMain.handle("gmail:getAttachment", async (_event, params: unknown) => {
    const p = params as Record<string, unknown>;
    console.log("[gmail:getAttachment]", {
      accountId: p?.accountId,
      messageId: p?.messageId,
      attachmentId: p?.attachmentId,
      filename: p?.filename,
    });
    try {
      const accountId = assertString(p?.accountId, "accountId");
      const messageId = assertString(p?.messageId, "messageId");
      const attachmentId = assertString(p?.attachmentId, "attachmentId");
      const filename = assertString(p?.filename, "filename");
      const mimeType = typeof p?.mimeType === "string" ? p.mimeType : "application/octet-stream";
      return await getAttachment(accountId, messageId, attachmentId, filename, mimeType);
    } catch (err) {
      console.log("[gmail:getAttachment] error", { error: String(err) });
      throw err;
    }
  });
}
