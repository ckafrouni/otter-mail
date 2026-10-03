# Shared Otter identity

Mail's existing Better Auth users are the Otter identity. The issuer is
`https://relay.mail.otterware.app/v1/auth`; discovery is at
`/v1/auth/.well-known/openid-configuration`. Existing Mail sign-in, Google callbacks,
cookies, bearer tokens, user IDs and auth secrets stay in place.

Drive is the fixed first-party client `otter-drive`: authorization code + S256 PKCE,
exact redirects, and only `openid profile email`. Dynamic registration is disabled.
OAuth tokens cannot authenticate Mail API requests. Signing keys are encrypted in D1
with the existing Mail auth secret; retain that secret.

Drive's user ID is the same canonical Mail subject. The migration explicitly verifies
both existing identities and re-keys the Drive user and all references, including
sessions, ownership, attribution and API keys. It removes the old password identity.
Automatic account linking by email is disabled. A future Clerk integration can map
Clerk subjects to these stable Otter IDs without re-keying application data.

## Personal and shared drives

Drive no longer uses Better Auth organizations. `chris` becomes the personal drive,
`zentio` a shared drive, with the same IDs, slugs, documents, versions and R2 keys.
Folders nest recursively inside either drive. Shared drive invitations grant view or
edit access throughout the drive, including future subfolders. Owners manage invitations
and can transfer a shared drive to a signed-in collaborator. Each new verified Otter
identity gets its own private drive.

API keys belong to individuals. Migrated organization keys retain a scope limiting them
to their original drive subtree. Membership is checked on every API request, including
CLI requests; signed document previews also recheck access. Downloaded copies cannot be
revoked. Thumbnail capabilities expire within ten minutes, with five-minute private caching.
The old organization header and list endpoint remain read compatibility for installed CLIs.

## Sessions and deletion

Mail cookies retain their `mail.otterware.app` scope; Drive cookies are host-only. Never
broaden either to `.otterware.app`, which includes executable uploaded content.
Drive sign-out ends the local session. Revoking a Mail browser session sends signed OIDC
back-channel logout to its associated Drive browser sessions. Delivery is best effort
and cannot guarantee immediate revocation if Drive is unavailable. CLI sessions and API
keys are independent of an individual browser session.

Issuing a Drive identity records an `identity_apps` link. The legacy Mail delete endpoint
refuses linked identities before removing any sessions. `/otter/account` requires a recent
sign-in, same-origin request and explicit confirmation. It sends a short-lived signed
request to Drive first. Drive refuses while the user owns documents or shared drives:
private documents must be deleted, and shared drives transferred or deleted first. Once
released, Drive atomically removes the user's folders, memberships, keys and sessions and
retains a subject tombstone. Documents in other people's shared drives remain. Mail then
removes the app link and identity. Retrying partial failures is idempotent.

## Rollout

1. Back up both production D1 databases privately and record Time Travel bookmarks and
   user/session/document/version/file/key counts. Exports contain authentication material.
2. Apply Mail's additive migrations and deploy the relay. Existing Mail clients keep working.
3. Prepare and test the Drive build before its maintenance window. Apply migrations 0005
   and 0006, then run its `admin:seed -- --remote --otter-subject VERIFIED_MAIL_ID
--link-existing` command after verifying both identities. The re-key is one transaction.
4. Record the existing user's Mail `identity_apps` link for `otter-drive`, then immediately
   deploy Drive. Migration 0006 replaces organization tables; the old Worker cannot serve
   that schema. Preserve both apps' existing auth and content-signing secrets.
5. Verify canonical IDs, ownership, counts, login, CLI credentials, key scope and membership
   revocation. Merge the tested commits and verify Workers Builds deployed those commits.

The Mail changes are additive and can be rolled back independently after Drive is no longer
using the issuer. Drive rollback requires coordinating the old Worker with the old schema;
do not simply redeploy it over the new database. Prefer a forward fix. A backup restore must
happen with writes paused and must account for any new data created since that backup.

## Local verification

Use separate local D1 databases. Set Mail's `BETTER_AUTH_URL`, `DRIVE_ORIGIN`, and Drive's
`OTTER_AUTH_URL` to their local origins, and adjust the local OAuth client's exact callback
and back-channel URL. Never add local or wildcard redirects to the production client.
Relay tests use a mock Google signer; Drive tests use a mock OIDC issuer, the real Better Auth
library and all SQL migrations. Ownership migration tests cover every user reference.
