# Features

Every user-facing feature and where it works, checked against the code. Mac and Web are the
same renderer (`apps/web`) over core, so they match unless noted; the iPhone app is its own
Swift code (`apps/ios`). Gmail and IMAP are noted where they differ.
The Mac app supports Apple Silicon Macs (arm64).

✓ supported · — not supported · a note means partly, or differently

## Mailboxes & accounts

| Feature                                     | Mac                | Web                                 | iPhone                  |
| ------------------------------------------- | ------------------ | ----------------------------------- | ----------------------- |
| Add a Gmail mailbox (Google sign-in)        | ✓ (loopback OAuth) | ✓ (popup; tokens kept by the relay) | ✓ (PKCE)                |
| Add an IMAP mailbox, servers discovered     | ✓                  | ✓ (no domain autoconfig file: CORS) | ✓                       |
| IMAP through the relay tunnel               | — (direct)         | ✓ (TLS 1.3 servers only)            | — (direct)              |
| Several mailboxes: on/off, reorder          | ✓                  | ✓                                   | ✓                       |
| Combined mailbox (all accounts)             | ✓                  | ✓                                   | ✓ ("All")               |
| Rename and color a mailbox (synced)         | ✓                  | ✓                                   | ✓                       |
| Remove a mailbox (unlinks it everywhere)    | ✓                  | ✓                                   | ✓                       |
| Mailbox linked elsewhere shows "signed out" | ✓                  | ✓                                   | ✓                       |
| Demo mailbox                                | —                  | `pnpm dev:demo` only                | TestFlight / Xcode only |

## Reading

| Feature                                                            | Mac                                                           | Web                              | iPhone                       |
| ------------------------------------------------------------------ | ------------------------------------------------------------- | -------------------------------- | ---------------------------- |
| Conversations, earlier messages collapsed                          | ✓                                                             | ✓                                | ✓                            |
| HTML mail, inline (cid) images                                     | ✓                                                             | ✓                                | ✓                            |
| Remote images                                                      | load; broken ones proxied by backend                          | load; proxy only where CORS lets | load                         |
| Remote-image blocking                                              | —                                                             | —                                | —                            |
| Quoted text collapsed                                              | ✓ (HTML and plain text)                                       | ✓                                | plain text only              |
| Attachments                                                        | preview in app, save, open in default app, drag out to Finder | preview in app, save             | Quick Look (no save / share) |
| Unsubscribe (one-click, web, mailto)                               | ✓                                                             | ✓                                | ✓                            |
| Conversation summary (people, files, list)                         | ✓                                                             | ✓                                | —                            |
| Sender hover card (write, search, ask)                             | ✓                                                             | ✓                                | —                            |
| Gmail category chips                                               | Gmail                                                         | Gmail                            | —                            |
| Folders: Inbox, Starred, Sent, Drafts, Important, All, Junk, Trash | ✓ (Important: Gmail)                                          | ✓                                | ✓ (Important: Gmail)         |
| Print, show original                                               | —                                                             | —                                | —                            |

## Organizing

| Feature                                  | Mac                      | Web          | iPhone         |
| ---------------------------------------- | ------------------------ | ------------ | -------------- |
| Archive, trash, restore, junk / not junk | ✓                        | ✓            | ✓              |
| Delete forever                           | ✓                        | ✓            | ✓              |
| Empty Trash / Empty Junk                 | ✓                        | ✓            | —              |
| Star (flag), read / unread               | ✓                        | ✓            | ✓              |
| Mark all as read                         | —                        | —            | ✓              |
| Multi-select and bulk actions            | ✓ (⌘/⇧-click)            | ✓            | —              |
| Undo and redo (z ⌘Z, ⇧Z ⇧⌘Z)             | ✓                        | ✓            | —              |
| Apply / remove labels                    | ✓ (IMAP: move to folder) | ✓            | ✓ (IMAP: move) |
| Create, rename, delete labels            | ✓ (IMAP: folders)        | ✓            | —              |
| Label colors                             | edit (Gmail)             | edit (Gmail) | shown (Gmail)  |
| Nested labels                            | ✓                        | ✓            | —              |
| Drag conversations onto labels           | ✓                        | ✓            | —              |
| Swipe actions                            | —                        | —            | ✓ (fixed)      |
| After archive: next / previous           | ✓                        | ✓            | ✓              |
| Snooze                                   | —                        | —            | —              |

