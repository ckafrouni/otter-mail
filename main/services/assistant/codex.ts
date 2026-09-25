/**
 * OpenAI Codex through `codex app-server`, following T3 Code's Codex driver:
 *  - health probe: a short-lived app-server → initialize, account/read,
 *    model/list; a spawn failure means "not installed".
 *  - one app-server per chat session, started with thread/start (or
 *    thread/resume for a saved Codex thread id), then turn/start per message.
 *  - raw notifications map onto the canonical ChatEvent stream.
 * Threads run in the app's assistant workspace, so listing that cwd yields
 * exactly the chats started from Otter Mail.
 */

import { logger } from "@glaze/core/backend";
import { CodexAppServer, CodexSpawnError, type Notification, type ServerRequest } from "./codex-app-server.js";
import { assistantWorkspace } from "./settings.js";
import type {
  ChatProvider,
  ChatSession,
  ChatSessionMessage,
  CodexSettings,
  Emit,
  ProviderModel,
  ProviderModelOption,
  ProviderSettings,
  SendTurnInput,
  Skill,
} from "./types.js";

const PROBE_TIMEOUT_MS = 10_000;
const REQUEST_TIMEOUT_MS = 30_000;
/** Idle chat sessions release their app-server after this long. */
const SESSION_IDLE_MS = 15 * 60_000;
/** The utility server (history, skills) goes away sooner. */
const UTILITY_IDLE_MS = 60_000;
const TOOL_OUTPUT_PREVIEW_CHARS = 400;

const DEVELOPER_INSTRUCTIONS = [
  "You are the assistant built into Otter Mail, a Gmail client.",
  "Messages may end with a '— context from Otter Mail —' block that points at Gmail conversations by account and threadId; fetch their content with the `gog` CLI when you need it.",
  "Never send an email, or take any other irreversible action on the user's mailboxes, unless the user explicitly asks for it in this conversation.",
].join("\n");

/** T3's runtime modes → Codex thread config. */
function threadConfig(settings: CodexSettings) {
  return settings.runtimeMode === "read-only"
    ? { approvalPolicy: "never", sandbox: "read-only" }
    : { approvalPolicy: "never", sandbox: "danger-full-access" };
}

function planLabel(plan: string | null | undefined): string {
  if (!plan || plan === "unknown") return "ChatGPT";
  return `ChatGPT ${plan.charAt(0).toUpperCase()}${plan.slice(1).replace(/_/g, " ")}`;
}

// ---------------------------------------------------------------------------
// Thread items → tool rows
// ---------------------------------------------------------------------------

type Item = { type?: string; id?: string } & Record<string, unknown>;

/** The shell wrapper Codex reports (`/bin/zsh -lc 'echo hi'`) → `echo hi`. */
function commandLabel(item: Item): string {
  const actions = item.commandActions as { command?: string }[] | undefined;
  const command = actions?.[0]?.command ?? String(item.command ?? "command");
  return command.replace(/^\/bin\/\w+ -l?c '(.*)'$/s, "$1");
}

/** Tool-like items (not user/agent text or reasoning) → the row label, else null. */
function toolName(item: Item): string | null {
  switch (item.type) {
    case "commandExecution":
      return commandLabel(item);
    case "mcpToolCall":
      return `${String(item.server)}: ${String(item.tool)}`;
    case "dynamicToolCall":
      return String(item.tool ?? "tool");
    case "webSearch":
      return item.query ? `Web search: ${String(item.query)}` : "Web search";
    case "fileChange":
      return "Edit files";
    case "imageView":
      return "View image";
    default:
      return null;
  }
}

