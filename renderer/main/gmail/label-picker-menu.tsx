import type React from "react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
} from "./menu";
import { useLabels, useModifyThread } from "./hooks";
import { buildLabelTree, type LabelTreeNode, isAssignableLabel } from "./label-tree";

type LabelPickerMenuProps = {
  /** Owning account of the message (per-row account in Combined mode). */
  accountId: string;
  /** The conversation to label (labels apply to the whole thread, like Gmail). */
  threadId: string;
  /** Labels currently on the conversation (union over its messages). */
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
  Sub: React.ComponentType<{ label: string; inset?: boolean; children: React.ReactNode }>;
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
      <kit.Sub key={node.key} label={node.segment} inset>
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

export function LabelPickerMenu({ accountId, threadId, labelIds, children }: LabelPickerMenuProps) {
  const labelsQuery = useLabels(accountId);
  const modifyThread = useModifyThread();

  const tree = buildLabelTree((labelsQuery.data ?? []).filter(isAssignableLabel));
  const applied = new Set(labelIds);

  const handleToggle = (labelId: string, checked: boolean) => {
    console.log("[LabelPickerMenu:toggle]", { accountId, threadId, labelId, checked });
    void modifyThread.mutateAsync({
      accountId,
      threadId,
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

/** The same label checklist as a submenu ("Label ▸"), for overflow menus. */
export function LabelSubmenu({
  accountId,
  threadId,
  labelIds,
}: Omit<LabelPickerMenuProps, "children">) {
  const labelsQuery = useLabels(accountId);
  const modifyThread = useModifyThread();
  const tree = buildLabelTree((labelsQuery.data ?? []).filter(isAssignableLabel));
  const applied = new Set(labelIds);
  const handleToggle = (labelId: string, checked: boolean) =>
    void modifyThread.mutateAsync({
      accountId,
      threadId,
      addLabelIds: checked ? [labelId] : undefined,
      removeLabelIds: checked ? undefined : [labelId],
    });
  return (
    <DropdownMenuSub label="Label">
      {tree.length === 0 ? (
        <DropdownMenuItem disabled>No labels</DropdownMenuItem>
      ) : (
        renderLabelMenuNodes(tree, applied, handleToggle, {
          CheckboxItem: DropdownMenuCheckboxItem,
          Sub: DropdownMenuSub,
          Separator: DropdownMenuSeparator,
        })
      )}
    </DropdownMenuSub>
  );
}
