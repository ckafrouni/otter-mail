/**
 * custom-views.ts
 *
 * Combined-mailbox view hooks. Views live in the backend (userData/views.json,
 * via gmail:*View IPC) so the main and settings windows share one source of
 * truth; mutations broadcast gmail:views-changed to refresh every window.
 * Last-location persistence stays in localStorage (per-window UI state).
 */

import { useCallback, useEffect } from "react";
import { toast } from "./toast";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { gmailApi, type SaveViewParams } from "./api";
import type { GmailAccount, MailView, ViewKind, ViewRule } from "./types";

/** Sentinel account id for the cross-account "Combined" mailbox. */
export const COMBINED_ACCOUNT_ID = "__combined__";

export const INBOX_VIEW_ID = "__inbox__";
export const STARRED_VIEW_ID = "__starred__";
export const SENT_VIEW_ID = "__sent__";
export const DRAFTS_VIEW_ID = "__drafts__";
export const IMPORTANT_VIEW_ID = "__important__";
export const ALL_MAIL_VIEW_ID = "__allmail__";
export const JUNK_VIEW_ID = "__junk__";
export const TRASH_VIEW_ID = "__trash__";

const DEFAULT_VIEWS: MailView[] = [
  { id: INBOX_VIEW_ID, name: "Inbox", kind: "inbox", rules: null },
  { id: STARRED_VIEW_ID, name: "Starred", kind: "starred", rules: null },
  { id: SENT_VIEW_ID, name: "Sent", kind: "sent", rules: null },
  { id: DRAFTS_VIEW_ID, name: "Drafts", kind: "drafts", rules: null },
  { id: IMPORTANT_VIEW_ID, name: "Important", kind: "important", rules: null },
  { id: ALL_MAIL_VIEW_ID, name: "All Mail", kind: "allmail", rules: null },
  { id: JUNK_VIEW_ID, name: "Junk", kind: "junk", rules: null },
  { id: TRASH_VIEW_ID, name: "Trash", kind: "trash", rules: null },
];

/** The Gmail system-label id a default view aggregates across accounts. */
function systemLabelForKind(kind: ViewKind): string | null {
  if (kind === "inbox") return "INBOX";
  if (kind === "starred") return "STARRED";
  if (kind === "sent") return "SENT";
  if (kind === "drafts") return "DRAFT";
  if (kind === "important") return "IMPORTANT";
  if (kind === "junk") return "SPAM";
  if (kind === "trash") return "TRASH";
  return null;
}

/** Dynamic default rules for a built-in view: every account's INBOX/SENT/…,
    or for All Mail every account's mail (no label; spam/trash stay out). */
export function defaultRulesFor(kind: ViewKind, accounts: GmailAccount[]): ViewRule[] {
  if (kind === "allmail") return accounts.map((a) => ({ accountId: a.id, allOf: [], noneOf: [] }));
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
          (view.kind === "inbox" ||
            view.kind === "starred" ||
            view.kind === "sent" ||
            view.kind === "drafts" ||
            view.kind === "important" ||
            view.kind === "junk" ||
            view.kind === "trash" ||
            view.kind === "custom")
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
    const unsubscribe = window.desktopBridge.on("gmail:views-changed", () => {
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

  // Optimistic: patch the views cache immediately, reconcile on settle.
  const patchViews = useCallback(
    async (patch: (views: MailView[]) => MailView[]) => {
      await qc.cancelQueries({ queryKey: VIEWS_QUERY_KEY });
      const prev = qc.getQueryData<MailView[]>(VIEWS_QUERY_KEY);
      qc.setQueryData<MailView[]>(VIEWS_QUERY_KEY, (views) => patch(views ?? DEFAULT_VIEWS));
      return { prev };
    },
    [qc],
  );
  const rollback = (context?: { prev?: MailView[] }) => {
    if (context?.prev) qc.setQueryData(VIEWS_QUERY_KEY, context.prev);
  };

  const saveMutation = useMutation({
    mutationFn: (input: SaveViewParams) => gmailApi.saveView(input),
    onMutate: (input) =>
      patchViews((views) =>
        input.id
          ? views.map((v) =>
              v.id === input.id ? { ...v, name: input.name, rules: input.rules } : v,
            )
          : [
              ...views,
              {
                id: `pending:${input.name}`,
                name: input.name,
                kind: "custom",
                rules: input.rules,
                mailbox: input.mailbox ?? COMBINED_ACCOUNT_ID,
              },
            ],
      ),
    onError: (_err, _vars, context) => {
      rollback(context);
      toast.error("Could not save the view");
    },
    onSettled: invalidate,
  });
  const deleteMutation = useMutation({
    mutationFn: (id: string) => gmailApi.deleteView(id),
    onMutate: (id) => patchViews((views) => views.filter((v) => v.id !== id)),
    onError: (_err, _vars, context) => {
      rollback(context);
      toast.error("Could not delete the view");
    },
    onSettled: invalidate,
  });
  const resetMutation = useMutation({
    mutationFn: (id: string) => gmailApi.resetView(id),
    onMutate: (id) =>
      patchViews((views) =>
        views.map((v) =>
          v.id === id && v.kind !== "custom"
            ? { ...v, name: DEFAULT_VIEWS.find((d) => d.id === id)?.name ?? v.name, rules: null }
            : v,
        ),
      ),
    onError: (_err, _vars, context) => {
      rollback(context);
      toast.error("Could not reset the view");
    },
    onSettled: invalidate,
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
