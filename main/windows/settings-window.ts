export type SettingsTarget = {
  pane: "general" | "appearance" | "accounts" | "views" | "assistant";
  /** For the views pane: a view id to edit, or "new" to create one. */
  viewId?: string | null;
  /** For "new": which mailbox (account id or "__combined__") owns the view. */
  mailbox?: string | null;
};

// Where the in-app settings page should navigate on open. The main window
// pulls this via window:getSettingsTarget on mount and on settings:open.
let pendingTarget: SettingsTarget | null = null;

export function setSettingsTarget(target: SettingsTarget): void {
  pendingTarget = target;
}

export function takeSettingsTarget(): SettingsTarget | null {
  const target = pendingTarget;
  pendingTarget = null;
  return target;
}
