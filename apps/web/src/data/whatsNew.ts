// v0.10.26 — User-facing release notes shown in Settings → What's new.
// Plain English, no jargon. Add new versions at the TOP so newest is first.
//
// Categories:
//   'new'      — brand-new capability / feature
//   'improved' — better, faster, prettier, easier version of an existing thing
//   'fixed'    — bug fix
//
// Keep entries short (~1 sentence). If you need detail, put it in a (parenthetical).

export type ChangeType = 'new' | 'improved' | 'fixed';

export interface ChangeEntry {
  type: ChangeType;
  text: string;
}

export interface ReleaseEntry {
  version: string;
  date: string;          // human-readable e.g. "June 1, 2026"
  highlight?: string;    // optional one-line summary shown bold under the date
  changes: ChangeEntry[];
}

export const WHATS_NEW: ReleaseEntry[] = [
  {
    version: '0.10.206',
    date: 'June 25, 2026',
    highlight: 'Backend infrastructure fix for the new self-hosted environment.',
    changes: [
      { type: 'fixed', text: 'Inbound voicemail flow on the new self-hosted webhooks endpoint (dialer.aptask.com/webhooks) was returning 404 because the reverse proxy did not strip the /webhooks path prefix. Server now strips it internally based on the public URL configured for the environment. Users would have seen "an application error has occurred" when calling certain numbers.' },
    ],
  },
  {
    version: '0.10.205',
    date: 'June 25, 2026',
    highlight: 'Admin "Force update" — push the latest dialer version to every user (or any chosen subset) with one click.',
    changes: [
      { type: 'new', text: 'Admin > Settings > Force update lists every active user with their latest version and device, and lets an admin push the latest dialer version to ALL users at once or to a selected subset.' },
      { type: 'new', text: 'Targeted clients show a full-screen blocking dialog that downloads and installs the update. Users on an active call see a slim banner instead and install runs automatically after the call ends — no calls are interrupted.' },
      { type: 'improved', text: 'The existing per-device "Force update" button under each user remains for the one-off case.' },
    ],
  },
  {
    version: '0.10.204',
    date: 'June 25, 2026',
    highlight: 'Maintenance build — same code as v0.10.203, fresh installer.',
    changes: [
      { type: 'improved', text: 'Re-packaged installer for v0.10.203. No feature or behavior changes — install only if you were having trouble with the previous installer.' },
    ],
  },
  {
    version: '0.10.203',
    date: 'June 24, 2026',
    highlight: 'Fixed: silent inbound calls — root-cause level fix.',
    changes: [
      { type: 'fixed', text: 'Some incoming calls would connect but produce no audio, especially when accepted from the floating ringer window or after the phone had been ringing for several seconds. The dialer was inheriting a web-browser autoplay restriction that blocks audio playback without a recent click in the same window. That restriction has been disabled for the desktop app — audio now plays reliably the moment the call is accepted, regardless of which window had focus.' },
    ],
  },
  {
    version: '0.10.202',
    date: 'June 24, 2026',
    highlight: 'Fixed: occasional silent inbound calls (no audio after Accept).',
    changes: [
      { type: 'fixed', text: 'On rare inbound calls, the internal WebRTC peer-connection setup did not complete in time, causing the call to ring through but produce no audio after Accept. The wiring path now has three independent safety nets and an extended setup window, so the track is reliably attached before the call goes live.' },
    ],
  },
  {
    version: '0.10.201',
    date: 'June 19, 2026',
    highlight: 'Reactions: always sent to recipient and picker opens below the bubble.',
    changes: [
      { type: 'fixed', text: 'The reaction picker now opens BELOW the bubble instead of above. The previous behavior was clipping the top row (including the heart) behind the thread header when reacting to messages near the top of the scroll area.' },
      { type: 'improved', text: 'The Send-to-recipient-as-text toggle has been removed. Every reaction now sends to the recipient automatically. No checkbox, no extra step.' },
      { type: 'fixed', text: 'Internal: v0.10.200 was published with the v0.10.201 logic missing due to an apply-script syntax error. The v0.10.200 installer therefore showed v0.10.199 in Diagnostics. v0.10.201 is the corrected release.' },
    ],
  },
  {
    version: '0.10.199',
    date: 'June 19, 2026',
    highlight: 'Reactions picker: fits on screen, remembers your "send to recipient" choice.',
    changes: [
      { type: 'fixed', text: 'The reaction picker was extending off the left edge of the viewport on small inbound bubbles, clipping most of the 5×5 grid AND the "Send to recipient as text" toggle. Picker now opens RIGHTWARD from the bubble so the full grid + toggle are always visible.' },
      { type: 'fixed', text: 'The "Send to recipient as text" checkbox used to reset to off every time the picker opened — so a user who checked it for one reaction would silently revert to local-only for the next. Your choice now persists across picker opens and page reloads.' },
      { type: 'fixed', text: 'If the recipient-text SMS fails to send (carrier rejection, invalid number, etc.), the error now surfaces in the thread banner instead of failing silently in the console.' },
    ],
  },
  {
    version: '0.10.198',
    date: 'June 19, 2026',
    highlight: 'Reactions: ❤️ added (the most-used reaction).',
    changes: [
      { type: 'improved', text: 'The reaction picker now includes ❤️ as the first emoji — the most-used reaction in any messaging app. Total reactions: 25, rendered as a balanced 5×5 grid.' },
    ],
  },
  {
    version: '0.10.197',
    date: 'June 19, 2026',
    highlight: 'Reactions: fixed inbound bubbles + 24 emojis instead of 6.',
    changes: [
      { type: 'fixed', text: 'On inbound message bubbles, the hover-reveal reaction button was rendering off-screen due to a missing position-relative anchor. Now appears correctly at the bubble corner.' },
      { type: 'improved', text: 'Reaction picker now shows all 24 emojis in a 4×6 grid (same set as the composer picker), not just 6.' },
    ],
  },
  {
    version: '0.10.196',
    date: 'June 19, 2026',
    highlight: 'Reactions now show only on messages you received.',
    changes: [
      { type: 'improved', text: 'The hover-reveal reaction button now appears only on inbound message bubbles (ones you received). Your own outbound messages render as before, without the reaction affordance.' },
    ],
  },
  {
    version: '0.10.195',
    date: 'June 19, 2026',
    highlight: 'React to messages with one tap.',
    changes: [
      { type: 'new', text: 'Hover any message bubble to reveal a smile-face icon. Click it for a quick set of reactions (heart, thumbs-up, thumbs-down, laugh, exclamation, question). Reactions appear as small chips below the bubble — click your own chip to remove it.' },
      { type: 'new', text: 'Optional "Send to recipient as text" toggle inside the picker sends an iPhone-tapback-style SMS like ❤️ to: "<message preview>" so the other party knows you reacted. Off by default — reactions are local to your dialer unless you opt in.' },
    ],
  },
  {
    version: '0.10.194',
    date: 'June 19, 2026',
    highlight: 'Call duration timer no longer ticks during ringback.',
    changes: [
      { type: 'fixed', text: 'The outbound call duration timer used to start the moment the other carrier sent any audio (often ringback while still ringing), inflating Recents durations. Timer now waits for the call to actually be answered (human pickup), or for the audio to have been flowing for 5+ seconds (voicemail greeting). Brief carrier ringback before answer no longer counts.' },
    ],
  },
  {
    version: '0.10.193',
    date: 'June 19, 2026',
    highlight: 'Fixed: first inbound call sometimes had no audio.',
    changes: [
      { type: 'fixed', text: 'On the first inbound call after the dialer has been idle, some users heard no audio from the caller (calling back worked). Cause was Chromium\'s autoplay policy blocking audio playback before the user clicked Accept. The Accept button now re-issues the play() inside the click handler so the user gesture unblocks audio reliably. Also extended internal retry budget from 1 to 4 attempts with backoff for late track arrivals.' },
    ],
  },
  {
    version: '0.10.192',
    date: 'June 18, 2026',
    highlight: 'Internal: TypeScript fixup for v0.10.191.',
    changes: [
      { type: 'fixed', text: 'Internal: v0.10.191 had a TypeScript type mismatch on the failed-message expand state (Set<string> vs Set<number>). Functional behavior was unaffected; this release just gets the strict typecheck clean.' },
    ],
  },
  {
    version: '0.10.191',
    date: 'June 18, 2026',
    highlight: 'Delivery status ticks on every outbound message.',
    changes: [
      { type: 'new', text: 'Every outbound SMS/MMS now shows a small status tick in the bottom-right corner of its bubble — a clock while sending, a single check once sent, and a brighter double-check when the carrier confirms delivery.' },
      { type: 'improved', text: 'Failed messages now show a compact red "Failed" pill instead of the always-visible inline error. Click the pill to expand the Telnyx error code and description.' },
    ],
  },
  {
    version: '0.10.190',
    date: 'June 18, 2026',
    highlight: 'Ctrl+Enter now inserts a newline in the message composer.',
    changes: [
      { type: 'improved', text: 'In the Messages thread composer, Ctrl+Enter (or Cmd+Enter on Mac) now inserts a newline. Enter still sends and Shift+Enter still works for newlines, so existing muscle memory is unchanged — this just adds Ctrl+Enter as an extra newline shortcut.' },
    ],
  },
  {
    version: '0.10.189',
    date: 'June 18, 2026',
    highlight: 'Composer: removed the legacy white background between input/clock/send.',
    changes: [
      { type: 'fixed', text: 'A pre-existing legacy CSS rule was setting a white background on the top composer row (between the text input, schedule clock, and Send pill). That rule is now overridden — the gray card panel shows through cleanly between every control.' },
    ],
  },
  {
    version: '0.10.188',
    date: 'June 18, 2026',
    highlight: 'Composer: card layout with all-gray controls inside.',
    changes: [
      { type: 'fixed', text: 'Inner controls of the composer card (text input, schedule clock, action pills) are now gray, not white. Card panel + all controls share the gray family; only the Send pill remains indigo. No white surfaces anywhere in the composer.' },
    ],
  },
  {
    version: '0.10.187',
    date: 'June 18, 2026',
    highlight: 'Message composer is now a clean card-row with rounded corners.',
    changes: [
      { type: 'improved', text: 'Message composer redesigned as a discrete rounded card sitting at the bottom of the thread. Soft gray panel with the text input, schedule clock, action pills (MMS / Quick reply / Emoji / Templates) as white pills inside. The indigo Send pill stays as the only accent color.' },
    ],
  },
  {
    version: '0.10.186',
    date: 'June 18, 2026',
    highlight: 'Composer: forced gray surface everywhere — no more white in light mode.',
    changes: [
      { type: 'fixed', text: 'Composer area, text input, schedule clock, and all action pills now render as a coherent light-gray surface in light mode. No white anywhere except the indigo Send button accent.' },
    ],
  },
  {
    version: '0.10.185',
    date: 'June 18, 2026',
    highlight: 'Composer: no white anywhere — one coherent gray treatment.',
    changes: [
      { type: 'improved', text: 'Message composer no longer has any white surfaces. The outer panel is transparent (inherits the dialer\'s page background); the text input, action pills (MMS / Quick reply / Emoji / Templates), and Schedule-send clock all share a single clear gray surface. The indigo Send pill is the only accent color.' },
    ],
  },
  {
    version: '0.10.184',
    date: 'June 18, 2026',
    highlight: 'Composer: cleaner themed surface; clock matches the pill style.',
    changes: [
      { type: 'improved', text: 'The message composer footer panel now has a subtle themed background — slightly off-white in light mode, soft elevation in dark mode. No more stark white card on the page.' },
      { type: 'improved', text: 'The Schedule-send clock button matches the action pill aesthetic (rounded, themed surface) instead of the previous transparent icon button that popped oddly.' },
      { type: 'improved', text: 'Text input and action pills now use white-on-grey-panel contrast in light mode (cards on a panel) instead of grey-on-grey which blended together.' },
    ],
  },
  {
    version: '0.10.183',
    date: 'June 18, 2026',
    highlight: 'Composer fixes: proper Send pill, themed input, one popover at a time.',
    changes: [
      { type: 'fixed', text: 'Send button now renders as a proper "Send" pill with the paper-plane icon instead of getting squished into a 36px circle by a lingering global rule.' },
      { type: 'fixed', text: 'Message text input now uses the dialer\'s theme colors (light surface in light mode, dark surface in dark mode) instead of being hardcoded dark even in light mode.' },
      { type: 'fixed', text: 'Quick reply / Emoji / Templates popovers are now mutually exclusive — clicking any one of them closes the other two. No more all-three-stacked-on-screen.' },
    ],
  },
  {
    version: '0.10.182',
    date: 'June 18, 2026',
    highlight: 'Message composer redesigned into a cleaner two-row layout.',
    changes: [
      { type: 'improved', text: 'Message composer is now two rows. Top row: text box, the schedule-send clock, and a "Send" pill (with the paper-plane icon — same one-click send, just clearer label). Bottom row: labeled action pills — MMS / Quick reply / 😊 / Templates — replacing the unlabeled icon strip.' },
      { type: 'improved', text: 'No behavior changes. Schedule-send, quick replies, emoji picker, template picker, paste-to-attach, Enter-to-send, Shift+Enter for newline — all work exactly as before.' },
    ],
  },
  {
    version: '0.10.181',
    date: 'June 18, 2026',
    highlight: 'See your own call + SMS activity under Settings → Usage.',
    changes: [
      { type: 'new', text: 'Settings → Usage is no longer admin-only. Every user can now see their own calls (inbound / outbound / missed), talk time, and SMS sent/received — over the last 7, 30, or today range.' },
      { type: 'new', text: 'Per-day stacked chart visualizes when your activity peaked.' },
      { type: 'improved', text: 'Admins still see the original fleet-wide table (Top Users by Call Volume). Non-admins see a compact card grid of their own totals instead.' },
    ],
  },
  {
    version: '0.10.180',
    date: 'June 18, 2026',
    highlight: 'Dialer scales properly when you resize to half-screen.',
    changes: [
      { type: 'improved', text: 'The keypad now fills the available width on narrow windows instead of staying boxed at 420px. Snap the dialer to half your screen and the keys and Call button scale up to use the real estate.' },
      { type: 'improved', text: 'Keypad buttons sized by min(viewport-height, viewport-width) instead of just height — so at 683 × 768 (half of a 1366 × 768 monitor) the keys go from 65px to ~92px. Touch-friendly at any reasonable window size.' },
      { type: 'improved', text: 'Bottom-nav labels (Favorites / Messages / Recents / Keypad / Voicemail) are now readable at narrow widths — bumped from 0.65rem (~10px) to 0.75rem (~12px).' },
      { type: 'improved', text: 'Horizontal padding on the dialpad scales with viewport width so narrow windows do not waste 1.5rem per side.' },
    ],
  },
  {
    version: '0.10.179',
    date: 'June 18, 2026',
    highlight: 'Resize the dialer freely + Call button sits next to the keypad.',
    changes: [
      { type: 'improved', text: 'The dialer window can now be resized down to a small floater (360 × 500 px) instead of being locked at 900 × 800. Use it alongside your other apps without dedicating half your screen.' },
      { type: 'fixed', text: 'Bottom navigation (Favorites / Messages / Recents / Keypad / Voicemail) no longer disappears after exiting fullscreen or while you are dragging the window edges around.' },
      { type: 'fixed', text: 'The green Call button on the keypad now sits directly below the number keys instead of being anchored to the bottom of the window. On wide screens, no more giant gap between the keypad and the Call button.' },
    ],
  },
  {
    version: '0.10.178',
    date: 'June 18, 2026',
    highlight: 'Admin Users: sort by date added + two-letter avatars.',
    changes: [
      { type: 'new', text: 'Settings → Users sort dropdown now has a "Date added" option. Combined with the up/down arrow next to it, you can list users oldest-first or newest-first.' },
      { type: 'improved', text: 'Each user card avatar now shows first + last initials (e.g. "AS" for Abdulla Sheikh) instead of just the first letter. Single-name accounts still show a single initial; email-only accounts fall back to email[0].' },
    ],
  },
  {
    version: '0.10.177',
    date: 'June 17, 2026',
    highlight: 'Download MMS images directly + emoji picker fits properly.',
    changes: [
      { type: 'new', text: 'Inbound (and outbound) MMS images now have a small ↓ download button overlaid on the top-right corner. Click it to save the image to disk — no more opening the image in a new tab and right-clicking to save.' },
      { type: 'improved', text: 'Clicking the image itself still opens the full-size version in a new tab, same as before. Only the new ↓ button triggers the download.' },
      { type: 'fixed', text: 'Emoji picker popover no longer has 3 emojis spilling out the right side. The grid is now 8 columns × 3 rows (was a 12-column grid that overflowed the popover background).' },
    ],
  },
  {
    version: '0.10.176',
    date: 'June 17, 2026',
    highlight: 'Conversation thread: redesigned header with clickable activity counts.',
    changes: [
      { type: 'improved', text: 'Thread header redesigned — large initials avatar, contact name with inline favorite star, phone number subtitle, and small inline activity badges showing how many messages / calls / voicemails you have with this contact.' },
      { type: 'new', text: 'Clicking the calls badge jumps to your Recents tab filtered to this contact. Clicking the voicemails badge jumps to your Voicemail tab filtered to this contact. Back-bars return you to the thread.' },
      { type: 'improved', text: '"Your line" pill moved below the header — it is now a real switcher (the same DidSwitcher that lives in the app header), so you can change the outbound line from inside the thread.' },
      { type: 'improved', text: 'Message stream restyled: day-separator pills (Today / Yesterday / Mon / Jun 1) between days, the contact\'s initials avatar appears before grouped inbound bubbles, one time-of-day stamp at the bottom of each grouped run instead of per-bubble.' },
      { type: 'improved', text: 'Outbound bubbles are now solid indigo with white text; inbound bubbles are a soft gray. Send button is a round indigo circle.' },
      { type: 'fixed', text: 'No backend or schema changes — the Block / Call / favorite / quick replies / emoji / templates / schedule send / paste-to-attach / Telnyx error blurbs all work exactly as before.' },
    ],
  },
  {
    version: '0.10.175',
    date: 'June 17, 2026',
    highlight: 'Voicemail tab: redesigned as cards + new Saved (Pin) feature.',
    changes: [
      { type: 'improved', text: 'Voicemail rows are now two-line cards: avatar (initials in light indigo) + unread dot + name + timestamp on top; large indigo play button + waveform + duration + speed chip + ⋯ on the bottom.' },
      { type: 'new', text: 'Filter pills above the list: All / Unread / Saved / Auto-deleting soon. Each shows a live count.' },
      { type: 'new', text: 'Pin (Saved) — the ⋯ menu has a Pin action that tags a voicemail so you can find it later under the Saved filter. Pinning does NOT extend retention; the 30-day auto-delete still applies (the menu spells this out under the Pin action).' },
      { type: 'improved', text: 'Per-row auto-delete countdown is now a small soft pill that only appears when 7 days or less remain (amber 2-7, red ≤1). Less visual clutter on rows that are nowhere near expiry.' },
      { type: 'improved', text: 'Playback-speed selector is now a single chip next to the duration that cycles 1× → 1.5× → 2× → 0.5× → 1× on click.' },
      { type: 'improved', text: 'Bulk-select mode still works (checkboxes replace the avatar; toolbar has Mark read / Mark unread / Delete).' },
      { type: 'fixed', text: 'Locked behaviors preserved: single-click-play (B2), fresh-URL on expand for older voicemails (B1), real audio duration probe, mark-as-listened on actual play.' },
    ],
  },
  {
    version: '0.10.174',
    date: 'June 17, 2026',
    highlight: 'Recents tab: redesigned as card rows with directional-arrow avatars.',
    changes: [
      { type: 'improved', text: 'Recents is now a clean card list. Each row has a directional-arrow avatar (indigo for normal calls, red-pink for missed and caller-canceled), name + inline star if favorited, color-coded status + duration, and three action buttons (Message · ⋯ · green Call) flush right.' },
      { type: 'improved', text: 'The ⋯ menu collects Copy number, Play recording (when one exists), Add/Remove favorite, and Block. The line your call touched ("On Main") shows at the top of the menu for multi-line users.' },
      { type: 'improved', text: 'Filter pills (All / Inbound / Outgoing / Missed) restyled to indigo to match the new look.' },
      { type: 'improved', text: 'Tap-to-copy preserved — single-tap on a row still copies the number to the clipboard with a brief toast.' },
    ],
  },
  {
    version: '0.10.173',
    date: 'June 17, 2026',
    highlight: 'Admin Users: redesigned as card rows with filter pills.',
    changes: [
      { type: 'improved', text: 'Settings → Users is now a clean list of cards instead of a table. Each card shows a large avatar with a Microsoft SSO badge, name + status pill, email · phone, and version + last-seen as soft pills.' },
      { type: 'improved', text: 'New filter pills above the list — All / Active / Stale / Inactive — with live counts. Replaces the "Show N deactivated" checkbox.' },
      { type: 'improved', text: 'Sort dropdown next to the filter pills (Name / Last sign-in / Version) plus an up/down toggle. Replaces the column-header click-to-sort.' },
      { type: 'improved', text: 'Call / Message / ⋯ icons stay flush-right on every card and never need horizontal scrolling.' },
    ],
  },
  {
    version: '0.10.172',
    date: 'June 16, 2026',
    highlight: 'Admin Users table: compact rows with phone number inline.',
    changes: [
      { type: 'improved', text: 'Each user row in Settings → Users now shows the phone number directly below the name. The standalone DID column is gone, and the "Microsoft SSO" text line is replaced with a small blue [M] badge inline next to the status dot. Less vertical space, more horizontal room, no horizontal scroll at any reasonable window width.' },
      { type: 'fixed', text: 'Reverted the v0.10.171 layout change that was clipping names and emails on the right side of the User cell.' },
    ],
  },
  {
    version: '0.10.171',
    date: 'June 16, 2026',
    highlight: 'Admin Users table fits without horizontal scroll.',
    changes: [
      { type: 'fixed', text: 'Settings → Users no longer needs horizontal scroll to see the Call, Message, and ⋯ icons on the right of each row, even when the window is narrow or DevTools is docked. Column widths are now fixed so the whole table always fits.' },
    ],
  },
  {
    version: '0.10.170',
    date: 'June 16, 2026',
    highlight: 'Admin: Users table row actions visible again.',
    changes: [
      { type: 'fixed', text: 'On the admin Users table, the Call, Message, and ⋯ (more actions) icons on each row were getting clipped off the right edge after the compact-row redesign. They are visible again on every row.' },
    ],
  },
  {
    version: '0.10.169',
    date: 'June 16, 2026',
    highlight: 'Accessibility + visual polish pass.',
    changes: [
      { type: 'improved', text: 'Theme picker (Light / Dark / Auto buttons in Settings) now shows a clear focus ring when you tab to it.' },
      { type: 'improved', text: 'Audio-output picker close button looks like a proper button now instead of underlined text.' },
      { type: 'improved', text: 'Status pills in the Pending Users table give a subtle visual hint on hover so you know to look for the tooltip.' },
      { type: 'improved', text: 'Outbound-number dropdown no longer clips off the right edge on narrow windows.' },
      { type: 'improved', text: 'Screen readers now announce the dial button label correctly based on whether you have a number typed, a recallable last number, or neither.' },
      { type: 'improved', text: 'Login page divider is now announced to screen readers as a separator instead of reading the word "or" out loud.' },
      { type: 'fixed', text: 'Internal CSS cleanup - consolidated duplicate style declarations that could conflict with each other.' },
    ],
  },
  {
    version: '0.10.168',
    date: 'June 16, 2026',
    highlight: 'Two audio bug fixes.',
    changes: [
      { type: 'fixed', text: 'When dialing out, the dialer used to play your selected ringtone in your own ear while waiting for the other side to pick up. It now plays the standard phone ringback instead. Your selected ringtone still plays as expected for incoming calls.' },
      { type: 'fixed', text: 'Voicemail play button on the main list used to require two clicks - the first expanded the row but did not start playback. Now a single click expands AND starts playing the recording.' },
    ],
  },
  {
    version: '0.10.167',
    date: 'June 16, 2026',
    highlight: 'UX polish across the dialer.',
    changes: [
      { type: 'improved', text: 'Empty Recents and Messages views now show a clearer icon + heading + button to get started, instead of just two short sentences.' },
      { type: 'improved', text: 'Typing a digit in the middle of an existing phone number no longer jumps the cursor to the end.' },
      { type: 'improved', text: 'Block button on each Recents row got a little more breathing room so its not easy to confuse with the Favorite (star) icon.' },
      { type: 'improved', text: 'Incoming-call full-screen view scrolls internally on very short windows, so the Accept button is always reachable.' },
      { type: 'improved', text: 'Floating ringer window now opens on the same monitor as the main dialer (not always the primary monitor), and scales larger on 4K screens.' },
      { type: 'improved', text: 'Accessibility: phone-number input now announces itself properly to screen readers.' },
    ],
  },
  {
    version: '0.10.166',
    date: 'June 16, 2026',
    highlight: 'Users admin table redesigned to fit without horizontal scroll.',
    changes: [
      { type: 'improved', text: 'The Users admin table no longer requires horizontal scrolling. Status is now a colored dot next to each users name (green active, orange stale, red inactive). Role is shown as a small pill right beside the name. Email is tucked under the Microsoft SSO badge in the same cell. All the same information is visible at a glance and the table fits comfortably on a 1366x768 laptop.' },
    ],
  },
  {
    version: '0.10.165',
    date: 'June 16, 2026',
    highlight: 'Older voicemails play - take three.',
    changes: [
      { type: 'fixed', text: 'Continued the fix for older-voicemail playback. The previous attempts looked up recordings by the wrong identifier. This release uses caller number + recipient number + timestamp - the same lookup pattern our voicemail-receipt code already uses successfully.' },
    ],
  },
  {
    version: '0.10.164',
    date: 'June 16, 2026',
    highlight: 'Older voicemails actually play now (proper fix).',
    changes: [
      { type: 'fixed', text: 'v0.10.163 introduced an endpoint to ask Telnyx for a fresh download link, but the lookup used the wrong identifier and Telnyx returned 404. v0.10.164 fixes the lookup to use the call session id, which is what Telnyx expects. Older voicemails should now play immediately on click.' },
    ],
  },
  {
    version: '0.10.163',
    date: 'June 16, 2026',
    highlight: 'Older voicemails now play again.',
    changes: [
      { type: 'fixed', text: 'Voicemails older than ~10 minutes were silently failing to play (showing 0:00 / 0:00). Telnyx signs the audio links with a short expiry; the dialer now asks for a freshly-signed link each time you open a voicemail, so all of your voicemails play regardless of how old they are.' },
      { type: 'improved', text: 'Server responses are now gzip/brotli compressed which cuts data usage by roughly 40-50% on the lists you see in Voicemail, Recents, and Messages.' },
    ],
  },
  {
    version: '0.10.162',
    date: 'June 15, 2026',
    highlight: 'Admin > Users: all 8 columns now reachable via horizontal scroll.',
    changes: [
      { type: 'fixed', text: 'The Users admin table was hiding the Version, Last sign-in, and Action (Call/Text/Menu) columns at common window widths. Added a minimum width to the table so when the settings pane is narrower than the full table, you can scroll horizontally to reach the hidden columns instead of having them compressed to nothing.' },
    ],
  },
  {
    version: '0.10.161',
    date: 'June 15, 2026',
    highlight: 'Internal diagnostic improvements (no user-visible changes).',
    changes: [
      { type: 'improved', text: 'Server-side: voicemail audio playback now writes detailed step-by-step logs so the engineering team can diagnose any future playback issue from the server logs alone. No change to how the dialer behaves.' },
    ],
  },
  {
    version: '0.10.160',
    date: 'June 15, 2026',
    highlight: 'Admin > Users: all columns and action icons now reachable.',
    changes: [
      { type: 'fixed', text: 'The Users admin table had 8 columns but only the first 5 fit in the settings pane, hiding Version, Last Login, and the Call/Text/More icons. The table now scrolls horizontally inside the pane so every column is reachable at any window width.' },
    ],
  },
  {
    version: '0.10.159',
    date: 'June 15, 2026',
    highlight: 'Voicemail playback restored after a regression.',
    changes: [
      { type: 'fixed', text: 'A previous release introduced a regression where voicemail audio would not play at all - even brand-new messages showed 0:00 / 0:00 in the in-app player. This release rolls back that change so voicemails play again. Older voicemails (where the original audio link from Telnyx has expired) may still have playback issues; a proper fix for that is planned for an upcoming release.' },
    ],
  },
  {
    version: '0.10.157',
    date: 'June 15, 2026',
    highlight: 'Fixed: older voicemails now play correctly.',
    changes: [
      { type: 'fixed', text: 'Older voicemails would show their transcript but fail with "Failed to fetch audio: HTTP 403" when you pressed play. The audio links Telnyx gave us at the time the message was left have a limited lifetime and were expiring on older recordings. The dialer now automatically fetches a fresh audio link from Telnyx when the original one stops working, so every voicemail in your inbox plays again — no action required from you.' },
    ],
  },
  {
    version: '0.10.156',
    date: 'June 15, 2026',
    highlight: 'Teams voicemail Listen button now opens the desktop dialer.',
    changes: [
      { type: 'fixed', text: 'Clicking Listen on a voicemail notification in Teams used to open the web playback page in your browser. It now opens the ACE Dialer desktop app directly, matching how the Call back and Send text buttons already worked. If you do not have the desktop app installed, it still falls back to the web page so nothing breaks.' },
    ],
  },
  {
    version: '0.10.155',
    date: 'June 15, 2026',
    highlight: 'All primary screens now display correctly on lower-resolution monitors.',
    changes: [
      { type: 'fixed', text: 'Incoming-call screen: the Accept and Decline buttons sometimes got pushed below the visible area on 1366x768 laptops. The caller name and action buttons now scale to your window size so everything stays visible and reachable.' },
      { type: 'fixed', text: 'In-call view: the hang-up button and on-screen controls (mute, hold, keypad, transfer) now scale with your window so the bottom of the screen stays usable on smaller displays.' },
      { type: 'improved', text: 'Settings: long sub-pages (User Management, Audit Log, etc.) now scroll smoothly inside the settings pane instead of pushing content off-screen, with the section header staying visible while you scroll.' },
    ],
  },
  {
    version: '0.10.154',
    date: 'June 15, 2026',
    highlight: 'Dialpad now scales properly on lower-resolution screens.',
    changes: [
      { type: 'fixed', text: 'On 1366x768 laptops and other lower-resolution screens, the call button sometimes got pushed off-screen by the keypad. The dialpad now scales smoothly with your window size, so the call button stays fully visible at any resolution from 1280x720 up.' },
    ],
  },
  {
    version: '0.10.153',
    date: 'June 15, 2026',
    highlight: 'Fixed: dialer no longer offers a lower version as an update.',
    changes: [
      { type: 'fixed', text: 'If a draft build was installed for testing, the dialer would sometimes show an "Update available" toast pointing at an older published release. The dialer now compares the offered version to whats installed and only shows the toast when its a real upgrade.' },
    ],
  },
  {
    version: '0.10.152',
    date: 'June 15, 2026',
    highlight: 'Fixed: voicemail greeting sounded choppy/staticky when other ACE Dialer users called you.',
    changes: [
      { type: 'fixed', text: 'When another ACE Dialer user called you and hit your voicemail, your greeting sounded choppy or staticky. Phone (PSTN) callers heard the same greeting fine. The dialer was storing greetings as MP3, and Telnyx then had to re-encode that MP3 to a different audio codec for delivery to dialer listeners, which generated audible warble. We now store greetings as lossless WAV so Telnyx can deliver them cleanly to both phone and dialer callers. Existing greetings need to be re-recorded once to get the improvement.' },
    ],
  },
  {
    version: '0.10.151',
    date: 'June 15, 2026',
    highlight: 'Auto-update restored. You no longer need to manually install update files.',
    changes: [
      { type: 'fixed', text: 'Auto-update was blocked on Windows because the dialer was waiting for a code-signing certificate that has not been procured yet. The dialer now installs updates directly from GitHub, the same way it did before. You will get future versions automatically without any action.' },
    ],
  },
  {
    version: '0.10.150',
    date: 'June 13, 2026',
    highlight: 'Fixed: admin-uploaded ringtones now play correctly when selected',
    changes: [
      { type: 'fixed', text: 'When you picked an admin-uploaded ringtone in Settings, the dialer would save the selection but still play the default Classic ringtone on incoming calls. The validation function silently rejected any slug that wasnt one of the four built-in presets, dropping uploaded ringtone references and falling back to the default. The fix accepts both built-in presets and upload references. The four built-in presets (Classic, Modern, Chime, Pulse) were already working; this only affects admin-uploaded sounds.' },
      { type: 'improved', text: 'Diagnostic: ringtone start() now logs the resolved slug at info level. If you ever report "the ringtone didnt change," your Settings > Diagnostics export will show exactly which slug played, making the diagnosis instant.' },
    ],
  },
  {
    version: '0.10.149',
    date: 'June 12, 2026',
    highlight: 'Fixed: in-app voicemail greeting recordings now play correctly (webm → mp3 server-side transcode)',
    changes: [
      { type: 'fixed', text: 'Custom voicemail greetings recorded with the in-app Record button now play correctly when callers reach voicemail. Previously, browsers MediaRecorder API produced WebM audio which Telnyx could not decode, causing callers to hear "an application error has occurred" instead of the greeting. The API now transcodes WebM uploads to MP3 server-side before storing them, so the entire recording flow now works end-to-end. Users on the TeXML voicemail trial who recorded greetings before this release should re-record (one tap in Settings) so their greeting becomes the new MP3-encoded version.' },
      { type: 'fixed', text: 'Internal: added ffmpeg-static + fluent-ffmpeg dependencies to the API service. Transcoding runs at upload time (a few hundred milliseconds for a 30-second greeting), saved to Supabase Storage as audio/mpeg. No client-side changes - the in-app Record button works the same way.' },
    ],
  },
  {
    version: '0.10.148',
    date: 'June 12, 2026',
    highlight: 'UX P3 polish — paint-hint optimization on frequently-animated UI',
    changes: [
      { type: 'improved', text: 'Performance hint added to elements that animate on every interaction (incoming-call buttons, in-call control buttons, return-to-call banner, list rows). The browser now knows to promote these to their own compositor layer ahead of time, eliminating small paint stutters on lower-end laptops.' },
    ],
  },
  {
    version: '0.10.147',
    date: 'June 12, 2026',
    highlight: 'UX P2 polish batch 4 — Diagnostics tail bounded',
    changes: [
      { type: 'improved', text: 'Settings → Diagnostics log preview no longer grows unbounded as the in-memory buffer fills. Tail is now capped at 50% of viewport height with internal scroll, so the page header stays visible. The full export still includes everything.' },
      { type: 'fixed', text: 'Note: original batch 4 also planned empty-state illustrations, number-display label, and Recents Block icon spacing - those need component-level edits and were deferred. Will follow in a future release.' },
    ],
  },
  {
    version: '0.10.146',
    date: 'June 12, 2026',
    highlight: 'UX P2 polish batch 3 — narrow-viewport fixes',
    changes: [
      { type: 'fixed', text: 'Mobile/narrow viewport (≤540px) app header now actually applies its layout overrides. The previous media-query rule used grid-template-columns but the header is a flexbox, so the rule was a no-op. Rewritten to use flex-friendly properties that work.' },
      { type: 'fixed', text: 'Incoming-call banner (the small non-fullscreen variant) no longer overflows beyond very narrow viewports. Adds a max-width: calc(100vw - 24px) cap so the Accept/Decline buttons stay on-screen even at ~480px window widths.' },
    ],
  },
  {
    version: '0.10.145',
    date: 'June 12, 2026',
    highlight: 'UX P2 polish batch 2 — search bar layering, light-mode flash, settings tables',
    changes: [
      { type: 'fixed', text: 'Search bar (Recents, Voicemail, Messages) no longer gets visually covered by row-action menus or other page UI when scrolling. Stacking layer raised so it sits above page content but still ducks under the green return-to-call banner during active calls.' },
      { type: 'fixed', text: 'Light-mode no longer flashes a dark background on first paint. The dialer shell was hard-coded to black; it now uses the theme token so light mode renders correctly from the very first frame.' },
      { type: 'improved', text: 'Settings two-column layout now allows the content pane to shrink below its content min-width. Pending Users and Audit Log tables that used to force horizontal scroll across the whole Settings pane now scroll inside their own container correctly.' },
    ],
  },
  {
    version: '0.10.144',
    date: 'June 12, 2026',
    highlight: 'UX P2 polish batch 1 — six small layout fixes',
    changes: [
      { type: 'improved', text: 'Settings navigation now handles long titles and blurbs cleanly. The chevron arrow no longer gets squeezed off the right edge of the nav rail when entry text is long; titles ellipsis at one line, blurbs clamp at two.' },
      { type: 'improved', text: 'On QHD (2560×1440) and larger displays, the dialer content area now extends to 1480px wide (was 1280px) so Settings tables and lists fill more of the available screen instead of sitting in 50 percent gutters. Recents, Voicemail, and Messages also widen slightly on very large displays for less aggressive name truncation.' },
      { type: 'fixed', text: 'Bottom-nav unread badge no longer drifts onto adjacent tabs at narrow widths and no longer overlaps the icon when the count reaches 99+. The badge is now anchored to the individual tab icon wrapper instead of relying on fragile percentage-based positioning.' },
      { type: 'improved', text: 'Praise modal close button is now 40px (was 32px) and full opacity instead of 70 percent. Easier to find and easier to click.' },
      { type: 'fixed', text: 'Copy-toast notification no longer renders on top of open modals. The z-index was set to 5000 (the highest in the codebase) which incorrectly placed it above modal backdrops at 800-1300. Dropped to 100 so it sits above page content but below any modal.' },
    ],
  },
  {
    version: '0.10.143',
    date: 'June 12, 2026',
    highlight: 'Auto-update security hardening — signature verification now enforced during EV cert procurement window',
    changes: [
      { type: 'fixed', text: 'Auto-update signature verification is now enforced by default. Previously the dialer had an override that disabled Windows publisher-name verification (added because our installer isnt EV-signed yet). That override left a supply-chain attack vector: anyone with access to GitHub Releases could push a malicious binary that every dialer would auto-install. The override is now gated behind an explicit ACE_BYPASS_CODE_SIGNING env var (not set in production builds), so updates will fail until we ship a properly signed binary. Procurement of an EV code-signing certificate is in progress; see docs/ev-cert-procurement.md for the timeline.' },
      { type: 'fixed', text: 'During the procurement window (~2 weeks), auto-update may show "Update failed: not signed by the application owner" errors. This is EXPECTED. Until the cert lands, please download new installers from GitHub Releases manually. Auto-update will resume once v0.10.144+ ships with EV signing wired in.' },
    ],
  },
  {
    version: '0.10.142',
    date: 'June 12, 2026',
    highlight: 'Backend hardening — Teams card dedup now works across multiple webhook replicas',
    changes: [
      { type: 'fixed', text: 'Teams notification dedup is now backed by a Postgres webhook_dedup table instead of an in-memory Set per process. Previously if the ace-dialer-webhooks service scaled beyond one replica (or restarted between the recording-completed and the 30-second timeout fallback paths), the same Teams card could fire twice. Now every send-card path reserves a unique key in the database first; only the first replica to claim a key sends the card.' },
      { type: 'fixed', text: 'Server-only change. No user-facing impact in the current single-replica configuration, but enables future horizontal scaling of the webhooks service without duplicate notifications.' },
    ],
  },
  {
    version: '0.10.141',
    date: 'June 12, 2026',
    highlight: 'Backend security hardening — socket service now requires JWT authentication',
    changes: [
      { type: 'fixed', text: 'Security: the real-time socket service (ace-dialer-socket) used to accept any connection from any origin with no authentication. It now requires a valid JWT token on every connection and a strict CORS origin allowlist. This had no user-facing impact because the socket service is currently in Phase 0 (just ping/pong, no live events), but it had to be hardened before v0.11.0 ships Presence and Do Not Disturb features which broadcast user state over the socket.' },
      { type: 'fixed', text: 'The socket service now refuses to start if JWT_SECRET or CORS origin allowlist is missing. Previously the service would silently fall back to accepting all origins with no auth. Required env vars on the Render service: JWT_SECRET (must match the value on ace-dialer-api) and SOCKET_CORS_ORIGINS (comma-separated allowlist).' },
    ],
  },
  {
    version: '0.10.140',
    date: 'June 12, 2026',
    highlight: 'Accessibility + responsive layout polish — closes the last 5 P1 UX findings',
    changes: [
      { type: 'improved', text: 'Reduced-motion support. If you have animations disabled in your OS preferences (Windows Settings > Accessibility > Visual effects > Animation effects OFF, or macOS Reduce Motion ON), the dialer now respects that across all 11+ continuous animations - the incoming-call pulse, the in-call return banner, status dots, presence indicators, spinners, and modal entries are all stilled.' },
      { type: 'improved', text: 'Responsive layout now adapts to mid-range viewports. The dialer used to be designed for either small mobile or wide desktop with nothing in between - on a 1366x768 Windows laptop at 125 percent DPI scaling (very common), the Settings nav rail would crowd the content pane awkwardly. New breakpoints tighten the Settings layout in the 800-1100px range and expand the content cap on QHD+ monitors so wide tables breathe instead of sitting in 50 percent gutters.' },
      { type: 'improved', text: 'Muted secondary text contrast bumped from 0.55 to 0.68 alpha. Previously secondary text like timestamps, sublabels, and email addresses sat just below WCAG AA contrast threshold when shown on the dialers slightly-tinted card backgrounds. Now they all clear the AA bar by a comfortable margin.' },
      { type: 'improved', text: 'Touch targets enlarged on multiple secondary icons. Quick-reply action buttons (26x26 → 32x32), update-banner dismiss (24 → 32), voicemail action icons (30 → 36), pending-user action icons (28 → 32) all easier to hit. Most notably the non-fullscreen incoming-call Accept/Decline buttons went from 40x40 to 56x56 - those are the time-critical buttons for answering a call, no reason to make them small.' },
      { type: 'improved', text: 'User dropdown menu can now scroll on short viewports. Previously if the menu had enough items to exceed the viewport height it would clip without warning; now it gracefully scrolls (invisible scrollbar, native gesture).' },
    ],
  },
  {
    version: '0.10.139',
    date: 'June 12, 2026',
    highlight: 'Functional QA safe-batch - 11 low-risk fixes from the audit, plus internal hardening for memory leaks and edge cases',
    changes: [
      { type: 'fixed', text: 'Sign out followed by sign in is now cleaner. Previously the dialer left a stale browser-tab visibility listener attached after logout that referenced the old SIP connection - on a sign-out then sign-in cycle, the new session inherited the dead listener and its background-tab recovery silently failed. The listener is now removed on disconnect.' },
      { type: 'fixed', text: 'Tapping Accept after a caller already hung up no longer leaks memory. The dialer was creating a stale call-log entry every time, which over a long session with many missed calls would slowly grow internal state. The stale event is now dropped at the logger boundary.' },
      { type: 'improved', text: 'Device tracking is now stable in Chrome Incognito and other private-browsing modes. The dialer previously generated a fresh device id every time localStorage was unavailable, which made Admin -> Users -> Version show inconsistent data for Incognito sessions and could cause force-update prompts to fire repeatedly.' },
      { type: 'fixed', text: 'Webhook safety: an unrecognized DialCallStatus value from Telnyx (schema-drift edge case) used to fall through to the voicemail capture branch, misclassifying a successful call as voicemail. The dialer now hangs up cleanly on unknown statuses.' },
      { type: 'fixed', text: 'TeXML voicemail polling: if Telnyx returned multiple recordings (a frequent caller leaving two voicemails close together), the importer used to assume newest-first ordering. It now explicitly sorts by recording start time and filters out recordings that started before the current call - eliminating a class of "wrong recording imported" edge cases.' },
      { type: 'fixed', text: 'Scheduled SMS no longer double-sends after a server crash. If the API crashed mid-Telnyx-send and the message had already been accepted by Telnyx (telnyxMessageId stamped), the stuck-row sweep used to re-attempt and the recipient would get the SMS twice. The sweep now refuses to resend messages that have a telnyxMessageId and marks them failed for review.' },
      { type: 'fixed', text: 'JobDiva contact lookup cache no longer locks out a phone number permanently if a synchronous error escapes the fetch path. The hook now wraps the call in Promise.resolve so any throw routes through the .catch path.' },
      { type: 'fixed', text: 'Desktop deep-link parsing: ace-dialer://call?to=auth/callback no longer mis-routes to the SSO handler. The desktop app now parses the URL and dispatches on hostname, removing the legacy substring match.' },
      { type: 'fixed', text: 'Speaker selection that fails (e.g., the chosen device was just unplugged) now reverts to the previous preference and broadcasts an internal event the UI can show. Previously the dialer persisted the broken device id and the next call used it again.' },
      { type: 'fixed', text: 'Server: GET /auth/me now returns 401 (not 200 with an error body) when a deleted user has a still-valid JWT. The dialer logs the stale session out immediately instead of rendering a broken shell.' },
    ],
  },
  {
    version: '0.10.138',
    date: 'June 12, 2026',
    highlight: 'UX batch #2 (completed) - in-call layout, safer confirmations, modal contrast',
    changes: [
      { type: 'fixed', text: 'Delete/block confirmations are now reliable in the Electron desktop app. Previously some confirmation dialogs could silently confirm the action when Electron returned null from window.confirm. Explicit click now required for Block, Remove Favorite, Cancel Scheduled Message, Remove Hold Music, Remove Audio Greeting, Import Preferences, Replace Quick Replies, Unblock Number, Archive Template, and more.' },
      { type: 'improved', text: 'In-call screen adapts to short viewports. On 1366x768 displays with a held call plus the full 3x3 control grid, the hangup button used to clip below the visible area. The layout now compacts on viewports under 700px tall.' },
      { type: 'improved', text: 'Tip banner no longer overlaps the bottom navigation bar on 1366x768 laptops. The Voicemail tab and its unread badge are now fully visible when a tip is open.' },
      { type: 'fixed', text: 'Modal backdrops are consistently dark across all overlays. Four modals (contacts quick-pick, call history detail, audio greeting picker, post-decline reply sheet) were rendering with semi-transparent backdrops. They now match the design spec.' },
      { type: 'fixed', text: 'Internal: added missing CSS rules for incoming-call action labels and tab badge wrappers.' },
    ],
  },
  {
    version: '0.10.137',
    date: 'June 12, 2026',
    highlight: 'Catches up the What is New list (the entries for 0.10.135 and 0.10.136 were missing from the previous build)',
    changes: [
      { type: 'fixed', text: 'The What is New screen now correctly shows entries for v0.10.135 (60s SIP reconnect feature-flag canary) and v0.10.136 (UX batch fixes - keyboard focus ring, latent crash prevention, dialpad fits at 1366x768 with 125 percent DPI). They were missing from the previous build due to a release-script anchor mismatch.' },
    ],
  },
  {
    version: '0.10.136',
    date: 'June 12, 2026',
    highlight: 'Three high-impact UI/UX fixes - keyboard focus, latent crash prevention, dialpad fits on 1366x768 laptops',
    changes: [
      { type: 'improved', text: 'Keyboard navigation now shows a visible focus ring when you Tab through any page. Mouse interactions are unchanged.' },
      { type: 'fixed', text: 'Prevented a latent React crash in the Telnyx status banner. Same Rules-of-Hooks violation that crashed the floater Reply with Text feature multiple times.' },
      { type: 'fixed', text: 'Dialpad green call button no longer gets clipped at 1366x768 with Windows 125 percent display scaling - the most common business laptop config.' },
    ],
  },
  {
    version: '0.10.135',
    date: 'June 12, 2026',
    highlight: 'Experimental canary - 60 second periodic full SIP reconnect disabled',
    changes: [
      { type: 'improved', text: 'Experimental build (canary). The previous behavior of tearing down and rebuilding the entire SIP connection every 60 seconds is feature-flagged OFF. The 15-second normal SIP register refresh keeps the registration alive. If inbound call delivery stays clean, this becomes the new default.' },
    ],
  },
  {
    version: '0.10.134',
    date: 'June 12, 2026',
    highlight: 'Completes the v0.10.133 missing-Recents fix - works for TeXML trial users too',
    changes: [
      { type: 'fixed', text: 'v0.10.133 introduced canonicalInboundToNumber but it only worked when attribution had matched a specific UserDid via connection_id. For TeXML voicemail trial users, the webhook payload connection_id is the shared TELNYX_VOICEMAIL_CC_APP_ID (the same Voice API App is shared across all migrated trial users), so the UserDid lookup is intentionally skipped to avoid wrong attribution. Attribution then succeeds via sipUsername (Pass 1 or 2) but only sets userId, not userDidId. Without a userDidId, v0.10.133s canonicalization silently fell back to the raw SIP credential username - same outcome as before the fix. This release teaches canonicalInboundToNumber to ALSO accept the resolved userId and look up the users primary UserDid (activeUserDidId, else first by id) for the didNumber. Now any inbound Call row whose toNumber is a SIP username gets rewritten to the dialed phone number, regardless of which attribution pass matched.' },
      { type: 'fixed', text: 'Server-only. No client changes. Once Render redeploys ace-dialer-webhooks, future TeXML trial calls land with correct toNumber. The v0.10.133 backfill script (rewritten with a userDidId IS NOT NULL guard to avoid touching legacy pre-v0.10.108 mis-attribution rows) can be run separately to repair historical rows.' },
    ],
  },
  {
    version: '0.10.133',
    date: 'June 12, 2026',
    highlight: 'Fixed: answered inbound calls were missing from Recents for TeXML voicemail trial users',
    changes: [
      { type: 'fixed', text: 'Critical Recents fix. For users on the TeXML voicemail trial (currently you and the 8 testers), answered inbound calls were missing from the Recents tab. The root cause was that Telnyx fires call event webhooks ONLY for the SIP-delivery leg of those calls, not the PSTN leg, so the database row ended up storing the dialers SIP credential username as the to-number instead of a phone number. A safety filter on the Recents query was then hiding any row whose to-number matched a known SIP username, which wiped 100 percent of answered inbound calls for these users. Fixed by using the connection-id-attributed UserDid to normalize the to-number at write time: when the webhook says to-number is a SIP credential, we now look up the UserDids actual phone number and store that instead. Once Render redeploys the webhooks service, future inbound calls will store correctly. A one-time backfill script is also included to repair the ~50 existing rows already in the database.' },
      { type: 'fixed', text: 'Server-only hotfix to apps/webhooks. The desktop dialer build does not need updating. Run the backfill script once after the Render redeploy to restore historical inbound calls to your Recents.' },
    ],
  },
  {
    version: '0.10.132',
    date: 'June 12, 2026',
    highlight: 'Incoming-call UI unified across main window and floater - clearer, safer, consistent',
    changes: [
      { type: 'improved', text: 'When already on a call and a second call rings, the main window now shows exactly three buttons: Decline, Reply with Text, Hold and Accept (in that order). Previously it showed four buttons including a plain Accept that would merge the two calls audio - the same bug we fixed on the floater popup in v0.10.120 has now been fixed on the main window too. Plain Accept is automatically hidden whenever Hold and Accept is the safe option.' },
      { type: 'improved', text: 'Reply with Text is now available even when you are already on a call. Previously it was only offered when you had no active call. Available on both the main window and the floating popup.' },
      { type: 'improved', text: 'Hold and Accept on the main window now uses the same green-circle-with-orange-pause-badge icon as the floater. Previously it was amber with a phone-forward arrow icon, which looked completely different from the floater. Now both surfaces share the same icon vocabulary, just at different sizes.' },
      { type: 'fixed', text: 'Floater button alignment: Reply with Text was sitting slightly higher than Decline and Accept because its two-line label was taller than the one-line labels. Switched the floater row to top-align all buttons, so they now sit at the same vertical position regardless of label length.' },
    ],
  },
  {
    version: '0.10.131',
    date: 'June 12, 2026',
    highlight: 'Clearer Hold and Accept icon on the floating call popup',
    changes: [
      { type: 'improved', text: 'Refreshed the Hold and Accept icon on the floating incoming-call popup. The previous icon (phone receiver with a faint arrow) was indistinguishable from the plain Accept icon at floater size. New design keeps the same large green button (matching the Decline buttons size), but adds a small orange pause badge in the TOP-RIGHT corner of the button - notification-badge style. The phone receiver underneath remains fully visible. Orange matches the Reply with Text button so orange consistently signals a modifier action across the floater UI. Action behavior is unchanged (clicking still holds the current call and accepts the new one).' },
      { type: 'fixed', text: 'No code changes to Reply with Text - working correctly since v0.10.130. This release is purely a UI polish pass on the Hold and Accept icon.' },
    ],
  },
  {
    version: '0.10.130',
    date: 'June 12, 2026',
    highlight: 'Reply with Text crash FINALLY fixed - root cause was a React rules-of-hooks violation',
    changes: [
      { type: 'fixed', text: 'Fixed the Reply with Text crash that has been blocking 4 release attempts (v0.10.122/.125/.127/.129). Root cause was finally caught via DevTools console capture: React error #310 (rendered more hooks than during the previous render). The Reply with Text useEffect was inserted AFTER the components if-no-incoming early-return guard, making it a conditional hook. On first render (no call) only 3 hooks ran; on second render (call arrives) the 4th hook tried to run, React detected the count mismatch and threw, the renderer crashed, the main window went blank, JsSIP terminated the session, and the caller got bounced to voicemail. Fix moves the useEffect to BEFORE the early-return guard so the hook count is identical across renders. Reply with Text on the floater now works without crashing the dialer.' },
      { type: 'fixed', text: 'Bonus: the immediate voicemail bounce (caller hearing voicemail after 1 ring) that has been seen in tandem with this crash was the downstream consequence of the renderer crash - a dead renderer cannot accept SIP INVITEs or refresh REGISTER, so Telnyx routed the call to voicemail. Fixing the crash fixes the bounce.' },
    ],
  },
  {
    version: '0.10.129',
    date: 'June 12, 2026',
    highlight: 'Reply with Text returns to the floating popup (diagnostic build) + Render auto-deploy fix',
    changes: [
      { type: 'new', text: 'Reply with Text button is back on the floating call popup. After three previous attempts (v0.10.122/.125/.127) all crashed the renderer for unknown reasons, this build adds the same feature with extensive try/catch + console.log instrumentation around the subscribe/unsubscribe logic so we can finally capture what is going wrong. If you hit the blank-window bug again, please open DevTools (Ctrl+Shift+I) BEFORE making a test call and screenshot the Console tab when the crash happens. Note: this is a Draft release - do not auto-distribute until we have confirmation that it is stable.' },
      { type: 'improved', text: 'Render backend auto-deploys: added a GitHub Actions workflow (.github/workflows/render-deploy.yml) that pings each Render service deploy hook on every push to main, providing a reliable belt-and-suspenders fallback for the unreliable path-filter based auto-deploy. Requires three GitHub secrets (RENDER_HOOK_API, RENDER_HOOK_SOCKET, RENDER_HOOK_WEBHOOKS) which are deploy-hook URLs copied from each Render service Settings page. No more manual Render dashboard clicks to redeploy after a code push.' },
      { type: 'fixed', text: 'Internal: the v0.10.129 changes were applied via a single local Node script (scripts/apply-v129-changes.mjs) to bypass the workspace-sync corruption that has been silently truncating source files between every Edit-tool round-trip. Combined with v0.10.128 null-byte stripper, the build pipeline is now resilient to both classes of bridge bug.' },
    ],
  },
  {
    version: '0.10.128',
    date: 'June 12, 2026',
    highlight: 'Stable baseline after a bumpy release week - dialer is reliable again',
    changes: [
      { type: 'fixed', text: 'Reverted the floating-call-popup Reply with Text button (which was attempted in 0.10.122, 0.10.125, and 0.10.127). Every attempt caused the renderer to crash, leaving the dialer with a blank window after the first incoming call. The full-screen ringing UI Reply button continues to work. Floater goes back to 2 buttons (Decline / Accept) when idle, and 2 buttons (Decline / Hold and Accept) when already on a call. We will revisit the floater feature after a proper diagnostic capture of what was crashing.' },
      { type: 'improved', text: 'Added a build-time guard against the workspace-sync null-byte corruption that has been silently breaking releases this week. A new scripts/strip-null-bytes.mjs runs automatically before every build (via npm prebuild hook) to scrub any embedded null characters out of source files. This was the root cause behind several JSON parse errors and TS1127 compile failures during the last 24 hours.' },
      { type: 'improved', text: 'Voicemail duplicates: the v0.10.121 server-side dedup (call_session_id alignment) and the v0.10.126 behavioral safety-net (30-second same-caller window) both remain active. Together they catch all duplicate paths.' },
    ],
  },
  {
    version: '0.10.125',
    date: 'June 11, 2026',
    highlight: 'Reply with Text now available on the floating call popup (the feature originally tried in v0.10.122, safely re-introduced now that the startup crash is fixed).',
    changes: [
      { type: 'new', text: 'The floating call popup (the small green window that pops up bottom-right when a call comes in) now has a Reply with Text button between Decline and Accept. Tapping it declines the call AND opens the quick-reply sheet so you can fire off an SMS to the caller without picking up. Only shows when you are not already on another call and when the caller is a real phone number (internal SIP callers cannot receive SMS). This was originally attempted in v0.10.122 but had to be rolled back because of an unrelated startup bug that we fixed in v0.10.124. With that fixed, the feature is back.' },
    ],
  },
  {
    version: '0.10.124',
    date: 'June 11, 2026',
    highlight: 'CRITICAL fix: the dialer app was vanishing at startup after install. Root-cause identified and restored.',
    changes: [
      { type: 'fixed', text: 'CRITICAL startup fix. The v0.10.122 and v0.10.123 installers ran successfully but the app vanished immediately after launch with nothing visible to the user. Root cause: a previous Edit-tool-truncation had silently removed the final 87 lines of the Electron main process, including the startup block that creates the main window and tray icon (app.whenReady -> createTray + createWindow). Without that block, the process was launching successfully but never showed a window - it was running invisibly. v0.10.124 restores those lines from the v0.10.120 baseline. The app once again creates its window and tray icon at startup and reaches the SSO screen normally.' },
      { type: 'fixed', text: 'Duplicate voicemails fix (originally shipped server-side as v0.10.121) is permanently in place. Some voicemails were appearing twice in the Voicemail tab because two different code paths (the Telnyx recording-completed callback and our per-call polling workaround) were using different identifier types as the dedup key. They are now aligned on call_session_id, so a single voicemail only ever produces one row regardless of which path processes it. Existing duplicate rows from before this fix are not auto-cleaned - delete duplicates manually if any bug you.' },
      { type: 'fixed', text: 'The Reply with Text button on the floating call popup (which was the v0.10.122 client feature) is temporarily disabled while we investigate a separate concern. The Reply button on the full-screen ringer continues to work as before. The Hold and Accept feature from v0.10.120 also continues to work.' },
    ],
  },
  {
    version: '0.10.120',
    date: 'June 11, 2026',
    highlight: 'Hotfix: Hold & Accept now works from the floating call popup so a second incoming call no longer merges with your active one',
    changes: [
      { type: 'fixed', text: 'CRITICAL fix for the floating call-popup (the small green window that pops up bottom-right when a call comes in). Previously, if you were already on a call and a SECOND call arrived, the popup only offered Accept and Decline. Tapping Accept answered the new call WITHOUT putting the first one on hold, so both audio streams played at once and it sounded like the two calls had merged. The popup now detects that you are on a connected call and switches the right-hand button from Accept to Hold and Accept. Clicking it parks your current caller on hold and bridges you to the new one cleanly. The held call shows in the in-call screen exactly like Add Call. This matches how the full-screen ringing UI has worked since Phase 6.3.' },
      { type: 'improved', text: 'The floating popup now includes a one-line hint under the caller name saying you are already on a call when applicable, and the action buttons are labelled (Decline / Hold and Accept) so the consequence of each click is obvious before you tap.' },
      { type: 'new', text: 'This release also brings users on older versions (0.10.115 / 0.10.116 / 0.10.117 / 0.10.118) up to date with everything that shipped in between, including: critical one-way-audio fix (0.10.116), voicemail-routed calls now appearing in Recents (0.10.117), persistent Tips banner hide (0.10.118), Favorites focus fix (0.10.118), and the personalized voicemail greeting infrastructure (0.10.119, still in controlled trial scope so you will only see TeXML-flow voicemails if your DID is on the trial allowlist).' },
    ],
  },
  {
    version: '0.10.119',
    date: 'June 11, 2026',
    highlight: 'Personalized voicemail greetings now work — first DID is live in a controlled trial; rolling out gradually',
    changes: [
      { type: 'new', text: 'Personalized voicemail greetings now play to callers when you do not pick up. Record (or upload, or type-as-TTS) your own greeting in Settings > Calling > Voicemail greeting, and that is what callers hear instead of the generic Telnyx default. Greetings include a brief silence trim and a beep, then the caller can leave a message of up to 5 minutes.' },
      { type: 'improved', text: 'Voicemails from the new personalized-greeting flow show up everywhere a Hosted Voicemail would — in the Voicemail tab with full recording + transcription, AND as a missed-call entry in Recents. No more "I see the voicemail but not the missed call" gap.' },
      { type: 'fixed', text: 'Voicemail transcription was silently broken in recent releases — captured voicemails were stored but the transcription field stayed null because a Deepgram call was dropped during a refactor. The transcribe step is restored for all voicemail flows (Hosted VM, Call Control, and the new TeXML voicemail flow). New voicemails get transcribed within ~5-15 seconds of being recorded.' },
      { type: 'fixed', text: 'Stability: when a recording is created on Telnyx but the recording-status webhook is not delivered (intermittent Telnyx-side issue we filed a support ticket about and they confirmed), the dialer now polls the Telnyx Recordings API on its own — first immediately after each call, then again as a background safety-net sweep every 5 minutes — so no voicemail goes missing even if Telnyx misses a callback. Dedup ensures no duplicate rows when Telnyx eventually does deliver.' },
      { type: 'improved', text: 'Greeting playback no longer loops when the caller pauses mid-message. The Record verb is now followed by an explicit Hangup so a 5+ second silence does not cause Telnyx to loop back to the greeting and start over. Silence-tolerance bumped 5s → 10s.' },
      { type: 'new', text: 'Admin notes / trial scope: this release is a CONTROLLED ROLLOUT. Only DIDs explicitly listed in the TEXML_TRIAL_DIDS env var (currently just +16467379912) go through the new flow; everyone else stays on Hosted Voicemail. Admins can migrate / rollback per-user via /admin/users/:id/voicemail-texml-migrate and /voicemail-texml-rollback endpoints. Per-DID greeting UI is shared with the v0.10.100 stack so it works the same way users already know.' },
      { type: 'new', text: 'Admin notes / diagnostics: new helper scripts under packages/db/scripts/ — lookup-did, recent-voicemails, apply-sql-migration — let admins inspect migration state and recent voicemail rows without psql. New SystemConfig table caches the Telnyx TeXML Application ID across webhooks-service restarts so we are not creating a new App every deploy.' },
    ],
  },
  {
    version: '0.10.118',
    date: 'June 10, 2026',
    highlight: 'Tips can be hidden persistently, favorites name input fixed, Voicemail Migration paused',
    changes: [
      { type: 'new', text: 'You can now permanently hide the floating "Did you know?" tips banner. Click the new eye-off icon on the banner to hide it, or toggle it on/off any time from Settings > Personal > Appearance. The banner will reappear automatically only when a new tip is added - so you stay informed about important new features without seeing the same tips repeatedly.' },
      { type: 'fixed', text: 'Saving a number to Favorites: the First Name field is now properly focused when the modal opens, so you can start typing immediately. Previously the field looked focused but keystrokes were ignored until you clicked elsewhere or refreshed. Now uses an explicit focus + select on open, which is more reliable than the browser autofocus behavior.' },
      { type: 'improved', text: 'Voicemail migration to Call Control is now PAUSED - the button in Settings > Users is disabled with an explanatory tooltip. The Call Control voicemail flow had reliability issues for some migrated users (intermittent "not in service" reports). We are rebuilding this on Telnyx TeXML, which is more declarative and reliable, and will re-enable migrations in a future release. Users currently on the legacy Hosted Voicemail flow are unaffected and continue to work normally.' },
    ],
  },
  {
    version: '0.10.117',
    date: 'June 10, 2026',
    highlight: 'Voicemail-routed calls now show in Recents (alongside Voicemail tab) + Telnyx status banner is admin-only',
    changes: [
      { type: 'fixed', text: 'When someone leaves you a voicemail, the call now appears in Recents as Missed - alongside the recording in the Voicemail tab. Previously, voicemails for users migrated to the Call Control voicemail flow only showed in Voicemail tab; Recents had no entry for those missed calls. Both flows now create Call rows with the proper status (missed / caller_canceled / busy / no_answer) so Recents stays the single source of truth for incoming-call history.' },
      { type: 'improved', text: 'Telnyx outage banner is now shown only to admin users. Regular users no longer see the operational status alerts - those are noise for them and only matter to whoever is on call for incidents.' },
    ],
  },
  {
    version: '0.10.116',
    date: 'June 10, 2026',
    highlight: 'CRITICAL audio fix: one-way audio resolved — wait for TURN relay candidates before shipping SIP offer/answer',
    changes: [
      { type: 'fixed', text: 'CRITICAL one-way audio fix (Telnyx-confirmed root cause): the dialer was cutting off ICE candidate gathering as soon as the first server-reflexive (srflx) candidate arrived, before TURN relay candidates could be collected. For users behind symmetric NAT (common on corporate / ISP networks), relay candidates are REQUIRED as a fallback when direct UDP connectivity fails — without them, the media path from Telnyx back to the client cannot be established, resulting in the caller hearing the callee but the callee not hearing the caller. New strategy: wait for first RELAY candidate (best case), with a 2.5-second fallback timeout that ships whatever candidates are available (still inside Telnyx\'s 5-second progress window), plus a 4.5-second hard safety net. Logs a warning when shipping SDP without relay so we can spot symmetric-NAT users proactively.' },
      { type: 'improved', text: 'Diagnostic visibility: every iceReady event now logs candidate counts (host/srflx/relay), gathering time, and the reason ready was fired. Makes it trivial to spot ICE issues in user diagnostic exports.' },
    ],
  },
  {
    version: '0.10.115',
    date: 'June 9, 2026',
    highlight: 'CANARY: webhook attribution now identifies users by Telnyx connection_id (handles Call Control voicemail migration correctly)',
    changes: [
      { type: 'improved', text: 'Webhook user attribution now uses Telnyx connection_id as the PRIMARY signal for figuring out which user an incoming call/SMS/voicemail belongs to. The old approach (sip_username + to-number matching) had edge cases where the wrong user got attributed, especially when the webhook fired for the SIP-delivery leg vs the PSTN leg of the same call. connection_id is set by Telnyx routing config, doesn\'t vary between legs, and uniquely identifies the user.' },
      { type: 'improved', text: 'Handles two important edge cases for migrated users: (1) When connection_id is the SHARED Voicemail Call Control App ID (TELNYX_VOICEMAIL_CC_APP_ID) or PILOT_SIP_CONNECTION_ID, the lookup is skipped because it would match multiple users arbitrarily. (2) The lookup checks BOTH UserDid.connectionId AND UserDid.preMigrationConnectionId, since migrated users\' SIP-delivery-leg events still fire with their original personal connection ID.' },
      { type: 'fixed', text: 'CANARY release - distributed manually to selected testers before broad rollout. If issues are found, rollback is just "don\'t publish" - existing users on prior versions are unaffected because this release is a GitHub draft.' },
    ],
  },
  {
    version: '0.10.114',
    date: 'June 9, 2026',
    highlight: 'Hotfix: Admin > Users page was throwing a 500 (broken Prisma relation reference in the Version column code)',
    changes: [
      { type: 'fixed', text: 'Hotfix: Admin > Users page returned HTTP 500 with a Prisma validation error because the Version column code (added in v0.10.111-112) referenced the wrong Prisma relation field name (userDevices instead of devices). All admins saw "Admin access required" even with valid admin privileges. Fixed the field name; the page works correctly now and shows each user\'s dialer version as designed.' },
    ],
  },
  {
    version: '0.10.113',
    date: 'June 9, 2026',
    highlight: 'CRITICAL: fixes Telnyx \'not_found\' inbound routing bug where calls went directly to voicemail despite the dialer being registered',
    changes: [
      { type: 'fixed', text: 'CRITICAL: many users were receiving inbound calls directly to voicemail without their dialer ringing - even though their dialer showed Registered (green) and OUTBOUND calls worked fine. Root cause: Telnyx\'s internal Contact-to-WebSocket routing was going stale over time. Their server thought our SIP credential was unreachable and routed inbound INVITEs to Hosted Voicemail without delivery. Standard REGISTER refreshes did NOT clear this state. Fix: the dialer now tears down its entire JsSIP connection + WebSocket every 60 seconds and rebuilds from scratch (skipped during active calls). This forces Telnyx to refresh its inbound routing table, capping the failure window at 60 seconds instead of "until the user restarts." Trade-off: ~2-5 seconds of disconnected state per cycle; incoming calls in that brief window still fail, but the overall reliability improves dramatically.' },
    ],
  },
  {
    version: '0.10.112',
    date: 'June 9, 2026',
    highlight: 'Admin can now see what dialer version each user is on',
    changes: [
      { type: 'new', text: 'Settings > Users now has a Version column showing what dialer version each user is currently on (derived from their most-recent device heartbeat). Sortable - click the column header to find everyone on older versions. If a user has multiple devices on different versions, a yellow "+N" badge highlights the mismatch. Hover the version to see when the user was last seen.' },
    ],
  },
  {
    version: '0.10.111',
    date: 'June 9, 2026',
    highlight: 'Auto-update finally reaches users (was sitting as draft releases on GitHub) + re-release of all v0.10.110 fixes',
    changes: [
      { type: 'fixed', text: 'Auto-update fix: previous v0.10.110 builds were being published as GitHub draft releases, which Electron\'s auto-updater cannot detect. Users on older versions never saw the update prompt. Changed releaseType from "draft" to "release" so every future build is immediately visible to the auto-updater. If you\'re seeing this what\'s-new screen, auto-update is working again - thank you for restarting.' },
      { type: 'improved', text: 'This release also includes all the v0.10.110 fixes: critical silent-eviction fix (calls-going-to-voicemail-during-inactivity), voicemail migration tag field, Telnyx connection naming via email, and helper text on user creation forms. See v0.10.110 entry below for details.' },
    ],
  },
  {
    version: '0.10.110',
    date: 'June 8, 2026',
    highlight: 'CRITICAL: fixes calls-going-straight-to-voicemail-during-inactivity bug + voicemail migration safer + Telnyx connection naming uses email',
    changes: [
      { type: 'fixed', text: 'CRITICAL: callers were hitting voicemail directly when a user had been inactive (lunch break, overnight, dialer minimized to tray). Root cause: Telnyx was "silently evicting" the user\'s SIP registration during long idle periods even though the dialer UI still showed "Registered" green - so inbound calls had nowhere to ring and fell straight to voicemail. Fixes: (1) WebSocket keepalive tightened from 25s to 15s, (2) defensive SIP REGISTER refresh tightened from 30s to 15s, (3) registration lease shortened from 10min to 2min so JsSIP\'s internal refresh also runs more often, (4) Electron powerSaveBlocker now prevents the OS from suspending the dialer process during inactivity (Windows/Mac power management used to pause timers despite our backgroundThrottling:false setting).' },
      { type: 'new', text: 'Voicemail migration modal now has a Telnyx tag field. Pre-filled with the user\'s name, the value gets stamped onto the DID as a Telnyx tag during migration so admins can identify whose number it is in the Telnyx Numbers panel after the DID moves off the user\'s Credential Connection.' },
      { type: 'improved', text: 'Voicemail migration modal now shows an upfront warning explaining what happens to the DID and Credential Connection during migration. Includes a do-not-disable note for the Credential Connection (it\'s still needed for SIP registration even after the DID moves elsewhere).' },
      { type: 'improved', text: 'Telnyx Credential Connection naming now uses the user\'s email (sanitized) instead of just first-name+random-suffix. Two users named Rahul used to produce near-identical connection names; now they\'re each clearly identifiable (e.g. rahul-aptask-com vs rahul-kumar-aptask-com). Existing connections unchanged - this only affects newly-provisioned users.' },
    ],
  },
  {
    version: '0.10.109',
    date: 'June 8, 2026',
    highlight: 'CRITICAL fix: every user can now see their own calls, voicemails, and SMS history (was being attributed to admin)',
    changes: [
      { type: 'fixed', text: 'CRITICAL ATTRIBUTION FIX: every call, voicemail, and SMS in the system was being stamped to user #1 (the admin) because the webhook resolver fell back to PILOT_USER_ID when it could not figure out who a call was for. This meant non-admin users could not see any of their own call history, and the admin got Teams notifications for everyone else\'s missed calls. Fix: the resolver now (1) matches toNumber against User.sipUsername for SIP-delivery legs, (2) treats the dialed DID as authoritative for inbound attribution, (3) refuses to attribute when ownership cannot be determined (skips row creation rather than dumping on user 1). Existing mis-attributed history is repairable via a new admin endpoint - run it once after deploy.' },
      { type: 'fixed', text: 'Recents tab no longer shows SIP-delivery-leg infrastructure rows where toNumber was a credential username like "acesoheb1497ph". Those are internal server events, not real phone calls placed or received by anyone.' },
    ],
  },
  {
    version: '0.10.108',
    date: 'June 8, 2026',
    highlight: 'Recents direction filter, cleaner Keypad, Admin shows all DIDs, and far more accurate missed-call labels',
    changes: [
      { type: 'new', text: 'Recents tab now has a direction filter at the top: All / Inbound / Outgoing / Missed. Tap a chip to narrow the list. Your choice is remembered across app restarts.' },
      { type: 'new', text: 'Smarter unanswered-call labels in Recents. Previously every unanswered inbound call just said "Missed." Now you can tell at a glance what actually happened: "Missed" (rang full timeout, you missed it - red), "Caller canceled" (caller hung up before you could pick up - orange), "Busy" (line was busy / your dialer was on another call - orange), "Declined" (you actively rejected - red), "Forwarded" (call took another path - gray). Existing call history relabels automatically.' },
      { type: 'improved', text: 'Admin > Users table now shows every DID a user has (with a "default" badge on the primary line) instead of just showing the default DID with a "+N" badge. No more guessing what numbers are assigned without opening Manage Lines.' },
      { type: 'improved', text: 'Keypad page is cleaner: removed the inline Recent quick-pick panel (Contacts icon next to the Call button). The Recents tab in the bottom nav now has the dedicated direction filter and is the single place for recent calls.' },
      { type: 'improved', text: 'Direction filter "Inbound" chip is now mutually exclusive with "Missed" - tapping Inbound shows only calls you actually answered, not unanswered ones.' },
    ],
  },
  {
    version: '0.10.107',
    date: 'June 8, 2026',
    highlight: 'Critical fix: Add-a-Line no longer leaves orphan purchased numbers in Telnyx when assignment fails',
    changes: [
      { type: 'fixed', text: 'When adding a new DID via Settings > Admin > Users > Manage lines > Add a line, the flow searches Telnyx, purchases a number, and assigns it to the user. Previously: if the assign step failed (transient Telnyx error, invalid connection ID, etc.), the just-purchased number stayed in the Telnyx account billing the tenant. Admins seeing the "Failed to assign" error retried and accidentally bought multiple numbers. Now: on assign failure post-purchase, the endpoint immediately calls Telnyx to release the number back to the pool (no billing impact). The error message tells the admin exactly what happened.' },
      { type: 'fixed', text: 'Added a pre-purchase sanity check that validates the user has a SIP connection ID BEFORE running the billable Telnyx purchase. Catches the most common "Failed to assign" cause (no connection ID on the user row) without spending any money.' },
    ],
  },
  {
    version: '0.10.106',
    date: 'June 8, 2026',
    highlight: 'Race-condition fix: very short calls (caller rejected in <100ms) now correctly classify as missed instead of stuck at "initiated"',
    changes: [
      { type: 'fixed', text: 'When a caller hung up or was rejected within milliseconds of dialing (e.g., Telnyx-side SIP rejection because of momentary registration flap), the call.initiated and call.hangup webhook events arrived back-to-back. The call.initiated handler\'s upsert UPDATE branch was unconditionally setting status=\'initiated\', which overwrote the call.hangup\'s correctly-classified status (\'missed\' / \'rejected\'). Now call.initiated\'s UPDATE branch leaves status alone — only the call.hangup classifier sets the final state.' },
    ],
  },
  {
    version: '0.10.105',
    date: 'June 8, 2026',
    highlight: 'Voicemails now actually mark as listened when you play them (real fix this time)',
    changes: [
      { type: 'fixed', text: 'When you played a voicemail, the unread badge on the Voicemail tab stayed at the same count even though the row visually appeared collapsed. Root cause: the client was sending the wrong JSON shape to the server (listenedAt timestamp instead of a listened boolean), so the server silently ignored the update. The mark-as-listened call now sends the shape the server expects.' },
    ],
  },
  {
    version: '0.10.104',
    date: 'June 8, 2026',
    highlight: 'Missed calls now show as missed (not just incoming) + voicemails mark as listened the moment audio plays',
    changes: [
      { type: 'fixed', text: 'When a caller hung up before you could pick up (or before voicemail kicked in), the call was showing in your Recents tab as a regular incoming call with no red missed indicator. Now any inbound call that ended without being answered shows correctly as missed, matching what your Teams notification already said.' },
      { type: 'fixed', text: 'Playing a voicemail (via the inline play button or the audio controls) now marks it as listened the moment audio actually starts, so the blue unread dot disappears even if the row-expand mark-as-listened didn\'t stick due to a network race.' },
    ],
  },
  {
    version: '0.10.103',
    date: 'June 8, 2026',
    highlight: 'Telnyx outage detector \u2014 a banner appears across the top of your dialer when Telnyx is having problems',
    changes: [
      { type: 'new', text: 'A colored strip appears across the top of the dialer whenever Telnyx (our voice provider) reports a degraded service or scheduled maintenance. Amber for minor issues, red for major outages. Click "Details" to open status.telnyx.com directly. The banner polls every 60 seconds and auto-hides when service is back to normal.' },
      { type: 'new', text: 'Admins get a Microsoft Teams notification card the moment Telnyx flips into outage status \u2014 and another card when service recovers. No more wondering "is it just me?" when calls misbehave.' },
      { type: 'fixed', text: 'The floating "Did you know?" tip in the bottom-right corner no longer covers the Voicemail tab. Moved up so both are clickable.' },
      { type: 'improved', text: 'The v0.10.102 build was published with the new app icon but missed the Telnyx detector code; v0.10.103 ships everything together. If you saw the new icon but no banner during yesterday\'s Telnyx maintenance window, that\'s why.' },
    ],
  },
  {
    version: '0.10.102',
    date: 'June 6, 2026',
    highlight: 'New app icon \u2014 modern keypad design replacing the default Electron logo',
    changes: [
      { type: 'improved', text: 'ACE Dialer now ships with a custom app icon (dark slate background, keypad grid with phone button accent). Replaces the default Electron logo on your desktop, taskbar, dock, and installer. Auto-applies on next launch after you install v0.10.102.' },
    ],
  },
  {
    version: '0.10.101',
    date: 'June 5, 2026',
    highlight: 'Admin can now see what version each user is on \u2014 and request a force-update on a specific device',
    changes: [
      { type: 'new', text: 'Settings \u2192 Admin \u2192 Users \u2192 kebab menu \u2192 "Devices" \u2014 shows every device each user has signed in from, with platform, app version, last-seen time, and a per-device "Force update" button. The dialer reports its version to the server every minute (plus on focus + login) via a new /me/heartbeat endpoint.' },
      { type: 'new', text: 'Force update flow: click the button on a specific device, and within ~60 seconds that device runs autoUpdater.checkForUpdatesAndNotify() and prompts the user to download + restart. Useful when you ship a critical fix and want a specific user updated immediately instead of waiting for the auto-update poll cycle.' },
      { type: 'improved', text: 'Schema future-proofed for Android / iOS clients. The UserDevice table accepts any platform string \u2014 future native clients just need to POST to /me/heartbeat with their own deviceId + appVersion to start appearing in the admin Devices list.' },
    ],
  },
  {
    version: '0.10.100',
    date: 'June 5, 2026',
    highlight: 'Voicemail v2 — softphone rings first, then your custom greeting picks up. Separate messages for busy vs not-available. Record straight from your mic.',
    changes: [
      { type: 'new', text: 'Voicemail flow rewritten end-to-end. Inbound calls now ring your softphone for about 25 seconds first; if you don\'t pick up, the call falls through to your custom greeting and the caller can leave a message — exactly like every modern enterprise dialer. No more Telnyx default robotic greeting.' },
      { type: 'new', text: 'TWO greetings per user — Settings → Calling → Voicemail greeting now has separate sections for "When you don\'t pick up" and "When you\'re on another call." The right one plays automatically based on what your softphone was doing when the caller hit your line. If you only configure the no-answer one, we use it for both states (no awkward silence ever).' },
      { type: 'new', text: 'Record your greeting from your microphone, in-app. Settings → Voicemail greeting → Audio tab now has a big red "Record from microphone" button. 30-second cap, preview before saving, no file conversion needed. Click record, talk, save — done.' },
      { type: 'new', text: 'Admin: Settings → Admin → Users → kebab menu → "Voicemail migration" — per-user button that switches a user\'s DIDs from the legacy SIP / Hosted Voicemail routing to the new Call Control flow. Shows per-DID status, runs the Telnyx PATCH calls, and stores a rollback snapshot so you can revert any user in one click.' },
      { type: 'improved', text: 'Settings → "What\'s new" is now in its own "About" section at the very bottom of the sidebar (for both admins and users). Was buried in Personal before; now it\'s always one scroll away regardless of which settings page you\'re on.' },
      { type: 'fixed', text: 'Silenced a harmless "[vm-cc] action failed" log line that appeared when a caller hung up immediately after hearing the greeting (before the beep). It\'s just normal caller behavior — not a system problem — and now logs as a debug-level "action skipped" instead.' },
    ],
  },
  {
    version: '0.10.99',
    date: 'June 5, 2026',
    highlight: 'Personal voicemail greeting — type it OR record it, in your own voice',
    changes: [
      { type: 'new', text: 'Settings → Calling → Voicemail greeting is now a three-tab control. Pick "Default" for the stock "You\'ve reached <your name>\'s voicemail" message; pick "Text-to-speech" to type up to 500 characters that Telnyx will read aloud in a natural voice; or pick "Audio upload" to upload your own MP3, WAV, M4A, AAC, or OGG recording (up to 2 MB). Text and audio are stored independently, so you can switch between them without losing what you set up before.' },
      { type: 'improved', text: 'Behind the scenes: we replaced Telnyx Hosted Voicemail (which only supported a single robotic default greeting) with our own Call Control voicemail handler. This gives us full control over what callers hear before the beep, what gets recorded, and how voicemails flow into your inbox. The new flow is wired and tested for individual users. Admin Telnyx-side per-DID cutover ships in v0.10.100 — until then, callers continue to hear the legacy hosted voicemail message regardless of what you save here. We\'ll let you know once it goes live.' },
    ],
  },
  {
    version: '0.10.98',
    date: 'June 5, 2026',
    highlight: 'Decline a call once and it stays declined — no more ring-back loop',
    changes: [
      { type: 'fixed', text: 'Pressing Decline on an inbound call no longer makes the same call ring back 3-4 times in a row. The dialer used to send "486 Busy Here" when you declined — SIP proxies interpret that as "this device is busy, retry," and Telnyx would re-INVITE the call within seconds. We now send "603 Decline" instead, which means "user said no, end of story." The call disappears for good after one tap.' },
      { type: 'improved', text: 'Renamed the "Reply" button on the incoming-call screen to "Reply with Text" — clearer that it declines the call and opens a text compose, not some kind of mid-call reply.' },
    ],
  },
  {
    version: '0.10.97',
    date: 'June 5, 2026',
    highlight: 'Custom voicemail greeting — upload your own audio (admin testing)',
    changes: [
      { type: 'new', text: 'Settings → Calling → Voicemail greeting now lets you upload a personal audio file (MP3, WAV, M4A, AAC, or OGG, up to 2 MB). Callers hear your greeting before leaving a message instead of Telnyx\'s default. After uploading, call your DID from another phone and don\'t pick up — your greeting should play after the ring-out. If you hear the default Telnyx greeting instead, let your admin know.' },
    ],
  },
  {
    version: '0.10.96',
    date: 'June 5, 2026',
    highlight: 'New releases go through admin review before reaching the team',
    changes: [
      { type: 'improved', text: 'Behind the scenes: future ACE Dialer updates now land as drafts on GitHub Releases first. Admins test each update before publishing it to the rest of the team. Once an admin approves, the dialer auto-updates everyone within 1-2 hours like before. No action needed on your end — you\'ll only see updates that have been verified to work.' },
    ],
  },
  {
    version: '0.10.95',
    date: 'June 5, 2026',
    highlight: 'Broadcast composer — properly tailored fields per category, no more "who\'s being celebrated" on announcements',
    changes: [
      { type: 'fixed', text: 'The Broadcast composer was carrying praise-era assumptions into the new categories. Fixed: the "Display name (who\'s being celebrated)" field now only appears for Celebrations and Welcomes (categories where a specific person is being recognized). For Announcements, Alerts, and Reminders the field is hidden entirely — they\'re general communications, no person to name. Send button label is now category-aware (Send announcement / Send alert / Send reminder / Send welcome / Send praise) and the "Recent praise sent" history is now labeled "Recent broadcasts sent."' },
      { type: 'fixed', text: 'Recipient name no longer leaks into the headline of announcement-style broadcasts. The recipient modal renders "Service notice" instead of "Service notice Loretta" when the category isn\'t a Celebration or Welcome — and the admin form no longer auto-fills the field at all for those category types.' },
    ],
  },
  {
    version: '0.10.94',
    date: 'June 5, 2026',
    highlight: 'One-click Call / SMS a user from the Admin Users table',
    changes: [
      { type: 'new', text: 'Settings → Admin → Users now shows a green phone icon and blue chat icon next to every active user (except yourself). Click the phone to open your dialpad with their number pre-filled, click chat to open Messages ready to text them. Skips users with no DID assigned.' },
    ],
  },
  {
    version: '0.10.93',
    date: 'June 5, 2026',
    highlight: 'Send praise expanded into a full Broadcast system — 15 categories across 5 type groups',
    changes: [
      { type: 'new', text: 'Settings → Admin → "Send praise" is now Settings → Admin → "Broadcast." Same flow, same recipient experience, but the category dropdown now includes 15 options across 5 groups: Celebrations (new hire, new offer, birthday, anniversary, custom), Announcements (general, update required, maintenance, holiday, policy update), Alerts (urgent, service outage), Reminders (general, training), and Welcomes. Each category has its own icon, default headline, and color treatment in the recipient modal. Urgent alerts get a red ring around the modal for extra attention.' },
      { type: 'new', text: 'Use cases the Broadcast system now covers: "please update to the latest version," "maintenance window 9–10 PM tonight," "Memorial Day office closure," "new SOP — please review," "Telnyx service degradation in effect," "training session at 3 PM," "happy Diwali," "welcome our new colleague," and the existing recruitment celebrations.' },
      { type: 'improved', text: 'Live preview pane on the Broadcast composer now reflects the selected category\'s default headline correctly. The recipient name is only auto-appended to the headline for Celebrations (it would read awkwardly on an announcement like "Service notice Loretta").' },
    ],
  },
  {
    version: '0.10.92',
    date: 'June 5, 2026',
    highlight: 'Floating Did-You-Know tips + Message quality on the Quality & Health page',
    changes: [
      { type: 'new', text: 'A floating "Did you know?" tip appears on every screen of the dialer. Each tip stays visible for at least 10 seconds, then auto-rotates to the next one. We ship with 20 curated tips covering scheduling SMS, blocking numbers, voicemail transcripts, hold music, diagnostics, microphone selection, and more. Dismiss the X to hide for the session; click the chevron to skip ahead. Tips are suppressed during active calls.' },
      { type: 'new', text: 'Admin → Feature tips section lets you toggle built-in tips on/off and author your own custom tips with title, body, and an emoji icon. Custom tips can be marked Admin-only so they don\'t appear to regular users.' },
      { type: 'new', text: 'Quality & Health report now includes Message metrics alongside the existing call metrics. See outbound delivery rate, sent/delivered/failed/undelivered counts, and click into any failure cause to see the exact recipient numbers + timestamps. Common Telnyx error codes are now annotated with human-readable explanations.' },
    ],
  },
  {
    version: '0.10.91',
    date: 'June 5, 2026',
    highlight: 'Cleanup + UX polish — fewer settings entries, sortable users, all times in EST',
    changes: [
      { type: 'fixed', text: 'All timestamps across the dialer (Recents, Messages, Voicemail, Audit Log, Health Alerts, Praise) now display in Eastern Time regardless of your computer\'s timezone. Previously, India-based teammates saw times in IST and US-based teammates saw EST, making it confusing to compare timestamps when discussing incidents. Now everyone agrees on "what time it happened" — EST is the source of truth.' },
      { type: 'fixed', text: 'Garbled emoji and middle-dot characters in the Live Ops health alerts page (and a few other places). Was a UTF-8 encoding bug in the source file that produced things like "Â·" instead of "·" and "ðŸŽ‰" instead of "🎉". Now displays correctly.' },
      { type: 'improved', text: 'Settings → Personal → Notifications is now a single entry with Email and Teams as sub-tabs (instead of two separate sidebar entries). The in-app sound + desktop popup settings moved to a renamed "Sound & alerts" entry so the difference is clear.' },
      { type: 'improved', text: 'Sortable Users table in Admin. Click any column header (User, Email, Role, Status, DID, Last sign-in) to sort by it; click again to reverse direction. Default ordering is unchanged (newest users first).' },
      { type: 'fixed', text: 'Removed the obsolete "Telnyx" SIP credentials entry from Settings → Calling. That form was a leftover from the early manual-setup days; today all users get auto-provisioned credentials via the admin invite / migrate flows. Nobody should have been typing in there anyway.' },
    ],
  },
  {
    version: '0.10.90',
    date: 'June 4, 2026',
    highlight: 'Active WebSocket keepalive — detects dead connections in seconds (per Telnyx recommendation)',
    changes: [
      { type: 'fixed', text: 'The dialer now sends a small "are you there?" ping to Telnyx over its WebSocket connection every 25 seconds. If Telnyx doesn\'t respond for multiple pings in a row, we know the underlying network connection is dead even though it looks healthy — and we trigger an automatic reconnect right away. Previously, a dead-but-looks-alive connection could go undetected for minutes, during which inbound calls would silently fall to voicemail. This was specifically recommended by Telnyx Support after their review of our service issues.' },
    ],
  },
  {
    version: '0.10.89',
    date: 'June 4, 2026',
    highlight: 'Praise headlines are now fully editable with a live preview',
    changes: [
      { type: 'improved', text: 'When sending praise, admin can now write a custom headline (the big bold text) — not just the message body. The old hardcoded "Welcome aboard [name]" headline didn\'t fit every use case; for example praising a recruiter for landing a placement should say "Great work, Abdulla!" not "Welcome aboard Abdulla." A new Headline field is in the form; leave it blank to use the category default.' },
      { type: 'new', text: 'Live preview pane in the praise composer. As you type the headline / recipient name / message, a real-time preview shows exactly what the recipient will see when their dialer pops the praise modal. Edit until it reads right, then send — no more "I should have worded that differently" after the fact.' },
    ],
  },
  {
    version: '0.10.88',
    date: 'June 4, 2026',
    highlight: 'Fixes the "shows Disconnected but calls still ring through" bug',
    changes: [
      { type: 'fixed', text: 'Dialer no longer falsely shows Disconnected after a transient Telnyx REGISTER hiccup. When Telnyx returned a one-time 503 on a REGISTER refresh and the dialer reconnected within ~3 seconds, an OLD smoothing timer from the pre-reconnect closure was firing 30 seconds later and lying to the UI that we were still disconnected — even though the new SIP session was healthy and calls were ringing through normally. Users would see a red Disconnected pill, panic, restart their dialer unnecessarily. Now every reconnect bumps a generation counter and stale timers from the previous session no-op when they fire.' },
      { type: 'improved', text: 'Diagnostics log export filename and header now stamp the correct app version. Previously it was frozen at 0.10.80 — making it look like users were on an old build even when they had the latest installed.' },
    ],
  },
  {
    version: '0.10.87',
    date: 'June 4, 2026',
    highlight: 'Anchorsite goes manual; noise suppression gets its own isolated PATCH',
    changes: [
      { type: 'fixed', text: 'No more "apply ACE connection defaults — non-fatal warning" red X on migrations. The dialer no longer tries to PATCH anchorsite_override programmatically — instead admin sets AnchorSite manually on the master template in Telnyx Mission Control, and new users inherit whatever the template has. Previous attempts ("Chennai" / "Chennai, India" / "Latency" / "latency" / "Latency Routing") all got Telnyx 10015 rejections because Telnyx\'s accepted enum strings vary across connection types in ways we can\'t reliably guess from outside. The GUI dropdown is now the source of truth.' },
      { type: 'improved', text: 'Noise Suppression now gets its own isolated PATCH right after the connection is created — separate from the template clone\'s large bulk PATCH. The function re-fetches the master template at migration time, reads template.noise_suppression (currently "Both Inbound and Outbound" + Krisp Viva Tel Lite), and PATCHes that exact block onto the new user\'s connection. Belt-and-suspenders against Telnyx silently dropping noise_suppression from the bigger template-clone payload. Migration step list shows "apply ACE connection defaults (noise suppression copied from master template)".' },
      { type: 'improved', text: 'The /admin/backfill-anchorsites endpoint now backfills NOISE SUPPRESSION (not anchorsite) for every existing user — it re-runs applyAceConnectionDefaults which now does the noise PATCH instead. After this deploys, run the backfill once via the browser console to ensure every existing user gets the master template\'s noise suppression config applied to their Telnyx connection. The endpoint name is historical; the function it calls now does the right thing.' },
    ],
  },
  {
    version: '0.10.86',
    date: 'June 4, 2026',
    highlight: 'Telnyx template inheritance fixed + zero-SQL re-migrations',
    changes: [
      { type: 'fixed', text: 'New user connections now inherit EVERY setting from the ACE Master Template at Telnyx — including Enable Instant Ringback (inbound + outbound), Enable Simultaneous Ringing, Noise Suppression (Both Inbound and Outbound + Krisp engine), Jitter Buffer settings, and any other setting Telnyx surfaces. Previously we were whitelisting specific field names which silently dropped anything not in our list. After deploy, any newly migrated/invited user gets the template configuration exactly. Existing users still need the /admin/backfill-anchorsites endpoint to pick up newer template changes.' },
      { type: 'improved', text: 'When admin re-migrates a user from Pulse who was previously migrated and then deleted, their historical messages, calls, and voicemails now AUTOMATICALLY get reattached to the new user. No more "user has 0 history visible" + manual SQL UPDATE to recover. The migration step list shows "inherit orphan history from prior tombstoned user(s) X: N messages, M calls, P voicemails" when it triggers.' },
      { type: 'new', text: 'Admin diagnostic endpoint GET /admin/telnyx-template-debug returns the master template\'s current Telnyx JSON. Useful for verifying which settings are actually being surfaced by Telnyx\'s API when a Mission Control toggle isn\'t taking effect on new users. Hit it from the browser console while signed in as admin.' },
    ],
  },
  {
    version: '0.10.85',
    date: 'June 4, 2026',
    highlight: 'Telnyx routing optimization is finally configured correctly',
    changes: [
      { type: 'fixed', text: 'Every new user since v0.10.64 will now have Telnyx anchorsite routing set to "latency" mode — Telnyx auto-picks the lowest-latency Point of Presence per call based on real-time ping measurements. Prior attempts used wrong values ("Chennai" / "Chennai, India" / "Latency Routing") that Telnyx silently rejected. The user-visible "non-fatal warning" red X on migrations is gone for good. Run the existing /admin/backfill-anchorsites endpoint to apply the fix to all existing users.' },
      { type: 'fixed', text: 'When admin soft-deletes a user (because their call/SMS history blocks hard-delete), the user\'s phone numbers now get released automatically. Previously the DIDs stayed bound to the tombstoned user, blocking future migrations targeting the same number — required manual SQL cleanup every time (Farheen, Roshni, Shreya). Solved at the source.' },
    ],
  },
  {
    version: '0.10.84',
    date: 'June 4, 2026',
    highlight: 'Final fix for the recurring Pulse-migration paper-cuts',
    changes: [
      { type: 'fixed', text: 'Migrations no longer show the red X "apply ACE connection defaults — non-fatal warning" line. Telnyx kept rejecting our anchorsite_override values with error 10015 because we never had the exact accepted enum strings. We now skip the override entirely; new users inherit the master template\'s anchorsite (already a known-working config), which is what India and US users have effectively been using all along. Per-country routing optimization will come back in a future release once we confirm the right Telnyx strings.' },
      { type: 'fixed', text: 'When admin deletes a user whose history can\'t be hard-deleted (calls/SMS/voicemails block the FK), the soft-delete now also releases the user\'s phone numbers. Pre-v0.10.84, the user got tombstoned but their DID stayed reserved — blocking any future Pulse migration that targeted the same number. This was the Roshni/Farheen/Shreya pattern requiring manual SQL cleanup. Now it just works.' },
    ],
  },
  {
    version: '0.10.83',
    date: 'June 4, 2026',
    highlight: 'Mac auto-update is finally fixed — no more "Update failed, ZIP file not provided"',
    changes: [
      { type: 'fixed', text: 'Every Mac release since launch has thrown "Update failed: ZIP file not provided" when the dialer tried to install an in-place update — because our build config only produced a .dmg (for first-time installs) and not a .zip (which electron-updater needs to do the swap). Now we ship both. After you manually install this build once via the .dmg, future updates will apply automatically without the popup. Windows users were never affected — only Macs.' },
    ],
  },
  {
    version: '0.10.82',
    date: 'June 4, 2026',
    highlight: 'Mac users no longer need to double-click to accept incoming calls',
    changes: [
      { type: 'fixed', text: 'On macOS, accepting an incoming call from the floating ringer used to require two clicks — the first one only focused the window, the second actually accepted. Now a single click works, matching Windows behavior. Same fix applied to the main dialer window when interacting with it after switching from another app.' },
      { type: 'improved', text: 'When migrate-from-Pulse fails with "DID already in ACE," the modal now shows WHO already owns that DID (name, email, active/deactivated state) with a tailored next-step recommendation — so admin doesn\'t have to look up the conflicting user separately. If the conflicting user has the same email as the migration target, the modal explicitly says "this is a prior failed attempt — delete that user and retry."' },
    ],
  },
  {
    version: '0.10.81',
    date: 'June 4, 2026',
    highlight: 'Migration robustness — debug panel for failed Pulse migrations + Telnyx anchorsite fix',
    changes: [
      { type: 'fixed', text: 'Telnyx anchorsite_override values were being rejected on every migration since v0.10.64 — we were sending "Chennai" and "Latency" instead of the proper "Chennai, India" and "Latency Routing". Showed up as the red "X apply ACE connection defaults — non-fatal warning" line in the migrate modal. For US users this was invisible (template default kicked in); for India users it meant calls weren\'t being anchor-routed through Chennai, hurting latency. Fixed going forward, and a separate one-time backfill endpoint reapplies the correct anchorsite to all existing users.' },
      { type: 'new', text: 'Migration debug panel. When the migrate-from-Pulse modal fails with "Telnyx doesn\'t recognize this DID," it now scans the Pulse JWT for OTHER phone-shaped fields (mobile_no, caller_phone_number) and checks each one\'s Telnyx ownership. Shows admin "this OTHER number from Pulse IS owned by us — try that instead" instead of forcing a SQL spelunk. Saves several minutes per misconfigured migration (Roshni / Shreya pattern).' },
    ],
  },
  {
    version: '0.10.80',
    date: 'June 4, 2026',
    highlight: 'Fixes a major silent miss-call bug — stale "ghost" sessions at Telnyx',
    changes: [
      { type: 'fixed', text: 'Inbound calls going straight to voicemail even though the dialer looked online — root cause was old, abandoned SIP sessions accumulating at Telnyx every time you reload or restart the app. Telnyx was trying to ring every old session before getting to the live one, so calls stalled. The dialer now wipes those ghost sessions at startup and registers fresh. After this deploys, restart your dialer once and inbound routing should be reliable from there on. (If you have ACE open on multiple devices for the same account, only the most recently-opened one will ring — same model as Pulse.)' },
      { type: 'fixed', text: 'Email notification buttons ("Reply in ACE Dialer", "Call back in ACE Dialer") were opening the web app instead of your installed desktop app. They now use the same ace-dialer:// protocol that Teams cards use, so they open Electron directly with the caller / sender prefilled. Web is still the fallback when no desktop app is installed.' },
      { type: 'new', text: 'Diagnostics section under Settings → Personal. If your dialer ever does something weird — missed call, stuck status, disconnects — click "Download logs" and email the .txt file to your admin so we can pinpoint exactly what happened on your machine. Way easier than asking you to open developer tools.' },
      { type: 'improved', text: 'SIP REGISTER responses now log the full Contact header from Telnyx and the count of active bindings, so when something IS wrong with routing we can spot it in the diagnostics export instantly instead of guessing.' },
    ],
  },
  {
    version: '0.10.79',
    date: 'June 4, 2026',
    highlight: 'Email notifications — opt in per event, never miss a call again',
    changes: [
      { type: 'new', text: 'You can now get an email whenever you have a missed call, a new text, or a new voicemail. Go to Settings → Email notifications and choose which events you want. Off by default — turn on only what you want. Voicemail emails include the full transcript so you can read it without opening the app. Note: emails are notifications only — replying to one doesn\'t reply to the caller / texter. Use the dialer for that.' },
      { type: 'new', text: 'A "Send test email" button on the same Settings screen sends a sample notification to your own inbox so you can confirm it lands (and isn\'t filtered to spam) before relying on it for real events.' },
    ],
  },
  {
    version: '0.10.78',
    date: 'June 4, 2026',
    highlight: 'Tighter NAT keepalive — fixes the "hard-refresh after 5-10 min idle" pattern',
    changes: [
      { type: 'fixed', text: 'Users no longer need to hard-refresh ACE after a few minutes of inactivity to start receiving calls again. Root cause was NAT timeout: routers and corporate firewalls silently drop idle TCP connections after 5-10 minutes (some aggressive ones at 60s). Tightened v0.10.77\'s force-REGISTER cadence from 60 seconds to 30 seconds so the SIP traffic itself keeps the NAT mapping warm. After this deploys + you restart your dialer once, sustained idle should no longer break inbound call routing.' },
    ],
  },
  {
    version: '0.10.77',
    date: 'June 4, 2026',
    highlight: 'Closes the silent-eviction gap — proactive REGISTER refresh every 60s',
    changes: [
      { type: 'fixed', text: 'Inbound calls dropping to voicemail when the dialer THOUGHT it was registered. The 10-second heartbeat only re-registers when our local state says we\'re not registered — but Telnyx silent eviction doesn\'t flip that bit (JsSIP isn\'t notified when Telnyx kicks us off), so the heartbeat never refreshed. Added an independent 60-second timer that unconditionally calls register() regardless of local state. Telnyx now sees a fresh REGISTER from us at most 60 seconds after any silent eviction, recovering the routing before the next inbound call can miss. Skipped while a call is in progress to avoid interfering with the active SIP dialog.' },
    ],
  },
  {
    version: '0.10.76',
    date: 'June 3, 2026',
    highlight: 'Admin can upload custom ringtones — replaces the built-in beeps',
    changes: [
      { type: 'new', text: 'Settings → Admin → Ringtones lets admin upload audio files (MP3 / WAV) for the whole tenant. Each ringtone gets a name. Every user sees the full library in Settings → Personal → Ringtone above the built-in synthesized options. Pick "Office" or "Phone Booth" or whatever you upload — sounds far better than the built-in beeps.' },
      { type: 'new', text: 'Admin can rename, hide (soft-delete), or fully delete uploads. Hiding keeps the audio in the DB but removes from user picker; useful for seasonal ringtones. Hard delete removes entirely; anyone currently using that ringtone falls back to the default.' },
      { type: 'improved', text: 'Cap: 400KB per audio file (covers a 5-10 second MP3 at typical bitrate). Audio is stored as base64 in Postgres — same pattern as Hold Music. Every user warms the local cache at login so an incoming call plays the right uploaded sound instantly, no network round-trip.' },
    ],
  },
  {
    version: '0.10.75',
    date: 'June 3, 2026',
    highlight: 'Pick your own ringtone',
    changes: [
      { type: 'new', text: 'Settings → Personal → Ringtone lets you pick which sound plays when someone calls. Four options: Classic (standard North American ring), Modern (brighter + faster), Chime (single soft swell — least intrusive), Pulse (low + fast — for noisy environments). Each option has a Play button so you can preview before saving — no commitments to a sound you\'ve never heard.' },
      { type: 'improved', text: 'Your ringtone choice follows your account across devices. Sign in on a different machine and you get the same ring. All ringtones are synthesized in-browser (no audio files to download) so the dialer bundle stays tiny.' },
    ],
  },
  {
    version: '0.10.74',
    date: 'June 3, 2026',
    highlight: 'Send Praise — celebrate new hires, offers, birthdays from inside ACE',
    changes: [
      { type: 'new', text: 'Admins can now send a Teams-Praise-style celebratory pop-up to one user or broadcast to everyone. Settings → Admin → Send praise. Pick a category (New hire / New offer / Birthday / Work anniversary / Custom), the recipient (one user or Everyone), the display name of who\'s being celebrated, and a short message. The recipient(s) see a big confetti modal next time they\'re idle in the dialer.' },
      { type: 'new', text: 'Smart suppression: the praise modal does NOT pop up while a user is on an active call — recruiters mid-conversation aren\'t yanked out of context. It waits until the call ends, then appears.' },
      { type: 'new', text: 'Per-user read tracking. A broadcast praise is marked read separately for each recipient, so when Abdulla dismisses it, it doesn\'t disappear for Ankit. Admin can see in their send history how many people have viewed each broadcast.' },
    ],
  },
  {
    version: '0.10.73',
    date: 'June 3, 2026',
    highlight: 'Dialer no longer clips at small window sizes / 125% DPI scaling',
    changes: [
      { type: 'fixed', text: 'On smaller Electron windows (especially at 125%+ Windows DPI scaling — common on 1920×1080 laptops), the dialpad\'s "1 2 3" row and number input were getting clipped off the top of the visible area. The layout used bottom-anchored flex with no overflow handling, so when content exceeded the viewport, the FIRST children overflowed UP and got hidden. Switched to top-anchored stacking with the dial button held to the bottom via margin-top:auto — visually identical on tall viewports, content stays visible on short ones.' },
      { type: 'fixed', text: 'Added internal scrolling on the dialpad container as a fallback for users with very small windows or extreme DPI scaling (150%+) where even the new layout overflows.' },
      { type: 'improved', text: 'Desktop app minimum window height bumped from 600 to 800 pixels. At 125% Windows DPI scaling this gives ~640 CSS pixels of usable space — enough for the full keypad to render comfortably. Users can no longer drag the window smaller than what works.' },
    ],
  },
  {
    version: '0.10.72',
    date: 'June 3, 2026',
    highlight: 'Friendly explanations when SMS send fails',
    changes: [
      { type: 'new', text: 'When a message fails to send (immediate failure) or fails to deliver (carrier rejected it later), you now see a plain-English explanation instead of a Telnyx error code. Examples: "Carrier filtered as spam" with detail about 10DLC registration, "Number doesn\'t exist" for invalid recipients, "Recipient blocked you" when they sent STOP. Failed bubbles also turn red so you can spot them at a glance.' },
      { type: 'new', text: 'The error blurb shows both a short label (good for quick scanning) and a longer detail line that explains what likely happened and what to do about it — retry, contact admin, double-check the number, etc. Hover the bubble for the full detail in a native tooltip.' },
    ],
  },
  {
    version: '0.10.71',
    date: 'June 3, 2026',
    highlight: 'Teams Reply/Call leftover browser tab auto-closes',
    changes: [
      { type: 'improved', text: 'After clicking Reply or Call on a Teams notification and letting it open the desktop ACE Dialer, the browser tab that brokered the launch now tries to close itself automatically 1.5 seconds later. Browsers vary on whether they honor close() for tabs they didn\'t script-open — when they do, the tab vanishes silently. When they don\'t, the leftover tab now shows a friendly "ACE Dialer should be opening on your desktop — you can close this tab" message with an explicit Close this tab button, instead of looking like a stuck loading screen.' },
      { type: 'fixed', text: 'Removed the 8-second auto-navigate to /messages or /keypad. Previously the browser tab would silently bounce to /login if the user wasn\'t signed in on the browser — a surprise redirect that scared people. Now the tab stays on the launch page with an explicit "Open in browser composer" / "Open in browser dialer" button if the user wants to fall back to the web app deliberately. No more sneaky redirects.' },
    ],
  },
  {
    version: '0.10.70',
    date: 'June 3, 2026',
    highlight: 'Teams Reply/Call → Electron — actually works now',
    changes: [
      { type: 'fixed', text: 'Teams notification Reply / Call buttons now actually open the Electron desktop app. The v0.10.67 attempt only handled the case where the user was ALREADY inside Electron — for the typical case (Teams card click opens the URL in the default browser, where the user has no ACE session), the auth guard redirected to /login BEFORE the protocol-launch page ever rendered. Moved the /auto/call and /auto/sms routes outside the auth gate so the ace-dialer:// redirect fires immediately, even for unauthenticated browser sessions. The "Open ACE Dialer?" browser prompt now appears reliably; click Allow once (with "Always allow") and future Teams card clicks open Electron silently. The web fallback (when the protocol handler is absent) still works as before for users without the desktop app.' },
    ],
  },
  {
    version: '0.10.69',
    date: 'June 3, 2026',
    highlight: 'Telnyx auto-config — country picker on Invite + Edit country on Users tab',
    changes: [
      { type: 'new', text: 'The "Invite New User" modal now has a Country dropdown (default India). The country drives Telnyx anchorsite selection on the new user\'s Credential Connection — India users get Chennai anchor (lowest latency); US/Other users get Telnyx\'s "Latency" routing (closest site per-call).' },
      { type: 'new', text: 'Settings → Users → kebab menu now has a "Set country (XX)" option. Click to change an existing user\'s country (drives future Telnyx config syncs). The current value is shown right in the menu label. This finishes the v0.10.64 Telnyx auto-config feature — every flow that creates or assigns a Telnyx DID now honors the user\'s country.' },
    ],
  },
  {
    version: '0.10.68',
    date: 'June 3, 2026',
    highlight: 'CRITICAL hotfix — restore aggressive SIP re-register on focus',
    changes: [
      { type: 'fixed', text: 'Inbound calls routing to voicemail for many users (including admin). The v0.10.62 throttle on the visibility-driven REGISTER was too aggressive — it required 30 seconds of "hidden" time AND a 30-second cooldown before re-registering on tab focus. That left users vulnerable to Telnyx silent eviction (their dialer thought it was registered, Telnyx had dropped them) with no proactive recovery for up to 30 seconds. Reverted to always force a defensive REGISTER on visibility=visible, with only a tight 5-second cooldown to prevent the DevTools-pane-switch storm Nilesh originally saw. Visual flicker may return slightly but inbound call reliability comes back to baseline. The proper fix (Telnyx webhook-driven instant eviction detection) is still the next planned release.' },
    ],
  },
  {
    version: '0.10.67',
    date: 'June 3, 2026',
    highlight: 'Telnyx auto-config for new users + Teams deep-link to desktop + faster unread badge refresh',
    changes: [
      { type: 'new', text: 'Every new or migrated user now automatically gets the standard ACE Telnyx configuration applied to their Credential Connection and DID — no more manual setup in the Telnyx Portal. Anchor site picked by country (India → Chennai, US/Other → latency-optimized). DID defaults: HD voice enabled, CNAM listing enabled with caller ID name "ApTask", voicemail enabled with PIN 12345. The Migrate from Pulse modal has a new "Country" dropdown so the right anchor site is applied per user. All settings beyond anchor come from your master template Connection in Telnyx — set its ID via the existing TELNYX_TEMPLATE_CONNECTION_ID env var.' },
      { type: 'fixed', text: 'Teams notification Reply / Call buttons now correctly deep-link into the desktop ACE Dialer instead of dumping you to the web. If you\'re already running ACE inside Electron, the redirect skips the protocol-launch step entirely and just navigates inside the same window. The browser-side fallback timeout extended from 3s to 8s so the "Open ACE Dialer?" prompt has time to be clicked.' },
      { type: 'fixed', text: 'Unread badges (Messages, Voicemail) now clear immediately when you read an SMS thread or listen to a voicemail. Previously the bottom-nav badge stayed at the pre-action count for up to 15 seconds (the next poll interval). Now a custom event fires the moment the read/listen action persists, and the badge refreshes instantly.' },
    ],
  },
  {
    version: '0.10.66',
    date: 'June 3, 2026',
    highlight: 'Multi-number favorites — Cell / Home / Work / Other per contact',
    changes: [
      { type: 'new', text: 'A favorite can now carry multiple labeled phone numbers. Each favorite still shows as one row in the list (no clutter), but if it has more than one number, tap the chevron on the right to expand and see each number with its own label (Cell / Home / Work / Other) and its own call, SMS, and block buttons.' },
      { type: 'new', text: 'Add additional numbers to an existing favorite by expanding the row and clicking "Add number" at the bottom. Each number gets its own label from a quick-pick dropdown. Existing favorites with a single number stay exactly as they were — they\'re automatically backfilled with label "Mobile" so nothing visible changes for them.' },
      { type: 'improved', text: 'Per-number block: blocking from the favorite\'s expanded view only blocks the specific number tapped, not all of the contact\'s lines. So you can block someone\'s work number without losing their cell.' },
    ],
  },
  {
    version: '0.10.63',
    date: 'June 3, 2026',
    highlight: 'Remove Pending Users section from Settings',
    changes: [
      { type: 'improved', text: 'Settings → Admin no longer shows the "Pending Users" section. The bulk-stage-then-invite workflow it served is no longer needed — "Migrate from Pulse" handles the standard one-user-at-a-time onboarding now. The backend endpoints and pending_users table are kept intact in case the workflow needs to be re-exposed later.' },
    ],
  },
  {
    version: '0.10.62',
    date: 'June 3, 2026',
    highlight: 'Fix the v0.10.50 over-aggressive visibility-register cascade',
    changes: [
      { type: 'fixed', text: 'The dialer no longer hammers Telnyx with a fresh SIP REGISTER every time you click between the dialer window and another app. The v0.10.50 "always force a fresh register on focus" defense was meant to recover from silent Telnyx evictions after long absences (laptop sleep, etc.), but it was firing on every tab/window focus — which for users who keep DevTools docked next to ACE meant dozens of REGISTERs in seconds, eventually colliding with Telnyx\'s concurrent-REGISTER guard and triggering a registrationFailed cascade → manual reconnect → visible Disconnected flicker. The forced register now only fires when (a) the document was actually hidden for more than 30 seconds, AND (b) we haven\'t already force-registered in the last 30 seconds. The 10-second heartbeat still handles routine refreshes; this just stops the focus-event spam.' },
      { type: 'improved', text: 'Diagnostic logs now show how long the dialer was hidden and how long since the last forced register, so when SIP issues show up in the console you can tell at a glance whether the visibility recovery was the cause or something else.' },
    ],
  },
  {
    version: '0.10.61',
    date: 'June 3, 2026',
    highlight: 'Fixes for Invalid-Date bubbles + misleading Pulse import warning',
    changes: [
      { type: 'fixed', text: 'Sending an SMS no longer shows "Invalid Date, Invalid Date" on the new bubble. The regression came from v0.10.59 when the send helper was extracted into a shared module — it accidentally narrowed the response shape, dropping createdAt and a few other fields that the bubble renderer needs. The bubble now shows the proper timestamp from the moment the message is sent (no refresh needed).' },
      { type: 'fixed', text: 'All four timestamp formatters (Messages, Recents, Voicemail, Chat) now guard against invalid date inputs and render an empty string instead of "Invalid Date, Invalid Date" if a malformed timestamp ever slips through. Defensive layer in case future code paths produce bad dates.' },
      { type: 'fixed', text: 'Refresh-from-Pulse no longer scares admin with a false-positive bug warning when the user has already been migrated. The previous warning checked only "newly inserted" rows and ignored "already in ACE / skipped as duplicate" — so re-running Refresh on a fully-imported user (every duplicate skipped, 0 new) would alarmingly say "Pulse has X SMS but ACE didn\'t import any — let the devs know." It now correctly sums inserted + skipped and only warns when there\'s a real gap (5% drift tolerance). If everything\'s already imported, you see a calm "All N already in ACE — user is up to date" message instead.' },
    ],
  },
  {
    version: '0.10.60',
    date: 'June 3, 2026',
    highlight: 'Connection Health — pilot smoothing (admin-toggleable)',
    changes: [
      { type: 'new', text: 'Admin → Settings → Users → kebab menu now has a "Enable Connection Health (beta)" toggle per user. When enabled for a user, the dialer no longer flickers Disconnected → Online for brief network blips. Brief blips under 5 seconds stay invisible. Sustained 5-30 second gaps show as amber "Reconnecting…" instead of red "Disconnected". Only after 30 seconds of sustained failure does the status flip to red. The aim: stop the noisy red/green flicker that causes user stress without changing actual call behavior. Default off; enable for pilot users first.' },
      { type: 'fixed', text: 'Telnyx silent-eviction recovery layer is coming in v0.10.60-rc2. The current release smooths only the visible flicker — calls can still go to voicemail if the heartbeat takes a moment to notice an eviction. RC2 will add server-driven instant reconnect (latency <1 second) once the webhook subscription is configured on Telnyx. Pilot users on this RC1 should validate that the flicker reduction feels right before we layer on the deeper fix.' },
    ],
  },
  {
    version: '0.10.59',
    date: 'June 3, 2026',
    highlight: 'Schedule an SMS or MMS to send later',
    changes: [
      { type: 'new', text: 'New clock icon next to the Send button in any SMS thread. Click it, pick a date and time, and the message goes into a queue that fires automatically at that moment — even if you\'ve closed the dialer. Works for plain SMS and for MMS with attachments. Quick-pick buttons for "+1 hour", "Tomorrow 9am", and "Monday 9am" cover the common cases; pick a custom datetime for anything else.' },
      { type: 'new', text: 'Pending scheduled messages now show as an amber strip at the top of the thread so you always see what\'s queued for that contact. Edit or cancel before it fires — once it sends, the strip disappears and the message appears in the conversation like any other outbound SMS.' },
      { type: 'new', text: 'Scheduled messages send from the DID you had selected when you scheduled them, even if you later switch your active line. So a recruiter who scheduled "send Monday 9am from Sales line" doesn\'t accidentally fire it from their personal DID on Monday.' },
    ],
  },
  {
    version: '0.10.58',
    date: 'June 3, 2026',
    highlight: 'Manual DID override on Pulse migration',
    changes: [
      { type: 'new', text: 'Admin → Migrate user from Pulse modal now has an optional "DID override" field. When Pulse has stale or wrong data on a user (e.g. voip_number points at a number Telnyx no longer recognizes), admin can paste the correct DID and migration uses it instead of trusting Pulse. Verified case: Roshni Sahani — Pulse stored 4706008030 but her real Telnyx DID is 4706168494. The override usage is recorded in the audit log alongside whatever Pulse said, so we have a trail.' },
    ],
  },
  {
    version: '0.10.57',
    date: 'June 3, 2026',
    highlight: 'Messages page width matches Recents',
    changes: [
      { type: 'fixed', text: 'The Messages page now renders the same width as Recents. Previously the conversation list collapsed to the natural width of its header, which made names truncate too aggressively. Messages and Recents now share a single 480px centered column for visual consistency.' },
    ],
  },
  {
    version: '0.10.56',
    date: 'June 3, 2026',
    highlight: 'Timestamps everywhere + safer Recents row tap',
    changes: [
      { type: 'improved', text: 'Recents, Messages, Voicemail, and Chat rows now show the time-of-day on every row, not just on rows from today. "Yesterday" becomes "Yesterday, 9:37 AM"; "Jun 1" becomes "Jun 1, 9:37 AM". You can scan when each call/SMS/voicemail actually landed.' },
      { type: 'improved', text: 'Tapping a Recents row no longer auto-dials. It now copies the number to your clipboard and shows a brief "Copied" pill. To actually place the call, tap the new Phone icon on the right of the row. The SMS, favorite, and block buttons keep working as before. This stops accidental redials from a stray click and lets you paste the number into another app (a text, an email, a CRM record).' },
    ],
  },
  {
    version: '0.10.55',
    date: 'June 3, 2026',
    highlight: 'Cleaner call history + paste-to-send images',
    changes: [
      { type: 'fixed', text: 'Interaction history modal no longer shows duplicate rows for the same call. A single call could appear as two entries (one labeled "originator_cancel" and one "Canceled", or two rows with slightly different durations) because Telnyx fires events for both legs of a call. Recents already collapsed these — the per-contact history modal was missing the same step.' },
      { type: 'new', text: 'Paste an image directly into the message box to send as MMS. Copy a screenshot (Snipping Tool, Print Screen, Cmd+Shift+4, drag from another window), click into a thread, press Ctrl+V (or ⌘+V), and the image uploads as an attachment without you needing to save it to disk first. Plain text paste still works as before.' },
    ],
  },
  {
    version: '0.10.54',
    date: 'June 3, 2026',
    highlight: 'SMS templates feel right',
    changes: [
      { type: 'fixed', text: 'Picking a template now auto-fills the recruiter\'s own name into {recruiter} (was being left as the literal placeholder). Combined with {firstName} auto-fill from the contact, a cold-outreach template now reads "Hi Jean, this is Abdulla from ApTask..." the instant you pick it.' },
      { type: 'fixed', text: 'SMS compose box now auto-grows to show the full message after picking a template. Previously the box stayed one line tall, hiding most of the content and forcing you to scroll inside a tiny strip. The box now expands to fit content up to about 9 lines, then scrolls.' },
    ],
  },
  {
    version: '0.10.53',
    date: 'June 3, 2026',
    highlight: 'Admin visibility into blocked numbers + override',
    changes: [
      { type: 'new', text: 'Settings → Blocked numbers (all users) (admin only). One screen showing every block created by every user on the team, the reason they gave, when, and which user. Searchable by user / number / reason. Click "Override" on any row to remove a block on a user\'s behalf — the action is recorded in the audit log.' },
      { type: 'improved', text: 'The Blocked numbers page (for regular users) now reminds users to add a reason: "Your admin can see every block on the team and may need context." Helps admins audit blocks intelligently.' },
    ],
  },
  {
    version: '0.10.52',
    date: 'June 3, 2026',
    highlight: 'Recruiter SMS templates — pick from a playbook',
    changes: [
      { type: 'new', text: 'A "Templates" button appears next to the emoji picker in every SMS compose box. Click to open a popover grouped by category (initial outreach, documents, submission, interview, follow-up, outcomes, BGV, relationship). Pick a template and the message loads into the compose box with the contact\'s first name auto-filled. Other placeholders ({role}, {client}, {time}, etc.) stay as {variable} so the recruiter can fill them inline before sending.' },
      { type: 'new', text: 'Settings → SMS templates (admin only). Admin can create, edit, archive, and re-order templates. One-click "Seed default playbook" loads the built-in 20-template recruiter playbook (idempotent — safe to run multiple times). Templates are tenant-wide; every user sees the same picker.' },
    ],
  },
  {
    version: '0.10.50',
    date: 'June 3, 2026',
    highlight: 'Fewer missed calls on return to desktop + hold music lockdown',
    changes: [
      { type: 'fixed', text: 'When you walked away from your desktop and came back to find a missed call that should have rung, the dialer was assuming its SIP registration was still valid even though Telnyx had silently evicted it. The dialer now force-refreshes its registration with Telnyx the moment your window regains focus — no waiting for the next 10-second heartbeat to maybe-catch-it. Cuts missed-call rate after long idle periods significantly.' },
      { type: 'improved', text: 'Hold music: users now see the toggle to enable/disable, but only admins can upload, replace, or remove the audio file. The admin\'s tenant default is the source of truth. Reduces accidental "I uploaded my favourite song" moments.' },
      { type: 'improved', text: 'Removed the "Yesterday\'s activity" banner that appeared on first sign-in each day. We\'ll come back to this in a different form (maybe an AI summary) once we land a few other priorities.' },
    ],
  },
  {
    version: '0.10.49',
    date: 'June 2, 2026',
    highlight: 'Critical SMS import fix — Pulse SMS imports now actually work',
    changes: [
      { type: 'fixed', text: 'Every SMS import from Pulse since v0.10.44 was failing silently. The fetch SQL referenced a chat_user.normalized_mobile column that exists in newer Pulse schema dumps but NOT in production. MySQL returned "Unknown column" error, the catch block swallowed it, and the diagnostic kept showing "Pulse has X SMS, ACE imported 0". Removed the bad column. Now run Refresh from Pulse on any user (Sagar, Sanjyot, anyone whose import showed 0) and SMS will actually come through.' },
    ],
  },
  {
    version: '0.10.48',
    date: 'June 2, 2026',
    highlight: 'Admins can set one hold music for everyone',
    changes: [
      { type: 'new', text: 'Settings → Hold music. Admins now see a "Set as tenant default" button below the regular upload controls. Once set, every new user (and every existing user without their own override) inherits the same hold music automatically on next sign-in. Users can still upload their own personal hold music to override the default if they want.' },
      { type: 'improved', text: 'Hold music is now stored centrally in ACE\'s database (one tenant-wide entry) instead of only in each user\'s browser. Admin manages it once; the rollout to every user is automatic.' },
    ],
  },
  {
    version: '0.10.47',
    date: 'June 2, 2026',
    highlight: 'Yesterday\'s activity at a glance',
    changes: [
      { type: 'new', text: 'On your first sign-in each day, a small banner at the top shows what happened while you were away: missed calls, new SMS, voicemails. Click X to dismiss; it won\'t reappear until tomorrow. Hides itself entirely if there\'s nothing to summarize.' },
      { type: 'improved', text: 'Bug-report / suggestion email in Settings → What\'s new now points to support@aptask.com (was it@aptask.com).' },
    ],
  },
  {
    version: '0.10.46',
    date: 'June 2, 2026',
    highlight: 'No migrated SMS gets dropped — period',
    changes: [
      { type: 'fixed', text: 'For users whose Pulse contacts had been entirely deleted from Pulse\'s chat_user table (Sagar Bangera being the latest example: 93 SMS in Pulse, 0 imported), the SMS import still dropped every message — even after v0.10.44\'s fix — because the chat_user row didn\'t exist to give us anything to anchor the thread on. The import now falls back to the raw Pulse user_id stored on the message itself, so the message imports under a synthetic thread regardless. No message ever gets silently dropped now.' },
    ],
  },
  {
    version: '0.10.45',
    date: 'June 2, 2026',
    highlight: 'Migrated messages and calls show their original send time',
    changes: [
      { type: 'fixed', text: 'SMS and calls migrated from Pulse were all showing the import time as the message time, instead of when they actually happened in Pulse. The Messages list looked like every conversation happened at the same instant. Fixed for all future imports — they now anchor to the original Pulse send time.' },
      { type: 'new', text: 'New admin maintenance endpoint POST /admin/maintenance/fix-pulse-timestamps that retroactively corrects timestamps on previously-imported Pulse messages and calls. Run it once after deploying v0.10.45 and Ravindra/Himank/Sanjyot\'s already-imported history will show in proper chronological order.' },
    ],
  },
  {
    version: '0.10.44',
    date: 'June 2, 2026',
    highlight: 'SMS import works even when Pulse contact phone is null',
    changes: [
      { type: 'fixed', text: 'For some migrated users (Sanjyot Waghmare being the example: 284 SMS in Pulse, 0 imported), every single SMS was being dropped because Pulse\'s chat_user.mobile_no column was null for their contacts. Pulse has a SECOND phone column (normalized_mobile) that\'s populated in newer records; we now check both. As a last resort, if both are null, the message imports under a synthetic thread key based on the chat_user id so it doesn\'t get silently dropped.' },
    ],
  },
  {
    version: '0.10.43',
    date: 'June 2, 2026',
    highlight: 'Messages list fix, take two',
    changes: [
      { type: 'fixed', text: 'Tighter CSS constraints on thread rows in the Messages tab. v0.10.42\'s fix worked for most resolutions but didn\'t fully constrain the layout on certain Electron desktop builds — preview text was extending to 2200+ pixels wide on a 1366-pixel screen, pushing the contact name off-screen to the left. Now uses width:0 + flex:1 1 0% to force aggressive shrink that works on all configurations.' },
    ],
  },
  {
    version: '0.10.42',
    date: 'June 2, 2026',
    highlight: 'Messages list looks right on smaller screens too',
    changes: [
      { type: 'fixed', text: 'On laptops at 1366×768 resolution (or any monitor with Windows display scaling at 125%+), thread rows in the Messages tab were rendering with the contact name area empty and the preview text starting mid-sentence — because of CSS layout overflow at narrow widths. Thread rows now truncate names and badges gracefully at any viewport size.' },
    ],
  },
  {
    version: '0.10.41',
    date: 'June 2, 2026',
    highlight: 'Refresh from Pulse shows diagnostic counts',
    changes: [
      { type: 'new', text: 'When you refresh a user from Pulse and 0 SMS come over, the result panel now shows what Pulse actually has for them: total messages, total SMS (any time), SMS in the last 30 days. Makes it clear whether Pulse genuinely has no SMS for that user or whether ACE is missing them — no more guessing.' },
    ],
  },
  {
    version: '0.10.40',
    date: 'June 2, 2026',
    highlight: 'Refresh from Pulse: works for pre-wizard users + handles multi-line users',
    changes: [
      { type: 'fixed', text: 'The "Refresh from Pulse" button used to fail with "No Pulse user_id on record" for users added to ACE before the migrate wizard existed. The modal now has an optional "Pulse user ID" field — enter their Pulse user_id (e.g. 55) the first time, and ACE remembers it for future refreshes.' },
      { type: 'new', text: 'If a user has multiple phone lines (e.g. an original Pulse number AND a new ACE-purchased number), the Refresh modal now shows a "Which line?" dropdown so you can pick which line the Pulse history should attach to. Single-line users don\'t see the dropdown — defaults to their one line automatically.' },
      { type: 'fixed', text: 'The DID column on Settings → Users now shows each user\'s current default line (instead of the legacy first-assigned number which got stale when admins added or changed lines later). Users with more than one line get a "+N" badge so you know they have multiple.' },
      { type: 'improved', text: 'Search now matches across all of a user\'s lines, not just their original one.' },
    ],
  },
  {
    version: '0.10.38',
    date: 'June 1, 2026',
    highlight: 'One-click refresh from Pulse for any migrated user',
    changes: [
      { type: 'new', text: 'On every user row in Settings - Users, the kebab menu now has "Refresh from Pulse". One click opens a modal that re-pulls their last 30 days of SMS history. If you also paste their Pulse password, calls get refreshed too. No command-line, no IDs to look up.' },
      { type: 'new', text: 'Settings - Users - "Bulk-refresh SMS" runs the same SMS refresh across every migrated user in one shot. Per-user results table shows the new-message count for each. SMS-only by design (calls would need per-user passwords we deliberately don\'t store).' },
    ],
  },
  {
    version: '0.10.37',
    date: 'June 1, 2026',
    highlight: 'One-click migrate user from Pulse',
    changes: [
      { type: 'new', text: 'Settings - Users - "Migrate from Pulse". Enter the user\'s Pulse email and password, and ACE does everything else in 30-60 seconds: creates their ACE account, moves their phone number from Pulse to ACE in Telnyx, configures the messaging profile, sends a welcome email, and imports their last 30 days of calls + SMS. Step-by-step results shown in the modal.' },
      { type: 'improved', text: 'Migration audit log records pulse user_id, ACE email, DID, both Telnyx connection IDs (before + after), counts of records imported, and total duration - but never the user\'s Pulse password.' },
    ],
  },
  {
    version: '0.10.36',
    date: 'June 1, 2026',
    highlight: 'Migration backfill now reaches into Pulse for call history',
    changes: [
      { type: 'new', text: 'When you migrate a user from Pulse to ACE, the dialer now logs into Pulse with the user\'s credentials and pulls their last ~200 call records (typically 20-30 days of history depending on call volume) directly into ACE\'s Recents. Combined with the existing 30-day SMS import, migrated users land with their full recent history visible immediately.' },
      { type: 'improved', text: 'Admins can re-run a user\'s backfill at any time by providing that user\'s Pulse email + password to the backfill endpoint. Password is used once and never stored.' },
      { type: 'fixed', text: 'Pulse marks call records as "incoming"/"outgoing" rather than "inbound"/"outbound". The import now recognizes both - earlier some incoming calls were incorrectly tagged as outbound.' },
    ],
  },
  {
    version: '0.10.34',
    date: 'June 1, 2026',
    highlight: 'Connection status stays steady during calls',
    changes: [
      { type: 'fixed', text: 'Connection status pill no longer flickers between Online and Disconnected while you\'re on a call. Routine SIP refresh blips (every few minutes for some network conditions) used to flash the indicator alarmingly even though the call itself was unaffected. The pill now stays stable for the duration of the call.' },
      { type: 'new', text: 'When you migrate a user from Pulse to ACE, their 30-day SMS history and call history can also import from Pulse\'s database — not just from Telnyx. This catches users whose data was on Pulse-only routes (Twilio shared sender, etc.) and wasn\'t visible to Telnyx alone. (Requires admin to configure Pulse DB connection in env vars; code ships dormant until activated.)' },
      { type: 'improved', text: 'Once history imports from Pulse, ACE owns it permanently. Migrated users\' data lives on ACE\'s database with no ongoing dependency on Pulse — Pulse can be decommissioned without affecting them.' },
    ],
  },
  {
    version: '0.10.33',
    date: 'June 1, 2026',
    highlight: 'Spelling suggestions on right-click',
    changes: [
      { type: 'improved', text: 'Right-click any squiggled (misspelled) word in the SMS compose box or any other text input — you now get spelling suggestions at the top of the menu. Click a suggestion to replace the word, or "Add to dictionary" to suppress the squiggle for that word going forward. Works across every text field in the dialer.' },
    ],
  },
  {
    version: '0.10.32',
    date: 'June 1, 2026',
    highlight: 'Critical call reliability fixes',
    changes: [
      { type: 'fixed', text: 'Some users couldn\'t hear incoming calls (caller could hear them fine, but the user heard silence). Root cause: a timing race where the audio track was already attached by the time the dialer wired up its listener — so the listener missed the track event. Now correctly attaches any pre-existing audio track when setting up listeners.' },
      { type: 'fixed', text: 'Accept button on incoming call screen could occasionally appear unresponsive when the caller hung up at exactly the same moment. The button now correctly dismisses the ringer instead of doing nothing silently.' },
      { type: 'fixed', text: 'Speaker selection now auto-falls-back to the system default if the saved device is disconnected (e.g. unpaired Bluetooth headset), instead of silently playing into the void.' },
      { type: 'improved', text: 'Audio playback retries once if the browser briefly blocks it (Chromium\'s autoplay policy on backgrounded windows).' },
      { type: 'improved', text: 'Thread header is reorganized — the contact\'s name and number group together at the top, with "Your line:" explicitly labeled below so it\'s clear which line is which.' },
      { type: 'fixed', text: 'SMS compose placeholder text no longer wraps and gets cut off in narrow windows.' },
    ],
  },
  {
    version: '0.10.30',
    date: 'June 1, 2026',
    highlight: 'SMS compose upgrades',
    changes: [
      { type: 'new', text: 'Emoji picker in the SMS compose box. Click the smile icon to open a popover with common emojis and reactions — insert at the cursor position with one click.' },
      { type: 'new', text: 'Multi-line text messages. Press Shift+Enter to add a new line; Enter still sends the message.' },
      { type: 'improved', text: 'Browser autocorrect, spellcheck, and sentence-start capitalization now active in the SMS compose box.' },
    ],
  },
  {
    version: '0.10.29',
    date: 'June 1, 2026',
    highlight: 'Migration history reliability fixes',
    changes: [
      { type: 'fixed', text: 'Automatic SMS history import now correctly recognizes Telnyx\'s actual column names — earlier the import would silently fail for messages even when data existed.' },
      { type: 'improved', text: 'Migration backfill now tries multiple Telnyx API endpoint paths before giving up, so it works on every account regardless of Telnyx\'s URL conventions.' },
    ],
  },
  {
    version: '0.10.28',
    date: 'June 1, 2026',
    highlight: 'Migrated users get their full 30-day history automatically',
    changes: [
      { type: 'new', text: 'When you migrate a user from the old dialer to ACE, their last 30 days of call logs AND SMS history automatically come over. They open Recents and Messages and see everything reconstructed within a minute — no manual export needed.' },
      { type: 'fixed', text: 'Previously some migrations finished with zero history populated because of a Telnyx API quirk. Now uses Telnyx\'s report-generation pipeline which reliably pulls phone-filtered history.' },
    ],
  },
  {
    version: '0.10.27',
    date: 'June 1, 2026',
    highlight: 'Manual CDR import as a fallback',
    changes: [
      { type: 'new', text: 'Admins can manually upload a CDR or messaging CSV exported from Telnyx Portal to backfill a migrated user\'s history. Useful as a fallback whenever the automatic backfill needs a hand.' },
    ],
  },
  {
    version: '0.10.26',
    date: 'June 1, 2026',
    highlight: 'Smarter notifications and read tracking',
    changes: [
      { type: 'new', text: 'Desktop notifications for new voicemails — just like missed calls and texts. Toggle in Settings → Notifications.' },
      { type: 'new', text: 'Open an SMS thread on one device and the unread dots clear on your other devices too. Read state now syncs everywhere.' },
      { type: 'new', text: 'Per-thread unread count badges in the Messages list.' },
      { type: 'improved', text: 'Tap a voicemail to play it and it auto-marks as read. Right-click any voicemail to mark it unread again.' },
    ],
  },
  {
    version: '0.10.25',
    date: 'June 1, 2026',
    highlight: 'Critical reliability fixes',
    changes: [
      { type: 'fixed', text: 'Incoming calls were going straight to voicemail when the dialer wasn\'t the front window — even though your computer was awake. Calls now ring reliably whether the app is in front, minimized, or in your system tray.' },
      { type: 'fixed', text: 'The incoming call screen sometimes showed the wrong line name (for example, "Main" when someone actually called your "Office Line"). Now correctly shows which of your lines was dialed.' },
      { type: 'fixed', text: 'Reply and Call buttons in Microsoft Teams notification cards now actually open the dialer.' },
    ],
  },
  {
    version: '0.10.24',
    date: 'May 31, 2026',
    highlight: 'Build pipeline reliability',
    changes: [
      { type: 'improved', text: 'When Apple\'s notarization service is slow, the dialer\'s desktop installer now retries automatically and falls back to a signed-only build if needed. No more stuck updates.' },
      { type: 'improved', text: 'Windows installer builds no longer wait on the Mac build — both ship independently.' },
    ],
  },
  {
    version: '0.10.22',
    date: 'May 30, 2026',
    highlight: 'Teams notifications + migrating history',
    changes: [
      { type: 'new', text: 'Microsoft Teams notifications are back. ACE Bot now DMs you for missed calls, new texts, new voicemails, and when an admin assigns you a new line.' },
      { type: 'new', text: 'When an admin migrates your number from the old dialer to ACE, your last 30 days of call history and text messages move with it. Open Recents or Messages right after the migration and everything\'s there.' },
      { type: 'improved', text: 'Migration is faster — no waiting. The history fills in over the next minute while you can use the dialer.' },
    ],
  },
  {
    version: '0.10.21',
    date: 'May 30, 2026',
    highlight: 'Audio quality + admin polish',
    changes: [
      { type: 'new', text: 'Settings → Microphone → "Noise suppression" toggle. Turn it on if you\'re in a noisy environment (café, open office, home with AC + traffic). Keeps your voice clear for the other party.' },
      { type: 'new', text: 'After an admin migrates a number to ACE, they get a prompt to deactivate or delete the old SIP connection — cleaner cleanup.' },
      { type: 'fixed', text: 'The line label on the incoming call screen was invisible for users in light mode. Now always shows clearly on the dark green ringer background.' },
      { type: 'fixed', text: '"Unknown connection" labels in the migrate picker — now shows the real connection name and SIP user for every type of Telnyx connection.' },
    ],
  },
  {
    version: '0.10.20',
    date: 'May 30, 2026',
    highlight: 'Migrate Existing User to New Dialer',
    changes: [
      { type: 'new', text: 'Admins can now migrate a user from the old dialer (Pulse) to ACE without losing their phone number. Find it in Settings → Users → Manage lines → "Migrate Existing User to New Dialer".' },
      { type: 'new', text: 'When a line is added or migrated to your account, you get an email letting you know.' },
      { type: 'new', text: 'Typeahead search in the migrate number picker — find any phone number by digits, connection name, or SIP user.' },
      { type: 'improved', text: 'Incoming call screen line badge is now larger, bolder, and easier to read.' },
      { type: 'improved', text: 'Clearer wording in the "Add a line" modal: "Purchase a new DID from Telnyx" and "Use a new number from Telnyx database that you already own".' },
    ],
  },
  {
    version: '0.10.17',
    date: 'May 29, 2026',
    changes: [
      { type: 'fixed', text: 'Connection status was rapidly switching between "Online" and "Disconnected" for some users in India. Now stays steady on a healthy connection.' },
    ],
  },
  {
    version: '0.10.14',
    date: 'May 29, 2026',
    changes: [
      { type: 'fixed', text: 'Incoming calls were hanging up after a fraction of a second for users on certain numbers. All users now receive calls properly on all their assigned lines.' },
    ],
  },
  {
    version: '0.10.13',
    date: 'May 28, 2026',
    highlight: 'Messages + Chat merged into one tab',
    changes: [
      { type: 'improved', text: 'SMS conversations and internal team chats now live in a single "Messages" tab with a segmented control. No more guessing where a thread is.' },
    ],
  },
  {
    version: '0.10.10',
    date: 'May 28, 2026',
    changes: [
      { type: 'fixed', text: 'Voicemail greetings (and other early audio from the other side) were sometimes drowned out by our ringback tone. The ringback now stops the moment the other party starts speaking.' },
      { type: 'improved', text: 'The line badge on the ringer screen is more readable, especially on bright displays.' },
    ],
  },
  {
    version: '0.10.9',
    date: 'May 28, 2026',
    highlight: 'See which line was called',
    changes: [
      { type: 'new', text: 'The incoming call screen now shows which of your lines the caller dialed (for example "on Sales · (732) 555-1234"). Critical for anyone with multiple numbers.' },
    ],
  },
];
