# ACE Dialer (browser extension)

Two features: **click to call** (below) and the **dialer panel** (further
down) — a keypad, recent calls, text conversations, favorites and the
follow-ups still waiting on you, with that count on the toolbar icon.

Finds phone numbers on a page and makes them clickable. One click opens the
number in ACE Dialer — the web dialer or the desktop app — prefilled and
ready. **The call is never placed automatically; the user presses Call.**

## What it does

On an allowed site, every phone number in the page text gets a dotted
underline. Click one and the desktop dialer comes up with the number in the
field. That's it — no right-click, no copy-paste.

Numbers are cleaned up automatically (spaces, brackets, and dashes removed,
country code preserved). Detection is done with libphonenumber, not a regex
guess, so `+91 98765 43210` and `+44 20 7946 0958` work as well as US numbers.

## The permission model — read this before publishing

Auto-detecting numbers means reading page text. There is no way around that.
But it does **not** follow that the extension needs to read *every* page, and
this one doesn't:

| | |
|---|---|
| `host_permissions` | **`dialer.aptask.com`** (our own web dialer, for the hand-off below) and **`www1.jobdiva.com` + `www2.jobdiva.com`** (built in since 0.10.243.2) |
| Static `content_scripts` | `dialerBridge.js` on `dialer.aptask.com`; the scanner (`content.js`, all frames) on the two JobDiva hosts |
| On a fresh install, it can read | **our own dialer and JobDiva — nothing else** |

JobDiva is built in because every recruiter needs it, and the by-hand step was
where setup broke: the site list syncs through the Google account but the
grant doesn't, so a reinstall left the sites listed but switched off.
`src/sites.ts` names the hosts and a test keeps it in step with the manifest.

Any other site still goes through `optional_host_permissions` and a scanner
registered **dynamically, per domain**, via
`chrome.scripting.registerContentScripts()`. A domain becomes active only when
someone adds it on the options page, which triggers Chrome's own permission
prompt. Removing it there revokes the grant immediately.

Adding a host to the built-in list widens what the extension can read for
**every** user, and existing installs are paused until each person approves
the new access. Treat it as the same decision as adding a domain for
everyone; never a wildcard.

Why this rather than the usual `<all_urls>`: our users spend the day inside an
ATS and a CRM full of candidate PII. With blanket access, a compromise of this
extension — or of any dependency in it — would expose every page they visit.
Scoped this way, it exposes only the ATS domains someone deliberately turned
on. The feature is identical; the blast radius is not.

The extension makes **no network requests of any kind**. The number goes into a
local `ace-dialer://` URL, an already-open dialer tab, or a new dialer tab.

The dialer host permission is the one fixed grant, and it is narrow on
purpose: it lets the worker find an open dialer tab (`tabs.query` by URL) and
run the bridge there. It is **not** a user site and does not widen the
scanner. Note for existing unmanaged installs: adding a host permission makes
Chrome disable the extension on update until the user re-approves it.
Force-installed (policy) copies are not affected.

## Setup

1. Install the extension (see Deployment).
2. Click the toolbar icon, or Extensions → ACE Dialer → Options.
3. Add your ATS domain, e.g. `app.jobdiva.com`, and accept Chrome's prompt.

Numbers become clickable on that site immediately; no reload needed for new
tabs.

## How it connects to the app

```
page text → detect (libphonenumber) → clickable chip → click
  1. web dialer tab open?  → dialerBridge.js → postMessage → App.tsx
                             → navigate('/keypad?to=…&src=selection')  (no reload)
                             → page acks; no ack in 600ms → step 2
  2. options / policy      → desktop: ace-dialer://call?to=…&src=selection
                           → web:     new tab dialer.aptask.com/keypad?to=…&src=selection
  → Dialpad validates with parseSelectedNumber() → dialer prefilled
```

Why the open tab is told rather than navigated: a URL navigation reloads the
SPA, and a reload loses the tab's `sessionStorage` JWT and SIP registration —
it would hang up a call in progress. Why it must ack: an older web build or a
tab still loading has no listener, and without an ack the click would vanish
instead of falling back. A tab that was open before the extension was
installed has no bridge; the worker injects it and retries once.

Routing is decided in `src/route.ts` (pure, tested in `route.test.ts`).

`src=selection` tells the app the number came from captured text, so it
validates strictly and shows an error rather than prefilling something wrong.
Validation lives in the app so there is one parser, not two that drift.

## Behaviour on someone else's page

The scanner runs inside a live ATS a recruiter is working in, so breaking that
page is a worse outcome than missing a number. It therefore:

