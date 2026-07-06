import { useEffect, useRef, useState } from "react";
import { Dialog, toast } from "@glaze/core/components";
import { SendHorizontalIcon } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { gmailApi } from "./api";
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
  }[];
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

function buildHandoffText(question: string, context: AssistantContext): string {
  const lines: string[] = [question.trim(), "", "— context from OtterMail —"];
  for (const c of context.conversations) {
    lines.push(
      `• [${c.account}] "${c.subject}" — from ${c.from} (threadId ${c.threadId}, message ${c.messageIds.join(", ")})`,
    );
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
            <div className="flex flex-col gap-1 rounded-[6px] border border-(--te-border) bg-(--te-ctl) px-3 py-2">
              {(context?.conversations ?? []).slice(0, 4).map((c) => (
                <div key={`${c.account}:${c.threadId}`} className="flex min-w-0 items-baseline gap-2">
                  <span className="min-w-0 truncate text-[12px] font-semibold text-(--te-text)">
                    {c.subject}
                  </span>
                  <span className="shrink-0 text-[11px] text-(--te-faint)">{c.from}</span>
                </div>
              ))}
              {count > 4 ? (
                <span className="text-[11px] text-(--te-faint)">+ {count - 4} more</span>
              ) : null}
              <span className="te-label pt-0.5 text-(--te-faint)">
                {count === 1 ? "1 conversation" : `${count} conversations`} · sent as pointers, Hermes
                fetches via gog
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
              className="w-full resize-none rounded-[6px] border border-(--te-outline) bg-(--te-panel) px-3 py-2 text-[13px] text-(--te-strong) outline-none placeholder:text-(--te-faint) focus:border-(--te-outline-hover)"
            />
            <div className="flex items-center gap-2">
              <span className="te-label text-(--te-faint)">
                {status.data?.teamName ? `via Slack · ${status.data.teamName}` : "via Slack"}
              </span>
              <span className="flex-1" />
              {canSend ? <span className="te-label text-(--te-faint)">⌘↩ send</span> : null}
              <button
                type="button"
                onClick={handleSend}
                disabled={!canSend}
                aria-label="Send to Hermes"
                className="flex h-7 items-center gap-1.5 rounded-[5px] bg-(--te-accent) px-3 text-[12px] font-semibold text-white hover:brightness-110 disabled:bg-(--te-ctl) disabled:text-(--te-faint)"
              >
                Send
                <SendHorizontalIcon className="size-3.5" />
              </button>
            </div>
          </>
        ) : (
          <div className="flex flex-col gap-2">
            <span className="text-[13px] text-(--te-text)">
              Connect your assistant first: paste a Slack user token and the bot's member ID in
              Settings.
            </span>
            <button
              type="button"
              onClick={() => {
                onOpenChange(false);
                void gmailApi.openSettings({ pane: "general" });
              }}
              className="te-label h-7 w-fit rounded-[4px] border border-(--te-outline) px-2 text-(--te-text) hover:border-(--te-outline-hover) hover:text-(--te-strong)"
            >
              Open Settings
            </button>
          </div>
        )}
      </div>
    </Dialog>
  );
}
