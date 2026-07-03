import type { ModifyMessageParams, ModifyThreadParams } from "./api";

/**
 * Single-level undo (Gmail's z): mutation hooks register the INVERSE of each
 * user-initiated triage action; the z shortcut takes and runs it. Running the
 * inverse goes through the same hooks, which re-register — so z toggles.
 */
export type UndoAction =
  | { kind: "modifyMessage"; params: ModifyMessageParams }
  | { kind: "modifyThread"; params: ModifyThreadParams }
  | { kind: "untrashThread"; params: { accountId: string; threadId: string } }
  | { kind: "untrashMessage"; params: { accountId: string; messageId: string } };

let last: UndoAction | null = null;

export function registerUndo(action: UndoAction): void {
  last = action;
}

export function takeUndo(): UndoAction | null {
  const action = last;
  last = null;
  return action;
}

/** Auto-mark-read (and ⇧I) shouldn't clobber the undo slot. */
export function isPureMarkRead(addLabelIds?: string[], removeLabelIds?: string[]): boolean {
  return (
    (addLabelIds == null || addLabelIds.length === 0) &&
    removeLabelIds?.length === 1 &&
    removeLabelIds[0] === "UNREAD"
  );
}
