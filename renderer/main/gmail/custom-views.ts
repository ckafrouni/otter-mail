/**
 * custom-views.ts
 *
 * Custom "views" for the Combined mailbox — each shows every account's messages
 * carrying any of a chosen set of user-label names. These are pure UI config,
 * so they live in localStorage (no backend persistence needed).
 */

import { useCallback, useSyncExternalStore } from "react";
import type { CustomView } from "./types";

const STORAGE_KEY = "gmail:combined-views";

/** Sentinel account id for the cross-account "Combined" mailbox. */
export const COMBINED_ACCOUNT_ID = "__combined__";
/** Selected-label value for the Combined mailbox's built-in merged Inbox. */
export const COMBINED_INBOX_LABEL = "__combined_inbox__";
/** Prefix for a custom-view selection: `view:<id>`. */
export const VIEW_LABEL_PREFIX = "view:";

function load(): CustomView[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (v): v is CustomView =>
        v &&
        typeof v.id === "string" &&
        typeof v.name === "string" &&
        Array.isArray(v.labelNames),
    );
  } catch {
    return [];
  }
}

const listeners = new Set<() => void>();
let cache: CustomView[] = load();

function emit(next: CustomView[]): void {
  cache = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // ignore quota / serialization errors
  }
  for (const fn of listeners) fn();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function genId(): string {
  return `v_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function useCustomViews() {
  const views = useSyncExternalStore(subscribe, () => cache);

  const saveView = useCallback((view: Omit<CustomView, "id"> & { id?: string }) => {
    const existing = view.id ? cache.find((v) => v.id === view.id) : undefined;
    if (existing) {
      emit(cache.map((v) => (v.id === existing.id ? { ...v, ...view, id: existing.id } : v)));
      return existing.id;
    }
    const id = view.id ?? genId();
    emit([...cache, { id, name: view.name, labelNames: view.labelNames }]);
    return id;
  }, []);

  const deleteView = useCallback((id: string) => {
    emit(cache.filter((v) => v.id !== id));
  }, []);

  return { views, saveView, deleteView };
}
