import { useEffect, useMemo, useState } from "react";
import {
  Button,
  Dialog,
  Field,
  Input,
  Text,
  EmptyState,
} from "@glaze/core/components";
import {
  BanIcon,
  ChevronDownIcon,
  SearchIcon,
  SquareIcon,
  SquareCheckBigIcon,
} from "lucide-react";
import { useAllAccountLabels, useCombinedCounts } from "./hooks";
import { defaultRulesFor } from "./custom-views";
import { getAccountColor, getAccountDisplayName } from "./account-style";
import { buildLabelTree, flattenLabelTree, type LabelTreeNode } from "./label-tree";
import { SYSTEM_LABEL_NAMES, SYSTEM_LABEL_ORDER, labelDisplayName } from "./label-names";
import type { GmailAccount, GmailLabel, MailView, ViewRule } from "./types";

type ViewEditorDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The view being edited; null when creating a new custom view. */
  view: MailView | null;
  accounts: GmailAccount[];
  onSave: (input: { id?: string; name: string; rules: ViewRule[] }) => void;
  onDelete: (id: string) => void;
  onReset: (id: string) => void;
};

type PickMode = "require" | "exclude";
/** accountId → labelId → how the label constrains the view. */
type Picks = Record<string, Record<string, PickMode>>;

function rulesToPicks(rules: ViewRule[]): Picks {
  const picks: Picks = {};
  for (const rule of rules) {
    const entry: Record<string, PickMode> = {};
    for (const id of rule.allOf) entry[id] = "require";
    for (const id of rule.noneOf) entry[id] = "exclude";
    picks[rule.accountId] = entry;
  }
  return picks;
}

function picksToRules(picks: Picks): ViewRule[] {
  const rules: ViewRule[] = [];
  for (const [accountId, entry] of Object.entries(picks)) {
    const allOf = Object.keys(entry).filter((id) => entry[id] === "require");
    const noneOf = Object.keys(entry).filter((id) => entry[id] === "exclude");
    if (allOf.length > 0 || noneOf.length > 0) rules.push({ accountId, allOf, noneOf });
  }
  return rules;
}

function sortSystemLabels(labels: GmailLabel[]): GmailLabel[] {
  return labels
    .filter((l) => l.type === "system")
    .sort((a, b) => {
      const ai = SYSTEM_LABEL_ORDER.indexOf(a.id);
      const bi = SYSTEM_LABEL_ORDER.indexOf(b.id);
      return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    });
}

// User labels nest by "/" in the name — flatten the tree into a depth-annotated,
// pre-order list so the flat row list can indent children under their parent.
function userLabelRows(labels: GmailLabel[]): { node: LabelTreeNode; depth: number }[] {
  return flattenLabelTree(buildLabelTree(labels.filter((l) => l.type === "user")));
}

function joinNames(names: string[], conjunction: "and" | "or"): string {
  const quoted = names.map((n) => `“${n}”`);
  if (quoted.length <= 1) return quoted[0] ?? "";
  return `${quoted.slice(0, -1).join(", ")} ${conjunction} ${quoted[quoted.length - 1]}`;
}

function LabelRow({
  displayName,
  color,
  depth,
  mode,
  onToggleRequire,
  onToggleExclude,
}: {
  displayName: string;
  color?: string;
  depth: number;
  mode: PickMode | undefined;
  onToggleRequire: () => void;
  onToggleExclude: () => void;
}) {
  return (
    <div
      className={[
        "group flex items-center rounded-control",
        mode === "require"
          ? "bg-accent/10"
          : mode === "exclude"
            ? "bg-support-red/10"
            : "hover:bg-control-subtle",
      ].join(" ")}
    >
      <button
        type="button"
        onClick={onToggleRequire}
        className="flex flex-1 min-w-0 items-center gap-2.5 py-1.5 pr-1 text-left cursor-pointer"
        style={{ paddingLeft: `${8 + depth * 16}px` }}
      >
        {mode === "require" ? (
          <SquareCheckBigIcon className="size-4 shrink-0 text-accent" />
        ) : mode === "exclude" ? (
          <BanIcon className="size-4 shrink-0 text-support-red" />
        ) : (
          <SquareIcon className="size-4 shrink-0 text-tertiary" />
        )}
        <span
          className={["size-2.5 shrink-0 rounded-full", color ? "" : "bg-foreground-40"].join(" ")}
          style={color ? { backgroundColor: color } : undefined}
        />
        <Text
          variant="small"
          truncate
          className={["flex-1 min-w-0", mode === "exclude" ? "line-through" : ""].join(" ")}
        >
          {displayName}
        </Text>
      </button>
      <button
        type="button"
        aria-label={mode === "exclude" ? `Stop excluding ${displayName}` : `Exclude ${displayName}`}
        title={mode === "exclude" ? "Stop excluding" : "Exclude — hide emails with this label"}
        onClick={onToggleExclude}
        className={[
          "shrink-0 px-2 py-1.5 cursor-pointer",
          mode === "exclude"
            ? "text-support-red"
            : "text-tertiary opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:text-support-red",
        ].join(" ")}
      >
        <BanIcon className="size-3.5" />
      </button>
    </div>
  );
}