- **never** touches `<input>`, `<textarea>`, or `contenteditable` — rewriting a
  field mid-typing would destroy the user's work
- skips `<script>`, `<style>`, `<code>`, `<pre>`, existing `<a>` tags, and its
  own output (which would otherwise loop the MutationObserver forever)
- only ever wraps text in a `<span>` — no layout change, nothing that reflows
- batches DOM writes and debounces the observer through `requestIdleCallback`,
  because an ATS re-renders constantly and a scan per mutation would peg the CPU
- caps work per pass so a pathological page degrades instead of hanging
- scans frames on a granted host (`allFrames: true`) — JobDiva shows the candidate record in same-host frames. about:blank frames (rich-text editors) and third-party frames are never injected, and a `designMode` document is skipped

## False positives are the real risk

A recruiting page is full of numeric runs that are not phone numbers:
candidate IDs, requisition numbers, invoice references, salaries, ZIP+4,
tracking numbers. Underlining those is what makes someone switch the feature
off, so detection is **deliberately biased toward false negatives** — a missed
number costs one copy-paste; a wrong underline costs trust in the whole thing.

Guards: `isValid()` rather than `isPossible()`, a negative-context check for
preceding words like *invoice / req / ID / ref / acct / ticket*, rejection when
glued to other digits or a currency symbol, and a 10–15 digit window.
`src/detect.test.ts` pins both directions.

It is still a heuristic. If a specific ATS screen produces a bad underline,
add the label to `NEGATIVE_CONTEXT` in `src/detect.ts` and add a test.

## Build

```sh
npm run build -w apps/extension   # → apps/extension/dist + release/ace-dialer-extension-<version>.zip
npm run test  -w apps/extension
```

The zip in `release/` is the Chrome Web Store upload. Only re-upload when
`apps/extension/` changed — the version bumps with every app release, but a
store review for a no-op build buys nothing.

**Extension ID:** `ljncgopkhffengghjmeboinhjiccnpja` (Chrome Web Store, unlisted; first submitted October 20, 2026). The Intune policies reference it, so it must not change
between builds. After the first store upload, copy the public key from the
developer dashboard (Package → View public key) into `manifest.json` as
`"key"`, so unpacked dev builds get the same ID as the store build.

Load `apps/extension/dist` (not the source folder) via `chrome://extensions` →
Developer mode → **Load unpacked**.

libphonenumber is bundled into the content script, which is why `content.js` is
~125 KB. That's a deliberate trade for detection accuracy over a regex guess.

## Dialer panel

Click the toolbar icon → a Chrome side panel with five tabs (0.10.242.2):

| Tab | Shows | Source |
|---|---|---|
| Keypad | Type, paste or tap a number; Call / Text. Works signed out — it needs no data | — |
| Recents | The dialer's Recents, row for row: same calls, labels, red rows, times, lengths | `GET /me/panel/recents` |
| Messages | The dialer's conversation list (SMS), same order: who, who texted last, unread, failed send | `GET /me/panel/threads` |
| Favorites | The dialer's Favorites, same order, every number, searchable | `GET /me/panel/contacts` |
| Follow-ups | What's waiting on you (same computation as Reports → Follow-ups) | `GET /me/follow-ups` |

Every **Call** and **Text** only prefills the desktop app or web dialer, through
the same router as a clicked number, as *trusted* numbers (no `src`), so the
dialer treats them like a Teams-card link. Nothing in the panel dials or sends.
The toolbar badge is the follow-ups count, refreshed by a 2-minute
`chrome.alarms` tick; the Follow-ups tab carries it too. The last tab used is
remembered (`chrome.storage.local`).

Calls themselves still run in the desktop app or web dialer — deliberately.
Calling from inside the extension would need SIP credentials in the browser,
a hidden page to keep the call alive when the panel closes, and two devices
ringing for every inbound call.

**What the panel never shows:** message bodies, voicemail transcripts or
recordings. It sits beside other sites all day; it shows who, what kind, and
when. `apps/api/src/panel/panelView.ts` builds each response field by field
(tests pin it), so a column added to a table later can't ride along. Reading
the thread happens in the dialer.

### Sign-in and the scoped token

