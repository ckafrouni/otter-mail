/**
 * A conversation another surface (the menu-bar popover) asked the main window
 * to open. The main window pulls it via `window:takePendingOpenMessage` on
 * mount and whenever `mail:open` is broadcast — the same handoff used for
 * settings deep links and mailto: targets.
 */
export type OpenMessageTarget = { accountId: string; messageId: string };

let pending: OpenMessageTarget | null = null;

export function setPendingOpenMessage(target: OpenMessageTarget): void {
  pending = target;
}

export function takePendingOpenMessage(): OpenMessageTarget | null {
  const target = pending;
  pending = null;
  return target;
}
