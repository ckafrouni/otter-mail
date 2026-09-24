/**
 * Hermes chat over its built-in API server (https://<host>:8642, Bearer
 * API_SERVER_KEY). The key is full agent control: it lives safeStorage-encrypted
 * (userData/assistant-chat.enc), never reaches the renderer, and is never
 * logged. Requests stream SSE; events are relayed to the windows via
 * ipcMain.broadcast("assistant:chatEvent", …).
 *
 * Two transports, one event contract:
 *  - Native Sessions API (preferred): /api/sessions/{id}/chat/stream. Each
 *    conversation maps to a persistent server-side session; history lives on
 *    the server and survives app + gateway restarts.
 *  - Responses API (legacy chats): /v1/responses with previous_response_id,
 *    kept so conversations started before the migration keep their thread.
 */

import fs from "fs/promises";
import path from "path";
import { app, ipcMain, logger, safeStorage } from "@glaze/core/backend";

export type ChatStatus = {
  configured: boolean;
  baseUrl: string | null;
  model: string | null;
  /** The server exposes the native Sessions API (/api/sessions). */
  sessions: boolean;
};

export type ChatEvent =
  | { requestId: string; type: "delta"; text: string }
  | { requestId: string; type: "tool"; name: string }
  | { requestId: string; type: "toolResult"; output: string }
  | { requestId: string; type: "done"; responseId: string | null }
  | { requestId: string; type: "error"; message: string };

/** Client-safe view of a persisted Hermes session. */
export type ChatSession = {
  id: string;
  title: string | null;
  source: string;
  /** Epoch ms. */
  lastActive: number;
  messageCount: number;
  preview: string | null;
};

/** One transcript row of a session, flattened for the panel. */
export type ChatSessionMessage = {
  role: "user" | "assistant" | "tool" | "system";
  text: string;
  toolName?: string;
  toolCalls?: string[];
};

type ChatConfig = { baseUrl: string; model: string; sessions?: boolean };

const IDLE_TIMEOUT_MS = 180_000;
const TOOL_OUTPUT_PREVIEW_CHARS = 400;

async function keyPath(): Promise<string> {
  const dir = app.getPath("userData");
  await fs.mkdir(dir, { recursive: true });
  return path.join(dir, "assistant-chat.enc");
}

async function configPath(): Promise<string> {
  const dir = app.getPath("userData");
  await fs.mkdir(dir, { recursive: true });
  return path.join(dir, "assistant-chat.json");
}

async function getKey(): Promise<string> {
  try {
    const hex = await fs.readFile(await keyPath(), "utf-8");
    return await safeStorage.decryptString(Buffer.from(hex.trim(), "hex"));
  } catch {
    return "";
  }
}

async function getChatConfig(): Promise<ChatConfig | null> {
  try {
    const parsed = JSON.parse(await fs.readFile(await configPath(), "utf-8")) as ChatConfig;
    return parsed.baseUrl
      ? {
          baseUrl: parsed.baseUrl,
          model: parsed.model || "hermes-agent",
          sessions: typeof parsed.sessions === "boolean" ? parsed.sessions : undefined,
        }
      : null;
  } catch {
    return null;
  }
}

async function saveChatConfig(config: ChatConfig): Promise<void> {
  await fs.writeFile(await configPath(), JSON.stringify(config, null, 2), "utf-8");
}

/** `https://host:8642/v1` → OpenAI-compatible base; the Sessions API hangs off the root. */
function normalizeBaseUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, "");
  return /\/v1$/i.test(trimmed) ? trimmed : `${trimmed}/v1`;
}

function apiRoot(baseUrl: string): string {
  return baseUrl.replace(/\/v1$/i, "");
}

function authHeaders(key: string, json = false): Record<string, string> {
  return {
    Authorization: `Bearer ${key}`,
    ...(json ? { "Content-Type": "application/json" } : {}),
  };
}

