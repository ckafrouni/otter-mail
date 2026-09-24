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
  | { kind: "untrashMessage"; params: { accountId: string; messageId: string } }
  /** A bulk action: every row's inverse, undone together. */
  | { kind: "batch"; actions: UndoAction[] };

let last: UndoAction | null = null;

/**
 * A bulk action registers one undo per row (from each mutation's onMutate,
 * which runs asynchronously); a group collects the next `size` registrations
 * into a single batch so z restores the whole selection. The timeout commits
 * whatever arrived if some row never registers (e.g. its mutation failed early).
 */
let group: {
  remaining: number;
  actions: UndoAction[];
  timer: ReturnType<typeof setTimeout>;
} | null = null;

function commitGroup(): void {
  if (!group) return;
  clearTimeout(group.timer);
  const { actions } = group;
  group = null;
  if (actions.length > 0) last = actions.length === 1 ? actions[0] : { kind: "batch", actions };
}

export function beginUndoGroup(size: number): void {
  commitGroup();
  if (size > 1) group = { remaining: size, actions: [], timer: setTimeout(commitGroup, 2000) };
}

export function registerUndo(action: UndoAction): void {
  if (group) {
    group.actions.push(action);
    if (--group.remaining <= 0) commitGroup();
    return;
  }
  last = action;
}

/** Forgets the pending undo (after an irreversible action like Delete forever). */
export function clearUndo(): void {
  commitGroup();
  last = null;
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
