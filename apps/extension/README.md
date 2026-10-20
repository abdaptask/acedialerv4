# ACE Dialer — Click to Call (browser extension)

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
| `host_permissions` | **`https://dialer.aptask.com/*` only** — our own web dialer, for the hand-off below |
| Static `content_scripts` | **one**, `dialerBridge.js`, on `dialer.aptask.com` only |
| On a fresh install, it can read | **nothing but our own dialer** |

Instead it declares `optional_host_permissions` and registers the scanner
**dynamically, per domain**, via `chrome.scripting.registerContentScripts()`.
A domain becomes active only when someone adds it on the options page, which
triggers Chrome's own permission prompt. Removing it there revokes the grant
immediately.

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
- skips iframes (`allFrames: false`) — usually ads and widgets, cost without benefit

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

**Extension ID:** the Intune policies reference it, so it must not change
between builds. After the first store upload, copy the public key from the
developer dashboard (Package → View public key) into `manifest.json` as
`"key"`, so unpacked dev builds get the same ID as the store build.

Load `apps/extension/dist` (not the source folder) via `chrome://extensions` →
Developer mode → **Load unpacked**.

libphonenumber is bundled into the content script, which is why `content.js` is
~125 KB. That's a deliberate trade for detection accuracy over a regex guess.

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