/** GET /api/sessions?limit=1 — 200 means the native Sessions API is served. */
async function probeSessions(baseUrl: string, key: string): Promise<boolean> {
  try {
    const response = await fetch(`${apiRoot(baseUrl)}/api/sessions?limit=1`, {
      headers: authHeaders(key),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function chatStatus(): Promise<ChatStatus> {
  const config = await getChatConfig();
  const key = await getKey();
  const configured = config != null && key.length > 0;
  // Installs configured before the Sessions migration have no `sessions` flag:
  // probe once and remember, so the panel switches transports without a reconnect.
  let sessions = config?.sessions ?? false;
  if (configured && config && config.sessions === undefined) {
    sessions = await probeSessions(config.baseUrl, key);
    await saveChatConfig({ ...config, sessions });
    logger.info("assistant-chat", "sessions probe", { sessions });
  }
  return {
    configured,
    baseUrl: config?.baseUrl ?? null,
    model: config?.model ?? null,
    sessions: configured && sessions,
  };
}

/** Validates against /v1/models (auth check) before persisting. */
export async function chatConfigure(baseUrl: string, apiKey: string): Promise<ChatStatus> {
  const base = normalizeBaseUrl(baseUrl);
  const response = await fetch(`${base}/models`, { headers: authHeaders(apiKey) });
  if (response.status === 401) throw new Error("The API key was rejected (401).");
  if (!response.ok)
    throw new Error(`The server answered ${response.status} — is that the API server URL?`);
  const data = (await response.json()) as { data?: { id?: string }[] };
  const model = data.data?.[0]?.id || "hermes-agent";
  const sessions = await probeSessions(base, apiKey);

  const encrypted = await safeStorage.encryptString(apiKey);
  await fs.writeFile(await keyPath(), encrypted.toString("hex"), "utf-8");
  await saveChatConfig({ baseUrl: base, model, sessions });
  skillsCache = null;
  logger.info("assistant-chat", "configured", { baseUrl: base, model, sessions });
  return { configured: true, baseUrl: base, model, sessions };
}

export type Skill = { name: string; description: string; category: string | null };

let skillsCache: { at: number; data: Skill[] } | null = null;

/** Lists the agent's installed skills for the composer's "/" picker (5-min cache). */
export async function listSkills(): Promise<Skill[]> {
  const config = await getChatConfig();
  const key = await getKey();
  if (!config || !key) return [];
  if (skillsCache && Date.now() - skillsCache.at < 300_000) return skillsCache.data;
  try {
    const response = await fetch(`${config.baseUrl}/skills`, { headers: authHeaders(key) });
    if (!response.ok) return skillsCache?.data ?? [];
    const body = (await response.json()) as { data?: Skill[] } | Skill[];
    const raw = Array.isArray(body) ? body : (body.data ?? []);
    const skills = raw.map((s) => ({
      name: String(s.name ?? ""),
      description: String(s.description ?? ""),
      category: s.category ?? null,
    }));
    skillsCache = { at: Date.now(), data: skills };
    return skills;
  } catch {
    return skillsCache?.data ?? [];
  }
}

// ---------------------------------------------------------------------------
// Sessions API
// ---------------------------------------------------------------------------

type Ready = { config: ChatConfig; key: string; root: string };

async function requireReady(): Promise<Ready> {
  const config = await getChatConfig();
  const key = await getKey();
  if (!config || !key) throw new Error("Hermes chat isn't configured.");
  return { config, key, root: apiRoot(config.baseUrl) };
}

async function readError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { message?: string; code?: string } };
    return body.error?.message ?? `HTTP ${response.status}`;
  } catch {
    return `HTTP ${response.status}`;
  }
}

type RawSession = {
  id?: string;
  title?: string | null;
  source?: string;
  last_active?: number | string | null;
  started_at?: number | string | null;
  message_count?: number | null;
  preview?: string | null;
};

function toMillis(value: number | string | null | undefined): number {
  if (value == null) return 0;
  const n = typeof value === "number" ? value : Date.parse(value) || Number(value);
  if (!Number.isFinite(n)) return 0;
  // The gateway stores epoch seconds (float); ISO strings already parse to ms.
  return n < 1e12 ? Math.round(n * 1000) : Math.round(n);
}

function toSession(raw: RawSession): ChatSession {
  return {
    id: String(raw.id ?? ""),
    title: raw.title ? String(raw.title) : null,
    source: String(raw.source ?? "api_server"),
    lastActive: toMillis(raw.last_active) || toMillis(raw.started_at),
    messageCount: Number(raw.message_count ?? 0) || 0,
    preview: raw.preview ? String(raw.preview) : null,
  };
}

/** POST /api/sessions — an empty session the panel then streams turns into. */
export async function sessionCreate(params: { title?: string }): Promise<ChatSession> {
  const { key, root } = await requireReady();
  const attempt = async (title: string | undefined): Promise<Response> =>
    fetch(`${root}/api/sessions`, {
      method: "POST",
      headers: authHeaders(key, true),
      body: JSON.stringify({ source: "api_server", ...(title ? { title } : {}) }),
    });
  let response = await attempt(params.title?.trim() || undefined);
  // Titles are unique server-side; a clash must not block a new chat.
  if (response.status === 400 && params.title) response = await attempt(undefined);
  if (!response.ok) {
    const message = await readError(response);
    logger.info("assistant-chat", "session create failed", { status: response.status, message });
    throw new Error(message);
  }
  const body = (await response.json()) as { session?: RawSession };
  const session = toSession(body.session ?? {});
  if (!session.id) throw new Error("The server returned no session id.");
  logger.info("assistant-chat", "session created", { sessionId: session.id });
  return session;
}

/** DELETE /api/sessions/{id}; a missing session counts as deleted. */
export async function sessionDelete(sessionId: string): Promise<{ ok: boolean }> {
  const { key, root } = await requireReady();
  const response = await fetch(`${root}/api/sessions/${encodeURIComponent(sessionId)}`, {
    method: "DELETE",
    headers: authHeaders(key),
  });
  const ok = response.ok || response.status === 404;
  logger.info("assistant-chat", "session delete", { sessionId, status: response.status });
  return { ok };
}

/** PATCH /api/sessions/{id} {title} — best effort (titles are unique server-side). */
export async function sessionRename(sessionId: string, title: string): Promise<{ ok: boolean }> {
  const { key, root } = await requireReady();
  const response = await fetch(`${root}/api/sessions/${encodeURIComponent(sessionId)}`, {
    method: "PATCH",
    headers: authHeaders(key, true),
    body: JSON.stringify({ title }),
  });
  return { ok: response.ok };
}

/** GET /api/sessions — most recently active first (all sources, so WebUI chats show too). */
export async function sessionList(params: { limit?: number }): Promise<ChatSession[]> {
  const { key, root } = await requireReady();
  const limit = Math.min(Math.max(params.limit ?? 40, 1), 200);
  const response = await fetch(`${root}/api/sessions?limit=${limit}`, {
    headers: authHeaders(key),
  });
  if (!response.ok) throw new Error(await readError(response));
  const body = (await response.json()) as { data?: RawSession[] };
  return (body.data ?? []).map(toSession).filter((s) => s.id);
}

type RawMessage = {
  role?: string;
  content?: unknown;
  tool_name?: string | null;
  tool_calls?: { function?: { name?: string }; name?: string }[] | null;
};

/** Text of a stored message: plain string or multimodal parts. */
function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        const p = part as { type?: string; text?: string };
        return p.type === "text" || p.type === "output_text" || p.type === "input_text"
          ? (p.text ?? "")
          : "";
      })
      .join("");
  }
  if (content && typeof content === "object") {
    const c = content as { text?: string };
    return c.text ?? "";
  }
  return "";
}

