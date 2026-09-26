import type { GmailMessageDetail } from "@otter-mail/contracts/gmail";

import { parseAddress, splitAddressList } from "../../gmail/mime";
import { formatMessageDate } from "../../lib/time";

export type ComposeMode = "new" | "reply" | "replyAll" | "forward";

export type Draft = { to: string; cc: string; subject: string; body: string };

const prefixed = (prefix: string, subject: string) =>
  new RegExp(`^${prefix}:`, "i").test(subject.trim()) ? subject : `${prefix}: ${subject}`;

/** Plain text of a message for quoting: its text part, or its HTML with tags dropped. */
function plainText(message: GmailMessageDetail): string {
  if (message.bodyText) return message.bodyText.trim();
  return (message.bodyHtml ?? message.snippet)
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * The fields a reply, reply-all or forward of `message` starts with, sent
 * from `me`. Replies quote the original below the cursor, like Gmail.
 */
export function draftFor(
  mode: Exclude<ComposeMode, "new">,
  message: GmailMessageDetail,
  me: string,
): Draft {
  const sender = message.fromName
    ? `${message.fromName} <${message.fromEmail}>`
    : message.fromEmail;
  const text = plainText(message);

  if (mode === "forward") {
    return {
      to: "",
      cc: "",
      subject: prefixed("Fwd", message.subject),
      body: [
        "",
        "",
        "---------- Forwarded message ---------",
        `From: ${sender}`,
        `Date: ${formatMessageDate(message.date)}`,
        `Subject: ${message.subject}`,
        `To: ${message.to}`,
        ...(message.cc ? [`Cc: ${message.cc}`] : []),
        "",
        text,
      ].join("\n"),
    };
  }

  const isMe = (entry: string) => parseAddress(entry).email.toLowerCase() === me.toLowerCase();
  // Answering your own message goes back to whoever it was sent to.
  const fromMe = message.fromEmail.toLowerCase() === me.toLowerCase();
  const to = fromMe ? splitAddressList(message.to) : [sender];
  const cc =
    mode === "replyAll"
      ? [
          ...(fromMe ? [] : splitAddressList(message.to)),
          ...splitAddressList(message.cc ?? ""),
        ].filter((entry) => !isMe(entry))
      : [];
  const quoted = text
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");

  return {
    to: to.join(", "),
    cc: cc.join(", "),
    subject: prefixed("Re", message.subject),
    body: `\n\nOn ${formatMessageDate(message.date)}, ${sender} wrote:\n${quoted}`,
  };
}
