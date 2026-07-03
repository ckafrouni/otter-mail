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

/** Menu-component set: DropdownMenu* and ContextMenu* both satisfy this shape. */
export type LabelMenuKit = {
  CheckboxItem: React.ComponentType<{
    checked: boolean;
    onCheckedChange: (checked: boolean) => void;
    children: React.ReactNode;
  }>;
  Sub: React.ComponentType<{ label: string; children: React.ReactNode }>;
  Separator: React.ComponentType;
};

/**
 * Renders a label tree as menu items: nested labels become submenus whose
 * first item is the parent itself (so it stays selectable), siblings
 * alphabetical at every depth via buildLabelTree.
 */
export function renderLabelMenuNodes(
  nodes: LabelTreeNode[],
  applied: Set<string>,
  onToggle: (labelId: string, checked: boolean) => void,
  kit: LabelMenuKit,
): React.ReactNode {
  const renderNode = (node: LabelTreeNode): React.ReactNode => {
    if (node.children.length === 0) {
      if (!node.label) return null;
      const id = node.label.id;
      return (
        <kit.CheckboxItem
          key={node.key}
          checked={applied.has(id)}
          onCheckedChange={(checked) => onToggle(id, checked)}
        >
          {node.segment}
        </kit.CheckboxItem>
      );
    }
    const selfId = node.label?.id;
    return (
      <kit.Sub key={node.key} label={node.segment}>
        {selfId ? (
          <>
            <kit.CheckboxItem
              checked={applied.has(selfId)}
              onCheckedChange={(checked) => onToggle(selfId, checked)}
            >
              {node.segment}
            </kit.CheckboxItem>
            <kit.Separator />
          </>
        ) : null}
        {node.children.map(renderNode)}
      </kit.Sub>
    );
  };
  return nodes.map(renderNode);
}

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

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {tree.length === 0 ? (
          <DropdownMenuItem disabled>No labels</DropdownMenuItem>
        ) : (
          renderLabelMenuNodes(tree, applied, handleToggle, {
            CheckboxItem: DropdownMenuCheckboxItem,
            Sub: DropdownMenuSub,
            Separator: DropdownMenuSeparator,
          })
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
