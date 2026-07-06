import { useEffect, useRef, useState } from "react";
import { MessageScroller } from "@shadcn/react/message-scroller";
import {
  ArrowDownIcon,
  BotMessageSquareIcon,
  CircleStopIcon,
  PaperclipIcon,
  SendHorizontalIcon,
  SquarePlusIcon,
  WrenchIcon,
  XIcon,
} from "lucide-react";
import { IconBtn, HintTooltip } from "./te-ui";
import { gmailApi, type ChatEvent } from "./api";
import { buildHandoffText, contextFromMessages, type AssistantContext } from "./ask-assistant";
import { ChatMarkdown } from "./chat-markdown";
import { useAccounts, useMessage } from "./hooks";
import type { GmailMessageSummary } from "./types";

/** One transcript entry. Tool steps interleave into the assistant turn. */
type ChatTurn = {
  id: string;
  role: "user" | "assistant";
  text: string;
  tools: { name: string; output?: string }[];
  /** Attached mail context, shown as a chip above the user's message. */
  context?: { subjects: string[]; count: number };
  error?: string;
};

/** Chip recap of the context sent with a user turn. */
function ContextRecap({ context }: { context: { subjects: string[]; count: number } }) {
  const label =
    context.count > 1 ? `${context.count} conversations` : context.subjects[0] ?? "1 conversation";
  return (
    <div className="mb-1 flex justify-end">
      <span className="te-label flex max-w-full items-center gap-1.5 rounded-[4px] border border-(--te-border) px-2 py-0.5 text-(--te-faint)">
        <PaperclipIcon className="size-3 shrink-0" />
        <span className="min-w-0 truncate">{label}</span>
      </span>
    </div>
  );
}

const STORE_KEY = "gmail:hermes-chat:v1";
const MAX_STORED_TURNS = 80;

function loadStore(): { turns: ChatTurn[]; lastResponseId: string | null } {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORE_KEY) ?? "") as {
      turns?: ChatTurn[];
      lastResponseId?: string | null;
    };
    return { turns: parsed.turns ?? [], lastResponseId: parsed.lastResponseId ?? null };
  } catch {
    return { turns: [], lastResponseId: null };
  }
}

function saveStore(turns: ChatTurn[], lastResponseId: string | null): void {
  localStorage.setItem(
    STORE_KEY,
    JSON.stringify({ turns: turns.slice(-MAX_STORED_TURNS), lastResponseId }),
  );
}

const ERROR_TEXT: Record<string, string> = {
  not_configured: "Hermes chat isn't configured — add the API key in Settings.",
  unauthorized: "The API key was rejected — update it in Settings.",
  unreachable: "Can't reach Hermes — are you on Tailscale?",
  timeout: "Hermes went quiet for too long — the run was stopped.",
  cancelled: "Stopped.",
};

function friendlyError(code: string): string {
  return ERROR_TEXT[code] ?? `Hermes answered with an error (${code}).`;
}

function ToolStep({ name, output }: { name: string; output?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="my-1">
      <button
        type="button"
        onClick={() => output && setOpen((o) => !o)}
        className={[
          "te-label flex items-center gap-1.5 rounded-[4px] border border-(--te-border) bg-(--te-ctl) px-2 py-1 text-(--te-muted)",
          output ? "hover:text-(--te-strong)" : "",
        ].join(" ")}
      >
        <WrenchIcon className="size-3" />
        {name}
        {!output ? <span className="te-blink size-1 bg-(--te-accent)" aria-hidden /> : null}
      </button>
      {open && output ? (
        <pre className="te-scroll mt-1 max-h-40 overflow-auto rounded-[4px] border border-(--te-border) bg-(--te-panel) px-2 py-1.5 text-[11px] leading-relaxed text-(--te-muted)">
          {output}
        </pre>
      ) : null}
    </div>
  );
}

/**
 * Right-side Hermes chat: streams over the backend Responses-API bridge,
 * server-side continuity via previous_response_id. The transcript lives in
 * localStorage; "attach" adds pointer-only context for the open conversation.
 */