/** GET /api/sessions/{id}/messages, oldest first, for hydrating a transcript. */
export async function sessionMessages(sessionId: string): Promise<ChatSessionMessage[]> {
  const { key, root } = await requireReady();
  const response = await fetch(
    `${root}/api/sessions/${encodeURIComponent(sessionId)}/messages?order=oldest&limit=500`,
    { headers: authHeaders(key) },
  );
  if (!response.ok) throw new Error(await readError(response));
  const body = (await response.json()) as { data?: RawMessage[] };
  const out: ChatSessionMessage[] = [];
  for (const m of body.data ?? []) {
    const role =
      m.role === "user" || m.role === "assistant" || m.role === "tool" ? m.role : "system";
    const toolCalls = (m.tool_calls ?? [])
      .map((call) => call.function?.name ?? call.name ?? "")
      .filter((name) => name.length > 0);
    out.push({
      role,
      text: contentText(m.content),
      ...(m.tool_name ? { toolName: String(m.tool_name) } : {}),
      ...(toolCalls.length > 0 ? { toolCalls } : {}),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Streaming turns
// ---------------------------------------------------------------------------

const active = new Map<string, AbortController>();

export function chatCancel(requestId: string): void {
  active.get(requestId)?.abort();
}

function emit(event: ChatEvent): void {
  ipcMain.broadcast("assistant:chatEvent", event);
}

/**
 * Pulls SSE frames off a body: `event:` (optional) + `data:` lines, blank-line
 * separated; comment lines (`: keepalive`) only reset the idle timer.
 */
async function readSse(
  body: ReadableStream<Uint8Array>,
  onFrame: (event: string | null, data: string) => void,
  onActivity: () => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    onActivity();
    buffer += decoder.decode(value, { stream: true });
    for (;;) {
      const sep = buffer.indexOf("\n\n");
      if (sep === -1) break;
      const frame = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      let event: string | null = null;
      const data: string[] = [];
      for (const line of frame.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) data.push(line.slice(5).trim());
      }
      if (data.length > 0) onFrame(event, data.join("\n"));
    }
  }
}

function parseJson(json: string): Record<string, unknown> | null {
  try {
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * One turn. With a sessionId it streams POST /api/sessions/{id}/chat/stream
 * (native session transcript); otherwise POST /v1/responses chained by
 * previous_response_id. Agent runs can take minutes when tools are involved —
 * the timeout is on stream inactivity, not total duration.
 */
export async function chatSend(params: {
  requestId: string;
  input: string;
  sessionId?: string;
  previousResponseId?: string;
}): Promise<{ ok: boolean }> {
  const { requestId, input, sessionId, previousResponseId } = params;
  const config = await getChatConfig();
  const key = await getKey();
  if (!config || !key) {
    emit({ requestId, type: "error", message: "not_configured" });
    return { ok: false };
  }

  const controller = new AbortController();
  active.set(requestId, controller);
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  const resetIdle = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => controller.abort(new Error("idle_timeout")), IDLE_TIMEOUT_MS);
  };

  logger.info("assistant-chat", "send", {
    requestId,
    chars: input.length,
    transport: sessionId ? "session" : "responses",
    chained: Boolean(previousResponseId),
  });

  try {
    resetIdle();
    const ok = sessionId
      ? await streamSessionTurn({ requestId, input, sessionId, config, key, controller, resetIdle })
      : await streamResponsesTurn({
          requestId,
          input,
          previousResponseId,
          config,
          key,
          controller,
          resetIdle,
        });
    return { ok };
  } catch (err) {
    const aborted = controller.signal.aborted;
    const reason = controller.signal.reason;
    const message = aborted
      ? reason instanceof Error && reason.message === "idle_timeout"
        ? "timeout"
        : "cancelled"
      : "unreachable";
    logger.info("assistant-chat", "failed", {
      requestId,
      message,
      error: aborted ? message : String(err),
    });
    emit({ requestId, type: "error", message });
    return { ok: false };
  } finally {
    if (idleTimer) clearTimeout(idleTimer);
    active.delete(requestId);
  }
}

type TurnContext = {
  requestId: string;
  input: string;
  config: ChatConfig;
  key: string;
  controller: AbortController;
  resetIdle: () => void;
};

/**
 * Native session turn. Event names/payloads per gateway/platforms/api_server.py:
 * assistant.delta{delta}, assistant.commentary{text,already_streamed},
 * tool.started|completed|failed{tool_name|tool,preview}, run.completed|failed|cancelled,
 * error{message}, done. Closing the connection interrupts the run server-side.
 */
async function streamSessionTurn(ctx: TurnContext & { sessionId: string }): Promise<boolean> {
  const { requestId, input, sessionId, config, key, controller, resetIdle } = ctx;
  const response = await fetch(
    `${apiRoot(config.baseUrl)}/api/sessions/${encodeURIComponent(sessionId)}/chat/stream`,
    {
      method: "POST",
      headers: { ...authHeaders(key, true), Accept: "text/event-stream" },
      body: JSON.stringify({ message: input }),
      signal: controller.signal,
    },
  );

  if (response.status === 401) {
    emit({ requestId, type: "error", message: "unauthorized" });
    return false;
  }
  if (response.status === 404) {
    // The session was deleted (e.g. from another client); the panel starts a new one.
    emit({ requestId, type: "error", message: "session_not_found" });
    return false;
  }
  if (!response.ok || !response.body) {
    const message = await readError(response);
    logger.info("assistant-chat", "session turn rejected", {
      requestId,
      status: response.status,
      message,
    });
    emit({ requestId, type: "error", message: `http_${response.status}` });
    return false;
  }

  let terminal: "completed" | "failed" | "cancelled" | null = null;
  let streamedText = false;

  await readSse(
    response.body,
    (name, json) => {
      const payload = parseJson(json);
      if (!payload) return;
      const event = name ?? String(payload.type ?? payload.event ?? "");
      switch (event) {
        case "assistant.delta": {
          const text = String(payload.delta ?? payload.text ?? "");
          if (text) {
            streamedText = true;
            emit({ requestId, type: "delta", text });
          }
          break;
        }
        case "assistant.commentary": {
          // Mid-turn commentary beside tool calls; skip when it already streamed as deltas.
          if (payload.already_streamed) break;
          const text = String(payload.text ?? "").trim();
          if (text)
            emit({ requestId, type: "delta", text: `${streamedText ? "\n\n" : ""}${text}\n\n` });
          streamedText = true;
          break;
        }
        case "assistant.completed": {
          // Fallback for turns that produced no deltas (e.g. a non-streaming provider).
          const text = String(payload.content ?? "");
          if (!streamedText && text) {
            streamedText = true;
            emit({ requestId, type: "delta", text });
          }
          break;
        }
        case "tool.started":
          emit({
            requestId,
            type: "tool",
            name: String(payload.tool_name ?? payload.tool ?? "tool"),
          });
          break;
        case "tool.completed":
        case "tool.failed": {
          const preview = String(payload.preview ?? "").slice(0, TOOL_OUTPUT_PREVIEW_CHARS);
          emit({
            requestId,
            type: "toolResult",
            output: preview || (event === "tool.failed" ? "(failed)" : "(done)"),
          });
          break;
        }
        case "run.completed":
          terminal = "completed";
          break;
        case "run.failed": {
          terminal = "failed";
          const reason = payload.turn_exit_reason ? String(payload.turn_exit_reason) : "";
          emit({
            requestId,
            type: "error",
            message: reason ? `agent_error: ${reason}` : "agent_error",
          });
          break;
        }
        case "run.cancelled":
          terminal = "cancelled";
          emit({ requestId, type: "error", message: "cancelled" });
          break;
        case "error": {
          terminal = "failed";
          const message = String(payload.message ?? "");
          emit({
            requestId,
            type: "error",
            message: message ? `agent_error: ${message}` : "agent_error",
          });
          break;
        }
        default:
          // run.started, message.started, tool.progress (reasoning), done — nothing to relay.
          break;
      }
    },
    resetIdle,
  );

  if (terminal === "completed") {
    emit({ requestId, type: "done", responseId: null });
    logger.info("assistant-chat", "done", { requestId, sessionId });
    return true;
  }
  if (terminal === null) {
    // Stream closed without a terminal event: the gateway dropped the connection.
    logger.info("assistant-chat", "session stream ended early", { requestId, sessionId });
    emit({ requestId, type: "error", message: "unreachable" });
  }
  return false;
}

/** Legacy Responses-API turn (previous_response_id chaining) for pre-migration chats. */
async function streamResponsesTurn(
  ctx: TurnContext & { previousResponseId?: string },
): Promise<boolean> {
  const { requestId, input, previousResponseId, config, key, controller, resetIdle } = ctx;
  const response = await fetch(`${config.baseUrl}/responses`, {
    method: "POST",
    headers: authHeaders(key, true),
    body: JSON.stringify({
      model: config.model,
      input,
      stream: true,
      store: true,
      ...(previousResponseId ? { previous_response_id: previousResponseId } : {}),
    }),
    signal: controller.signal,
  });

  if (response.status === 401) {
    emit({ requestId, type: "error", message: "unauthorized" });
    return false;
  }
  if (!response.ok || !response.body) {
    emit({ requestId, type: "error", message: `http_${response.status}` });
    return false;
  }

  let responseId: string | null = null;

  await readSse(
    response.body,
    (_name, json) => {
      if (json === "[DONE]") return;
      const event = parseJson(json);
      if (!event) return;
      // Event shapes verified against Hermes' gateway/platforms/api_server.py:
      // tool result rides on output_item.added (not .done) and its `output`
      // is an array of {type, text} parts, not a plain string.
      const type = String(event.type ?? "");
      if (type === "response.created" || type === "response.completed") {
        const resp = event.response as { id?: string } | undefined;
        if (resp?.id) responseId = resp.id;
      } else if (type === "response.output_text.delta") {
        emit({ requestId, type: "delta", text: String(event.delta ?? "") });
      } else if (type === "response.output_item.added") {
        const item = event.item as
          | { type?: string; name?: string; output?: { text?: string }[] | string }
          | undefined;
        if (item?.type === "function_call") {
          emit({ requestId, type: "tool", name: item.name ?? "tool" });
        } else if (item?.type === "function_call_output") {
          const text = (
            typeof item.output === "string"
              ? item.output
              : (item.output ?? []).map((part) => part?.text ?? "").join("")
          ).slice(0, TOOL_OUTPUT_PREVIEW_CHARS);
          emit({ requestId, type: "toolResult", output: text });
        }
      } else if (type === "response.failed") {
        const resp = event.response as { error?: { message?: string } } | undefined;
        emit({
          requestId,
          type: "error",
          message: resp?.error?.message ? `agent_error: ${resp.error.message}` : "agent_error",
        });
      }
    },
    resetIdle,
  );

  emit({ requestId, type: "done", responseId });
  logger.info("assistant-chat", "done", { requestId, responseId: responseId ?? "none" });
  return true;
}