function toolOutput(item: Item): string {
  let text = "";
  if (item.type === "commandExecution") text = String(item.aggregatedOutput ?? "");
  else if (item.type === "mcpToolCall") {
    const error = item.error as { message?: string } | null;
    const result = item.result as { content?: { text?: string }[] } | null;
    text = error?.message ?? (result?.content ?? []).map((c) => c?.text ?? "").join("\n");
  } else if (item.type === "dynamicToolCall") {
    const content = item.contentItems as { text?: string }[] | null;
    text = (content ?? []).map((c) => c?.text ?? "").join("\n");
  } else if (item.type === "fileChange") {
    const changes = item.changes as { path?: string }[] | undefined;
    text = (changes ?? []).map((c) => c.path).join("\n");
  }
  return text.slice(0, TOOL_OUTPUT_PREVIEW_CHARS) || "(done)";
}

function userText(item: Item): string {
  const content = item.content as { type?: string; text?: string }[] | undefined;
  return (content ?? [])
    .filter((c) => c.type === "text")
    .map((c) => c.text ?? "")
    .join("\n");
}

// ---------------------------------------------------------------------------
// Sessions (one app-server each)
// ---------------------------------------------------------------------------

type ActiveTurn = {
  requestId: string;
  emit: Emit;
  turnId: string | null;
  cancelRequested: boolean;
  streamedText: boolean;
  /** Last non-retried error, reported if the turn then fails. */
  error: string | null;
  finish: () => void;
};

type Session = {
  server: CodexAppServer;
  threadId: string;
  turn: ActiveTurn | null;
  idleTimer: ReturnType<typeof setTimeout> | null;
};

const sessions = new Map<string, Session>();

function stopSession(session: Session): void {
  if (session.idleTimer) clearTimeout(session.idleTimer);
  sessions.delete(session.threadId);
  session.server.kill();
}

function armIdle(session: Session): void {
  if (session.idleTimer) clearTimeout(session.idleTimer);
  session.idleTimer = setTimeout(() => {
    if (!session.turn) stopSession(session);
  }, SESSION_IDLE_MS);
}

/** Everything but approvals is answered empty; approvals are declined (full access never asks). */
function answerServerRequest(server: CodexAppServer, request: ServerRequest): void {
  logger.info("assistant", "codex server request declined", { method: request.method });
  if (request.method.endsWith("/requestApproval") || request.method.endsWith("Approval")) {
    server.respond(request.id, { decision: "decline" });
  } else if (request.method === "item/tool/requestUserInput") {
    server.respond(request.id, { answers: {} });
  } else if (request.method === "mcpServer/elicitation/request") {
    server.respond(request.id, { action: "decline" });
  } else {
    server.respond(request.id, {});
  }
}

function handleNotification(session: Session, { method, params }: Notification): void {
  const turn = session.turn;
  if (!turn || (params.threadId && params.threadId !== session.threadId)) return;
  const { requestId, emit } = turn;
  switch (method) {
    case "turn/started": {
      const id = (params.turn as { id?: string } | undefined)?.id ?? null;
      turn.turnId ??= id;
      break;
    }
    case "item/agentMessage/delta": {
      const delta = String(params.delta ?? "");
      if (!delta) break;
      turn.streamedText = true;
      emit({ requestId, type: "delta", text: delta });
      break;
    }
    case "item/started": {
      const item = params.item as Item;
      // A new message after tool calls: keep paragraphs apart.
      if (item.type === "agentMessage" && turn.streamedText)
        emit({ requestId, type: "delta", text: "\n\n" });
      const name = toolName(item);
      if (name) emit({ requestId, type: "tool", name });
      break;
    }
    case "item/completed": {
      const item = params.item as Item;
      if (toolName(item)) emit({ requestId, type: "toolResult", output: toolOutput(item) });
      else if (item.type === "agentMessage" && !turn.streamedText && item.text) {
        turn.streamedText = true;
        emit({ requestId, type: "delta", text: String(item.text) });
      }
      break;
    }
    case "error": {
      if (params.willRetry) break;
      turn.error = (params.error as { message?: string } | undefined)?.message ?? "agent_error";
      break;
    }
    case "turn/completed": {
      const done = params.turn as { id?: string; status?: string; error?: { message?: string } };
      if (turn.turnId && done.id && done.id !== turn.turnId) break;
      if (done.status === "completed") emit({ requestId, type: "done", responseId: null });
      else if (done.status === "interrupted") emit({ requestId, type: "error", message: "cancelled" });
      else {
        const message = done.error?.message ?? turn.error;
        emit({ requestId, type: "error", message: message ? `agent_error: ${message}` : "agent_error" });
      }
      turn.finish();
      break;
    }
    default:
      break;
  }
}

