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
import * as mailStore from "../services/mail-store.js";
import * as mailSync from "../services/mail-sync.js";

const LOCAL_PAGE_SIZE = 50;

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
      mailStore.removeAccountData(accountId);
      return { ok: true as const };
    } catch (err) {
      console.log("[gmail:removeAccount] error", { error: String(err) });
      throw err;
    }
  });

  // gmail:listLabels — served from the local cache; sync refreshes in background
  ipcMain.handle("gmail:listLabels", async (_event, params: unknown) => {
    const p = params as Record<string, unknown>;
    console.log("[gmail:listLabels]", { accountId: p?.accountId });
    try {
      const accountId = assertString(p?.accountId, "accountId");
      mailSync.syncAccount(accountId);
      const local = mailStore.getLabels(accountId);
      if (local.length > 0) return local;
      // Cold cache: fetch once live so the sidebar isn't empty on first launch.
      const labels = await listLabels(accountId);
      mailStore.upsertLabels(accountId, labels);
      return labels;
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
      const labelIds = asStringArray(p?.labelIds);
      const q = asString(p?.q);
      const pageToken = asString(p?.pageToken);
      const maxResults = asNumber(p?.maxResults) ?? LOCAL_PAGE_SIZE;

      // Search hits Gmail live (server-side full-text can't be replicated
      // locally), but results are still cached for instant re-open.
      if (q) {
        const result = await listMessages(accountId, { labelIds, q, pageToken, maxResults });
        mailStore.upsertMessages(accountId, result.messages);
        return result;
      }

      const labelId = labelIds?.[0] ?? "INBOX";
      const offset = pageToken ? Number.parseInt(pageToken, 10) || 0 : 0;

      // Cold cache for this label: warm up with one live page so the user
      // isn't staring at an empty list while the full sync runs.
      if (offset === 0 && mailStore.countMessagesForLabel(accountId, labelId) === 0) {
        try {
          const live = await listMessages(accountId, { labelIds: [labelId], maxResults });
          mailStore.upsertMessages(accountId, live.messages);
        } catch (warmErr) {
          console.log("[gmail:listMessages] warm-up failed", { error: String(warmErr) });
        }
      }

      mailSync.syncAccount(accountId);

      const page = mailStore.getMessagesPage(accountId, labelId, offset, maxResults);
      return {
        messages: page.messages,
        nextPageToken: page.hasMore ? String(offset + maxResults) : undefined,
      };
    } catch (err) {
      console.log("[gmail:listMessages] error", { error: String(err) });
      throw err;
    }
  });

  // gmail:listCombinedMessages — cross-account union for the "Combined" mailbox.
  // `selections` is a list of {accountId, labelId} pairs; a message matches if it
  // carries any selected label in its own account. Reads the local store and
  // refreshes all accounts in the background.
  ipcMain.handle("gmail:listCombinedMessages", async (_event, params: unknown) => {
    const p = params as Record<string, unknown>;
    console.log("[gmail:listCombinedMessages]", {
      selectionCount: Array.isArray(p?.selections) ? p.selections.length : 0,
      pageToken: p?.pageToken,
    });
    try {
      const rawSelections = Array.isArray(p?.selections) ? p.selections : [];
      const selections = rawSelections
        .map((s) => s as Record<string, unknown>)
        .filter((s) => typeof s?.accountId === "string" && typeof s?.labelId === "string")
        .map((s) => ({ accountId: s.accountId as string, labelId: s.labelId as string }));
      const pageToken = asString(p?.pageToken);
      const maxResults = asNumber(p?.maxResults) ?? LOCAL_PAGE_SIZE;
      const offset = pageToken ? Number.parseInt(pageToken, 10) || 0 : 0;

      void mailSync.syncAllAccounts();

      const page = mailStore.getCombinedMessagesBySelections(selections, offset, maxResults);
      return {
        messages: page.messages,
        nextPageToken: page.hasMore ? String(offset + maxResults) : undefined,
      };
    } catch (err) {
      console.log("[gmail:listCombinedMessages] error", { error: String(err) });
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
      // Return the cached body if we already fetched it; otherwise fetch full
      // once and persist so re-opens are instant and work offline.
      const cached = mailStore.getMessageDetail(accountId, messageId);
      if (cached) return cached;
      const detail = await getMessage(accountId, messageId);
      mailStore.upsertMessageDetail(accountId, detail);
      return detail;
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
      const addLabelIds = asStringArray(p?.addLabelIds);
      const removeLabelIds = asStringArray(p?.removeLabelIds);
      const result = await modifyMessage(accountId, messageId, { addLabelIds, removeLabelIds });
      mailStore.applyLabelChange(accountId, messageId, addLabelIds ?? [], removeLabelIds ?? []);
      return result;
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
      const result = await trashMessage(accountId, messageId);
      mailStore.deleteMessage(accountId, messageId);
      return result;
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

  // gmail:syncAccount — kick off a background sync, return current status
  ipcMain.handle("gmail:syncAccount", async (_event, params: unknown) => {
    const p = params as Record<string, unknown>;
    console.log("[gmail:syncAccount]", { accountId: p?.accountId });
    try {
      const accountId = assertString(p?.accountId, "accountId");
      mailSync.syncAccount(accountId);
      return mailSync.getSyncStatus(accountId);
    } catch (err) {
      console.log("[gmail:syncAccount] error", { error: String(err) });
      throw err;
    }
  });

  // gmail:getSyncStatus — poll background sync progress for an account
  ipcMain.handle("gmail:getSyncStatus", async (_event, params: unknown) => {
    const p = params as Record<string, unknown>;
    try {
      const accountId = assertString(p?.accountId, "accountId");
      return mailSync.getSyncStatus(accountId);
    } catch (err) {
      console.log("[gmail:getSyncStatus] error", { error: String(err) });
      throw err;
    }
  });
}
