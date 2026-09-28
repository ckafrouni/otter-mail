/**
 * The Otter Mail relay's HTTP API (infra/relay), shared by the Worker and the
 * desktop app. The relay knows who an Otter account is, which Gmail addresses
 * it has linked, and when Gmail says one of them changed. It never sees mail
 * or Gmail tokens.
 *
 * Otter accounts are better-auth's, under `/v1/auth` (the app uses
 * better-auth's client): `sign-in/social` with `{ provider: "google",
 * idToken: { token } }` answers with the session token in the
 * `set-auth-token` header; `sign-out`, `list-sessions`, `revoke-session` and
 * `delete-user` manage devices and the account.
 *
 * The routes below take `Authorization: Bearer <session token>` and answer
 * errors as `{ error: string }`.
 */

/** The person signed in to Otter Mail (they sign in with Google). */
export interface RelayUser {
  id: string;
  email: string;
  name: string | null;
  picture: string | null;
}

/** A Gmail account linked to an Otter account, with the profile shown in the app. */
export interface RelayAccount {
  email: string;
  name: string | null;
  picture: string | null;
  /** User-set overrides, as edited in Settings › Accounts. */
  displayName: string | null;
  color: string | null;
}

/** `GET /v1/me` */
export interface MeResponse {
  user: RelayUser;
  /** The Pub/Sub topic to pass to Gmail's `users.watch`. */
  pushTopic: string;
}

/** `GET /v1/accounts` */
export interface ListAccountsResponse {
  accounts: RelayAccount[];
}

/**
 * `PUT /v1/accounts/:email`: link a Gmail account or update its profile.
 * Linking needs `idToken`, a Google ID token for that address proving the
 * caller signed in to it; updating an already linked account doesn't.
 */
export interface PutAccountRequest {
  idToken?: string;
  name?: string | null;
  picture?: string | null;
  displayName?: string | null;
  color?: string | null;
}

/**
 * Messages on the `GET /v1/events` WebSocket. Clients may send the text
 * `ping`; the relay answers `pong`.
 */
export type RelayEvent =
  /** Gmail changed this mailbox: sync it (`historyId` is Gmail's new cursor). */
  | { type: "mail"; email: string; historyId: string }
  /** The linked accounts changed (another device linked, unlinked or edited one). */
  | { type: "accounts" };
