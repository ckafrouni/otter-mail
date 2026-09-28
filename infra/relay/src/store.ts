/**
 * Queries over the relay's own tables, linked_accounts and preferences
 * (schema.ts). Users and sessions belong to better-auth (auth.ts).
 */

import { and, asc, eq } from "drizzle-orm";
import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import type { Preferences, RelayAccount } from "@otter-mail/contracts/relay";

import * as schema from "./schema.ts";

const { linkedAccounts, preferences } = schema;

export type Db = DrizzleD1Database<typeof schema>;

export const openDb = (d1: D1Database): Db => drizzle(d1, { schema, casing: "snake_case" });

const accountFields = {
  email: linkedAccounts.email,
  name: linkedAccounts.name,
  picture: linkedAccounts.picture,
  displayName: linkedAccounts.displayName,
  color: linkedAccounts.color,
};

export async function listAccounts(db: Db, userId: string): Promise<RelayAccount[]> {
  return db
    .select(accountFields)
    .from(linkedAccounts)
    .where(eq(linkedAccounts.userId, userId))
    .orderBy(asc(linkedAccounts.linkedAt), asc(linkedAccounts.email));
}

export async function isLinked(db: Db, userId: string, email: string): Promise<boolean> {
  const [row] = await db
    .select({ email: linkedAccounts.email })
    .from(linkedAccounts)
    .where(and(eq(linkedAccounts.userId, userId), eq(linkedAccounts.email, email)));
  return row !== undefined;
}

/** Profile fields to write: a field left out keeps its value, `null` clears it. */
export type AccountPatch = Partial<Omit<RelayAccount, "email">>;

/** Links the account, or updates the fields present in `patch` if it's linked already. */
export async function putAccount(
  db: Db,
  userId: string,
  email: string,
  patch: AccountPatch,
): Promise<void> {
  const insert = db
    .insert(linkedAccounts)
    .values({ userId, email, ...patch, linkedAt: new Date() });
  await (Object.keys(patch).length > 0
    ? insert.onConflictDoUpdate({
        target: [linkedAccounts.userId, linkedAccounts.email],
        set: patch,
      })
    : insert.onConflictDoNothing());
}

/** Unlinks the account; false when it wasn't linked. */
export async function deleteAccount(db: Db, userId: string, email: string): Promise<boolean> {
  const removed = await db
    .delete(linkedAccounts)
    .where(and(eq(linkedAccounts.userId, userId), eq(linkedAccounts.email, email)))
    .returning({ email: linkedAccounts.email });
  return removed.length > 0;
}

/** Everyone who linked this Gmail address (normally one Otter account). */
export async function usersWithMailbox(db: Db, email: string): Promise<string[]> {
  const rows = await db
    .select({ userId: linkedAccounts.userId })
    .from(linkedAccounts)
    .where(eq(linkedAccounts.email, email));
  return rows.map((row) => row.userId);
}

/** The account's preferences, and its Hermes key as stored (sealed). */
export async function getPreferences(
  db: Db,
  userId: string,
): Promise<{ data: Preferences; hermesKey: string | null }> {
  const row = await db.query.preferences.findFirst({ where: eq(preferences.userId, userId) });
  return {
    data: row ? (JSON.parse(row.data) as Preferences) : {},
    hermesKey: row?.hermesKey ?? null,
  };
}

export async function putPreferences(
  db: Db,
  userId: string,
  next: { data: Preferences; hermesKey: string | null },
): Promise<void> {
  const values = { data: JSON.stringify(next.data), hermesKey: next.hermesKey };
  await db
    .insert(preferences)
    .values({ userId, ...values })
    .onConflictDoUpdate({ target: preferences.userId, set: { ...values, updatedAt: new Date() } });
}
