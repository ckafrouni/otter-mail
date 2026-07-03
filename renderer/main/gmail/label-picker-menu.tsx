import type React from "react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
} from "@glaze/core/components";
import { useLabels, useModifyMessage } from "./hooks";
import { buildLabelTree, type LabelTreeNode } from "./label-tree";

type LabelPickerMenuProps = {
  /** Owning account of the message (per-row account in Combined mode). */
  accountId: string;
  messageId: string;
  labelIds: string[];
  /** Trigger element (rendered via asChild — must accept a ref). */
  children: React.ReactNode;
};

/**
 * Native menu of the account's user labels with checked membership; nested
 * labels become submenus (first item = the parent itself, so it stays
 * selectable), siblings alphabetical at every depth via buildLabelTree.
 */
export function LabelPickerMenu({
  accountId,
  messageId,
  labelIds,
  children,
}: LabelPickerMenuProps) {
  const labelsQuery = useLabels(accountId);
  const modifyMessage = useModifyMessage();

  const tree = buildLabelTree((labelsQuery.data ?? []).filter((l) => l.type === "user"));
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

  const renderNode = (node: LabelTreeNode): React.ReactNode => {
    if (node.children.length === 0) {
      if (!node.label) return null;
      const id = node.label.id;
      return (
        <DropdownMenuCheckboxItem
          key={node.key}
          checked={applied.has(id)}
          onCheckedChange={(checked) => handleToggle(id, checked)}
        >
          {node.segment}
        </DropdownMenuCheckboxItem>
      );
    }
    const selfId = node.label?.id;
    return (
      <DropdownMenuSub key={node.key} label={node.segment}>
        {selfId ? (
          <>
            <DropdownMenuCheckboxItem
              checked={applied.has(selfId)}
              onCheckedChange={(checked) => handleToggle(selfId, checked)}
            >
              {node.segment}
            </DropdownMenuCheckboxItem>
            <DropdownMenuSeparator />
          </>
        ) : null}
        {node.children.map(renderNode)}
      </DropdownMenuSub>
    );
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {tree.length === 0 ? (
          <DropdownMenuItem disabled>No labels</DropdownMenuItem>
        ) : (
          tree.map(renderNode)
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
