# Releases

Releases are GitHub Releases of this repository, built by `.github/workflows/release.yml`.
There is one channel, stable, like T3 Code's stable train (no nightlies). Installed apps check for
a new release at launch and every few hours, download it in the background, and show a card at
the bottom of the sidebar: "Restart to update". It also installs the next time the app really quits
(⌥⌘Q, Dock → Quit, logging out; ⌘Q only hides the window).

## Release cycle

1. Land changes on `main` through pull requests (CI must pass).
2. Cut a release from `main`:
   - Actions → Release → Run workflow, choose `patch`, `minor` or `major`; or
   - `gh workflow run release.yml -f bump=patch` (or `-f version=1.0.0` for an exact version).

   The version is the latest `vX.Y.Z` tag with that bump. The very first release ships
   `apps/desktop/package.json`'s version (`0.1.0`).

3. The workflow builds `main`'s HEAD for arm64 and x64 on `macos-15` (DMG + ZIP, with
   `latest-mac.yml` and blockmaps for the updater), publishes the GitHub Release as the latest
   with notes generated since the previous release, and commits the new version to
   `apps/*/package.json` on `main`.

To release a specific commit instead (say, a fix on a release branch), push a tag:
`git tag v1.2.4 <commit> && git push origin v1.2.4`. A version with a suffix (`1.3.0-rc.1`) is
published as a GitHub prerelease with no update feed, for testing by hand.

### Testing the updater locally

Build a newer version into a folder, serve it, and point an older build at it:

```sh
node scripts/build-desktop-artifact.ts --arch arm64 --build-version 0.9.1 --output-dir /tmp/feed
OTTER_MAIL_UPDATE_URL=http://127.0.0.1:8791 \
  node scripts/build-desktop-artifact.ts --arch arm64 --build-version 0.9.0 --skip-build --output-dir /tmp/old
(cd /tmp/feed && python3 -m http.server 8791 --bind 127.0.0.1)
```

Run the 0.9.0 app from `/tmp/old` with `OTTER_MAIL_HOME=/tmp/test-home` so it stays off your
data. Unsigned builds download the update but macOS refuses to install it; the full flow needs
signed builds (below).

## Google OAuth client

Release builds need the Google OAuth client, or the app can't sign in (the workflow fails early
without it). Under Settings → Secrets and variables → Actions:

- Variable `OTTER_MAIL_GOOGLE_CLIENT_ID`: the "Desktop app" client ID from the `otter-mail`
  project.
- Secret `OTTER_MAIL_GOOGLE_CLIENT_SECRET`: its client secret.

## Signing and notarization

Without these secrets the workflow still publishes, but builds are ad hoc signed: Gatekeeper
blocks them on first open (right-click → Open), and macOS refuses to install their updates (the
sidebar card then says "Couldn't update").
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
