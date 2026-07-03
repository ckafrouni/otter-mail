import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  Field,
  Input,
  Checkbox,
  Text,
  EmptyState,
} from "@glaze/core/components";
import { useAllAccountLabels } from "./hooks";
import { defaultSelectionsFor } from "./custom-views";
import { buildLabelTree, flattenLabelTree, type LabelTreeNode } from "./label-tree";
import { SYSTEM_LABEL_ORDER, labelDisplayName } from "./label-names";
import type { GmailAccount, GmailLabel, LabelSelection, MailView } from "./types";

type ViewEditorDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The view being edited; null when creating a new custom view. */
  view: MailView | null;
  accounts: GmailAccount[];
  onSave: (input: { id?: string; name: string; selections: LabelSelection[] }) => void;
  onDelete: (id: string) => void;
  onReset: (id: string) => void;
};

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
// pre-order list so the flat checkbox list can indent children under their parent.
function userLabelRows(labels: GmailLabel[]): { node: LabelTreeNode; depth: number }[] {
  return flattenLabelTree(buildLabelTree(labels.filter((l) => l.type === "user")));
}

function hasSelection(list: LabelSelection[], accountId: string, labelId: string): boolean {
  return list.some((s) => s.accountId === accountId && s.labelId === labelId);
}

// Indent depth 16px per level, on top of the row's base 8px inset.
function LabelRow({
  displayName,
  color,
  depth,
  checked,
  onToggle,
}: {
  displayName: string;
  color?: string;
  depth: number;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <label
      className="flex items-center gap-2.5 rounded-control py-1.5 pr-2 hover:bg-control-subtle cursor-pointer"
      style={{ paddingLeft: `${8 + depth * 16}px` }}
    >
      <Checkbox checked={checked} onCheckedChange={onToggle} />
      <span
        className={["size-2.5 shrink-0 rounded-full", color ? "" : "bg-foreground-40"].join(" ")}
        style={color ? { backgroundColor: color } : undefined}
      />
      <Text variant="small" truncate className="flex-1 min-w-0">
        {displayName}
      </Text>
    </label>
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
  const [selected, setSelected] = useState<LabelSelection[]>([]);

  const isDefault = view?.kind === "inbox" || view?.kind === "sent";

  // Reset the form each time the dialog opens.
  useEffect(() => {
    if (!open) return;
    setName(view?.name ?? "");
    const initial =
      view == null
        ? []
        : view.selections ?? defaultSelectionsFor(view.kind, accounts);
    setSelected(initial);
    // Only re-init when the dialog (re)opens or the target view changes.
  }, [open, view, accounts]);

  const toggle = (accountId: string, labelId: string) => {
    setSelected((prev) =>
      hasSelection(prev, accountId, labelId)
        ? prev.filter((s) => !(s.accountId === accountId && s.labelId === labelId))
        : [...prev, { accountId, labelId }],
    );
  };

  const handleSave = () => {
    const trimmed = name.trim();
    if (!trimmed || selected.length === 0) return;
    onSave({ id: view?.id, name: trimmed, selections: selected });
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

  const canSave = name.trim().length > 0 && selected.length > 0;

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="large"
      title={view ? `Edit ${view.name}` : "New View"}
      description="Pick any labels from any account — the view shows the union of everything you tick."
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
                        checked={hasSelection(selected, entry.accountId, label.id)}
                        onToggle={() => toggle(entry.accountId, label.id)}
                      />
                    ))}
                    {entry.userRows.map(({ node, depth }) =>
                      node.label ? (
                        <LabelRow
                          key={node.key}
                          displayName={node.segment}
                          color={node.label.color?.backgroundColor}
                          depth={depth}
                          checked={hasSelection(selected, entry.accountId, node.label.id)}
                          onToggle={() => toggle(entry.accountId, node.label!.id)}
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
      </div>
    </Dialog>
  );
}
