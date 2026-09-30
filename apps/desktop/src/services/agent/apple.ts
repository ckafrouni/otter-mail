/**
 * Apple's on-device model as an agent (Foundation Models), through the Apple
 * helper's `agent` command (native/apple-helper, Agent.swift). The model runs
 * on this Mac with core's on-device toolset (tools/on-device.ts): a few of
 * Otter Mail's tools, shaped for a small model, with the same approvals and
 * steps as the others. Nothing leaves the Mac, chats included: each is kept
 * as the model's transcript, in `apple-chats/`.
 */

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";

import {
  OTTER_TOOLS_SERVER,
  TOOL_OUTPUT_CHARS,
  agentTools,
  cancelToolApprovals,
  mcpStep,
  onDeviceInstructions,
  runAgentTool,
  type ChatProvider,
  type ChatSession,
  type ChatSessionMessage,
  type Emit,
  type RuntimeMode,
  type ToolCaller,
} from "@otter-mail/core";

import { appInfo } from "../../backend-protocol.js";
import { logger } from "../../logger.js";
import { helperPath, runHelper } from "../apple-helper.js";

/** How much of a tool's result the model reads: its whole context is 8K tokens. */
const RESULT_CHARS = 4_000;

/** The renderer's handoff block after a question, which the chat shows without. */
const CONTEXT_MARKER = "\n\n— context from Otter Mail —";

/** What `agent-status` reasons mean for the user. */
const UNAVAILABLE: Record<string, string> = {
  deviceNotEligible: "This Mac doesn't have Apple Intelligence.",
  appleIntelligenceNotEnabled:
    "Turn on Apple Intelligence in System Settings › Apple Intelligence & Siri.",
  modelNotReady: "Apple Intelligence is still getting ready. Try again in a little while.",
  unsupportedOS: "Apple's on-device model needs macOS 26 or later.",
};

/** What a turn's `error` code means for the user. */
const ERRORS: Record<string, string> = {
  contextWindow: "This chat is too long for Apple's on-device model. Start a new one.",
  refused: "Apple's model won't help with that.",
  unsupportedLanguage: "Apple's model doesn't speak this language yet.",
};

/**
 * A tool's input (JSON Schema) as Foundation Models' GenerationSchema decodes
 * it: every object also titled, ordered and closed.
 */
function generationSchema(schema: Record<string, unknown>, title = "Arguments"): object {
  if (schema.type === "array" && schema.items)
    return { ...schema, items: generationSchema(schema.items as Record<string, unknown>) };
  if (schema.type !== "object") return schema;
  const properties = Object.fromEntries(
    Object.entries(schema.properties as Record<string, Record<string, unknown>>).map(
      ([key, value]) => [key, generationSchema(value, key)],
    ),
  );
  return {
    ...schema,
    title,
    properties,
    required: schema.required ?? [],
    "x-order": Object.keys(properties),
    additionalProperties: false,
  };
}

// ── Chats ────────────────────────────────────────────────────────────────────

/** Foundation Models' transcript, as the helper encodes it (Transcript's Codable form). */
type Transcript = { transcript?: { entries?: Entry[] } };
type Entry = {
  role?: string;
  contents?: { type?: string; text?: string }[];
  toolCalls?: { name?: string; arguments?: string }[];
};

type Chat = { id: string; title: string; lastActive: number; transcript: Transcript };

const chatsDir = () => path.join(appInfo().stateDir, "apple-chats");
const chatFile = (id: string) => path.join(chatsDir(), `${path.basename(id)}.json`);

async function readChat(id: string): Promise<Chat | null> {
  try {
    return JSON.parse(await fs.readFile(chatFile(id), "utf8")) as Chat;
  } catch {
    return null;
  }
}

async function writeChat(chat: Chat): Promise<void> {
  await fs.mkdir(chatsDir(), { recursive: true });
  await fs.writeFile(chatFile(chat.id), JSON.stringify(chat));
}

const text = (entry: Entry) =>
  (entry.contents ?? []).map((c) => (c.type === "text" ? (c.text ?? "") : "")).join("");

