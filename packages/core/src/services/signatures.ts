/**
 * Signatures live in Gmail (one per send-as address), so they're the same in
 * Gmail on the web and on every device. The account keeps a copy for the
 * composer, refreshed from Gmail. A signature from before, kept only in Otter
 * Mail, moves to Gmail once.
 *
 * Reading needs only the Gmail scope; saving needs gmail.settings.basic,
 * which sign-ins from before it was added lack: saving then asks to sign in
 * again (GMAIL_SETTINGS_PERMISSION).
 */

import { GMAIL_SETTINGS_PERMISSION } from "@otter-mail/contracts";

import { broadcast } from "../ipc.js";
import { logger } from "../logger.js";
import { platform } from "../platform.js";
import { listAccounts, updateAccount } from "./account-store.js";
import { GmailApiError, getSignature, setSignature } from "./gmail-api.js";
import type { GmailAccount } from "../types.js";

/** Saves the signature in Gmail, then keeps its copy. */
export async function saveSignature(account: GmailAccount, html: string): Promise<GmailAccount> {
  let saved: string;
  try {
    saved = await setSignature(account.id, account.email, html);
  } catch (err) {
    if (err instanceof GmailApiError && err.status === 403) {
      throw new Error(GMAIL_SETTINGS_PERMISSION, { cause: err });
    }
    throw err;
  }
  return updateAccount(account.id, { signature: saved, signatureInGmail: true });
}

async function refreshSignature(account: GmailAccount): Promise<boolean> {
  const inGmail = await getSignature(account.id, account.email);
  if (!account.signatureInGmail && !inGmail && account.signature) {
    // Kept only here until now: move it to Gmail (if this sign-in may).
    await saveSignature(account, account.signature).catch((err: unknown) =>
      logger.info(
        "signatures",
        `Couldn't move ${account.email}'s signature to Gmail: ${String(err)}`,
      ),
    );
    return true;
  }
  if (account.signatureInGmail && (account.signature ?? "") === inGmail) return false;
  await updateAccount(account.id, { signature: inGmail, signatureInGmail: true });
  return true;
}

/** Brings every signed-in account's signature up to date with Gmail. */
export async function refreshSignatures(): Promise<void> {
  let changed = false;
  for (const account of await listAccounts()) {
    if (!platform().google.isSignedIn(account.id)) continue;
    try {
      changed = (await refreshSignature(account)) || changed;
    } catch (err) {
      logger.info("signatures", `Couldn't read ${account.email}'s signature: ${String(err)}`);
    }
  }
  if (changed) broadcast("gmail:accounts-changed");
}
