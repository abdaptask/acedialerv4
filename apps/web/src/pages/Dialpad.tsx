// v0.10.108 — Recent-numbers quick-pick panel removed from the Dialpad.
// The dedicated Recents tab in the bottom nav makes the inline panel
// redundant. BookUser/Clock/X icons and the getCalls/CallRecord/
// formatPhone/favorite/JobDiva helpers were only used by that panel.
import { useState, useCallback, useEffect, useRef } from 'react';
import { useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import { Phone, Delete, AlertCircle, Info, X } from 'lucide-react';
import { AsYouType, parsePhoneNumberFromString, getCountryCallingCode } from 'libphonenumber-js/min';
import type { CountryCode } from 'libphonenumber-js/min';
import { useSip } from '../contexts/SipContext';
import { parseSelectedNumber } from '../lib/phone';

interface DialpadLocationState {
  addCall?: boolean;
}

/** v0.10.221 — what the click-to-dial banner is saying, and how loudly.
 *  'error' means nothing was prefilled and the last-dialed recall is held
 *  back; 'info' means the field IS populated and we're only explaining why it
 *  looks unchanged. */
interface CaptureNotice {
  level: 'error' | 'info';
  message: string;
  /** Second line: what the user should do about it. */
  hint?: string;
}

/** Which capture paths hand us text a human highlighted rather than a number
 *  from our own database. See main.ts DeepLinkSource. */
const UNTRUSTED_SOURCES = ['selection', 'clipboard', 'tel'] as const;
type CaptureSource = (typeof UNTRUSTED_SOURCES)[number];

/** What to tell the user when a capture from each path fails to parse. The
 *  paths are invisible — text goes in, a dialer window comes up — so naming
 *  the source is the difference between "the app is broken" and "ah, my
 *  clipboard still had the last number in it". */
function captureFailureHint(source: CaptureSource): string {
  switch (source) {
    case 'clipboard':
      // The single most reported click-to-dial complaint on 0.10.220, and it
      // isn't a defect: the hotkey reads the clipboard because the safe
      // alternatives don't exist (no clipboard polling, no synthesised Ctrl+C
      // — see the note in apps/desktop/src/main.ts). Say so plainly.
      return 'That is what was on your clipboard. The hotkey reads the clipboard, not what you highlighted — press Ctrl+C on the number first, then the hotkey.';
    case 'tel':
      return 'That came from the link you clicked, not from anything you typed.';
    case 'selection':
      return 'That came from the text you clicked on the page. Try selecting just the number.';
  }
}

const KEYS: Array<{ digit: string; letters?: string }> = [
  { digit: '1' },
  { digit: '2', letters: 'ABC' },
  { digit: '3', letters: 'DEF' },
  { digit: '4', letters: 'GHI' },
  { digit: '5', letters: 'JKL' },
  { digit: '6', letters: 'MNO' },
  { digit: '7', letters: 'PQRS' },
  { digit: '8', letters: 'TUV' },
  { digit: '9', letters: 'WXYZ' },
  { digit: '*' },
  { digit: '0', letters: '+' },
  { digit: '#' },
];

const ALLOWED_KEYS = new Set(['0','1','2','3','4','5','6','7','8','9','*','#','+']);

// Default country prefix used when the user hasn't typed anything yet.
const DEFAULT_PREFIX = '+1';
const DEFAULT_COUNTRY: CountryCode = 'US';

// SVG flag URL from flagcdn.com (free, no key needed). Works on every OS —
// Windows doesn't render Unicode regional-indicator flags as colored emoji,
// so we use raster/SVG images instead.
function flagImageUrl(iso2: string | undefined | null): string {
  const code = (iso2 ?? 'us').toLowerCase();
  return `https://flagcdn.com/h20/${code}.png`;
}

// Detect the country (and its calling code) from the current number being
// entered. We ONLY switch off the US default when the number explicitly
// starts with "+" — otherwise a US area code like 973 (NJ) would get
// misread as +973 (Bahrain) and yank the flag away mid-typing.
function detectCountry(num: string): { iso: CountryCode; callingCode: string } {
  const fallback = {
    iso: DEFAULT_COUNTRY,
    callingCode: getCountryCallingCode(DEFAULT_COUNTRY),
  };
  if (!num || !num.startsWith('+')) return fallback;
  try {
    const parsed = parsePhoneNumberFromString(num);
    if (parsed?.country) {
      return { iso: parsed.country, callingCode: getCountryCallingCode(parsed.country) };
    }
  } catch {
    /* fall through */
  }
  return fallback;
}

// Progressive phone number formatter using libphonenumber-js's AsYouType.
// Handles "+1 (973) 727-0611", "+44 20 1234 5678", etc. — formats as you type.
function formatNumber(raw: string): string {
  const cleaned = raw.replace(/[^\d*#+]/g, '');
  if (cleaned.length === 0) return '';
  // Allow DTMF chars (* #) only when typed alone; AsYouType drops them.
  if (cleaned === '*' || cleaned === '#' || /^[*#]+$/.test(cleaned)) return cleaned;
  try {
    const fmt = new AsYouType('US');
    const out = fmt.input(cleaned);
    return out || cleaned;
  } catch {
    return cleaned;
  }
}

// As-you-type normalizer: if the raw input looks like a complete international
// number (e.g., "918850415617" = India), auto-prepend "+" so the display
// shows proper E.164 ("+91 88504 15617"). US numbers stay in national format.
function smartNormalize(raw: string): string {
  if (!raw) return '';
  if (raw.startsWith('+')) return raw;
  if (raw.startsWith('*') || raw.startsWith('#')) return raw; // DTMF probe
  const digits = raw.replace(/[^\d]/g, '');
  // Leave short / US-style entries alone — they'll resolve to +1 at dial time
  // but we don't want to surprise users who are typing a US number.
  if (digits.length <= 10) return raw;
  if (digits.length === 11 && digits.startsWith('1')) return raw;
  // 11+ digits not starting with 1: probe as international. Only auto-add +
  // if libphonenumber agrees it's a valid number with a country code.
  try {
    const parsed = parsePhoneNumberFromString('+' + digits);
    if (parsed?.isValid() && parsed.country) {
      return '+' + digits;
    }
  } catch {
    /* fall through */
  }
  return raw;
}

// Smart paste handler — given clipboard text, returns the best-guess E.164
// representation. Detects country code by trying international parsing first
// (so 12+ digit strings like "918850415617" land as +91 India), then falls
// back to US national if that doesn't validate.
function parsePastedNumber(raw: string): string {
  if (!raw) return DEFAULT_PREFIX;
  const trimmed = raw.trim();
  // If it looks like a SIP URI, extract the user part.
  const sipMatch = /sip:([^@]+)@/i.exec(trimmed);
  const subject = sipMatch ? sipMatch[1] : trimmed;
  // Keep digits and the leading + (if any). Drop everything else.
  let digits = subject.replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) {
    digits = '+' + digits.slice(1).replace(/\+/g, '');
  } else {
    digits = digits.replace(/\+/g, '');
  }

  // 1. Already has + prefix → trust it and validate.
  if (digits.startsWith('+')) {
    try {
      const parsed = parsePhoneNumberFromString(digits);
      if (parsed?.isValid()) return parsed.number;
    } catch {
      /* fall through */
    }
    return digits;
  }

  // 2. No prefix — try parsing as INTERNATIONAL by prepending "+".
  // This catches things like "918850415617" (India) or "447911123456" (UK)
  // where the country code is baked into the digits.
  if (digits.length >= 11) {
    try {
      const intl = parsePhoneNumberFromString('+' + digits);
      if (intl?.isValid()) return intl.number;
    } catch {
      /* fall through */
    }
  }

  // 3. Try parsing as US national (10 digits → +1XXXXXXXXXX).
  if (digits.length === 10) {
    try {
      const us = parsePhoneNumberFromString(digits, 'US');
      if (us?.isValid()) return us.number;
    } catch {
      /* fall through */
    }
    return '+1' + digits;
  }

  // 4. 11 digits starting with 1 → US/Canada.
  if (digits.length === 11 && digits.startsWith('1')) return '+' + digits;

  // 5. Anything else: keep digits, prepend + so the user can see/edit.
  if (digits.length > 0) return '+' + digits;
  return DEFAULT_PREFIX;
}

export default function Dialpad() {
  // Default to empty so the "Enter phone number" placeholder is visible.
  // Country prefix (+1 by default) is rendered as a separate label to the
  // left of the input so it's always shown without occupying input space.
  const [number, setNumber] = useState('');
  // v0.10.218 — set when a click-to-dial capture couldn't be parsed.
  // v0.10.221 — widened to carry a source attribution and an info level, so a
  // capture that succeeded but looks stuck (unchanged clipboard) can explain
  // itself without being dressed up as an error.
  const [capture, setCapture] = useState<CaptureNotice | null>(null);
  // The value of `number` at the moment the notice was raised. Any later
  // change means the user typed, edited, or pasted — which retires the notice.
  // Comparing against a ref rather than testing `if (number)` is what lets an
  // INFO notice coexist with a prefilled field; the old effect would have
  // cleared it on the same render that populated it.
  const captureNumberRef = useRef('');
  const inputRef = useRef<HTMLInputElement | null>(null);
  const { sipState, callState, call, addCall } = useSip();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const isAddCall =
    !!(location.state as DialpadLocationState | null)?.addCall &&
    callState.state !== 'idle';

  // v0.10.4 Task 10 — Prefill dialer from `?to=` query param. This is
  // how Teams card "Call back" buttons funnel a recipient into the
  // dialer (via the /auto/call page → /keypad?to=...). We populate the
  // number but DON'T auto-dial — per the design decision the user
  // confirms by clicking Call. After prefilling, strip the param from
  // the URL so a page reload doesn't reset the number to a stale value.
  // v0.10.220 — this used to read `if (to && !number)`. The `!number` guard
  // was meant to protect a number the user had typed, but it made every
  // capture after the first a no-op: press the click-to-dial hotkey on a
  // second number and the window would surface still showing the first one.
  // The guard was never needed — stripping `to` below already makes this
  // fire once per navigation, and after the strip a re-run finds no `to`.
  // Replacing the field is the whole point of a capture the user just asked
  // for, so a new one always wins.
  useEffect(() => {
    const to = searchParams.get('to');
    if (to) {
      // v0.10.218 — Click-to-Dial. `src=selection` means `to` came from text
      // a human highlighted somewhere on their machine (a tel: link, the
      // browser extension, or the clipboard hotkey), so it gets the strict
      // parser and a visible error when it isn't a phone number.
      //
      // Anything WITHOUT that marker is a number from our own database
      // (Teams card buttons, /auto/call) and keeps the original lenient
      // smartNormalize path untouched — this feature must not be able to
      // regress deep links that already work in production.
      // v0.10.221 — `src` now names the path ('clipboard' | 'tel' |
      // 'selection'); all three are untrusted text and take the strict parser.
      const source = UNTRUSTED_SOURCES.find((s) => s === searchParams.get('src'));
      if (source) {
        const parsed = parseSelectedNumber(to);
        if (parsed.ok) {
          setNumber(parsed.value.dialString);
          captureNumberRef.current = parsed.value.dialString;
          // A repeat press on unchanged clipboard content prefills the same
          // number as last time, which reads as "the app is stuck on an old
          // number". It isn't — but only the app can explain that, because the
          // user's mental model is the highlight, not the clipboard.
          setCapture(
            source === 'clipboard' && searchParams.get('repeat') === '1'
              ? {
                  level: 'info',
                  message: `Your clipboard still holds ${parsed.value.display}.`,
                  hint: 'Copy the new number with Ctrl+C first — the hotkey reads your clipboard, not the text you highlighted.',
                }
              : null,
          );
        } else {
          // Deliberately do NOT prefill: putting unparseable text in the
          // field invites the user to hit Call on it.
          //
          // v0.10.220 — and clear what was already there. Now that a second
          // capture is no longer ignored, leaving the PREVIOUS number in the
          // field under an error message is a wrong-number call waiting to
          // happen: the user copies a new number, sees the field populated,
          // and presses Call on the old one. Empty field + error is
          // unambiguous.
          setNumber('');
          captureNumberRef.current = '';
          setCapture({
            level: 'error',
            message: parsed.message,
            hint: captureFailureHint(source),
          });
        }
      } else {
        setNumber(smartNormalize(to) || to);
        captureNumberRef.current = '';
        setCapture(null);
      }
      // Remove the params so refreshes don't override the user's edits.
      const next = new URLSearchParams(searchParams);
      next.delete('to');
      next.delete('src');
      next.delete('repeat');
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // Retire the click-to-dial banner as soon as the user edits the field — the
  // message is about the captured text, not about what they're entering now.
  // v0.10.221 — keyed off "changed since the capture" rather than "non-empty",
  // so the info variant survives alongside the number it just prefilled.
  useEffect(() => {
    if (number !== captureNumberRef.current) setCapture(null);
  }, [number]);

  // Inline status for Add Call. While we wait for Telnyx to register the
  // active leg (so we have a callControlId to bridge with), we show this
  // to the user instead of blocking with an alert.
  const [addCallStatus, setAddCallStatus] = useState<
    | { state: 'idle' }
    | { state: 'preparing' }
    | { state: 'error'; message: string }
  >({ state: 'idle' });

  // v0.10.108 — Inline contacts/recent quick-pick removed. Users get to
  // recent numbers via the Recents tab in the bottom nav.

  const append = useCallback((d: string) => setNumber((n) => n + d), []);
  const backspace = useCallback(() => setNumber((n) => n.slice(0, -1)), []);
  // Esc clears the input. The country flag/prefix remains visible on the
  // left as a static label (US default), so the user always sees it.
  const clear = useCallback(() => setNumber(''), []);

  // Anything with at least one dialable digit counts as ready to call.
  const hasDialableInput = number.replace(/[^\d]/g, '').length > 0;
  // Whether there's a last-dialed number stashed for the empty-input recall.
  const hasLastDialed = (() => {
    try { return !!localStorage.getItem('ace_last_dialed'); } catch { return false; }
  })();
  // v0.10.221 — handleCall suppresses the recall while a failed capture is on
  // screen, so the button has to LOOK unavailable too. A button that silently
  // does nothing when pressed is worse than a disabled one.
  const canRecallLastDialed = hasLastDialed && capture?.level !== 'error';

  const handleCall = useCallback(async () => {
    // Empty field + call pressed: recall the last dialed number (classic
    // phone behavior — like the iOS dialer). User can press call again to
    // actually dial it.
    if (!hasDialableInput) {
      // v0.10.221 — but NOT while a failed capture is on screen. That branch
      // deliberately empties the field (v0.10.220), and the user's next move
      // is almost always to press Call again — at which point the recall
      // helpfully filled in a completely unrelated number from an hour ago,
      // directly beneath a red error about the number they just tried to
      // capture. Reported as "click to dial keeps putting stale numbers in".
      // Recall is a convenience for a field the USER left empty; it has no
      // business firing over an emptied one.
      if (capture?.level === 'error') return;
      const last = localStorage.getItem('ace_last_dialed');
      if (last) setNumber(last);
      return;
    }
    if (sipState !== 'registered') {
      alert(`Can't call yet — SIP state: ${sipState}. Wait for "Registered" badge above keypad.`);
      return;
    }
    // Remember this number for next-time recall before we navigate away.
    try { localStorage.setItem('ace_last_dialed', number); } catch { /* quota */ }
    if (isAddCall) {
      // Server-originated Leg B via Telnyx Call Control. addCall() waits up
      // to 15s for the leg's callControlId to arrive before failing, so we
      // show an inline "Preparing…" state during that window.
      setAddCallStatus({ state: 'preparing' });
      const res = await addCall(number);
      if (!res.ok) {
        setAddCallStatus({
          state: 'error',
          message: res.hint ?? res.error ?? 'Add Call failed.',
        });
        return;
      }
      setAddCallStatus({ state: 'idle' });
    } else {
      call(number);
    }
    navigate('/in-call');
  }, [number, hasDialableInput, sipState, isAddCall, call, addCall, navigate, capture]);

  // Keyboard input — listen at the document level so the dialpad is "always focused".
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Don't hijack typing into form fields (e.g., login screen).
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }

      if (ALLOWED_KEYS.has(e.key)) {
        e.preventDefault();
        append(e.key);
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        backspace();
      } else if (e.key === 'Delete') {
        e.preventDefault();
        clear();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        handleCall();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        clear();
      }
    }
    // Paste: clipboard → smart-parse → set as number. Handles things like
    // "+1 (973) 727-0611", "973.727.0611", "tel:+15555550100", SIP URIs.
    function onPaste(e: ClipboardEvent) {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return; // let the form field handle it
      }
      const text = e.clipboardData?.getData('text');
      if (!text) return;
      e.preventDefault();
      setNumber(parsePastedNumber(text));
    }
    document.addEventListener('keydown', onKey);
    document.addEventListener('paste', onPaste);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('paste', onPaste);
    };
  }, [append, backspace, clear, handleCall]);

  const statusLabel =
    sipState === 'registered' ? 'Registered' :
    sipState === 'reconnecting' ? 'Reconnecting…' :
    sipState === 'connecting' ? 'Connecting…' :
    sipState === 'failed' ? 'Connection failed' :
    'Disconnected';

  // v0.10.60 — 'reconnecting' uses the same amber 'warn' class as
  // 'connecting'. The whole point of the new state is to look NOT-RED
  // for the first 30 seconds of trouble.
  const statusClass =
    sipState === 'registered' ? 'sip-status ok' :
    sipState === 'failed' ? 'sip-status err' :
    'sip-status warn';

  const heldDisplay = (() => {
    const n = callState.toNumber ?? callState.fromNumber ?? callState.number;
    if (!n) return '';
    const d = n.replace(/[^\d]/g, '');
    if (d.length === 11 && d.startsWith('1')) return `(${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`;
    if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
    return n;
  })();

  return (
    <div className="dialpad">
      {isAddCall && (
        <button
          type="button"
          className="addcall-banner"
          onClick={() => navigate('/in-call')}
          title="Back to active call"
        >
          <span className="addcall-tag">On hold</span>
          <span className="addcall-num">{heldDisplay}</span>
          <span className="addcall-back">Tap to return</span>
        </button>
      )}

      {addCallStatus.state === 'preparing' && (
        <div className="addcall-status preparing" role="status">
          <span className="spinner" aria-hidden="true" />
          <span className="addcall-status-text">
            Preparing call via Telnyx Call Control…
          </span>
          <button
            type="button"
            className="addcall-status-cancel"
            onClick={() => setAddCallStatus({ state: 'idle' })}
          >
            Cancel
          </button>
        </div>
      )}
      {addCallStatus.state === 'error' && (
        <div className="addcall-status error" role="alert">
          <span className="addcall-status-text">{addCallStatus.message}</span>
          <button
            type="button"
            className="addcall-status-cancel"
            onClick={() => setAddCallStatus({ state: 'idle' })}
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="dialpad-top">
        <div className={statusClass}>{statusLabel}</div>
        <div className="keyboard-hint top">
          Type · Paste · Enter to call · Backspace to delete · Esc to clear
        </div>
      </div>

      {/* v0.10.218 — Click-to-Dial couldn't read a phone number out of the
          text the user highlighted. Shown instead of prefilling, so nobody
          hits Call on garbage. */}
      {/* v0.10.221 — two levels now. An error means the field was left empty
          on purpose; the info variant explains a field that WAS filled but
          looks unchanged (same clipboard as last time), which is why it's
          role="status" — announcing it as an alert would misrepresent a
          working capture as a failure. */}
      {capture && (
        <div
          className={`dial-selection-error${capture.level === 'info' ? ' is-info' : ''}`}
          role={capture.level === 'error' ? 'alert' : 'status'}
        >
          {capture.level === 'error' ? <AlertCircle size={15} /> : <Info size={15} />}
          <span>
            {capture.message}
            {capture.hint && <span className="dial-selection-error-hint">{capture.hint}</span>}
          </span>
          <button
            type="button"
            className="dial-selection-error-dismiss"
            onClick={() => setCapture(null)}
            aria-label="Dismiss"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {(() => {
        const country = detectCountry(number);
        return (
          <div className="number-display" aria-live="polite">
            <img
              className="number-display-flag-img"
              src={flagImageUrl(country.iso)}
              alt={country.iso}
              title={country.iso}
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.visibility = 'hidden';
              }}
            />
            <span className="number-display-prefix-label">+{country.callingCode}</span>
            <input
              ref={inputRef}
              type="tel"
              inputMode="tel"
              className="number-display-input"
              value={formatNumber(number)}
              placeholder="Enter phone number"
              /* v0.10.167 UX-020 - explicit aria-label so screen readers
                 announce "Phone number to dial" instead of just the
                 (typed digits) with no context. */
              aria-label="Phone number to dial"
              spellCheck={false}
              autoComplete="off"
              onChange={(e) => {
                // v0.10.167 UX-041 - preserve caret position across the
                // re-format that happens when smartNormalize prepends '+'
                // or formatNumber inserts spaces/parens. Previously
                // typing a digit in the middle of an existing number
                // jumped the cursor to the end. We measure the number
                // of DIGIT characters before the caret, run the format,
                // then put the caret back at the same digit-index.
                const inputEl = e.target;
                const caretBefore = inputEl.selectionStart ?? inputEl.value.length;
                const digitsBeforeCaret = inputEl.value
                  .slice(0, caretBefore)
                  .replace(/[^\d*#+]/g, '').length;
                // Store raw chars; let formatter re-format on next render.
                // smartNormalize prepends '+' when a complete international
                // number is recognized (e.g., 12 digits starting with 91 → India).
                const raw = inputEl.value.replace(/[^\d*#+]/g, '');
                setNumber(smartNormalize(raw) || '');
                requestAnimationFrame(() => {
                  const formatted = formatNumber(smartNormalize(raw) || '');
                  let pos = 0;
                  let seen = 0;
                  while (pos < formatted.length && seen < digitsBeforeCaret) {
                    if (/[\d*#+]/.test(formatted[pos])) seen++;
                    pos++;
                  }
                  try { inputEl.setSelectionRange(pos, pos); } catch { /* noop */ }
                });
              }}
              onPaste={(e) => {
                // Intercept paste to do smart country-code detection so things
                // like "918850415617" become "+918850415617" with the India flag.
                const text = e.clipboardData?.getData('text');
                if (text) {
                  e.preventDefault();
                  setNumber(parsePastedNumber(text));
                }
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void handleCall();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  clear();
                }
              }}
            />
          </div>
        );
      })()}

      <div className="keypad">
        {KEYS.map(({ digit, letters }) => (
          <button
            key={digit}
            type="button"
            className="keypad-btn"
            onClick={() => append(digit)}
          >
            <span className="digit">{digit}</span>
            {letters && <span className="letters">{letters}</span>}
          </button>
        ))}
      </div>

      <div className="dialpad-actions">
        {/* v0.10.108 — Left slot is a spacer to keep the Call button
            centered now that the Recent button is gone. */}
        <span className="contacts-btn-spacer" aria-hidden="true" />
        <button
          type="button"
          className="call-btn"
          onClick={handleCall}
          disabled={
            sipState !== 'registered' ||
            (!hasDialableInput && !canRecallLastDialed)
          }
          /* v0.10.169 - UX-048 - was a binary ternary that said
             "Recall last number" even when the input was empty AND no
             last-dialed number existed (so the button was disabled).
             Now three states so SR users hear what the button actually
             does in its current state. */
          aria-label={
            hasDialableInput
              ? 'Call'
              : canRecallLastDialed
                ? 'Recall last number'
                : 'Type a number to call'
          }
          title={
            !hasDialableInput && canRecallLastDialed
              ? 'Press to bring back the last dialed number'
              : 'Call'
          }
        >
          <Phone size={32} strokeWidth={2} fill="white" />
        </button>
        {hasDialableInput ? (
          <button
            type="button"
            className="backspace-btn"
            onClick={backspace}
            aria-label="Delete"
          >
            <Delete size={26} />
          </button>
        ) : (
          <span className="contacts-btn-spacer" aria-hidden="true" />
        )}
      </div>
    </div>
  );
}
