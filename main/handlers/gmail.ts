/**
 * gmail.ts — IPC handler registration for the Gmail client.
 *
 * All channels proxy to services (credentials-store, account-store,
 * gmail-oauth, gmail-api). Handlers are thin; business logic lives in services.
 */

import { app, ipcMain, nativeImage, shell, WebContents } from "@glaze/core/backend";
import {
  listAccounts,
  removeAccount as storeRemoveAccount,
  updateAccount as storeUpdateAccount,
} from "../services/account-store.js";
import { addAccount as oauthAddAccount, removeAccountTokens } from "../services/gmail-oauth.js";
import {
  listLabels,
  createLabel,
  getMessage,
  modifyMessage,
  trashMessage,
  modifyThread,
  trashThread,
  untrashThread,
  untrashMessage,
  batchDeleteMessages,
  listMessageIdsPage,
  saveDraft,
  deleteDraft,
  sendMessage,
  getAttachment,
  getAttachmentData,
  saveComposeAttachmentToTemp,
  saveAttachmentToTemp,
  pickComposeAttachments,
  fetchReplyHeaders,
  fetchMetadataForIds,
  MAX_ATTACHMENT_TOTAL_BYTES,
  findDraftIdByMessageId,
  updateLabel,
  deleteLabel,
  proxyRemoteImage,
  getDraftVersion,
} from "../services/gmail-api.js";
import * as mailStore from "../services/mail-store.js";
import { IPC_WRITE_BUDGET_MS, atMost, runAsTask, settleGmailWrite, sleep } from "./ipc-budget.js";
import { forgetLiveCursors, pageWithLiveFill, reconcileUnread } from "./live-paging.js";
import { trackLabelWrite } from "../services/pending-label-writes.js";
import {
  draftSessionId,
  mirrorDraft,
  queueDraftSave,
  rememberSessionDraft,
  sessionDraftId,
  takeSessionDraft,
} from "./draft-sessions.js";
import * as mailSync from "../services/mail-sync.js";
import { getSenderAvatar } from "../services/avatar-store.js";
import { updateDockBadge } from "../services/notifier.js";
import { refreshTray, createTray, destroyTray } from "../services/tray.js";
import { getSettings, updateSettings, type AppSettings } from "../services/settings-store.js";
import * as viewsStore from "../services/views-store.js";
import { ALL_MAIL_LABEL_ID } from "../gmail/types.js";
import type { ComposeAttachment, MailView, ViewRule } from "../gmail/types.js";

const LOCAL_PAGE_SIZE = 50;

/** Re-reads every label from Gmail (names, colors, counts) into the cache. */
async function refreshLabels(accountId: string): Promise<void> {
  mailStore.upsertLabels(accountId, await listLabels(accountId));
}

/** Re-reads Gmail's labels for messages after a trash/untrash (Gmail may
 *  also drop INBOX etc.) and recounts the labels involved. */
async function refreshMetadata(accountId: string, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const before = new Set(ids.flatMap((id) => mailStore.getMessageLabelIds(accountId, id) ?? []));
  const fresh = await fetchMetadataForIds(accountId, ids);
  mailStore.upsertMessages(accountId, fresh);
  for (const m of fresh) for (const l of m.labelIds) before.add(l);
  mailStore.recountLabels(accountId, [...before]);
  updateDockBadge();
}

/** Applies a label change to the local cache and returns an exact undo: only
 *  labels that actually changed on each message are restored, so undoing
 *  "remove INBOX" never adds INBOX to a thread's sent replies. */
function applyLocalLabelChange(
  accountId: string,
  messageIds: string[],
  add: string[],
  remove: string[],
): () => void {
  const undo = messageIds.flatMap((id) => {
    const prior = mailStore.getMessageLabelIds(accountId, id);
    if (!prior) return [];
    const reAdd = remove.filter((l) => prior.includes(l));
    const reRemove = add.filter((l) => !prior.includes(l));
    mailStore.applyLabelChange(accountId, id, add, remove);
    return [{ id, reAdd, reRemove }];
  });
  updateDockBadge();
  return () => {
    for (const u of undo) mailStore.applyLabelChange(accountId, u.id, u.reAdd, u.reRemove);
    updateDockBadge();
  };
}

/** Mirrors a label change locally, then settles its Gmail write within the IPC
 *  budget. While the write is pending, reads from Gmail keep the change (see
 *  pending-label-writes); if it fails, the local change is reverted. */
function settleLabelWrite(
  channel: string,
  accountId: string,
  messageIds: string[],
  add: string[],
  remove: string[],
  write: () => Promise<unknown>,
): Promise<{ ok: true; pending?: boolean }> {
  const revert = applyLocalLabelChange(accountId, messageIds, add, remove);
  const tracked = trackLabelWrite(accountId, messageIds, add, remove);
  const running = write();
  running.then(tracked.settled, tracked.dropped);
  return settleGmailWrite(channel, running, revert);
}

