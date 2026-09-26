import type { GmailAccount } from "@otter-mail/contracts/gmail";
import { useMemo } from "react";

import * as oauth from "../gmail/oauth";
import * as store from "./db";

export function useAccounts(): GmailAccount[] {
  const revision = store.useRevision();
  return useMemo(() => store.listAccounts(), [revision]);
}

/** Signs in to Google and adds (or refreshes) that account. */
export async function addAccount(loginHint?: string): Promise<GmailAccount> {
  const profile = await oauth.signIn(loginHint);
  const account: GmailAccount = {
    id: profile.email,
    email: profile.email,
    name: profile.name || profile.email,
    picture: profile.picture,
  };
  store.saveAccount(account);
  store.notify();
  return account;
}

/** Signs out of the account and forgets its cached mail. */
export async function removeAccount(accountId: string): Promise<void> {
  await oauth.signOut(accountId);
  store.deleteAccount(accountId);
  store.notify();
}
