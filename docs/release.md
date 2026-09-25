# Releases

Releases are GitHub Releases of this repository, built by `.github/workflows/release.yml`.
Installed apps check them every few hours and offer the update in the app.

## Channels

- **Stable** (`latest`): versions like `0.2.0`. Apps on a stable version only see stable releases.
- **Nightly**: versions like `0.2.1-nightly.20260925.14`, the next patch after
  `apps/desktop/package.json`'s version. Apps on a nightly follow nightlies.

## Cutting a release

- **Nightly:** runs daily at 03:17 UTC when `main` has commits since the last nightly. Start one
  by hand with `gh workflow run release.yml -f channel=nightly`.
- **Stable:** `gh workflow run release.yml -f channel=stable` promotes the commit the latest
  nightly shipped (optionally `-f version=0.2.0`). Pushing a tag `v0.2.0` also builds a stable
  release from that tag. Afterwards the workflow bumps the package versions on `main`.

Each run builds arm64 and x64 DMGs and ZIPs on `macos-15`, with `latest-mac.yml` (or
`nightly-mac.yml`) for the updater, and publishes them with generated release notes.

## Google OAuth client

Release builds need the Google OAuth client, or the app can't sign in (the workflow fails early
without it). Under Settings → Secrets and variables → Actions:

- Variable `OTTER_MAIL_GOOGLE_CLIENT_ID`: the "Desktop app" client ID from the `otter-mail`
  project.
- Secret `OTTER_MAIL_GOOGLE_CLIENT_SECRET`: its client secret.

## Signing and notarization

Without these secrets the workflow still publishes, but builds are ad hoc signed: Gatekeeper
blocks them on first open (right-click → Open), and macOS auto-update refuses to install them.
Add them under Settings → Secrets and variables → Actions:

| Secret             | What it is                                                                                    |
| ------------------ | --------------------------------------------------------------------------------------------- |
| `CSC_LINK`         | Base64 of a "Developer ID Application" certificate exported as `.p12` (`base64 -i cert.p12`). |
| `CSC_KEY_PASSWORD` | The password of that `.p12`.                                                                  |
| `APPLE_API_KEY`    | Contents of an App Store Connect API key (`AuthKey_XXXX.p8`) with the Developer role.         |
| `APPLE_API_KEY_ID` | That key's ID.                                                                                |
| `APPLE_API_ISSUER` | The issuer ID shown above the keys list in App Store Connect → Users and Access → Keys.       |

Optional repository variable: `XCODE_APP`, the Xcode to build with on the runner (for example
`/Applications/Xcode_26.0.app`). By default the newest Xcode 26+ on the image is used.

## Building locally

`pnpm dist:desktop:dmg` builds an unsigned DMG for this Mac. With the secrets above exported
(`APPLE_API_KEY` as a path to the `.p8`), `node scripts/build-desktop-artifact.ts --arch both
--signed` builds what CI builds.
