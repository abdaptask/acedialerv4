# ACE Dialer — Click to Call (browser extension)

Finds phone numbers on a page and makes them clickable. One click opens the
number in the ACE Dialer desktop app, prefilled and ready — **the call is
never placed automatically; the user presses Call.**

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
| `host_permissions` | **none** |
| Static `content_scripts` | **none** |
| On a fresh install, it can read | **nothing** |

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
local `ace-dialer://` URL handled by an app on the same machine.

## Setup

1. Install the extension (see Deployment).
2. Click the toolbar icon, or Extensions → ACE Dialer → Options.
3. Add your ATS domain, e.g. `app.jobdiva.com`, and accept Chrome's prompt.

Numbers become clickable on that site immediately; no reload needed for new
tabs.

## How it connects to the app

```
page text → detect (libphonenumber) → clickable chip
          → click → ace-dialer://call?to=<number>&src=selection
          → desktop app validates with parseSelectedNumber() → dialer prefilled
```

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
npm run build -w apps/extension   # → apps/extension/dist
npm run test  -w apps/extension
```

Load `apps/extension/dist` (not the source folder) via `chrome://extensions` →
Developer mode → **Load unpacked**.

libphonenumber is bundled into the content script, which is why `content.js` is
~125 KB. That's a deliberate trade for detection accuracy over a regex guess.

## Requires the desktop app

The extension only opens a protocol URL. Without ACE Dialer installed, clicking
a number does nothing visible — by design: it opens a background tab and closes
it, rather than navigating the user's tab to an error page and losing their
work.

## Deployment

Force-install via Intune/GPO rather than asking 40+ people to do it by hand:

- **Chrome:** `ExtensionInstallForcelist` → `<extension-id>;https://clients2.google.com/service/update2/crx`
- **Edge:** `ExtensionInstallForcelist`, same shape

Domains can be pre-granted by policy so users never see the options page —
combine `ExtensionInstallForcelist` with a managed-storage policy for the
allowlist if you want it fully hands-off.

## Store listing

**Name:** ACE Dialer — Click to Call
**Summary:** Makes phone numbers on your ATS and CRM pages clickable, opening them in the ACE Dialer desktop app.

**Permission justification — `storage`:** stores the list of sites the user has
enabled.
**Permission justification — `scripting`:** registers the number scanner on
those sites only.
**Permission justification — host access:** requested per site at the user's
request, never up front. Required to read page text to find phone numbers.
**Remote code:** none.
**Data usage:** collects nothing, transmits nothing, makes no network requests.

Set visibility to **Unlisted** or private to the ApTask domain — it's useless
without the desktop app, and a public listing invites confused installs.