/** Resume errors that mean "no such thread" (then start a fresh one). */
function isMissingThread(error: unknown): boolean {
  const message = String(error instanceof Error ? error.message : error).toLowerCase();
  return (
    message.includes("thread") &&
    ["not found", "missing thread", "no such thread", "unknown thread", "does not exist", "no rollout found"].some(
      (needle) => message.includes(needle),
    )
  );
}

async function openSession(
  settings: CodexSettings,
  sessionId: string | undefined,
): Promise<Session> {
  const existing = sessionId ? sessions.get(sessionId) : undefined;
  if (existing?.server.alive) return existing;

  const cwd = await assistantWorkspace();
  const server = await CodexAppServer.start(settings, cwd);
  const params = {
    cwd,
    ...threadConfig(settings),
    ...(settings.model ? { model: settings.model } : {}),
    developerInstructions: DEVELOPER_INSTRUCTIONS,
  };
  let threadId: string;
  try {
    const opened = sessionId
      ? await server
          .request<{ thread: { id: string } }>(
            "thread/resume",
            { threadId: sessionId, ...params, excludeTurns: true },
            REQUEST_TIMEOUT_MS,
          )
          .catch((error: unknown) => {
            if (!isMissingThread(error)) throw error;
            logger.info("assistant", "codex thread gone, starting fresh", { sessionId });
            return server.request<{ thread: { id: string } }>("thread/start", params, REQUEST_TIMEOUT_MS);
          })
      : await server.request<{ thread: { id: string } }>("thread/start", params, REQUEST_TIMEOUT_MS);
    threadId = opened.thread.id;
  } catch (error) {
    server.kill();
    throw error;
  }

  const session: Session = { server, threadId, turn: null, idleTimer: null };
  server.onNotification = (message) => handleNotification(session, message);
  server.onServerRequest = (request) => answerServerRequest(server, request);
  server.onExit = (code) => {
    sessions.delete(threadId);
    const turn = session.turn;
    if (turn) {
      logger.info("assistant", "codex exited mid-turn", { code });
      turn.emit({ requestId: turn.requestId, type: "error", message: "unreachable" });
      turn.finish();
    }
  };
  sessions.set(threadId, session);
  return session;
}

// ---------------------------------------------------------------------------
// Utility server (probe, history, skills)
// ---------------------------------------------------------------------------

let utility: { server: Promise<CodexAppServer>; timer: ReturnType<typeof setTimeout> | null } | null =
  null;

async function withUtility<T>(settings: CodexSettings, fn: (server: CodexAppServer) => Promise<T>): Promise<T> {
  if (!utility) {
    const server = assistantWorkspace().then((cwd) => CodexAppServer.start(settings, cwd));
    utility = { server, timer: null };
    server.catch(() => {
      utility = null;
    });
  }
  const current = utility;
  if (current.timer) clearTimeout(current.timer);
  const server = await current.server;
  if (!server.alive) {
    utility = null;
    return withUtility(settings, fn);
  }
  try {
    return await fn(server);
  } finally {
    current.timer = setTimeout(() => {
      server.kill();
      if (utility === current) utility = null;
    }, UTILITY_IDLE_MS);
  }
}

const REASONING_EFFORT_LABELS: Record<string, string> = {
  none: "None",
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra High",
  max: "Max",
  ultra: "Ultra",
};

/** Standard speed; what an unset service tier means. */
export const DEFAULT_SERVICE_TIER = "default";

