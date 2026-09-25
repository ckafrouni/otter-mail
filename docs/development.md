# Development

## Prerequisites

- macOS 26 or newer (the translator uses Apple's Translation framework).
- Node 24 (`engines` in `package.json`) and pnpm 11 via `corepack enable`.
- Full Xcode 26 or newer, selected with `sudo xcode-select -s /Applications/Xcode.app`, to build
  `native/translator`. Without it the app still runs; translation just fails.

## Commands

| Command                  | What it does                                                                   |
| ------------------------ | ------------------------------------------------------------------------------ |
| `pnpm install`           | Installs dependencies and the git pre-commit hook (formats staged files).      |
| `pnpm dev`               | Vite dev server + main-process watcher + Electron, restarting on main changes. |
| `pnpm start`             | Runs the built app unpackaged (`pnpm build` first).                            |
| `pnpm build`             | Builds `apps/web/dist` and `apps/desktop/dist-electron`.                       |
| `pnpm build:translator`  | Builds the Swift translator helper.                                            |
| `pnpm typecheck`         | TypeScript across the workspace.                                               |
| `pnpm lint` / `pnpm fmt` | Oxlint and Oxfmt through Vite+.                                                |
| `pnpm dist:desktop:dmg`  | Unsigned DMG + ZIP for this Mac's architecture in `release/`.                  |

`pnpm dev` picks a port from the worktree path, so several checkouts can run at once. Set
`OTTER_MAIL_PORT_OFFSET` to choose one yourself.

## Data homes

Like T3 Code, data lives under a home, `~/.otter-mail` (or `OTTER_MAIL_HOME`), with one state
directory per kind of run, so development never shares a database with the installed app:

| Run                                            | State directory                                |
| ---------------------------------------------- | ---------------------------------------------- |
| Installed app                                  | `~/.otter-mail/userdata`                       |
| `pnpm dev` / `pnpm start` in the main checkout | `~/.otter-mail/dev`                            |
| `pnpm dev` / `pnpm start` in a linked worktree | `<worktree>/.otter-mail/userdata` (gitignored) |
| `pnpm dev --home <dir>`                        | `<dir>/userdata`                               |

`--home` wins over the worktree default, which wins over an ambient `OTTER_MAIL_HOME`: an
inherited variable pointing at `~/.otter-mail` would otherwise put a branch on the installed
app's database. The rules live in `apps/desktop/src/paths.ts` and
`apps/desktop/scripts/dev-home.mjs`.

A state directory holds the mail cache (`mail-cache.db`), accounts, Google tokens
(`google-tokens.json`, encrypted with a Keychain key), settings, views, keybindings, Chromium's
profile in `chromium/` and logs in `logs/main.log`. Delete it to start fresh.

- Each state directory signs in to its accounts separately. Dev runs are named
  "Otter Mail (Dev)" and use their own Keychain key, so they can't read the installed app's tokens.
- Nothing is ever copied between homes.
- Renderer logs are in the DevTools console (View → Toggle Developer Tools).

## Google sign-in

Accounts sign in through the browser with PKCE and a loopback redirect (`127.0.0.1`), using the
"Desktop app" OAuth client of the `otter-mail` Google Cloud project. The client ID and secret are
baked in at build time and never committed: copy `.env.example` to `.env.local` and fill them in
(Credentials: https://console.cloud.google.com/auth/clients?project=otter-mail). The same
`OTTER_MAIL_GOOGLE_CLIENT_ID` / `OTTER_MAIL_GOOGLE_CLIENT_SECRET` variables override the baked-in
values at runtime.

The consent screen is published but not yet verified by Google, so sign-in shows an "unverified
app" warning and is capped at 100 users. The home page, privacy policy and terms it links to live
in `site/` and are served at https://mail.otterware.dev (deploy with `pnpm deploy:site` after
`wrangler login`).
