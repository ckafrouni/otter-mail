import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { MessageScroller } from "@shadcn/react/message-scroller";
import {
  ArrowDownIcon,
  PanelRightIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CircleAlertIcon,
  FilePenLineIcon,
  HistoryIcon,
  LayersIcon,
  MailIcon,
  SendIcon,
  SquarePlusIcon,
  TerminalIcon,
  TextQuoteIcon,
  Trash2Icon,
  WrenchIcon,
  XIcon,
  CheckIcon,
  CornerUpRightIcon,
  ListPlusIcon,
} from "lucide-react";
import { IconBtn, HintTooltip, buttonClass, cn } from "./ui";
import {
  gmailApi,
  type ChatEvent,
  type ChatSession,
  type ChatSessionMessage,
  type ApprovalDecision,
  type ApprovalRequest,
  type AssistantSettingsPatch,
  type ProviderKind,
  type Skill,
} from "./api";
import {
  ComposerControlSeparator,
  ProviderModelPicker,
  RuntimeModePicker,
  TraitsPicker,
} from "./model-picker";
import { ApprovalBanner } from "./approval-banner";
import {
  ProviderIcon,
  isProviderUsable,
  providerSummary,
  useAssistantProviders,
  useSetProvidersState,
} from "./assistant-providers";
import {
  buildHandoffText,
  contextFromMessages,
  contextFromQuote,
  type AssistantContext,
  type QuoteContext,
} from "./chat-context";
import { ChatMarkdown } from "./chat-markdown";
import { IntentMarker, QueuedRunsControl, useFollowUpBehavior } from "./chat-queue";
import { toast } from "@glaze/core/components";
import { useCommandHandlers, useKeybindingContext } from "../keybindings/dispatch";
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
  /** How a user message was delivered (Otter Code's inputIntent marker). */
  intent?: "queued" | "steer" | "promoted";
  error?: string;
  /** Assistant turns: when the run started / settled, for the "Worked for" fold. */
  startedAt?: number;
  finishedAt?: number;
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
        "inline-flex shrink-0 items-center gap-1 rounded-sm px-1.5 py-0.5 text-xs font-semibold",
        onAccent ? "bg-foreground/8 text-foreground" : "bg-primary/10 text-primary",
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
      <span className="flex max-w-full items-center gap-1.5 rounded-sm border border-border px-2 py-0.5 text-2xs font-medium text-muted-foreground">
        <ContextKindIcon kind={context.kind} className="size-3 shrink-0" />
        <span className="min-w-0 truncate">{label}</span>
      </span>
    </div>
  );
}

/**
 * A saved chat, bound to the provider it started with. `sessionId` is the
 * provider-side session (Hermes session / Codex thread); pre-migration Hermes
 * chats have none and keep chaining via `lastResponseId` (Responses API).
 */
type Conversation = {
  id: string;
  title: string;
  turns: ChatTurn[];
  provider: ProviderKind;
  sessionId: string | null;
  /** Created by this app (deleting the chat deletes the session) vs. opened from the provider. */
  sessionOwned: boolean;
  lastResponseId: string | null;
  updatedAt: number;
};

type Store = { conversations: Conversation[]; activeId: string };

/** A composed message, before it becomes a turn (or a steer). */
type Outgoing = {
  id: string;
  convoId: string;
  question: string;
  /** What the agent receives (question + attached context block). */
  input: string;
  skill?: Skill;
  title: string;
  context?: ContextMeta;
};

/**
 * A follow-up waiting for the running turn (Otter Code's queued run). It has
 * no transcript row until it starts; it lives in the queue banner. In memory
 * only: a queued message is a live intent, not a draft worth persisting.
 */
type QueuedMessage = Outgoing;

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

