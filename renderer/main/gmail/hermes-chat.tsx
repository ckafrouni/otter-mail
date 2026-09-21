import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { MessageScroller } from "@shadcn/react/message-scroller";
import {
  ArrowDownIcon,
  BotMessageSquareIcon,
  CircleStopIcon,
  FilePenLineIcon,
  HistoryIcon,
  LayersIcon,
  MailIcon,
  SendHorizontalIcon,
  SendIcon,
  SquarePlusIcon,
  TextQuoteIcon,
  Trash2Icon,
  WrenchIcon,
  XIcon,
} from "lucide-react";
import { IconBtn, HintTooltip } from "./te-ui";
import {
  gmailApi,
  type ChatEvent,
  type ChatSession,
  type ChatSessionMessage,
  type Skill,
} from "./api";
import {
  buildHandoffText,
  contextFromMessages,
  contextFromQuote,
  type AssistantContext,
  type QuoteContext,
} from "./ask-assistant";
import { ChatMarkdown } from "./chat-markdown";
import { useAccounts, useMessage } from "./hooks";
import type { GmailMessageSummary } from "./types";

/** What the attached context items are, so the chip shows a fitting icon. */
type ContextKind = "draft" | "sent" | "mail" | "mixed" | "quote";
type ContextMeta = { subjects: string[]; count: number; kind: ContextKind };

/** Classify one message from its labels. */
function kindOf(labelIds: string[]): ContextKind {
  if (labelIds.includes("DRAFT")) return "draft";
  if (labelIds.includes("SENT")) return "sent";
  return "mail";
}

/** Collapse the selection's kinds: uniform → that kind, otherwise "mixed". */
function contextKind(labelSets: string[][]): ContextKind {
  if (labelSets.length === 0) return "mail";
  const kinds = new Set(labelSets.map(kindOf));
  return kinds.size === 1 ? [...kinds][0] : "mixed";
}

function ContextKindIcon({ kind, className }: { kind: ContextKind; className?: string }) {
  const Icon =
    kind === "quote"
      ? TextQuoteIcon
      : kind === "draft"
        ? FilePenLineIcon
        : kind === "sent"
          ? SendIcon
          : kind === "mixed"
            ? LayersIcon
            : MailIcon;
  return <Icon className={className} />;
}

/** One transcript entry. Tool steps interleave into the assistant turn. */
type ChatTurn = {
  id: string;
  role: "user" | "assistant";
  text: string;
  tools: { name: string; output?: string }[];
  /** Attached mail context, shown as a chip above the user's message. */
  context?: ContextMeta;
  /** Invoked skill, rendered as a badge on the user's message. */
  skill?: string;
  error?: string;
};

/** Command-style badge for an invoked skill (composer + user message). */
function SkillBadge({
  name,
  onRemove,
  onAccent,
}: {
  name: string;
  onRemove?: () => void;
  onAccent?: boolean;
}) {
  return (
    <span
      className={[
        "inline-flex shrink-0 items-center gap-1 rounded-[4px] px-1.5 py-0.5 text-[12px] font-semibold",
        onAccent ? "bg-(--te-sel-fg)/20 text-(--te-sel-fg)" : "bg-(--te-ctl) text-(--te-text)",
      ].join(" ")}
    >
      <span className="opacity-50">/</span>
      {name}
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          aria-label="Remove skill"
          className="opacity-70 hover:opacity-100"
        >
          <XIcon className="size-3" />
        </button>
      ) : null}
    </span>
  );
}

/** Chip recap of the context sent with a user turn. */
function ContextRecap({ context }: { context: ContextMeta }) {
  const label =
    context.count > 1
      ? `${context.count} conversations`
      : (context.subjects[0] ?? "1 conversation");
  return (
    <div className="mb-1 flex justify-end">
      <span className="te-label flex max-w-full items-center gap-1.5 rounded-[4px] border border-(--te-border) px-2 py-0.5 text-(--te-faint)">
        <ContextKindIcon kind={context.kind} className="size-3 shrink-0" />
        <span className="min-w-0 truncate">{label}</span>
      </span>
    </div>
  );
}

