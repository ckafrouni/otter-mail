/**
 * The tools for a small on-device model (Apple's, in the Mac and iPhone apps):
 * a few mail tools with flat arguments, one id per conversation, and short
 * text results, since its context is 8K tokens and it copies long ids badly.
 * They run the full tools (mail.ts) underneath, approvals included, and the
 * iPhone mirrors them by the same names, arguments and results
 * (apps/ios Agent/AgentTools.swift).
 */

import { mailTools } from "./mail.js";
import {
  listMailboxes,
  optBool,
  optStr,
  str,
  type AgentTool,
  type ToolArgs,
  type ToolContext,
} from "./tool.js";

type Row = {
  account: string;
  threadId: string;
  from: string;
  subject: string;
  date: string;
  snippet: string;
  unread: boolean;
};

type Thread = {
  subject: string;
  messages: { from: string; date: string; body: string; draftId?: string }[];
};

/** Runs one of the full tools, as this tool (its approval asks as this one). */
function full<T>(name: string, args: ToolArgs, ctx: ToolContext): Promise<T> {
  return mailTools.find((t) => t.name === name)!.run(args, ctx) as Promise<T>;
}

/** A conversation's id for the model: its mailbox and thread, in one. */
const idOf = (row: { account: string; threadId: string }) => `${row.account}/${row.threadId}`;

async function conversation(args: ToolArgs): Promise<{ account: string; threadId: string }> {
  const id = str(args, "id");
  const account = (await listMailboxes()).find((a) => id.startsWith(`${a.email}/`));
  if (!account)
    throw new Error(`No conversation ${id}. Copy its id from list_inbox or search_mail.`);
  return { account: account.email, threadId: id.slice(account.email.length + 1) };
}

/** `2026-09-30T14:05+02:00` → `2026-09-30 14:05`. */
const shortDate = (date: string) => date.slice(0, 16).replace("T", " ");

function list(rows: Row[], empty: string): string {
  if (rows.length === 0) return empty;
  return rows
    .map(
      (r) =>
        `- id ${idOf(r)}: ${r.from} · “${r.subject}” · ${shortDate(r.date)}${r.unread ? " · unread" : ""}\n  ${r.snippet.slice(0, 120)}`,
    )
    .join("\n");
}

/** What Apple's model is told, with the date and the user's addresses; the iPhone says the same. */
export async function onDeviceInstructions(): Promise<string> {
  const today = new Date().toLocaleString("en-GB", { dateStyle: "full", timeStyle: "short" });
  const mailboxes = (await listMailboxes()).map((a) => a.email).join(", ");
  return [
    `You are the agent in Otter Mail, the user's mail app. It's ${today}. The user's mailboxes: ${mailboxes}.`,
    "Use the tools for anything about the user's mail. Each conversation has an id: copy it exactly from list_inbox or search_mail.",
    "To answer someone, call save_reply with the conversation's id and your text; to write to someone new, call write_email. Both save a draft for the user to send: call them rather than only writing the text out.",
    "Mention conversations by sender and subject, never by id. Be brief.",
  ].join("\n");
}

const ID = {
  type: "string",
  description: "The conversation's id, copied from list_inbox or search_mail.",
};

const ACTIONS: Record<string, [tool: string, args: ToolArgs]> = {
  archive: ["update_threads", { archive: true }],
  move_to_inbox: ["update_threads", { moveToInbox: true }],
  mark_read: ["update_threads", { read: true }],
  mark_unread: ["update_threads", { read: false }],
  star: ["update_threads", { starred: true }],
  unstar: ["update_threads", { starred: false }],
  trash: ["trash_threads", {}],
};

