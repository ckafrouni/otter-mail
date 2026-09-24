import { useEffect, useRef, useState } from "react";
import { Dialog, toast } from "@glaze/core/components";
import { SendHorizontalIcon } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { gmailApi } from "./api";
import { buttonClass } from "./ui";
import type { GmailMessageSummary } from "./types";

/**
 * Handoff target: pointer-sized context for the assistant. Hermes has gog
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

/** Question + pointer block, shared by the Slack handoff and the chat panel. */
export function buildHandoffText(question: string, context: AssistantContext): string {
  const lines: string[] = [question.trim(), "", "— context from OtterMail —"];
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

export function useAssistantStatus() {
  return useQuery({
    queryKey: ["assistant:status"],
    queryFn: () => gmailApi.assistantGetStatus(),
    staleTime: 60_000,
  });
}

/**
 * The ask box: a compact dialog with the context recap and a question input.
 * Send posts to the assistant's Slack DM (as the user) and Slack opens on
 * that conversation.
 */
export function AskAssistantDialog({
  context,
  onOpenChange,
}: {
  /** null = closed. */
  context: AssistantContext | null;
  onOpenChange: (open: boolean) => void;
}) {
  const open = context != null;
  const [question, setQuestion] = useState("");
  const [sending, setSending] = useState(false);
  const status = useAssistantStatus();
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open) setQuestion("");
  }, [open]);

  const configured = status.data?.configured === true;
  const count = context?.conversations.length ?? 0;
  const canSend = configured && !sending && question.trim().length > 0;

  const handleSend = () => {
    if (!canSend || !context) return;
    setSending(true);
    const text = buildHandoffText(question, context);
    console.log("[AskAssistant:send]", { conversations: count });
    gmailApi.assistantSend(text).then(
      () => {
        setSending(false);
        onOpenChange(false);
        toast.success("Sent to Hermes — opening Slack");
      },
      (err) => {
        setSending(false);
        toast.error(`Could not reach Slack: ${err}`);
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Ask Hermes">
      <div className="flex flex-col gap-2.5">
        {configured ? (
          <>
            <div className="flex flex-col gap-1 rounded-lg border border-border bg-secondary px-3 py-2">
              {(context?.conversations ?? []).slice(0, 4).map((c) => (
                <div
                  key={`${c.account}:${c.threadId}`}
                  className="flex min-w-0 items-baseline gap-2"
                >
                  <span className="min-w-0 truncate text-xs font-semibold text-foreground/90">
                    {c.subject}
                  </span>
                  <span className="shrink-0 text-2xs text-muted-foreground/70">{c.from}</span>
                </div>
              ))}
              {count > 4 ? (
                <span className="text-2xs text-muted-foreground/70">+ {count - 4} more</span>
              ) : null}
              <span className="te-label pt-0.5 text-muted-foreground/70">
                {count === 1 ? "1 conversation" : `${count} conversations`} · sent as pointers,
                Hermes fetches via gog
              </span>
            </div>
            <textarea
              ref={inputRef}
              autoFocus
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder="What do you need? e.g. “Summarize this and draft a reply”"
              aria-label="Question for Hermes"
              rows={3}
              className="w-full resize-none rounded-lg border border-input bg-canvas px-3 py-1.5 text-sm text-foreground shadow-xs/5 outline-none transition-shadow placeholder:text-placeholder focus-visible:border-focus-ring focus-visible:ring-[3px] focus-visible:ring-focus-ring/24 dark:bg-input/32"
            />
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">
                {status.data?.teamName ? `via Slack · ${status.data.teamName}` : "via Slack"}
              </span>
              <span className="flex-1" />
              {canSend ? <span className="text-xs text-muted-foreground">⌘↩ send</span> : null}
              <button
                type="button"
                onClick={handleSend}
                disabled={!canSend}
                aria-label="Send to Hermes"
                className={buttonClass("primary", "sm")}
              >
                Send
                <SendHorizontalIcon className="size-3.5" />
              </button>
            </div>
          </>
        ) : (
          <div className="flex flex-col gap-2">
            <span className="text-sm text-foreground/90">
              Connect your assistant first: paste a Slack user token and the bot's member ID in
              Settings.
            </span>
            <button
              type="button"
              onClick={() => {
                onOpenChange(false);
                void gmailApi.openSettings({ pane: "general" });
              }}
              className={buttonClass("outline", "sm", "w-fit")}
            >
              Open Settings
            </button>
          </div>
        )}
      </div>
    </Dialog>
  );
}