function parseRules(raw: unknown): ViewRule[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((r) => r as Record<string, unknown>)
    .filter((r) => typeof r?.accountId === "string")
    .map((r) => ({
      accountId: r.accountId as string,
      allOf: Array.isArray(r.allOf)
        ? r.allOf.filter((x): x is string => typeof x === "string")
        : [],
      noneOf: Array.isArray(r.noneOf)
        ? r.noneOf.filter((x): x is string => typeof x === "string")
        : [],
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

function parseAttachments(raw: unknown): ComposeAttachment[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const list = raw
    .map((a) => a as Record<string, unknown>)
    .filter(
      (a) =>
        typeof a?.name === "string" &&
        typeof a?.mimeType === "string" &&
        typeof a?.base64 === "string",
    )
    .map((a) => ({
      name: a.name as string,
      mimeType: a.mimeType as string,
      size: typeof a.size === "number" ? a.size : Math.floor(((a.base64 as string).length * 3) / 4),
      base64: a.base64 as string,
    }));
  return list.length > 0 ? list : undefined;
}

// ── Registration ──────────────────────────────────────────────────────────────

export function registerGmailHandlers(): void {
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
      const account = await oauthAddAccount();
      // The browser sign-in outlasts the renderer's IPC timeout, so the caller
      // usually never sees this return — tell every window to reload accounts.
      ipcMain.broadcast("gmail:accounts-changed");
      return account;
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
      mailSync.forgetAccount(accountId);
      forgetLiveCursors(accountId);
      await removeAccountTokens(accountId);
      await storeRemoveAccount(accountId);
      mailStore.removeAccountData(accountId);
      updateDockBadge();
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
      const signature = asString(p?.signature);
      const updated = await storeUpdateAccount(accountId, { displayName, color, signature });
      ipcMain.broadcast("gmail:accounts-changed");
      void refreshTray();
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
      // Gmail assigns the id, so this one waits; mirror it so the renderer's
      // refetch (served from the cache) keeps showing the new label.
      const label = await createLabel(accountId, name);
      mailStore.putLabel(accountId, label);
      return label;
    } catch (err) {
      console.log("[gmail:createLabel] error", { error: String(err) });
      throw err;
    }
  });

  // gmail:updateLabel — rename (cascades to nested labels) and/or recolor
  ipcMain.handle("gmail:updateLabel", async (_event, params: unknown) => {
    const p = params as Record<string, unknown>;
    console.log("[gmail:updateLabel]", {
      accountId: p?.accountId,
      labelId: p?.labelId,
      name: p?.name,
    });
    try {
      const accountId = assertString(p?.accountId, "accountId");
      const labelId = assertString(p?.labelId, "labelId");
      const name = asString(p?.name);
      const colorRaw = p?.color as Record<string, unknown> | undefined;
      const color = colorRaw
        ? {
            backgroundColor: assertString(colorRaw.backgroundColor, "color.backgroundColor"),
            textColor: assertString(colorRaw.textColor, "color.textColor"),
          }
        : undefined;
      // Mirror first, answer inside the IPC budget; the full label refresh
      // (one request per label) runs after Gmail confirms.
      const revert = mailStore.editLabelLocally(accountId, labelId, { name, color });
      return await settleGmailWrite(
        "gmail:updateLabel",
        updateLabel(accountId, { labelId, name, color }).then(() => refreshLabels(accountId)),
        revert,
      );
    } catch (err) {
      console.log("[gmail:updateLabel] error", { error: String(err) });
      throw err;
    }
  });

  // gmail:deleteLabel — removes the label everywhere (sub-labels survive)
  ipcMain.handle("gmail:deleteLabel", async (_event, params: unknown) => {
    const p = params as Record<string, unknown>;
    console.log("[gmail:deleteLabel]", { accountId: p?.accountId, labelId: p?.labelId });
    try {
      const accountId = assertString(p?.accountId, "accountId");
      const labelId = assertString(p?.labelId, "labelId");
      const revert = mailStore.removeLabelLocally(accountId, labelId);
      return await settleGmailWrite(
        "gmail:deleteLabel",
        deleteLabel(accountId, labelId).then(() => refreshLabels(accountId)),
        revert,
      );
    } catch (err) {
      console.log("[gmail:deleteLabel] error", { error: String(err) });
      throw err;
    }
  });

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

      // Gmail's counter says there's unread mail we don't have yet (e.g. the
      // first full sync is still running): pull it in so the list and its
      // Unread filter show what the badge counts.
      if (offset === 0) await atMost(reconcileUnread(accountId, labelId), 1000);

      mailSync.syncAccount(accountId);

      // All Mail has no Gmail label: live-fill it from the unfiltered listing.
      const liveLabelId = labelId === ALL_MAIL_LABEL_ID ? null : labelId;
      const page = await pageWithLiveFill([{ accountId, labelId: liveLabelId }], maxResults, () =>
        mailStore.getThreadsPage(accountId, labelId, offset, maxResults),
      );
      return {
        messages: page.messages,
        // Continue after the rows actually returned: short pages grow as the
        // cache fills, and a fixed stride would skip what arrived in between.
        nextPageToken: page.more ? String(offset + page.messages.length) : undefined,
      };
    } catch (err) {
      console.log("[gmail:listMessages] error", { error: String(err) });
      throw err;
    }
  });

  // gmail:searchMessages — instant local full-text search (FTS5 over the mail
  // cache). accountId omitted = search every account; message-level rows.
  // labelId/rules restrict to the current view; starred/important/
  // hasAttachments/withinDays are structured filters that also work with an
  // empty q.
  ipcMain.handle("gmail:searchMessages", async (_event, params: unknown) => {
    const p = params as Record<string, unknown>;
    console.log("[gmail:searchMessages]", {
      q: p?.q,
      accountId: p?.accountId,
      labelId: p?.labelId,
      ruleCount: Array.isArray(p?.rules) ? p.rules.length : undefined,
      starred: p?.starred,
      important: p?.important,
      hasAttachments: p?.hasAttachments,
      withinDays: p?.withinDays,
      pageToken: p?.pageToken,
    });
    try {
      const q = asString(p?.q) ?? "";
      const accountId = asString(p?.accountId) ?? null;
      const labelId = asString(p?.labelId);
      const rules = p?.rules === undefined ? undefined : parseRules(p.rules);
      const pageToken = asString(p?.pageToken);
      const maxResults = asNumber(p?.maxResults) ?? LOCAL_PAGE_SIZE;
      const offset = pageToken ? Number.parseInt(pageToken, 10) || 0 : 0;

      const page = mailStore.searchMessages(q, accountId, offset, maxResults, {
        labelId,
        rules,
        starred: p?.starred === true || undefined,
        important: p?.important === true || undefined,
        hasAttachments: p?.hasAttachments === true || undefined,
        withinDays: asNumber(p?.withinDays),
      });
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

      const sources = rules.map((r) => ({ accountId: r.accountId, labelId: r.allOf[0] ?? null }));
      const page = await pageWithLiveFill(sources, maxResults, () =>
        mailStore.getCombinedThreadsByRules(rules, offset, maxResults),
      );
      return {
        messages: page.messages,
        nextPageToken: page.more ? String(offset + page.messages.length) : undefined,
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
      const view = await viewsStore.saveView({
        id,
        name,
        rules: parseRules(p?.rules),
        mailbox: asString(p?.mailbox),
      });
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
            (v.kind === "inbox" ||
              v.kind === "starred" ||
              v.kind === "sent" ||
              v.kind === "drafts" ||
              v.kind === "important" ||
              v.kind === "junk" ||
              v.kind === "trash" ||
              v.kind === "custom"),
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
      return await settleLabelWrite(
        "gmail:modifyMessage",
        accountId,
        [messageId],
        addLabelIds ?? [],
        removeLabelIds ?? [],
        () => modifyMessage(accountId, messageId, { addLabelIds, removeLabelIds }),
      );
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
      // Mirror locally first (lists drop it now, counts update) and answer
      // inside the IPC budget; Gmail + the metadata refresh finish after.
      return await settleLabelWrite(
        "gmail:trashMessage",
        accountId,
        [messageId],
        ["TRASH"],
        [],
        () =>
          trashMessage(accountId, messageId).then(() => refreshMetadata(accountId, [messageId])),
      );
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
      return await settleLabelWrite(
        "gmail:modifyThread",
        accountId,
        mailStore.getThreadMessages(accountId, threadId).map((m) => m.id),
        addLabelIds ?? [],
        removeLabelIds ?? [],
        () => modifyThread(accountId, threadId, { addLabelIds, removeLabelIds }),
      );
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
      // Keep the rows (the Trash view reads them from the cache), mirrored as
      // trashed right away; Gmail + the metadata refresh finish after.
      const ids = mailStore.getThreadMessages(accountId, threadId).map((m) => m.id);
      return await settleLabelWrite("gmail:trashThread", accountId, ids, ["TRASH"], [], () =>
        trashThread(accountId, threadId).then(() => refreshMetadata(accountId, ids)),
      );
    } catch (err) {
      console.log("[gmail:trashThread] error", { error: String(err) });
      throw err;
    }
  });

  // gmail:untrashThread / gmail:untrashMessage — undo for trash: Gmail restores
  // the previous labels; the fresh metadata re-seeds the locally-deleted rows.
  ipcMain.handle("gmail:untrashThread", async (_event, params: unknown) => {
    const p = params as Record<string, unknown>;
    console.log("[gmail:untrashThread]", { accountId: p?.accountId, threadId: p?.threadId });
    try {
      const accountId = assertString(p?.accountId, "accountId");
      const threadId = assertString(p?.threadId, "threadId");
      const ids = mailStore.getThreadMessages(accountId, threadId).map((m) => m.id);
      return await settleLabelWrite("gmail:untrashThread", accountId, ids, [], ["TRASH"], () =>
        untrashThread(accountId, threadId).then((fresh) => {
          mailStore.upsertMessages(accountId, fresh);
          mailStore.recountLabels(accountId, [
            ...new Set(fresh.flatMap((m) => m.labelIds)),
            "TRASH",
          ]);
          updateDockBadge();
        }),
      );
    } catch (err) {
      console.log("[gmail:untrashThread] error", { error: String(err) });
      throw err;
    }
  });

  ipcMain.handle("gmail:untrashMessage", async (_event, params: unknown) => {
    const p = params as Record<string, unknown>;
    console.log("[gmail:untrashMessage]", { accountId: p?.accountId, messageId: p?.messageId });
    try {
      const accountId = assertString(p?.accountId, "accountId");
      const messageId = assertString(p?.messageId, "messageId");
      return await settleLabelWrite(
        "gmail:untrashMessage",
        accountId,
        [messageId],
        [],
        ["TRASH"],
        () =>
          untrashMessage(accountId, messageId).then((fresh) => {
            mailStore.upsertMessages(accountId, fresh);
            mailStore.recountLabels(accountId, [
              ...new Set(fresh.flatMap((m) => m.labelIds)),
              "TRASH",
            ]);
            updateDockBadge();
          }),
      );
    } catch (err) {
      console.log("[gmail:untrashMessage] error", { error: String(err) });
      throw err;
    }
  });

  // gmail:deleteThreadsForever — permanent delete; the UI only offers it on
  // Trash/Spam conversations. Threads resolve to message ids locally so the
  // whole batch goes out as one messages.batchDelete call.
  ipcMain.handle("gmail:deleteThreadsForever", async (_event, params: unknown) => {
    const p = params as Record<string, unknown>;
    const threadIds = asStringArray(p?.threadIds) ?? [];
    console.log("[gmail:deleteThreadsForever]", {
      accountId: p?.accountId,
      count: threadIds.length,
    });
    try {
      const accountId = assertString(p?.accountId, "accountId");
      // Only messages actually in Trash/Spam: a conversation is listed there if
      // ANY message is, and its other messages (a new Inbox reply, your Sent
      // replies) must survive — like Gmail's own "Delete forever".
      const messageIds: string[] = [];
      for (const threadId of threadIds) {
        for (const m of mailStore.getThreadMessages(accountId, threadId)) {
          if (m.labelIds.includes("TRASH") || m.labelIds.includes("SPAM")) messageIds.push(m.id);
        }
      }
      if (messageIds.length > 0) await batchDeleteMessages(accountId, messageIds);
      for (const id of messageIds) mailStore.deleteMessage(accountId, id);
      updateDockBadge();
      return { ok: true as const };
    } catch (err) {
      console.log("[gmail:deleteThreadsForever] error", { error: String(err) });
      throw err;
    }
  });

  // gmail:emptyFolder — Empty Junk / Empty Trash: permanently deletes every
  // message in SPAM or TRASH, from Gmail's own listing (the cache may not have
  // them all) plus anything only cached. Big folders outlast the IPC timeout,
  // so it reports back as a task.
  ipcMain.handle("gmail:emptyFolder", async (_event, params: unknown) => {
    const p = params as Record<string, unknown>;
    console.log("[gmail:emptyFolder]", { accountId: p?.accountId, labelId: p?.labelId });
    try {
      const accountId = assertString(p?.accountId, "accountId");
      const labelId = assertString(p?.labelId, "labelId");
      if (labelId !== "SPAM" && labelId !== "TRASH") {
        throw new Error("Only Junk and Trash can be emptied.");
      }
      return await runAsTask(asString(p?.taskId), async () => {
        const ids = new Set(mailStore.getMessageIdsForLabel(accountId, labelId));
        let pageToken: string | undefined;
        do {
          const page = await listMessageIdsPage(accountId, { labelIds: [labelId], pageToken });
          for (const id of page.ids) ids.add(id);
          pageToken = page.nextPageToken;
        } while (pageToken);
        const messageIds = [...ids];
        if (messageIds.length > 0) await batchDeleteMessages(accountId, messageIds);
        for (const id of messageIds) mailStore.deleteMessage(accountId, id);
        mailStore.recountLabels(accountId, [labelId]);
        updateDockBadge();
        console.log("[gmail:emptyFolder] done", { labelId, deleted: messageIds.length });
        return { deleted: messageIds.length };
      });
    } catch (err) {
      console.log("[gmail:emptyFolder] error", { error: String(err) });
      throw err;
    }
  });

  // gmail:saveDraft — composer autosave; creates or updates a Gmail draft.
  // Saves for one composer (its `sessionKey`) run in order and reuse the draft
  // id of the previous save — so a first save that outlasted the renderer's IPC
  // timeout (its reply, with the new id, never arrived) can't make the next
  // save create a second draft.
  ipcMain.handle("gmail:saveDraft", async (_event, params: unknown) => {
    const p = params as Record<string, unknown>;
    console.log("[gmail:saveDraft]", {
      accountId: p?.accountId,
      draftId: p?.draftId ?? "(new)",
      threadId: p?.threadId,
    });
    try {
      const accountId = assertString(p?.accountId, "accountId");
      const sessionKey = asString(p?.sessionKey);
      const content = {
        to: asString(p?.to) ?? "",
        cc: asString(p?.cc),
        bcc: asString(p?.bcc),
        subject: asString(p?.subject) ?? "",
        body: asString(p?.body) ?? "",
        bodyHtml: asString(p?.bodyHtml),
        attachments: parseAttachments(p?.attachments),
      };
      const expectMessageId = asString(p?.expectMessageId);
      const save = async () => {
        const draftId =
          asString(p?.draftId) ?? sessionDraftId(draftSessionId(accountId, sessionKey));
        // Someone else (Hermes, Gmail web, a phone) may have edited this draft
        // since the composer last saw it: never overwrite that silently.
        if (draftId && expectMessageId) {
          const current = await getDraftVersion(accountId, draftId);
          if (current === null) return { gone: true as const, draftId };
          if (current !== expectMessageId) {
            return { conflict: true as const, draftId, messageId: current };
          }
        }
        const res = await saveDraft(accountId, {
          ...content,
          draftId,
          threadId: asString(p?.threadId),
        });
        rememberSessionDraft(draftSessionId(accountId, sessionKey), res.draftId);
        await mirrorDraft(accountId, res, content);
        return { draftId: res.draftId, messageId: res.messageId, threadId: res.threadId };
      };
      return await queueDraftSave(draftSessionId(accountId, sessionKey), save);
    } catch (err) {
      console.log("[gmail:saveDraft] error", { error: String(err) });
      throw err;
    }
  });

  // gmail:getDraftVersion — which message backs a draft right now (null = the
  // draft is gone). Open composers poll this to notice edits made elsewhere.
  ipcMain.handle("gmail:getDraftVersion", async (_event, params: unknown) => {
    const p = params as Record<string, unknown>;
    try {
      const accountId = assertString(p?.accountId, "accountId");
      const draftId = assertString(p?.draftId, "draftId");
      return { messageId: await getDraftVersion(accountId, draftId) };
    } catch (err) {
      console.log("[gmail:getDraftVersion] error", { error: String(err) });
      throw err;
    }
  });

  // gmail:loadDraftVersion — a draft's content at a given version, mirrored
  // into the cache (the lists show the new version too).
  ipcMain.handle("gmail:loadDraftVersion", async (_event, params: unknown) => {
    const p = params as Record<string, unknown>;
    console.log("[gmail:loadDraftVersion]", { draftId: p?.draftId, messageId: p?.messageId });
    try {
      const accountId = assertString(p?.accountId, "accountId");
      const draftId = assertString(p?.draftId, "draftId");
      const messageId = assertString(p?.messageId, "messageId");
      const detail = await getMessage(accountId, messageId);
      mailStore.upsertMessageDetail(accountId, detail);
      mailStore.setDraftId(accountId, messageId, draftId);
      if (detail.threadId)
        mailStore.deleteOtherDraftsInThread(accountId, detail.threadId, messageId);
      return detail;
    } catch (err) {
      console.log("[gmail:loadDraftVersion] error", { error: String(err) });
      throw err;
    }
  });

  // gmail:getDraftForMessage — resolve the draft id owning a message row
  ipcMain.handle("gmail:getDraftForMessage", async (_event, params: unknown) => {
    const p = params as Record<string, unknown>;
    try {
      const accountId = assertString(p?.accountId, "accountId");
      const messageId = assertString(p?.messageId, "messageId");
      const threadId = asString(p?.threadId);
      // Local first (recorded on save and by sync); Gmail lookup as fallback.
      const known = mailStore.getDraftId(accountId, messageId, threadId);
      if (known) return { draftId: known };
      const draftId = await findDraftIdByMessageId(accountId, messageId, threadId);
      if (draftId) mailStore.setDraftId(accountId, messageId, draftId);
      console.log("[gmail:getDraftForMessage]", { accountId, messageId, found: draftId != null });
      return { draftId };
    } catch (err) {
      console.log("[gmail:getDraftForMessage] error", { error: String(err) });
      throw err;
    }
  });

  ipcMain.handle("gmail:deleteDraft", async (_event, params: unknown) => {
    const p = params as Record<string, unknown>;
    console.log("[gmail:deleteDraft]", { accountId: p?.accountId, draftId: p?.draftId });
    try {
      const accountId = assertString(p?.accountId, "accountId");
      // By id, or by composer session (its first save's reply may never have
      // reached the renderer). Waits for that session's queued saves first.
      const sessionKey = asString(p?.sessionKey);
      const sessionDraft = await takeSessionDraft(draftSessionId(accountId, sessionKey));
      const draftId = asString(p?.draftId) ?? sessionDraft;
      if (!draftId) return { ok: true as const };
      const res = await deleteDraft(accountId, draftId);
      if (res.messageId) mailStore.deleteMessage(accountId, res.messageId);
      return { ok: true as const };
    } catch (err) {
      console.log("[gmail:deleteDraft] error", { error: String(err) });
      throw err;
    }
  });

  // gmail:sendMessage — threading (threadId + In-Reply-To/References resolved
  // from replyToMessageId) and multipart attachments are optional.
  ipcMain.handle("gmail:sendMessage", async (_event, params: unknown) => {
    const p = params as Record<string, unknown>;
    console.log("[gmail:sendMessage]", {
      accountId: p?.accountId,
      to: p?.to,
      subject: p?.subject,
      threadId: p?.threadId,
      attachments: Array.isArray(p?.attachments) ? p.attachments.length : 0,
    });
    try {
      const accountId = assertString(p?.accountId, "accountId");
      const to = assertString(p?.to, "to");
      const subject = assertString(p?.subject, "subject");
      // An empty body is fine (subject-only, or just attachments).
      const body = asString(p?.body) ?? "";
      const threadId = asString(p?.threadId);
      const replyToMessageId = asString(p?.replyToMessageId);
      const attachments = parseAttachments(p?.attachments);

      const totalBytes = (attachments ?? []).reduce(
        (sum, a) => sum + Math.floor((a.base64.length * 3) / 4),
        0,
      );
      if (totalBytes > MAX_ATTACHMENT_TOTAL_BYTES) {
        throw new Error("Attachments can total at most 25 MB.");
      }

      let inReplyTo: string | undefined;
      let references: string | undefined;
      if (replyToMessageId) {
        let headers = mailStore.getStoredReplyHeaders(accountId, replyToMessageId);
        if (!headers.messageIdHeader) {
          try {
            headers = await fetchReplyHeaders(accountId, replyToMessageId);
            mailStore.setReplyHeaders(
              accountId,
              replyToMessageId,
              headers.messageIdHeader,
              headers.referencesHeader,
            );
          } catch (headerErr) {
            // Still threads via threadId; Gmail just loses the References chain.
            console.log("[gmail:sendMessage] reply-header fetch failed", {
              error: String(headerErr),
            });
          }
        }
        if (headers.messageIdHeader) {
          inReplyTo = headers.messageIdHeader;
          references = headers.referencesHeader
            ? `${headers.referencesHeader} ${headers.messageIdHeader}`
            : headers.messageIdHeader;
        }
      }

      const message = {
        to,
        cc: asString(p?.cc),
        bcc: asString(p?.bcc),
        subject,
        body,
        bodyHtml: asString(p?.bodyHtml),
        threadId,
        attachments,
      };
      const send = sendMessage(accountId, { ...message, inReplyTo, references }).then(
        async (result) => {
          // Mirror the sent message so it shows in Sent and its conversation
          // before the next sync. Best effort: the mail has already gone out.
          if (!result.messageId) return;
          try {
            mailStore.upsertMessages(
              accountId,
              await fetchMetadataForIds(accountId, [result.messageId]),
            );
          } catch (mirrorErr) {
            console.log("[gmail:sendMessage] sent; local mirror failed", {
              error: String(mirrorErr),
            });
          }
        },
      );
      // Uploads (attachments, rate limits) can outlast the renderer's 5s IPC
      // timeout, which used to report a false failure and invite a duplicate
      // send. Past the budget the composer closes as sent; if the send then
      // fails, the message goes back to Drafts so nothing is lost.
      // `settled` never rejects, so a failure after the deadline can't become
      // an unhandled rejection.
      const settled = send.then(
        () => ({ error: null }),
        (error: unknown) => ({ error }),
      );
      const outcome = await Promise.race([settled, sleep(IPC_WRITE_BUDGET_MS).then(() => null)]);
      if (outcome?.error) throw outcome.error; // failed in time: the composer keeps its draft
      if (outcome === null) {
        void settled.then(async ({ error }) => {
          if (!error) return;
          console.log("[gmail:sendMessage] background send failed", { error: String(error) });
          let savedToDrafts = false;
          try {
            await saveDraft(accountId, message);
            savedToDrafts = true;
          } catch (draftErr) {
            console.log("[gmail:sendMessage] could not save a draft copy", {
              error: String(draftErr),
            });
          }
          ipcMain.broadcast("gmail:send-failed", { subject, savedToDrafts });
        });
      }
      return { ok: true as const, pending: outcome === null };
    } catch (err) {
      console.log("[gmail:sendMessage] error", { error: String(err) });
      throw err;
    }
  });

  // gmail:pickAttachments — backend open-file dialog, returns file contents
  ipcMain.handle("gmail:pickAttachments", async (_event, params: unknown) => {
    const p = params as Record<string, unknown>;
    console.log("[gmail:pickAttachments]", { existingBytes: p?.existingBytes });
    try {
      const existingBytes = asNumber(p?.existingBytes) ?? 0;
      return await runAsTask(asString(p?.taskId), () => pickComposeAttachments(existingBytes));
    } catch (err) {
      console.log("[gmail:pickAttachments] error", { error: String(err) });
      throw err;
    }
  });

  // gmail:getAttachmentData — attachment bytes as base64 (no save dialog)
  ipcMain.handle("gmail:getAttachmentData", async (_event, params: unknown) => {
    const p = params as Record<string, unknown>;
    console.log("[gmail:getAttachmentData]", {
      accountId: p?.accountId,
      messageId: p?.messageId,
      attachmentId: p?.attachmentId,
    });
    try {
      const accountId = assertString(p?.accountId, "accountId");
      const messageId = assertString(p?.messageId, "messageId");
      const attachmentId = assertString(p?.attachmentId, "attachmentId");
      return await runAsTask(asString(p?.taskId), () =>
        getAttachmentData(accountId, messageId, attachmentId),
      );
    } catch (err) {
      console.log("[gmail:getAttachmentData] error", { error: String(err) });
      throw err;
    }
  });

  // gmail:openAttachment — save to the temp cache and open with the default app
  ipcMain.handle("gmail:openAttachment", async (_event, params: unknown) => {
    const p = params as Record<string, unknown>;
    console.log("[gmail:openAttachment]", {
      accountId: p?.accountId,
      messageId: p?.messageId,
      filename: p?.filename,
    });
    try {
      const accountId = assertString(p?.accountId, "accountId");
      const messageId = assertString(p?.messageId, "messageId");
      const attachmentId = assertString(p?.attachmentId, "attachmentId");
      const filename = assertString(p?.filename, "filename");
      return await runAsTask(asString(p?.taskId), async () => {
        const filePath = await saveAttachmentToTemp(accountId, messageId, attachmentId, filename);
        const error = await shell.openPath(filePath);
        if (error) throw new Error(error);
        return { ok: true };
      });
    } catch (err) {
      console.log("[gmail:openAttachment] error", { error: String(err) });
      throw err;
    }
  });

  // gmail:openComposeAttachment — write in-memory compose bytes to temp and open
  ipcMain.handle("gmail:openComposeAttachment", async (_event, params: unknown) => {
    const p = params as Record<string, unknown>;
    console.log("[gmail:openComposeAttachment]", { name: p?.name });
    try {
      const name = assertString(p?.name, "name");
      const base64 = assertString(p?.base64, "base64");
      const filePath = await saveComposeAttachmentToTemp(name, base64);
      const error = await shell.openPath(filePath);
      if (error) throw new Error(error);
      return { ok: true };
    } catch (err) {
      console.log("[gmail:openComposeAttachment] error", { error: String(err) });
      throw err;
    }
  });

  // gmail:proxyImage — fetch a remote email image server-side (bypasses the
  // iframe's Cross-Origin-Resource-Policy block) and return it as a data URL
  ipcMain.handle("gmail:proxyImage", async (_event, params: unknown) => {
    const p = params as Record<string, unknown>;
    try {
      const url = assertString(p?.url, "url");
      return await proxyRemoteImage(url);
    } catch (err) {
      console.log("[gmail:proxyImage] error", { error: String(err) });
      throw err;
    }
  });

  // gmail:dragAttachment — native drag-out to Finder (startDrag needs a real file on disk)
  ipcMain.handle("gmail:dragAttachment", async (_event, params: unknown) => {
    const p = params as Record<string, unknown>;
    console.log("[gmail:dragAttachment]", {
      accountId: p?.accountId,
      messageId: p?.messageId,
      filename: p?.filename,
    });
    try {
      const accountId = assertString(p?.accountId, "accountId");
      const messageId = assertString(p?.messageId, "messageId");
      const attachmentId = assertString(p?.attachmentId, "attachmentId");
      const filename = assertString(p?.filename, "filename");
      return await runAsTask(asString(p?.taskId), async () => {
        const filePath = await saveAttachmentToTemp(accountId, messageId, attachmentId, filename);
        const icon = await nativeImage
          .createThumbnailFromPath(filePath, { width: 64, height: 64 })
          .catch(() => nativeImage.createEmpty());
        new WebContents("main").startDrag({ file: filePath, icon });
        return { ok: true };
      });
    } catch (err) {
      console.log("[gmail:dragAttachment] error", { error: String(err) });
      throw err;
    }
  });

  // gmail:suggestContacts — recipient autocomplete from the local cache
  ipcMain.handle("gmail:suggestContacts", async (_event, params: unknown) => {
    const p = params as Record<string, unknown>;
    try {
      const q = assertString(p?.q, "q");
      const limit = Math.min(Math.max(asNumber(p?.limit) ?? 8, 1), 20);
      return mailStore.suggestContacts(q, limit);
    } catch (err) {
      console.log("[gmail:suggestContacts] error", { error: String(err) });
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
      return await runAsTask(asString(p?.taskId), () =>
        getAttachment(accountId, messageId, attachmentId, filename, mimeType),
      );
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
      mailSync.syncAccount(accountId, { force: true });
      return mailSync.getSyncStatus(accountId);
    } catch (err) {
      console.log("[gmail:syncAccount] error", { error: String(err) });
      throw err;
    }
  });

  // gmail:getSenderAvatar — cached sender photo (People API / Gravatar / domain logo)
  ipcMain.handle("gmail:getSenderAvatar", async (_event, params: unknown) => {
    const p = params as Record<string, unknown>;
    try {
      const accountId = assertString(p?.accountId, "accountId");
      const email = assertString(p?.email, "email");
      const dataUrl = await getSenderAvatar(accountId, email);
      return { dataUrl };
    } catch (err) {
      console.log("[gmail:getSenderAvatar] error", { error: String(err) });
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

  // gmail:setSyncSettings — persist any provided settings; restarts the sync
  // timer when the interval changed.
  ipcMain.handle("gmail:setSyncSettings", async (_event, params: unknown) => {
    const p = params as Record<string, unknown>;
    console.log("[gmail:setSyncSettings]", {
      syncIntervalSeconds: p?.syncIntervalSeconds,
      notificationsMode: p?.notificationsMode,
    });
    try {
      const patch: Partial<AppSettings> = {};
      if (p?.syncIntervalSeconds !== undefined) {
        const raw = p.syncIntervalSeconds;
        if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0) {
          throw new Error(
            'Invalid parameter: "syncIntervalSeconds" must be a non-negative number.',
          );
        }
        patch.syncIntervalSeconds = Math.min(Math.round(raw), 24 * 60 * 60);
      }
      if (p?.notificationsMode !== undefined) {
        const mode = p.notificationsMode;
        if (mode !== "off" && mode !== "inbox" && mode !== "all") {
          throw new Error(
            'Invalid parameter: "notificationsMode" must be "off", "inbox", or "all".',
          );
        }
        patch.notificationsMode = mode;
      }
      if (p?.launchAtLogin !== undefined) {
        if (typeof p.launchAtLogin !== "boolean") {
          throw new Error('Invalid parameter: "launchAtLogin" must be a boolean.');
        }
        patch.launchAtLogin = p.launchAtLogin;
      }
      if (p?.trayEnabled !== undefined) {
        if (typeof p.trayEnabled !== "boolean") {
          throw new Error('Invalid parameter: "trayEnabled" must be a boolean.');
        }
        patch.trayEnabled = p.trayEnabled;
      }
      const settings = await updateSettings(patch);
      if (patch.syncIntervalSeconds !== undefined) {
        mailSync.configureAutoSync(settings.syncIntervalSeconds);
      }
      if (patch.launchAtLogin !== undefined) {
        app.setLoginItemSettings({ openAtLogin: settings.launchAtLogin });
      }
      if (patch.trayEnabled !== undefined) {
        if (settings.trayEnabled) {
          await createTray();
        } else {
          destroyTray();
        }
      }
      return settings;
    } catch (err) {
      console.log("[gmail:setSyncSettings] error", { error: String(err) });
      throw err;
    }
  });
}
