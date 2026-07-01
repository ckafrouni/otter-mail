import { useEffect, useState } from "react";
import {
  Dialog,
  Field,
  Input,
  Checkbox,
  ScrollArea,
  Text,
  EmptyState,
} from "@glaze/core/components";
import { useAllUserLabels } from "./hooks";
import type { CustomView } from "./types";

type ViewEditorDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When editing an existing view; omit to create a new one. */
  view?: CustomView | null;
  onSave: (view: { id?: string; name: string; labelNames: string[] }) => void;
  onDelete?: (id: string) => void;
};

export function ViewEditorDialog({
  open,
  onOpenChange,
  view,
  onSave,
  onDelete,
}: ViewEditorDialogProps) {
  const labelsQuery = useAllUserLabels(open);
  const allLabels = labelsQuery.data ?? [];

  const [name, setName] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Reset the form each time the dialog opens (create vs. edit).
  useEffect(() => {
    if (!open) return;
    setName(view?.name ?? "");
    setSelected(new Set(view?.labelNames ?? []));
  }, [open, view]);

  const toggle = (labelName: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(labelName)) next.delete(labelName);
      else next.add(labelName);
      return next;
    });
  };

  const handleSave = () => {
    const trimmed = name.trim();
    if (!trimmed || selected.size === 0) return;
    onSave({ id: view?.id, name: trimmed, labelNames: [...selected] });
    onOpenChange(false);
  };

  const canSave = name.trim().length > 0 && selected.size > 0;

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={view ? "Edit View" : "New View"}
      description="Show every account's messages that carry the labels you pick."
      confirmLabel={view ? "Save" : "Create"}
      confirmVariant="accent"
      confirmDisabled={!canSave}
      onConfirm={handleSave}
      destructiveAction={
        view && onDelete
          ? {
              label: "Delete",
              onClick: () => {
                onDelete(view.id);
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
          {labelsQuery.isLoading ? (
            <Text variant="small" color="tertiary">
              Loading labels…
            </Text>
          ) : allLabels.length === 0 ? (
            <EmptyState
              placement="inline"
              title="No labels yet"
              description="Sync your accounts to see their labels here."
            />
          ) : (
            <ScrollArea className="max-h-64 rounded-control border border-separator">
              <div className="flex flex-col p-1">
                {allLabels.map((label) => (
                  <label
                    key={label.name}
                    className="flex items-center gap-2.5 rounded-control px-2 py-1.5 hover:bg-control-subtle cursor-pointer"
                  >
                    <Checkbox
                      checked={selected.has(label.name)}
                      onCheckedChange={() => toggle(label.name)}
                    />
                    {label.color ? (
                      <span
                        className="size-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: label.color.backgroundColor }}
                      />
                    ) : (
                      <span className="size-2.5 shrink-0 rounded-full bg-foreground-40" />
                    )}
                    <Text variant="small" truncate className="flex-1 min-w-0">
                      {label.name}
                    </Text>
                    {label.unread > 0 ? (
                      <Text variant="mini" color="tertiary" className="tabular-nums">
                        {label.unread}
                      </Text>
                    ) : null}
                  </label>
                ))}
              </div>
            </ScrollArea>
          )}
        </div>
      </div>
    </Dialog>
  );
}