/**
 * A saved chat. `sessionId` binds it to a persistent Hermes session (native
 * Sessions API); pre-migration chats have none and keep chaining the next turn
 * via `lastResponseId` (Responses API) so their thread isn't lost.
 */
type Conversation = {
  id: string;
  title: string;
  turns: ChatTurn[];
  sessionId: string | null;
  /** Created by this app (deleting the chat deletes the session) vs. opened from Hermes. */
  sessionOwned: boolean;
  lastResponseId: string | null;
  updatedAt: number;
};

type Store = { conversations: Conversation[]; activeId: string };

const STORE_KEY = "gmail:hermes-chat:v2";
const LEGACY_KEY = "gmail:hermes-chat:v1";
const MAX_STORED_TURNS = 80;
const MAX_CONVERSATIONS = 40;

function clampTitle(text: string): string {
  const t = text.trim();
  if (!t) return "New chat";
  return t.length > 56 ? `${t.slice(0, 56)}…` : t;
}

function deriveTitle(turns: ChatTurn[]): string {
  return clampTitle(turns.find((t) => t.role === "user")?.text ?? "");
}

function newConversation(): Conversation {
  return {
    id: crypto.randomUUID(),
    title: "New chat",
    turns: [],
    sessionId: null,
    sessionOwned: false,
    lastResponseId: null,
    updatedAt: Date.now(),
  };
}

/** Human label for a session's origin (WebUI, CLI, this API, …). */
function sourceLabel(source: string): string {
  switch (source) {
    case "hermes_browser":
      return "WebUI";
    case "api_server":
      return "API";
    case "cli":
      return "CLI";
    default:
      return source.charAt(0).toUpperCase() + source.slice(1);
  }
}

/**
 * Rebuilds transcript turns from a session's stored messages: tool-call
 * assistant rows + tool rows fold into one assistant turn, closed by the final
 * answer, mirroring how a live stream renders.
 */
function turnsFromMessages(messages: ChatSessionMessage[]): ChatTurn[] {
  const turns: ChatTurn[] = [];
  let open: ChatTurn | null = null;
  for (let i = 0; i < messages.length; i += 1) {
    const m = messages[i];
    if (m.role === "user") {
      open = null;
      turns.push({ id: `h-${i}`, role: "user", text: m.text, tools: [] });
    } else if (m.role === "assistant") {
      if (!open) {
        open = { id: `h-${i}`, role: "assistant", text: "", tools: [] };
        turns.push(open);
      }
      for (const name of m.toolCalls ?? []) open.tools.push({ name });
      if (m.text) open.text = open.text ? `${open.text}\n\n${m.text}` : m.text;
      if (!m.toolCalls?.length) open = null;
    } else if (m.role === "tool" && open) {
      const pending = open.tools.find((t) => t.output === undefined);
      if (pending) pending.output = m.text.slice(0, 400) || "(done)";
    }
  }
  return turns.filter((t) => t.role === "user" || t.text || t.tools.length > 0);
}

function loadStore(): Store {
  let conversations: Conversation[] = [];
  let activeId: string | null = null;
  try {
    const v2 = JSON.parse(localStorage.getItem(STORE_KEY) ?? "") as Partial<Store>;
    if (Array.isArray(v2.conversations)) {
      // Chats saved before the Sessions migration carry no session fields.
      conversations = v2.conversations.map((c) => ({
        ...c,
        sessionId: c.sessionId ?? null,
        sessionOwned: c.sessionOwned ?? false,
      }));
      activeId = v2.activeId ?? null;
    }
  } catch {
    // fall through to legacy migration
  }
  if (conversations.length === 0) {
    try {
      const v1 = JSON.parse(localStorage.getItem(LEGACY_KEY) ?? "") as {
        turns?: ChatTurn[];
        lastResponseId?: string | null;
      };
      if (v1.turns && v1.turns.length > 0) {
        conversations = [
          {
            id: crypto.randomUUID(),
            title: deriveTitle(v1.turns),
            turns: v1.turns,
            sessionId: null,
            sessionOwned: false,
            lastResponseId: v1.lastResponseId ?? null,
            updatedAt: Date.now(),
          },
        ];
      }
    } catch {
      // no legacy data
    }
  }
  // Only non-empty sessions are kept; always land on a usable active one.
  conversations = conversations.filter((c) => c.turns.length > 0);
  if (!activeId || !conversations.some((c) => c.id === activeId)) {
    const fresh = newConversation();
    conversations = [fresh, ...conversations];
    activeId = fresh.id;
  }
  return { conversations, activeId };
}

