import type { DesktopBridge } from "@otter-mail/contracts";

declare global {
  interface Window {
    /** Exposed by the Electron preload script (apps/desktop). */
    desktopBridge: DesktopBridge;
  }
}

export {};
