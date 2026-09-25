/**
 * Calendar invitations in the reader: read the invite's .ics, show your
 * current answer, and RSVP in place — the way Gmail's Yes / No / Maybe do.
 *
 * RSVP goes through the Google Calendar API (your calendar updates and the
 * organizer is notified, sendUpdates=all). Accounts connected before the app
 * asked for calendar access fall back to a standard iMIP REPLY email to the
 * organizer (what Apple Mail / Outlook send), which Google Calendar applies.
 */

import { logger } from "../logger.js";
import { getAccessToken } from "./gmail-oauth.js";
import { getAccount } from "./account-store.js";
import { getAttachmentData, getMessage, sendRawMessage } from "./gmail-api.js";
import * as store from "./mail-store.js";

const CALENDAR = "https://www.googleapis.com/calendar/v3/calendars/primary";

export type RsvpResponse = "accepted" | "declined" | "tentative";

export type CalendarInvite = {
  uid: string;
  method: string;
  summary: string;
  /** ISO start/end; all-day events have date-only values. */
  start: string | null;
  end: string | null;
  allDay: boolean;
  location: string | null;
  organizer: { name: string; email: string } | null;
  sequence: number;
  /** Your answer: from Google Calendar when readable, else the last one sent from here. */
  response: RsvpResponse | "needsAction";
  /** Calendar API not authorized for this account (email replies are used). */
  calendarAccess: boolean;
  /** Link to the event in Google Calendar. */
  htmlLink: string | null;
  /** The invite was cancelled (METHOD:CANCEL). */
  cancelled: boolean;
};

// ---------------------------------------------------------------------------
// iCalendar parsing (just what an invitation needs)
// ---------------------------------------------------------------------------

type Prop = { name: string; params: Record<string, string>; value: string };

function unfold(ics: string): string[] {
  return ics.replace(/\r?\n[ \t]/g, "").split(/\r?\n/);
}

