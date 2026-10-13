// Settings → Help content. Rendered by pages/settings/HelpSection.tsx.
//
// Rules for editing:
// - `message` is the text exactly as the user sees it on screen (curly quotes
//   and all). People search by retyping what they saw, so a paraphrase here
//   makes the entry unfindable. When you change a string in the UI, change it
//   here in the same commit.
// - `meaning` says what happened in plain words; `fix` says what to do. No
//   internal names (SIP, Telnyx, webhook) unless the screen itself shows them.
// - Placeholders the UI fills in are written as <number>, <reason>, etc.

export interface HelpIssue {
  message: string;
  meaning: string;
  fix?: string;
}

export interface HelpTopic {
  id: string;
  title: string;
  summary: string;
  /** Extra search words that don't appear in the text (synonyms, slang). */
  keywords?: string[];
  steps?: string[];
  issues: HelpIssue[];
}

export interface HelpArea {
  key: string;
  label: string;
  topics: HelpTopic[];
}

const SIGN_IN_AGAIN = 'Sign out and sign back in. If it keeps happening, email support with the time.';

export const HELP_AREAS: HelpArea[] = [
  // -------------------------------------------------------------------------
  {
    key: 'connection',
    label: 'Sign-in & connection',
    topics: [
      {
        id: 'status-pill',
        title: 'The connection status',
        summary: 'The dot in the middle of the top bar (and the badge above the keypad) shows whether you can make and take calls.',
        keywords: ['registered', 'red', 'green', 'amber', 'yellow', 'status', 'cannot call', "can't receive calls"],
        steps: [
          'Green means you can make and receive calls.',
          'Amber means the dialer is connecting or reconnecting. Wait a few seconds.',
          'Red means you can’t make or receive calls right now. Calls to your number go to voicemail.',
          'Short drops during a call are hidden. Your call keeps going.',
        ],
        issues: [
          { message: 'Online / Registered', meaning: 'Connected. You can make and receive calls.' },
          { message: 'Connecting…', meaning: 'The dialer is signing in to the phone service, or retrying after a failed attempt.', fix: 'Wait. If it stays amber for more than a minute, check your internet connection.' },
          { message: 'Reconnecting…', meaning: 'Your connection dropped and the dialer is getting it back.', fix: 'Wait. It usually recovers within seconds. If it turns red, see “Offline”.' },
          { message: 'Offline / Connection failed', meaning: 'The dialer couldn’t connect to the phone service. The top bar says “Offline” and the keypad says “Connection failed”. Both mean the same thing.', fix: 'Check your internet connection or VPN, then sign out and back in. If you stay offline for 90 seconds you are signed out automatically.' },
          { message: 'Disconnected', meaning: 'Not connected to the phone service.', fix: SIGN_IN_AGAIN },
        ],
      },
      {
        id: 'session-expired',
        title: 'Signed out unexpectedly',
        summary: 'Why the dialer sends you back to the sign-in page, and what the yellow message there means.',
        keywords: ['logged out', 'kicked out', 'session', 'login again'],
        issues: [
          { message: 'Your session expired — please sign in again.', meaning: 'Your sign-in ran out or was revoked, so the server stopped accepting requests from this window.', fix: 'Sign in again. While a session is expired, contact names, line types and transfers stop working even if calls still connect.' },
          { message: 'Lost connection to the calling service — please sign in again.', meaning: 'The dialer couldn’t reach the phone service for 90 seconds straight.', fix: 'Sign in again. If it keeps happening, your network, VPN or firewall may be blocking the connection; tell IT or support.' },
        ],
      },
      {
        id: 'sign-in',
        title: 'Signing in',
        summary: 'Use “Sign in with Microsoft” with your ApTask account. Password sign-in is for admins only.',
        keywords: ['login', 'microsoft', 'sso', 'password', 'account'],
        issues: [
          { message: 'Your ApTask account hasn\'t been invited to the dialer yet. Ask your admin.', meaning: 'Your Microsoft sign-in worked, but no dialer account exists for you.', fix: 'Ask an admin to invite you.' },
          { message: 'Your dialer account has been deactivated. Contact your admin.', meaning: 'An admin turned your account off.', fix: 'Contact an admin.' },
          { message: 'Sign-in session expired — please try again.', meaning: 'Too much time passed between leaving for the Microsoft page and coming back, or the sign-in was started in a different window.', fix: 'Click “Sign in with Microsoft” again and finish in the same window.' },
          { message: 'Sign-in returned without a code — please try again.', meaning: 'Microsoft sent you back without finishing the sign-in.', fix: 'Try again. If you cancelled on the Microsoft page, that’s expected.' },
          { message: 'Microsoft sign-in failed: <reason>', meaning: 'Microsoft refused the sign-in. The reason comes from Microsoft.', fix: 'Read the reason. Most often it is a password, MFA or account issue on the Microsoft side.' },
          { message: 'Single sign-on is not configured on the server. Contact your admin.', meaning: 'The server is missing its Microsoft settings.', fix: 'Contact an admin.' },
          { message: 'Sign-in failed. / Login failed / Could not start Microsoft sign-in', meaning: 'Something went wrong talking to the server.', fix: 'Check your connection and try again.' },
        ],
      },
    ],
  },

  // -------------------------------------------------------------------------
  {
    key: 'calls',
    label: 'Making & receiving calls',
    topics: [
      {
        id: 'dialpad',
        title: 'Using the keypad',
        summary: 'Type, paste or click a number, then press Call. Your keyboard works anywhere on the Keypad page.',
        keywords: ['dial', 'keypad', 'paste', 'redial', 'last number', 'extension', 'international', 'country'],
        steps: [
          'Keyboard: digits, * # +, Backspace to delete, Esc to clear, Enter to call.',
          'Paste any format: “+1 (973) 727-0611”, “973.727.0611” or a tel: link. A 10-digit number is treated as US/Canada.',
          'International: start with + and the country code. If you type 11 or more digits that form a valid international number, the + is added for you.',
          'Redial: press Call on an empty field to bring back the last number you dialed, then press Call again.',
          'Extensions: a number from click-to-dial with “x203” or “ext 203” dials the number, waits, then sends 203 for you.',
        ],
        issues: [
          { message: 'Can\'t call yet — SIP state: <state>. Wait for "Registered" badge above keypad.', meaning: 'You pressed Enter before the dialer finished connecting.', fix: 'Wait for the green “Registered” badge, then press Call.' },
          { message: 'SIP not ready (<state>). Try again in a moment.', meaning: 'You tried to call from Favorites, Recents, Voicemail or Messages before the dialer was connected.', fix: 'Wait for the green status, then try again. If it stays red, see “The connection status”.' },
        ],
      },
      {
        id: 'outbound',
        title: 'Placing a call',
        summary: 'What the call screen shows while it rings, connects and ends.',
        keywords: ['outbound', 'ringing', 'ended', 'call failed', 'dropped'],
        issues: [
          { message: 'Calling… / Ringing…', meaning: 'The call is being placed, or the other phone is ringing. You hear a ringback tone.' },
          { message: 'Ended', meaning: 'The call is over. After a moment the dialer returns to the keypad.' },
          { message: 'Ended (mic_permission_denied)', meaning: 'The dialer wasn’t allowed to use your microphone, so the call couldn’t start.', fix: 'Allow microphone access for the dialer (browser address-bar icon, or Windows/macOS privacy settings), then check Settings → Microphone.' },
          { message: 'Ended (Busy)', meaning: 'The other line was busy.' },
          { message: 'Ended (Rejected)', meaning: 'The other side declined the call.' },
          { message: 'Ended (No Answer) / Ended (Unavailable)', meaning: 'Nobody picked up, or the other phone wasn’t reachable.' },
          { message: 'Ended (Not Found)', meaning: 'The number isn’t in service or doesn’t exist.', fix: 'Check the number. Fix it in the candidate record if it’s wrong.' },
          { message: 'Ended (Canceled)', meaning: 'You hung up before they answered.' },
          { message: 'Ended (Connection Error) / Ended (Request Timeout)', meaning: 'Your connection to the phone service failed during the call.', fix: 'Check your internet connection and call back. If it happens often, use wired internet and email support.' },
          { message: 'Ended (User Denied Media Access)', meaning: 'The browser blocked the microphone.', fix: 'Allow microphone access for the dialer and try again.' },
        ],
      },
      {
        id: 'inbound',
        title: 'Answering a call',
        summary: 'Incoming calls show a ringer with Accept, Decline and Reply with Text. On the desktop app a small popup also appears in the corner of your screen.',
        keywords: ['incoming', 'answer', 'decline', 'ringer', 'popup', 'reply with text', 'not ringing'],
        steps: [
          'The line badge (“on Main · (732) 200-1305”) shows which of your numbers they called.',
          'Decline sends the caller a busy signal. It does not ring again.',
          'Reply with Text declines the call and opens a quick-reply box that sends a text from your number.',
          'If you are already on a call, Accept is replaced by Hold & Accept.',
        ],
        issues: [
          { message: 'Ended (mic_acquire_failed)', meaning: 'You accepted, but your microphone didn’t respond within 3 seconds. The caller was told you were unavailable, and your microphone choice was reset to System default.', fix: 'Check your headset is plugged in and not in use by another app, then choose it again in Settings → Microphone.' },
          { message: 'Ended (state_desync)', meaning: 'You pressed Accept just after the caller hung up.', fix: 'Call them back from Recents.' },
          { message: 'Could not send. / Not signed in.', meaning: 'The reply text after declining didn’t go out.', fix: 'Open Messages and send it from there. “Not signed in” means you need to sign in again.' },
          { message: 'Calls aren’t ringing at all', meaning: 'Usually the status is red, the desktop app was quit, or call forwarding is set to “always”.', fix: 'Check the status is green, keep the app running in the tray, and check Settings → Call forwarding.' },
        ],
      },
      {
        id: 'quality',
        title: 'Call quality indicator',
        summary: 'The signal icon next to the call timer shows how your connection is doing.',
        keywords: ['choppy', 'robotic', 'breaking up', 'echo', 'delay', 'poor connection', 'jitter', 'loss'],
        issues: [
          { message: 'Good connection', meaning: 'Your connection is fine.' },
          { message: 'Fair connection', meaning: 'Some delay or lost audio. The other side may notice small glitches.' },
          { message: 'Poor connection', meaning: 'Enough delay or lost audio that the call will sound choppy.', fix: 'Use wired internet or move closer to Wi-Fi, close video calls and large downloads, and use a wired headset.' },
          { message: 'Measuring…', meaning: 'The call just connected. The dialer is still measuring.' },
          { message: 'Connected, but you can’t hear them (or they can’t hear you)', meaning: 'One-way audio. Usually a network or firewall issue on one side.', fix: 'Hang up and call back. If it repeats, download the log from Settings → Diagnostics and email support with the time and number.' },
        ],
      },
    ],
  },

  // -------------------------------------------------------------------------
  {
    key: 'in-call',
    label: 'During a call',
    topics: [
      {
        id: 'controls',
        title: 'Mute, keypad, hold and audio',
        summary: 'The buttons on the call screen. Most are greyed out until the call connects.',
        keywords: ['mute', 'hold', 'resume', 'keypad', 'dtmf', 'extension', 'menu', 'press 1', 'speaker', 'headset', 'hold music'],
        steps: [
          'Mute: they can’t hear you until you press Unmute.',
          'Keypad: send tones to a phone menu. Typing digits on your keyboard during a call also sends them. Backspace only edits the display; a tone already sent can’t be taken back.',
          'Hold / Resume: with hold music on, the caller hears music. Otherwise they hear silence.',
          'Audio: switch the speaker or headset mid-call.',
          'Message: open a text conversation with the person you’re talking to.',
        ],
        issues: [
          { message: 'No output devices detected.', meaning: 'The dialer can’t see your speakers or headset, usually because it doesn’t have microphone permission.', fix: 'Allow microphone access, then reopen the Audio menu.' },
          { message: 'Audio output updated', meaning: 'The call’s sound is now going to the device you picked.' },
          { message: 'Callers hear silence when I put them on hold', meaning: 'Hold music is off, or no music file has been set up.', fix: 'Turn on “Enable hold music” in Settings → Hold music. If it says “No file configured yet.”, ask an admin.' },
        ],
      },
      {
        id: 'two-calls',
        title: 'Add call, swap and hold & accept',
        summary: 'You can have two calls at once: one active and one on hold.',
        keywords: ['second call', 'add call', 'swap', 'switch', 'call waiting', 'hold and accept'],
        steps: [
          'Add Call puts the current call on hold and opens the keypad for the second number.',
          'Hold & Accept (on the ringer) holds your current call and answers the new one.',
          'Tap the “On hold” card to swap between calls.',
          'Ending the active call makes the held call active. Two calls is the maximum.',
        ],
        issues: [
          { message: 'Preparing call via Telnyx Call Control…', meaning: 'The second call is being set up.', fix: 'Wait a second or two. Press Cancel to go back to the first call.' },
          { message: 'You need an active connected call before adding another.', meaning: 'Add Call only works once the first call is connected.' },
          { message: 'Add Call failed', meaning: 'The second call couldn’t be placed. Your first call is still on hold.', fix: 'Tap “Tap to return” to go back to the first call, then try again.' },
          { message: 'Ended held call', meaning: 'You hung up the call that was on hold.' },
        ],
      },
      {
        id: 'merge',
        title: 'Merging into a 3-way call',
        summary: 'With two calls, Merge joins everyone into one conversation.',
        keywords: ['conference', '3-way', 'three way', 'merge', 'mute participant', 'drop participant'],
        steps: [
          'Your Mute button mutes you to everyone.',
          'Muting a participant silences them for you and the other person. They can still hear both of you.',
          'Drop a participant to hang up on just them.',
          'The call is mixed on your computer, so if you hang up, the conference ends for everyone.',
        ],
        issues: [
          { message: 'Merged into conference', meaning: 'All three of you can hear each other.' },
          { message: 'Merge failed', meaning: 'The calls couldn’t be joined. Both calls are still connected.', fix: 'Try Merge again, or swap between the two calls.' },
          { message: 'Dropped from conference', meaning: 'That participant was hung up. You’re still on the call with the other one.' },
        ],
      },
      {
        id: 'transfer',
        title: 'Transferring a call',
        summary: 'Transfer sends the caller to another number and drops you from the call.',
        keywords: ['transfer', 'forward call', 'hand off', 'blind transfer'],
        issues: [
          { message: 'Transferring to <number>…', meaning: 'The transfer is in progress. Your side of the call will end.' },
          { message: 'This call isn’t ready to transfer yet. Wait a few seconds and try again.', meaning: 'The phone service hasn’t finished setting up this call on its side, so it can’t be transferred yet.', fix: 'Wait a few seconds and try again. If it never works, give the caller the number to call instead, and tell support.' },
          { message: 'No DID is assigned to your account to transfer from.', meaning: 'Your account has no phone number to transfer the call from.', fix: 'Ask an admin to assign a number to your account.' },
          { message: '<reason> (code <n>) / Telnyx returned HTTP <status>', meaning: 'The phone carrier refused the transfer, most often because the destination number is wrong.', fix: 'Check the number and try again.' },
          { message: 'Transfer failed', meaning: 'The transfer didn’t go through. You are still on the call.', fix: 'Try again or give the caller the number.' },
        ],
      },
    ],
  },

  // -------------------------------------------------------------------------
  {
    key: 'numbers',
    label: 'Phone numbers',
    topics: [
      {
        id: 'line-type',
        title: 'Mobile, Landline, VoIP and Unknown labels',
        summary: 'The small label under a number on the keypad, call screen and Messages shows what kind of line it is.',
        keywords: ['line type', 'mobile', 'cell', 'landline', 'voip', 'toll-free', 'unknown', 'carrier', 'verified', 'ported', 'badge'],
        steps: [
          'With a check mark: confirmed with the phone carrier. Hover to see the carrier, and whether the number was ported.',
          'Without a check mark: worked out from the number format only. Ported numbers may differ.',
          'For US and Canadian numbers the number itself doesn’t say whether it’s a mobile, so only a carrier check can tell.',
          'The label never delays or blocks a call or text.',
        ],
        issues: [
          { message: 'Unknown', meaning: 'The type couldn’t be determined. For a US/Canadian number this means the carrier check didn’t run. The most common reason is an expired sign-in.', fix: 'Sign out and back in, then look at the number again. If it still says Unknown, the carrier didn’t report a type.' },
          { message: 'US and Canadian numbers don’t show mobile, landline or VoIP in the number itself, and carrier lookup is unavailable.', meaning: 'The tooltip on an Unknown label when the carrier check couldn’t run.', fix: 'Sign out and back in. If it persists, email support with the number.' },
          { message: 'Checking…', meaning: 'The carrier check is running. It takes about a second.' },
          { message: 'Landline or VoIP', meaning: 'The carrier says “fixed line”, which covers both real landlines and internet phone numbers. It can’t tell them apart.', fix: 'Texts to it may not be delivered. Call instead.' },
          { message: 'VoIP', meaning: 'An internet phone number (Google Voice, RingCentral, Teams and similar). These can usually take calls; some can’t receive texts.' },
          { message: 'Invalid number', meaning: 'The number is the right length but isn’t a real phone number (for example a 555 number, or too many digits).', fix: 'Check the digits.' },
          { message: 'The type can’t be determined from this number’s format.', meaning: 'An international number whose format doesn’t indicate the line type.' },
          { message: 'Toll-free / Premium-rate', meaning: 'A toll-free number (800, 888…), or a premium-rate number that may cost money to call.' },
        ],
      },
      {
        id: 'click-to-dial',
        title: 'Click to dial from other apps (desktop app)',
        summary: 'Send a number from your ATS, Outlook or a web page into the dialer without retyping it. The number is only filled in; nothing dials until you press Call.',
        keywords: ['click to dial', 'click to call', 'hotkey', 'shortcut', 'ctrl+shift+d', 'tel link', 'extension', 'chrome', 'highlight', 'clipboard', 'copy'],
        steps: [
          'Turn the options on in Settings → Click to dial (desktop app only).',
          'Phone links: “Open phone links in ACE Dialer” makes clickable phone links open here. Windows or macOS may ask you once which app to use.',
          'Plain text: copy the number (Ctrl+C), then press Ctrl+Shift+D (Cmd+Shift+D on Mac). The shortcut reads what you copied, not what you highlighted.',
          'Chrome extension: on sites you add in its options, numbers get a dotted underline. Click one to fill it into the dialer.',
          'A failed capture empties the keypad on purpose, so you can’t call an old number by mistake.',
        ],
        issues: [
          { message: 'Your clipboard still holds <number>.', meaning: 'You pressed the shortcut but hadn’t copied anything new, so it found the same number as last time.', fix: 'Highlight the new number, press Ctrl+C, then the shortcut.' },
          { message: 'That is what was on your clipboard. The hotkey reads the clipboard, not what you highlighted — press Ctrl+C on the number first, then the hotkey.', meaning: 'The text the shortcut found wasn’t a number you meant to dial.', fix: 'Copy the number first, then press the shortcut.' },
          { message: 'That doesn\'t contain a phone number: “<text>”', meaning: 'The text it got had no phone number in it.', fix: 'Copy or select just the number.' },
          { message: 'That\'s too short to dial: “<text>”', meaning: 'Fewer than 7 digits, often an ID or a partial number.' },
          { message: 'That number is too long to be a phone number.', meaning: 'More than 15 digits, often two numbers run together or an ID.' },
          { message: 'That text holds more than one number (<A> and <B>) — highlight just the one you want.', meaning: 'It found two different numbers and won’t guess which one you meant.', fix: 'Select just the one number.' },
          { message: 'That doesn\'t look like a valid phone number: “<text>”', meaning: 'It has the right number of digits but isn’t a real phone number (often a candidate or job ID).' },
          { message: 'That looks like a vanity number — AceDialer can\'t dial letters.', meaning: 'Numbers like 1-800-FLOWERS can’t be dialed from the letters.', fix: 'Type the digits on the keypad.' },
          { message: 'That selection is too long — highlight just the phone number.', meaning: 'You selected a whole paragraph or page.' },
          { message: 'No text was selected.', meaning: 'Nothing was highlighted when you used it.' },
          { message: 'That came from the link you clicked, not from anything you typed.', meaning: 'The phone link on the page itself held a bad number.', fix: 'Type the number by hand, and fix the record the link came from.' },
          { message: 'That shortcut is already in use by another app.', meaning: 'Another program already owns Ctrl+Shift+D, so the dialer can’t use it. The setting switches itself back off.', fix: 'Close or reconfigure the other app, then turn the option on again.' },
          { message: 'Your operating system still has another app set as the default for phone links.', meaning: 'Teams, FaceTime or another app is still opening phone links.', fix: 'Click a phone link once and choose ACE Dialer, or change it in your computer’s default-apps settings.' },
          { message: 'Click to dial needs the desktop app', meaning: 'You’re using the dialer in a web browser, which can’t catch links or shortcuts from other apps.', fix: 'Install the ACE Dialer desktop app.' },
          { message: 'Access was not granted, so this site was not added.', meaning: 'Chrome asked for permission to read that site and it was declined. The extension needs it to find numbers on the page.', fix: 'Add the site again and choose Allow.' },
          { message: 'Clicking an underlined number does nothing', meaning: 'The page changed after the number was underlined, or the desktop app isn’t installed.', fix: 'Reload the page. Make sure the desktop app is installed and running.' },
        ],
      },
      {
        id: 'teams-links',
        title: 'Call back links in Teams and email',
        summary: 'The “Call back” button in a missed-call card or email opens the dialer with the number filled in.',
        keywords: ['call back', 'teams card', 'email link', 'opening the dialer'],
        issues: [
          { message: 'Opening the dialer', meaning: 'The page is handing the number to the desktop app. You can close the browser tab.', fix: 'If the app doesn’t open, click “Open in browser dialer”.' },
        ],
      },
    ],
  },

  // -------------------------------------------------------------------------
  {
    key: 'audio',
    label: 'Microphone & audio',
    topics: [
      {
        id: 'devices',
        title: 'Choosing your microphone and speaker',
        summary: 'Settings → Microphone and Settings → Speaker pick which headset the dialer uses. Choices are saved on this computer.',
        keywords: ['headset', 'mic', 'microphone', 'speaker', 'headphones', 'bluetooth', 'cannot hear', 'muffled', 'noise'],
        steps: [
          '“System default” follows whatever Windows or macOS is set to.',
          'Use “Test speaker” to play a short beep through the chosen device.',
          'Noise suppression (Settings → Microphone) filters keyboard taps and fans. Some headsets sound muffled with it on. It applies from your next call.',
        ],
        issues: [
          { message: 'Mic access denied', meaning: 'The dialer isn’t allowed to use the microphone, so it can’t list your devices.', fix: 'Allow microphone access (the browser address-bar icon, or Windows/macOS Privacy → Microphone), then reopen Settings.' },
          { message: 'Speaker selection not supported in this browser. Uses system default.', meaning: 'Your browser can’t choose a speaker. Sound goes to the system default.', fix: 'Change the default in your computer’s sound settings, or use Chrome/Edge or the desktop app.' },
          { message: 'Test playback failed / setSinkId: <reason>', meaning: 'The dialer couldn’t play sound through that device. It may be unplugged or in use.', fix: 'Reconnect the headset, or choose “Use system default”.' },
          { message: 'My microphone choice keeps resetting to System default', meaning: 'The chosen microphone didn’t respond when a call came in, so the dialer reset it to make sure the next call works.', fix: 'Check the headset, then pick it again.' },
          { message: 'The other person says I sound muffled or like I’m in a tunnel', meaning: 'Usually extra noise filtering from the headset or the dialer.', fix: 'Turn off Noise suppression in Settings → Microphone. Also check your headset’s own software for noise cancelling.' },
        ],
      },
    ],
  },

  // -------------------------------------------------------------------------
  {
    key: 'texts',
    label: 'Text messages',
    topics: [
      {
        id: 'sending',
        title: 'Sending a text',
        summary: 'Open a conversation in Messages, or press the new-message button and type a number. Enter sends; Shift+Enter adds a new line.',
        keywords: ['sms', 'text', 'send', 'new message', 'compose', 'draft', 'your line', 'from number'],
        steps: [
          '“Your line” above the box shows which of your numbers the text is sent from. Changing it changes your outgoing number everywhere.',
          'Unsent text is kept as a draft on this computer, even if you take a call. It shows as “Draft” in the list.',
          'Ticks on your message: a clock means sending, one check means sent, two checks means delivered to their phone.',
        ],
        issues: [
          { message: '<n> characters — 1600 is the limit. Shorten it or send in two texts.', meaning: 'A single text can be at most 1600 characters. Send is turned off until it fits.', fix: 'Shorten it, or split it into two texts.' },
          { message: 'Couldn’t load this conversation', meaning: 'The conversation didn’t load from the server.', fix: 'Press Retry. If it keeps failing, sign out and back in.' },
          { message: 'Failed to load conversations', meaning: 'The message list didn’t load.', fix: 'Press Refresh.' },
          { message: 'Send failed', meaning: 'The message didn’t go out and the server didn’t say why. Your text is kept in the box.', fix: 'Press Send again. If it keeps failing, email support with the number and time.' },
        ],
      },
      {
        id: 'failed',
        title: 'Why a text failed',
        summary: 'A red “Failed” label under a text means it wasn’t delivered. Click it to see the reason.',
        keywords: ['failed', 'not delivered', 'undelivered', 'red', 'landline', 'spam', 'opted out', 'stop', 'carrier'],
        issues: [
          { message: 'Can’t receive texts', meaning: 'The number is a landline, or isn’t in service.', fix: 'Call instead, or ask for a mobile number. Check the line-type label in the header first next time.' },
          { message: 'They opted out (STOP)', meaning: 'This person texted STOP. Carriers block texts from your number to them until they text START.', fix: 'Don’t keep texting. Call them instead.' },
          { message: 'Blocked as possible spam', meaning: 'Their carrier temporarily filtered the text as possible spam.', fix: 'Wait a while before texting again, or call. Avoid sending the same text to many people at once.' },
          { message: 'Blocked as spam', meaning: 'Their carrier filtered the text as spam.', fix: 'Call instead, and tell your admin if it keeps happening.' },
          { message: 'Message content rejected', meaning: 'The carrier refused the wording or a link in the message.', fix: 'Remove any link and send again.' },
          { message: 'Not a valid phone number', meaning: 'The carrier says the number can’t be texted.', fix: 'Check the digits and the country code.' },
          { message: 'Phone off or out of coverage', meaning: 'Their phone didn’t accept the text in time.', fix: 'Try again later.' },
          { message: 'Rejected by their carrier / Couldn’t be delivered / Their carrier was unavailable', meaning: 'Their carrier didn’t deliver it, often temporarily.', fix: 'Try again in a few minutes, or call.' },
          { message: 'Too many texts too fast', meaning: 'The carrier slowed down texts from your number.', fix: 'Wait a few minutes before sending more.' },
          { message: 'Our number isn’t registered for texting / Our number can’t send texts', meaning: 'A problem with your sending number, not with the person you’re texting.', fix: 'Contact your admin.' },
          { message: 'Carrier didn’t deliver', meaning: 'The text was accepted but their carrier didn’t deliver it, and no reason was given.', fix: 'Check the number, then try again or call.' },
        ],
      },
      {
        id: 'segments',
        title: 'The character counter (“2 SMS · UCS-2”)',
        summary: 'The counter under the box shows how many billed text messages your message will be split into.',
        keywords: ['segments', 'ucs-2', 'gsm', 'characters', 'emoji', 'curly quotes', 'counter', 'cost'],
        steps: [
          'One text holds 160 plain characters. Longer messages are split into parts of 153.',
          'One emoji, curly quote (’ “ ”) or long dash (—) switches the whole message to “UCS-2”, where a text holds only 70 characters (67 per part). That can double the number of parts.',
          'Characters like [ ] { } ~ | € count as two.',
          'The person still gets it as one message. The count only affects cost.',
        ],
        issues: [],
      },
      {
        id: 'pictures',
        title: 'Sending pictures (MMS)',
        summary: 'Press MMS to attach an image, or paste one into the box. You can send a picture without any text.',
        keywords: ['mms', 'picture', 'photo', 'image', 'attachment', 'upload'],
        issues: [
          { message: 'file too large (max 10 MB)', meaning: 'The image is bigger than 10 MB. Many phones can’t receive more than about 5 MB anyway.', fix: 'Send a smaller image or a screenshot.' },
          { message: 'upload failed', meaning: 'The image didn’t upload.', fix: 'Try again. If it keeps failing, tell your admin.' },
        ],
      },
      {
        id: 'templates',
        title: 'Templates and fields like {firstName}',
        summary: 'Templates are saved messages. Fields in braces fill themselves in from the contact. Company templates come from your admin; your own are private.',
        keywords: ['template', 'placeholder', 'field', 'firstname', 'canned', 'saved message', 'braces'],
        steps: [
          'Open Templates in the message box, or manage your own in Settings → My SMS templates.',
          'Picking a template replaces whatever is in the box.',
          '{firstName}, {lastName}, {jobTitle} and {companyName} fill in from the contact; {recruiterName} is your first name.',
          'Fields like {role}, {rate} or {client} are left as typed so you can type over them. Check none are left before sending.',
        ],
        issues: [
          { message: '{<name>} isn\'t a supported field — did you mean {<suggestion>}?', meaning: 'A field name is misspelled.', fix: 'Use the suggested name, or pick it from “Insert field”.' },
          { message: 'Opening brace is never closed / Closing brace with no matching opening brace: }', meaning: 'A { or } is missing.', fix: 'Make sure each field looks like {firstName}.' },
          { message: 'Field names cannot contain spaces: {<name>}', meaning: 'Field names are one word.', fix: 'For example {firstName}, not {first name}.' },
          { message: 'Braces cannot be nested / Empty field name: {}', meaning: 'The braces are malformed.' },
          { message: 'You\'ve reached the limit of 100 personal templates. Delete one to add another.', meaning: 'You can keep up to 100 of your own templates.' },
        ],
      },
      {
        id: 'dictation',
        title: 'Record (voice to text)',
        summary: 'Press Record, speak your message, then Stop. Your words are typed into the box for you to check. The audio is never saved or sent.',
        keywords: ['record', 'voice', 'dictate', 'speech', 'transcribe', 'microphone'],
        issues: [
          { message: 'Can\'t record while a call is in progress', meaning: 'Your call is using the microphone.', fix: 'Record after the call ends.' },
          { message: 'Microphone permission was denied. Check your browser or system settings.', meaning: 'The dialer isn’t allowed to use the microphone.', fix: 'Allow microphone access, then try again.' },
          { message: 'No microphone was found.', meaning: 'No microphone is connected.', fix: 'Plug in your headset.' },
          { message: 'Couldn\'t hear any speech. Try recording again.', meaning: 'The recording was silent or too quiet.', fix: 'Check the right microphone is selected in Settings → Microphone.' },
          { message: 'Too many recordings in a short time. Try again in a few minutes.', meaning: 'There’s a limit of 40 recordings every 15 minutes.' },
          { message: 'Transcription service is unavailable. Try again in a moment. / Transcription failed. Try again.', meaning: 'The speech service didn’t respond.', fix: 'Try again, or type the message.' },
          { message: 'Voice transcription is not configured on this server.', meaning: 'This feature isn’t switched on.', fix: 'Tell your admin.' },
        ],
      },
      {
        id: 'rewrite',
        title: 'Rewrite (fix grammar)',
        summary: 'Rewrite suggests a cleaner version of your message. You compare it with your original and choose; nothing is sent until you press Send.',
        keywords: ['ai', 'rewrite', 'grammar', 'spelling', 'improve', 'verify'],
        steps: [
          'Write at least 15 characters first.',
          'The “Verify” chips list links, rates and dates. Check they’re still right.',
          'You can regenerate twice. After that, edit the suggestion yourself.',
        ],
        issues: [
          { message: 'Couldn\'t rewrite this safely without changing details — your original message was kept.', meaning: 'The suggestion changed a number, link or field, so it was thrown away to protect your message.', fix: 'Send your original, or reword it yourself.' },
          { message: 'No changes suggested — your message already reads well.', meaning: 'Nothing needed fixing.' },
          { message: 'Check these words survived the rewrite: <words>', meaning: 'Some names or proper nouns from your original are missing from the suggestion.', fix: 'Read it carefully before using it.' },
          { message: 'Rewrite timed out. The model may be starting up — try again.', meaning: 'The rewrite service was slow to respond.', fix: 'Try again in a few seconds.' },
          { message: 'Too many rewrites in a short time. Try again in a few minutes.', meaning: 'There’s a limit of 40 rewrites every 15 minutes.' },
          { message: 'AI rewrite is not configured on this server.', meaning: 'This feature isn’t switched on.', fix: 'Tell your admin.' },
        ],
      },
      {
        id: 'scheduled',
        title: 'Scheduled texts',
        summary: 'The clock next to Send schedules the message for later. Scheduled texts show above the conversation, where you can edit or cancel them.',
        keywords: ['schedule', 'later', 'send later', 'tomorrow', 'timer'],
        steps: [
          'It sends within about 30 seconds of the time you pick, from the line that was active when you scheduled it.',
          'If it can’t be delivered, the dialer retries. If it still fails, ACE Bot sends you a Teams message saying it wasn’t sent.',
          'To change attachments, cancel it and schedule again.',
        ],
        issues: [
          { message: 'scheduledFor is in the past', meaning: 'The time you picked has already passed.', fix: 'Pick a later time.' },
          { message: 'Pick a valid date and time', meaning: 'The date or time box is empty or incomplete.' },
          { message: 'Already sent — cannot cancel.', meaning: 'It went out before you cancelled.' },
          { message: 'A scheduled message was not sent', meaning: 'A Teams message from ACE Bot telling you a scheduled text gave up. It includes the reason.', fix: 'Open the conversation and send it yourself if it still applies, or call instead.' },
        ],
      },
      {
        id: 'bulk',
        title: 'Texting several favorites at once',
        summary: 'Favorites → the send icon texts up to 200 favorites, each getting their own copy. You review every message before it goes.',
        keywords: ['bulk', 'mass text', 'several', 'group text', 'campaign', 'send to many'],
        steps: [
          'Each contact gets one text, on their primary number.',
          'Texts go out about one per second. You can close the window; it keeps sending.',
        ],
        issues: [
          { message: 'Too many — 200 max', meaning: 'One send can go to at most 200 people.' },
          { message: '<n> message(s) still contain a placeholder we couldn\'t fill. Remove it from the text or deselect those contacts — it would be sent literally.', meaning: 'Some contacts are missing a name or detail the message needs.', fix: 'Remove the field, or untick those contacts.' },
          { message: 'You have this number blocked.', meaning: 'That contact is on your block list, so they were skipped.' },
          { message: 'Already in this send — the same number appears more than once.', meaning: 'Duplicate numbers are only texted once.' },
        ],
      },
      {
        id: 'quick-replies',
        title: 'Quick replies and replying to a declined call',
        summary: 'Quick replies are one-tap messages saved on this computer. They also appear when you choose Reply with Text on an incoming call.',
        keywords: ['quick reply', 'canned', 'decline', 'busy', 'reply with text'],
        steps: [
          'Edit them in Settings → Quick replies.',
          'They are stored on this computer only, so they won’t appear on another device.',
        ],
        issues: [
          { message: 'Message sent', meaning: 'Your reply after declining the call went out from your number.' },
        ],
      },
    ],
  },

  // -------------------------------------------------------------------------
  {
    key: 'voicemail',
    label: 'Voicemail',
    topics: [
      {
        id: 'inbox',
        title: 'Listening to voicemail',
        summary: 'The Voicemail tab lists messages left on your numbers, with a written transcript when one is available.',
        keywords: ['voicemail', 'listen', 'transcript', 'play', 'speed', 'delete', 'saved', 'pin'],
        steps: [
          'Playing a voicemail marks it as heard. The badge counts all unheard voicemails.',
          'Use the speed chip to play at 1.5×, 2× or 0.5×.',
          'Voicemails are deleted automatically after 30 days. Pinning (Saved) makes one easy to find but does not keep it longer.',
        ],
        issues: [
          { message: 'Transcribing…', meaning: 'The written transcript isn’t ready yet. It usually arrives within a minute or two.', fix: 'Play the audio. Some short or unclear messages never get a transcript.' },
          { message: 'Transcription not available for this voicemail.', meaning: 'No transcript could be made, usually because the message was very short or silent.' },
          { message: 'Deletes in <n>d / Auto-deletes tomorrow', meaning: 'This voicemail will be removed soon (30 days after it arrived).', fix: 'If you need to keep the details, write them down or save them in the candidate record.' },
          { message: 'Voicemail not found or not yours.', meaning: 'It was deleted, expired after 30 days, or was left for someone else.' },
          { message: 'Audio unavailable', meaning: 'The recording couldn’t be loaded.', fix: 'Close it and open it again. Recording links expire after a few minutes and are refreshed when you reopen.' },
        ],
      },
      {
        id: 'greeting',
        title: 'Your voicemail greeting',
        summary: 'Settings → Voicemail greeting sets what callers hear: a standard greeting with your first name, typed text read aloud, or your own recording.',
        keywords: ['greeting', 'outgoing message', 'record greeting', 'busy greeting', 'robotic voice'],
        steps: [
          '“When you don’t pick up” plays after about 25 seconds of ringing. “When you’re on another call” plays when you’re busy; leave it blank to use the first one for both.',
          'To test it, call your number from your mobile and don’t answer.',
        ],
        issues: [
          { message: 'File too large (<x> MB). Max 2 MB. / Recording too large (<x> MB). Max 2 MB.', meaning: 'Greetings can be at most 2 MB.', fix: 'Record a shorter greeting, or upload an MP3.' },
          { message: 'Unsupported audio type: <type>. Use MP3, WAV, M4A, AAC, OGG, or WebM.', meaning: 'That file format can’t be used.', fix: 'Convert it to MP3.' },
          { message: 'Greeting recording could not be processed. Try uploading an MP3 file instead.', meaning: 'Your recording couldn’t be converted.', fix: 'Record it on your phone and upload it as an MP3.' },
          { message: 'Text is too long (<n> characters). Maximum is 500.', meaning: 'Typed greetings can be at most 500 characters.' },
          { message: 'Callers hear a robotic default message instead of my greeting', meaning: 'Your number hasn’t been switched to the dialer’s voicemail yet.', fix: 'Ask your admin to migrate your number.' },
        ],
      },
    ],
  },

  // -------------------------------------------------------------------------
  {
    key: 'contacts',
    label: 'Recents, favorites & blocking',
    topics: [
      {
        id: 'recents',
        title: 'What the labels in Recents mean',
        summary: 'Each call in Recents shows what happened. Times are Eastern. The badge on the tab counts missed calls since you last opened it.',
        keywords: ['recents', 'history', 'call log', 'missed', 'declined', 'caller canceled', 'forwarded', 'busy'],
        issues: [
          { message: 'Missed', meaning: 'It rang until it timed out and nobody answered.' },
          { message: 'Caller canceled', meaning: 'They hung up while it was still ringing.' },
          { message: 'Declined', meaning: 'You declined the call.' },
          { message: 'Busy', meaning: 'You were already on a call, or the dialer wasn’t connected, so the caller got a busy signal or your busy greeting.' },
          { message: 'Blocked', meaning: 'The number is on your block list. It never rang and couldn’t leave a voicemail.' },
          { message: 'Forwarded', meaning: 'Call forwarding sent it to your other number.' },
          { message: 'Failed', meaning: 'An incoming call that couldn’t connect for a technical reason.' },
          { message: 'Inbound / Outgoing', meaning: 'A call you answered, or a call you made. Outgoing is shown whether or not they picked up.' },
          { message: 'A call is missing from Recents', meaning: 'Calls made while the dialer couldn’t reach the server may not be logged.', fix: 'Email support with the number and time.' },
        ],
      },
      {
        id: 'names',
        title: 'Where caller names come from',
        summary: 'The dialer shows your Favorites name first, then the candidate’s name from JobDiva, then the number.',
        keywords: ['name', 'caller id', 'jobdiva', 'contact name', 'wrong name', 'no name'],
        issues: [
          { message: 'A number shows instead of a name', meaning: 'It isn’t in your Favorites and JobDiva has no candidate with that number. A contact just added in JobDiva can take up to 5 minutes to show.', fix: 'Add it to Favorites to give it a name.' },
        ],
      },
      {
        id: 'favorites',
        title: 'Favorites',
        summary: 'Star a contact from Recents, a conversation, or the + on the Favorites tab. A favorite can hold several numbers (Cell, Home, Work).',
        keywords: ['favorite', 'star', 'contact', 'rename', 'add number'],
        steps: [
          'Favorites are saved to your account. Changes made on another computer appear after you sign in again.',
          'To rename a favorite, remove it and add it again with the new name.',
        ],
        issues: [
          { message: '<number> is already on this favorite.', meaning: 'That number is already saved on this contact.' },
          { message: 'Cannot remove the only number on a favorite. Delete the favorite instead.', meaning: 'A favorite needs at least one number.' },
        ],
      },
      {
        id: 'blocking',
        title: 'Blocking a number',
        summary: 'Blocked callers hear a busy signal and can’t leave a voicemail. Their texts are dropped without telling you or them. Blocking works even when the dialer is closed.',
        keywords: ['block', 'unblock', 'spam', 'harassment', 'stop calls'],
        steps: [
          'Block from Recents (the ⋯ menu), the conversation header in Messages, or Settings → Blocked numbers.',
          'Add a reason. Your admin can see every block and may undo one made by mistake.',
          'Unblock in Settings → Blocked numbers.',
        ],
        issues: [
          { message: 'Enter at least 10 digits (or E.164 like +14155551234).', meaning: 'The number is too short.' },
          { message: 'Could not block: <reason>', meaning: 'The block wasn’t saved.', fix: 'Try again from Settings → Blocked numbers.' },
        ],
      },
      {
        id: 'forwarding',
        title: 'Call forwarding',
        summary: 'Settings → Call forwarding sends calls to another number, either only when you don’t answer (voicemail still works) or always.',
        keywords: ['forward', 'cell phone', 'away', 'redirect'],
        steps: [
          '“Always” means the dialer never rings. Turn it off when you’re back.',
          'Forwarding covers your main number only.',
        ],
        issues: [
          { message: 'Saved. Telnyx is now configured.', meaning: 'Your forwarding setting is active.' },
          { message: 'Enter a valid phone number (10+ digits or E.164).', meaning: 'The forward-to number is incomplete.' },
          { message: 'Your account has no DID assigned yet. Add a phone number first.', meaning: 'You don’t have a phone number to forward from.', fix: 'Ask your admin to assign one.' },
          { message: 'Telnyx rejected the call-forwarding update', meaning: 'The phone carrier refused the change.', fix: 'Check the number and try again. If it persists, contact your admin.' },
        ],
      },
      {
        id: 'chat',
        title: 'Team chat',
        summary: 'Message other ACE users from the Messages tab. These are internal and never sent as texts.',
        keywords: ['chat', 'internal', 'teammate', 'coworker', 'online', 'away'],
        steps: [
          '“Online”, “Away” and “On call” are based on recent calls and texts, so a quiet teammate can show “Offline” while signed in.',
        ],
        issues: [
          { message: 'Failed to load conversation (<status>)', meaning: 'The chat didn’t load.', fix: 'Reopen it, or sign out and back in.' },
          { message: 'Failed to send (<status>)', meaning: 'The message didn’t go out. Your text is kept in the box.', fix: 'Press Send again.' },
        ],
      },
    ],
  },

  // -------------------------------------------------------------------------
  {
    key: 'alerts',
    label: 'Notifications & settings',
    topics: [
      {
        id: 'sounds',
        title: 'Ringtone, sounds and popups',
        summary: 'Settings → Sound & alerts and Settings → Ringtone control how incoming calls and texts get your attention.',
        keywords: ['ringtone', 'volume', 'silent', 'popup', 'notification', 'toast', 'no sound'],
        steps: [
          '“Silence ringer during a call” keeps a second call on screen without ringing in your ear.',
          'Desktop popups only appear while the dialer window is hidden or minimised.',
          'These settings are saved on this computer only. Your ringtone choice follows your account.',
        ],
        issues: [
          { message: 'I don’t get desktop popups', meaning: 'Notifications were blocked the first time the browser or computer asked.', fix: 'Allow notifications for the dialer in your browser’s site settings or your computer’s notification settings.' },
          { message: 'Saved locally but couldn\'t sync to server: <reason>', meaning: 'Your ringtone was changed on this computer but not saved to your account.', fix: 'Pick it again later.' },
        ],
      },
      {
        id: 'teams-email',
        title: 'Teams and email alerts',
        summary: 'Settings → Notifications sends a Teams message or an email when you miss a call, get a text or get a voicemail. Teams is on by default; email is off.',
        keywords: ['teams', 'email', 'card', 'acebot', 'missed call alert', 'notification'],
        steps: [
          'Use “Send test card” or “Send test email” to check it works.',
          'A voicemail alert replaces the missed-call alert for the same call.',
          'Email sends one message per text, with no batching.',
        ],
        issues: [
          { message: 'Teams notifications aren\'t connected yet. Ask your admin to connect the ACE Bot in Settings → Teams connection.', meaning: 'Teams alerts aren’t set up for the company yet.', fix: 'Tell your admin.' },
          { message: 'Your account could not be found in Microsoft Teams. Make sure you have a Teams license.', meaning: 'Teams doesn’t recognise your account.', fix: 'Ask IT to check your Teams license.' },
          { message: 'Email notifications aren\'t enabled in your organization yet.', meaning: 'Email alerts aren’t set up for the company yet.', fix: 'Tell your admin.' },
          { message: 'Test email sent. Check your inbox', meaning: 'If it isn’t in your inbox within a minute, check spam and add the sender to your contacts.' },
        ],
      },
      {
        id: 'diagnostics',
        title: 'Sending logs to support',
        summary: 'Settings → Diagnostics downloads a log file of what the dialer did, which helps support find the problem.',
        keywords: ['logs', 'diagnostics', 'support', 'bug', 'report a problem'],
        steps: [
          'Make the problem happen first, then download. The log starts fresh every time the app restarts.',
          'Nothing is sent anywhere until you attach the file to an email yourself.',
          'Email it to support@aptask.com with the time and the number involved.',
        ],
        issues: [],
      },
    ],
  },

  // -------------------------------------------------------------------------
  {
    key: 'desktop',
    label: 'Desktop app & updates',
    topics: [
      {
        id: 'tray',
        title: 'Closing the window keeps the dialer running',
        summary: 'Closing the window hides the dialer in the system tray (menu bar on Mac) so calls still ring. Right-click the tray icon to quit.',
        keywords: ['tray', 'close', 'quit', 'background', 'still running', 'menu bar'],
        issues: [
          { message: 'ACE Dialer is still running', meaning: 'You closed the window but the dialer is still on, so you can take calls.', fix: 'To stop it, right-click the tray icon and choose “Quit (end any active call)”. While it’s quit, calls go to voicemail.' },
        ],
      },
      {
        id: 'updates',
        title: 'Updates',
        summary: 'The desktop app downloads updates by itself and shows a banner when one is ready. Check now from your name menu → Check for updates.',
        keywords: ['update', 'upgrade', 'new version', 'restart', 'install', 'version'],
        issues: [
          { message: 'Update ready', meaning: 'A new version is downloaded.', fix: 'Press “Restart to install” between calls. It also installs the next time you quit.' },
          { message: 'Required update', meaning: 'Your admin requires everyone to update. It installs and restarts by itself, waiting until your call ends.' },
          { message: 'Update failed', meaning: 'The automatic update didn’t install.', fix: 'Press Retry, or “Download installer” and run it.' },
          { message: 'No internet connection. Check your network and try again.', meaning: 'The update check couldn’t get online.' },
          { message: 'Could not reach the update server. Please try again later. / Update server unreachable.', meaning: 'The update server didn’t answer.', fix: 'Try again later. Your current version keeps working.' },
          { message: 'Update available — Refresh now', meaning: 'In the web version, a newer dialer is available.', fix: 'Press “Refresh now” between calls.' },
        ],
      },
    ],
  },

  // -------------------------------------------------------------------------
  {
    key: 'reports',
    label: 'Reports',
    topics: [
      {
        id: 'reports-basics',
        title: 'Using Reports',
        summary: 'Reports (from your name menu) shows your calls, texts, missed calls and follow-ups. Admins see the whole team; everyone else sees their own.',
        keywords: ['reports', 'stats', 'dashboard', 'follow-ups', 'activity', 'export', 'csv'],
        steps: [
          'Click any number to see the calls or texts behind it.',
          'Follow-ups lists missed calls, texts and voicemails from the last 14 days that you haven’t replied to.',
          'All times are Eastern. A custom range can be up to 92 days.',
          'The address bar holds the whole view, so you can share a link to exactly what you’re looking at.',
        ],
        issues: [
          { message: 'The report didn\'t load', meaning: 'The server couldn’t build the report. The reason is shown underneath.', fix: 'Press “Try again”. Very long ranges take a few seconds.' },
          { message: 'You can only view your own report.', meaning: 'Only admins can see other people’s reports.' },
          { message: 'Pick 92 days or fewer.', meaning: 'Reports cover at most 92 days at a time.' },
          { message: 'This tab hit an error', meaning: 'One tab failed to show. Other tabs still work.', fix: 'Reload the page. If it persists, email support with the link.' },
        ],
      },
      {
        id: 'end-reasons',
        title: 'Why a call ended (end reasons)',
        summary: 'Each call in Reports shows one plain reason it ended. “after 25s” is how long it rang; “(SIP 486)” is the carrier’s code.',
        keywords: ['end reason', 'why ended', 'hung up', 'dropped', 'no audio', 'not in service'],
        issues: [
          { message: 'Connected, but the other side sent no audio', meaning: 'The call connected but no sound came from their side. The problem is on their end.' },
          { message: 'Connected, but their audio never reached you', meaning: 'Their sound reached the carrier but not your computer. Usually a network or firewall issue on your side.', fix: 'Email support with the time and number.' },
          { message: 'Call dropped by the network', meaning: 'A connected call was cut off by a network fault, not by anyone hanging up.' },
          { message: 'You hung up / They hung up / Call ended', meaning: 'Who ended a connected call. “Call ended” means it wasn’t recorded.' },
          { message: 'You hung up before they answered', meaning: 'You stopped the call while it was ringing.' },
          { message: 'No answer / Nobody answered', meaning: 'It rang until it timed out.' },
          { message: 'Number not in service or not found', meaning: 'The number doesn’t exist or is disconnected.', fix: 'Update the candidate record.' },
          { message: 'Declined or blocked by the other side / Busy', meaning: 'They rejected the call, or their line was busy.' },
          { message: 'Caller hung up while it rang', meaning: 'An incoming caller gave up before you answered.' },
          { message: 'You declined (or were busy)', meaning: 'You pressed Decline, or you were already on another call.' },
          { message: 'Blocked number', meaning: 'The caller is on your block list. It isn’t counted against your answer rate.' },
          { message: 'Couldn\'t connect / Didn\'t connect', meaning: 'A technical failure. The carrier’s code is shown when there is one.' },
        ],
      },
      {
        id: 'reports-terms',
        title: 'What the measures mean',
        summary: 'Definitions for the numbers on the Reports page.',
        keywords: ['answer rate', 'likely drop', 'short call', 'talk time', 'reply rate', 'new contacts', 'definition'],
        issues: [
          { message: 'Talk time', meaning: 'From when the call was answered to when it ended. Ringing isn’t counted.' },
          { message: 'Answer rate', meaning: 'Incoming calls you answered, out of all incoming calls except blocked ones.' },
          { message: 'Returned within 24h', meaning: 'A missed call you called back within 24 hours.' },
          { message: 'Likely drop', meaning: 'An estimate: you called the same number again within 2 minutes of a connected call of 10 seconds or more.' },
          { message: 'Confirmed drop', meaning: 'A connected call ended by a network fault.' },
          { message: 'Calls of 6 seconds or less', meaning: 'Very short answered calls. If they pass 15% of answered calls in a month, the carrier charges extra.' },
          { message: 'Reply rate', meaning: 'Incoming texts you answered within 24 hours. Several texts in a row count once.' },
          { message: 'New contacts', meaning: 'People you reached this period that you hadn’t contacted in the previous period of the same length.' },
          { message: 'Blank quality figures', meaning: 'Not measured, not “good”. Quality is only measured on calls made on desktop version 0.10.232 or later.' },
        ],
      },
    ],
  },
];