## Composing & sending

| Feature                                | Mac                                            | Web | iPhone                   |
| -------------------------------------- | ---------------------------------------------- | --- | ------------------------ |
| New, reply, reply all                  | ✓                                              | ✓   | ✓                        |
| Forward                                | ✓ (with attachments)                           | ✓   | last message's text only |
| Cc / Bcc                               | ✓ / ✓                                          | ✓   | ✓ / —                    |
| From: pick the mailbox                 | ✓                                              | ✓   | ✓                        |
| Contact suggestions (from cached mail) | ✓                                              | ✓   | —                        |
| Attachments (25 MB)                    | ✓                                              | ✓   | —                        |
| Rich text (bold, lists, links, quotes) | ✓                                              | ✓   | —                        |
| Drafts                                 | autosaved, conflict-aware                      | ✓   | saved on close           |
| Undo send (10 s)                       | ✓                                              | ✓   | —                        |
| Send later                             | —                                              | —   | —                        |
| Signatures                             | Gmail: saved in Gmail; IMAP: synced preference | ✓   | ✓ (same)                 |
| Handles mailto: links                  | ✓ (default mail app)                           | —   | —                        |

## Search

| Feature                        | Mac                                                                        | Web | iPhone                                 |
| ------------------------------ | -------------------------------------------------------------------------- | --- | -------------------------------------- |
| Gmail: server search           | ✓ (all Gmail operators, paged; local when offline)                         | ✓   | ✓ (25 results, plus local)             |
| IMAP: local search             | ✓ (in: from: to: subject: is: has: after: before: newer_than: older_than:) | ✓   | ✓ (from: to: subject: label: is: has:) |
| Search chips / advanced search | ✓                                                                          | ✓   | —                                      |
| Search tabs in the sidebar     | ✓                                                                          | ✓   | —                                      |

## Calendar invitations

| Feature                             | Mac                                                    | Web | iPhone |
| ----------------------------------- | ------------------------------------------------------ | --- | ------ |
| Invitation card (what, when, where) | ✓                                                      | ✓   | —      |
| Yes / No / Maybe                    | Gmail: Google Calendar; IMAP: email reply to organizer | ✓   | —      |
| Google's RSVP links in the body     | ✓ (answered in place)                                  | ✓   | —      |

## Contacts & avatars

| Feature       | Mac                                                                      | Web | iPhone        |
| ------------- | ------------------------------------------------------------------------ | --- | ------------- |
| Sender photos | Gmail: contacts → Gravatar → domain logo → initials; IMAP: from Gravatar | ✓   | initials only |

## Notifications & live mail

| Feature                                                    | Mac                          | Web                     | iPhone                              |
| ---------------------------------------------------------- | ---------------------------- | ----------------------- | ----------------------------------- |
| New-mail notifications (Off / Inbox / All), click opens it | ✓                            | ✓ (browser)             | ✓ (local, from syncs; no APNs push) |
| Gmail push via relay                                       | ✓ (with an Otter account)    | ✓                       | while open                          |
| IMAP IDLE                                                  | ✓ (while running)            | ✓ (while a tab is open) | while open                          |
| Background sync                                            | ✓ (15 s – 15 min, or manual) | ✓ (while a tab is open) | BGAppRefresh, ≥ 15 min              |
| Unread badge                                               | Dock                         | tab title, app badge    | app icon                            |

## Offline & sync

| Feature                               | Mac                                | Web                    | iPhone                               |
| ------------------------------------- | ---------------------------------- | ---------------------- | ------------------------------------ |
| Local cache                           | SQLite, whole mailbox              | SQLite WASM on OPFS    | JSON, newest 400 threads per mailbox |
| Gmail: first sync                     | every row over IMAP, in seconds    | Gmail API, inbox first | newest threads                       |
| Bodies downloaded for offline         | ✓ (inbox first, then newest first) | — (fetched on open)    | —                                    |
| New mail during a long sync           | ✓                                  | ✓                      | —                                    |
| Changes applied at once, synced after | ✓                                  | ✓                      | ✓ (no outbox)                        |

## Settings & customization

