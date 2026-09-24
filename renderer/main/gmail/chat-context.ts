import type { GmailMessageSummary } from "./types";

/**
 * Pointer-sized mail context for the Hermes chat. Hermes has gog
 * access to the same mailboxes, so ids are enough — no mail content leaves
 * the app.
 */
export type AssistantContext = {
  /** Owning account email per conversation (falls back to account id). */
  conversations: {
    account: string;
    threadId: string;
    subject: string;
    from: string;
    messageIds: string[];
    /** Present when the item is a highlighted excerpt, not the whole thread. */
    quote?: string;
  }[];
};

/** A text excerpt selected from a message, plus its thread pointer. */
export type QuoteContext = {
  text: string;
  account: string;
  accountId: string;
  threadId: string;
  subject: string;
  messageId: string;
};

/** One row (or thread rep) → context entry. */
export function contextFromMessages(
  messages: GmailMessageSummary[],
  accountEmailById: (accountId: string | undefined) => string,
): AssistantContext {
  return {
    conversations: messages.map((m) => ({
      account: accountEmailById(m.accountId),
      threadId: m.threadId || m.id,
      subject: m.subject || "(no subject)",
      from: m.fromEmail,
      messageIds: [m.id],
    })),
  };
}

/** A highlighted excerpt → a single quote context entry. */
export function contextFromQuote(q: QuoteContext): AssistantContext {
  return {
    conversations: [
      {
        account: q.account,
        threadId: q.threadId,
        subject: q.subject,
        from: "",
        messageIds: [q.messageId],
        quote: q.text,
      },
    ],
  };
}

/** Question + pointer block sent with a chat turn. */
export function buildHandoffText(question: string, context: AssistantContext): string {
  const lines: string[] = [question.trim(), "", "— context from Otter Mail —"];
  for (const c of context.conversations) {
    if (c.quote) {
      lines.push(
        `• Quoted from "${c.subject}" [${c.account}] (threadId ${c.threadId}):\n  “${c.quote}”`,
      );
    } else {
      lines.push(
        `• [${c.account}] "${c.subject}" — from ${c.from} (threadId ${c.threadId}, message ${c.messageIds.join(", ")})`,
      );
    }
  }
  lines.push("Fetch full content with gog if needed.");
  return lines.join("\n");
}
