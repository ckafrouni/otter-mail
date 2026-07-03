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
  updateAccount as storeUpdateAccount,
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
  modifyThread,
  trashThread,
  sendMessage,
  getAttachment,
} from "../services/gmail-api.js";
import * as mailStore from "../services/mail-store.js";
import * as mailSync from "../services/mail-sync.js";
import { getSettings, updateSettings } from "../services/settings-store.js";
import * as viewsStore from "../services/views-store.js";
import type { MailView, ViewRule } from "../gmail/types.js";

const LOCAL_PAGE_SIZE = 50;

function parseRules(raw: unknown): ViewRule[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((r) => r as Record<string, unknown>)
    .filter((r) => typeof r?.accountId === "string")
    .map((r) => ({
      accountId: r.accountId as string,
      allOf: Array.isArray(r.allOf) ? r.allOf.filter((x): x is string => typeof x === "string") : [],
      noneOf: Array.isArray(r.noneOf) ? r.noneOf.filter((x): x is string => typeof x === "string") : [],
    }));
}

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

  // gmail:updateAccount — persists a user-set display name / color for an account,
  // then notifies every window so the sidebar/message list pick up the change live.
  ipcMain.handle("gmail:updateAccount", async (_event, params: unknown) => {
    const p = params as Record<string, unknown>;
    console.log("[gmail:updateAccount]", { accountId: p?.accountId });
    try {
      const accountId = assertString(p?.accountId, "accountId");
      const displayName = asString(p?.displayName);
      const color = asString(p?.color);
      const updated = await storeUpdateAccount(accountId, { displayName, color });
      ipcMain.broadcast("gmail:accounts-changed");
      return updated;
    } catch (err) {
      console.log("[gmail:updateAccount] error", { error: String(err) });
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
      pageToken: p?.pageToken,
      maxResults: p?.maxResults,
    });
    try {
      const accountId = assertString(p?.accountId, "accountId");
      const labelIds = asStringArray(p?.labelIds);
      const pageToken = asString(p?.pageToken);
      const maxResults = asNumber(p?.maxResults) ?? LOCAL_PAGE_SIZE;

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

      const page = mailStore.getThreadsPage(accountId, labelId, offset, maxResults);
      return {
        messages: page.messages,
        nextPageToken: page.hasMore ? String(offset + maxResults) : undefined,
      };
    } catch (err) {
      console.log("[gmail:listMessages] error", { error: String(err) });
      throw err;
    }
  });

  // gmail:searchMessages — instant local full-text search (FTS5 over the mail
  // cache). accountId omitted = search every account; message-level rows.
  ipcMain.handle("gmail:searchMessages", async (_event, params: unknown) => {
    const p = params as Record<string, unknown>;
    console.log("[gmail:searchMessages]", {
      q: p?.q,
      accountId: p?.accountId,
      pageToken: p?.pageToken,
    });
    try {
      const q = assertString(p?.q, "q");
      const accountId = asString(p?.accountId) ?? null;
      const pageToken = asString(p?.pageToken);
      const maxResults = asNumber(p?.maxResults) ?? LOCAL_PAGE_SIZE;
      const offset = pageToken ? Number.parseInt(pageToken, 10) || 0 : 0;

      const page = mailStore.searchMessages(q, accountId, offset, maxResults);
      return {
        messages: page.messages,
        nextPageToken: page.hasMore ? String(offset + maxResults) : undefined,
      };
    } catch (err) {
      console.log("[gmail:searchMessages] error", { error: String(err) });
      throw err;
    }
  });

  // gmail:listCombinedMessages — cross-account query for the "Combined" mailbox.
  // `rules` are per-account: a message matches a rule when it has every label in
  // allOf (empty = any mail from the account) and none in noneOf; rules union.
  // Reads the local store and refreshes all accounts in the background.
  ipcMain.handle("gmail:listCombinedMessages", async (_event, params: unknown) => {
    const p = params as Record<string, unknown>;
    console.log("[gmail:listCombinedMessages]", {
      ruleCount: Array.isArray(p?.rules) ? p.rules.length : 0,
      pageToken: p?.pageToken,
    });
    try {
      const rules = parseRules(p?.rules);
      const pageToken = asString(p?.pageToken);
      const maxResults = asNumber(p?.maxResults) ?? LOCAL_PAGE_SIZE;
      const offset = pageToken ? Number.parseInt(pageToken, 10) || 0 : 0;

      void mailSync.syncAllAccounts();

      const page = mailStore.getCombinedThreadsByRules(rules, offset, maxResults);
      return {
        messages: page.messages,
        nextPageToken: page.hasMore ? String(offset + maxResults) : undefined,
      };
    } catch (err) {
      console.log("[gmail:listCombinedMessages] error", { error: String(err) });
      throw err;
    }
  });

  // gmail:countCombinedMessages — total/unread counts for a rule set (local store)
  ipcMain.handle("gmail:countCombinedMessages", async (_event, params: unknown) => {
    const p = params as Record<string, unknown>;
    try {
      return mailStore.countCombinedByRules(parseRules(p?.rules));
    } catch (err) {
      console.log("[gmail:countCombinedMessages] error", { error: String(err) });
      throw err;
    }
  });

  // gmail:listViews / saveView / deleteView / resetView — Combined-view store
  // (userData/views.json); mutations broadcast gmail:views-changed so every
  // window's view queries refresh.
  ipcMain.handle("gmail:listViews", async () => {
    try {
      return await viewsStore.listViews();
    } catch (err) {
      console.log("[gmail:listViews] error", { error: String(err) });
      throw err;
    }
  });

  ipcMain.handle("gmail:saveView", async (_event, params: unknown) => {
    const p = params as Record<string, unknown>;
    console.log("[gmail:saveView]", { id: p?.id, name: p?.name });
    try {
      const name = assertString(p?.name, "name");
      const id = typeof p?.id === "string" ? p.id : undefined;
      const view = await viewsStore.saveView({ id, name, rules: parseRules(p?.rules) });
      ipcMain.broadcast("gmail:views-changed");
      return view;
    } catch (err) {
      console.log("[gmail:saveView] error", { error: String(err) });
      throw err;
    }
  });

  ipcMain.handle("gmail:deleteView", async (_event, params: unknown) => {
    const p = params as Record<string, unknown>;
    console.log("[gmail:deleteView]", { viewId: p?.viewId });
    try {
      await viewsStore.deleteView(assertString(p?.viewId, "viewId"));
      ipcMain.broadcast("gmail:views-changed");
      return { ok: true };
    } catch (err) {
      console.log("[gmail:deleteView] error", { error: String(err) });
      throw err;
    }
  });

  ipcMain.handle("gmail:resetView", async (_event, params: unknown) => {
    const p = params as Record<string, unknown>;
    console.log("[gmail:resetView]", { viewId: p?.viewId });
    try {
      await viewsStore.resetView(assertString(p?.viewId, "viewId"));
      ipcMain.broadcast("gmail:views-changed");
      return { ok: true };
    } catch (err) {
      console.log("[gmail:resetView] error", { error: String(err) });
      throw err;
    }
  });

  // gmail:importViews — one-time migration of the renderer's legacy
  // localStorage view store; no-op once views.json exists.
  ipcMain.handle("gmail:importViews", async (_event, params: unknown) => {
    const p = params as Record<string, unknown>;
    try {
      const raw = Array.isArray(p?.views) ? p.views : [];
      const views = raw
        .map((v) => v as Record<string, unknown>)
        .filter(
          (v) =>
            typeof v?.id === "string" &&
            typeof v?.name === "string" &&
            (v.kind === "inbox" || v.kind === "sent" || v.kind === "custom"),
        )
        .map(
          (v): MailView => ({
            id: v.id as string,
            name: v.name as string,
            kind: v.kind as MailView["kind"],
            rules: v.rules === null ? null : parseRules(v.rules),
          }),
        );
      await viewsStore.importViews(views);
      ipcMain.broadcast("gmail:views-changed");
      return await viewsStore.listViews();
    } catch (err) {
      console.log("[gmail:importViews] error", { error: String(err) });
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

  // gmail:getThread — all locally-cached messages of a thread, oldest first
  ipcMain.handle("gmail:getThread", async (_event, params: unknown) => {
    const p = params as Record<string, unknown>;
    console.log("[gmail:getThread]", { accountId: p?.accountId, threadId: p?.threadId });
    try {
      const accountId = assertString(p?.accountId, "accountId");
      const threadId = assertString(p?.threadId, "threadId");
      return mailStore.getThreadMessages(accountId, threadId);
    } catch (err) {
      console.log("[gmail:getThread] error", { error: String(err) });
      throw err;
    }
  });

  // gmail:modifyThread — one Gmail call for the whole conversation, mirrored locally
  ipcMain.handle("gmail:modifyThread", async (_event, params: unknown) => {
    const p = params as Record<string, unknown>;
    console.log("[gmail:modifyThread]", { accountId: p?.accountId, threadId: p?.threadId });
    try {
      const accountId = assertString(p?.accountId, "accountId");
      const threadId = assertString(p?.threadId, "threadId");
      const addLabelIds = asStringArray(p?.addLabelIds);
      const removeLabelIds = asStringArray(p?.removeLabelIds);
      const result = await modifyThread(accountId, threadId, { addLabelIds, removeLabelIds });
      mailStore.applyLabelChangeToThread(accountId, threadId, addLabelIds ?? [], removeLabelIds ?? []);
      return result;
    } catch (err) {
      console.log("[gmail:modifyThread] error", { error: String(err) });
      throw err;
    }
  });

  // gmail:trashThread
  ipcMain.handle("gmail:trashThread", async (_event, params: unknown) => {
    const p = params as Record<string, unknown>;
    console.log("[gmail:trashThread]", { accountId: p?.accountId, threadId: p?.threadId });
    try {
      const accountId = assertString(p?.accountId, "accountId");
      const threadId = assertString(p?.threadId, "threadId");
      const result = await trashThread(accountId, threadId);
      mailStore.deleteThread(accountId, threadId);
      return result;
    } catch (err) {
      console.log("[gmail:trashThread] error", { error: String(err) });
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

  // gmail:getSyncSettings — read the periodic pull-sync configuration
  ipcMain.handle("gmail:getSyncSettings", async () => {
    try {
      return await getSettings();
    } catch (err) {
      console.log("[gmail:getSyncSettings] error", { error: String(err) });
      throw err;
    }
  });

  // gmail:setSyncSettings — persist the interval and restart the timer
  ipcMain.handle("gmail:setSyncSettings", async (_event, params: unknown) => {
    const p = params as Record<string, unknown>;
    console.log("[gmail:setSyncSettings]", { syncIntervalSeconds: p?.syncIntervalSeconds });
    try {
      const raw = p?.syncIntervalSeconds;
      if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0) {
        throw new Error('Invalid parameter: "syncIntervalSeconds" must be a non-negative number.');
      }
      const syncIntervalSeconds = Math.min(Math.round(raw), 24 * 60 * 60);
      const settings = await updateSettings({ syncIntervalSeconds });
      mailSync.configureAutoSync(settings.syncIntervalSeconds);
      return settings;
    } catch (err) {
      console.log("[gmail:setSyncSettings] error", { error: String(err) });
      throw err;
    }
  });
}
