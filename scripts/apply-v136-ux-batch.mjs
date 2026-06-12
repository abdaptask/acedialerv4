#!/usr/bin/env node
// v0.10.136 - UI/UX batch fix: UX-001, UX-003, UX-007
//
// Targets the three highest-impact P1 findings from UI_UX_AUDIT.md.
//
// UX-001 — Accessibility: no keyboard focus indicator anywhere in the app.
//   Fix: add a global :focus-visible rule at the very top of styles.css.
//   Net effect: pressing Tab now surfaces a visible blue ring on the
//   focused element. Mouse interactions unaffected via :focus:not(:focus-visible).
//
// UX-003 — Stability: TelnyxStatusBanner.tsx:55 returns null BEFORE
//   calling useState/useEffect. This is the same Rules-of-Hooks
//   violation that crashed v0.10.122/.125/.127/.129 with React error #310.
//   The component only survives because isCurrentUserAdmin() returns
//   a stable value during a single mount lifetime, but if the admin
//   claim flips (token refresh after role change) the whole tree crashes.
//   Fix: move hooks BEFORE the early return; gate the network polling
//   inside the useEffect with a same admin check (so non-admins still
//   pay no network cost).
//
// UX-007 — Responsive layout: dialpad call button gets clipped at
//   1366x768 with 125% DPI scaling - the most common Windows business
//   laptop config. Currently the .dialpad overflows and the green call
//   button sits below the visible area; user has to scroll to find it.
//   Fix: add a @media (max-height: 720px) block that shrinks the keypad
//   buttons + tightens padding so everything fits on screen.
//
// SCOPE: server NO-OP. Pure client-side. Affects:
//   apps/web/src/styles.css (UX-001 + UX-007)
//   apps/web/src/components/TelnyxStatusBanner.tsx (UX-003)
//   Plus 7x package.json version bumps + DiagnosticsSection.tsx APP_VERSION
//   + whatsNew.ts entry.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
console.log(`[apply-v136] CWD: ${ROOT}`);

function applyEdits(relPath, edits) {
  const fp = join(ROOT, relPath);
  if (!existsSync(fp)) {
    console.error(`[apply-v136] FATAL: file not found: ${fp}`);
    process.exit(1);
  }
  let content = readFileSync(fp, 'utf8');
  const initialLen = content.length;
  const usesCRLF = content.includes('\r\n');
  const normalize = (s) => usesCRLF ? s.replace(/\r?\n/g, '\r\n') : s.replace(/\r\n/g, '\n');

  for (const [i, edit] of edits.entries()) {
    const find = normalize(edit.find);
    const replace = normalize(edit.replace);
    if (!content.includes(find)) {
      console.error(`[apply-v136] FATAL in ${relPath}: edit #${i + 1} (${edit.label}) - anchor not found`);
      console.error(`  anchor (first 200): ${JSON.stringify(find.slice(0, 200))}`);
      process.exit(1);
    }
    if (content.split(find).length - 1 > 1) {
      console.error(`[apply-v136] FATAL in ${relPath}: edit #${i + 1} (${edit.label}) - matches more than once`);
      process.exit(1);
    }
    content = content.replace(find, replace);
    console.log(`  ✓ ${relPath} edit ${i + 1}/${edits.length} (${edit.label})`);
  }
  writeFileSync(fp, content, 'utf8');
  console.log(`  ${relPath}: ${initialLen} → ${content.length} bytes (${usesCRLF ? 'CRLF' : 'LF'})`);
}