function newConversation(provider: ProviderKind = "hermes"): Conversation {
  return {
    id: crypto.randomUUID(),
    title: "New chat",
    turns: [],
    provider,
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
    case "codex":
      return "Codex";
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
      turns.push({
        id: `h-${i}`,
        role: "user",
        text: stripHandoff(m.text),
        tools: [],
      });
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
      // Older chats carry no session / provider fields (they were all Hermes).
      conversations = v2.conversations.map((c) => ({
        ...c,
        provider: c.provider ?? "hermes",
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
            provider: "hermes",
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

/** Canonical error codes from the backend → what the transcript says. */
function friendlyError(code: string, provider: ProviderKind): string {
  const name = provider === "codex" ? "Codex" : provider === "claude" ? "Claude" : "Hermes";
  switch (code) {
    case "not_configured":
      return `${name} isn't set up — connect it in Settings → Assistant.`;
    case "not_installed":
      return "The Codex CLI wasn't found — check it in Settings → Assistant.";
    case "provider_disabled":
      return `${name} is turned off in Settings → Assistant.`;
    case "unauthorized":
      return "The API key was rejected — update it in Settings.";
    case "unreachable":
      return provider === "codex"
        ? "Lost the connection to Codex — send again to retry."
        : "Can't reach Hermes — are you on Tailscale?";
    case "timeout":
      return `${name} went quiet for too long — the run was stopped.`;
    case "cancelled":
      return "Stopped.";
    case "session_not_found":
      return `This chat's ${name} session no longer exists — send again to start a new one.`;
    default:
      return code.startsWith("agent_error: ")
        ? code.slice("agent_error: ".length)
        : `${name} answered with an error (${code}).`;
  }
}

/** Hydrated user turns show the question, not the context block sent with it. */
function stripHandoff(text: string): string {
  const cut = text.indexOf("\n\n— context from Otter Mail —");
  return cut === -1 ? text : text.slice(0, cut);
}

function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  if (total < 60) return `${total}s`;
  const mins = Math.floor(total / 60);
  if (mins < 60) return `${mins}m ${total % 60}s`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

/** Live elapsed time for the "Working for" row. */
function WorkingTimer({ startedAt }: { startedAt: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return <>{formatDuration(now - startedAt)}</>;
}

/** Bottom-of-turn activity row while Hermes is still running. */
function WorkingRow({ startedAt }: { startedAt?: number }) {
  return (
    <div className="border-b border-border/60 pb-2 pt-1">
      <div className="flex h-6 min-w-0 items-baseline gap-2 px-1 text-sm leading-relaxed text-muted-foreground tabular-nums">
        <span className="relative shrink-0 whitespace-nowrap animate-status-pulse">
          {startedAt ? (
            <>
              Working for <WorkingTimer startedAt={startedAt} />
            </>
          ) : (
            "Working…"
          )}
        </span>
      </div>
    </div>
  );
}

/** Collapsed summary of a finished run; toggles the tool rows underneath. */
function WorkFoldRow({
  label,
  expanded,
  onToggle,
}: {
  label: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  const Icon = expanded ? ChevronDownIcon : ChevronRightIcon;
  return (
    <div className="relative flex items-center gap-1 border-b border-border/60 pb-2 pe-0.5 pt-1">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={onToggle}
        className="flex cursor-pointer select-none items-center gap-1 rounded-md px-1 text-sm leading-relaxed text-muted-foreground tabular-nums transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus-ring/70"
      >
        <span>{label}</span>
        <Icon className="size-3.5" />
      </button>
    </div>
  );
}

/** One tool call: icon, name, chevron; expands to the captured output. */
function ToolRow({ name, output }: { name: string; output?: string }) {
  const [open, setOpen] = useState(false);
  const canExpand = Boolean(output);
  const pending = output === undefined;
  const Icon = /term|shell|bash|command|exec/i.test(name) ? TerminalIcon : WrenchIcon;
  const toggle = () => setOpen((o) => !o);
  return (
    <div
      role={canExpand ? "button" : undefined}
      tabIndex={canExpand ? 0 : undefined}
      aria-expanded={canExpand ? open : undefined}
      onClick={canExpand ? toggle : undefined}
      onKeyDown={
        canExpand
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                toggle();
              }
            }
          : undefined
      }
      className={cn(
        "group/timeline-row relative flex flex-col rounded-md px-0.5 py-0.5 transition-colors",
        open && "mb-1",
        canExpand &&
          "cursor-pointer hover:bg-accent-surface/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus-ring/70",
      )}
    >
      <div className="flex select-none items-center gap-1.5">
        <span className="flex size-6 shrink-0 items-center justify-center text-icon-muted">
          <Icon className="block size-4 shrink-0 stroke-2" aria-hidden />
        </span>
        <p
          className={cn(
            "min-w-0 flex-1 truncate text-sm leading-relaxed text-secondary-label",
            pending && "animate-status-pulse",
          )}
        >
          {name}
        </p>
        <span
          className={cn(
            "flex size-4 shrink-0 items-center justify-center",
            !canExpand && "invisible",
          )}
          aria-hidden
        >
          <ChevronRightIcon
            className={cn(
              "size-3 shrink-0 text-icon-muted opacity-70 transition-transform duration-200",
              open && "rotate-90",
            )}
          />
        </span>
      </div>
      {open && output ? (
        <pre
          onClick={(e) => e.stopPropagation()}
          className="ms-7 mt-1 max-h-64 select-text overflow-auto rounded-lg border border-border bg-code px-3 py-2 font-mono text-2xs leading-relaxed text-muted-foreground"
        >
          {output}
        </pre>
      ) : null}
    </div>
  );
}

/** Failed turn: red heading row plus the explanation underneath. */
function ErrorRow({ message, providerName }: { message: string; providerName: string }) {
  return (
    <div className="flex flex-col px-0.5 py-1">
      <div className="flex items-center gap-1.5">
        <span className="flex size-6 shrink-0 items-center justify-center text-destructive">
          <CircleAlertIcon className="size-4 stroke-2" aria-hidden />
        </span>
        <span className="text-sm font-medium leading-relaxed text-destructive">
          {providerName} error
        </span>
      </div>
      <p className="ms-7 text-sm leading-relaxed text-foreground/80">{message}</p>
    </div>
  );
}

/**
 * Dropdown sheet of past conversations plus, when the provider keeps them, the
 * other sessions persisted there (Hermes WebUI, earlier Codex threads, …).
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
  providerName,
}: {
  providerName: string;
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
      <div
        className="absolute inset-x-0 bottom-0 top-(--workspace-topbar-height) z-10"
        onClick={onClose}
        aria-hidden
      />
      <div className="dropdown-glass absolute left-2 top-[calc(var(--workspace-topbar-height)+2px)] z-20 max-h-[70%] w-[calc(100%-1rem)] overflow-y-auto rounded-lg p-1 shadow-[0_16px_40px_-18px_rgb(0_0_0/55%)] dark:shadow-[0_18px_44px_-18px_rgb(0_0_0/80%)]">
        {showServer ? (
          <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">Recent</div>
        ) : null}
        {items.length === 0 ? (
          <div className="px-2 py-3 text-center text-xs text-muted-foreground">
            No past chats yet
          </div>
        ) : (
          items.map((c) => (
            <div
              key={c.id}
              className={[
                "group flex items-center gap-1 rounded-md px-1",
                c.id === activeId ? "bg-accent-surface" : "hover:bg-accent-surface",
              ].join(" ")}
            >
              <button
                type="button"
                onClick={() => onPick(c.id)}
                className="flex min-w-0 flex-1 flex-col items-start py-1.5 pl-1.5 text-left"
              >
                <span className="w-full truncate text-sm text-foreground/90">{c.title}</span>
                <span className="text-xs text-muted-foreground">{formatAgo(c.updatedAt)}</span>
              </button>
              <button
                type="button"
                onClick={() => onDelete(c.id)}
                aria-label="Delete chat"
                className="shrink-0 rounded-sm p-1 text-muted-foreground/70 opacity-0 hover:text-(--red) group-hover:opacity-100"
              >
                <Trash2Icon className="size-3.5" />
              </button>
            </div>
          ))
        )}
        {showServer ? (
          <>
            <div className="px-2 pb-1.5 pt-2 text-xs font-medium text-muted-foreground">
              On {providerName}
            </div>
            {server.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => onPickServer(s)}
                className="flex w-full min-w-0 flex-col items-start rounded-md px-2.5 py-1.5 text-left hover:bg-accent-surface"
              >
                <span className="w-full truncate text-sm text-foreground/90">
                  {s.title || s.preview || s.id}
                </span>
                <span className="text-xs text-muted-foreground">
                  {sourceLabel(s.source)} · {formatAgo(s.lastActive)}
                </span>
              </button>
            ))}
            {serverLoading && server.length === 0 ? (
              <div className="px-2 py-2 text-center text-xs text-muted-foreground/70">
                Loading sessions…
              </div>
            ) : null}
            {!serverLoading && server.length === 0 ? (
              <div className="px-2 py-2 text-center text-xs text-muted-foreground/70">
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
 * Right-side assistant chat. Each conversation is bound to a provider (Hermes,
 * Codex); turns stream through the backend's provider layer as canonical chat
 * events. The local store mirrors transcripts for instant paint (history
 * dropdown); "attach" adds pointer-only context.
 */
export function AssistantChatPanel({
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
  const [streaming, setStreaming] = useState<{
    requestId: string;
    convoId: string;
    provider: ProviderKind;
  } | null>(null);
  const [attach, setAttach] = useState(true);
  const [queue, setQueue] = useState<QueuedMessage[]>([]);
  // ⌘ held: the send button previews the alternate action (queue ⇄ steer).
  const [modHeld, setModHeld] = useState(false);
  useEffect(() => {
    const sync = (e: KeyboardEvent) => setModHeld(e.metaKey || e.ctrlKey);
    const clear = () => setModHeld(false);
    window.addEventListener("keydown", sync);
    window.addEventListener("keyup", sync);
    window.addEventListener("blur", clear);
    return () => {
      window.removeEventListener("keydown", sync);
      window.removeEventListener("keyup", sync);
      window.removeEventListener("blur", clear);
    };
  }, []);
  const followUp = useFollowUpBehavior();
  // Approvals the running turn is waiting on (oldest first).
  const [approvals, setApprovals] = useState<{ requestId: string; approval: ApprovalRequest }[]>(
    [],
  );
  const [respondingApproval, setRespondingApproval] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  // Provider: a conversation keeps the one it started with; an empty one
  // follows the picker (the default for new chats).
  const providersQuery = useAssistantProviders();
  const setProvidersState = useSetProvidersState();
  const providersState = providersQuery.data;
  const selectedKind = providersState?.selected ?? "hermes";
  const providerKind: ProviderKind =
    active && active.turns.length > 0 ? active.provider : selectedKind;
  const provider = providersState?.providers.find((p) => p.kind === providerKind);
  const providerName = provider?.displayName ?? (providerKind === "codex" ? "Codex" : "Hermes");
  const usable = isProviderUsable(provider);
  const sessionsAvailable = Boolean(provider?.sessions && usable);
  // Finished runs fold their tool rows behind a "Worked for …" summary.
  const [expandedFolds, setExpandedFolds] = useState<Set<string>>(() => new Set());
  const toggleFold = (id: string) =>
    setExpandedFolds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  // Conversation whose transcript is being pulled from the server.
  const [hydrating, setHydrating] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    saveStore(store);
  }, [store]);

  // Other sessions persisted on the provider (Hermes WebUI, Codex threads…), fetched when history opens.
  const serverSessionsQuery = useQuery<ChatSession[]>({
    queryKey: ["assistant-sessions", providerKind],
    queryFn: () => gmailApi.assistantSessions(providerKind, 40),
    enabled: historyOpen && sessionsAvailable,
    staleTime: 15_000,
  });

  // Skills for the "/" picker, from whichever provider this chat uses.
  const skillsQuery = useQuery<Skill[]>({
    queryKey: ["assistant-skills", providerKind],
    queryFn: () => gmailApi.assistantSkills(providerKind),
    enabled: usable,
    staleTime: 5 * 60_000,
  });
  const skills = skillsQuery.data ?? [];

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
      const m = value.match(/^\/([a-z0-9:_-]+)\s([\s\S]*)$/i);
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
  const slashMatch = draft.match(/^\/([a-z0-9:_-]*)$/i);
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
  const storeRef = useRef(store);
  storeRef.current = store;
  const streamingRef = useRef(streaming);
  streamingRef.current = streaming;
  useEffect(() => {
    const unsub = window.glazeAPI.glaze.ipc.onNotification(
      "assistant:chatEvent",
      (raw: unknown) => {
        const event = raw as ChatEvent;
        const s = streamingRef.current;
        if (!event || !s || event.requestId !== s.requestId) return;
        // Approvals live beside the transcript, not in it.
        if (event.type === "approval") {
          setApprovals((list) => [
            ...list,
            { requestId: event.requestId, approval: event.approval },
          ]);
          return;
        }
        if (event.type === "approvalResolved") {
          setApprovals((list) => list.filter((a) => a.approval.id !== event.approvalId));
          return;
        }
        if (event.type === "done" || event.type === "error")
          setApprovals((list) => list.filter((a) => a.requestId !== event.requestId));
        setStore((prev) => ({
          ...prev,
          conversations: prev.conversations.map((c) => {
            if (c.id !== s.convoId) return c;
            // The provider opened a session for this chat: bind it for the next turns.
            if (event.type === "session")
              return { ...c, sessionId: event.sessionId, sessionOwned: true };
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
              updated.error = friendlyError(event.message, s.provider);
            }
            if (event.type === "done" || event.type === "error") updated.finishedAt = Date.now();
            nextTurns[nextTurns.length - 1] = updated;
            const lastResponseId =
              event.type === "done" && event.responseId ? event.responseId : c.lastResponseId;
            // A session deleted elsewhere: unbind so the next send starts a fresh one.
            const sessionId =
              event.type === "error" && event.message === "session_not_found" ? null : c.sessionId;
            return {
              ...c,
              turns: nextTurns,
              lastResponseId,
              sessionId,
              updatedAt: Date.now(),
            };
          }),
        }));
        if (event.type === "done" || event.type === "error") setStreaming(null);
        // A steer the agent never got to: it goes first in line.
        if (event.type === "steerReturned")
          setQueue((q) => [
            {
              id: crypto.randomUUID(),
              convoId: s.convoId,
              question: event.text,
              input: event.text,
              title: clampTitle(event.text),
            },
            ...q,
          ]);
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

  /** Consumes the composer (text, skill, attached context) into a message. */
  const compose = (): Outgoing | null => {
    const question = draft.trim();
    if ((!question && !activeSkill) || !usable || !active) return null;
    const attached = attach && context ? context : null;
    const skill = activeSkill ?? undefined;
    setDraft("");
    setActiveSkill(null);
    // A quote is one-shot — release it once it's been sent.
    if (attached && quote) onClearQuote?.();
    return {
      id: crypto.randomUUID(),
      convoId: active.id,
      question,
      input: attached ? buildHandoffText(question, attached) : question,
      skill,
      title: clampTitle(skill ? `/${skill.name} ${question}` : question),
      context: attached
        ? {
            count: attached.conversations.length,
            subjects: quote ? [quote.text] : attached.conversations.map((x) => x.subject),
            kind: attachKind,
          }
        : undefined,
    };
  };

  /** The user bubble + an empty assistant turn that the stream fills in. */
  const appendExchange = (
    convoId: string,
    msg: Outgoing,
    requestKey: string,
    intent?: ChatTurn["intent"],
  ) =>
    patchConversation(convoId, (c) => ({
      ...c,
      updatedAt: Date.now(),
      turns: [
        // A steer closes the running turn's fold; the stream continues below.
        ...c.turns.map((t, i) =>
          i === c.turns.length - 1 && t.role === "assistant" && !t.finishedAt
            ? { ...t, finishedAt: Date.now() }
            : t,
        ),
        {
          id: `u-${requestKey}`,
          role: "user",
          text: msg.question,
          tools: [],
          skill: msg.skill?.name,
          context: msg.context,
          intent,
        },
        {
          id: `a-${requestKey}`,
          role: "assistant",
          text: "",
          tools: [],
          startedAt: Date.now(),
        },
      ],
    }));

  /** Starts a new turn in the message's conversation. */
  const startTurn = (msg: Outgoing, intent?: ChatTurn["intent"]) => {
    const convo = storeRef.current.conversations.find((c) => c.id === msg.convoId);
    if (!convo) return;
    const requestId = crypto.randomUUID();
    const kind = convo.turns.length > 0 ? convo.provider : providerKind;
    const firstTurn = convo.turns.length === 0;
    console.log("[AssistantChat:send]", {
      requestId,
      provider: kind,
      attached: Boolean(msg.context),
      skill: msg.skill?.name,
      session: convo.sessionId ?? "new",
    });
    patchConversation(msg.convoId, (c) => ({
      ...c,
      // The first turn pins the chat to the provider it was sent with.
      provider: firstTurn ? kind : c.provider,
      title: firstTurn ? msg.title : c.title,
    }));
    appendExchange(msg.convoId, msg, requestId, intent);
    setStreaming({ requestId, convoId: msg.convoId, provider: kind });
    // Returns at once; the turn streams as chat events (incl. the new session id).
    gmailApi
      .assistantSend({
        provider: kind,
        requestId,
        input: msg.input,
        sessionId: convo.sessionId ?? undefined,
        title: firstTurn ? msg.title : undefined,
        skill: msg.skill ? { name: msg.skill.name, path: msg.skill.path } : undefined,
        previousResponseId: convo.sessionId ? undefined : (convo.lastResponseId ?? undefined),
      })
      .catch((error: unknown) => {
        console.log("[AssistantChat:send] failed", { error: String(error) });
        patchConversation(msg.convoId, (c) => ({
          ...c,
          turns: c.turns.map((t) =>
            t.id === `a-${requestId}`
              ? {
                  ...t,
                  error: friendlyError("unreachable", kind),
                  finishedAt: Date.now(),
                }
              : t,
          ),
        }));
        setStreaming((cur) => (cur?.requestId === requestId ? null : cur));
      });
  };

  /**
   * Steers the message into the running turn (Codex turn/steer, Claude's live
   * prompt, Hermes' run steer). Refused → it goes (back) to the queue.
   */
  const steer = (msg: Outgoing, intent: "steer" | "promoted" = "steer") => {
    const run = streamingRef.current;
    if (!run || run.convoId !== msg.convoId) return startTurn(msg);
    console.log("[AssistantChat:steer]", { provider: run.provider, intent });
    const key = `${run.requestId}-${msg.id}`;
    appendExchange(msg.convoId, msg, key, intent);
    const refused = () => {
      undoExchange(msg.convoId, key);
      setQueue((q) => [msg, ...q]);
    };
    gmailApi
      .assistantSteer(run.provider, run.requestId, msg.input)
      .then(({ accepted }) => !accepted && refused(), refused);
  };

  /** Removes an optimistic steer exchange that the agent refused. */
  const undoExchange = (convoId: string, requestKey: string) =>
    patchConversation(convoId, (c) => ({
      ...c,
      turns: c.turns.filter((t) => t.id !== `u-${requestKey}` && t.id !== `a-${requestKey}`),
    }));

  /**
   * Otter Code's dispatch modes: idle → start; running → queue or steer per
   * the follow-up setting, ⌘↩ / ⌘-click does the opposite for one message.
   * Editing a queued message, send updates it in place instead.
   */
  const send = (alternate = false) => {
    if (editing) {
      saveQueuedEdit();
      return;
    }
    const msg = compose();
    if (!msg) return;
    const run = streamingRef.current;
    if (!run) return startTurn(msg);
    if (run.convoId !== msg.convoId) return setQueue((q) => [...q, msg]);
    if ((followUp === "queue") !== alternate) setQueue((q) => [...q, msg]);
    else steer(msg);
  };

  /** Promote a queued message to steer the active run (Otter Code's "Steer"). */
  const steerQueued = (id: string) => {
    const msg = queue.find((m) => m.id === id);
    const run = streamingRef.current;
    if (!msg || !run || run.convoId !== msg.convoId) return;
    setQueue((q) => q.filter((m) => m.id !== id));
    steer(msg, "promoted");
  };

  /** Drag / arrow-key reorder: move `id` before `beforeId` (null = to the end). */
  const moveQueued = (id: string, beforeId: string | null) =>
    setQueue((q) => {
      const moving = q.find((m) => m.id === id);
      if (!moving || id === beforeId) return q;
      const rest = q.filter((m) => m.id !== id);
      const at = beforeId === null ? rest.length : rest.findIndex((m) => m.id === beforeId);
      return at < 0 ? q : [...rest.slice(0, at), moving, ...rest.slice(at)];
    });

  const removeQueued = (id: string) => {
    if (editing?.id === id) cancelQueuedEdit();
    setQueue((q) => q.filter((m) => m.id !== id));
  };

  // Editing a queued message borrows the composer; the user's own draft is
  // set aside and comes back when the edit ends (Otter Code's queued-edit draft).
  const [editing, setEditing] = useState<{
    id: string;
    savedDraft: string;
  } | null>(null);
  const editQueued = (id: string) => {
    const msg = queue.find((m) => m.id === id);
    if (!msg) return;
    setEditing({ id, savedDraft: editing ? editing.savedDraft : draft });
    setDraft(msg.question);
    inputRef.current?.focus();
  };
  const cancelQueuedEdit = () => {
    if (!editing) return;
    setDraft(editing.savedDraft);
    setEditing(null);
  };
  const saveQueuedEdit = () => {
    if (!editing) return;
    const text = draft.trim();
    if (!text) return;
    setQueue((q) =>
      q.map((m) =>
        m.id === editing.id
          ? {
              ...m,
              question: text,
              // Keep the attached context block, swap the question above it.
              input: m.input === m.question ? text : m.input.replace(m.question, text),
              title: clampTitle(text),
            }
          : m,
      ),
    );
    cancelQueuedEdit();
  };
  // The edited message left the queue (it started, or was removed): keep a
  // dirty edit in the composer, otherwise restore the user's draft.
  useEffect(() => {
    if (!editing || queue.some((m) => m.id === editing.id)) return;
    const original = draft.trim();
    if (original && !editing.savedDraft.trim()) {
      setEditing(null);
      toast.info("Queued message is no longer queued", {
        description: "Your unsaved edit was kept in the composer.",
      });
    } else {
      cancelQueuedEdit();
    }
  }, [queue]);

  /** Resumes a session persisted on the provider (e.g. started in Hermes' WebUI) in the panel. */
  const openServerSession = (session: ChatSession) => {
    setHistoryOpen(false);
    const existing = conversations.find(
      (c) => c.sessionId === session.id && c.provider === providerKind,
    );
    if (existing) {
      switchTo(existing.id);
      return;
    }
    console.log("[AssistantChat:openServerSession]", {
      provider: providerKind,
      sessionId: session.id,
      source: session.source,
    });
    const convo: Conversation = {
      id: crypto.randomUUID(),
      title: clampTitle(session.title || session.preview || `${providerName} session`),
      turns: [],
      provider: providerKind,
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
      .assistantSessionMessages(providerKind, session.id)
      .then(
        (messages) => {
          const hydrated = turnsFromMessages(messages);
          patchConversation(convo.id, (c) =>
            c.turns.length > 0 ? c : { ...c, turns: hydrated, updatedAt: Date.now() },
          );
        },
        (error) =>
          console.log("[AssistantChat:hydrate] failed", {
            error: String(error),
          }),
      )
      .finally(() => setHydrating((cur) => (cur === convo.id ? null : cur)));
    inputRef.current?.focus();
  };

  const respondApproval = (approvalId: string, decision: ApprovalDecision) => {
    if (!streaming) return;
    const { provider: kind, requestId } = streaming;
    console.log("[AssistantChat:approval]", { kind, decision });
    setRespondingApproval(approvalId);
    gmailApi
      .assistantRespondApproval({
        provider: kind,
        requestId,
        approvalId,
        decision,
      })
      .then(
        () => setApprovals((list) => list.filter((a) => a.approval.id !== approvalId)),
        (error: unknown) =>
          console.log("[AssistantChat:approval] failed", {
            error: String(error),
          }),
      )
      .finally(() => setRespondingApproval(null));
  };

  /** Interrupts the active run; the queue stays and its next message starts (Otter Code). */
  const stop = () => {
    if (streaming) void gmailApi.assistantCancel(streaming.provider, streaming.requestId);
  };

  const activeQueue = queue.filter((m) => m.convoId === activeId);
  // Steer needs a running turn in this chat that isn't waiting on an approval.
  const canSteer = streaming?.convoId === activeId && approvals.length === 0;
  useCommandHandlers({
    "assistant.sendQueuedNow": () => {
      const next = activeQueue[0];
      if (!next || !canSteer) return false;
      steerQueued(next.id);
    },
    "assistant.editQueued": () => {
      const latest = activeQueue[activeQueue.length - 1];
      const caretAtStart = (inputRef.current?.selectionStart ?? 0) === 0;
      if (!latest || editing || !caretAtStart) return false;
      editQueued(latest.id);
    },
  });

  // A queued message starts once no turn is running (after completion, an
  // error, or Stop) — never at a tool boundary; that's what Steer is for.
  const nextQueued = queue[0];
  useEffect(() => {
    if (!nextQueued || streaming || editing?.id === nextQueued.id) return;
    setQueue((q) => q.slice(1));
    startTurn(nextQueued, "queued");
  }, [nextQueued, streaming, editing]);

  const newChat = () => {
    setHistoryOpen(false);
    // An already-empty active session just refocuses — no empty duplicates.
    if (active && active.turns.length === 0) {
      inputRef.current?.focus();
      return;
    }
    console.log("[AssistantChat:newChat]");
    const fresh = newConversation(selectedKind);
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
      void gmailApi.assistantCancel(streaming.provider, streaming.requestId);
      setStreaming(null);
    }
    // Sessions this app created go with the chat; ones opened from the provider only unlink.
    const target = conversations.find((c) => c.id === id);
    if (target?.sessionId && target.sessionOwned) {
      void gmailApi.assistantDeleteSession(target.provider, target.sessionId).catch(() => {});
    }
    setStore((s) => {
      const remaining = s.conversations.filter((c) => c.id !== id);
      if (s.activeId !== id) return { ...s, conversations: remaining };
      const nonEmpty = remaining.filter((c) => c.turns.length > 0);
      if (nonEmpty.length > 0) return { conversations: remaining, activeId: nonEmpty[0].id };
      const fresh = newConversation(selectedKind);
      return { conversations: [fresh, ...remaining], activeId: fresh.id };
    });
  };

  useCommandHandlers({ "assistant.newChat": () => newChat() });

  useKeybindingContext("assistantOpen", true);

  const updateSettings = (patch: AssistantSettingsPatch) => {
    console.log("[AssistantChat:updateSettings]", patch);
    gmailApi.updateAssistantSettings(patch).then(setProvidersState, () => {});
  };

  /** Where composer menus return focus when they close. */
  const focusComposer = () => inputRef.current?.focus();

  /** A model from the picker becomes the default for its provider (and new chats). */
  const pickModel = (kind: ProviderKind, slug: string) => {
    updateSettings({ selected: kind, [kind]: { model: slug } });
  };

  /** Setup fallback: switch new chats to another provider. */
  const pickProvider = (kind: ProviderKind) => updateSettings({ selected: kind });

  // Hermes' approval mode is server-side config; Codex / Claude pick it per turn.
  const runtimeMode =
    providerKind === "hermes" ? null : (providersState?.settings[providerKind].runtimeMode ?? null);
  const pendingApproval = approvals[0];

  // Reasoning / Service Tier of the model in use, with the saved choices.
  const currentModel = provider?.models.find((m) => m.slug === provider.model);
  const traitOptions = currentModel?.options ?? [];
  const traitSettings = providersState?.settings[providerKind];
  const traitValues = {
    reasoningEffort: traitSettings?.reasoningEffort ?? "",
    serviceTier: traitSettings?.serviceTier ?? "",
  };

  // An empty chat whose provider can't run yet shows setup instead of a composer.
  const needsSetup = Boolean(providersState) && !usable && turns.length === 0;
  const setupSummary = providerSummary(provider);
  const fallback = providersState?.providers.find(
    (p) => p.kind !== providerKind && isProviderUsable(p) && p.checkedAt !== null,
  );

  // An empty chat is a centered draft: headline + composer (T3's draft hero).
  const hero = turns.length === 0 && hydrating !== activeId;
  const heroHeadline = quote
    ? "What should we do with this excerpt?"
    : multiSelected
      ? `What should we do with these ${selectedRows.length} conversations?`
      : openMessage.data
        ? `What should we do with “${clampTitle(openMessage.data.subject || "this conversation")}”?`
        : "What should we do in your inbox?";

  // Send button (Otter Code's ComposerPrimaryActions): queue vs steer while a
  // turn runs; holding ⌘ flips it for one message.
  const hasDraft = Boolean(draft.trim() || activeSkill);
  const alternateAction = followUp === "queue" ? "steer" : "queue";
  const submitMode: "send" | "queue" | "steer" =
    streaming?.convoId === activeId ? (modHeld ? alternateAction : followUp) : "send";
  const submitLabel = editing
    ? "Update queued message"
    : submitMode === "queue"
      ? "Queue message"
      : submitMode === "steer"
        ? "Steer message"
        : "Send message";
  const submitTooltip =
    submitMode === "send" || editing
      ? submitLabel
      : `Click to ${followUp}, ⌘-click or ⌘↩ to ${alternateAction}`;

  // Only the active conversation drives the "working…" / stop UI.
  const streamingActive = streaming != null && streaming.convoId === activeId;
  const busy = streaming != null;

  return (
    <div className="relative flex h-full min-w-0 flex-col">
      {/* Header: chat actions on the left; the panel toggle stays at the
          window's top-right, exactly where it sits while the panel is closed. */}
      <div className="drag-region flex h-(--workspace-topbar-height) shrink-0 items-center gap-1 px-4">
        <HintTooltip label="Chat history" side="bottom">
          <IconBtn
            label="Chat history"
            active={historyOpen}
            onClick={() => setHistoryOpen((o) => !o)}
          >
            <HistoryIcon className="size-4" />
          </IconBtn>
        </HintTooltip>
        <HintTooltip label="New chat" shortcut="assistant.newChat" side="bottom">
          <IconBtn label="New chat" onClick={newChat}>
            <SquarePlusIcon className="size-4" />
          </IconBtn>
        </HintTooltip>
        <span className="min-w-0 flex-1" />
        <HintTooltip label="Hide assistant panel" shortcut="assistant.toggle" side="bottom">
          <IconBtn label="Toggle assistant panel" active onClick={onClose}>
            <PanelRightIcon className="size-4" />
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
          providerName={providerName}
        />
      ) : null}

      {needsSetup ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
          <ProviderIcon kind={providerKind} className="mb-1 size-6" />
          <span className="text-sm font-medium text-foreground">
            {providerName}: {setupSummary.headline}
          </span>
          {setupSummary.detail ? (
            <span className="text-sm text-muted-foreground">{setupSummary.detail}</span>
          ) : null}
          <div className="mt-1 flex items-center gap-2">
            <button
              type="button"
              onClick={() => void gmailApi.openSettings({ pane: "assistant" })}
              className={buttonClass("outline", "sm")}
            >
              Open Settings
            </button>
            {fallback ? (
              <button
                type="button"
                onClick={() => pickProvider(fallback.kind)}
                className={buttonClass("ghost", "sm")}
              >
                Use {fallback.displayName}
              </button>
            ) : null}
          </div>
        </div>
      ) : (
        <MessageScroller.Provider autoScroll defaultScrollPosition="end">
          <MessageScroller.Root className="relative min-h-0 flex-1">
            <MessageScroller.Viewport className="topbar-scroll-fade h-full overflow-y-auto px-3 pb-3 pt-(--workspace-titlebar-scroll-fade-height)">
              <MessageScroller.Content className="mx-auto flex w-full max-w-3xl flex-col gap-1">
                {turns.length === 0 && hydrating === activeId ? (
                  <div className="px-2 pt-6 text-center text-sm text-placeholder">
                    Loading this session from {providerName}…
                  </div>
                ) : null}
                {turns.map((turn) => {
                  if (turn.role === "user") {
                    return (
                      <MessageScroller.Item key={turn.id} messageId={turn.id} scrollAnchor>
                        <div className="group flex flex-col items-end gap-1 py-2">
                          {turn.intent ? <IntentMarker intent={turn.intent} /> : null}
                          {turn.context ? <ContextRecap context={turn.context} /> : null}
                          <div className="relative max-w-[80%] whitespace-pre-wrap rounded-2xl bg-message p-3 text-sm leading-relaxed text-message-foreground">
                            {turn.skill ? (
                              <span className="mb-1 mr-1.5 inline-flex align-middle">
                                <SkillBadge name={turn.skill} onAccent />
                              </span>
                            ) : null}
                            {turn.text}
                          </div>
                        </div>
                      </MessageScroller.Item>
                    );
                  }
                  const isLast = turn.id === turns[turns.length - 1]?.id;
                  const live = streamingActive && isLast && !turn.finishedAt && !turn.error;
                  const hasTools = turn.tools.length > 0;
                  const folded = hasTools && !live;
                  const showTools = hasTools && (live || expandedFolds.has(turn.id));
                  const foldLabel =
                    turn.startedAt && turn.finishedAt
                      ? `Worked for ${formatDuration(turn.finishedAt - turn.startedAt)}`
                      : `Ran ${turn.tools.length} tool${turn.tools.length === 1 ? "" : "s"}`;
                  return (
                    <MessageScroller.Item key={turn.id} messageId={turn.id} scrollAnchor>
                      <div className="flex flex-col">
                        {folded ? (
                          <WorkFoldRow
                            label={foldLabel}
                            expanded={expandedFolds.has(turn.id)}
                            onToggle={() => toggleFold(turn.id)}
                          />
                        ) : null}
                        {showTools ? (
                          <div className="flex flex-col py-1">
                            {turn.tools.map((t, i) => (
                              <ToolRow key={i} name={t.name} output={t.output} />
                            ))}
                          </div>
                        ) : null}
                        {turn.text ? (
                          <div className="min-w-0 px-1 py-1">
                            <ChatMarkdown text={turn.text} />
                          </div>
                        ) : null}
                        {live ? <WorkingRow startedAt={turn.startedAt} /> : null}
                        {turn.error ? (
                          <ErrorRow message={turn.error} providerName={providerName} />
                        ) : null}
                      </div>
                    </MessageScroller.Item>
                  );
                })}
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
                    className="surface-glass absolute bottom-3 left-1/2 flex size-7 -translate-x-1/2 items-center justify-center rounded-full border border-border/60 text-muted-foreground shadow-sm hover:border-border hover:text-foreground"
                  >
                    <ArrowDownIcon className="size-3.5" />
                  </button>
                ) : null
              }
            />
          </MessageScroller.Root>

          {/* Composer: glass card with the prompt on top and controls below. An
              empty chat centers it under a hero headline, like T3's draft hero. */}
          <div
            className={
              hero
                ? "pointer-events-none absolute inset-x-0 bottom-0 top-(--workspace-topbar-height) z-20 flex items-center px-3"
                : "relative shrink-0 px-3 pb-3 pt-1"
            }
          >
            <div className="pointer-events-auto relative mx-auto w-full max-w-3xl">
              {hero ? (
                <div className="absolute inset-x-0 bottom-full pb-6">
                  <h1 className="mx-auto w-full text-balance text-center text-xl font-normal tracking-tight text-foreground">
                    {heroHeadline}
                  </h1>
                </div>
              ) : null}
              {slashOpen ? (
                <div className="dropdown-glass absolute inset-x-0 bottom-full z-20 mb-1 max-h-64 overflow-y-auto rounded-lg p-1 shadow-[0_16px_40px_-18px_rgb(0_0_0/55%)] dark:shadow-[0_18px_44px_-18px_rgb(0_0_0/80%)]">
                  <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                    Skills
                  </div>
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
                      className={cn(
                        "flex w-full flex-col items-start rounded-md px-2 py-1.5 text-left",
                        i === slashIndex && "bg-accent-surface",
                      )}
                    >
                      <span className="text-xs font-semibold text-foreground">/{s.name}</span>
                      <span className="w-full truncate text-2xs text-muted-foreground">
                        {s.description}
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}
              <QueuedRunsControl
                items={activeQueue}
                editingId={editing?.id ?? null}
                canSteer={canSteer}
                onEdit={editQueued}
                onCancelEdit={cancelQueuedEdit}
                onSteer={steerQueued}
                onRemove={removeQueued}
                onMove={moveQueued}
              />
              {pendingApproval && streamingActive ? (
                <ApprovalBanner
                  approval={pendingApproval.approval}
                  pendingCount={approvals.length}
                  responding={respondingApproval === pendingApproval.approval.id}
                  onRespond={(decision) => respondApproval(pendingApproval.approval.id, decision)}
                  onCancel={stop}
                />
              ) : null}
              <div className="relative rounded-3xl border border-(--chat-composer-outline) bg-(--chat-composer-surface) shadow-composer transition-colors focus-within:border-input dark:shadow-none dark:inset-shadow-2xs dark:inset-shadow-(color:--chat-composer-highlight)">
                {activeSkill ? (
                  <div className="px-4 pt-3">
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
                    if (e.key === "Escape" && editing) {
                      e.preventDefault();
                      cancelQueuedEdit();
                      return;
                    }
                    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      send(e.metaKey || e.ctrlKey);
                    }
                  }}
                  placeholder="Ask anything, / for skills"
                  aria-label={`Message ${providerName}`}
                  rows={2}
                  className="w-full resize-none bg-transparent px-4 pb-1 pt-3.5 text-sm leading-relaxed text-foreground outline-none placeholder:text-placeholder"
                />
                <div className="flex min-w-0 items-center justify-between gap-2 px-3 pb-3">
                  <div className="-ms-1 flex min-w-0 flex-1 items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                    <ProviderModelPicker
                      providers={providersState?.providers ?? []}
                      activeKind={providerKind}
                      lockedKind={active && active.turns.length > 0 ? active.provider : null}
                      onPick={pickModel}
                      returnFocus={focusComposer}
                    />
                    {runtimeMode ? (
                      <>
                        <ComposerControlSeparator />
                        <RuntimeModePicker
                          returnFocus={focusComposer}
                          value={runtimeMode}
                          onChange={(mode) => {
                            updateSettings({
                              [providerKind]: { runtimeMode: mode },
                            });
                          }}
                        />
                      </>
                    ) : null}
                    {traitOptions.length > 0 ? (
                      <>
                        <ComposerControlSeparator />
                        <TraitsPicker
                          returnFocus={focusComposer}
                          options={traitOptions}
                          values={traitValues}
                          onChange={(id, value) => {
                            updateSettings({ [providerKind]: { [id]: value } });
                          }}
                        />
                      </>
                    ) : null}
                    {context ? (
                      <span className="mx-0.5 h-4 w-px shrink-0 bg-border" aria-hidden />
                    ) : null}
                    {context ? (
                      <button
                        type="button"
                        aria-pressed={attach}
                        onClick={() => setAttach((a) => !a)}
                        title={attach ? "Attached to this message" : "Not attached"}
                        className={cn(
                          "relative inline-flex h-6 shrink-0 cursor-pointer items-center gap-1 whitespace-nowrap rounded-[var(--control-radius)] border border-transparent px-1.75 text-xs outline-none transition-colors hover:bg-accent-surface focus-visible:ring-2 focus-visible:ring-focus-ring [&_svg]:shrink-0",
                          attach
                            ? "bg-accent-surface text-foreground"
                            : "text-muted-foreground/70 line-through hover:text-foreground/80",
                        )}
                      >
                        <ContextKindIcon kind={attachKind} className="size-3.5" />
                        <span className="max-w-48 truncate">
                          {quote
                            ? `“${quote.text}”`
                            : context.conversations.length > 1
                              ? `${context.conversations.length} conversations`
                              : context.conversations[0].subject}
                        </span>
                      </button>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {/* Running + empty composer → Stop; with a draft the button
                        queues or steers it (Otter Code's primary actions). */}
                    {busy && !hasDraft && !editing ? (
                      <HintTooltip label="Interrupt">
                        <button
                          type="button"
                          onClick={stop}
                          aria-label="Stop generation"
                          className="flex size-8 cursor-pointer items-center justify-center rounded-full bg-destructive/90 text-white shadow-xs shadow-destructive/24 inset-shadow-2xs inset-shadow-white/16 transition-all duration-150 hover:scale-105 hover:bg-destructive active:shadow-none active:inset-shadow-black/8"
                        >
                          <svg
                            width="12"
                            height="12"
                            viewBox="0 0 12 12"
                            fill="currentColor"
                            aria-hidden
                          >
                            <rect x="2" y="2" width="8" height="8" rx="1.5" />
                          </svg>
                        </button>
                      </HintTooltip>
                    ) : (
                      <HintTooltip label={submitTooltip}>
                        <button
                          type="button"
                          onClick={(e) => send(e.metaKey || e.ctrlKey)}
                          disabled={!hasDraft}
                          aria-label={submitLabel}
                          className="relative isolate flex size-8 items-center justify-center overflow-hidden rounded-full bg-primary text-primary-foreground shadow-xs transition-all duration-150 enabled:cursor-pointer enabled:shadow-primary/24 enabled:inset-shadow-2xs enabled:inset-shadow-white/16 hover:scale-105 hover:bg-primary/90 active:shadow-none active:inset-shadow-black/8 disabled:pointer-events-none disabled:opacity-30 disabled:shadow-none"
                        >
                          {editing ? (
                            <CheckIcon className="size-4" aria-hidden />
                          ) : submitMode === "queue" ? (
                            <ListPlusIcon className="size-4" aria-hidden />
                          ) : submitMode === "steer" ? (
                            <CornerUpRightIcon className="size-4" aria-hidden />
                          ) : (
                            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                              <path
                                d="M7 11.5V2.5M7 2.5L3 6.5M7 2.5L11 6.5"
                                stroke="currentColor"
                                strokeWidth="1.8"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
                          )}
                        </button>
                      </HintTooltip>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </MessageScroller.Provider>
      )}
    </div>
  );
}
