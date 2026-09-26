# Otter Mail

Gmail, calm and fast. A macOS desktop client for Gmail, with an iPhone app alongside.

- Several Gmail accounts side by side, or combined into one inbox
- Gmail labels, plus saved views that filter across accounts
- A local SQLite cache with full-text search, so mail opens instantly and works offline
- A menu-bar mini inbox, new-mail notifications, and a Dock unread badge
- On-device translation of mail in other languages (Apple Translation, nothing leaves the Mac)
- Calendar invitations you can answer in place, and one-click unsubscribe
- An assistant that works on your mail through Claude Code, Codex or Hermes
- Keyboard shortcuts for everything, editable in Settings or in `keybindings.json`

## Install

Download the latest DMG from [Releases](https://github.com/ckafrouni/otter-mail/releases).
Installed apps update themselves from the same page.

## Develop

```sh
corepack enable
pnpm install
pnpm dev
```

See [docs/development.md](docs/development.md) for the full setup,
[docs/mobile.md](docs/mobile.md) for the iPhone app, and
[docs/release.md](docs/release.md) for how releases are cut. Contributions are welcome;
start with [CONTRIBUTING.md](CONTRIBUTING.md).
