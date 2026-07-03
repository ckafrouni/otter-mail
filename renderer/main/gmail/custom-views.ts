/**
 * custom-views.ts
 *
 * Combined-mailbox views + last-location persistence. Views are pure UI config,
 * so they live in localStorage. Two built-in views ("Inbox", "Sent") are always
 * present; when their `selections` are null they track every account's
 * INBOX/SENT dynamically and can be reset back to that. Custom views hold an
 * explicit per-account label selection.
 */

import { useCallback, useSyncExternalStore } from "react";
import type { GmailAccount, LabelSelection, MailView, ViewKind } from "./types";

const VIEWS_KEY = "gmail:combined-views";
const LAST_LOCATION_KEY = "gmail:last-location";

/** Sentinel account id for the cross-account "Combined" mailbox. */
export const COMBINED_ACCOUNT_ID = "__combined__";

export const INBOX_VIEW_ID = "__inbox__";
export const SENT_VIEW_ID = "__sent__";

const DEFAULT_VIEWS: MailView[] = [
  { id: INBOX_VIEW_ID, name: "Inbox", kind: "inbox", selections: null },
  { id: SENT_VIEW_ID, name: "Sent", kind: "sent", selections: null },
];

/** The Gmail system-label id a default view aggregates across accounts. */
function systemLabelForKind(kind: ViewKind): string | null {
  if (kind === "inbox") return "INBOX";
  if (kind === "sent") return "SENT";
  return null;
}

/** Dynamic default selections for a built-in view: every account's INBOX/SENT. */
export function defaultSelectionsFor(kind: ViewKind, accounts: GmailAccount[]): LabelSelection[] {
  const labelId = systemLabelForKind(kind);
  if (!labelId) return [];
  return accounts.map((a) => ({ accountId: a.id, labelId }));
}

/**
 * Resolves a view to the concrete selections used for querying, pruned to
 * accounts that still exist. Built-in views with null selections fall back to
 * their dynamic default.
 */
export function resolveSelections(view: MailView, accounts: GmailAccount[]): LabelSelection[] {
  const accountIds = new Set(accounts.map((a) => a.id));
  const raw =
    view.selections ?? defaultSelectionsFor(view.kind, accounts);
  return raw.filter((s) => accountIds.has(s.accountId));
}

function isValidView(v: unknown): v is MailView {
  const view = v as MailView;
  return (
    !!view &&
    typeof view.id === "string" &&
    typeof view.name === "string" &&
    (view.kind === "inbox" || view.kind === "sent" || view.kind === "custom") &&
    (view.selections === null || Array.isArray(view.selections))
  );
}

/** Ensures the two built-in views exist and lead the list (Inbox, then Sent). */
function withDefaults(views: MailView[]): MailView[] {
  const inbox = views.find((v) => v.id === INBOX_VIEW_ID) ?? DEFAULT_VIEWS[0];
  const sent = views.find((v) => v.id === SENT_VIEW_ID) ?? DEFAULT_VIEWS[1];
  const custom = views.filter((v) => v.id !== INBOX_VIEW_ID && v.id !== SENT_VIEW_ID);
  return [inbox, sent, ...custom];
}

function loadViews(): MailView[] {
  try {
    const raw = localStorage.getItem(VIEWS_KEY);
    if (!raw) return withDefaults([]);
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return withDefaults([]);
    return withDefaults(parsed.filter(isValidView));
  } catch {
    return withDefaults([]);
  }
}

const listeners = new Set<() => void>();
let cache: MailView[] = loadViews();

function emit(next: MailView[]): void {
  cache = withDefaults(next);
  try {
    localStorage.setItem(VIEWS_KEY, JSON.stringify(cache));
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

export type SaveViewInput = {
  id?: string;
  name: string;
  selections: LabelSelection[];
};

export function useMailViews() {
  const views = useSyncExternalStore(subscribe, () => cache);

  const saveView = useCallback((input: SaveViewInput) => {
    const existing = input.id ? cache.find((v) => v.id === input.id) : undefined;
    if (existing) {
      emit(
        cache.map((v) =>
          v.id === existing.id
            ? { ...v, name: input.name, selections: input.selections }
            : v,
        ),
      );
      return existing.id;
    }
    const id = genId();
    emit([...cache, { id, name: input.name, kind: "custom", selections: input.selections }]);
    return id;
  }, []);

  const deleteView = useCallback((id: string) => {
    // Built-in views can't be deleted (reset instead).
    if (id === INBOX_VIEW_ID || id === SENT_VIEW_ID) return;
    emit(cache.filter((v) => v.id !== id));
  }, []);

  const resetView = useCallback((id: string) => {
    emit(
      cache.map((v) =>
        v.id === id && (v.kind === "inbox" || v.kind === "sent")
          ? { ...v, name: v.kind === "inbox" ? "Inbox" : "Sent", selections: null }
          : v,
      ),
    );
  }, []);

  return { views, saveView, deleteView, resetView };
}

// ── Last location (restore where the user left off) ─────────────────────────

export type LastLocation = { accountId: string; labelId: string };

export function loadLastLocation(): LastLocation | null {
  try {
    const raw = localStorage.getItem(LAST_LOCATION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.accountId === "string" && typeof parsed.labelId === "string") {
      return { accountId: parsed.accountId, labelId: parsed.labelId };
    }
    return null;
  } catch {
    return null;
  }
}

export function saveLastLocation(loc: LastLocation): void {
  try {
    localStorage.setItem(LAST_LOCATION_KEY, JSON.stringify(loc));
  } catch {
    // ignore
  }
}
