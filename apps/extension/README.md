# ACE Dialer — Click to Call (browser extension)

Adds **"Call with ACE Dialer"** to the right-click menu on selected text in
Chrome and Edge. Highlight a phone number anywhere on a page, right-click,
and the desktop dialer opens with the number prefilled — the call is **not**
placed until the user clicks Call.

## Why an extension exists at all

macOS has a system-wide Services menu, so "right-click on selected text" works
across native apps there. **Windows has no equivalent** — the shell context
menu operates on files, not text selections. Inside a browser, neither OS can
help: the page's context menu belongs to the browser. So for the surface where
recruiters actually spend the day — a web ATS and CRM — an extension is the
only way to offer right-click-to-call, on either OS.

## Permissions, and what it deliberately doesn't ask for

The manifest requests exactly one permission: `contextMenus`.

There is **no content script** and **no host permission**. That is a
deliberate security decision rather than an oversight: our users work inside
systems full of candidate PII, and `<all_urls>` would let this extension read
every page they visit. Chrome passes the highlighted text in the click event
(`info.selectionText`), which is all the feature needs, and only for the
selection the user explicitly right-clicked.

The selected text never leaves the machine — it becomes a local
`ace-dialer://` URL. **The extension makes no network requests of any kind.**

## How it connects to the app

```
selection → ace-dialer://call?to=<text>&src=selection → desktop app
          → validated with parseSelectedNumber() → dialer field prefilled
```

`src=selection` tells the app the text came from a human highlight, so it
validates strictly and shows an error for anything that isn't a phone number.
Numbers coming from our own database (Teams cards) omit the marker and keep
their existing behaviour.

Validation lives in the app, not here, so there is exactly one parser rather
than two that drift apart.

## Requirements

The **desktop app must be installed** — the extension opens a protocol URL and
does nothing on its own. Browser-only users should use the in-app dialer.

## Deployment

For the ApTask fleet, force-install via Intune/GPO rather than asking 40+
people to install it by hand:

- **Chrome:** `ExtensionInstallForcelist` → `<extension-id>;https://clients2.google.com/service/update2/crx`
- **Edge:** `ExtensionInstallForcelist`, same shape

Requires publishing to the Chrome Web Store / Edge Add-ons (or hosting a
self-updating CRX). Unpacked loading via `chrome://extensions` → Developer
mode → **Load unpacked** works for testing.

## Icons

`icons/` is empty in the repo. Add 16/48/128px PNGs before publishing — the
Web Store rejects submissions without them.

## Chrome Web Store / Edge Add-ons listing

Review asks for a permission justification and a data-use disclosure. Ours is
unusually easy because the honest answer is "none" — draft copy below.

**Name:** ACE Dialer — Click to Call
**Summary (132 char max):** Highlight a phone number on any page, right-click, and call it with ACE Dialer. Requires the ACE Dialer desktop app.

**Description:**
> Call phone numbers you find on the web without retyping them.
>
> Highlight a phone number on any page, right-click, and choose "Call with ACE
> Dialer". The number opens in your ACE Dialer desktop app, already filled in.
> The call is never placed automatically — you always press Call yourself.
>
> Numbers are cleaned up for you: spaces, dashes, and brackets are removed
> while the country code is kept, and extensions such as "x203" are dialled
> after the call connects.
>
> This extension requires the ACE Dialer desktop application to be installed.
> It is intended for ApTask staff.

**Permission justification — `contextMenus`:**
> Used solely to add one "Call with ACE Dialer" item to the right-click menu,
> shown only when text is selected.

**Permission justification — host permissions / content scripts:**
> None requested. The extension reads only the text the user explicitly
> right-clicks, which Chrome provides in the context-menu click event
> (`info.selectionText`). It cannot read page content.

**Remote code:** No. All code is contained in the package.

**Data usage disclosure:** This extension does **not** collect, transmit, or
store any user data. The selected text is placed into a local `ace-dialer://`
URL that is handled by an application on the same machine. The extension makes
no network requests of any kind.

**Distribution:** Set visibility to **Unlisted** (or Private to the ApTask
domain) rather than Public. This is an internal tool that is useless without
the desktop app, and a public listing invites confused installs and bad
reviews.
