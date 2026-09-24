/**
 * account-store.ts
 *
 * Persists non-sensitive GmailAccount metadata to userData/accounts.json.
 * Tokens are never stored here; they live in OAuthService (safeStorage).
 */

import fs from "fs/promises";
import path from "path";
import { app } from "@glaze/core/backend";
import type { GmailAccount } from "../gmail/types.js";

async function getAccountsPath(): Promise<string> {
  const userDataPath = app.getPath("userData");
  await fs.mkdir(userDataPath, { recursive: true });
  return path.join(userDataPath, "accounts.json");
}

async function readAccounts(): Promise<GmailAccount[]> {
  try {
    const filePath = await getAccountsPath();
    const data = await fs.readFile(filePath, "utf-8");
    return JSON.parse(data) as GmailAccount[];
  } catch {
    return [];
  }
}

async function writeAccounts(accounts: GmailAccount[]): Promise<void> {
  const filePath = await getAccountsPath();
  await fs.writeFile(filePath, JSON.stringify(accounts, null, 2), "utf-8");
}

export async function listAccounts(): Promise<GmailAccount[]> {
  return readAccounts();
}

export async function addAccount(account: GmailAccount): Promise<void> {
  const accounts = await readAccounts();
  const exists = accounts.findIndex((a) => a.id === account.id);
  if (exists >= 0) {
    accounts[exists] = account;
  } else {
    accounts.push(account);
  }
  await writeAccounts(accounts);
}

export async function removeAccount(accountId: string): Promise<void> {
  const accounts = await readAccounts();
  const filtered = accounts.filter((a) => a.id !== accountId);
  await writeAccounts(filtered);
}

export async function getAccount(accountId: string): Promise<GmailAccount | null> {
  const accounts = await readAccounts();
  return accounts.find((a) => a.id === accountId) ?? null;
}

export async function updateAccount(
  accountId: string,
  patch: { displayName?: string; color?: string; signature?: string },
): Promise<GmailAccount> {
  const accounts = await readAccounts();
  const index = accounts.findIndex((a) => a.id === accountId);
  if (index < 0) {
    throw new Error(`Account not found: ${accountId}`);
  }
  const current = accounts[index];
  const updated: GmailAccount = {
    ...current,
    displayName:
      patch.displayName !== undefined ? patch.displayName || undefined : current.displayName,
    color: patch.color !== undefined ? patch.color : current.color,
    signature: patch.signature !== undefined ? patch.signature || undefined : current.signature,
  };
  accounts[index] = updated;
  await writeAccounts(accounts);
  return updated;
}
