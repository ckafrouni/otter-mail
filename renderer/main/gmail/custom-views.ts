/**
 * custom-views.ts
 *
 * Combined-mailbox view hooks. Views live in the backend (userData/views.json,
 * via gmail:*View IPC) so the main and settings windows share one source of
 * truth; mutations broadcast gmail:views-changed to refresh every window.
 * Last-location persistence stays in localStorage (per-window UI state).
 */

import { useCallback, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { gmailApi, type SaveViewParams } from "./api";
import type { GmailAccount, MailView, ViewKind, ViewRule } from "./types";

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

// ── Legacy localStorage store (pre-backend) ─────────────────────────────────

const LEGACY_VIEWS_KEY = "gmail:combined-views";

type StoredView = MailView & {
  /** Pre-rules shape: flat OR'd (account, label) picks. */
  selections?: { accountId: string; labelId: string }[] | null;
};

function migrateLegacyView(v: StoredView): MailView {
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

function readLegacyViews(): MailView[] | null {
  try {
    const raw = localStorage.getItem(LEGACY_VIEWS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed
      .filter((v): v is StoredView => {
        const view = v as StoredView;
        return (
          !!view &&
          typeof view.id === "string" &&
          typeof view.name === "string" &&
          (view.kind === "inbox" || view.kind === "sent" || view.kind === "custom")
        );
      })
      .map(migrateLegacyView);
  } catch {
    return null;
  }
}

async function fetchViews(): Promise<MailView[]> {
  const legacy = readLegacyViews();
  if (legacy) {
    try {
      await gmailApi.importViews(legacy);
      localStorage.removeItem(LEGACY_VIEWS_KEY);
    } catch {
      // keep the legacy key so the next launch retries the import
    }
  }
  return gmailApi.listViews();
}

// ── View hooks ───────────────────────────────────────────────────────────────

const VIEWS_QUERY_KEY = ["gmail:views"] as const;

export function useMailViews() {
  const qc = useQueryClient();

  // View edits happen in the Settings window, which has its own QueryClient —
  // listen for the backend broadcast so every window refreshes.
  useEffect(() => {
    const unsubscribe = window.glazeAPI.glaze.ipc.onNotification("gmail:views-changed", () => {
      void qc.invalidateQueries({ queryKey: VIEWS_QUERY_KEY });
    });
    return unsubscribe;
  }, [qc]);

  const query = useQuery<MailView[]>({
    queryKey: VIEWS_QUERY_KEY,
    queryFn: fetchViews,
    staleTime: 30_000,
    placeholderData: DEFAULT_VIEWS,
  });

  const invalidate = useCallback(
    () => void qc.invalidateQueries({ queryKey: VIEWS_QUERY_KEY }),
    [qc],
  );

  const saveMutation = useMutation({
    mutationFn: (input: SaveViewParams) => gmailApi.saveView(input),
    onSuccess: invalidate,
  });
  const deleteMutation = useMutation({
    mutationFn: (id: string) => gmailApi.deleteView(id),
    onSuccess: invalidate,
  });
  const resetMutation = useMutation({
    mutationFn: (id: string) => gmailApi.resetView(id),
    onSuccess: invalidate,
  });

  const saveView = useCallback(
    (input: SaveViewParams) => saveMutation.mutateAsync(input),
    [saveMutation],
  );
  const deleteView = useCallback((id: string) => deleteMutation.mutateAsync(id), [deleteMutation]);
  const resetView = useCallback((id: string) => resetMutation.mutateAsync(id), [resetMutation]);

  return { views: query.data ?? DEFAULT_VIEWS, saveView, deleteView, resetView };
}

// ── Last location (restore where the user left off) ─────────────────────────

const LAST_LOCATION_KEY = "gmail:last-location";

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
