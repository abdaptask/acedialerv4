# ACE Dialer — User Guide

Welcome to ACE Dialer, ApTask's internal softphone. This guide covers
everything you can do, with quick how-to steps for each feature.

Last updated: v0.10.221 (August 13, 2026)

---

## Getting started

### Installing the app

You'll get an email from IT with the download link. Open the installer:

- **Windows**: double-click `ACE Dialer Setup x.x.x.exe`, follow the prompts
- **Mac**: open the `.dmg`, drag ACE Dialer to Applications, launch it
- **No install required**: you can also use it in any browser at the URL IT
  gives you

### Signing in

ACE Dialer uses your ApTask Microsoft account — same login as Outlook.

1. Open ACE Dialer
2. Click **Sign in with Microsoft**
3. Pick your `@aptask.com` account
4. Approve any permissions on the first sign-in

You'll stay signed in until you explicitly sign out.

### One-time setup: your old dialer

If you were using Pulse (or any other softphone), **IT will uninstall it
when they install ACE Dialer**. Running both at once causes duplicate
ringing and dropped calls. If you still have the old dialer, ask IT to
remove it before continuing.

---

## Making calls

### From the dialpad

1. Click the **Keypad** icon (bottom nav, looks like a 3×3 grid)
2. Type or paste the number — country code auto-fills as +1
3. Press the green call button (or hit Enter)

**Tip**: you can paste full numbers like `(973) 555-1234` or `+1-973-555-1234`
— it strips formatting automatically.

### From Recents

1. Click the **Recents** icon (clock)
2. Tap any call to dial that number back
3. Use the search box at the top to find a contact quickly

### From Favorites

1. Click the **Favorites** icon (star)
2. Tap a saved contact to dial

### From Messages

1. Open a text conversation
2. Click the phone icon at the top of the thread to call that number

### Dialing extensions / IVR menus

You can include pauses for IVR menus by adding commas to the number:

`+18005551234,,1,3`

