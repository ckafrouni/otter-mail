/**
 * views-store.ts
 *
 * Persists Combined-mailbox views to userData/views.json so the main and
 * settings windows share one source of truth. The built-in "Inbox" and
 * "Sent" views always exist and lead the list; their null rules mean
 * "every account's INBOX/SENT", resolved dynamically by the renderer.
 */

import fs from "fs/promises";
import path from "path";
import { app } from "@glaze/core/backend";
import type { MailView, ViewRule } from "../gmail/types.js";

export const INBOX_VIEW_ID = "__inbox__";
export const STARRED_VIEW_ID = "__starred__";
export const SENT_VIEW_ID = "__sent__";
export const DRAFTS_VIEW_ID = "__drafts__";
export const IMPORTANT_VIEW_ID = "__important__";
export const JUNK_VIEW_ID = "__junk__";
export const TRASH_VIEW_ID = "__trash__";

const DEFAULT_VIEWS: MailView[] = [
  { id: INBOX_VIEW_ID, name: "Inbox", kind: "inbox", rules: null },
  { id: STARRED_VIEW_ID, name: "Starred", kind: "starred", rules: null },
  { id: SENT_VIEW_ID, name: "Sent", kind: "sent", rules: null },
  { id: DRAFTS_VIEW_ID, name: "Drafts", kind: "drafts", rules: null },
  { id: IMPORTANT_VIEW_ID, name: "Important", kind: "important", rules: null },
  { id: JUNK_VIEW_ID, name: "Junk", kind: "junk", rules: null },
  { id: TRASH_VIEW_ID, name: "Trash", kind: "trash", rules: null },
];

const BUILTIN_IDS = new Set(DEFAULT_VIEWS.map((v) => v.id));
const BUILTIN_NAMES: Record<string, string> = {
  inbox: "Inbox",
  starred: "Starred",
  sent: "Sent",
  drafts: "Drafts",
  important: "Important",
  junk: "Junk",
  trash: "Trash",
};

async function getViewsPath(): Promise<string> {
  const userDataPath = app.getPath("userData");
  await fs.mkdir(userDataPath, { recursive: true });
  return path.join(userDataPath, "views.json");
}

function withDefaults(views: MailView[]): MailView[] {
  const builtins = DEFAULT_VIEWS.map(
    (fallback) => views.find((v) => v.id === fallback.id) ?? fallback,
  );
  const custom = views.filter((v) => !BUILTIN_IDS.has(v.id));
  return [...builtins, ...custom];
}

async function readViews(): Promise<MailView[]> {
  try {
    const filePath = await getViewsPath();
    const data = await fs.readFile(filePath, "utf-8");
    const parsed = JSON.parse(data);
    return withDefaults(Array.isArray(parsed) ? (parsed as MailView[]) : []);
  } catch {
    return withDefaults([]);
  }
}

async function writeViews(views: MailView[]): Promise<void> {
  const filePath = await getViewsPath();
  await fs.writeFile(filePath, JSON.stringify(withDefaults(views), null, 2), "utf-8");
}

export async function listViews(): Promise<MailView[]> {
  return readViews();
}

/** One-time import of the renderer's legacy localStorage views; no-op once views.json exists. */
export async function importViews(views: MailView[]): Promise<void> {
  const filePath = await getViewsPath();
  try {
    await fs.access(filePath);
    return;
  } catch {
    await writeViews(views);
  }
}

function genId(): string {
  return `v_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function saveView(input: { id?: string; name: string; rules: ViewRule[] }): Promise<MailView> {
  const views = await readViews();
  if (input.id) {
    const index = views.findIndex((v) => v.id === input.id);
    if (index >= 0) {
      views[index] = { ...views[index], name: input.name, rules: input.rules };
      await writeViews(views);
      return views[index];
    }
  }
  const view: MailView = { id: genId(), name: input.name, kind: "custom", rules: input.rules };
  views.push(view);
  await writeViews(views);
  return view;
}

export async function deleteView(id: string): Promise<void> {
  // Built-in views can't be deleted (reset instead).
  if (BUILTIN_IDS.has(id)) return;
  const views = await readViews();
  await writeViews(views.filter((v) => v.id !== id));
}

export async function resetView(id: string): Promise<void> {
  const views = await readViews();
  await writeViews(
    views.map((v) =>
      v.id === id && v.kind !== "custom"
        ? { ...v, name: BUILTIN_NAMES[v.kind] ?? v.name, rules: null }
        : v,
    ),
  );
}
