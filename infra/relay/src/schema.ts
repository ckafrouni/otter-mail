/**
 * The relay's D1 schema. `pnpm db:generate` turns changes here into a SQL
 * migration in migrations/; deploying applies it.
 *
 * `user`, `session`, `account` and `verification` are better-auth's tables
 * (its core schema, https://www.better-auth.com/docs/concepts/database);
 * `linked_accounts` and `preferences` are the relay's own.
 */

import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

const createdAt = () =>
  integer({ mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date());
const updatedAt = () =>
  integer({ mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date())
    .$onUpdateFn(() => new Date());

/** Otter accounts. */
export const user = sqliteTable("user", {
  id: text().primaryKey(),
  name: text().notNull(),
  email: text().notNull().unique(),
  emailVerified: integer({ mode: "boolean" }).notNull().default(false),
  image: text(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** One per signed-in device. */
export const session = sqliteTable(
  "session",
  {
    id: text().primaryKey(),
    expiresAt: integer({ mode: "timestamp_ms" }).notNull(),
    token: text().notNull().unique(),
    ipAddress: text(),
    userAgent: text(),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("session_user").on(t.userId)],
);

/** The Google identity an Otter account signs in with. */
export const account = sqliteTable(
  "account",
  {
    id: text().primaryKey(),
    accountId: text().notNull(),
    providerId: text().notNull(),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text(),
    refreshToken: text(),
    idToken: text(),
    accessTokenExpiresAt: integer({ mode: "timestamp_ms" }),
    refreshTokenExpiresAt: integer({ mode: "timestamp_ms" }),
    scope: text(),
    password: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("account_user").on(t.userId)],
);

export const verification = sqliteTable("verification", {
  id: text().primaryKey(),
  identifier: text().notNull(),
  value: text().notNull(),
  expiresAt: integer({ mode: "timestamp_ms" }).notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** Gmail accounts linked to an Otter account, with the profile the app shows. */
export const linkedAccounts = sqliteTable(
  "linked_accounts",
  {
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** Lowercased. */
    email: text().notNull(),
    name: text(),
    picture: text(),
    displayName: text(),
    color: text(),
    linkedAt: integer({ mode: "timestamp_ms" }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.email] }),
    // Gmail push notifications look accounts up by address.
    index("linked_accounts_email").on(t.email),
  ],
);

/** Each Otter account's preferences (contracts' `Preferences`), synced to its devices. */
export const preferences = sqliteTable("preferences", {
  userId: text()
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  /** JSON: section name → value. */
  data: text().notNull(),
  /** The Hermes API key, encrypted (only the relay can open it). */
  hermesKey: text(),
  updatedAt: updatedAt(),
});
