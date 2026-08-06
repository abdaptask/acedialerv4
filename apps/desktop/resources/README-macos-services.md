# "Call with ACE Dialer" — macOS Services item

Adds **Call with ACE Dialer** to the right-click menu on selected text in
macOS apps. Highlight a phone number in Mail, Safari, Preview (PDF), Notes,
Pages — anywhere Cocoa's text system is used — right-click, and the dialer
opens with the number prefilled. The call is **not** placed; the user presses
Call.

## Status: shipped but NOT auto-installed — deliberate

The app does **not** install this on first run, and that is a decision rather
than an omission.

Automator Quick Actions containing a shell action interact with Gatekeeper,
notarization, and (on recent macOS) the "app wants to control another app"
consent flow in ways I could not verify without a Mac to test on. Auto-copying
a bundle into `~/Library/Services` at runtime is exactly the kind of thing
that either silently does nothing or produces a scary consent prompt the user
wasn't expecting — and shipping that untested to 40+ people is worse than
shipping nothing.

So the artifact is here, it's complete, and it can be installed manually in
one step. **Before wiring it into the installer, test the checklist below on a
real Mac.**

macOS users are not blocked in the meantime: `tel:` link handling and the
clipboard hotkey both work today and cover most of the same ground. The
Services item only adds right-click-on-selection *outside* the browser (inside
the browser, the extension covers it on both platforms).

## Manual install

```sh
mkdir -p ~/Library/Services
cp -R "Call with ACE Dialer.workflow" ~/Library/Services/
```

Then, if it doesn't appear immediately:

1. **System Settings → Keyboard → Keyboard Shortcuts → Services → Text**
2. Tick **Call with ACE Dialer**
3. Optionally assign a keyboard shortcut there

Log out and back in if the Services menu hasn't refreshed.

To uninstall: `rm -rf ~/Library/Services/"Call with ACE Dialer.workflow"`

## How it works

```
selected text → stdin → python3 urlencode
              → open "ace-dialer://call?to=<text>&src=selection"
              → app validates with parseSelectedNumber() → dialer prefilled
```

The workflow is a **dumb pipe**. It does no validation of its own — the app
owns `parseSelectedNumber()`, and a second, weaker parser here would drift and
disagree. `src=selection` tells the app this came from highlighted text, so it
validates strictly and shows an error for anything that isn't a phone number.

Design notes worth preserving if you edit the plists:

- `NSSendTypes` is text only. No files, no URLs — the item then stays out of
  menus where it would make no sense.
- **No `NSReturnTypes`.** Declaring one would let the service replace the
  user's selection. This service acts; it must never overwrite text in an
  editable field.
- Input is capped at 200 characters, matching the app's own cap, so selecting
  a whole document doesn't build an enormous URL.

## Test checklist (needs a real Mac)

- [ ] Item appears after copying to `~/Library/Services` (Text services)
- [ ] Works in Safari, Mail.app, Notes, Preview (PDF), TextEdit
- [ ] Works in Chrome (Chrome's Services support is partial — verify)
- [ ] Gatekeeper: no warning on first invocation from a **notarized** build
- [ ] No unexpected Automation/Accessibility consent prompt
- [ ] Cold start: app not running → launches and prefills
- [ ] Invalid selection ("hello world") → app shows the error, does not prefill
- [ ] Extension in text (`x203`) → dialled as post-dial DTMF
- [ ] User-assigned keyboard shortcut fires it
- [ ] Uninstall removes it cleanly from the menu

Once that passes, wiring it into the installer is a small change: add
`resources/` to electron-builder's `extraResources` and copy it into
`~/Library/Services` on first run, behind the same Settings toggle the other
two capture surfaces already use.