export function ViewEditorDialog({
  open,
  onOpenChange,
  view,
  accounts,
  onSave,
  onDelete,
  onReset,
}: ViewEditorDialogProps) {
  const accountIds = accounts.map((a) => a.id);
  const accountLabels = useAllAccountLabels(accountIds, open);
  const anyLoading = accountLabels.some((a) => a.isLoading);

  const [name, setName] = useState("");
  const [picks, setPicks] = useState<Picks>({});
  const [filter, setFilter] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const isDefault = view?.kind === "inbox" || view?.kind === "sent";

  // Reset the form each time the dialog opens.
  useEffect(() => {
    if (!open) return;
    setName(view?.name ?? "");
    const initialRules = view == null ? [] : view.rules ?? defaultRulesFor(view.kind, accounts);
    setPicks(rulesToPicks(initialRules));
    setFilter("");
    setCollapsed({});
    // Only re-init when the dialog (re)opens or the target view changes.
  }, [open, view, accounts]);

  const setMode = (accountId: string, labelId: string, next: PickMode | undefined) => {
    setPicks((prev) => {
      const entry = { ...(prev[accountId] ?? {}) };
      if (next === undefined) delete entry[labelId];
      else entry[labelId] = next;
      return { ...prev, [accountId]: entry };
    });
  };

  const toggleRequire = (accountId: string, labelId: string) => {
    const current = picks[accountId]?.[labelId];
    setMode(accountId, labelId, current === "require" ? undefined : "require");
  };

  const toggleExclude = (accountId: string, labelId: string) => {
    const current = picks[accountId]?.[labelId];
    setMode(accountId, labelId, current === "exclude" ? undefined : "exclude");
  };

  const rules = useMemo(() => picksToRules(picks), [picks]);
  const pickCount = rules.reduce((n, r) => n + r.allOf.length + r.noneOf.length, 0);

  // Live match count for the draft rules, straight from the local store.
  const draftCounts = useCombinedCounts(rules, `draft:${view?.id ?? "new"}`, open);

  const handleSave = () => {
    const trimmed = name.trim();
    if (!trimmed || rules.length === 0) return;
    onSave({ id: view?.id, name: trimmed, rules });
    onOpenChange(false);
  };

  const query = filter.trim().toLowerCase();
  const matches = (label: GmailLabel) => labelDisplayName(label).toLowerCase().includes(query);

  const sortedByAccount = useMemo(
    () =>
      accountLabels.map((entry) => ({
        ...entry,
        account: accounts.find((a) => a.id === entry.accountId) ?? null,
        systemLabels: sortSystemLabels(entry.labels),
        userRows: userLabelRows(entry.labels),
      })),
    [accountLabels, accounts],
  );

  // Resolves a label id to its display name for the recap sentence.
  const labelName = (accountId: string, labelId: string): string => {
    const entry = accountLabels.find((a) => a.accountId === accountId);
    const label = entry?.labels.find((l) => l.id === labelId);
    return label ? labelDisplayName(label) : (SYSTEM_LABEL_NAMES[labelId] ?? labelId);
  };

  const recap = rules.map((rule) => {
    const email = accounts.find((a) => a.id === rule.accountId)?.email ?? rule.accountId;
    const has =
      rule.allOf.length > 0
        ? `emails that have ${joinNames(rule.allOf.map((id) => labelName(rule.accountId, id)), "and")}`
        : "all emails";
    const hasNot =
      rule.noneOf.length > 0
        ? ` and don't have ${joinNames(rule.noneOf.map((id) => labelName(rule.accountId, id)), "or")}`
        : "";
    return { accountId: rule.accountId, email, sentence: `${has}${hasNot}` };
  });

  const canSave = name.trim().length > 0 && rules.length > 0;

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="large"
      title={view ? `Edit ${view.name}` : "New View"}
      description="Pick the labels each account must have — and any it must not."
      confirmLabel={view ? "Save" : "Create"}
      confirmVariant="accent"
      confirmDisabled={!canSave}
      onConfirm={handleSave}
      destructiveAction={
        view && view.kind === "custom"
          ? {
              label: "Delete",
              onClick: () => {
                onDelete(view.id);
                onOpenChange(false);
              },
            }
          : undefined
      }
      secondaryAction={
        view && isDefault
          ? {
              label: "Reset to default",
              onClick: () => {
                onReset(view.id);
                onOpenChange(false);
              },
            }
          : undefined
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="Name" orientation="vertical">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Action Required"
            autoFocus={view == null}
          />
        </Field>

        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-2">
            <Text variant="small-strong">Labels</Text>
            <div className="flex items-center gap-2">
              <Text variant="mini" color="tertiary">
                <SquareCheckBigIcon className="inline size-3 text-accent align-[-2px]" /> must have
                {"   "}
                <BanIcon className="inline size-3 text-support-red align-[-2px] ml-2" /> must not
              </Text>
              {pickCount > 0 ? (
                <Button variant="transparent" size="small" onClick={() => setPicks({})}>
                  Clear
                </Button>
              ) : null}
            </div>
          </div>

          <div className="relative">
            <SearchIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-tertiary pointer-events-none" />
            <Input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter labels…"
              className="pl-8"
            />
          </div>

          {anyLoading && sortedByAccount.every((a) => a.systemLabels.length === 0 && a.userRows.length === 0) ? (
            <Text variant="small" color="tertiary">
              Loading labels…
            </Text>
          ) : accounts.length === 0 ? (
            <EmptyState
              placement="inline"
              title="No accounts"
              description="Connect an account to pick labels."
            />
          ) : (
            <div className="max-h-80 overflow-y-auto rounded-control border border-separator">
              <div className="flex flex-col gap-1 p-1.5">
                {sortedByAccount.map((entry) => {
                  const accountPicks = picks[entry.accountId] ?? {};
                  const activeCount = Object.keys(accountPicks).length;
                  const isCollapsed = query.length === 0 && (collapsed[entry.accountId] ?? false);
                  const visibleUserRows = query
                    ? entry.userRows.filter(({ node }) => node.label && matches(node.label))
                    : entry.userRows;
                  const visibleSystem = query ? entry.systemLabels.filter(matches) : entry.systemLabels;
                  if (query && visibleUserRows.length === 0 && visibleSystem.length === 0) return null;
                  return (
                    <div key={entry.accountId} className="flex flex-col">
                      <button
                        type="button"
                        onClick={() =>
                          setCollapsed((prev) => ({ ...prev, [entry.accountId]: !isCollapsed }))
                        }
                        className="flex w-full items-center gap-2 rounded-control px-2 py-1.5 hover:bg-control-subtle cursor-pointer text-left"
                      >
                        <span
                          className="size-2.5 shrink-0 rounded-full"
                          style={{
                            backgroundColor: entry.account ? getAccountColor(entry.account) : undefined,
                          }}
                        />
                        <Text variant="small-strong" truncate>
                          {entry.account ? getAccountDisplayName(entry.account) : entry.accountId}
                        </Text>
                        <Text variant="mini" color="tertiary" truncate className="flex-1 min-w-0">
                          {entry.account?.email ?? ""}
                        </Text>
                        {activeCount > 0 ? (
                          <Text variant="mini" color="secondary" className="shrink-0">
                            {activeCount} selected
                          </Text>
                        ) : null}
                        <ChevronDownIcon
                          className={[
                            "size-3.5 shrink-0 text-tertiary transition-transform",
                            isCollapsed ? "-rotate-90" : "",
                          ].join(" ")}
                        />
                      </button>
                      {!isCollapsed ? (
                        <>
                          {visibleUserRows.map(({ node, depth }) =>
                            node.label ? (
                              <LabelRow
                                key={node.key}
                                displayName={query ? labelDisplayName(node.label) : node.segment}
                                color={node.label.color?.backgroundColor}
                                depth={query ? 0 : depth}
                                mode={accountPicks[node.label.id]}
                                onToggleRequire={() => toggleRequire(entry.accountId, node.label!.id)}
                                onToggleExclude={() => toggleExclude(entry.accountId, node.label!.id)}
                              />
                            ) : query ? null : (
                              <Text
                                key={node.key}
                                variant="small"
                                color="tertiary"
                                truncate
                                className="py-1.5 pr-2"
                                style={{ paddingLeft: `${8 + depth * 16}px` }}
                              >
                                {node.segment}
                              </Text>
                            ),
                          )}
                          {visibleSystem.length > 0 ? (
                            <Text variant="mini" color="tertiary" className="px-2 pt-2 pb-0.5">
                              System
                            </Text>
                          ) : null}
                          {visibleSystem.map((label) => (
                            <LabelRow
                              key={label.id}
                              displayName={labelDisplayName(label)}
                              color={label.color?.backgroundColor}
                              depth={0}
                              mode={accountPicks[label.id]}
                              onToggleRequire={() => toggleRequire(entry.accountId, label.id)}
                              onToggleExclude={() => toggleExclude(entry.accountId, label.id)}
                            />
                          ))}
                        </>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-1 rounded-control bg-control-subtle px-3 py-2.5">
          <div className="flex items-baseline justify-between gap-2">
            <Text variant="small-strong">This view will show</Text>
            {rules.length > 0 && draftCounts.data ? (
              <Text variant="mini" color="secondary" className="shrink-0 tabular-nums">
                {draftCounts.data.total.toLocaleString()} messages
                {draftCounts.data.unread > 0 ? `, ${draftCounts.data.unread.toLocaleString()} unread` : ""}
              </Text>
            ) : null}
          </div>
          {recap.length === 0 ? (
            <Text variant="small" color="tertiary">
              Nothing yet — click a label to require it, or its <BanIcon className="inline size-3 align-[-2px]" /> to
              exclude it.
            </Text>
          ) : (
            recap.map((r, i) => (
              <Text key={r.accountId} variant="small" color="secondary">
                {i === 0 ? "From " : "plus from "}
                <span className="font-medium">{r.email}</span>: {r.sentence}
              </Text>
            ))
          )}
        </div>
      </div>
    </Dialog>
  );
}
