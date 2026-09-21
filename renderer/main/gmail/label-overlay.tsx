import { useEffect, useState } from "react";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@glaze/core/components";
import { CheckIcon } from "lucide-react";
import { useLabels } from "./hooks";
import { buildLabelTree, flattenLabelTree } from "./label-tree";
import { labelDisplayName } from "./label-names";
import type { GmailLabel } from "./types";

export type LabelOverlayMode = "label" | "move";

/**
 * Keyboard-driven label picker (Gmail's l / v popups): a searchable overlay
 * since native menus can't be opened programmatically. "label" toggles a label
 * on the conversation; "move" applies one and leaves the current context.
 */
export function LabelOverlay({
  open,
  onOpenChange,
  mode,
  accountId,
  appliedLabelIds,
  currentLabelId,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: LabelOverlayMode;
  accountId: string | null;
  appliedLabelIds: string[];
  /** Move mode: the context label being left (excluded from the choices). */
  currentLabelId: string | null;
  onPick: (labelId: string, wasApplied: boolean) => void;
}) {
  const [query, setQuery] = useState("");
  const labelsQuery = useLabels(open ? accountId : null);
  const applied = new Set(appliedLabelIds);

  useEffect(() => {
    if (open) setQuery("");
  }, [open]);

  const userLabels = flattenLabelTree(
    buildLabelTree((labelsQuery.data ?? []).filter((l) => l.type === "user")),
  )
    .map(({ node }) => node.label)
    .filter((l): l is GmailLabel => l != null);

  const choices: { id: string; name: string; color?: string }[] = [];
  if (mode === "move" && currentLabelId !== "INBOX") {
    choices.push({ id: "INBOX", name: "Inbox" });
  }
  for (const label of userLabels) {
    if (mode === "move" && label.id === currentLabelId) continue;
    choices.push({
      id: label.id,
      name: labelDisplayName(label),
      color: label.color?.backgroundColor,
    });
  }

  const title = mode === "move" ? "Move to" : "Label as";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogHeader className="sr-only">
        <DialogTitle variant="large-strong">{title}</DialogTitle>
        <DialogDescription>Pick a label</DialogDescription>
      </DialogHeader>
      <DialogContent size="large" className="p-0 overflow-hidden" showCloseButton={false}>
        <Command className="**:data-[slot=command-input-wrapper]:h-12 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:text-tertiary [&_[cmdk-group]]:px-2 [&_[cmdk-input-wrapper]_svg]:h-5 [&_[cmdk-input-wrapper]_svg]:w-5 [&_[cmdk-input]]:h-12 [&_[cmdk-item]]:px-2 [&_[cmdk-item]]:py-2.5 [&_[cmdk-item]_svg]:h-4 [&_[cmdk-item]_svg]:w-4">
          <CommandInput placeholder={`${title}…`} value={query} onValueChange={setQuery} />
          <CommandList>
            <CommandEmpty>No labels found.</CommandEmpty>
            <CommandGroup heading={title}>
              {choices.map((choice) => (
                <CommandItem
                  key={choice.id}
                  value={choice.name}
                  onSelect={() => {
                    onOpenChange(false);
                    onPick(choice.id, applied.has(choice.id));
                  }}
                >
                  <span
                    className={[
                      "size-2.5 rounded-full shrink-0",
                      choice.color ? "" : "bg-foreground-40",
                    ].join(" ")}
                    style={choice.color ? { backgroundColor: choice.color } : undefined}
                  />
                  <span className="truncate flex-1">{choice.name}</span>
                  {mode === "label" && applied.has(choice.id) ? (
                    <CheckIcon className="shrink-0" />
                  ) : null}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
