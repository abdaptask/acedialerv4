// v0.10.0 Pillar 2 Task 7 — shared types + helpers for Adaptive Card
// builders. Each event-specific builder (missedCall, inboundSms,
// voicemail) is a pure function that takes a typed input and returns
// a `TeamsMessage` — the full JSON payload Teams expects when POSTed
// to an Incoming Webhook URL.
//
// Why pure functions: the builders are trivially unit-testable and
// have no I/O. The notifier service (Task 8) is responsible for the
// HTTP POST, retries, and resolving which webhook URL/opt-ins apply
// for a given user.
//
// Card design rules:
//   - version "1.4" — supported by current Teams clients including
//     mobile. Don't bump without checking Teams Adaptive Card
//     compatibility table.
//   - Use Action.OpenUrl with `ace-dialer://...` deep links for
//     call/SMS callbacks (handled by the desktop main process).
//   - Voicemail Listen button links to the web app's playback page,
//     since browsers can't honor a custom protocol on click reliably
//     and Teams mobile users won't have the desktop app installed.
//   - Keep the body terse. Cards render in a narrow chat column —
//     long blocks of text wrap awkwardly.

/** Adaptive Card body element. We only use the subset we actually
 *  render — no need to fully model the schema. Loose typing keeps
 *  the builders short and the cards easy to read inline.
 *  // eslint-disable-next-line @typescript-eslint/no-explicit-any */
export type AdaptiveElement = Record<string, unknown>;

/** Action.OpenUrl is the only action variant we use today. */
export interface AdaptiveOpenUrlAction {
  type: 'Action.OpenUrl';
  title: string;
  url: string;
  /** Optional accessibility label. */
  tooltip?: string;
}

export type AdaptiveAction = AdaptiveOpenUrlAction;

export interface AdaptiveCard {
  $schema: string;
  type: 'AdaptiveCard';
  version: '1.4';
  body: AdaptiveElement[];
  actions?: AdaptiveAction[];
}

/** The outer Teams webhook envelope. Teams' Incoming Webhook expects
 *  a `MessageCard` or — preferred — an Adaptive Card wrapped in this
 *  `message` + `attachments` shape. */
export interface TeamsMessage {
  type: 'message';
  attachments: Array<{
    contentType: 'application/vnd.microsoft.card.adaptive';
    content: AdaptiveCard;
  }>;
}

const ADAPTIVE_SCHEMA = 'http://adaptivecards.io/schemas/adaptive-card.json';

/** Wrap an AdaptiveCard body+actions in the Teams envelope. */
export function buildTeamsMessage(
  body: AdaptiveElement[],
  actions?: AdaptiveAction[],
): TeamsMessage {
  const card: AdaptiveCard = {
    $schema: ADAPTIVE_SCHEMA,
    type: 'AdaptiveCard',
    version: '1.4',
    body,
    ...(actions && actions.length > 0 ? { actions } : {}),
  };
  return {
    type: 'message',
    attachments: [
      {
        contentType: 'application/vnd.microsoft.card.adaptive',
        content: card,
      },
    ],
  };
}

/** Format an E.164-ish phone number into a human-readable form. We
 *  don't have libphonenumber bundled in webhooks (kept lean for
 *  cold-start time), so we hand-format the two cases we care about:
 *    +1NXXNXXXXXX → (XXX) XXX-XXXX  (US/CA)
 *    everything else → return as-is (preserve the leading + and digits)
 *  Falls back gracefully on malformed input. */
export function formatPhoneForDisplay(raw: string | null | undefined): string {
  if (!raw) return 'Unknown';
  const trimmed = String(raw).trim();
  if (!trimmed) return 'Unknown';
  const digits = trimmed.replace(/[^\d]/g, '');
  // US/CA: 11 digits starting with 1, or 10 digits.
  if (digits.length === 11 && digits.startsWith('1')) {
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  // International or unknown — keep the +, return as-is.
  return trimmed.startsWith('+') ? trimmed : `+${digits}`;
}

/** Format a date as e.g. "May 27, 2026 at 3:42 PM ET". Teams cards
 *  could use AdaptiveCard's {{DATE(...)}} binding (which localizes
 *  per-viewer), but the recipient list is small + US-based so a
 *  plain server-rendered string is fine and easier to read in
 *  preview/test contexts. */
export function formatTimeForDisplay(d: Date | string | number): string {
  const date = d instanceof Date ? d : new Date(d);
  if (isNaN(date.getTime())) return 'just now';
  return date.toLocaleString('en-US', {
    timeZone: 'America/New_York',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }) + ' ET';
}

/** v0.10.10 — Build call / SMS action URLs for Teams card buttons.
 *
 * v0.10.5: web /auto/call → protocol attempt → web fallback.
 *   Problem: too many users dismissed the browser prompt or had Chrome
 *   silently block the protocol, ending up on the web dialer instead
 *   of their installed desktop app.
 *
 * v0.10.10: emit `ace-dialer://` URLs directly. Microsoft Teams
 *   supports custom-protocol URLs in Action.OpenUrl; clicking the
 *   card button hands off straight to the OS protocol handler, which
 *   launches / focuses the desktop ACE Dialer. No intermediate
 *   browser tab.
 *
 * Voicemail playback URL stays as a web URL — it intentionally opens
 * a browser page (the audio playback view).
 *
 * `WEB_BASE_URL` is the Vercel origin used for voicemail playback. */
function webBase(): string {
  return (process.env.WEB_BASE_URL ?? 'https://ace-dialer.vercel.app').replace(/\/+$/, '');
}

export function buildCallDeepLink(toNumber: string): string {
  const cleaned = encodeURIComponent(toNumber.trim());
  return `ace-dialer://call?to=${cleaned}`;
}

export function buildSmsDeepLink(toNumber: string, prefillText?: string): string {
  const cleaned = encodeURIComponent(toNumber.trim());
  const t = prefillText ? `&body=${encodeURIComponent(prefillText)}` : '';
  return `ace-dialer://sms?to=${cleaned}${t}`;
}

/** Voicemail playback URL — stays as a web route (audio playback is
 *  a browser-rendered page, not a desktop action). */
export function buildVoicemailPlaybackUrl(voicemailId: number): string {
  return `${webBase()}/voicemail/${voicemailId}/play`;
}