function parseLine(line: string): Prop | null {
  const colon = line.search(/:(?=(?:[^"]*"[^"]*")*[^"]*$)/);
  if (colon < 0) return null;
  const [head, ...paramParts] = line.slice(0, colon).split(";");
  const params: Record<string, string> = {};
  for (const part of paramParts) {
    const eq = part.indexOf("=");
    if (eq > 0) params[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1).replace(/^"|"$/g, "");
  }
  return { name: head.toUpperCase(), params, value: line.slice(colon + 1) };
}

function unescapeText(value: string): string {
  return value.replace(/\\n/gi, "\n").replace(/\\([,;\\])/g, "$1");
}

/** DTSTART/DTEND → ISO (UTC "Z", floating/TZID read as local wall time). */
function toIso(prop: Prop | undefined): { iso: string | null; allDay: boolean } {
  if (!prop) return { iso: null, allDay: false };
  const v = prop.value;
  const date = v.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (date || prop.params.VALUE === "DATE") {
    const [, y, m, d] = date ?? v.match(/^(\d{4})(\d{2})(\d{2})/)!;
    return { iso: `${y}-${m}-${d}`, allDay: true };
  }
  const dt = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/);
  if (!dt) return { iso: null, allDay: false };
  const [, y, m, d, hh, mm, ss, z] = dt;
  return { iso: `${y}-${m}-${d}T${hh}:${mm}:${ss}${z ? "Z" : ""}`, allDay: false };
}

type ParsedIcs = {
  method: string;
  event: Prop[];
  raw: string;
};

function parseIcs(ics: string): ParsedIcs | null {
  const lines = unfold(ics);
  let method = "";
  const event: Prop[] = [];
  let inEvent = false;
  for (const line of lines) {
    const prop = parseLine(line);
    if (!prop) continue;
    if (prop.name === "METHOD" && !inEvent) method = prop.value.toUpperCase();
    if (prop.name === "BEGIN" && prop.value.toUpperCase() === "VEVENT") {
      if (event.length > 0) break; // first event only
      inEvent = true;
      continue;
    }
    if (prop.name === "END" && prop.value.toUpperCase() === "VEVENT") inEvent = false;
    else if (inEvent) event.push(prop);
  }
  return event.length > 0 ? { method, event, raw: ics } : null;
}

const get = (event: Prop[], name: string) => event.find((p) => p.name === name);
const mailto = (value: string) =>
  value
    .replace(/^mailto:/i, "")
    .trim()
    .toLowerCase();

// ---------------------------------------------------------------------------
// Calendar API
// ---------------------------------------------------------------------------

class NoCalendarAccess extends Error {}

async function calendarFetch(
  accountId: string,
  path: string,
  init: { method?: string; body?: string; headers?: Record<string, string> } = {},
): Promise<unknown> {
  const token = await getAccessToken(accountId);
  const response = await fetch(`${CALENDAR}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
  if (response.status === 403 || response.status === 401) {
    const body = await response.text().catch(() => "");
    if (/insufficient|scope|PERMISSION_DENIED|accessNotConfigured|has not been used/i.test(body))
      throw new NoCalendarAccess(body.slice(0, 200));
    throw new Error(`Calendar API error: ${response.status} ${body.slice(0, 200)}`);
  }
  if (!response.ok)
    throw new Error(
      `Calendar API error: ${response.status} ${(await response.text()).slice(0, 200)}`,
    );
  const text = await response.text();
  return text ? JSON.parse(text) : {};
}

type ApiEvent = {
  id: string;
  htmlLink?: string;
  attendees?: { email: string; self?: boolean; responseStatus?: string }[];
};

async function findEvent(accountId: string, uid: string): Promise<ApiEvent | null> {
  const data = (await calendarFetch(
    accountId,
    `/events?iCalUID=${encodeURIComponent(uid)}&showDeleted=false&maxResults=1`,
  )) as { items?: ApiEvent[] };
  return data.items?.[0] ?? null;
}

function selfStatus(event: ApiEvent, email: string): RsvpResponse | "needsAction" {
  const me = event.attendees?.find((a) => a.self || a.email.toLowerCase() === email);
  const status = me?.responseStatus;
  return status === "accepted" || status === "declined" || status === "tentative"
    ? status
    : "needsAction";
}

// ---------------------------------------------------------------------------
// Invite lookup
// ---------------------------------------------------------------------------

const icsCache = new Map<string, ParsedIcs | null>();

async function inviteIcs(accountId: string, messageId: string): Promise<ParsedIcs | null> {
  const key = `${accountId}:${messageId}`;
  if (icsCache.has(key)) return icsCache.get(key)!;
  const detail =
    store.getMessageDetail(accountId, messageId) ?? (await getMessage(accountId, messageId));
  const part = detail.attachments.find(
    (a) => /text\/calendar|application\/ics/i.test(a.mimeType) || /\.ics$/i.test(a.filename),
  );
  let parsed: ParsedIcs | null = null;
  if (part) {
    const { base64 } = await getAttachmentData(accountId, messageId, part.id);
    parsed = parseIcs(Buffer.from(base64, "base64").toString("utf-8"));
  }
  icsCache.set(key, parsed);
  return parsed;
}

const kvKey = (accountId: string, uid: string) => `rsvp:${accountId}:${uid}`;

export async function getInvite(
  accountId: string,
  messageId: string,
): Promise<CalendarInvite | null> {
  const ics = await inviteIcs(accountId, messageId);
  if (!ics) return null;
  const { event, method } = ics;
  const uid = get(event, "UID")?.value;
  if (!uid) return null;
  const email = accountId.toLowerCase();
  const start = toIso(get(event, "DTSTART"));
  const end = toIso(get(event, "DTEND"));
  const organizerProp = get(event, "ORGANIZER");
  const mine = event.find((p) => p.name === "ATTENDEE" && mailto(p.value) === email);
  const icsStatus = mine?.params.PARTSTAT?.toLowerCase();
  const stored = store.getKv(kvKey(accountId, uid)) as RsvpResponse | null;

  let response: CalendarInvite["response"] =
    stored ??
    (icsStatus === "accepted" || icsStatus === "declined" || icsStatus === "tentative"
      ? icsStatus
      : "needsAction");
  let calendarAccess = true;
  let htmlLink: string | null = null;
  try {
    const found = await findEvent(accountId, uid);
    if (found) {
      response = selfStatus(found, email);
      htmlLink = found.htmlLink ?? null;
    }
  } catch (error) {
    if (error instanceof NoCalendarAccess) calendarAccess = false;
    else logger.info("calendar", "event lookup failed", { error: String(error) });
  }

  return {
    uid,
    method,
    summary: unescapeText(get(event, "SUMMARY")?.value ?? "(no title)"),
    start: start.iso,
    end: end.iso,
    allDay: start.allDay,
    location: get(event, "LOCATION") ? unescapeText(get(event, "LOCATION")!.value) : null,
    organizer: organizerProp
      ? { name: organizerProp.params.CN ?? "", email: mailto(organizerProp.value) }
      : null,
    sequence: Number(get(event, "SEQUENCE")?.value ?? 0) || 0,
    response,
    calendarAccess,
    htmlLink,
    cancelled: method === "CANCEL" || get(event, "STATUS")?.value.toUpperCase() === "CANCELLED",
  };
}

// ---------------------------------------------------------------------------
// RSVP
// ---------------------------------------------------------------------------

const PARTSTAT: Record<RsvpResponse, string> = {
  accepted: "ACCEPTED",
  declined: "DECLINED",
  tentative: "TENTATIVE",
};

const SUBJECT_PREFIX: Record<RsvpResponse, string> = {
  accepted: "Accepted",
  declined: "Declined",
  tentative: "Tentatively accepted",
};

function icsStamp(date: Date): string {
  return date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
}

/** RFC 6047 iMIP REPLY: your PARTSTAT for the organizer's calendar. */
async function sendImipReply(
  accountId: string,
  messageId: string,
  ics: ParsedIcs,
  response: RsvpResponse,
): Promise<void> {
  const { event } = ics;
  const organizer = get(event, "ORGANIZER");
  if (!organizer) throw new Error("This invitation has no organizer to reply to.");
  const account = await getAccount(accountId);
  const me = account?.email ?? accountId;
  const name = account?.name ?? "";
  const summary = unescapeText(get(event, "SUMMARY")?.value ?? "");
  const keep = ["UID", "SEQUENCE", "DTSTART", "DTEND", "RECURRENCE-ID", "SUMMARY"];
  const lines = [
    "BEGIN:VCALENDAR",
    "PRODID:-//Otter Mail//EN",
    "VERSION:2.0",
    "CALSCALE:GREGORIAN",
    "METHOD:REPLY",
    "BEGIN:VEVENT",
    ...event
      .filter((p) => keep.includes(p.name))
      .map(
        (p) =>
          `${p.name}${Object.entries(p.params)
            .map(([k, v]) => `;${k}=${v}`)
            .join("")}:${p.value}`,
      ),
    `DTSTAMP:${icsStamp(new Date())}`,
    `ORGANIZER${organizer.params.CN ? `;CN="${organizer.params.CN}"` : ""}:${organizer.value}`,
    `ATTENDEE;PARTSTAT=${PARTSTAT[response]}${name ? `;CN="${name}"` : ""}:mailto:${me}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  const calendar = lines.join("\r\n");
  const boundary = `otter-${Date.now().toString(36)}`;
  const subject = `${SUBJECT_PREFIX[response]}: ${summary}`;
  const text = `${name || me} has ${SUBJECT_PREFIX[response].toLowerCase()} this invitation.`;
  const raw = [
    `From: ${name ? `"${name}" <${me}>` : me}`,
    `To: ${mailto(organizer.value)}`,
    `Subject: =?UTF-8?B?${Buffer.from(subject).toString("base64")}?=`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "",
    text,
    `--${boundary}`,
    "Content-Type: text/calendar; charset=UTF-8; method=REPLY",
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(calendar).toString("base64").replace(/.{76}/g, "$&\r\n"),
    `--${boundary}--`,
    "",
  ].join("\r\n");
  const detail = store.getMessageDetail(accountId, messageId);
  await sendRawMessage(accountId, raw, detail?.threadId);
}

export async function respondToInvite(
  accountId: string,
  messageId: string,
  response: RsvpResponse,
): Promise<CalendarInvite | null> {
  const ics = await inviteIcs(accountId, messageId);
  const uid = ics && get(ics.event, "UID")?.value;
  if (!ics || !uid) throw new Error("This message has no calendar invitation.");
  const email = accountId.toLowerCase();

  let viaCalendar = false;
  try {
    const found = await findEvent(accountId, uid);
    if (found) {
      const attendees = (found.attendees ?? []).map((a) =>
        a.self || a.email.toLowerCase() === email ? { ...a, responseStatus: response } : a,
      );
      if (!attendees.some((a) => a.self || a.email.toLowerCase() === email)) {
        attendees.push({ email, self: true, responseStatus: response });
      }
      await calendarFetch(accountId, `/events/${encodeURIComponent(found.id)}?sendUpdates=all`, {
        method: "PATCH",
        body: JSON.stringify({ attendees }),
      });
      viaCalendar = true;
    }
  } catch (error) {
    if (!(error instanceof NoCalendarAccess)) throw error;
  }
  if (!viaCalendar) await sendImipReply(accountId, messageId, ics, response);

  store.setKv(kvKey(accountId, uid), response);
  logger.info("calendar", "rsvp", { response, via: viaCalendar ? "calendar" : "email" });
  return getInvite(accountId, messageId);
}
