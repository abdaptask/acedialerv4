# Email draft — ACE Dialer 0.10.221 user announcement

**Subject:** ACE Dialer: call a number without retyping it, and never lose a half-written text

---

Hi all,

Two additions to ACE Dialer are now live. Both save you a step you've been doing by hand.

## 1. Call a number you find in another app

No more reading a number off one screen and typing it into the dialer.

**One-time setup** — open **Settings → Click to dial**. There are two switches, both off until you turn them on:

**"Open phone links in ACE Dialer"**
For numbers that are already clickable — an Outlook signature, a Teams message, a web page. Turn this on and clicking one opens ACE Dialer with the number filled in. Windows and macOS keep their own default app for phone links, so the first time you may need to confirm ACE Dialer there.

**"Dial what I've copied (Ctrl+Shift+D)"** — on a Mac, Cmd+Shift+D
For a number that's just text on the screen, which is most ATS and CRM records. Two steps:

1. **Copy the number — Ctrl+C.** This part matters: the shortcut reads what you've copied, not what you've highlighted. Highlighting alone isn't enough, and if you skip the copy you'll get whatever you copied earlier.
2. Press **Ctrl+Shift+D**. ACE Dialer comes forward with the number in the dialer.

**In both cases the call never starts on its own.** The number is filled in and you press Call — so you always get a look at it first.

A few things it handles for you:

- Spaces, dashes and brackets are cleaned up, and the country code is kept as-is.
- An extension like "x203" is dialled for you once the call connects.
- If the text you copied isn't a phone number, you get a message showing the text it actually read, rather than a wrong number sitting in the dialer.
- If the text holds two numbers — a candidate ID next to a phone number, say — it names both and asks you to copy just the one you want. It won't guess.

On privacy: ACE Dialer only looks at your clipboard at the moment you press the shortcut. It never watches it in the background.

Click to dial needs the desktop app, since it registers with Windows or macOS to catch phone links and shortcuts. It isn't available in the browser version.

## 2. A half-written text is no longer lost

Nothing to turn on for this one.

If you're partway through typing a message and a call comes in, or you switch to another conversation, or you close the app — your text is still there when you come back to that conversation. Conversations holding unsent text are marked **Draft** in the message list, with a preview of what you'd written, so you can see at a glance what's still waiting to go out.

Your draft clears once the message actually sends. If a send fails, your text stays put.

Drafts are kept on the computer you typed them on, and are cleared when you sign out.

## Getting the update

ACE Dialer updates itself. If you don't see **Click to dial** in Settings, use **Check for updates** in the menu under your name, then restart the app when it offers to.

Any trouble, reply to this email or message me in the dialer's Chat tab.

Thanks,
Abdulla
