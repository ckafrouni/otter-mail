# Otter Mail

Otter Mail is a calm, fast Gmail client: an Electron app for macOS, and the same app in the
browser at https://mail.otterware.dev. It is laid out like Otter Code (our fork of T3 Code): a
pnpm monorepo built with Vite+ (`vp`); the Mac app ships through GitHub Releases with
auto-update.

## Where code lives

- `packages/core`: the mail backend, shared by both apps: Gmail API client, quota, the SQLite
  mail cache, sync, the JSON stores, the Otter account (better-auth client), mailboxes synced
  across devices, realtime push, and the handlers the UI calls. It is plain TypeScript: anything
  platform-specific goes through the `Platform` interface (`src/platform.ts`).
- `apps/desktop`: the Electron main process (`src/main.ts`), which runs core with the desktop
  platform (`src/platform.ts`: node:sqlite, safeStorage, dialogs, the Dock), and the preload.
  - `src/handlers/`: the Mac-only handlers (tray, default mail app, …).
  - `src/services/`: Google sign-in (loopback OAuth), tray, Apple's translator, the local assistants
    (Claude, Codex; Hermes is in core), default mail app.
  - `src/windows/`: the main window, the menu-bar popover, and where their pages load from.
  - `src/updates.ts`: electron-updater against GitHub Releases.
- `apps/web`: the React renderer, one build for both apps. `index.html` is the main window,
  `tray-popover.html` the menu-bar mini inbox. UI primitives live in `src/components/ui/`.
  `src/web/` is the browser shell: core in a Web Worker (SQLite WASM on OPFS) hosted by one
  tab for every open tab (`backend.ts`), and the bridge that stands in for the preload. What only the Mac app has is off in `desktopBridge.features`.
- `packages/contracts`: types shared by both sides, including `DesktopBridge`, the
  `window.desktopBridge` API the preload exposes, and the relay's API (`src/relay.ts`).
- `infra/relay`: https://relay.mail.otterware.dev, a Cloudflare Worker (Hono, better-auth,
  Drizzle on D1, a Durable Object per user). Otter accounts, the Gmail accounts linked to them,
  the account's preferences (core's `services/preferences.ts` syncs them), and realtime mail: Gmail → Pub/Sub → relay → WebSocket to each signed-in device. It never sees
  mail; the web app's Gmail tokens pass through it (never stored), the Mac app's never do. See its
  README.
- `native/translator`: a Swift command-line helper for Apple's on-device Translation. It reads a
  JSON request on stdin and prints JSON. Building it needs full Xcode (macOS 26 SDK).
- `scripts/`: dev runner, desktop packaging (`build-desktop-artifact.ts`), release helpers.
- `assets/`: app icons like T3 Code's: `prod/` for releases, `dev/` for the blueprint variant that
  unpackaged runs wear. `pnpm icons:export` regenerates the dev icon and both `.icns` files.
- `site/`: https://mail.otterware.dev, a Cloudflare Worker: the landing page, privacy policy and
  terms, and the web app (`/` shows the app when signed in, `/app` always).
- Deploys: Cloudflare Workers Builds deploys `infra/relay` and `site/` on pushes to `main` that
  touch them; GitHub Actions smoke-tests the relay every 6 hours (keyless Google Cloud access).

## How the pieces talk

The app is local-first: it talks to Gmail directly and renders from its SQLite cache. The Otter
account (the user button by Back in Settings) is who you are; mailboxes are the Gmail accounts
it holds, which follow you to every device, with push from the relay. The Mac app works without
it; the web app needs it (the relay keeps its Gmail sign-ins alive).

- Renderer → backend: `window.desktopBridge.invoke(channel, params)` → a handler registered with
  core's `handle(channel, …)` (served over Electron IPC, or Worker messages on the web), or an
  `ipcMain.handle` for the Mac-only ones.
- Backend → renderer: `broadcast(channel, params)` → `window.desktopBridge.on(channel, listener)`.
- Keep channel names stable; both sides refer to them by string.
- Renderer code never touches Electron, Node or the backend directly. Anything new goes through a
  handler; anything platform-specific in core goes through the Platform.

## Dev

- `pnpm install`, then `pnpm dev` (Vite dev server + main-process watcher + Electron with reload).
- The web app: `pnpm --filter @otter-mail/relay dev` (the relay on :8787) and
  `VITE_RELAY_URL=http://localhost:8787 pnpm dev:web` (on :5833); see docs/development.md.
- `pnpm start` runs the built app unpackaged; `pnpm dist:desktop:dmg` builds a DMG in `release/`.
- Data homes (`apps/desktop/src/paths.ts`, as in T3 Code): the installed app uses
  `~/.otter-mail/userdata`; dev runs use `~/.otter-mail/dev`, or `<worktree>/.otter-mail` in a
  linked worktree. `pnpm dev --home <dir>` overrides. Never point dev at the installed app's home.
- Main-process logs: the terminal, and `logs/main.log` in the state directory.

## Releases

Stable only (no nightlies): run the Release workflow from `main` with a patch/minor/major bump, or
push a `vX.Y.Z` tag. Installed apps download updates on their own and offer "Restart to update" in
the sidebar. Details in `docs/release.md`.

## Verifying

Before handing work back, run and fix:

- `pnpm typecheck`
- `pnpm lint`
- `pnpm fmt`

For UI or behavior changes, run the app and check the change in it.

## Taste

- Small, obvious code. Don't add machinery a change doesn't need.
- Match the surrounding code: its naming, comment density and idioms.
- The mail cache is local-first: the UI renders from SQLite and sync catches up. Keep IPC
  payloads small and never block the renderer on Gmail.
- The Mac app targets macOS only (Apple Translation, the Dock badge, the menu-bar popover); the
  web app runs in current browsers. Gate Mac-only UI with `features`, never with ad-hoc checks.