type RawModel = {
  model: string;
  displayName?: string;
  isDefault?: boolean;
  hidden?: boolean;
  supportedReasoningEfforts?: { reasoningEffort: string; description?: string }[];
  defaultReasoningEffort?: string;
  serviceTiers?: { id: string; name: string; description?: string }[];
  additionalSpeedTiers?: string[];
  defaultServiceTier?: string | null;
};

/** Reasoning + Service Tier options, as T3's mapCodexModelCapabilities builds them. */
function modelOptions(m: RawModel): ProviderModelOption[] {
  const options: ProviderModelOption[] = [];
  const efforts = m.supportedReasoningEfforts ?? [];
  if (efforts.length > 0) {
    options.push({
      id: "reasoningEffort",
      label: "Reasoning",
      choices: efforts.map(({ reasoningEffort }) => ({
        id: reasoningEffort,
        label: REASONING_EFFORT_LABELS[reasoningEffort] ?? reasoningEffort,
        ...(reasoningEffort === m.defaultReasoningEffort ? { isDefault: true } : {}),
      })),
    });
  }
  const tiers =
    m.serviceTiers && m.serviceTiers.length > 0
      ? m.serviceTiers
      : (m.additionalSpeedTiers ?? []).map((id) => ({
          id,
          name: id === "fast" ? "Fast" : id,
          description: "",
        }));
  if (tiers.length > 0) {
    const defaultTier = tiers.some((t) => t.id === m.defaultServiceTier)
      ? m.defaultServiceTier
      : DEFAULT_SERVICE_TIER;
    options.push({
      id: "serviceTier",
      label: "Service Tier",
      choices: [
        {
          id: DEFAULT_SERVICE_TIER,
          label: "Standard",
          ...(defaultTier === DEFAULT_SERVICE_TIER ? { isDefault: true } : {}),
        },
        ...tiers.map((t) => ({
          id: t.id,
          label: t.name,
          ...(t.description ? { description: t.description } : {}),
          ...(defaultTier === t.id ? { isDefault: true } : {}),
        })),
      ],
    });
  }
  return options;
}

/** Last catalog from the health probe; turns resolve effort/tier defaults against it. */
let knownModels: ProviderModel[] = [];

async function listModels(server: CodexAppServer): Promise<ProviderModel[]> {
  const models: ProviderModel[] = [];
  let cursor: string | null = null;
  do {
    const page: { data: RawModel[]; nextCursor: string | null } = await server.request(
      "model/list",
      cursor ? { cursor } : {},
      PROBE_TIMEOUT_MS,
    );
    for (const m of page.data) {
      if (m.hidden) continue;
      models.push({
        slug: m.model,
        name: m.displayName || m.model,
        ...(m.isDefault ? { isDefault: true } : {}),
        options: modelOptions(m),
      });
    }
    cursor = page.nextCursor;
  } while (cursor);
  knownModels = models;
  return models;
}

/**
 * Effort + tier for a turn. Both persist on the thread once sent, so the
 * effort is always explicit (the model's default when unset); the tier only
 * applies to this turn and is omitted for standard speed.
 */
