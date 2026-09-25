# Otter Mail

Otter Mail is a calm, fast Gmail client for macOS. It is an Electron app laid out like Otter Code
(our fork of T3 Code): a pnpm monorepo built with Vite+ (`vp`), released through GitHub
Releases with auto-update.

## Where code lives

- `apps/desktop`: the Electron main process (`src/main.ts`) and the preload (`src/preload.ts`).
  - `src/handlers/`: `ipcMain.handle` handlers, one file per area (gmail, assistant, search, …).
  - `src/services/`: Gmail API client, OAuth, the SQLite mail cache (`node:sqlite`), sync,
    notifications, tray, translator, assistant providers (Claude, Codex, Hermes).
  - `src/windows/`: the main window, the menu-bar popover, and where their pages load from.
  - `src/updates.ts`: electron-updater against GitHub Releases.
- `apps/web`: the React renderer. `index.html` is the main window, `tray-popover.html` the
  menu-bar mini inbox. UI primitives live in `src/components/ui/`.
- `packages/contracts`: types shared by both sides, including `DesktopBridge`, the
  `window.desktopBridge` API the preload exposes.
- `native/translator`: a Swift command-line helper for Apple's on-device Translation. It reads a
  JSON request on stdin and prints JSON. Building it needs full Xcode (macOS 26 SDK).
- `scripts/`: dev runner, desktop packaging (`build-desktop-artifact.ts`), release helpers.
- `assets/`: app icons like T3 Code's: `prod/` for releases, `dev/` for the blueprint variant that
  unpackaged runs wear. `pnpm icons:export` regenerates the dev icon and both `.icns` files.
- `site/`: https://mail.otterware.dev (home, privacy policy, terms), a Cloudflare Worker.

## How the pieces talk

- Renderer → main: `window.desktopBridge.invoke(channel, params)` → `ipcMain.handle(channel, …)`.
- Main → renderer: `broadcast(channel, params)` (`apps/desktop/src/ipc.ts`) →
  `window.desktopBridge.on(channel, listener)`.
- Keep channel names stable; both sides refer to them by string.
- Renderer code never touches Electron or Node directly. Anything new goes through a handler.

## Dev

- `pnpm install`, then `pnpm dev` (Vite dev server + main-process watcher + Electron with reload).
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
- macOS is the only target for now (Apple Translation, the Dock badge, the menu-bar popover).
