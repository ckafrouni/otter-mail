# Google OAuth verification

Otter Mail signs in to Google through the `otter-mail` Google Cloud project (owned by
chris.kafrouni@gmail.com). Its consent screen is published, and its branding (name, logo, home
page, privacy policy, terms, `otterware.dev`) is verified. The Gmail scope still needs Google's
data-access verification; until then sign-in shows "Google hasn't verified this app"
(Advanced → Go to Otter Mail) and the app is capped at 100 users.

## Submitting

Google Auth Platform → Data access (https://console.cloud.google.com/auth/scopes?project=otter-mail).
The form only saves once every field is filled, including the video link.

### Sensitive scopes (calendar.events, contacts.readonly, contacts.other.readonly)

> Otter Mail is a desktop email client for macOS (https://mail.otterware.dev). calendar.events:
> when a user receives a calendar invitation by email, Otter Mail shows the event and lets the
> user Accept, Decline or reply Maybe from the message; the reply is written to that event on the
> user's primary calendar. Read-only calendar scopes cannot record an RSVP, and we only touch
> events the user acts on. contacts.readonly and contacts.other.readonly: Otter Mail shows the
> names and profile photos of the people the user corresponds with next to their messages, and
> suggests recipients while the user types an address. Both are read-only; we never modify
> contacts. All data is used only to show these features to the user in the app on their own
> Mac. It is stored locally on the device, never sent to our servers (we have none), never
> shared, and never used for advertising or AI training.

### Restricted scope (https://mail.google.com/)

Features: **Email client**.

> Otter Mail is a full Gmail client for macOS (https://mail.otterware.dev) that users sign in to
> in place of the Gmail website. With this scope the user reads and searches their mail, sends,
> replies and forwards, saves drafts, applies and removes labels, archives, marks read/unread,
> moves mail to Trash or Spam, and permanently deletes messages when they empty Trash or Spam or
> choose Delete Forever. Narrower scopes are not sufficient: gmail.modify cannot permanently
> delete messages (users.messages.delete / batchDelete require https://mail.google.com/), and
> gmail.readonly/send/compose each cover only part of what an email client does. Mail is fetched
> directly from the Gmail API to the user's own Mac, cached locally for speed and offline reading,
> and never sent to our servers (we run none). We do not sell data, use it for ads, or train AI
> models on it. Our use of Google data follows the Google API Services User Data Policy,
> including the Limited Use requirements.

### Demo video (unlisted YouTube, English, 2–4 minutes)

Record the installed app, signed in with a test account, narrating or captioning each step:

1. Otter Mail's home page, then open the app and click **Add Gmail account**.
2. The browser's Google consent screen, with the address bar expanded so the `client_id`
   (`187875144740-aspevse90oidb4ra3t2fcdfmbagm6jep…`) is readable. Show the unverified-app
   screen (Advanced → Go to Otter Mail) and the scope list, then Continue.
3. Gmail: the inbox loads; open and read a message; search; reply and send; add a label; archive;
   move a message to Trash, then empty Trash (permanent delete).
4. Calendar: open an invitation email and click Accept; show the event updated in Google Calendar.
5. Contacts: a sender's photo next to their message, and recipient suggestions while composing.

### After submitting

Google reviews the submission (usually a few weeks, by email to chris.kafrouni@gmail.com). For
the restricted Gmail scope it then requires a CASA security assessment from an authorised lab,
renewed yearly; follow the instructions in that email.