// ===========================================================
// UX-001 + UX-007 - styles.css edits
// ===========================================================
applyEdits('apps/web/src/styles.css', [
  {
    label: 'UX-001: insert global :focus-visible accessibility rule at top of stylesheet',
    find: `/* ============ THEME TOKENS ============
   Defaults are the dark theme. The [data-theme="light"] block at the bottom
   of this section overrides for light mode. JavaScript flips
   <html data-theme="light"|"dark"> based on user preference + OS setting. */`,
    replace: `/* ============ GLOBAL ACCESSIBILITY (v0.10.136 — UX-001) ============
   Single rule unlocks keyboard-navigation visibility across the entire app.
   Before this, Tabbing through the dialer left zero visual indication of
   which element had focus (the only explicit outline rule in the stylesheet
   was \`outline: none\` on form inputs). Keyboard-only users and screen-reader
   users using sighted assistants had no way to track focus.

   Strategy: :focus-visible only fires when the browser determines focus
   came from KEYBOARD navigation (Tab, arrow keys, etc.) - not mouse clicks.
   So mouse users see no visual change; keyboard users get a clear blue ring.
   The accent-blue var is defined a few lines below in :root so this rule
   loads before its value, but CSS resolves vars at use-time, so order is fine. */
:focus-visible {
  outline: 2px solid var(--accent-blue);
  outline-offset: 2px;
  border-radius: inherit;
}
:focus:not(:focus-visible) { outline: none; }

/* ============ THEME TOKENS ============
   Defaults are the dark theme. The [data-theme="light"] block at the bottom
   of this section overrides for light mode. JavaScript flips
   <html data-theme="light"|"dark"> based on user preference + OS setting. */`,
  },
  {
    label: 'UX-007: add short-viewport dialpad media query after .dialpad rule',
    find: `  /* Belt-and-suspenders: if content STILL exceeds the viewport (e.g.
     a user has DPI scaling cranked to 150%+ AND window dragged tiny),
     scroll instead of clip. Internal scrolling on the dialpad container
     itself rather than the page body, so the bottom-nav stays in place. */
  overflow-y: auto;
}
/* ============ DIALPAD TOP STRIP (hint + status) ============ */`,
    replace: `  /* Belt-and-suspenders: if content STILL exceeds the viewport (e.g.
     a user has DPI scaling cranked to 150%+ AND window dragged tiny),
     scroll instead of clip. Internal scrolling on the dialpad container
     itself rather than the page body, so the bottom-nav stays in place. */
  overflow-y: auto;
}
/* v0.10.136 - UX-007 - shrink the dialpad on short viewports.
   1366x768 with Windows 125% DPI scaling = ~480 device-pixel height for
   the dialpad after tab bar + header + (sometimes) update-banner +
   return-to-call-banner. The pre-fix keypad needed ~525px. The buttons
   below get reduced from 72px to 60px which saves enough vertical space
   for the green call button to sit fully on screen without scrolling.
   No effect on taller viewports (the media query bails out above 720px). */
@media (max-height: 720px) {
  .keypad-btn,
  .call-btn,
  .backspace-btn,
  .contacts-btn { width: 60px; height: 60px; }
  .keypad-btn .digit { font-size: 1.7rem; }
  .keypad { gap: 0.7rem 0; }
  .dialpad-actions { padding-top: 0.8rem; }
  .number-display { padding: 0.7rem 0.5rem; min-height: 3.4rem; }
}
/* ============ DIALPAD TOP STRIP (hint + status) ============ */`,
  },
]);

// ===========================================================
// UX-003 - TelnyxStatusBanner Rules-of-Hooks fix
// ===========================================================
applyEdits('apps/web/src/components/TelnyxStatusBanner.tsx', [
  {
    label: 'UX-003: move hooks BEFORE early-return (Rules-of-Hooks compliance)',
    find: `export default function TelnyxStatusBanner() {
  // v0.10.117 - only show this banner to admins. Regular users don't
  // need (or want) to see Telnyx outage info; it's noise for them.
  // Returns null BEFORE any state/effect hooks so the component is a
  // complete no-op for non-admin users (no fetches, no timers).
  if (!isCurrentUserAdmin()) return null;

  const [status, setStatus] = useState<TelnyxStatus | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      if (cancelled) return;
      try {
        const r = await fetch(WEBHOOKS_URL + '/telnyx-status');
        if (!r.ok) return;
        const j = (await r.json()) as TelnyxStatus;
        if (cancelled) return;
        setStatus(j);
      } catch {
        /* network errors silent */
      }
    }
    void poll();
    const interval = setInterval(poll, 60_000);
    const onFocus = () => { void poll(); };
    window.addEventListener('focus', onFocus);
    return () => {
      cancelled = true;
      clearInterval(interval);
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  useEffect(() => {
    setDismissed(false);
  }, [status?.indicator]);

  if (!status || dismissed) return null;`,
    replace: `export default function TelnyxStatusBanner() {
  // v0.10.136 - UX-003 - hooks MUST be called before any early return,
  // otherwise React throws error #310 ("Rendered more hooks than during
  // the previous render") the moment isCurrentUserAdmin() changes value
  // mid-mount (e.g. after a token refresh that changes the admin claim).
  // This is the same Rules-of-Hooks violation that crashed v0.10.122/
  // .125/.127/.129 in IncomingCall.tsx. The admin check now lives both
  // INSIDE the poll-init useEffect (so non-admins never pay any network
  // cost) AND in the render-return path below (so non-admins still see
  // nothing).
  const [status, setStatus] = useState<TelnyxStatus | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // Non-admins: do nothing. The effect still RUNS (so hooks order is
    // stable across renders), but it doesn't kick off any timers or
    // network calls - same behavior the old early-return had, just
    // moved one level inwards.
    if (!isCurrentUserAdmin()) return;

    let cancelled = false;
    async function poll() {
      if (cancelled) return;
      try {
        const r = await fetch(WEBHOOKS_URL + '/telnyx-status');
        if (!r.ok) return;
        const j = (await r.json()) as TelnyxStatus;
        if (cancelled) return;
        setStatus(j);
      } catch {
        /* network errors silent */
      }
    }
    void poll();
    const interval = setInterval(poll, 60_000);
    const onFocus = () => { void poll(); };
    window.addEventListener('focus', onFocus);
    return () => {
      cancelled = true;
      clearInterval(interval);
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  useEffect(() => {
    setDismissed(false);
  }, [status?.indicator]);

  if (!isCurrentUserAdmin()) return null;
  if (!status || dismissed) return null;`,
  },
]);

