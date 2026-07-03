import type React from "react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
} from "@glaze/core/components";
import { useLabels, useModifyMessage } from "./hooks";
import { buildLabelTree, flattenLabelTree } from "./label-tree";
import type { GmailLabel } from "./types";

type LabelPickerMenuProps = {
  /** Owning account of the message (per-row account in Combined mode). */
  accountId: string;
  messageId: string;
  labelIds: string[];
  /** Trigger element (rendered via asChild — must accept a ref). */
  children: React.ReactNode;
};

/**
 * Native menu of the account's user labels with checked membership;
 * toggling a label adds/removes it on the message optimistically.
 */
export function LabelPickerMenu({
  accountId,
  messageId,
  labelIds,
  children,
}: LabelPickerMenuProps) {
  const labelsQuery = useLabels(accountId);
  const modifyMessage = useModifyMessage();

  // Sidebar tree order (siblings alphabetical at every depth), full path names.
  const userLabels = flattenLabelTree(
    buildLabelTree((labelsQuery.data ?? []).filter((l) => l.type === "user")),
  )
    .map(({ node }) => node.label)
    .filter((l): l is GmailLabel => l != null);

  const applied = new Set(labelIds);

  const handleToggle = (labelId: string, checked: boolean) => {
    console.log("[LabelPickerMenu:toggle]", { accountId, messageId, labelId, checked });
    void modifyMessage.mutateAsync({
      accountId,
      messageId,
      addLabelIds: checked ? [labelId] : undefined,
      removeLabelIds: checked ? undefined : [labelId],
    });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {userLabels.length === 0 ? (
          <DropdownMenuItem disabled>No labels</DropdownMenuItem>
        ) : (
          userLabels.map((label) => (
            <DropdownMenuCheckboxItem
              key={label.id}
              checked={applied.has(label.id)}
              onCheckedChange={(checked) => handleToggle(label.id, checked)}
            >
              {label.name}
            </DropdownMenuCheckboxItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
