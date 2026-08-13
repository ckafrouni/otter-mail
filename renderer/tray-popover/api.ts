import type { GmailAccount, GmailMessageSummary } from "../main/gmail/types";

const ipc = <T = unknown>(channel: string, params?: unknown): Promise<T> =>
  window.glazeAPI.glaze.ipc.invoke<T>(channel, params);

export type TrayAccountSnapshot = {
  account: GmailAccount;
  unreadCount: number;
  messages: GmailMessageSummary[];
};

export type TraySnapshot = {
  accounts: TrayAccountSnapshot[];
  totalUnread: number;
};

export const trayApi = {
  getSnapshot: () => ipc<TraySnapshot>("tray:getSnapshot"),
  openThread: (accountId: string, messageId: string) => ipc<void>("tray:openThread", { accountId, messageId }),
  compose: () => ipc<void>("tray:compose"),
  sync: () => ipc<{ ok: boolean }>("tray:sync"),
  openApp: () => ipc<void>("tray:openApp"),
  quit: () => ipc<void>("tray:quit"),
  hide: () => ipc<void>("tray:hide"),
};