| Feature                                                  | Mac | Web | iPhone                                                                     |
| -------------------------------------------------------- | --- | --- | -------------------------------------------------------------------------- |
| 7 themes, a light and a dark pick; System / Light / Dark | ✓   | ✓   | ✓                                                                          |
| Panel animations                                         | ✓   | ✓   | —                                                                          |
| Keyboard shortcuts, rebindable (incl. move to label)     | ✓   | ✓   | —                                                                          |
| Command palette (⌘K)                                     | ✓   | ✓   | —                                                                          |
| Custom views (rules across mailboxes)                    | ✓   | ✓   | —                                                                          |
| Preferences synced through the Otter account             | ✓   | ✓   | ✓ (theme, advance, mailboxes, notifications, languages, agent, signatures) |

## Agents

| Feature                                            | Mac                         | Web                        | iPhone       |
| -------------------------------------------------- | --------------------------- | -------------------------- | ------------ |
| Providers                                          | Claude, Codex, Hermes       | Hermes (Claude, Codex off) | Hermes       |
| Chat, models, steer / stop, tool approval, history | ✓                           | ✓                          | ✓            |
| Chat about a conversation (pointers, not mail)     | ✓ (also selections, quotes) | ✓                          | ✓ (a thread) |
| Attach images and files to a chat                  | ✓                           | ✓                          | —            |
| Queued follow-ups                                  | ✓                           | ✓                          | —            |
| Mail and calendar tools (Claude, Codex)            | ✓ (every mailbox)           | —                          | —            |

Claude and Codex get Otter Mail's own tools (an MCP server in the Mac app's backend), so they
need no mail CLI: search, read and sort mail, download attachments, save drafts and send, in
any mailbox (Gmail or IMAP), and list, add, change and answer events in Google Calendar. A tool
that changes a mailbox asks first unless the chat has full access; drafts don't ask.

## Translation

| Feature                                        | Mac                  | Web                               | iPhone               |
| ---------------------------------------------- | -------------------- | --------------------------------- | -------------------- |
| Translate a message; auto for unread languages | ✓ (Apple, on-device) | Chrome only (built-in Translator) | ✓ (Apple, on-device) |

## Mac-only

- Menu-bar icon and mini inbox (open, archive, trash, compose, sync).
- Dock badge; launch at login; default mail app (mailto: links).
- Drag attachments out to Finder.
- Menus: Sync Now, Back / Forward (⌘[ ⌘]).
- Auto-update from GitHub Releases ("Restart to update"). The web app is always current; the
  iPhone app updates through TestFlight.

## Otter account & devices

| Feature                              | Mac      | Web      | iPhone                              |
| ------------------------------------ | -------- | -------- | ----------------------------------- |
| Otter account                        | optional | required | required (the first Google sign-in) |
| Sign out; devices, sign out a device | ✓        | ✓        | ✓                                   |
| Delete account                       | ✓        | ✓        | ✓                                   |

## Google OAuth scopes

What each scope in `GMAIL_SCOPES` (`packages/contracts/src/index.ts`) is for:

- `https://mail.google.com/`: every Gmail mail feature (reading, search, sending, drafts,
  labels, delete forever, push). The iPhone app asks for this one only (plus `openid email
profile`).
- `gmail.settings.basic`: saving signatures in Gmail (reading them needs only the mail scope).
- `calendar.events.owned`: answering invitations in Google Calendar, replacing the broader
  `calendar.events` the Mac and web apps ask for today. Without it, RSVPs go by email reply.
- `contacts.readonly` + `contacts.other.readonly`: contact photos for sender avatars.

## Gaps worth closing

- iPhone: calendar invitations (card and RSVP).
- iPhone: attachments, rich text, Bcc and contact suggestions in the composer.
- iPhone: forward with attachments and the original HTML.
- iPhone: draft autosave and undo send.
- iPhone: sender photos (contacts, Gravatar, logos) instead of initials only.
- iPhone: create, rename and delete labels; Empty Trash / Junk.
- iPhone: multi-select, and undo after archive or trash.
- iPhone: custom views.
- iPhone: push notifications (APNs) when the app is closed.
- iPhone: save or share an attachment from Quick Look.
- Mac and web: Mark all as read (iPhone has it).
- Web: translation outside Chrome.
- Web: offline bodies (the Mac downloads them).
- All: remote-image blocking, print, show original, snooze, send later.
