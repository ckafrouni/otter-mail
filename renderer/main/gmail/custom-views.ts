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
import type { GmailAccount, MailView, ViewKind, ViewRule } from "./types";

const VIEWS_KEY = "gmail:combined-views";
const LAST_LOCATION_KEY = "gmail:last-location";

/** Sentinel account id for the cross-account "Combined" mailbox. */
export const COMBINED_ACCOUNT_ID = "__combined__";

export const INBOX_VIEW_ID = "__inbox__";
export const SENT_VIEW_ID = "__sent__";

const DEFAULT_VIEWS: MailView[] = [
  { id: INBOX_VIEW_ID, name: "Inbox", kind: "inbox", rules: null },
  { id: SENT_VIEW_ID, name: "Sent", kind: "sent", rules: null },
];

/** The Gmail system-label id a default view aggregates across accounts. */
function systemLabelForKind(kind: ViewKind): string | null {
  if (kind === "inbox") return "INBOX";
  if (kind === "sent") return "SENT";
  return null;
}

/** Dynamic default rules for a built-in view: every account's INBOX/SENT. */
export function defaultRulesFor(kind: ViewKind, accounts: GmailAccount[]): ViewRule[] {
  const labelId = systemLabelForKind(kind);
  if (!labelId) return [];
  return accounts.map((a) => ({ accountId: a.id, allOf: [labelId], noneOf: [] }));
}

/**
 * Resolves a view to the concrete rules used for querying, pruned to accounts
 * that still exist. Built-in views with null rules fall back to their dynamic
 * default.
 */
export function resolveRules(view: MailView, accounts: GmailAccount[]): ViewRule[] {
  const accountIds = new Set(accounts.map((a) => a.id));
  const raw = view.rules ?? defaultRulesFor(view.kind, accounts);
  return raw.filter((r) => accountIds.has(r.accountId));
}

type StoredView = MailView & {
  /** Legacy pre-rules shape: flat OR'd (account, label) picks. */
  selections?: { accountId: string; labelId: string }[] | null;
};

/** Migrates a legacy `selections` view: each account's picked labels become one allOf rule. */
function migrateView(v: StoredView): MailView {
  if (v.rules !== undefined && v.rules !== null && Array.isArray(v.rules)) {
    return { id: v.id, name: v.name, kind: v.kind, rules: v.rules };
  }
  if (v.rules === null || v.selections === null || v.selections === undefined) {
    return { id: v.id, name: v.name, kind: v.kind, rules: null };
  }
  const byAccount = new Map<string, string[]>();
  for (const s of v.selections) {
    byAccount.set(s.accountId, [...(byAccount.get(s.accountId) ?? []), s.labelId]);
  }
  return {
    id: v.id,
    name: v.name,
    kind: v.kind,
    rules: [...byAccount.entries()].map(([accountId, allOf]) => ({ accountId, allOf, noneOf: [] })),
  };
}

function isValidView(v: unknown): v is StoredView {
  const view = v as StoredView;
  return (
    !!view &&
    typeof view.id === "string" &&
    typeof view.name === "string" &&
    (view.kind === "inbox" || view.kind === "sent" || view.kind === "custom") &&
    (view.rules === null ||
      Array.isArray(view.rules) ||
      view.selections === null ||
      Array.isArray(view.selections))
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
    return withDefaults(parsed.filter(isValidView).map(migrateView));
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
  rules: ViewRule[];
};

export function useMailViews() {
  const views = useSyncExternalStore(subscribe, () => cache);

  const saveView = useCallback((input: SaveViewInput) => {
    const existing = input.id ? cache.find((v) => v.id === input.id) : undefined;
    if (existing) {
      emit(
        cache.map((v) =>
          v.id === existing.id ? { ...v, name: input.name, rules: input.rules } : v,
        ),
      );
      return existing.id;
    }
    const id = genId();
    emit([...cache, { id, name: input.name, kind: "custom", rules: input.rules }]);
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
          ? { ...v, name: v.kind === "inbox" ? "Inbox" : "Sent", rules: null }
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
