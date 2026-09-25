/**
 * Reader actions on special mail: calendar invitations (read the invite +
 * your answer, RSVP) and mailing-list unsubscribe. Slow calls run as tasks.
 */

import { ipcMain } from "@glaze/core/backend";
import { getInvite, respondToInvite, type RsvpResponse } from "../services/calendar-invites.js";
import { runAsTask } from "./ipc-budget.js";
import { getUnsubscribe, isUnsubscribed, unsubscribe } from "../services/unsubscribe.js";

type Params = Record<string, unknown> | undefined;
const str = (v: unknown) => (typeof v === "string" ? v : "");

export function registerCalendarHandlers(): void {
  ipcMain.handle("calendar:getInvite", async (_event, params: unknown) => {
    const p = params as Params;
    const accountId = str(p?.accountId);
    const messageId = str(p?.messageId);
    if (!accountId || !messageId) throw new Error("accountId and messageId are required.");
    return runAsTask(str(p?.taskId) || undefined, () => getInvite(accountId, messageId));
  });

  // Unsubscribe (List-Unsubscribe): what's offered, and doing it.
  ipcMain.handle("gmail:getUnsubscribe", async (_event, params: unknown) => {
    const p = params as Params;
    const accountId = str(p?.accountId);
    const messageId = str(p?.messageId);
    if (!accountId || !messageId) throw new Error("accountId and messageId are required.");
    const info = await getUnsubscribe(accountId, messageId);
    return info ? { ...info, unsubscribed: isUnsubscribed(accountId, str(p?.fromEmail)) } : null;
  });

  ipcMain.handle("gmail:unsubscribe", async (_event, params: unknown) => {
    const p = params as Params;
    const accountId = str(p?.accountId);
    const messageId = str(p?.messageId);
    if (!accountId || !messageId) throw new Error("accountId and messageId are required.");
    return runAsTask(str(p?.taskId) || undefined, () => unsubscribe(accountId, messageId));
  });

  ipcMain.handle("calendar:respond", async (_event, params: unknown) => {
    const p = params as Params;
    const accountId = str(p?.accountId);
    const messageId = str(p?.messageId);
    const response = str(p?.response) as RsvpResponse;
    if (!accountId || !messageId || !["accepted", "declined", "tentative"].includes(response))
      throw new Error("accountId, messageId and a valid response are required.");
    return runAsTask(str(p?.taskId) || undefined, () =>
      respondToInvite(accountId, messageId, response),
    );
  });
}