Each comma waits ~1 second, then sends the digits after it (so the
example above waits, presses 1, waits, presses 3 — useful for "press 1
for sales, press 3 for billing" menus).

### International calls

Just type `+` and the country code, or paste an international number
and ACE auto-detects the country (you'll see the flag appear).

### Calling a number you found in another app

Desktop app only. Instead of reading a number off one screen and typing it
into ACE, you can send it straight to the dialer. Turn it on first in
**Settings → Click to dial** — there are two switches, both off until you
enable them.

**Clickable phone links.** Turn on "Open phone links in ACE Dialer", and
clicking a phone link — in an Outlook signature, a Teams message, a web
page — opens ACE with the number filled in. The first time, Windows or
macOS will ask you to confirm ACE as your default for phone links.

**Numbers that are just text.** Most ATS and CRM screens show a number as
plain text, not a link. For those, turn on "Dial what I've copied" and:

1. **Copy the number — Ctrl+C.** This part matters: the shortcut reads what
   you've *copied*, not what you've *highlighted*. If you skip the copy,
   you'll get whatever you copied earlier.
2. Press **Ctrl+Shift+D** (**Cmd+Shift+D** on a Mac).

Either way, **the call never starts on its own.** The number lands in the
dialer and you press Call, so you always get a look at it first.

ACE tidies the number up for you — spaces, dashes and brackets come out,
the country code stays — and an extension like `x203` is dialled for you
once the call connects.

If what you copied isn't a phone number, ACE tells you and shows the text
it actually read, rather than leaving a wrong number in the dialer. If the
text holds two numbers — a candidate ID sitting next to a phone number, say
— it names both and asks you to copy just the one you want. It won't guess.

**On privacy:** ACE looks at your clipboard only at the moment you press the
shortcut. It never watches it in the background.

---

## Receiving calls

When someone calls you:

- A full-screen incoming-call window pops up (even if ACE is minimized)
- You'll see the caller's name (from your favorites or from JobDiva) or
  the phone number if unknown
- Your computer rings + a desktop notification appears

### Answering options

- **Accept** (green) — pick up the call
- **Decline** (red) — sends to voicemail
- **Hold & Accept** — if you're already on a call, this puts the current
  one on hold and answers the new one
- **Decline with SMS** — sends an auto-text like "Can't talk, will call
  back" instead of letting it ring out (configurable quick-replies)

### If ACE is in the background

You'll still get a system notification + your computer will ring. Clicking
the notification brings ACE to the front.

---

## During a call

While on a call, you have these controls (3×3 grid):

| Button | What it does |
|---|---|
| **Mute** | Mutes your microphone (caller can't hear you) |
| **Hold** | Puts the call on hold with hold music; click again to resume |
| **Keypad** | Opens a number pad for IVR menus (press 1, 2, etc.) |
| **Audio** | Switches between microphone/speaker devices (headphones, USB, etc.) |
| **Record** | Records the call (recording saved to your account) |
| **Transfer** | Hands the call to someone else and drops you out |
| **Add Call** | Adds a second person to make it a 3-way conference |
| **Message** | Opens the SMS thread with this caller |
| **Hangup** (red) | Ends the call |

### 3-way conference

1. While on a call, click **Add Call**
2. Dial the second person's number (the first call goes on hold)
3. When they answer, click **Merge** to bring all 3 together
4. You can mute individual participants from the conference view

### Two calls at once

You don't have to hang up to take or make another call.

- **Add Call** puts the current caller on hold (with your hold music if
  you've set one) and lets you dial someone else. The parked call stays
  visible in a strip at the bottom with its own hangup button.
- **Swap** switches which call you're talking to — one tap, the other goes
  back on hold.
- If a second call rings while you're busy, **Hold & Accept** parks the
  first and answers the new one.
- **Merge** joins the two into a 3-way conference.

### Transferring a call

Click **Transfer** during the call and type the number. The caller is handed
straight to that number and your side of the call ends — you don't stay on
the line.

The Transfer button stays greyed out for a second or two at the start of a
call. That's deliberate: it only lights up once the carrier has fully
registered the call, so pressing it can never silently do nothing.

---

## Messaging

Send and receive SMS / MMS texts from your business number.

### Sending a text

1. Click **Messages** (bottom nav, speech bubble icon)
2. Click **+ New message** (or click an existing thread)
3. Type the number or pick from contacts
4. Type your message, click send (or hit Enter)

### Sending pictures / files (MMS)

In the compose row, click the attachment icon. Pick a photo or file from
your computer. Recipient gets it as an MMS.

### Quick replies

For common responses, you can set up quick-reply templates:

1. Settings → Quick replies
2. Add / edit / reorder your common phrases
3. While composing a message, click the quick-reply icon to pick one

### Templates

Longer, reusable messages live under the **Templates** button in the
composer. You'll see two kinds:

- **Company templates**, managed by an admin and shared with everyone
- **Your own templates**, which only you can see — an admin can't read them

Templates can contain placeholders like `{firstName}` or `{recruiter}`,
which fill in automatically from the contact and from your own profile.
Anything meant to be typed by you stays visible as `{role}` so you can spot
it — it's never silently left blank.

### Dictating a message

Click the microphone in the composer and talk; your words appear as text you
can edit before sending. The recording is only ever used to produce that
text — it isn't saved, isn't sent, and isn't attached to the message.

You can't dictate during a call, because the call is using your microphone.

### Cleaning up wording with AI

Click the wand to have ACE tidy up spelling, grammar and tone. You always
see the suggestion side by side with what you wrote, along with a short list
of things worth double-checking (numbers, names, links). Accept it, edit it,
or keep your original. **Nothing is ever sent automatically.**

### How long is too long

Under the composer you'll see a character count and how many *texts* the
message will actually cost. That second number is what matters — carriers
bill per text, and a single emoji, curly quote, or em dash cuts a text from
160 characters down to 70.

Messages over 1,600 characters (about ten texts) are blocked before sending,
with a note asking you to shorten or split. Pasting something huge won't
quietly go out as dozens of separate texts.

### Drafts

If you're partway through typing and a call comes in, or you switch to
another conversation, or you close ACE — your text is still there when you
come back to that conversation. Conversations holding unsent text are marked
**Draft** in the message list, with a preview of what you'd written.

Your draft clears once the message actually sends. If a send fails, your
text stays put. Drafts live on the computer you typed them on, and are
cleared when you sign out.

### Sending later

Click the clock icon to pick a date and time instead of sending now.
Scheduled messages are listed in a sidebar where you can edit or cancel them
before they go out.

### Reading a thread

- Newest messages appear at the bottom
- Auto-scrolls to the bottom when new messages arrive
- Unread count shows on the **Messages** tab in the bottom nav

### Searching messages

The search bar at the top of the Messages tab searches across all your
threads (by name, number, or message content).

### Calling someone from a text thread

Click the phone icon at the top right of the thread.

---

## Voicemail

If you miss a call, the caller can leave a voicemail.

### Listening to voicemails

1. Click **Voicemail** (bottom nav, the voice icon)
2. Click any voicemail to expand it
3. Click play to listen
4. Use the speed controls (1×, 1.5×, 2×) to listen faster

### Reading the transcript

Every voicemail is automatically transcribed (powered by Deepgram). The
text appears below the audio player a few seconds after the voicemail is
left. While waiting, you'll see "Transcribing…".

### Marking as read / unread

- Voicemails are auto-marked read when you play them
- To mark one unread again: click the dot icon on the right
- Bulk: click **Select**, check multiple, then **Mark read** or
  **Mark unread**

### Calling back

Click the phone icon on the voicemail row to call the sender back.

### Searching voicemails

The search bar at the top searches caller name, number, AND transcript
text — so you can find "the voicemail where they mentioned the proposal"
even if you don't remember who left it.

### Auto-deletion

Voicemails are kept for 30 days, then auto-deleted. Each row shows
"Auto-deletes in X days" so you know what's about to go.

To save one permanently: download the audio file (right-click on the
player → Save audio as...).

---

## Contacts & Favorites

### Adding a favorite

Two ways:

**From Recents**:
1. Open Recents
2. Tap the star icon next to any call
3. Type a name when prompted

**From Favorites**:
1. Click **Favorites**
2. Click **+ Add favorite**
3. Type the name + number

### Editing or removing a favorite

In the Favorites tab, hover over a favorite and click the edit or trash
icons.

### Where favorite names appear

Once saved, the friendly name shows everywhere:

- Recents
- Voicemail
- Incoming call popup
- During the call
- Message threads

---

## Recents (call history)

### What it shows

Every inbound, outbound, and missed call, newest first. For each call you
see:

- Name (from favorites or JobDiva — your CRM lookup) or just the number
- Direction (incoming / outgoing) and duration
- Time
- Status — answered, missed, voicemail, declined, blocked

### Missed and declined calls

Missed calls show in **red** so they stand out. There's also an unread
count on the bottom-nav **Recents** badge.

### Filtering & search

- Search bar at the top searches by name or number
- Click a name to see ONLY that contact's history (call + voicemail + SMS)

### Blocked-call indicator

Calls from blocked numbers show with a red icon and "Blocked" label.

---

## Internal chat

Chat with other people in your ApTask org — like a built-in mini-Slack.

1. Click **Chat** (bottom nav)
2. Pick a coworker from the list (or use search)
3. Type and send

Unread message count shows on the Chat tab.

**Note**: this is internal-only — it doesn't send actual SMS to
phone numbers. Use the **Messages** tab for that.

---

## Settings

Open via the avatar dropdown (top right) → **Settings**, or click
the gear icon.

### Personal settings

| Setting | What it does |
|---|---|
| **Account** | Your name, email, DID number, SIP username (mostly read-only) |
| **Theme** | Light, Dark, or System (matches your OS) |
| **Notifications** | Enable/disable desktop notifications for calls/SMS/voicemail |
| **Quick replies** | Manage your SMS quick-reply templates |
| **Call forwarding** | Send calls to another number (e.g. your cell) — either always, or only when you don't answer |
| **Number blocking** | Block specific numbers — they get a busy signal and can't leave a voicemail |
| **Click to dial** | Turn on phone links and the copy-and-dial shortcut (desktop app only) |
| **Hold music** | Upload an MP3 so callers on hold hear music instead of silence |
| **Backup / restore prefs** | Export your settings as a file; import on a new computer |
| **Audio devices** | Pick which mic and speaker ACE uses |

### Voicemail settings

| Setting | What it does |
|---|---|
| **Voicemail greeting** | Upload a custom "you've reached..." message |
| **Auto-delete** | Voicemails older than 30 days are deleted automatically |

### Signing out

Avatar dropdown (top right) → **Sign out**. ACE will return to the login
screen.

---

## Updates

ACE Dialer updates itself automatically:

- The app checks for updates every hour
- When a new version is available, a banner appears at the top
- Click **Restart to install** — ACE quits, installs, and reopens in the
  new version (~30 seconds)

### Manual check

Click **Help** menu → **Check for updates** (or avatar dropdown → Check
for updates).

### If auto-update fails

You'll see an error banner explaining what went wrong, plus two buttons:

- **Download installer** — opens the right installer file directly for
  manual install
- **Retry** — tries the auto-update again

---

## System tray (Windows / Mac menu bar)

When you close the ACE window (red X / red dot), it doesn't actually
quit — it minimizes to your system tray so you can still receive calls.

- **Tray icon** shows in the bottom-right (Windows) or top-right (Mac)
- **Right-click → Open** brings the window back
- **Right-click → Quit** actually exits the app (incoming calls won't ring)

---

# Admin-only features

These tabs only appear if your account has admin permissions.

## Pending Users (Pulse migration)

Tab in Settings → Admin. Lets you import the Pulse user list as a CSV
and invite users one at a time.

### Importing

1. Upload a CSV exported from Pulse (columns: first_name, last_name,
   email, voip_ext, voip_number, ext_password, connection_name, user_status)
2. Preview the first 5 rows — verify they look right
3. Click **Commit import**

### Inviting one user

1. Click **Invite** on a row
2. In the modal:
   - **Phone number**: keep existing Pulse number / purchase a new DID /
     pick from your unassigned Telnyx inventory
   - **SIP credentials**: reuse Pulse creds / generate fresh ACE creds
   - **Webhook**: repoint to ACE (default on)
   - **Welcome email**: send sign-in instructions (default on)
3. Click **Confirm & Invite**
4. The result modal shows each step: ✓ green for success, ✗ red for failure

### Status tracking

Each row has a status badge:

- **P** Pending — staged, not invited yet
- **I** Invited — Telnyx + email done, waiting on sign-in
- **A** Accepted — they signed in at least once

Filter the table by clicking the chip at the top.

### Revealing credentials

Click **Reveal Credentials** in the invite modal to see the SIP password
from the CSV. Every reveal is logged in the audit trail.

---

## Users panel

Tab in Settings → Admin → Users. Manage all users:

- **Invite new user** — for brand-new hires who weren't on Pulse. Auto-provisions
  Telnyx (DID + SIP creds), creates the user, sends welcome email — one click.
- **Add manually** — for cases where you pre-provisioned SIP creds elsewhere.
  Just creates a User row.
- **Promote / Demote** — give or remove admin role (with last-admin protection)
- **Deactivate** — disable a user without deleting their data

---

## Audit log

Tab in Settings → Admin → Audit log. Read-only history of every admin
action:

- User invites / promotions / deactivations
- Credential reveals
- Bulk imports
- System config changes

Filter by actor, action type, or date range.

---

## Reporting

Tab in Settings → Admin → Reports. Multiple report types:

- **Live Ops Dashboard** — who's on a call right now, queue depth, alerts
- **Usage & Volume** — calls per day/week/user, peak hours
- **Quality** — call duration, drop rate, audio quality
- **Cost** — Telnyx spend per user, monthly rollup
- **Recruiter Metrics** — calls per recruiter, response rates (ApTask-specific)
- **Health Alerts** — proactive warnings (no inbound activity, missed-call spike)
- **Presence/Agent Dashboard** — who's online, available, on a call

---

# Troubleshooting

### Audio isn't working

1. Open Settings → Audio devices
2. Pick the right microphone and speaker
3. Test by making a call (your own voicemail is good for this)

### Incoming calls aren't ringing

1. Check the SIP status at the top of the app — should be a green **Online** dot
2. If red **Offline**: sign out and back in, OR Quit + relaunch from tray
3. If it persists: contact IT

### "Sign-in failed" or "redirect URI mismatch"

This means your account or browser isn't configured. Contact IT — they need
to add your sign-in URL to the Microsoft App Registration.

### Voicemail transcripts not appearing

- Transcripts usually appear within 5 seconds of the voicemail being left
- The page auto-polls for up to 60 seconds
- If still no transcript, refresh the page (Ctrl+R / Cmd+R)
- Persistent issues: contact IT (might be a Deepgram API issue)

### Forgot to install new version

- Click the avatar (top right) → Check for updates
- Or: download the latest installer manually from the IT-provided link

### App is using too much battery / CPU

- Check the system tray to see if you have multiple ACE Dialer windows
  open accidentally
- Right-click tray → Quit, then relaunch

---

# Need help?

- **Quick questions**: ask in the ACE Dialer Teams channel
- **Bugs / broken features**: email IT (`it@aptask.com`) with:
  - What you were trying to do
  - What happened instead
  - The version number (shown under the ACE Dialer logo on the top left)
- **Urgent (can't make/receive calls)**: page IT on-call

---

*Document version aligned with ACE Dialer v0.9.5. Updated as features
ship. Last edit: see git history of `USER_GUIDE.md`.*