/** A chat as the panel shows it: questions (without the handoff block), answers and steps. */
function messages(chat: Chat): ChatSessionMessage[] {
  return (chat.transcript.transcript?.entries ?? []).flatMap((entry): ChatSessionMessage[] => {
    switch (entry.role) {
      case "user":
        return [{ role: "user", text: text(entry).split(CONTEXT_MARKER)[0]!.trim() }];
      case "tool":
        return [{ role: "tool", text: text(entry).slice(0, TOOL_OUTPUT_CHARS) }];
      case "response":
        return entry.toolCalls
          ? [
              {
                role: "assistant",
                text: "",
                toolCalls: entry.toolCalls.map((c) =>
                  mcpStep(OTTER_TOOLS_SERVER, c.name ?? "", c.arguments),
                ),
              },
            ]
          : [{ role: "assistant", text: text(entry) }];
      default:
        return [];
    }
  });
}

// ── The tools' caller, one per chat ──────────────────────────────────────────

type ChatTools = {
  caller: ToolCaller;
  mode: RuntimeMode;
  turn: { requestId: string; emit: Emit } | null;
};

/** Stable per chat: approvals go to its turn, and "allow for this chat" sticks to it. */
const chatTools = new Map<string, ChatTools>();

function toolsFor(chatId: string): ChatTools {
  let tools = chatTools.get(chatId);
  if (!tools) {
    const state: ChatTools = {
      mode: "approval-required",
      turn: null,
      caller: { toolset: "on-device", mode: () => state.mode, turn: () => state.turn },
    };
    chatTools.set(chatId, (tools = state));
  }
  return tools;
}

// ── The helper ───────────────────────────────────────────────────────────────

type HelperMessage =
  | { type: "text"; id: string; text: string }
  | { type: "toolCall"; id: string; callId: string; name: string; arguments: string }
  | { type: "done"; id: string; transcript: Transcript; error?: string };

type Turn = { emit: Emit; chat: Chat; tools: ChatTools; streamed: string };

const turns = new Map<string, Turn>();
let helper: ChildProcessWithoutNullStreams | null = null;

function send(message: object): void {
  helper?.stdin.write(`${JSON.stringify(message)}\n`);
}

/** Starts the helper once; it stays up for every chat. */
function startHelper(): void {
  if (helper) return;
  const child = spawn(helperPath(), ["agent"]);
  helper = child;
  child.stderr.on("data", (chunk: Buffer) =>
    logger.info("agent", "apple helper", { stderr: chunk.toString().trim() }),
  );
  child.on("exit", (code) => {
    if (helper === child) helper = null;
    for (const [requestId, turn] of turns) {
      turn.tools.turn = null;
      turn.emit({
        requestId,
        type: "error",
        message: `agent_error: Apple's model stopped (${code}).`,
      });
    }
    turns.clear();
  });
  readline.createInterface({ input: child.stdout }).on("line", (line) => {
    try {
      void handle(JSON.parse(line) as HelperMessage);
    } catch {
      logger.info("agent", "apple helper: unreadable line", { line: line.slice(0, 200) });
    }
  });
}

async function handle(message: HelperMessage): Promise<void> {
  const requestId = message.id;
  const turn = turns.get(requestId);
  if (!turn) return;
  switch (message.type) {
    case "text": {
      // The answer so far; the panel takes deltas. An answer after a tool call starts over.
      const delta = message.text.startsWith(turn.streamed)
        ? message.text.slice(turn.streamed.length)
        : `\n\n${message.text}`;
      turn.streamed = message.text;
      if (delta) turn.emit({ requestId, type: "delta", text: delta });
      break;
    }
    case "toolCall": {
      const id = message.callId;
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(message.arguments) as Record<string, unknown>;
      } catch {
        // Unparseable arguments: the tool says what it needs.
      }
      turn.emit({
        requestId,
        type: "tool",
        id,
        step: mcpStep(OTTER_TOOLS_SERVER, message.name, args),
      });
      const result = await runAgentTool(turn.tools.caller, message.name, args);
      turn.emit({
        requestId,
        type: "toolResult",
        id,
        output: result.text.slice(0, TOOL_OUTPUT_CHARS),
      });
      const output = result.isError ? `Error: ${result.text}` : result.text;
      send({
        type: "toolResult",
        callId: id,
        output: output.length > RESULT_CHARS ? `${output.slice(0, RESULT_CHARS)}\n[… cut]` : output,
      });
      break;
    }
    case "done": {
      turns.delete(requestId);
      turn.tools.turn = null;
      await writeChat({ ...turn.chat, lastActive: Date.now(), transcript: message.transcript });
      const { error } = message;
      turn.emit(
        !error
          ? { requestId, type: "done", responseId: null }
          : error === "cancelled"
            ? { requestId, type: "error", message: "cancelled" }
            : { requestId, type: "error", message: `agent_error: ${ERRORS[error] ?? error}` },
      );
      break;
    }
  }
}