export const onDeviceTools: AgentTool[] = [
  {
    name: "list_inbox",
    title: "List the inbox",
    description: "The newest conversations in the user's inbox, each with its id.",
    input: { type: "object", properties: { unreadOnly: { type: "boolean" } } },
    readOnly: true,
    async run(args, ctx) {
      const { threads } = await full<{ threads: Row[] }>(
        "list_threads",
        { unreadOnly: optBool(args, "unreadOnly"), limit: 12 },
        ctx,
      );
      const unread = optBool(args, "unreadOnly");
      return list(threads, unread ? "Nothing unread in the inbox." : "The inbox is empty.");
    },
  },
  {
    name: "search_mail",
    title: "Search mail",
    description:
      "Finds conversations by words (names, subjects, text) and answers them, newest first, each with its id.",
    input: {
      type: "object",
      properties: { query: { type: "string", description: "A few words, like “ada lunch”." } },
      required: ["query"],
    },
    readOnly: true,
    async run(args, ctx) {
      const { threads } = await full<{ threads: Row[] }>(
        "search_mail",
        { query: str(args, "query") },
        ctx,
      );
      return list(threads.slice(0, 12), "Nothing matches.");
    },
  },
  {
    name: "read_conversation",
    title: "Read a conversation",
    description: "A conversation's messages, oldest first: who wrote each, when, and what.",
    input: { type: "object", properties: { id: ID }, required: ["id"] },
    readOnly: true,
    async run(args, ctx) {
      const thread = await full<Thread>("get_thread", await conversation(args), ctx);
      const sent = thread.messages.filter((m) => !m.draftId);
      return [
        `“${thread.subject}”`,
        ...sent.map((m) => `${m.from}, ${shortDate(m.date)}:\n${m.body.slice(0, 1_500)}`),
      ].join("\n\n");
    },
  },
  {
    name: "save_reply",
    title: "Save a reply",
    description:
      "Writes a reply to a conversation into Drafts, for the user to check and send. It sends nothing.",
    input: {
      type: "object",
      properties: {
        id: ID,
        text: { type: "string", description: "The reply, greeting and sign-off included." },
      },
      required: ["id", "text"],
    },
    // A draft sends nothing and is the user's to look at: no approval.
    async run(args, ctx) {
      const { account, threadId } = await conversation(args);
      await full("save_draft", { account, replyTo: threadId, body: str(args, "text") }, ctx);
      return "Saved the reply in Drafts.";
    },
  },
  {
    name: "write_email",
    title: "Write an email",
    description:
      "Writes a new email into Drafts, for the user to check and send. It sends nothing.",
    input: {
      type: "object",
      properties: {
        from: {
          type: "string",
          description: "The mailbox to write from, by address; optional when there's only one.",
        },
        to: { type: "string", description: "Email addresses, comma-separated." },
        subject: { type: "string" },
        text: { type: "string", description: "The email, greeting and sign-off included." },
      },
      required: ["to", "subject", "text"],
    },
    async run(args, ctx) {
      // It can't know the user's address: with one mailbox, that's the one.
      const mailboxes = await listMailboxes();
      const from = optStr(args, "from")?.toLowerCase();
      const account =
        mailboxes.find((a) => a.email.toLowerCase() === from) ??
        (mailboxes.length === 1 ? mailboxes[0] : undefined);
      if (!account)
        throw new Error(`"from" is one of: ${mailboxes.map((a) => a.email).join(", ")}.`);
      const draft = { to: str(args, "to"), subject: str(args, "subject"), body: str(args, "text") };
      await full("save_draft", { ...draft, account: account.email }, ctx);
      return "Saved the email in Drafts.";
    },
  },
  {
    name: "update_conversation",
    title: "Update a conversation",
    description:
      "Archives, trashes, marks read or unread, stars or unstars a conversation, or moves it back to the inbox.",
    input: {
      type: "object",
      properties: { id: ID, action: { type: "string", enum: Object.keys(ACTIONS) } },
      required: ["id", "action"],
    },
    async run(args, ctx) {
      const action = ACTIONS[str(args, "action")];
      if (!action) throw new Error(`"action" is one of ${Object.keys(ACTIONS).join(", ")}.`);
      const { account, threadId } = await conversation(args);
      await full(action[0], { ...action[1], account, threadIds: [threadId] }, ctx);
      return "Done.";
    },
  },
];