function saveStore(store: Store): void {
  const conversations = store.conversations
    .slice(0, MAX_CONVERSATIONS)
    .map((c) => ({ ...c, turns: c.turns.slice(-MAX_STORED_TURNS) }));
  localStorage.setItem(STORE_KEY, JSON.stringify({ conversations, activeId: store.activeId }));
}

function formatAgo(ts: number): string {
  const mins = Math.floor((Date.now() - ts) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

const ERROR_TEXT: Record<string, string> = {
  not_configured: "Hermes chat isn't configured — add the API key in Settings.",
  unauthorized: "The API key was rejected — update it in Settings.",
  unreachable: "Can't reach Hermes — are you on Tailscale?",
  timeout: "Hermes went quiet for too long — the run was stopped.",
  cancelled: "Stopped.",
  session_not_found: "This chat's Hermes session no longer exists — send again to start a new one.",
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
 * Dropdown sheet of past conversations plus, when the server supports it, the
 * other sessions persisted on Hermes (WebUI, CLI, …) that can be resumed here.
 * Escape/backdrop-click closes it.
 */
function HistoryList({
  conversations,
  activeId,
  onPick,
  onDelete,
  onClose,
  serverSessions,
  serverLoading,
  onPickServer,
}: {
  conversations: Conversation[];
  activeId: string;
  onPick: (id: string) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
  /** Undefined when the server has no Sessions API (section hidden). */
  serverSessions?: ChatSession[];
  serverLoading: boolean;
  onPickServer: (session: ChatSession) => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const items = conversations.filter((c) => c.turns.length > 0);
  const showServer = serverSessions !== undefined || serverLoading;
  const server = serverSessions ?? [];
  return (
    <>
      <div className="absolute inset-x-0 bottom-0 top-[52px] z-10" onClick={onClose} aria-hidden />
      <div className="te-scroll absolute right-2 top-[54px] z-20 max-h-[70%] w-[calc(100%-1rem)] overflow-y-auto rounded-[8px] border border-(--te-outline) bg-(--te-panel) p-1 shadow-lg">
        {showServer ? (
          <div className="te-label px-2 pb-1 pt-0.5 text-(--te-faint)">Recent</div>
        ) : null}
        {items.length === 0 ? (
          <div className="px-2 py-3 text-center text-[12px] text-(--te-muted)">
            No past chats yet
          </div>
        ) : (
          items.map((c) => (
            <div
              key={c.id}
              className={[
                "group flex items-center gap-1 rounded-[5px] px-1",
                c.id === activeId ? "bg-(--te-hover)" : "hover:bg-(--te-hover)",
              ].join(" ")}
            >
              <button
                type="button"
                onClick={() => onPick(c.id)}
                className="flex min-w-0 flex-1 flex-col items-start py-1.5 pl-1.5 text-left"
              >
                <span className="w-full truncate text-[13px] text-(--te-text)">{c.title}</span>
                <span className="te-label text-(--te-faint)">{formatAgo(c.updatedAt)}</span>
              </button>
              <button
                type="button"
                onClick={() => onDelete(c.id)}
                aria-label="Delete chat"
                className="shrink-0 rounded-[4px] p-1 text-(--te-faint) opacity-0 hover:text-(--red) group-hover:opacity-100"
              >
                <Trash2Icon className="size-3.5" />
              </button>
            </div>
          ))
        )}
        {showServer ? (
          <>
            <div className="te-label px-2 pb-1 pt-2 text-(--te-faint)">On Hermes</div>
            {server.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => onPickServer(s)}
                className="flex w-full min-w-0 flex-col items-start rounded-[5px] px-2.5 py-1.5 text-left hover:bg-(--te-hover)"
              >
                <span className="w-full truncate text-[13px] text-(--te-text)">
                  {s.title || s.preview || s.id}
                </span>
                <span className="te-label text-(--te-faint)">
                  {sourceLabel(s.source)} · {formatAgo(s.lastActive)}
                </span>
              </button>
            ))}
            {serverLoading && server.length === 0 ? (
              <div className="px-2 py-2 text-center text-[12px] text-(--te-faint)">
                Loading sessions…
              </div>
            ) : null}
            {!serverLoading && server.length === 0 ? (
              <div className="px-2 py-2 text-center text-[12px] text-(--te-faint)">
                No other sessions
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </>
  );
}

/**
 * Right-side Hermes chat: streams over the backend bridge to Hermes' built-in
 * API server. New chats live in native server sessions (persistent transcript,
 * resumable from any client); pre-migration chats keep chaining via
 * previous_response_id. The local store mirrors transcripts for instant paint
 * (history dropdown); "attach" adds pointer-only context.
 */
export function HermesChatPanel({
  accountId,
  messageId,
  selectedRows,
  quote,
  onClearQuote,
  onClose,
}: {
  /** Account of the open conversation (context attach), null when none. */
  accountId: string | null;
  messageId: string | null;
  /** Multi-selected list rows; take priority over the open conversation. */
  selectedRows?: GmailMessageSummary[];
  /** A highlighted excerpt to attach; overrides the auto-derived context. */
  quote?: QuoteContext | null;
  onClearQuote?: () => void;
  onClose: () => void;
}) {
  const [store, setStore] = useState<Store>(() => loadStore());
  const { conversations, activeId } = store;
  const active = conversations.find((c) => c.id === activeId) ?? conversations[0];
  const turns = active?.turns ?? [];

  const [draft, setDraft] = useState("");
  // The in-flight stream is bound to its conversation so switching sessions
  // mid-run doesn't misroute deltas.
  const [streaming, setStreaming] = useState<{ requestId: string; convoId: string } | null>(null);
  const [attach, setAttach] = useState(true);
  const [configured, setConfigured] = useState<boolean | null>(null);
  // Native Sessions API available: new chats get a persistent server session.
  const [sessionsAvailable, setSessionsAvailable] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  // Conversation whose transcript is being pulled from the server.
  const [hydrating, setHydrating] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    saveStore(store);
  }, [store]);

  useEffect(() => {
    gmailApi.chatStatus().then(
      (s) => {
        setConfigured(s.configured);
        setSessionsAvailable(s.configured && s.sessions);
      },
      () => setConfigured(false),
    );
  }, []);

  // Other sessions persisted on Hermes (WebUI, CLI, …), fetched when history opens.
  const serverSessionsQuery = useQuery<ChatSession[]>({
    queryKey: ["hermes-sessions"],
    queryFn: () => gmailApi.chatSessionList({ limit: 40 }),
    enabled: historyOpen && sessionsAvailable,
    staleTime: 15_000,
  });

  // Skills for the "/" picker (gateway /commands aren't exposed by the API,
  // but skills are, and the agent loads them via its skill_view tool).
  const [skills, setSkills] = useState<Skill[]>([]);
  useEffect(() => {
    if (configured) gmailApi.chatSkills().then(setSkills, () => {});
  }, [configured]);

  const [slashDismissed, setSlashDismissed] = useState(false);
  const [slashIndex, setSlashIndex] = useState(0);
  const slashItemRef = useRef<HTMLButtonElement | null>(null);
  // A picked skill is promoted out of the textarea into a badge; the textarea
  // then holds only the instruction.
  const [activeSkill, setActiveSkill] = useState<Skill | null>(null);
  const handleDraftChange = (value: string) => {
    setSlashDismissed(false);
    // Typing a space after a complete "/known-skill" promotes it to the badge.
    if (!activeSkill) {
      const m = value.match(/^\/([a-z0-9-]+)\s([\s\S]*)$/i);
      const sk = m && skills.find((s) => s.name.toLowerCase() === m[1].toLowerCase());
      if (sk) {
        setActiveSkill(sk);
        setDraft(m![2]);
        return;
      }
    }
    setDraft(value);
  };
  // The menu opens only while typing a bare "/slug" (no space yet).
  const slashMatch = draft.match(/^\/([a-z0-9-]*)$/i);
  const slashQuery = slashMatch ? slashMatch[1].toLowerCase() : null;
  const slashSkills =
    slashQuery !== null
      ? skills.filter((s) => s.name.toLowerCase().includes(slashQuery)).slice(0, 8)
      : [];
  const slashOpen = slashQuery !== null && !slashDismissed && slashSkills.length > 0;
  useEffect(() => {
    setSlashIndex(0);
  }, [slashQuery]);
  // Keep the keyboard-highlighted skill scrolled into view.
  useEffect(() => {
    slashItemRef.current?.scrollIntoView({ block: "nearest" });
  }, [slashIndex]);
  const pickSkill = (skill: Skill) => {
    setActiveSkill(skill);
    setDraft("");
    setSlashDismissed(true);
    inputRef.current?.focus();
  };

  // Attach context: the multi-selection wins; otherwise the open conversation
  // (cache hit — the reader fetched it). Both are pointer-only; Hermes gogs
  // the bodies.
  const accountsQuery = useAccounts();
  const accountEmailById = (id: string | undefined) =>
    accountsQuery.data?.find((a) => a.id === id)?.email ?? id ?? "";
  const openMessage = useMessage(accountId, messageId);
  const multiSelected = selectedRows && selectedRows.length > 0;
  // A highlighted excerpt wins over any auto-derived context.
  const context: AssistantContext | null = quote
    ? contextFromQuote(quote)
    : multiSelected
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
  // Draft / sent / mail / quote kind of what's attached, for the chip's icon.
  const contextLabelSets: string[][] = multiSelected
    ? selectedRows.map((r) => r.labelIds)
    : openMessage.data
      ? [openMessage.data.labelIds]
      : [];
  const attachKind: ContextKind = quote ? "quote" : contextKind(contextLabelSets);

  // A fresh quote re-arms the attach toggle so it isn't silently dropped.
  useEffect(() => {
    if (quote) setAttach(true);
  }, [quote]);

  // Stream events land in their originating conversation (not necessarily the
  // active one); the listener mounts once and reads the stream via a ref.
  const streamingRef = useRef(streaming);
  streamingRef.current = streaming;
  useEffect(() => {
    const unsub = window.glazeAPI.glaze.ipc.onNotification(
      "assistant:chatEvent",
      (raw: unknown) => {
        const event = raw as ChatEvent;
        const s = streamingRef.current;
        if (!event || !s || event.requestId !== s.requestId) return;
        setStore((prev) => ({
          ...prev,
          conversations: prev.conversations.map((c) => {
            if (c.id !== s.convoId) return c;
            const nextTurns = [...c.turns];
            const turn = nextTurns[nextTurns.length - 1];
            if (!turn || turn.role !== "assistant") return c;
            const updated = { ...turn, tools: [...turn.tools] };
            if (event.type === "delta") updated.text += event.text;
            else if (event.type === "tool") updated.tools.push({ name: event.name });
            else if (event.type === "toolResult") {
              const open = [...updated.tools].reverse().find((t) => t.output === undefined);
              if (open) open.output = event.output;
            } else if (event.type === "error") {
              updated.error = friendlyError(event.message);
            }
            nextTurns[nextTurns.length - 1] = updated;
            const lastResponseId =
              event.type === "done" && event.responseId ? event.responseId : c.lastResponseId;
            // A session deleted elsewhere: unbind so the next send starts a fresh one.
            const sessionId =
              event.type === "error" && event.message === "session_not_found" ? null : c.sessionId;
            return { ...c, turns: nextTurns, lastResponseId, sessionId, updatedAt: Date.now() };
          }),
        }));
        if (event.type === "done" || event.type === "error") setStreaming(null);
      },
    );
    return unsub;
  }, []);

  const patchConversation = (id: string, fn: (c: Conversation) => Conversation) => {
    setStore((s) => ({
      ...s,
      conversations: s.conversations.map((c) => (c.id === id ? fn(c) : c)),
    }));
  };

  const send = () => {
    const question = draft.trim();
    if ((!question && !activeSkill) || streaming || configured === false || !active) return;
    const requestId = crypto.randomUUID();
    const convoId = active.id;
    const attached = attach && context ? context : null;
    // An active skill invokes it: the agent loads it via skill_view and follows
    // it. The displayed turn shows the skill as a badge + the instruction.
    const skill = activeSkill;
    const baseInput = skill
      ? `[IMPORTANT: The user invoked the "${skill.name}" skill. Load it with skill_view and follow its instructions.]${
          question ? `\n\n${question}` : ""
        }`
      : question;
    const input = attached ? buildHandoffText(baseInput, attached) : baseInput;
    const prevResponseId = active.lastResponseId ?? undefined;
    const firstTurn = active.turns.length === 0;
    const title = clampTitle(skill ? `/${skill.name} ${question}` : question);
    console.log("[HermesChat:send]", {
      requestId,
      attached: Boolean(attached),
      skill: skill?.name,
      session: active.sessionId ?? (sessionsAvailable && !prevResponseId ? "new" : "legacy"),
    });
    setDraft("");
    setActiveSkill(null);
    patchConversation(convoId, (c) => ({
      ...c,
      title: c.turns.length === 0 ? title : c.title,
      updatedAt: Date.now(),
      turns: [
        ...c.turns,
        {
          id: `u-${requestId}`,
          role: "user",
          text: question,
          tools: [],
          skill: skill?.name,
          context: attached
            ? {
                count: attached.conversations.length,
                subjects: quote ? [quote.text] : attached.conversations.map((x) => x.subject),
                kind: attachKind,
              }
            : undefined,
        },
        { id: `a-${requestId}`, role: "assistant", text: "", tools: [] },
      ],
    }));
    setStreaming({ requestId, convoId });
    // A quote is one-shot — release it once it's been sent.
    if (attached && quote) onClearQuote?.();
    void (async () => {
      let sessionId = active.sessionId;
      // A new chat gets a persistent server session; a pre-migration chat keeps
      // its response chain. If the session can't be created, fall back to chaining.
      if (!sessionId && !prevResponseId && sessionsAvailable) {
        try {
          const session = await gmailApi.chatSessionCreate(firstTurn ? { title } : {});
          sessionId = session.id;
          patchConversation(convoId, (c) => ({ ...c, sessionId: session.id, sessionOwned: true }));
        } catch (error) {
          console.log("[HermesChat:sessionCreate] failed, chaining instead", {
            error: String(error),
          });
        }
      }
      try {
        await gmailApi.chatSend({
          requestId,
          input,
          sessionId: sessionId ?? undefined,
          previousResponseId: sessionId ? undefined : prevResponseId,
        });
      } catch {
        // Failure events also arrive via the broadcast; this is a backstop.
        setStreaming((cur) => (cur?.requestId === requestId ? null : cur));
      }
    })();
  };

  /** Resumes a session persisted on Hermes (e.g. started in the WebUI) in the panel. */
  const openServerSession = (session: ChatSession) => {
    setHistoryOpen(false);
    const existing = conversations.find((c) => c.sessionId === session.id);
    if (existing) {
      switchTo(existing.id);
      return;
    }
    console.log("[HermesChat:openServerSession]", {
      sessionId: session.id,
      source: session.source,
    });
    const convo: Conversation = {
      id: crypto.randomUUID(),
      title: clampTitle(session.title || session.preview || "Hermes session"),
      turns: [],
      sessionId: session.id,
      sessionOwned: false,
      lastResponseId: null,
      updatedAt: session.lastActive || Date.now(),
    };
    setStore((s) => ({
      conversations: [convo, ...s.conversations.filter((c) => c.turns.length > 0)],
      activeId: convo.id,
    }));
    setHydrating(convo.id);
    gmailApi
      .chatSessionMessages(session.id)
      .then(
        (messages) => {
          const hydrated = turnsFromMessages(messages);
          patchConversation(convo.id, (c) =>
            c.turns.length > 0 ? c : { ...c, turns: hydrated, updatedAt: Date.now() },
          );
        },
        (error) => console.log("[HermesChat:hydrate] failed", { error: String(error) }),
      )
      .finally(() => setHydrating((cur) => (cur === convo.id ? null : cur)));
    inputRef.current?.focus();
  };

  const stop = () => {
    if (streaming) void gmailApi.chatCancel(streaming.requestId);
  };

  const newChat = () => {
    setHistoryOpen(false);
    // An already-empty active session just refocuses — no empty duplicates.
    if (active && active.turns.length === 0) {
      inputRef.current?.focus();
      return;
    }
    console.log("[HermesChat:newChat]");
    const fresh = newConversation();
    setStore((s) => ({
      conversations: [fresh, ...s.conversations.filter((c) => c.turns.length > 0)],
      activeId: fresh.id,
    }));
    inputRef.current?.focus();
  };

  const switchTo = (id: string) => {
    setHistoryOpen(false);
    setStore((s) => ({
      // Drop the current active session if it was still empty (avoids litter).
      conversations: s.conversations.filter((c) => c.id === id || c.turns.length > 0),
      activeId: id,
    }));
  };

  const deleteConversation = (id: string) => {
    if (streaming?.convoId === id) {
      void gmailApi.chatCancel(streaming.requestId);
      setStreaming(null);
    }
    // Sessions this app created go with the chat; ones opened from Hermes only unlink.
    const target = conversations.find((c) => c.id === id);
    if (target?.sessionId && target.sessionOwned) {
      void gmailApi.chatSessionDelete(target.sessionId).catch(() => {});
    }
    setStore((s) => {
      const remaining = s.conversations.filter((c) => c.id !== id);
      if (s.activeId !== id) return { ...s, conversations: remaining };
      const nonEmpty = remaining.filter((c) => c.turns.length > 0);
      if (nonEmpty.length > 0) return { conversations: remaining, activeId: nonEmpty[0].id };
      const fresh = newConversation();
      return { conversations: [fresh, ...remaining], activeId: fresh.id };
    });
  };

  // Only the active conversation drives the "working…" / stop UI.
  const streamingActive = streaming != null && streaming.convoId === activeId;
  const busy = streaming != null;

  return (
    <div className="relative flex h-full min-w-0 flex-col">
      <div className="drag-region flex h-11 shrink-0 items-center gap-2 border-b border-(--te-border) px-4">
        <BotMessageSquareIcon className="size-4 shrink-0 text-(--te-muted)" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-bold leading-tight tracking-tight text-(--te-strong)">
            Hermes
          </div>
          <div className="te-label truncate leading-tight text-(--te-muted)">
            {streamingActive ? "working…" : "agent chat"}
          </div>
        </div>
        <HintTooltip label="Chat history">
          <IconBtn
            label="Chat history"
            active={historyOpen}
            onClick={() => setHistoryOpen((o) => !o)}
          >
            <HistoryIcon className="size-3.5" />
          </IconBtn>
        </HintTooltip>
        <HintTooltip label="New chat">
          <IconBtn label="New chat" onClick={newChat}>
            <SquarePlusIcon className="size-3.5" />
          </IconBtn>
        </HintTooltip>
        <HintTooltip label="Close">
          <IconBtn label="Close chat" onClick={onClose}>
            <XIcon className="size-3.5" />
          </IconBtn>
        </HintTooltip>
      </div>

      {historyOpen ? (
        <HistoryList
          conversations={conversations}
          activeId={activeId}
          onPick={switchTo}
          onDelete={deleteConversation}
          onClose={() => setHistoryOpen(false)}
          serverSessions={
            sessionsAvailable && serverSessionsQuery.data
              ? serverSessionsQuery.data.filter(
                  (s) => s.messageCount > 0 && !conversations.some((c) => c.sessionId === s.id),
                )
              : undefined
          }
          serverLoading={sessionsAvailable && serverSessionsQuery.isPending}
          onPickServer={openServerSession}
        />
      ) : null}

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
                    {hydrating === activeId
                      ? "Loading this session from Hermes…"
                      : "Ask about the open conversation, your inbox, or anything Hermes can do with its tools."}
                  </div>
                ) : null}
                {turns.map((turn) => (
                  <MessageScroller.Item key={turn.id} messageId={turn.id} scrollAnchor>
                    {turn.role === "user" ? (
                      <div>
                        {turn.context ? <ContextRecap context={turn.context} /> : null}
                        <div className="ml-6 rounded-[8px] rounded-br-[2px] bg-(--te-sel) px-3 py-2 text-[13px] leading-relaxed text-(--te-sel-fg)">
                          {turn.skill ? (
                            <span className="mb-1 mr-1.5 inline-flex align-middle">
                              <SkillBadge name={turn.skill} onAccent />
                            </span>
                          ) : null}
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
                        ) : !turn.error &&
                          streamingActive &&
                          turn.id === turns[turns.length - 1]?.id ? (
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
                    <ArrowDownIcon className="size-3.5" />
                  </button>
                ) : null
              }
            />
          </MessageScroller.Root>

          <div className="relative shrink-0 px-3 pb-3 pt-1">
            {slashOpen ? (
              <div className="te-scroll absolute inset-x-3 bottom-full z-20 mb-1 max-h-64 overflow-y-auto rounded-[8px] border border-(--te-outline) bg-(--te-panel) p-1 shadow-lg">
                <div className="te-label px-2 pb-1 pt-0.5 text-(--te-faint)">Skills</div>
                {slashSkills.map((s, i) => (
                  <button
                    key={s.name}
                    type="button"
                    ref={i === slashIndex ? slashItemRef : undefined}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      pickSkill(s);
                    }}
                    onMouseEnter={() => setSlashIndex(i)}
                    className={[
                      "flex w-full flex-col items-start rounded-[5px] px-2 py-1.5 text-left",
                      i === slashIndex ? "bg-(--te-hover)" : "",
                    ].join(" ")}
                  >
                    <span className="text-[12px] font-semibold text-(--te-text)">/{s.name}</span>
                    <span className="w-full truncate text-[11px] text-(--te-faint)">
                      {s.description}
                    </span>
                  </button>
                ))}
              </div>
            ) : null}
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
                <ContextKindIcon kind={attachKind} className="size-3 shrink-0" />
                <span className="min-w-0 truncate">
                  {quote
                    ? `“${quote.text}”`
                    : context.conversations.length > 1
                      ? `${context.conversations.length} conversations`
                      : context.conversations[0].subject}
                </span>
              </button>
            ) : null}
            <div className="rounded-[6px] border border-(--te-outline) bg-(--te-panel) focus-within:border-(--te-outline-hover)">
              {activeSkill ? (
                <div className="px-2.5 pt-2">
                  <SkillBadge name={activeSkill.name} onRemove={() => setActiveSkill(null)} />
                </div>
              ) : null}
              <textarea
                ref={inputRef}
                value={draft}
                onChange={(e) => handleDraftChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Backspace" && draft === "" && activeSkill && !slashOpen) {
                    e.preventDefault();
                    setActiveSkill(null);
                    return;
                  }
                  if (slashOpen) {
                    if (e.key === "ArrowDown") {
                      e.preventDefault();
                      setSlashIndex((i) => Math.min(slashSkills.length - 1, i + 1));
                      return;
                    }
                    if (e.key === "ArrowUp") {
                      e.preventDefault();
                      setSlashIndex((i) => Math.max(0, i - 1));
                      return;
                    }
                    if (e.key === "Enter" || e.key === "Tab") {
                      e.preventDefault();
                      pickSkill(slashSkills[slashIndex]);
                      return;
                    }
                    if (e.key === "Escape") {
                      e.preventDefault();
                      setSlashDismissed(true);
                      return;
                    }
                  }
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
                placeholder="Message Hermes…  (/ for skills)"
                aria-label="Message Hermes"
                rows={2}
                className="w-full resize-none bg-transparent px-3 pt-2 text-[13px] text-(--te-strong) outline-none placeholder:text-(--te-faint)"
              />
              <div className="flex items-center gap-1 px-2 pb-1.5">
                <span className="flex-1" />
                {busy ? (
                  <HintTooltip label="Stop">
                    <IconBtn label="Stop" className="size-7" onClick={stop}>
                      <CircleStopIcon className="size-4 text-(--red)" />
                    </IconBtn>
                  </HintTooltip>
                ) : (
                  <button
                    type="button"
                    onClick={send}
                    disabled={!draft.trim() && !activeSkill}
                    aria-label="Send"
                    className="flex h-7 w-9 items-center justify-center rounded-[5px] bg-(--te-accent) text-white hover:brightness-110 disabled:bg-(--te-ctl) disabled:text-(--te-faint)"
                  >
                    <SendHorizontalIcon className="size-3.5" />
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