`src/session.ts` runs Microsoft sign-in in Chrome's own auth window
(`chrome.identity.launchWebAuthFlow`, PKCE + state, account picker), redirect
`https://<extension-id>.chromiumapp.org/`, then the API's normal
`/auth/microsoft/exchange`. Because of that redirect, the server mints a
**scoped** token (`apps/api/src/lib/extensionAuth.ts`): 12h, no admin, no SIP
credentials, and refused on every route except `GET /me/follow-ups`,
`GET /me/follow-ups/count` and the three `GET /me/panel/*` lists. It lives in `chrome.storage.session` (memory only,
gone when the browser quits, not readable by content scripts). Renewal is a
silent `prompt=none` sign-in with the last email as `login_hint`, at most every
30 minutes — the hint is what stops a shared machine from silently signing in
as whoever else is in the browser's Microsoft session. Sign out forgets it.

### Turning it on (one-time, per extension ID)

1. **Entra:** App registrations → the ACE Dialer app → Authentication → **Web**
   platform → add `https://<extension-id>.chromiumapp.org/` (trailing slash).
   One per ID: the Chrome Web Store ID, the Edge Add-ons ID, and any
   developer's unpacked ID.
2. **API env:** `EXTENSION_IDS=<id>,<id>` in the host `.env`, then
   `pm2 reload ace-api`. Unset = extension sign-in refused (403
   `extension_not_allowed`) — the click-to-call half still works.

Permissions this adds: `identity`, `alarms`, `sidePanel` — none of them shows
an install warning. Requires Chrome/Edge 116+.

## Browsers

| Browser | Status |
|---|---|
| Chrome, Edge | Both features. Edge installs from the Chrome Web Store, or publish separately on Edge Add-ons (separate ID → add it to Entra + `EXTENSION_IDS`). Intune: Edge has its own `ExtensionInstallForcelist` |
| Other Chromium (Brave, Opera, Arc, Vivaldi) | Click to call works (same APIs). The side panel depends on the browser implementing `chrome.sidePanel` — where it doesn't, the toolbar icon opens the panel in a tab instead. Untested; check before promising it |
| Firefox | Not as-is. Needs `background.scripts` instead of `service_worker`, `sidebar_action` instead of `side_panel`, and a different OAuth redirect (`*.extensions.allizom.org`) |
| Safari | Not as-is. Needs Apple's Safari Web Extension converter, an Xcode wrapper app, an Apple Developer account and App Store distribution; no `storage.managed` (no Intune policy) and no side panel |

## Desktop app or web dialer

Chrome can't tell whether the desktop app is installed, so the extension
doesn't guess. Options → "Where should a clicked number open?" picks desktop
(default) or web; an open web dialer tab always wins over either.

With "desktop" chosen and no app installed, a click still does nothing
visible — by design: the protocol URL opens in a background tab that closes
itself, rather than navigating the user's tab to an error page and losing
their work. Web-only users should choose "Web dialer" (or IT sets `openIn`).

A new web dialer tab starts signed out (`sessionStorage` is per tab), so it
goes through SSO and the route guard returns it to the keypad with the number.
Keeping one dialer tab open avoids that.

## Deployment

Force-install via Intune/GPO rather than asking 40+ people to do it by hand:

- **Chrome:** `ExtensionInstallForcelist` → `<extension-id>;https://clients2.google.com/service/update2/crx`
- **Edge:** `ExtensionInstallForcelist`, same shape

Managed storage (`managed_schema.json`), set under
`Software\Policies\Google\Chrome\3rdparty\extensions\<id>\policy`:

| Key | Type | Effect |
|---|---|---|
| `allowedOrigins` | string[] of match patterns, e.g. `*://app.jobdiva.com/*` | Listed on the options page as "Set by your administrator"; can't be removed there |
| `openIn` | `"desktop"` \| `"web"` | Locks the open-in choice |

A policy can **name** a site but cannot **grant** host access — Chrome still
needs the user's one click on "Allow" next to it on the options page. (Earlier
versions of this README said sites could be pre-granted; they can't.)

## Store listing

**Name:** ACE Dialer — Click to Call
**Summary:** Makes phone numbers on your ATS and CRM pages clickable, opening them in the ACE Dialer desktop app.

**Permission justification — `storage`:** stores the list of sites the user has
enabled.
**Permission justification — `scripting`:** registers the number scanner on
those sites only.
**Permission justification — host access (dialer.aptask.com):** our own web
dialer. Lets the extension find an open dialer tab and pass it the clicked
number without reloading it, which would end the user's call.
**Permission justification — optional host access:** requested per site at the
user's request, never up front. Required to read page text to find phone numbers.
**Remote code:** none.
**Data usage:** collects nothing, transmits nothing, makes no network requests.

Set visibility to **Unlisted** or private to the ApTask domain — it's useless
without an ACE Dialer account, and a public listing invites confused installs.
