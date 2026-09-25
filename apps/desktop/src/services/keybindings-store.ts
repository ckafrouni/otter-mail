/**
 * Persists the user's keybindings to userData/keybindings.json (the Otter
 * Code model: a hand-editable JSON array of `{ key, command, when? }` rules).
 *
 * The backend is plain storage: it reads leniently (bad entries are skipped
 * and reported as issues), writes atomically, and watches the file so hand
 * edits reach every window live via the `keybindings:updated` broadcast. The
 * renderer owns the command list, defaults, merge, and grammar validation.
 */

import * as fs from "fs";
import * as fsp from "fs/promises";
import * as path from "path";

import { app } from "electron";
import { logger } from "../logger.js";
import { broadcast } from "../ipc.js";

export type KeybindingRule = { key: string; command: string; when?: string };
export type KeybindingsIssue = { kind: "invalid-entry"; index: number } | { kind: "malformed" };
export type KeybindingsFile = {
  /** null when the file doesn't exist yet (defaults only). */
  rules: KeybindingRule[] | null;
  issues: KeybindingsIssue[];
  path: string;
};

const MAX_RULES = 256;

function filePath(): string {
  return path.join(app.getPath("userData"), "keybindings.json");
}

function asRule(value: unknown): KeybindingRule | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const key = typeof v.key === "string" ? v.key.trim() : "";
  const command = typeof v.command === "string" ? v.command.trim() : "";
  if (!key || key.length > 64 || !command || command.length > 128) return null;
  if (v.when === undefined || v.when === null || v.when === "") return { key, command };
  if (typeof v.when !== "string" || v.when.trim().length > 256) return null;
  const when = v.when.trim();
  return when ? { key, command, when } : { key, command };
}

/** Strips // and /* *\/ comments and trailing commas so JSONC edits still load. */
function stripJsonc(text: string): string {
  let out = "";
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      out += c;
      if (c === "\\") out += text[++i] ?? "";
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') {
      inString = true;
      out += c;
    } else if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      out += "\n";
    } else if (c === "/" && text[i + 1] === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i++;
    } else {
      out += c;
    }
  }
  return out.replace(/,(\s*[\]}])/g, "$1");
}

export async function readKeybindings(): Promise<KeybindingsFile> {
  const p = filePath();
  let text: string;
  try {
    text = await fsp.readFile(p, "utf-8");
  } catch {
    return { rules: null, issues: [], path: p };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonc(text));
  } catch {
    return { rules: [], issues: [{ kind: "malformed" }], path: p };
  }
  if (!Array.isArray(parsed)) return { rules: [], issues: [{ kind: "malformed" }], path: p };
  const rules: KeybindingRule[] = [];
  const issues: KeybindingsIssue[] = [];
  parsed.slice(0, MAX_RULES).forEach((entry, index) => {
    const rule = asRule(entry);
    if (rule) rules.push(rule);
    else issues.push({ kind: "invalid-entry", index });
  });
  return { rules, issues, path: p };
}

export async function writeKeybindings(rules: unknown): Promise<KeybindingsFile> {
  if (!Array.isArray(rules)) throw new Error("rules must be an array");
  const clean = rules.map(asRule).filter((r): r is KeybindingRule => r !== null);
  const p = filePath();
  await fsp.mkdir(path.dirname(p), { recursive: true });
  const tmp = `${p}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(clean.slice(-MAX_RULES), null, 2) + "\n", "utf-8");
  await fsp.rename(tmp, p);
  logger.info("keybindings", `wrote ${clean.length} rules`);
  return { rules: clean, issues: [], path: p };
}

let watching = false;

/** Watches the file's directory (editors replace files) and broadcasts changes. */
export function watchKeybindings(): void {
  if (watching) return;
  watching = true;
  const p = filePath();
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    fs.watch(path.dirname(p), (_event, name) => {
      if (name && name.toString() !== path.basename(p)) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => broadcast("keybindings:updated"), 100);
    });
  } catch (err) {
    logger.info("keybindings", `watch failed: ${String(err)}`);
  }
}