// ===========================================================
// Version bumps to 0.10.136
// ===========================================================
const PKGS = [
  'package.json',
  'apps/api/package.json',
  'apps/web/package.json',
  'apps/desktop/package.json',
  'apps/socket/package.json',
  'apps/webhooks/package.json',
  'packages/db/package.json',
];
for (const rp of PKGS) {
  const fp = join(ROOT, rp);
  let c = readFileSync(fp, 'utf8');
  const before = c;
  c = c.replace(/"version":\s*"0\.10\.135"/, '"version": "0.10.136"');
  if (c === before) {
    console.warn(`  ⚠ ${rp}: not at 0.10.135 - skipping`);
  } else {
    writeFileSync(fp, c, 'utf8');
    console.log(`  ✓ ${rp}: bumped 0.10.135 → 0.10.136`);
  }
}

// ===========================================================
// DiagnosticsSection.tsx APP_VERSION
// ===========================================================
applyEdits('apps/web/src/components/DiagnosticsSection.tsx', [
  {
    label: 'bump APP_VERSION to 0.10.136',
    find: `const APP_VERSION = '0.10.135';`,
    replace: `const APP_VERSION = '0.10.136';`,
  },
]);

// ===========================================================
// whatsNew.ts v0.10.136 entry
// ===========================================================
applyEdits('apps/web/src/data/whatsNew.ts', [
  {
    label: 'add v0.10.136 release entry at top',
    find: `export const WHATS_NEW: ReleaseEntry[] = [\n  {\n    version: '0.10.135',`,
    replace: `export const WHATS_NEW: ReleaseEntry[] = [\n  {\n    version: '0.10.136',\n    date: 'June 12, 2026',\n    highlight: 'Three high-impact UI/UX fixes - keyboard focus, latent crash prevention, dialpad fits on 1366x768 laptops',\n    changes: [\n      { type: 'improved', text: 'Keyboard navigation now shows a visible focus ring when you Tab through any page. Previously the dialer had zero focus indicator anywhere - keyboard-only users and screen-reader users had no way to track which element was focused. Mouse interactions are unchanged (the focus ring only appears for keyboard navigation).' },\n      { type: 'fixed', text: 'Prevented a latent React crash in the Telnyx status banner. The banner was calling React hooks AFTER an early return, which is the same Rules-of-Hooks violation that crashed the floater Reply with Text feature multiple times (v0.10.122/.125/.127/.129). The crash would have fired the moment a user changed admin status mid-session (e.g. token refresh). Hooks now run before the admin check.' },\n      { type: 'fixed', text: 'Dialpad green call button no longer gets clipped at 1366x768 with Windows 125 percent display scaling - the most common Windows business laptop configuration. The keypad buttons and spacing now shrink on short viewports so the call button stays fully visible without scrolling.' },\n    ],\n  },\n  {\n    version: '0.10.135',`,
  },
]);

console.log('\n[apply-v136] ALL EDITS APPLIED SUCCESSFULLY');
console.log('Next steps:');
console.log('  1. node scripts/strip-null-bytes.mjs');
console.log('  2. npx tsc --noEmit -p apps/web/tsconfig.json');
console.log('  3. git diff --stat');
console.log('  4. git add -A && git commit -m "v0.10.136: UX-001 focus-visible + UX-003 hooks-rules + UX-007 short-viewport dialpad"');
console.log('  5. git push');
console.log('');
console.log('After build:');
console.log('  - Install v0.10.136 .exe on your machine');
console.log('  - Tab through pages: focus ring appears');
console.log('  - Open Settings as admin: Telnyx banner still shows (no regression)');
console.log('  - Resize Electron window short (e.g. 900x720): green call button visible without scrolling');
console.log('');
console.log('When happy, Publish v0.10.136 GitHub release for all 40+ users.');