// ── The provider ─────────────────────────────────────────────────────────────

export const appleProvider: ChatProvider = {
  kind: "apple",
  displayName: "Apple",

  async checkStatus() {
    const { available, reason } = (await runHelper("agent-status").catch(() => ({
      available: false,
    }))) as { available: boolean; reason?: string };
    return {
      kind: "apple",
      displayName: "Apple",
      installed: available,
      version: null,
      status: available ? "ready" : "error",
      auth: { status: "unknown" },
      message: available
        ? "Apple's on-device model, with Otter Mail's tools. Nothing leaves this Mac."
        : (UNAVAILABLE[reason ?? ""] ?? "Apple's on-device model couldn't start."),
      models: [{ slug: "on-device", name: "On-device", isDefault: true }],
      model: "on-device",
      sessions: true,
    };
  },

  async sendTurn(input, settings, emit) {
    const chat = (input.sessionId && (await readChat(input.sessionId))) || {
      id: randomUUID(),
      title: input.title || input.input.split(CONTEXT_MARKER)[0]!.slice(0, 60),
      lastActive: Date.now(),
      transcript: {},
    };
    if (!input.sessionId) emit({ requestId: input.requestId, type: "session", sessionId: chat.id });
    const tools = toolsFor(chat.id);
    tools.mode = settings.apple.runtimeMode;
    tools.turn = { requestId: input.requestId, emit };
    turns.set(input.requestId, { emit, chat, tools, streamed: "" });
    startHelper();
    const resuming = Boolean(chat.transcript.transcript?.entries?.length);
    send({
      type: "turn",
      id: input.requestId,
      ...(resuming
        ? { transcript: chat.transcript }
        : { instructions: await onDeviceInstructions() }),
      tools: agentTools(tools.caller).map((t) => ({
        name: t.name,
        description: t.description,
        parameters: generationSchema(t.input),
      })),
      prompt: input.input,
    });
  },

  cancel(requestId) {
    send({ type: "cancel", id: requestId });
    const turn = turns.get(requestId);
    if (turn) cancelToolApprovals(turn.tools.caller);
  },

  // One question at a time: a message mid-turn waits for the next.
  async steer() {
    return false;
  },

  // Only Otter Mail's tools ask, and the service answers those (tools/index.ts).
  async respondApproval() {},

  async listSkills() {
    return [];
  },

  async listSessions(_settings, limit): Promise<ChatSession[]> {
    const files = await fs.readdir(chatsDir()).catch(() => [] as string[]);
    const chats = await Promise.all(files.map((f) => readChat(path.basename(f, ".json"))));
    return chats
      .filter((c): c is Chat => c !== null)
      .sort((a, b) => b.lastActive - a.lastActive)
      .slice(0, limit)
      .map((c) => {
        const shown = messages(c);
        return {
          id: c.id,
          title: c.title,
          source: "apple",
          lastActive: c.lastActive,
          messageCount: shown.filter((m) => m.role !== "tool").length,
          preview:
            shown.findLast((m) => m.role === "assistant" && m.text)?.text.slice(0, 120) ?? null,
        };
      });
  },

  async readSession(_settings, sessionId) {
    const chat = await readChat(sessionId);
    return chat ? messages(chat) : [];
  },

  async deleteSession(_settings, sessionId) {
    const tools = chatTools.get(sessionId);
    if (tools) cancelToolApprovals(tools.caller);
    chatTools.delete(sessionId);
    await fs.rm(chatFile(sessionId), { force: true });
  },

  shutdown() {
    helper?.kill();
    helper = null;
  },
};
