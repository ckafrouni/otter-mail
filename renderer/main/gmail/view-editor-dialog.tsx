import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  Field,
  Input,
  Checkbox,
  ScrollArea,
  Text,
  EmptyState,
} from "@glaze/core/components";
import { useAllAccountLabels } from "./hooks";
import { defaultSelectionsFor } from "./custom-views";
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

// Friendly display names for Gmail's system labels.
const SYSTEM_LABEL_NAMES: Record<string, string> = {
  INBOX: "Inbox",
  SENT: "Sent",
  DRAFT: "Drafts",
  SPAM: "Spam",
  TRASH: "Trash",
  UNREAD: "Unread",
  STARRED: "Starred",
  IMPORTANT: "Important",
  CATEGORY_PERSONAL: "Personal",
  CATEGORY_SOCIAL: "Social",
  CATEGORY_PROMOTIONS: "Promotions",
  CATEGORY_UPDATES: "Updates",
  CATEGORY_FORUMS: "Forums",
  CHAT: "Chat",
};

const SYSTEM_ORDER = Object.keys(SYSTEM_LABEL_NAMES);

function labelDisplayName(label: GmailLabel): string {
  if (label.type === "system") {
    return SYSTEM_LABEL_NAMES[label.id] ?? label.name;
  }
  return label.name;
}

function sortLabels(labels: GmailLabel[]): GmailLabel[] {
  const system = labels
    .filter((l) => l.type === "system")
    .sort((a, b) => {
      const ai = SYSTEM_ORDER.indexOf(a.id);
      const bi = SYSTEM_ORDER.indexOf(b.id);
      return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    });
  const user = labels
    .filter((l) => l.type === "user")
    .sort((a, b) => a.name.localeCompare(b.name));
  return [...system, ...user];
}

function hasSelection(list: LabelSelection[], accountId: string, labelId: string): boolean {
  return list.some((s) => s.accountId === accountId && s.labelId === labelId);
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
        labels: sortLabels(entry.labels),
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
          {anyLoading && sortedByAccount.every((a) => a.labels.length === 0) ? (
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
            <ScrollArea className="max-h-72 rounded-control border border-separator">
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
                    {entry.labels.map((label) => (
                      <label
                        key={label.id}
                        className="flex items-center gap-2.5 rounded-control px-2 py-1.5 hover:bg-control-subtle cursor-pointer"
                      >
                        <Checkbox
                          checked={hasSelection(selected, entry.accountId, label.id)}
                          onCheckedChange={() => toggle(entry.accountId, label.id)}
                        />
                        <span
                          className={[
                            "size-2.5 shrink-0 rounded-full",
                            label.color ? "" : "bg-foreground-40",
                          ].join(" ")}
                          style={
                            label.color
                              ? { backgroundColor: label.color.backgroundColor }
                              : undefined
                          }
                        />
                        <Text variant="small" truncate className="flex-1 min-w-0">
                          {labelDisplayName(label)}
                        </Text>
                      </label>
                    ))}
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </div>
      </div>
    </Dialog>
  );
}
