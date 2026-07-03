import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  Field,
  Input,
  Text,
  EmptyState,
} from "@glaze/core/components";
import { SquareIcon, SquareCheckBigIcon, SquareMinusIcon } from "lucide-react";
import { useAllAccountLabels } from "./hooks";
import { defaultRulesFor } from "./custom-views";
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

// Indent depth 16px per level, on top of the row's base 8px inset.
function LabelRow({
  displayName,
  color,
  depth,
  mode,
  onCycle,
}: {
  displayName: string;
  color?: string;
  depth: number;
  mode: PickMode | undefined;
  onCycle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onCycle}
      className="flex w-full items-center gap-2.5 rounded-control py-1.5 pr-2 hover:bg-control-subtle cursor-pointer text-left"
      style={{ paddingLeft: `${8 + depth * 16}px` }}
    >
      {mode === "require" ? (
        <SquareCheckBigIcon className="size-4 shrink-0 text-accent" />
      ) : mode === "exclude" ? (
        <SquareMinusIcon className="size-4 shrink-0 text-support-red" />
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

  const isDefault = view?.kind === "inbox" || view?.kind === "sent";

  // Reset the form each time the dialog opens.
  useEffect(() => {
    if (!open) return;
    setName(view?.name ?? "");
    const initialRules = view == null ? [] : view.rules ?? defaultRulesFor(view.kind, accounts);
    setPicks(rulesToPicks(initialRules));
    // Only re-init when the dialog (re)opens or the target view changes.
  }, [open, view, accounts]);

  const cycle = (accountId: string, labelId: string) => {
    setPicks((prev) => {
      const entry = { ...(prev[accountId] ?? {}) };
      const current = entry[labelId];
      if (current === undefined) entry[labelId] = "require";
      else if (current === "require") entry[labelId] = "exclude";
      else delete entry[labelId];
      return { ...prev, [accountId]: entry };
    });
  };

  const rules = useMemo(() => picksToRules(picks), [picks]);

  const handleSave = () => {
    const trimmed = name.trim();
    if (!trimmed || rules.length === 0) return;
    onSave({ id: view?.id, name: trimmed, rules });
    onOpenChange(false);
  };

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
      description="Click a label once to require it, twice to exclude it. A message must carry every required label and none of the excluded ones; accounts combine as alternatives."
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
            autoFocus
          />
        </Field>

        <div className="flex flex-col gap-1.5">
          <Text variant="small-strong">Labels</Text>
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
            <div className="max-h-72 overflow-y-auto rounded-control border border-separator">
              <div className="flex flex-col gap-2 p-1.5">
                {sortedByAccount.map((entry) => (
                  <div key={entry.accountId} className="flex flex-col">
                    <Text
                      variant="mini"
                      color="secondary"
                      className="px-2 py-1 truncate"
                    >
                      {entry.account?.email ?? entry.accountId}
                    </Text>
                    {entry.systemLabels.map((label) => (
                      <LabelRow
                        key={label.id}
                        displayName={labelDisplayName(label)}
                        color={label.color?.backgroundColor}
                        depth={0}
                        mode={picks[entry.accountId]?.[label.id]}
                        onCycle={() => cycle(entry.accountId, label.id)}
                      />
                    ))}
                    {entry.userRows.map(({ node, depth }) =>
                      node.label ? (
                        <LabelRow
                          key={node.key}
                          displayName={node.segment}
                          color={node.label.color?.backgroundColor}
                          depth={depth}
                          mode={picks[entry.accountId]?.[node.label.id]}
                          onCycle={() => cycle(entry.accountId, node.label!.id)}
                        />
                      ) : (
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
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <Text variant="small-strong">This view will show</Text>
          {recap.length === 0 ? (
            <Text variant="small" color="tertiary">
              Nothing yet — click labels above to build the view.
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
