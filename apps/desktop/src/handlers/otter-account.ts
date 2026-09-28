/**
 * The Otter account: sign-in handlers, and the glue that runs while signed
 * in. On connecting to the relay (and hourly after), the linked accounts are
 * reconciled and Gmail watches renewed; Gmail's pushes then trigger syncs.
 */

import { ipcMain } from "electron";

import { OTTER_ACCOUNT_STATE_CHANNEL, type OtterAccountState } from "@otter-mail/contracts";
import type { MeResponse, RelayEvent } from "@otter-mail/contracts/relay";

import { broadcast } from "../ipc.js";
import { logger } from "../logger.js";
import { getAccount, listAccounts } from "../services/account-store.js";
import {
  cancelSignIn,
  getIdToken,
  isSignedIn,
  signInForIdToken,
  SignInCancelledError,
} from "../services/gmail-oauth.js";
import { renewWatches } from "../services/gmail-watch.js";
import {
  clearLinkedSnapshot,
  linkedAccountIds,
  reconcileAccounts,
} from "../services/linked-accounts.js";
import { setPushedAccounts, syncAccount, syncAllAccounts } from "../services/mail-sync.js";
import {
  deleteOtterAccount,
  getOtterUser,
  listDevices,
  onOtterAccountChange,
  relayRequest,
  signIn,
  signOut,
  signOutDevice,
} from "../services/otter-account.js";
import { getRealtimeState, startRealtime, stopRealtime } from "../services/realtime.js";
import { removeLocalAccount } from "./gmail.js";

const REFRESH_EVERY_MS = 60 * 60_000;
let refreshTimer: ReturnType<typeof setInterval> | null = null;

function otterState(): OtterAccountState {
  const user = getOtterUser();
  return {
    user: user && { email: user.email, name: user.name, picture: user.picture },
    realtime: getRealtimeState(),
  };
}

const publishState = () => broadcast(OTTER_ACCOUNT_STATE_CHANNEL, otterState());

let refreshing: Promise<void> | null = null;
let refreshAgain = false;

/**
 * Reconciles the linked accounts, then makes sure Gmail pushes every linked,
 * signed-in account's changes; accounts it can't watch keep polling. Calls
 * made while one runs coalesce into a single rerun.
 */
function refresh(): Promise<void> {
  if (refreshing) {
    refreshAgain = true;
    return refreshing;
  }
  refreshing = (async () => {
    do {
      refreshAgain = false;
      await refreshOnce();
    } while (refreshAgain);
  })().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

async function refreshOnce(): Promise<void> {
  try {
    const { pushTopic } = await relayRequest<MeResponse>("GET", "/v1/me");
    await reconcileAccounts(removeLocalAccount);
    const linked = linkedAccountIds();
    const accountIds = (await listAccounts())
      .filter((account) => linked.has(account.email.toLowerCase()) && isSignedIn(account.id))
      .map((account) => account.id);
    setPushedAccounts(await renewWatches(accountIds, pushTopic));
  } catch (err) {
    logger.info("otter-account", `Refresh failed: ${String(err)}`);
  }
}

async function onEvent(event: RelayEvent): Promise<void> {
  if (event.type === "accounts") {
    await refresh();
    return;
  }
  const account = (await listAccounts()).find(
    (a) => a.email.toLowerCase() === event.email.toLowerCase(),
  );
  if (!account) return;
  logger.info("otter-account", "Gmail pushed a change", { accountId: account.id });
  syncAccount(account.id, { force: true, trigger: "push" });
}

function start(): void {
  startRealtime({
    onConnected: () => {
      void refresh();
      // Catch up on whatever changed while disconnected.
      void syncAllAccounts({ force: true, trigger: "push" });
    },
    onEvent: (event) => void onEvent(event),
    onStateChange: (state) => {
      if (state !== "live") setPushedAccounts([]);
      publishState();
    },
    // If the session was ended elsewhere, this 401s and signs this Mac out.
    onRefused: () => void relayRequest("GET", "/v1/me").catch(() => {}),
  });
  refreshTimer ??= setInterval(() => {
    if (getRealtimeState() === "live") void refresh();
  }, REFRESH_EVERY_MS);
}

function stop(): void {
  stopRealtime();
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = null;
  setPushedAccounts([]);
  clearLinkedSnapshot();
}

export function registerOtterAccountHandlers(): void {
  onOtterAccountChange(() => {
    if (getOtterUser()) start();
    else stop();
    publishState();
  });

  ipcMain.handle("otter:getState", async () => otterState());

  // otter:signIn — with an accountId, signs in as that Gmail account's Google
  // identity (no browser); without, opens Google in the browser. The renderer
  // gets null when the user cancels.
  ipcMain.handle("otter:signIn", async (_event, params: unknown) => {
    const accountId = (params as { accountId?: unknown } | undefined)?.accountId;
    try {
      if (typeof accountId !== "string") {
        await signIn(await signInForIdToken());
        return otterState();
      }
      const account = await getAccount(accountId);
      await signIn(await getIdToken(accountId), account ?? undefined);
      return otterState();
    } catch (err) {
      if (err instanceof SignInCancelledError) return null;
      throw err;
    }
  });

  ipcMain.handle("otter:cancelSignIn", async () => {
    cancelSignIn();
  });

  ipcMain.handle("otter:signOut", async () => {
    await signOut();
    return otterState();
  });

  ipcMain.handle("otter:listDevices", async () => listDevices());

  ipcMain.handle("otter:signOutDevice", async (_event, params: unknown) => {
    const token = (params as { token?: unknown } | undefined)?.token;
    if (typeof token !== "string") throw new Error('Invalid parameter: "token".');
    await signOutDevice(token);
  });

  // Deletes the Otter account on the relay; this Mac's Gmail accounts and mail stay.
  ipcMain.handle("otter:deleteAccount", async () => {
    await deleteOtterAccount();
    return otterState();
  });

  if (getOtterUser()) start();
}
