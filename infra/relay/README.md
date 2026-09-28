# Otter Mail relay

https://relay.mail.otterware.dev, a Cloudflare Worker. It gives Otter Mail two things, both
optional (the app works without it):

- **Otter accounts.** Sign in with Google once per Mac, and the Gmail accounts you use come
  along to every Mac. The relay keeps the list of linked addresses and their display names and
  colors. Each Mac still signs in to Gmail itself; the relay never holds Gmail tokens.
- **Realtime mail.** Each Mac asks Gmail (`users.watch`) to publish its mailboxes' changes to the
  `gmail-push` Pub/Sub topic. Pub/Sub pushes each notification (`{ emailAddress, historyId }`,
  no content) to the relay, which forwards it over WebSocket to the Macs of whoever linked that
  address. They sync the change from Gmail within a couple of seconds, instead of on the next poll.

```
Gmail ──users.watch──▶ Pub/Sub topic gmail-push ──push (OIDC)──▶ /push/gmail
                                                                   │ linked_accounts
Mac ◀──── WebSocket /v1/events ◀── UserHub (Durable Object, one per user) ◀┘
```

## Code map

- `src/worker.ts`: routes (Hono). `/v1/auth/*` is better-auth; `/v1/me`, `/v1/accounts` and
  `/v1/events` need a session; `/push/gmail` takes Pub/Sub pushes.
- `src/auth.ts`: better-auth: Google ID-token sign-in, bearer sessions (one per Mac, 90 days,
  renewed with use), device list, account deletion. Signing a session out closes its sockets.
- `src/google-jwt.ts`: verifies Google-signed JWTs (jose): ID tokens, and Pub/Sub's push tokens.
- `src/user-hub.ts`: the Durable Object holding each user's sockets (hibernating).
- `src/schema.ts`, `src/store.ts`: the D1 schema (Drizzle) and the linked-accounts queries.
- `migrations/`: generated with `pnpm db:generate` from `src/schema.ts`.
- API types shared with the app: `packages/contracts/src/relay.ts`.

## Working on it

```sh
pnpm --filter @otter-mail/relay test        # unit + end-to-end tests in workerd (local D1, DO)
pnpm --filter @otter-mail/relay dev         # wrangler dev on :8787
pnpm --filter @otter-mail/relay db:generate # after changing src/schema.ts
```

The end-to-end tests run the real Worker with a local D1 and Durable Object; a local JWKS server
plays Google and signs the ID and push tokens.

## Deploying

Needs Cloudflare credentials for wrangler (`wrangler login`, or `CLOUDFLARE_API_TOKEN`):

```sh
pnpm --filter @otter-mail/relay run deploy   # applies D1 migrations, then deploys
pnpm --filter @otter-mail/relay smoke        # checks production end to end (needs gcloud)
```

The smoke test signs in with a real Google ID token (minted by gcloud for the push service
account), links its address, publishes a notification to the real topic and waits for it on the
socket, then deletes the account.

## Google Cloud setup (project `otter-mail`, done once)

- Topic `gmail-push`; `gmail-api-push@system.gserviceaccount.com` has Pub/Sub Publisher on it.
- Service account `gmail-push-relay@otter-mail.iam.gserviceaccount.com`: Pub/Sub signs push
  requests as it (the relay checks the token's audience and email).
- Push subscription `gmail-push-relay` → `https://relay.mail.otterware.dev/push/gmail`, OIDC
  token with that URL as audience; 10 minutes retention (a missed notification only delays a
  sync: the app still polls every few minutes).

Secrets: `BETTER_AUTH_SECRET` (`wrangler secret put BETTER_AUTH_SECRET`).
