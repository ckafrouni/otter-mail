import type { ModifyMessageParams, ModifyThreadParams } from "./api";

/**
 * Single-level undo (Gmail's z): mutation hooks register the INVERSE of each
 * user-initiated triage action; the z shortcut takes and runs it. Running the
 * inverse goes through the same hooks, which re-register — so z toggles.
 *
 * Each registration also says what the action did ("Archived", "Moved to
 * “X”"); listeners (the action toast) hear about it once it's committed, so a
 * bulk action announces itself once ("Archived 3 conversations").
 */
export type UndoAction =
  | { kind: "modifyMessage"; params: ModifyMessageParams }
  | { kind: "modifyThread"; params: ModifyThreadParams }
  | { kind: "untrashThread"; params: { accountId: string; threadId: string } }
  | { kind: "untrashMessage"; params: { accountId: string; messageId: string } }
  /** Something that isn't a mail change, e.g. holding back a message being sent. */
  | { kind: "callback"; run: () => void }
  /** A bulk action: every row's inverse, undone together. */
  | { kind: "batch"; actions: UndoAction[] };

/** What an action did, for its toast: `${verb}${suffix}` for one, or
    `${verb} 3 ${noun}s${suffix}` for several ("Moved 3 conversations to “X”"). */
export type ActionSummary = {
  verb: string;
  suffix?: string;
  noun: "conversation" | "message";
};

let last: UndoAction | null = null;

type ActionListener = (title: string) => void;
const listeners = new Set<ActionListener>();

/** Hears every committed undoable action, with a title describing it. */
export function onUndoableAction(listener: ActionListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function titleFor(summaries: ActionSummary[]): string {
  const [first] = summaries;
  const suffix = first.suffix ?? "";
  if (summaries.length === 1) return `${first.verb}${suffix}`;
  const same = summaries.every(
    (s) => s.verb === first.verb && (s.suffix ?? "") === suffix && s.noun === first.noun,
  );
  if (!same) return `Changed ${summaries.length} items`;
  return `${first.verb} ${summaries.length} ${first.noun}s${suffix}`;
}

/**
 * A bulk action registers one undo per row (from each mutation's onMutate,
 * which runs asynchronously); a group collects the next `size` registrations
 * into a single batch so z restores the whole selection. The timeout commits
 * whatever arrived if some row never registers (e.g. its mutation failed early).
 */
let group: {
  remaining: number;
  actions: UndoAction[];
  summaries: ActionSummary[];
  timer: ReturnType<typeof setTimeout>;
} | null = null;

function announce(summaries: ActionSummary[]): void {
  if (summaries.length === 0) return;
  const title = titleFor(summaries);
  for (const listener of listeners) listener(title);
}

function commitGroup(): void {
  if (!group) return;
  clearTimeout(group.timer);
  const { actions, summaries } = group;
  group = null;
  if (actions.length > 0) last = actions.length === 1 ? actions[0] : { kind: "batch", actions };
  announce(summaries);
}

export function beginUndoGroup(size: number): void {
  commitGroup();
  if (size > 1) {
    group = {
      remaining: size,
      actions: [],
      summaries: [],
      timer: setTimeout(commitGroup, 2000),
    };
  }
}

/** Registers an action's inverse. `summary` = announce it (omitted when the
    action is itself an undo, or shouldn't show a toast). */
export function registerUndo(action: UndoAction, summary?: ActionSummary): void {
  if (group) {
    group.actions.push(action);
    if (summary) group.summaries.push(summary);
    if (--group.remaining <= 0) commitGroup();
    return;
  }
  last = action;
  if (summary) announce([summary]);
}

/** Forgets the pending undo (after an irreversible action like Delete forever). */
export function clearUndo(): void {
  commitGroup();
  last = null;
}

/** Drops `action` if it's still the one z would undo (it was undone another way). */
export function forgetUndo(action: UndoAction): void {
  if (last === action) last = null;
}

/** What z would undo, without taking it. */
export function peekUndo(): UndoAction | null {
  return last;
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

// Mutations run by an undo re-register (so z toggles) but don't announce
// themselves: the undo shows its own "Undone". Marked by params identity —
// TanStack hands the same variables object to onMutate.
const quiet = new WeakSet<object>();

/** Marks mutation params as coming from an undo (no action toast). */
export function quietParams<T extends object>(params: T): T {
  const copy = { ...params };
  quiet.add(copy);
  return copy;
}

export function isQuiet(params: object): boolean {
  return quiet.has(params);
}
