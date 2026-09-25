/**
 * tray-popover-window.ts
 *
 * The rich "mini inbox" panel that opens under the menu-bar icon (replaces
 * the old native dropdown). One singleton window, repositioned under the
 * tray's current bounds and shown/hidden on each tray click.
 *
 * Click-to-toggle has a classic pitfall: clicking the tray icon while the
 * popover is open blurs it (hiding it) *before* the click handler runs, so a
 * naive toggle would immediately reshow it. `lastHiddenAt` lets the toggle
 * recognize "this click is the one that just blurred us" and skip the
 * reshow, so a second click on the icon actually closes the popover.
 */

import { BrowserWindow, screen } from "electron";
import { openLinksExternally } from "./main-window.js";
import { getPreloadPath, getWindowUrl } from "./window-paths.js";

const POPOVER_WIDTH = 340;
const POPOVER_HEIGHT = 480;
const REOPEN_GUARD_MS = 200;

let popover: BrowserWindow | null = null;
let lastHiddenAt = 0;

// Told whenever the popover opens or closes, so the menu-bar icon can show
// its selected (highlighted) state while the popover is up.
let visibilityListener: ((open: boolean) => void) | null = null;

export function setTrayPopoverVisibilityListener(listener: (open: boolean) => void): void {
  visibilityListener = listener;
}

function notifyVisibility(open: boolean): void {
  visibilityListener?.(open);
}

async function ensurePopover(): Promise<BrowserWindow> {
  if (popover && !popover.isDestroyed()) return popover;

  popover = new BrowserWindow({
    width: POPOVER_WIDTH,
    height: POPOVER_HEIGHT,
    // A panel can float over full-screen apps, like a status-item menu.
    type: "panel",
    frame: false,
    roundedCorners: true,
    backgroundColor: "#00000000",
    vibrancy: "popover",
    visualEffectState: "active",
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    hiddenInMissionControl: true,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: true,
    show: false,
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  popover.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  openLinksExternally(popover);
  popover.on("blur", () => {
    lastHiddenAt = Date.now();
    popover?.hide();
    notifyVisibility(false);
  });

  const url = getWindowUrl("tray-popover.html");
  await popover.loadURL(url);
  return popover;
}

/**
 * The tray click event's `bounds.y`/`height` are unreliable for vertical
 * placement (menu-bar bounds can come through in a flipped coordinate space),
 * which was pushing the popover toward the bottom of the screen instead of
 * just under the menu bar. `bounds.x` is unaffected (flipping is vertical
 * only), so pick the display by x-range and anchor purely off its
 * `workArea.y` — the pixel row right below that display's menu bar — rather
 * than trusting the tray bounds' vertical values at all.
 */
function displayForX(centerX: number) {
  const displays = screen.getAllDisplays();
  return (
    displays.find((d) => centerX >= d.bounds.x && centerX < d.bounds.x + d.bounds.width) ??
    screen.getPrimaryDisplay()
  );
}

function positionPopover(
  win: BrowserWindow,
  bounds: { x: number; y: number; width: number; height: number },
): void {
  const centerX = Math.round(bounds.x + bounds.width / 2);
  const { workArea } = displayForX(centerX);
  const minX = workArea.x + 8;
  const maxX = workArea.x + workArea.width - POPOVER_WIDTH - 8;
  const x = Math.min(Math.max(Math.round(centerX - POPOVER_WIDTH / 2), minX), maxX);
  const y = workArea.y + 4;
  win.setPosition(x, y);
}

/** Toggle the popover open/closed, anchored under the tray icon's current bounds. */
export async function toggleTrayPopover(bounds: {
  x: number;
  y: number;
  width: number;
  height: number;
}): Promise<void> {
  const win = await ensurePopover();
  if (win.isVisible()) {
    win.hide();
    notifyVisibility(false);
    return;
  }
  if (Date.now() - lastHiddenAt < REOPEN_GUARD_MS) return;

  positionPopover(win, bounds);
  win.show();
  notifyVisibility(true);
  // Focus just this window — app.focus({steal:true}) would raise every
  // window in the app, including the (possibly hidden) main window.
  win.focus();
}

export function hideTrayPopover(): void {
  popover?.hide();
  notifyVisibility(false);
}

export function isTrayPopoverOpen(): boolean {
  return popover != null && !popover.isDestroyed() && popover.isVisible();
}

export function destroyTrayPopover(): void {
  popover?.destroy();
  popover = null;
  notifyVisibility(false);
}
