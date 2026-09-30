/**
 * The tools Otter Mail gives the agents it runs: the user's mailboxes and
 * calendars, whatever provider each one uses, so an agent needs no mail CLI
 * of its own. The shell serves them (the Mac app: an MCP server that Claude
 * and Codex are pointed at, apps/desktop agent/mcp-server.ts) and says who is
 * calling; tools that change a mailbox ask that chat's user first, the way
 * the agents' own approvals do, unless the chat has full access.
 */

import { logger } from "../../../logger.js";
import type { ApprovalDecision, ApprovalRequest } from "../types.js";
import { calendarTools } from "./calendar.js";
import { mailTools } from "./mail.js";
import { onDeviceTools } from "./on-device.js";
import type { AgentTool, ToolArgs, ToolCaller } from "./tool.js";

export type { AgentTool, ToolCaller, ToolFiles } from "./tool.js";
export { onDeviceInstructions } from "./on-device.js";

const TOOLS: AgentTool[] = [...mailTools, ...calendarTools];

/** The MCP server's name: Claude sees the tools as `mcp__otter-mail__<tool>`. */
export const OTTER_TOOLS_SERVER = "otter-mail";

/** A tool's title ("Search mail"), for the chat's step rows. */
export function toolTitle(name: string): string | undefined {
  return [...TOOLS, ...onDeviceTools].find((t) => t.name === name)?.title;
}

/** The tools a caller can use: its toolset (attachments need files on the device). */
export function agentTools(caller: ToolCaller): AgentTool[] {
  if (caller.toolset === "on-device") return onDeviceTools;
  return TOOLS.filter((t) => !t.needsFiles || caller.files);
}

type Pending = { caller: ToolCaller; resolve: (decision: ApprovalDecision | "cancel") => void };

const pending = new Map<string, Pending>();
/** Tools each chat's user allowed for the rest of the chat. */
const allowed = new WeakMap<ToolCaller, Set<string>>();

/** Answers an approval a tool waits on; false when it isn't one of the tools'. */
export function answerToolApproval(approvalId: string, decision: ApprovalDecision): boolean {
  const waiting = pending.get(approvalId);
  waiting?.resolve(decision);
  return Boolean(waiting);
}

/** Drops a chat's open approvals (its turn stopped): those tool calls fail. */
export function cancelToolApprovals(caller: ToolCaller): void {
  for (const waiting of pending.values()) if (waiting.caller === caller) waiting.resolve("cancel");
}

async function confirm(tool: AgentTool, caller: ToolCaller, detail: string): Promise<void> {
  if (caller.mode() === "full-access" || allowed.get(caller)?.has(tool.name)) return;
  const turn = caller.turn();
  if (!turn) throw new Error("No one is there to approve this.");
  const approval: ApprovalRequest = {
    id: crypto.randomUUID(),
    kind: "tool",
    title: tool.title,
    detail,
    choices: ["once", "session", "deny"],
  };
  const decision = await new Promise<ApprovalDecision | "cancel">((resolve) => {
    pending.set(approval.id, { caller, resolve });
    turn.emit({ requestId: turn.requestId, type: "approval", approval });
  });
  pending.delete(approval.id);
  turn.emit({ requestId: turn.requestId, type: "approvalResolved", approvalId: approval.id });
  if (decision === "session" || decision === "always") {
    const tools = allowed.get(caller) ?? new Set<string>();
    allowed.set(caller, tools.add(tool.name));
  } else if (decision !== "once") {
    throw new Error(decision === "cancel" ? "Stopped by the user." : "The user declined.");
  }
}

/** Each caller's latest change, which its next one waits for. */
const lastChange = new WeakMap<ToolCaller, Promise<unknown>>();

/**
 * Runs a tool for a caller: its result as text (JSON, or the words of an on-device tool), or what went wrong.
 * Changes run one after another in the order they were asked for (agents
 * send "add a label" and "remove it" at once); reads don't wait.
 */
export function runAgentTool(
  caller: ToolCaller,
  name: string,
  args: ToolArgs,
): Promise<{ text: string; isError: boolean }> {
  const tool = agentTools(caller).find((t) => t.name === name);
  if (!tool) return Promise.resolve({ text: `No tool "${name}".`, isError: true });
  if (tool.readOnly) return run(tool, caller, args);
  const result = (lastChange.get(caller) ?? Promise.resolve()).then(() => run(tool, caller, args));
  lastChange.set(caller, result);
  return result;
}

async function run(
  tool: AgentTool,
  caller: ToolCaller,
  args: ToolArgs,
): Promise<{ text: string; isError: boolean }> {
  const name = tool.name;
  logger.info("agent", "tool", { tool: name });
  try {
    const result = await tool.run(args, {
      caller,
      confirm: (detail) => confirm(tool, caller, detail),
    });
    // Text as it is (the on-device tools answer in words); anything else as JSON.
    const text = typeof result === "string" ? result : JSON.stringify(result ?? { ok: true });
    return { text, isError: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.info("agent", "tool failed", { tool: name, error: message });
    return { text: message, isError: true };
  }
}
