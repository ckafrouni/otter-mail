/**
 * Calendar invitations: read the invite + your answer, and RSVP from the
 * reader. Both run as tasks (attachment fetch + Calendar API can pass 5s).
 */

import { ipcMain } from "@glaze/core/backend";
import { getInvite, respondToInvite, type RsvpResponse } from "../services/calendar-invites.js";
import { runAsTask } from "./ipc-budget.js";

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