export function HermesChatPanel({
  accountId,
  messageId,
  selectedRows,
  onClose,
}: {
  /** Account of the open conversation (context attach), null when none. */
  accountId: string | null;
  messageId: string | null;
  /** Multi-selected list rows; take priority over the open conversation. */
  selectedRows?: GmailMessageSummary[];
  onClose: () => void;
}) {
  const initial = useRef(loadStore());
  const [turns, setTurns] = useState<ChatTurn[]>(initial.current.turns);
  const [lastResponseId, setLastResponseId] = useState<string | null>(
    initial.current.lastResponseId,
  );
  const [draft, setDraft] = useState("");
  const [streamingId, setStreamingId] = useState<string | null>(null);
  const [attach, setAttach] = useState(true);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    gmailApi.chatStatus().then(
      (s) => setConfigured(s.configured),
      () => setConfigured(false),
    );
  }, []);

  // Attach context: the multi-selection wins; otherwise the open conversation
  // (cache hit — the reader fetched it). Both are pointer-only; Hermes gogs
  // the bodies.
  const accountsQuery = useAccounts();
  const accountEmailById = (id: string | undefined) =>
    accountsQuery.data?.find((a) => a.id === id)?.email ?? id ?? "";
  const openMessage = useMessage(accountId, messageId);
  const multiSelected = selectedRows && selectedRows.length > 0;
  const context: AssistantContext | null = multiSelected
    ? contextFromMessages(selectedRows, accountEmailById)
    : accountId && messageId && openMessage.data
      ? {
          conversations: [
            {
              account: accountEmailById(accountId),
              threadId: openMessage.data.threadId || openMessage.data.id,
              subject: openMessage.data.subject || "(no subject)",
              from: openMessage.data.fromEmail,
              messageIds: [openMessage.data.id],
            },
          ],
        }
      : null;

  const turnsRef = useRef(turns);
  turnsRef.current = turns;
  const lastResponseIdRef = useRef(lastResponseId);
  lastResponseIdRef.current = lastResponseId;
  useEffect(() => {
    saveStore(turns, lastResponseId);
  }, [turns, lastResponseId]);

  // Stream events for the in-flight request; the listener mounts once.
  const requestRef = useRef<string | null>(null);
  useEffect(() => {
    const unsub = window.glazeAPI.glaze.ipc.onNotification(
      "assistant:chatEvent",
      (raw: unknown) => {
        const event = raw as ChatEvent;
        if (!event || event.requestId !== requestRef.current) return;
        setTurns((prev) => {
          const next = [...prev];
          const turn = next[next.length - 1];
          if (!turn || turn.role !== "assistant") return prev;
          const updated = { ...turn, tools: [...turn.tools] };
          if (event.type === "delta") updated.text += event.text;
          else if (event.type === "tool") updated.tools.push({ name: event.name });
          else if (event.type === "toolResult") {
            const open = [...updated.tools].reverse().find((t) => t.output === undefined);
            if (open) open.output = event.output;
          } else if (event.type === "error") {
            updated.error = friendlyError(event.message);
          }
          next[next.length - 1] = updated;
          return next;
        });
        if (event.type === "done") {
          if (event.responseId) setLastResponseId(event.responseId);
          requestRef.current = null;
          setStreamingId(null);
        } else if (event.type === "error") {
          requestRef.current = null;
          setStreamingId(null);
        }
      },
    );
    return unsub;
  }, []);

  const send = () => {
    const question = draft.trim();
    if (!question || streamingId || configured === false) return;
    const requestId = crypto.randomUUID();
    const attached = attach && context ? context : null;
    const input = attached ? buildHandoffText(question, attached) : question;
    console.log("[HermesChat:send]", { requestId, attached: Boolean(attached) });
    setDraft("");
    setTurns((prev) => [
      ...prev,
      {
        id: `u-${requestId}`,
        role: "user",
        text: question,
        tools: [],
        context: attached
          ? {
              count: attached.conversations.length,
              subjects: attached.conversations.map((c) => c.subject),
            }
          : undefined,
      },
      { id: `a-${requestId}`, role: "assistant", text: "", tools: [] },
    ]);
    requestRef.current = requestId;
    setStreamingId(requestId);
    void gmailApi
      .chatSend({
        requestId,
        input,
        previousResponseId: lastResponseIdRef.current ?? undefined,
      })
      .catch(() => {
        // Failure events also arrive via the broadcast; this is a backstop.
        if (requestRef.current === requestId) {
          requestRef.current = null;
          setStreamingId(null);
        }
      });
  };

  const stop = () => {
    if (streamingId) void gmailApi.chatCancel(streamingId);
  };

  const newChat = () => {
    if (streamingId) stop();
    console.log("[HermesChat:newChat]");
    setTurns([]);
    setLastResponseId(null);
    inputRef.current?.focus();
  };

  const streaming = streamingId != null;

  return (
    <div className="flex h-full min-w-0 flex-col">
      <div className="drag-region flex h-[52px] shrink-0 items-center gap-2 border-b border-(--te-border) px-4">
        <BotMessageSquareIcon className="size-4 shrink-0 text-(--te-muted)" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-bold leading-tight tracking-tight text-(--te-strong)">
            Hermes
          </div>
          <div className="te-label truncate leading-tight text-(--te-muted)">
            {streaming ? "working…" : "agent chat"}
          </div>
        </div>
        <HintTooltip label="New chat">
          <IconBtn label="New chat" onClick={newChat}>
            <SquarePlusIcon className="size-4" />
          </IconBtn>
        </HintTooltip>
        <HintTooltip label="Close">
          <IconBtn label="Close chat" onClick={onClose}>
            <XIcon className="size-4" />
          </IconBtn>
        </HintTooltip>
      </div>

      {configured === false ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
          <span className="text-[14px] font-bold text-(--te-text)">Connect Hermes chat</span>
          <span className="text-[13px] text-(--te-muted)">
            Add the API server URL and key in Settings → Assistant.
          </span>
          <button
            type="button"
            onClick={() => void gmailApi.openSettings({ pane: "general" })}
            className="te-label mt-1 h-7 rounded-[4px] border border-(--te-outline) px-2 text-(--te-text) hover:border-(--te-outline-hover) hover:text-(--te-strong)"
          >
            Open Settings
          </button>
        </div>
      ) : (
        <MessageScroller.Provider autoScroll defaultScrollPosition="end">
          <MessageScroller.Root className="relative min-h-0 flex-1">
            <MessageScroller.Viewport className="te-scroll h-full overflow-y-auto px-4 py-3">
              <MessageScroller.Content className="flex flex-col gap-3">
                {turns.length === 0 ? (
                  <div className="px-2 pt-6 text-center text-[13px] text-(--te-muted)">
                    Ask about the open conversation, your inbox, or anything Hermes can do
                    with its tools.
                  </div>
                ) : null}
                {turns.map((turn) => (
                  <MessageScroller.Item key={turn.id} messageId={turn.id} scrollAnchor>
                    {turn.role === "user" ? (
                      <div>
                        {turn.context ? <ContextRecap context={turn.context} /> : null}
                        <div className="ml-6 rounded-[8px] rounded-br-[2px] bg-(--te-sel) px-3 py-2 text-[13px] leading-relaxed text-(--te-sel-fg)">
                          {turn.text}
                        </div>
                      </div>
                    ) : (
                      <div className="mr-2">
                        {turn.tools.map((t, i) => (
                          <ToolStep key={i} name={t.name} output={t.output} />
                        ))}
                        {turn.text ? (
                          <ChatMarkdown text={turn.text} />
                        ) : !turn.error && streaming && turn.id === turns[turns.length - 1]?.id ? (
                          <span className="te-label text-(--te-faint)">thinking…</span>
                        ) : null}
                        {turn.error ? (
                          <div className="mt-1 rounded-[5px] border border-(--te-outline) bg-(--te-ctl) px-2.5 py-1.5 text-[12px] text-(--red)">
                            {turn.error}
                          </div>
                        ) : null}
                      </div>
                    )}
                  </MessageScroller.Item>
                ))}
              </MessageScroller.Content>
            </MessageScroller.Viewport>
            <MessageScroller.Button
              direction="end"
              render={(props, state) =>
                state.active ? (
                  <button
                    {...props}
                    type="button"
                    aria-label="Jump to latest"
                    className="absolute bottom-3 left-1/2 flex size-7 -translate-x-1/2 items-center justify-center rounded-full border border-(--te-outline) bg-(--te-panel) text-(--te-muted) shadow-sm hover:text-(--te-strong)"
                  >
                    <ArrowDownIcon className="size-4" />
                  </button>
                ) : null
              }
            />
          </MessageScroller.Root>

          <div className="shrink-0 px-3 pb-3 pt-1">
            {context ? (
              <button
                type="button"
                onClick={() => setAttach((a) => !a)}
                className={[
                  "te-label mb-1.5 flex max-w-full items-center gap-1.5 rounded-[4px] border px-2 py-1",
                  attach
                    ? "border-(--te-outline-hover) text-(--te-text)"
                    : "border-(--te-outline) text-(--te-faint) line-through",
                ].join(" ")}
              >
                <PaperclipIcon className="size-3 shrink-0" />
                <span className="min-w-0 truncate">
                  {context.conversations.length > 1
                    ? `${context.conversations.length} conversations`
                    : context.conversations[0].subject}
                </span>
              </button>
            ) : null}
            <div className="rounded-[6px] border border-(--te-outline) bg-(--te-panel) focus-within:border-(--te-outline-hover)">
              <textarea
                ref={inputRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
                placeholder="Message Hermes…"
                aria-label="Message Hermes"
                rows={2}
                className="w-full resize-none bg-transparent px-3 pt-2 text-[13px] text-(--te-strong) outline-none placeholder:text-(--te-faint)"
              />
              <div className="flex items-center gap-1 px-2 pb-1.5">
                <span className="flex-1" />
                {streaming ? (
                  <HintTooltip label="Stop">
                    <IconBtn label="Stop" className="size-7" onClick={stop}>
                      <CircleStopIcon className="size-4 text-(--red)" />
                    </IconBtn>
                  </HintTooltip>
                ) : (
                  <button
                    type="button"
                    onClick={send}
                    disabled={!draft.trim()}
                    aria-label="Send"
                    className="flex h-7 w-9 items-center justify-center rounded-[5px] bg-(--te-accent) text-white hover:brightness-110 disabled:bg-(--te-ctl) disabled:text-(--te-faint)"
                  >
                    <SendHorizontalIcon className="size-4" />
                  </button>
                )}
              </div>
            </div>
          </div>
        </MessageScroller.Provider>
      )}
    </div>
  );
}
