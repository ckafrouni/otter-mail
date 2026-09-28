# Otter Mail relay

https://relay.mail.otterware.dev, a Cloudflare Worker. It gives Otter Mail three things (the
Mac app works without it; the web app needs it):

- **Otter accounts.** Sign in with Google once per Mac, and the Gmail accounts you use come
  along to every Mac. The relay keeps the list of linked addresses and their display names and
  colors. Each Mac still signs in to Gmail itself; the relay never holds Gmail tokens.
- **Gmail sign-in for the web app.** A browser can't keep a Google refresh token by itself, so
  the relay does the OAuth exchange with the web client and seals the refresh token (only the
  relay can open it, and only for the Otter user it was issued to). The browser keeps the sealed
  token and asks `/v1/gmail/token` for fresh access tokens. Nothing is stored here. See
  `src/gmail.ts`.
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
- `src/auth.ts`: better-auth: Google sign-in (ID tokens from the Mac app, the redirect flow for
  the web app), sessions (bearer tokens for the Mac app, a cookie shared with mail.otterware.dev
  for the web app; one per device, 90 days, renewed with use), device list, account deletion.
  Signing a session out closes its sockets.
- `src/gmail.ts`: the web app's Gmail sign-in popup, and token refreshes.
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

Cloudflare Workers Builds deploys on every push to `main` that touches `infra/relay/`,
`packages/contracts/` or `pnpm-lock.yaml` (trigger "Deploy relay from main" on the
`otter-mail-relay` Worker): it installs the workspace from the repo root and runs
`pnpm --filter @otter-mail/relay run deploy`, which applies D1 migrations and deploys. Builds and
logs are in the Cloudflare dashboard (Workers → otter-mail-relay → Deployments) and on the
commit's checks. `site/` deploys the same way ("Deploy site from main").

The Relay smoke test workflow checks production every 6 hours (and on demand): it signs in with a
real Google ID token, links the address, publishes a notification to the real topic, waits for it
on the socket, and deletes the account. To run it from a laptop:

```sh
pnpm --filter @otter-mail/relay smoke   # needs gcloud; Token Creator on relay-smoke
```

A manual deploy, if ever needed: `pnpm --filter @otter-mail/relay run deploy` with wrangler
credentials (`wrangler login`, or `CLOUDFLARE_API_TOKEN`).

## Google Cloud setup (project `otter-mail`, done once)

- Topic `gmail-push`; `gmail-api-push@system.gserviceaccount.com` has Pub/Sub Publisher on it.
- Service account `gmail-push-relay@otter-mail.iam.gserviceaccount.com`: Pub/Sub signs push
  requests as it (the relay checks the token's audience and email). Nobody else may impersonate
  it.
- Service account `relay-smoke@otter-mail.iam.gserviceaccount.com`: the smoke test's identity.
- Workload Identity pool `github`, provider `otter-mail`: GitHub Actions in
  `ckafrouni/otter-mail` (only) may mint `relay-smoke` ID tokens and publish to `gmail-push`. No
  service account keys exist.
- Push subscription `gmail-push-relay` → `https://relay.mail.otterware.dev/push/gmail`, OIDC
  token with that URL as audience; 10 minutes retention (a missed notification only delays a
  sync: the app still polls every few minutes).

Secrets (`wrangler secret put …`): `BETTER_AUTH_SECRET` (also keys the Gmail token sealing),
`GOOGLE_WEB_CLIENT_SECRET` (the "Web application" OAuth client, whose ID is `GOOGLE_WEB_CLIENT_ID`
in `wrangler.jsonc`). Locally, put them in `.dev.vars` (gitignored).
