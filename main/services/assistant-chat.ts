/**
 * Hermes chat over its OpenAI-compatible API server (Responses API).
 * The key is full agent control: it lives safeStorage-encrypted
 * (userData/assistant-chat.enc), never reaches the renderer, and is never
 * logged. Requests stream SSE; events are relayed to the windows via
 * ipcMain.broadcast("assistant:chatEvent", …). Continuity is server-side:
 * each turn passes previous_response_id and Hermes rebuilds the context.
 */

import fs from "fs/promises";
import path from "path";
import { app, ipcMain, logger, safeStorage } from "@glaze/core/backend";

export type ChatStatus = {
  configured: boolean;
  baseUrl: string | null;
  model: string | null;
};

export type ChatEvent =
  | { requestId: string; type: "delta"; text: string }
  | { requestId: string; type: "tool"; name: string }
  | { requestId: string; type: "toolResult"; output: string }
  | { requestId: string; type: "done"; responseId: string | null }
  | { requestId: string; type: "error"; message: string };

type ChatConfig = { baseUrl: string; model: string };

const IDLE_TIMEOUT_MS = 180_000;

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
    return parsed.baseUrl ? { baseUrl: parsed.baseUrl, model: parsed.model || "hermes-agent" } : null;
  } catch {
    return null;
  }
}

export async function chatStatus(): Promise<ChatStatus> {
  const config = await getChatConfig();
  const key = await getKey();
  return {
    configured: config != null && key.length > 0,
    baseUrl: config?.baseUrl ?? null,
    model: config?.model ?? null,
  };
}

/** Validates against /v1/models (auth check) before persisting. */
export async function chatConfigure(baseUrl: string, apiKey: string): Promise<ChatStatus> {
  const base = baseUrl.replace(/\/+$/, "");
  const response = await fetch(`${base}/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (response.status === 401) throw new Error("The API key was rejected (401).");
  if (!response.ok) throw new Error(`The server answered ${response.status} — is that the /v1 base URL?`);
  const data = (await response.json()) as { data?: { id?: string }[] };
  const model = data.data?.[0]?.id || "hermes-agent";

  const encrypted = await safeStorage.encryptString(apiKey);
  await fs.writeFile(await keyPath(), encrypted.toString("hex"), "utf-8");
  await fs.writeFile(await configPath(), JSON.stringify({ baseUrl: base, model }, null, 2), "utf-8");
  logger.info("assistant-chat", "configured", { baseUrl: base, model });
  return { configured: true, baseUrl: base, model };
}

const active = new Map<string, AbortController>();

export function chatCancel(requestId: string): void {
  active.get(requestId)?.abort();
}

function emit(event: ChatEvent): void {
  ipcMain.broadcast("assistant:chatEvent", event);
}

/**
 * One turn: POST /v1/responses with stream=true, relay events, resolve when
 * the stream ends. Agent runs can take minutes when tools are involved — the
 * timeout is on stream inactivity, not total duration.
 */
export async function chatSend(params: {
  requestId: string;
  input: string;
  previousResponseId?: string;
}): Promise<{ ok: boolean }> {
  const { requestId, input, previousResponseId } = params;
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
    chained: Boolean(previousResponseId),
  });

  try {
    resetIdle();
    const response = await fetch(`${config.baseUrl}/responses`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
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
      return { ok: false };
    }
    if (!response.ok || !response.body) {
      emit({ requestId, type: "error", message: `http_${response.status}` });
      return { ok: false };
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let responseId: string | null = null;

    const handleData = (json: string) => {
      if (json === "[DONE]") return;
      let event: Record<string, unknown>;
      try {
        event = JSON.parse(json) as Record<string, unknown>;
      } catch {
        return;
      }
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
          | { type?: string; name?: string; output?: { text?: string }[] }
          | undefined;
        if (item?.type === "function_call") {
          emit({ requestId, type: "tool", name: item.name ?? "tool" });
        } else if (item?.type === "function_call_output") {
          const text = (item.output ?? [])
            .map((part) => part?.text ?? "")
            .join("")
            .slice(0, 400);
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
    };

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      resetIdle();
      buffer += decoder.decode(value, { stream: true });
      // SSE frames are blank-line separated; data: lines carry the JSON.
      for (;;) {
        const sep = buffer.indexOf("\n\n");
        if (sep === -1) break;
        const frame = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        for (const line of frame.split("\n")) {
          if (line.startsWith("data:")) handleData(line.slice(5).trim());
        }
      }
    }

    emit({ requestId, type: "done", responseId });
    logger.info("assistant-chat", "done", { requestId, responseId: responseId ?? "none" });
    return { ok: true };
  } catch (err) {
    const aborted = controller.signal.aborted;
    const reason = controller.signal.reason;
    const message = aborted
      ? reason instanceof Error && reason.message === "idle_timeout"
        ? "timeout"
        : "cancelled"
      : "unreachable";
    logger.info("assistant-chat", "failed", { requestId, message, error: aborted ? message : String(err) });
    emit({ requestId, type: "error", message });
    return { ok: false };
  } finally {
    if (idleTimer) clearTimeout(idleTimer);
    active.delete(requestId);
  }
}
