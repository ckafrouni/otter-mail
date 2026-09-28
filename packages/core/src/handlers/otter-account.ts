/**
 * The Otter account: sign-in handlers, and the glue that runs while signed
 * in. On connecting to the relay (and hourly after), the linked accounts are
 * reconciled and Gmail watches renewed; Gmail's pushes then trigger syncs.
 */

import { OTTER_ACCOUNT_STATE_CHANNEL, type OtterAccountState } from "@otter-mail/contracts";
import type { MeResponse, RelayEvent } from "@otter-mail/contracts/relay";

import { SignInCancelledError } from "../google.js";
import { broadcast, handle } from "../ipc.js";
import { logger } from "../logger.js";
import { platform } from "../platform.js";
import { listAccounts } from "../services/account-store.js";
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
  signInRedirect,
  signOut,
  signOutDevice,
} from "../services/otter-account.js";
import { forgetSyncedPreferences, pullPreferences } from "../services/preferences.js";
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
      .filter(
        (account) =>
          linked.has(account.email.toLowerCase()) && platform().google.isSignedIn(account.id),
      )
      .map((account) => account.id);
    setPushedAccounts(await renewWatches(accountIds, pushTopic));
  } catch (err) {
    logger.info("otter-account", `Refresh failed: ${String(err)}`);
  }
}

async function syncPreferences(): Promise<void> {
  await pullPreferences().catch((err: unknown) =>
    logger.info("otter-account", `Preferences sync failed: ${String(err)}`),
  );
}

async function onEvent(event: RelayEvent): Promise<void> {
  if (event.type === "accounts") {
    await refresh();
    return;
  }
  if (event.type === "preferences") {
    await syncPreferences();
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
      void syncPreferences();
      // Catch up on whatever changed while disconnected.
      void syncAllAccounts({ force: true, trigger: "push" });
    },
    onEvent: (event) => void onEvent(event),
    onStateChange: (state) => {
      if (state !== "live") setPushedAccounts([]);
      publishState();
    },
    // If the session was ended elsewhere, this 401s and signs this device out.
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
  void forgetSyncedPreferences();
}

export function registerOtterAccountHandlers(): void {
  onOtterAccountChange(() => {
    if (getOtterUser()) start();
    else stop();
    publishState();
  });

  handle("otter:getState", async () => otterState());

  // otter:signIn — "Sign in with Google", for the Otter account only (never
  // a mailbox). The desktop opens Google in the browser; the web app answers
  // `{ redirectTo }` for the page to go sign in (back to `callbackURL`). The
  // renderer gets null when the user cancels.
  handle("otter:signIn", async (params: unknown) => {
    const p = params as { callbackURL?: unknown } | undefined;
    const google = platform().google;
    try {
      if (google.signInForIdToken) {
        await signIn(await google.signInForIdToken());
      } else {
        const callbackURL = typeof p?.callbackURL === "string" ? p.callbackURL : "";
        return { redirectTo: await signInRedirect(callbackURL) };
      }
      return otterState();
    } catch (err) {
      if (err instanceof SignInCancelledError) return null;
      throw err;
    }
  });

  handle("otter:cancelSignIn", async () => {
    platform().google.cancelSignIn();
  });

  handle("otter:signOut", async () => {
    await signOut();
    return otterState();
  });

  handle("otter:listDevices", async () => listDevices());

  handle("otter:signOutDevice", async (params: unknown) => {
    const token = (params as { token?: unknown } | undefined)?.token;
    if (typeof token !== "string") throw new Error('Invalid parameter: "token".');
    await signOutDevice(token);
  });

  // Deletes the Otter account on the relay; this device's Gmail accounts and mail stay.
  handle("otter:deleteAccount", async () => {
    await deleteOtterAccount();
    return otterState();
  });

  if (getOtterUser()) start();
}
