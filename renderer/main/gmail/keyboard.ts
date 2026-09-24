/**
 * Guard for single-key Gmail-style shortcuts: ignore keystrokes aimed at
 * inputs, editors, or any open dialog/popover so typing never triggers mail
 * actions.
 */
export function isTypingTarget(e: KeyboardEvent): boolean {
  const el = e.target;
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return true;
  if (el instanceof HTMLElement && el.isContentEditable) return true;
  return document.querySelector('[role="dialog"], [data-radix-popper-content-wrapper]') != null;
}