function turnOptions(codex: CodexSettings, models: ProviderModel[]): Record<string, string> {
  const model =
    models.find((m) => m.slug === codex.model) ?? models.find((m) => m.isDefault) ?? models[0];
  const choices = (id: ProviderModelOption["id"]) =>
    model?.options?.find((o) => o.id === id)?.choices ?? [];
  const efforts = choices("reasoningEffort");
  const effort =
    efforts.find((c) => c.id === codex.reasoningEffort)?.id ?? efforts.find((c) => c.isDefault)?.id;
  const tier = choices("serviceTier").find((c) => c.id === codex.serviceTier)?.id;
  return {
    ...(effort ? { effort } : {}),
    ...(tier && tier !== DEFAULT_SERVICE_TIER ? { serviceTierForTurn: tier } : {}),
  };
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

const turnsByRequest = new Map<string, Session>();

export const codexProvider: ChatProvider = {
  kind: "codex",
  displayName: "Codex",

  async checkStatus(settings) {
    const base = {
      kind: "codex" as const,
      displayName: "Codex",
      models: [] as ProviderModel[],
      model: settings.codex.model || null,
      sessions: true,
    };
    let server: CodexAppServer | null = null;
    try {
      return await withTimeout(
        (async () => {
          server = await CodexAppServer.start(settings.codex, await assistantWorkspace());
          const account = await server.request<{
            account: { type: string; email?: string | null; planType?: string } | null;
            requiresOpenaiAuth: boolean;
          }>("account/read", {}, PROBE_TIMEOUT_MS);
          const version = server.version;
          if (!account.account && account.requiresOpenaiAuth) {
            return {
              ...base,
              installed: true,
              version,
              status: "error" as const,
              auth: { status: "unauthenticated" as const },
              message: "Codex CLI is not authenticated. Run `codex login` and try again.",
            };
          }
          const models = await listModels(server);
          const acct = account.account;
          const fallbackModel = models.find((m) => m.isDefault)?.slug ?? models[0]?.slug ?? null;
          return {
            ...base,
            installed: true,
            version,
            status: "ready" as const,
            models,
            model: settings.codex.model || fallbackModel,
            auth: acct
              ? {
                  status: "authenticated" as const,
                  label: acct.type === "chatgpt" ? planLabel(acct.planType) : acct.type === "apiKey" ? "API key" : acct.type,
                  ...(acct.email ? { email: acct.email } : {}),
                }
              : { status: "unknown" as const },
          };
        })(),
        PROBE_TIMEOUT_MS,
        "Timed out while checking Codex.",
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const missing = error instanceof CodexSpawnError;
      return {
        ...base,
        installed: !missing,
        version: null,
        status: "error",
        auth: { status: "unknown" },
        message: missing
          ? `${message}. Install it with \`npm i -g @openai/codex\` or set the binary path.`
          : `Codex app-server probe failed: ${message}`,
      };
    } finally {
      (server as CodexAppServer | null)?.kill();
    }
  },

  async sendTurn(turn: SendTurnInput, settings: ProviderSettings, emit: Emit) {
    const { requestId } = turn;
    let session: Session;
    try {
      session = await openSession(settings.codex, turn.sessionId);
    } catch (error) {
      logger.info("assistant", "codex session failed", { error: String(error) });
      const message = error instanceof CodexSpawnError ? "not_installed" : `agent_error: ${String(error instanceof Error ? error.message : error)}`;
      return emit({ requestId, type: "error", message });
    }
    if (session.threadId !== turn.sessionId) emit({ requestId, type: "session", sessionId: session.threadId });
    if (session.idleTimer) clearTimeout(session.idleTimer);

    const finished = new Promise<void>((resolve) => {
      session.turn = {
        requestId,
        emit,
        turnId: null,
        cancelRequested: false,
        streamedText: false,
        error: null,
        finish: resolve,
      };
    });
    turnsByRequest.set(requestId, session);
    const input: unknown[] = [];
    if (turn.skill?.path) input.push({ type: "skill", name: turn.skill.name, path: turn.skill.path });
    input.push({ type: "text", text: turn.input || `Use the ${turn.skill?.name ?? ""} skill.`, text_elements: [] });
    try {
      const started = await session.server.request<{ turn: { id: string } }>(
        "turn/start",
        {
          threadId: session.threadId,
          input,
          ...(settings.codex.model ? { model: settings.codex.model } : {}),
          ...turnOptions(settings.codex, knownModels),
        },
        REQUEST_TIMEOUT_MS,
      );
      const active = session.turn as ActiveTurn | null;
      if (active?.requestId === requestId) {
        active.turnId ??= started.turn.id;
        if (active.cancelRequested) codexProvider.cancel(requestId);
      }
      await finished;
    } catch (error) {
      emit({ requestId, type: "error", message: `agent_error: ${String(error instanceof Error ? error.message : error)}` });
    } finally {
      turnsByRequest.delete(requestId);
      if (session.turn?.requestId === requestId) session.turn = null;
      armIdle(session);
    }
  },

  cancel(requestId) {
    const session = turnsByRequest.get(requestId);
    const turn = session?.turn;
    if (!session || !turn || turn.requestId !== requestId) return;
    if (!turn.turnId) {
      turn.cancelRequested = true;
      return;
    }
    void session.server
      .request("turn/interrupt", { threadId: session.threadId, turnId: turn.turnId }, REQUEST_TIMEOUT_MS)
      .catch((error: unknown) => {
        logger.info("assistant", "codex interrupt failed", { error: String(error) });
        session.server.kill();
      });
  },

  async listSkills(settings): Promise<Skill[]> {
    try {
      const cwd = await assistantWorkspace();
      const response = await withUtility(settings.codex, (server) =>
        server.request<{
          data: { skills: { name: string; description: string; shortDescription?: string; path: string; enabled: boolean }[] }[];
        }>("skills/list", { cwds: [cwd] }, PROBE_TIMEOUT_MS),
      );
      const seen = new Set<string>();
      return response.data
        .flatMap((entry) => entry.skills)
        .filter((s) => s.enabled && !seen.has(s.name) && seen.add(s.name))
        .map((s) => ({ name: s.name, description: s.shortDescription || s.description, category: null, path: s.path }));
    } catch (error) {
      logger.info("assistant", "codex skills failed", { error: String(error) });
      return [];
    }
  },

  async listSessions(settings, limit): Promise<ChatSession[]> {
    const cwd = await assistantWorkspace();
    const response = await withUtility(settings.codex, (server) =>
      server.request<{
        data: { id: string; name?: string | null; preview?: string; updatedAt?: number; source?: string }[];
      }>("thread/list", { cwd, limit, sortKey: "updated_at", useStateDbOnly: true }, PROBE_TIMEOUT_MS),
    );
    return response.data.map((t) => ({
      id: t.id,
      title: t.name ?? null,
      source: "codex",
      lastActive: (t.updatedAt ?? 0) * 1000,
      messageCount: t.preview ? 1 : 0,
      preview: t.preview ?? null,
    }));
  },

  async readSession(settings, sessionId): Promise<ChatSessionMessage[]> {
    const response = await withUtility(settings.codex, (server) =>
      server.request<{ data: { items: Item[] }[] }>(
        "thread/turns/list",
        { threadId: sessionId, itemsView: "full", sortDirection: "asc", limit: 100 },
        PROBE_TIMEOUT_MS,
      ),
    );
    const messages: ChatSessionMessage[] = [];
    for (const turn of response.data) {
      for (const item of turn.items) {
        const name = toolName(item);
        if (item.type === "userMessage") messages.push({ role: "user", text: userText(item) });
        else if (item.type === "agentMessage") messages.push({ role: "assistant", text: String(item.text ?? "") });
        else if (name) {
          messages.push({ role: "assistant", text: "", toolCalls: [name] });
          messages.push({ role: "tool", text: toolOutput(item) });
        }
      }
    }
    return messages;
  },

  /** Archived, not destroyed: it stays recoverable from the Codex CLI. */
  async deleteSession(settings, sessionId) {
    const live = sessions.get(sessionId);
    if (live) stopSession(live);
    await withUtility(settings.codex, (server) =>
      server.request("thread/archive", { threadId: sessionId }, PROBE_TIMEOUT_MS),
    );
  },

  shutdown() {
    for (const session of [...sessions.values()]) stopSession(session);
    const current = utility;
    utility = null;
    if (current) {
      if (current.timer) clearTimeout(current.timer);
      void current.server.then((server) => server.kill(), () => {});
    }
  },
};
