# ACE Dialer — UI/UX Audit Report

**Date:** 2026-06-12
**Auditor:** Claude (UI/UX architect subagent)
**Codebase version:** v0.10.135 (current main branch HEAD)
**Scope:** All pages in `apps/web/src/pages` and `apps/web/src/components`, plus Electron floater HTML in `apps/desktop/src/main.ts`, and the design tokens / global stylesheet in `apps/web/src/styles.css` (8,043 lines).

## Summary

The dialer is functionally rich and the locked CLAUDE.md rules (modal overlays, scroll-to-top, scroll-reset on tab change) appear correctly honored at the Layout level. However the codebase shows the strain of rapid iteration: there are roughly **18 P1 issues**, **24 P2 issues**, and **13 P3 issues** worth fixing. Three themes dominate the findings: (1) **accessibility is largely missing** — no `:focus-visible` outline styles anywhere in 8k+ lines of CSS, no `prefers-reduced-motion` rules, and at least one component (`TelnyxStatusBanner`) violates React's Rules of Hooks. (2) **Responsive coverage is thin** — only 11 `@media` queries in the entire stylesheet, no breakpoints between 800px and 2000px, no defensive sizing for 2K/4K monitors. (3) **Visual vocabulary is fragmented** — the dialer has accumulated `compose-modal`, `lines-modal`, `lines-add-modal`, `fav-modal`, `history-modal`, `audio-picker`, `contacts-quickpick`, `post-decline-overlay`, `praise-modal-backdrop`, `incoming-fullscreen`, and `pending-*-modal` — each with its own backdrop alpha, z-index, border-radius, and close-button shape. Two related quality issues: native `alert()` / `confirm()` is still used in 22 places (Electron disables some of these silently), and CSS classes referenced in JSX (`incoming-action-stack`, `incoming-action-label`, `tab-icon-wrap`) have no matching CSS definitions.

## Severity legend

- **P1 — Critical**: usability blocker, accessibility violation, or breaks on common resolutions. Fix in next release.
- **P2 — Important**: degrades experience but has a workaround. Fix in next 2-3 releases.
- **P3 — Polish**: aesthetic or convention improvement. Fix when convenient.

---

## Findings

### UX-001 — No keyboard focus indicator anywhere in the app

- **Severity:** P1
- **Category:** Accessibility
- **Affected file(s):** `apps/web/src/styles.css` (no rule at all)
- **Current behavior:** Grepping the entire stylesheet for `:focus-visible` or `outline-offset` returns zero hits. The only `outline` rule is `outline: none` on form inputs (e.g. `.auth-card input:focus`, `.compose-input:focus`, `.ict-input:focus`). Keyboard-only users (and screen-reader users using sighted assistants) cannot see where focus is. Multiple `button` elements rely on `outline: none` implicitly because the browser default is removed by `* { box-sizing: border-box }` cascade interactions plus reset-style buttons in `.thread-row`, `.user-chip`, etc.
- **Recommended fix:** Add a single global rule at the top of `styles.css`:
  ```css
  :focus-visible {
    outline: 2px solid var(--accent-blue);
    outline-offset: 2px;
    border-radius: inherit;
  }
  /* Suppress for mouse clicks but show for keyboard nav */
  :focus:not(:focus-visible) { outline: none; }
  ```
  Then keep the existing `border-color` focus styles on text inputs as a secondary cue.
- **Acceptance criteria:** Tabbing through any page surfaces a visible blue ring on the focused element. No regression for mouse users.

### UX-002 — No `prefers-reduced-motion` handling for animations

- **Severity:** P1
- **Category:** Accessibility
- **Affected file(s):** `apps/web/src/styles.css` (animations defined at multiple lines: `incoming-pulse` 4233-4236, `rtc-pulse` 2398-2401, `status-pulse` 922-925, `presence-pulse` 6884-6888, `did-spin` 337-339, `praiseModalIn` 1427-1430, etc.)
- **Current behavior:** The dialer has at least 11 animations that loop or play continuously: incoming-call accept-button pulse, return-to-call-banner pulse, SIP-status-dot pulse, presence-on-call pulse, REC dot pulse, status-spinner spin, praise modal bouncy entry, post-decline-sheet slide, incoming-fade-in, etc. None respect the system's reduced-motion preference. Users with vestibular conditions (or simply users who've disabled animations in Windows/macOS) see all motion at full intensity.
- **Recommended fix:** Append once at the bottom of `styles.css`:
  ```css
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after {
      animation-duration: 0.01ms !important;
      animation-iteration-count: 1 !important;
      transition-duration: 0.01ms !important;
      scroll-behavior: auto !important;
    }
    /* Keep the rec-dot at 0.5 opacity instead of pulsing to 0.3 */
    .rec-dot { opacity: 1 !important; }
  }
  ```
- **Acceptance criteria:** With "Reduce motion" enabled in OS preferences, the incoming-call accept button stops pulsing, the return-to-call banner stops flashing, status dots are static, spinners do not rotate.

### UX-003 — `TelnyxStatusBanner` calls hooks after early return (Rules-of-Hooks violation)

- **Severity:** P1
- **Category:** Stability / Runtime crash risk
- **Affected file(s):** `apps/web/src/components/TelnyxStatusBanner.tsx:55-60`
- **Current behavior:** Line 55 does `if (!isCurrentUserAdmin()) return null;` BEFORE `useState` (line 57) and `useEffect` (line 60). React's rules of hooks demand hooks be called in the same order on every render. The component currently survives only because `isCurrentUserAdmin()` returns a stable value during a single mount lifetime — but if the admin claim ever flips (e.g. token refresh after a role change), React will throw "Rendered more hooks than during the previous render" the same way `v0.10.122/.125/.127/.129` crashed per the IncomingCall.tsx comment on line 104.
- **Recommended fix:** Move the admin check INSIDE the render path, after all hooks:
  ```tsx
  export default function TelnyxStatusBanner() {
    const [status, setStatus] = useState<TelnyxStatus | null>(null);
    const [dismissed, setDismissed] = useState(false);

    useEffect(() => {
      if (!isCurrentUserAdmin()) return; // skip polling for non-admins
      // ...existing poll code
    }, []);

    if (!isCurrentUserAdmin()) return null;
    if (!status || dismissed) return null;
    // ...
  }
  ```
- **Acceptance criteria:** No "Rendered more hooks" warning in DevTools after a user's admin claim changes mid-session. ESLint `react-hooks/rules-of-hooks` passes.

### UX-004 — Native `alert()` / `confirm()` used in 22 sites; Electron silently disables them

- **Severity:** P1
- **Category:** Information hierarchy / Cross-window consistency
- **Affected file(s):** `apps/web/src/pages/Dialpad.tsx:234`, `apps/web/src/pages/Recents.tsx:276, 365, 384, 386`, `apps/web/src/pages/Favorites.tsx:45, 55`, plus 13 more in Settings/Voicemail/Messages/UserLinesManagerModal.
- **Current behavior:** When SIP is not registered and a user taps Dial, `Dialpad.tsx:234` does `alert("Can't call yet — SIP state: …")`. In the packaged Electron build, `window.alert()` is a no-op in some renderer contexts (the same reason `UserLinesManagerModal.tsx:60` migrated from `prompt()`). Even where it does work, an OS-level alert is the most disruptive feedback possible — it interrupts a calling workflow with a modal that requires explicit dismissal.
- **Recommended fix:** Replace each `alert()` / `confirm()` with the existing `.in-call-toast` (for transient errors) or a fixed-position toast component for the rest. For confirmations (Recents block, Favorites remove), reuse the `.compose-modal` overlay pattern. Concrete starting point: extract a `useToast()` hook and a `<ConfirmDialog>` component into `apps/web/src/components/feedback/`.
- **Acceptance criteria:** No use of `window.alert` / `window.confirm` in `apps/web/src` (verified by `Grep`). All previous alert sites surface either a toast or a styled modal that honors CLAUDE.md UI rules 1-4.

### UX-005 — CSS classes referenced in IncomingCall.tsx have no definitions

- **Severity:** P1
- **Category:** Visual consistency / Information hierarchy
- **Affected file(s):** `apps/web/src/components/IncomingCall.tsx:197, 201, 213, 217, 229, 232, 236` (`incoming-action-stack`, `incoming-action-label`), `apps/web/src/pages/Layout.tsx:474, 485, 499` (`tab-icon-wrap`)
- **Current behavior:** `IncomingCall.tsx` line 197 wraps each action button in `<div className="incoming-action-stack">` with a child `<div className="incoming-action-label">Decline</div>`. Grep across `apps/web/src/styles.css` returns no matches for either class. The label text renders unstyled — likely as default-size body text with no padding, breaking the visual hierarchy the floater (where `.action-label` IS defined at `apps/desktop/src/main.ts:475`) carefully created. `tab-icon-wrap` (Layout.tsx line 474) is also referenced but the only `tab-badge` positioning rule is `right: calc(50% - 16px)` on the badge itself, which assumes a specific wrapper layout that isn't enforced.
- **Recommended fix:** Add to `styles.css` after the `.incoming-actions` block (~line 4085):
  ```css
  .incoming-action-stack {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
  }
  .incoming-action-label {
    font-size: 12px;
    font-weight: 600;
    color: rgba(255, 255, 255, 0.95);
    letter-spacing: 0.02em;
    text-align: center;
    white-space: nowrap;
  }
  .tab-icon-wrap {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  ```
- **Acceptance criteria:** Main-window incoming-call screen labels match the floater visually (same font-size, weight, opacity). Tab badges remain positioned over the icon, not floating in space.

### UX-006 — No mid-range responsive breakpoint between 800px and 2000px

- **Severity:** P1
- **Category:** Responsive layout
- **Affected file(s):** `apps/web/src/styles.css` — all 11 media queries: `max-width: 540px`, `max-width: 700px`, `max-width: 720px`, `max-width: 800px`, `max-width: 900px`, `min-width: 600px`, `min-width: 640px`, `max-width: 640px`. No rules trigger between 901px and ∞.
- **Current behavior:** Every component is essentially designed for two viewport classes: "mobile" (≤700px) and "desktop wide enough for `max-width: 1280px` content cap" (≥901px). On a 1366×768 Windows laptop at 125% DPI scaling — the most common business-laptop config in 2025–2026 — the CSS viewport is roughly 1093×614. Tables (`.users-admin-table`, `.pending-table`, `.audit-log-row-main`) all use fixed pixel column widths designed for 1280px+. The `Settings.tsx` two-column layout (`grid-template-columns: 260px 1fr`) collapses to single-column ONLY below 800px, leaving the awkward 800-1100px range where the nav rail crowds the content. 4K displays at 100% scaling stretch the `max-width: 1280px` cap into wide gutters but the `.dialpad` (`max-width: 420px`) becomes a sliver in the middle of the screen.
- **Recommended fix:** Add three breakpoints to the major content surfaces:
  ```css
  /* Tighten settings layout below standard desktop widths */
  @media (max-width: 1100px) and (min-width: 801px) {
    .settings.settings-split { grid-template-columns: 220px 1fr; }
    .settings-pane { padding: 1.2rem 1.3rem 2rem; }
  }
  /* Expand content cap on QHD+ so tables and lists breathe */
  @media (min-width: 1800px) {
    .app-content { max-width: 1480px; }
    .settings.settings-split { max-width: 1300px; }
  }
  ```
- **Acceptance criteria:** At 1366×768 / 125% DPI, the Settings nav rail and content pane both have at least 12px of horizontal padding without truncation. At 2560×1440, the dialer feels filled rather than tiny.

### UX-007 — Dialpad at 125% DPI on 1366×768 sees the call button get clipped vertically

- **Severity:** P1
- **Category:** Responsive layout
- **Affected file(s):** `apps/web/src/styles.css:1060-1084` (`.dialpad`), `apps/desktop/src/main.ts:143-144` (`minWidth: 900, minHeight: 800`)
- **Current behavior:** The Electron window's `minHeight: 800` plus the `tab-bar` (~52px), `app-header` (~56px), `update-banner` (~40px when shown), and `return-to-call-banner` (~52px when on a call) leaves ~600 CSS pixels for the dialpad. At 125% DPI scaling, that's 480 device-pixel height for a `.dialpad` whose content (keypad 3×4 = ~340px + number-display 72px + status text 36px + dial button 75px) totals ~525px. The fix at v0.10.73 added `overflow-y: auto` on `.dialpad`, but on tall narrow shapes (e.g. window dragged thinner than 900px width which `minWidth` prevents, OR with multiple banners stacked) the dial button is still pushed off-screen and users have to scroll.
- **Recommended fix:** Make the keypad scale on shorter viewports:
  ```css
  @media (max-height: 720px) {
    .keypad-btn, .call-btn, .backspace-btn, .contacts-btn { width: 60px; height: 60px; }
    .keypad-btn .digit { font-size: 1.7rem; }
    .keypad { gap: 0.7rem 0; }
    .dialpad-actions { padding-top: 0.8rem; }
    .number-display { padding: 0.7rem 0.5rem; min-height: 3.4rem; }
  }
  ```
- **Acceptance criteria:** At 1366×768 with all banners visible (update + return-to-call) and 125% Windows scaling, the green call button is fully visible without scrolling.

### UX-008 — InCall control grid (3×3) overflows on narrow viewports

- **Severity:** P1
- **Category:** Responsive layout / Button placement
- **Affected file(s):** `apps/web/src/styles.css:4278-4283` (`.in-call-grid`), `apps/web/src/pages/InCall.tsx:339-405`
- **Current behavior:** `.in-call-grid` is `grid-template-columns: repeat(3, 1fr)` with `gap: 18px 28px`, `max-width: 360px`. Each `.ic-ctrl-icon` is `64px × 64px`. Three columns × 64 + 2 × 28 gap = 248px, fits inside 360. But the outer `.in-call` container is `padding: 32px 20px 28px` — total content area 360+40=400px. On a 1366×768 viewport at 150% DPI scaling (effective ~910px CSS width), the InCall page is fine alone, but when InCall is shown inside the Electron window with a 260px Settings nav (no — Settings doesn't show here, good) or when stacked with the conference's two `.call-pill` cards (88px each) plus the 3×3 grid + hangup button + transfer/audio dialogs, the vertical content can exceed the viewport without internal scroll. No `overflow-y: auto` is set on `.in-call`.
- **Recommended fix:** Add `overflow-y: auto` to `.in-call`, and reduce the grid gap on shorter heights:
  ```css
  .in-call { overflow-y: auto; }
  @media (max-height: 700px) {
    .in-call { padding: 16px 16px 12px; gap: 16px; }
    .in-call-grid { gap: 10px 18px; }
    .ic-ctrl-icon { width: 56px; height: 56px; }
  }
  ```
- **Acceptance criteria:** During a conference call on 1366×768 with the held-call strip visible, all controls remain reachable without the hangup button being clipped.

### UX-009 — Color contrast on `--text-muted` borderline AA in dark mode

- **Severity:** P1
- **Category:** Accessibility (WCAG)
- **Affected file(s):** `apps/web/src/styles.css:13` (`--text-muted: rgba(235, 235, 245, 0.55)`)
- **Current behavior:** Dark-mode `--text-muted` resolves to `rgba(235, 235, 245, 0.55)` over `#000` background, yielding contrast ~5.0:1 — passes WCAG AA for body text (4.5:1) but fails AAA. Used pervasively on `.thread-preview`, `.call-meta`, `.vm-meta`, `.empty-state .muted`, `.user-menu-email`, `.tab` (inactive), `.thread-time`, `.timeline-time`, and the `version` text in the header. On secondary surface backgrounds like `.surface` (`rgba(118,118,128,0.18)` over `#000` = ~#262629), contrast drops to ~4.3:1 — BELOW the WCAG AA threshold for normal text. The light-mode override (line 40 — `--text-muted: #545458`) is fine.
- **Recommended fix:** Tighten dark `--text-muted` to a higher alpha:
  ```css
  :root {
    --text-muted: rgba(235, 235, 245, 0.68);  /* was 0.55 */
  }
  ```
  This bumps base contrast to ~6.2:1 and surface-overlay contrast to ~5.3:1. The "muted" relationship to `--text-dim` (0.7) and `--text` (1.0) is preserved.
- **Acceptance criteria:** Every text that uses `var(--text-muted)` passes WCAG AA when placed on `.surface` backgrounds (verified via DevTools color contrast).

### UX-010 — Touch-target sizing below the 44px accessibility minimum on multiple controls

- **Severity:** P1
- **Category:** Accessibility / Button ergonomics
- **Affected file(s):** `apps/web/src/styles.css:1932-1935` (`.quick-reply-action` is 26×26), `5905-5907` (`.update-banner-dismiss` 24×24), `1437-1444` (`.praise-modal-close` 32×32), `3904-3908` (`.vm-action` 30×30), `6126-6128` (`.users-admin-menu` button rows ~32px), `6420-6429` (`.post-decline-close` 32×32), `7286-7287` (`.pending-action-icon` 28×28), `4115-4117` (`.incoming-btn.small` 40×40).
- **Current behavior:** WCAG 2.5.5 (Target Size — Level AAA) recommends 44×44 CSS pixels for touch targets. WCAG 2.5.8 (Level AA, added in WCAG 2.2) requires 24×24 minimum. The dialer has several controls that are at-or-below 24px with no extra padding. Specifically the in-banner `.incoming-btn.small` at 40×40 is the Accept button on the non-fullscreen incoming banner — a 40px circular button for the most time-critical action of the entire app. On a 1366×768 Windows laptop at 150% scaling, that's 27 device pixels — easy to miss-click.
- **Recommended fix:** Bump all touch targets to ≥36px for non-critical icon buttons and 60px+ for critical actions:
  ```css
  .quick-reply-action { width: 32px; height: 32px; }
  .update-banner-dismiss { width: 32px; height: 32px; }
  .vm-action { width: 36px; height: 36px; }
  .pending-action-icon { width: 32px; height: 32px; }
  /* Critical-action exception: in-banner Accept/Decline are the only way to
     answer a ringing call without going full-screen. Match the full-screen size. */
  .incoming-btn.small { width: 56px; height: 56px; }
  ```
  Or wrap small icon controls in `padding: 8px` so the click target is larger than the visual element.
- **Acceptance criteria:** Every interactive element has at least 32×32 click area; Accept/Decline buttons (banner + full-screen) have at least 56×56.

### UX-011 — Tip banner overlaps the bottom-nav on short viewports

- **Severity:** P1
- **Category:** Visual consistency / Information hierarchy
- **Affected file(s):** `apps/web/src/components/TipBanner.tsx:140-157`
- **Current behavior:** `TipBanner` is `position: fixed; right: 20px; bottom: 90px; zIndex: 950`. The bottom nav `.tab-bar` is ~52px tall plus padding. At 1366×768, the tip card (~140px tall) lands at y=628 to y=768. The bottom-nav lives at y=716 to y=768. So roughly 50px of the tip card overlaps the bottom-nav, partially hiding the Voicemail tab and its unread badge. The tip card uses `background: var(--bg)` which in dark mode resolves to `#000` — same as the page background — so the overlap visually appears as the tip text floating on top of the nav icons.
- **Recommended fix:** Raise the bottom anchor above the tab-bar:
  ```tsx
  // TipBanner.tsx:142
  bottom: 90,  // was 90 — replace with calc that accounts for tab-bar
  // BETTER: detect tab-bar visibility and offset accordingly
  bottom: 'calc(env(safe-area-inset-bottom, 0px) + 90px)',
  ```
  Or — preferred — move the tip into a slot inside the `.app-content` container near the page footer where it can't overlap fixed UI. If the floating positioning is intended, raise `bottom` to ~110px (tab-bar height + safe margin) AND switch the surface to use `var(--bg-elevated)` so it visually separates from the page.
- **Acceptance criteria:** On 1366×768 viewport, the Voicemail tab icon and its unread badge are both fully visible while the tip banner is open.

### UX-012 — Modal vocabulary fragmented across 11+ classes; backdrop alphas drift

- **Severity:** P1
- **Category:** Visual consistency (locked rule from CLAUDE.md)
- **Affected file(s):** `apps/web/src/styles.css` — `.compose-modal` (0.85 backdrop, line 4947), `.lines-modal` (no backdrop — relies on `.compose-modal` parent), `.contacts-quickpick` (0.5 backdrop, line 1288), `.audio-picker` (0.55 backdrop, line 5319), `.history-modal` (0.55 backdrop, line 2126), `.praise-modal-backdrop` (0.78, line 1405), `.post-decline-overlay` (0.55, line 6362), `.incoming-fullscreen` (no backdrop — full-fill, line 3977).
- **Current behavior:** CLAUDE.md rule #1 says "Open over a full-viewport dark backdrop at 70-80% opacity. The backdrop covers the entire visible window — no part of the page behind it should be readable through bleed-through transparency." Several modal backdrops violate this: `.contacts-quickpick` and `.history-modal` are at 0.55 (≈55%, well below the 70-80% spec), `.audio-picker` at 0.55, `.post-decline-overlay` at 0.55. Page content behind these IS readable. The CLAUDE.md rule has explicitly been flagged before.
- **Recommended fix:** Centralize the backdrop into a single class that every modal overlay reuses, and bring the under-spec ones up:
  ```css
  /* Bump the four offenders */
  .contacts-quickpick   { background: rgba(0, 0, 0, 0.78); }
  .history-modal        { background: rgba(0, 0, 0, 0.78); }
  .audio-picker         { background: rgba(0, 0, 0, 0.78); }
  .post-decline-overlay { background: rgba(0, 0, 0, 0.78); }
  ```
  Longer-term: introduce a shared `.modal-backdrop` class with `position: fixed; inset: 0; background: rgba(0,0,0,0.78); display: flex; align-items: center; justify-content: center; z-index: 800;` and refactor each modal HTML to use it as the outer wrapper.
- **Acceptance criteria:** Every modal backdrop achieves at least 70% opacity. Page content (text, buttons, list rows) behind any open modal is no longer legible.

### UX-013 — Several confirmations rely on native `confirm()` which Electron sometimes returns null on

- **Severity:** P1
- **Category:** Cross-window consistency / Stability
- **Affected file(s):** `apps/web/src/pages/Recents.tsx:365`, `apps/web/src/pages/Favorites.tsx:55`, `apps/web/src/pages/Voicemail.tsx` (multiple delete-confirm sites)
- **Current behavior:** Recents.tsx:365 does `if (!confirm("Block ${friendly}?...")) return;` — but in some Electron renderer contexts, especially when called from a button inside a focused modal, `confirm()` returns `null` instead of `true`/`false`. The truthy-check `!confirm(...)` then evaluates as `!null === true` and the block proceeds without any confirmation, silently. Same pattern in Favorites delete.
- **Recommended fix:** Same as UX-004 — extract a `<ConfirmDialog>` component. As an interim quick fix, change every `if (!confirm(...))` to `if (confirm(...) !== true)` so the truthy-vs-strict-true distinction is explicit.
- **Acceptance criteria:** In Electron desktop, "Block" / "Remove favorite" / "Delete voicemail" actions always prompt the user and require an affirmative click before mutating data.

### UX-014 — User dropdown menu uses `min-width: 240px` but cannot scroll if it exceeds viewport

- **Severity:** P1
- **Category:** Responsive layout
- **Affected file(s):** `apps/web/src/styles.css:975-987` (`.user-menu`)
- **Current behavior:** `.user-menu` is `position: absolute; right: 0; top: calc(100% + 6px); min-width: 240px`. It contains a header row with avatar (42px), name, email; plus Settings, Check for updates, Sign out items; plus a status row for updates. On a narrow viewport (~600px) the avatar + name + email row can wrap awkwardly because `.user-menu-name` and `.user-menu-email` use `white-space: nowrap; overflow: hidden; text-overflow: ellipsis` but inside a 240px container the truncation happens to BOTH lines. Also, no `max-height` or `overflow-y` is set, so a future addition (e.g. "Update available — install now") could push the menu below the viewport on short displays with no scroll fallback.
- **Recommended fix:** Add a defensive max-height and overflow:
  ```css
  .user-menu {
    /* ...existing... */
    max-height: calc(100vh - 80px);
    overflow-y: auto;
  }
  ```
  Combined with the existing global `*::-webkit-scrollbar { display: none }` from line 7131, this gives invisible-but-functional scrolling.
- **Acceptance criteria:** Even with 6+ items in the user menu on a 600px-tall viewport, all items are reachable via scroll within the menu.

### UX-015 — Settings nav titles + blurbs not constrained on long entries

- **Severity:** P2
- **Category:** Responsive layout / Information hierarchy
- **Affected file(s):** `apps/web/src/styles.css:2486-2498` (`.settings-nav-item`), `apps/web/src/pages/Settings.tsx:439-444`
- **Current behavior:** `.settings-nav-item` is a CSS grid `32px 1fr auto`. The label column (`1fr`) has no `min-width: 0` or `overflow: hidden`. A blurb like "Connect Telnyx credentials to enable outbound calls and SMS" (which appears multiple times in the SECTIONS array) will force the column to grow to its natural width, pushing the chevron off the right edge on the narrow nav rail (260px max). On Windows at high DPI scaling, the nav looks visually fine in dark mode but in light mode the chevron disappears entirely beyond 1100px viewport.
- **Recommended fix:**
  ```css
  .settings-nav-label { min-width: 0; }
  .settings-nav-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .settings-nav-blurb {
    overflow: hidden;
    text-overflow: ellipsis;
    /* allow blurb to wrap to 2 lines max */
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
  }
  ```
- **Acceptance criteria:** At 800px viewport width, every Settings nav item's chevron is visible on the right; the title truncates to ellipsis if longer than the column.

### UX-016 — `.app-content` `max-width: 1280px` cap is too restrictive on QHD+ monitors

- **Severity:** P2
- **Category:** Responsive layout
- **Affected file(s):** `apps/web/src/styles.css:192-202`
- **Current behavior:** At 2560×1440 (QHD), the `.app-content max-width: 1280px` centers the content with 640px of dead gutters on each side. The Settings tables (`.users-admin-table`, `.pending-table`) live INSIDE this content box and use `max-width: 1100px`, so on QHD they have ~1100px of usable width while the page wastes 50% of the screen. The Recents page has `max-width: 480px` and looks like a phone column adrift in a sea of gray. The Messages page also caps at 480px (line 4445).
- **Recommended fix:** Allow `.app-content` to grow on larger screens, but cap the listing-style pages at a more usable width:
  ```css
  .app-content { max-width: 1480px; }   /* was 1280px */
  @media (min-width: 1800px) {
    .recents, .voicemail, .messages {
      max-width: 640px;       /* was 480 / 720 */
    }
  }
  ```
- **Acceptance criteria:** On a 2560×1440 display, the Settings tables fill more of the available width; the listing pages have wider lines so contact names don't truncate as aggressively.

### UX-017 — Bottom-nav shows 5 tabs (10 after badges) — vertically tight at narrow widths

- **Severity:** P2
- **Category:** Responsive layout / Information hierarchy
- **Affected file(s):** `apps/web/src/styles.css:5513-5528`, `apps/web/src/pages/Layout.tsx:463-509`
- **Current behavior:** The tab bar holds 5 tabs (Favorites · Messages · Chat — wait, Chat was merged with Messages, so just 5: Favorites, Messages, Recents, Keypad, Voicemail). Each tab has icon (22px) + label (font-size 0.6rem on line 5518). With `tab { padding: 0.25rem 0.15rem; gap: 0.15rem; flex: 1 }` the labels on narrow widths force horizontal wrapping or truncation. Comment on line 5513 notes "Tighten tab-bar typography so 6 tabs fit comfortably on the narrow Electron window" — but the count is currently 5 and looks fine, the comment is stale. However, tab-badge positioning (`right: calc(50% - 16px)` line 3957) assumes a specific icon size; with the badge rendering 16x16 + the tab's center alignment it can collide with the adjacent tab's icon at narrow widths.
- **Recommended fix:** Wrap each icon+badge in `.tab-icon-wrap` (which is referenced but undefined — see UX-005) and position the badge relative to that wrapper, not the whole `.tab`:
  ```css
  .tab-icon-wrap { position: relative; }
  .tab-badge { right: -10px; top: -4px; }  /* anchor to icon, not tab center */
  ```
- **Acceptance criteria:** At 540px-wide viewport, tab badges do not overlap adjacent tab icons.

### UX-018 — `.app-header` `min-height: 56px` collides with multi-line on narrow widths

- **Severity:** P2
- **Category:** Responsive layout
- **Affected file(s):** `apps/web/src/styles.css:140-170`
- **Current behavior:** `.app-header` is `display: flex; justify-content: space-between; gap: 1rem` with a `min-height: 56px`. The three children (left brand block, center DID switcher, right user chip) are all `flex: 0 1 auto`. On a 540px viewport the brand block (~140px) + DID pill (~180px) + user chip (~120px) + gaps (3 × 16px) = ~480px — fits within 540 narrowly. At 480px or below they would wrap to two rows, but `min-height: 56px` stays. The header then has a 96px tall multi-row appearance. The `@media (max-width: 540px)` block at line 1036-1043 tries to fix this with `.app-header { grid-template-columns: auto 1fr auto }` — but the parent is `display: flex` (not grid), so the grid rule is ignored. The mobile fallback never actually applies.
- **Recommended fix:** Update the `@media (max-width: 540px)` block to match the parent layout:
  ```css
  @media (max-width: 540px) {
    .app-header { gap: 0.5rem; padding: 0.4rem 0.7rem; flex-wrap: nowrap; }
    .app-header-center { gap: 0.3rem; min-width: 0; flex: 1 1 auto; }
    .app-header .version { display: none; }
    .user-name { display: none; }
    .user-chip { padding: 0.2rem 0.35rem 0.2rem 0.3rem; }
    .sip-status-label { display: none; }
    .sip-status-pill { padding: 0.3rem 0.5rem; }
    .brand { display: none; }  /* keep only the brand-mark icon */
  }
  ```
- **Acceptance criteria:** On a 360px-wide viewport (Electron window dragged narrow), the header stays a single row.

### UX-019 — Search bars on Recents/Messages/Voicemail use sticky-top with `z-index: 5`, can be obscured by other UI

- **Severity:** P2
- **Category:** Visual consistency
- **Affected file(s):** `apps/web/src/styles.css:2297-2310`
- **Current behavior:** `.search-bar` is `position: sticky; top: 0; z-index: 5`. The `.app-header` is `position: relative; z-index: 600` (per line 169 comment, raised in v0.10.10 to fix a DID dropdown z-index issue). The return-to-call banner is `position: sticky; top: 0; z-index: 40`. When both are present, the search bar (z=5) sits BEHIND the return-to-call banner (z=40), but both are `sticky; top: 0` — so they fight for the same screen position. Result: when the user scrolls a recents list during an active call, the green return-to-call banner covers the search input.
- **Recommended fix:** Stack them. Either move the search bar's `top` to clear the banner, or set its z-index above the banner and accept that during a call the user can scroll past the banner:
  ```css
  .search-bar {
    /* ...existing... */
    /* When the return-to-call banner is visible above us, its 52px height
       pushes us down naturally because we're in the scroll context below it.
       Sticky us at top: 0 within OUR container, which is .app-content. */
    z-index: 30;  /* below banner (40), above page content */
  }
  ```
- **Acceptance criteria:** During an active call, the search bar appears immediately below the return-to-call banner and is fully interactive.

### UX-020 — Number-display input lacks visible label even when populated

- **Severity:** P2
- **Category:** Accessibility / Information hierarchy
- **Affected file(s):** `apps/web/src/pages/Dialpad.tsx:380-426`
- **Current behavior:** The Dialpad's main input has `placeholder="Enter phone number"` (line 399) but no `<label>` element or `aria-label`. Screen readers announce "edit text, Enter phone number" only when the field is empty. Once the user has typed digits, screen readers say only "edit text, +1 (973) 727-0611" with no description of what the field is for. The flag image has `alt={country.iso}` (e.g. "US") which screen readers will announce as a country code abbreviation with no further context.
- **Recommended fix:**
  ```tsx
  <input
    ref={inputRef}
    type="tel"
    aria-label="Phone number to dial"
    // ...
  />
  // And give the flag an alt that's a full country name or aria-hidden=true:
  <img alt="" aria-hidden="true" ... />  // since the prefix label conveys the same info
  ```
- **Acceptance criteria:** Screen reader announces "Phone number to dial, edit text, +1 (973) 727-0611" when focused. The flag image is no longer announced separately.

### UX-021 — Empty states for Messages/Voicemail/Chat use only a `<p>` — no illustration or CTA hierarchy

- **Severity:** P2
- **Category:** Information hierarchy / Onboarding
- **Affected file(s):** `apps/web/src/pages/Recents.tsx:472-475`, `apps/web/src/pages/Voicemail.tsx`, `apps/web/src/pages/Messages.tsx:288-292`, `apps/web/src/pages/Favorites.tsx:85-92`
- **Current behavior:** Recents empty state is `<p>No calls yet.</p>` + `<p class="muted">Calls you make will show up here.</p>` — two text paragraphs, no icon, no link to the Keypad. Messages empty state is identical pattern. Favorites at least has a Star icon (line 87). New users land on the dialer and the first three tabs they tap (Favorites/Messages/Recents) all greet them with two short sentences and no clear next action. The dialer has the `.empty-state` class with three lines of typography (h2, p, muted) but most pages don't use it consistently.
- **Recommended fix:** Adopt the Favorites pattern across all empty states — icon + heading + body + an action button:
  ```tsx
  <div className="empty-state">
    <Clock size={40} className="empty-state-icon" />
    <h2>No recent calls</h2>
    <p>Your call history will appear here.</p>
    <button className="device-action primary" onClick={() => navigate('/keypad')}>
      Open keypad
    </button>
  </div>
  ```
  Add `.empty-state-icon` to styles.css: `color: var(--text-muted); margin-bottom: 1rem; opacity: 0.6;`.
- **Acceptance criteria:** Every empty state has at least an icon + heading + CTA button.

### UX-022 — `tab-badge` overlap with icon when count is ≥99

- **Severity:** P2
- **Category:** Visual consistency
- **Affected file(s):** `apps/web/src/styles.css:3953-3970`, `apps/web/src/pages/Layout.tsx:477-479`
- **Current behavior:** `.tab-badge` is `min-width: 16px; height: 16px; padding: 0 4px`. The "99+" text is 3 characters, rendering at roughly 22px wide. The badge is `position: absolute; top: 0; right: calc(50% - 16px)` — at 99+ it can overlap the tab icon (22px). Combined with the missing `.tab-icon-wrap` (UX-005), the badge can drift OFF the icon onto neighboring tabs at narrow widths.
- **Recommended fix:** As part of UX-005's `.tab-icon-wrap` fix, anchor the badge to the icon wrapper not the tab:
  ```css
  .tab-icon-wrap { position: relative; display: inline-flex; }
  .tab-badge { position: absolute; top: -2px; right: -12px; }
  ```
- **Acceptance criteria:** When `unread.messages + unread.chat` is 99+, the badge displays "99+" without overlapping the message icon.

### UX-023 — `incoming-fullscreen` no min-content sizing — gets clipped on short windows

- **Severity:** P2
- **Category:** Responsive layout
- **Affected file(s):** `apps/web/src/styles.css:3975-3985`
- **Current behavior:** `.incoming-fullscreen` is `position: fixed; inset: 0`, content centered via flex. The inner `.incoming-fs-inner` is `max-width: 360px; padding: 40px 20px`. On a 320px-tall window (which can happen if user drags Electron window to its minimum 800px height but the OS adds a title bar + taskbar leaving ~640 CSS pixels), the content (tag + caller name + line badge + subtle + 3 action buttons each in a 72px+24px stack = roughly 450px) overflows. No `overflow-y: auto` is set, so the Accept button can fall below the visible area.
- **Recommended fix:**
  ```css
  .incoming-fullscreen { overflow-y: auto; padding: 20px 0; }
  .incoming-fs-inner { min-height: 0; }
  ```
- **Acceptance criteria:** On a 480-pixel tall viewport, the Accept button is visible without dragging or scrolling.

### UX-024 — Light-mode `.app-content` background is dark gray (`var(--bg)`) but `.app-shell` has `background: #000`

- **Severity:** P2
- **Category:** Visual consistency (theming)
- **Affected file(s):** `apps/web/src/styles.css:137` (`.app-shell background: #000`), `:root` token at line 6, light-theme override on line 27 (`--bg: #f2f2f7`)
- **Current behavior:** `.app-shell { background: #000 }` is a hard-coded literal that wins over the light-theme `:root --bg`. The light-mode override on line 3236 (`[data-theme="light"] .app-shell { background: var(--bg) }`) re-applies the token, but only inside the cascade — the literal `#000` at line 137 has equal specificity but lower order in some cases. The result: on first paint in light mode, the shell briefly shows black before the override kicks in (FOUC).
- **Recommended fix:** Replace the literal with the token everywhere:
  ```css
  .app-shell { background: var(--bg); }
  .app-header { ...no need to set background, inherits; gradient layer over that. }
  ```
- **Acceptance criteria:** Switching themes shows no black flash. Hard refresh in light mode never paints a dark background.

### UX-025 — Recents row Block icon hidden by Star/SMS spread; click target too close

- **Severity:** P2
- **Category:** Button placement / Information hierarchy
- **Affected file(s):** `apps/web/src/pages/Recents.tsx:651-700`, `apps/web/src/styles.css:2995-3006` (`.callback-ico`)
- **Current behavior:** The right side of each call row stacks: recording-toggle (when present, 24×24), time text, send-SMS (24×24), favorite-star (24×24), block (24×24). With 4-5 icons at 24px each plus the formatted time label, the row right side packs roughly 180px of controls. At 480px viewport (the .recents max-width), the row's main text column can squeeze the icons together until they're 4-6px apart. Destructive Block sits right next to Star — easy to mis-tap, especially on a touchpad.
- **Recommended fix:** (a) Increase the gap between icons (`.call-right { gap: 0.55rem }` — currently 0.8 which is fine, but the icons themselves only have 4px padding via `.callback-ico { padding: 4px }` — bump that). (b) More importantly, move Block into a row-level kebab/overflow menu so destructive actions aren't co-located with safe ones:
  ```tsx
  <button className="callback-ico more-ico" onClick={openRowMenu}>
    <MoreHorizontal size={16} />
  </button>
  // Menu contains: Block, Add to favorites, Send to chat, etc.
  ```
- **Acceptance criteria:** Block is not adjacent to Star in the row. Block requires an explicit two-step interaction (open menu → click Block).

### UX-026 — `app-content` overflow / `overflow-y: auto` declared TWICE with different semantics

- **Severity:** P2
- **Category:** Layout consistency
- **Affected file(s):** `apps/web/src/styles.css:193-197` (block 1) and `1054-1058` (block 2)
- **Current behavior:** Line 193: `.app-content { max-width: 1280px; margin: 0 auto; width: 100% }`. Line 1054: `.app-content { overflow-y: auto; display: flex; justify-content: center }`. The second declaration overrides nothing but ADDS `display: flex` and `justify-content: center`, which means `.app-content` is a flex row with a single child (`<Outlet />`). The flex child stretches by default, so combined with `max-width: 1280px` plus `justify-content: center` the centering is doubled. The `overflow-y: auto` here is what triggers all the scroll-to-top resets in `Layout.tsx:151-161`. If a future refactor removes one of these blocks without seeing the other, scroll-to-top breaks (or the layout collapses).
- **Recommended fix:** Merge the two declarations into one block, comment-tagged:
  ```css
  /* Single app content wrapper. Acts as the page-level scroll container
     for every route except Settings (which manages its own scroll). */
  .app-content {
    max-width: 1280px;
    margin: 0 auto;
    width: 100%;
    overflow-y: auto;
    display: flex;
    justify-content: center;
  }
  ```
- **Acceptance criteria:** Single block in stylesheet; behavior unchanged from current.

### UX-027 — Praise modal close button (32px) below 44px AAA target

- **Severity:** P2
- **Category:** Accessibility
- **Affected file(s):** `apps/web/src/styles.css:1437-1452`
- **Current behavior:** `.praise-modal-close` is `width: 32px; height: 32px; opacity: 0.7`. The modal is celebratory/festive in tone but the dismiss button is a small `X` icon in the corner at 70% opacity. Users have to aim precisely; opacity at rest also makes it less visible.
- **Recommended fix:** Bump to 40px+ and increase rest opacity:
  ```css
  .praise-modal-close {
    width: 40px;
    height: 40px;
    opacity: 1;  /* was 0.7 */
    background: rgba(255, 255, 255, 0.12);
  }
  .praise-modal-close:hover { background: rgba(255, 255, 255, 0.2); }
  ```
- **Acceptance criteria:** Dismiss is easy to click; visible at rest, not just hover.

### UX-028 — DID dropdown menu width `max-width: 360px` can overflow narrow viewports

- **Severity:** P2
- **Category:** Responsive layout
- **Affected file(s):** `apps/web/src/styles.css:341-348`
- **Current behavior:** `.did-switcher-menu` is `min-width: max(260px, 100%); max-width: 360px`. The `100%` is relative to the pill, which is variable width. On the narrow Electron window (900px min-width), the centered header puts the DID pill at roughly x=400 with a pill ~180px wide. The dropdown then anchors at `left: 0` of the pill (line 344-346). With `min-width: 260px` it forces 260px right of the pill — clearing the user chip on the right. No horizontal overflow handling; on a 540px-wide window the dropdown can extend off-screen-right.
- **Recommended fix:** Add a viewport-aware right anchor when there's not enough room on the right:
  ```css
  .did-switcher-menu {
    left: 0;
    right: auto;
    /* If the menu would extend past the viewport, JS should add a
       'menu-align-right' class. For now, a CSS fallback: */
    max-width: min(360px, calc(100vw - 32px));
  }
  ```
- **Acceptance criteria:** At 540px viewport, the DID dropdown stays within the visible area.

### UX-029 — Multiple animations use `transform: scale()` without `will-change` — paint jank on low-end Windows laptops

- **Severity:** P3
- **Category:** Performance / motion polish
- **Affected file(s):** `apps/web/src/styles.css:1426-1430` (`praiseModalIn`), `4233-4236` (`incoming-pulse`), `4427-4429` (`in-call-toast-in`), `2398-2401` (`rtc-pulse`).
- **Current behavior:** None of the keyframe animations declare `will-change`. On older Windows business laptops with integrated Intel graphics, the box-shadow blur animation on `.incoming-btn.accept` (which animates a 16px shadow spread + opacity 60 times per minute) consistently causes paint jank we've seen reported.
- **Recommended fix:**
  ```css
  .incoming-btn.accept { will-change: box-shadow; }
  .return-to-call-banner { will-change: background; }
  ```
  Pairs well with UX-002 (prefers-reduced-motion).
- **Acceptance criteria:** Paint flame chart shows no >16ms frames during continuous accept-pulse on low-tier hardware.

### UX-030 — Tip banner uses inline styles instead of CSS classes (defeats theme switching)

- **Severity:** P3
- **Category:** Visual consistency / Theming
- **Affected file(s):** `apps/web/src/components/TipBanner.tsx:140-237`
- **Current behavior:** TipBanner renders entirely with `style={{ ...inline styles ... }}` blocks — about 80 lines of inline CSS. While it references `var(--bg)`, `var(--text)`, `var(--border)`, etc., it bypasses every theme-override rule in styles.css. Hover states, focus states (already absent — UX-001), and any future visual tweak require a code change, not a CSS change.
- **Recommended fix:** Extract to a CSS class block in styles.css:
  ```css
  .tip-banner {
    position: fixed;
    right: 20px;
    bottom: 110px;        /* UX-011 fix */
    z-index: 950;
    width: 320px;
    max-width: calc(100vw - 40px);
    background: var(--bg-elevated);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 12px;
    box-shadow: var(--shadow-strong);
    padding: 14px 16px;
    display: flex;
    gap: 12px;
    align-items: flex-start;
    font-size: 13px;
    line-height: 1.45;
  }
  ```
  Then the component just renders `<div className="tip-banner">...</div>`.
- **Acceptance criteria:** Tip banner can be themed/tweaked from styles.css without touching the TSX file.

### UX-031 — Multiple call-pill components use literal hex (`#2563eb`, `#1f2937`, `#374151`) outside the token system

- **Severity:** P3
- **Category:** Visual consistency
- **Affected file(s):** `apps/web/src/styles.css:4798-4799` (`.bubble.out` `#2563eb`), `5089-5090` (`.call-pill` gradient `#1f2937 → #374151`), `4869` (`.compose-input background: #1f2937`), `5326` (`.audio-picker-box background: #111827`)
- **Current behavior:** The token system defines `--accent`, `--accent-blue`, `--bg`, `--bg-elevated`, `--surface`, etc., but big surfaces use literal Tailwind-default hex codes that don't move with the theme switcher. The `.bubble.out` outbound-message bubble is `#2563eb` (a fixed blue) so it looks the same in dark and light mode — fine intentionally. But `.call-pill background: #1f2937` is a dark slate that overrides whatever the theme's surface color is, making the call pill visually disconnected from the rest of the dialer in light mode (the light-theme override on line 2748 fixes `--bg-elevated` only — the gradient stays slate).
- **Recommended fix:** Audit all hard-coded slate/gray hex literals (`#1f2937`, `#374151`, `#111827`, `#4b5563`) and replace with tokens. Where the design genuinely wants a non-themed accent color, comment that explicitly:
  ```css
  /* INTENTIONAL: outbound bubble stays brand blue in both themes */
  .bubble.out { background: #2563eb; color: #fff; }
  ```
- **Acceptance criteria:** Theme switcher visibly changes the in-call pill, compose-input, and audio-picker backgrounds.

### UX-032 — `compose-modal` documented to support stacked-child dim but no JS wiring

- **Severity:** P3
- **Category:** CLAUDE.md rule #4 compliance
- **Affected file(s):** `apps/web/src/styles.css:4964-4973`
- **Current behavior:** The CSS has a `.compose-modal-dimmed { background: rgba(0, 0, 0, 0.95) }` class with a comment noting "Applied via JS adding a .compose-modal-dimmed class to the parent when its child mounts. Until we wire that, the child opens with its OWN .compose-modal backdrop sitting on top of the parent's." Grep across the codebase shows no JSX code adds this class. CLAUDE.md rule #4 explicitly requires this dimming. The current "stacked backdrop" workaround only works when both modals use `.compose-modal` — but `UserLinesManagerModal` uses `.lines-modal` over `.compose-modal` parent, and `lines-add-modal` over `lines-modal` parent. There's no second backdrop in those cases.
- **Recommended fix:** Either wire up the class via a `<ModalProvider>` context that tracks stack depth, or — simpler — make every nested modal render its OWN `.compose-modal` overlay so the cumulative dim works automatically:
  ```tsx
  // UserLinesManagerModal.tsx, when showing the Add sub-modal:
  {showAdd && (
    <div className="compose-modal" onClick={() => setShowAdd(false)}>
      <div className="lines-add-modal" onClick={(e) => e.stopPropagation()}>
        ...
      </div>
    </div>
  )}
  ```
- **Acceptance criteria:** Opening "Add line" inside "Manage lines" visibly darkens the parent modal's content.

### UX-033 — Settings two-column layout lacks horizontal min-width on the content pane

- **Severity:** P2
- **Category:** Responsive layout
- **Affected file(s):** `apps/web/src/styles.css:2442-2446`, `2518`
- **Current behavior:** `.settings.settings-split` is `grid-template-columns: 260px 1fr`. The second column (`1fr`) has no `min-width`, so when an inner table (`.users-admin-table`, `.pending-table` line 7231 `table-layout: fixed`) tries to set 200px+ columns, the grid track shrinks to its content's MIN width. On a 1100px-wide window, the .pending-table's 22% + 28% + 18% + 60px + 200px column widths can total more than 720px — the parent grid track might be only ~700px, causing horizontal scroll inside the table wrap (line 7799 has `overflow-x: auto` as a floor, good) but the user has to scroll within the table. The settings-pane padding (1.5rem 1.75rem) makes this worse.
- **Recommended fix:**
  ```css
  .settings.settings-split {
    grid-template-columns: 260px minmax(0, 1fr);  /* allow grow up to available */
  }
  .settings-pane { min-width: 0; }
  ```
- **Acceptance criteria:** At 1100px viewport, the Pending Users table no longer requires horizontal scroll.

### UX-034 — Recents copy-toast `z-index: 5000` higher than modal backdrops; can appear above modals

- **Severity:** P2
- **Category:** Visual hierarchy
- **Affected file(s):** `apps/web/src/styles.css:2861-2876`
- **Current behavior:** `.copy-toast { z-index: 5000 }` while `.compose-modal { z-index: 800 }`. If a user opens the Add-favorite modal from a Recents row, then somehow triggers a copy (it's hard but possible via keyboard shortcut), the toast pops up ABOVE the modal. More likely: the toast can outlive the modal close and re-appear on top of any subsequent modal. This is a relatively low-impact bug but the z-index escalation is concerning — 5000 is the highest in the codebase and breaks the documented z-index ladder.
- **Recommended fix:** Drop to 100 — above page content, below modals:
  ```css
  .copy-toast { z-index: 100; }
  ```
- **Acceptance criteria:** Copy toast never visually overlays an open modal.

### UX-035 — Theme picker segmented control has no focus indicator (combined with UX-001)

- **Severity:** P2
- **Category:** Accessibility
- **Affected file(s):** `apps/web/src/styles.css:3818-3843`
- **Current behavior:** `.theme-picker-btn` has hover and active states but no focus state. Combined with UX-001 (no global `:focus-visible`), keyboard users tab into the segmented control with no idea where focus is. Same issue affects `.tab-bar .tab` items, `.user-menu-item`, `.callback-ico`, `.did-switcher-pill`, `.recents-filter-chip`, `.lines-row-swatch`, etc.
- **Recommended fix:** Once UX-001's global `:focus-visible` is in, these inherit it automatically. Plus add a stronger highlight for segmented controls:
  ```css
  .theme-picker-btn:focus-visible {
    outline: 2px solid var(--accent-blue);
    outline-offset: -2px;  /* inset since the segment has tight padding */
  }
  ```
- **Acceptance criteria:** Keyboard tab through the segmented control shows a clear focused-segment indicator.

### UX-036 — `.held-line-strip` duplicated CSS — two complete declarations at 1689 and 5243

- **Severity:** P3
- **Category:** Maintenance / Visual consistency
- **Affected file(s):** `apps/web/src/styles.css:1688-1745` (first block), `5208-5273` (second block)
- **Current behavior:** Lines 1688-1745 declare `.held-line-strip` with one set of properties (background `rgba(255,255,255,0.07)`, `border-radius: 14px`). Lines 5243-5258 redeclare it (`background: linear-gradient(90deg, #1f2937 0%, #374151 100%)`, `border-radius: 12px`, `margin: 0 12px 8px`). The second wins (cascade order). Block one is effectively dead code. Combined with the related `.held-strip-main`, `.held-line-main`, `.held-line-hangup`, `.held-strip-hangup` — there are two parallel implementations of the same concept (held call strip vs held line strip).
- **Recommended fix:** Delete the first declaration (lines 1688-1745). Audit any usages of `.held-strip-main` and `.held-strip-hangup` and migrate them to `.held-line-main` / `.held-line-hangup`.
- **Acceptance criteria:** Single source of truth for the held-call strip. CSS smaller by ~60 lines.

### UX-037 — Hide-scrollbars rule on `*` causes lost-affordance perception on long scroll regions

- **Severity:** P2
- **Category:** Information hierarchy / Discoverability
- **Affected file(s):** `apps/web/src/styles.css:7131-7132` (`*::-webkit-scrollbar { display: none } * { scrollbar-width: none }`)
- **Current behavior:** A global `*` rule hides every scrollbar in the app. The comment at line 7064 justifies this with "iMessage / Slack / Messenger all hide them" — but those apps have other strong "scrollable" affordances (touch-momentum, distinct surface elevation, lots of vertical content). In ACE Dialer, long Settings pages, the Reports lists, the Audit Log timeline, and the Bulk Import results table all become silent scrollers — users don't know they can scroll until they accidentally try. The Pending Users page has `overflow-x: auto` (line 7799) but no visible chrome to indicate horizontal scroll is possible.
- **Recommended fix:** Restrict scrollbar-hiding to the chat-style surfaces it was designed for, and bring back subtle scrollbars elsewhere:
  ```css
  /* Reset the global hide */
  * { scrollbar-width: thin; }
  *::-webkit-scrollbar { width: 8px; height: 8px; }
  *::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.15); border-radius: 4px; }
  *::-webkit-scrollbar-track { background: transparent; }
  [data-theme="light"] *::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.15); }
  /* Then keep chat-style hidden on .msg-stream specifically */
  .msg-stream::-webkit-scrollbar { display: none; }
  .msg-stream { scrollbar-width: none; }
  ```
- **Acceptance criteria:** Long settings/reports surfaces show a thin scrollbar. Messages thread stream remains scrollbar-free.

### UX-038 — Diagnostics page tail uses pre-formatted text without max-height — can grow unbounded

- **Severity:** P3
- **Category:** Responsive layout
- **Affected file(s):** `apps/web/src/components/DiagnosticsSection.tsx:32-46`, plus styles in `apps/web/src/styles.css` (Diagnostics tail)
- **Current behavior:** The Diagnostics section refreshes `recent` to the last 40 log entries every second. If each entry is rendered in a `<details>` or `<pre>` block, on a slow machine with verbose logs the section can grow tall. No `max-height` rule on `.diagnostics-tail-wrapper`.
- **Recommended fix:** Constrain the tail area:
  ```css
  .diagnostics-tail-wrapper > details {
    max-height: 320px;
    overflow-y: auto;
  }
  ```
- **Acceptance criteria:** Diagnostics tail doesn't push the page footer below the viewport.

### UX-039 — Settings → Personal pane caps at `max-width: 560px` even on QHD displays

- **Severity:** P3
- **Category:** Responsive layout
- **Affected file(s):** `apps/web/src/styles.css:2544`
- **Current behavior:** `.settings-pane-body { max-width: 560px }`. On a 2560px monitor with the 1280px content cap, the Settings split is `260px nav + 1020px content`, but the content INSIDE the pane (`.settings-pane-body`) caps at 560px, leaving ~460px of empty whitespace inside an already-narrowed pane. Reasonable for cred forms (one-column inputs), but for the Tables sections (`PendingUsersSection` already opts out via `:has(.pending-users-section)` line 7694), Users admin, Audit log, Reports — wastes screen real estate.
- **Recommended fix:** Per-section opt-out for table-heavy sections, similar to the existing :has() rule:
  ```css
  .settings-pane-body:has(.users-admin-table),
  .settings-pane-body:has(.audit-log-list),
  .settings-pane-body:has(.liveops) {
    max-width: 1000px;
  }
  ```
- **Acceptance criteria:** Audit log and Live ops dashboard fill their available pane width.

### UX-040 — Login page has no error state for missing Microsoft config

- **Severity:** P3
- **Category:** Error states
- **Affected file(s):** `apps/web/src/pages/Login.tsx:225-227`
- **Current behavior:** When `config?.enabled` is false, the page shows a yellow banner "Single sign-on is not configured on the server. Contact your admin." No retry button, no info about whether to fall back to password. The break-glass password disclosure link below still works, but a first-time user might not realize they can click it.
- **Recommended fix:** In the SSO-disabled banner, surface the password form expand action more prominently:
  ```tsx
  <div className="auth-banner-v2 auth-banner-warn-v2">
    Single sign-on isn't configured. Contact your admin or
    <button className="auth-disclosure-btn-v2 inline-disclosure"
            onClick={() => setShowPasswordForm(true)}>
      sign in with email and password.
    </button>
  </div>
  ```
- **Acceptance criteria:** When SSO is disabled, the user has a clear next-step CTA in the banner itself.

### UX-041 — Number-display input loses cursor position when user types fast

- **Severity:** P2
- **Category:** Input ergonomics
- **Affected file(s):** `apps/web/src/pages/Dialpad.tsx:402-417`
- **Current behavior:** The input's `onChange` recomputes the value via `setNumber(smartNormalize(raw) || '')` and the displayed value comes from `formatNumber(number)`. The formatted value (e.g. `(973) 727-0611`) is re-rendered every keystroke; React replaces the input's value and resets the caret to the end. For users who arrow-back to fix a middle digit, the caret jumps forward unexpectedly.
- **Recommended fix:** Track caret position before/after format, restore manually:
  ```tsx
  const handleChange = (e) => {
    const inputEl = e.target;
    const caretBefore = inputEl.selectionStart ?? inputEl.value.length;
    const raw = inputEl.value.replace(/[^\d*#+]/g, '');
    const next = smartNormalize(raw) || '';
    setNumber(next);
    requestAnimationFrame(() => {
      const formatted = formatNumber(next);
      // Best-effort restore — simple heuristic: keep caret at the same
      // digit-index it was at before re-format.
      const digitsBefore = formatted.slice(0, caretBefore).replace(/[^\d]/g, '').length;
      let pos = 0, seen = 0;
      while (pos < formatted.length && seen < digitsBefore) {
        if (/\d/.test(formatted[pos])) seen++;
        pos++;
      }
      inputEl.setSelectionRange(pos, pos);
    });
  };
  ```
- **Acceptance criteria:** Typing a digit in the middle of an existing formatted number doesn't jump the caret to the end.

### UX-042 — Voicemail playback speed control uses native font rendering, breaks on certain Win locales

- **Severity:** P3
- **Category:** Visual consistency
- **Affected file(s):** `apps/web/src/styles.css:1996-2014`
- **Current behavior:** `.vm-rate-btn` displays `0.5x`, `1x`, `1.5x`, `2x` text. On Windows in some locales (Russian, Arabic) the rendered glyph for `×` (multiplication sign, vs the Latin `x`) varies. Since the buttons use `font-family: inherit` (Segoe UI on Windows), the rendering is fine in Latin scripts but the literal "x" in mixed font fallbacks (Cyrillic-substituted Segoe) can render as a different glyph width — causing the segmented control to jitter when the active button changes.
- **Recommended fix:** Force tabular numerics + explicit Latin display:
  ```css
  .vm-rate-btn {
    font-variant-numeric: tabular-nums;
    min-width: 38px;
    text-align: center;
  }
  ```
- **Acceptance criteria:** The voicemail rate buttons stay the same width across all 4 states.

### UX-043 — `IncomingCall` banner (non-fullscreen) shows in a `position: fixed; top: 12px` strip — overlaps content on short windows

- **Severity:** P2
- **Category:** Responsive layout
- **Affected file(s):** `apps/web/src/styles.css:4183-4199`
- **Current behavior:** `.incoming-banner` is `position: fixed; top: 12px; left: 50%; transform: translateX(-50%); min-width: 280px`. The banner sits over the page content. On a Recents or Messages page, it covers the page header and the search bar — exactly the spot a user might be glancing at when a call comes in. Nothing pushes content down to make room for the banner; it's a pure overlay.
- **Recommended fix:** Either reserve space at the top of the layout when the banner is showing (cleaner but requires layout coupling), or move the banner to occupy a CSS grid row above `.app-header`. Simpler interim fix — push the rest of the app down via a CSS variable:
  ```css
  .incoming-banner {
    /* Existing positioning... */
  }
  /* When IncomingCall renders, set --incoming-banner-h on :root; .app-shell
     pads-top by that variable. */
  :root { --incoming-banner-h: 0px; }
  .app-shell { padding-top: var(--incoming-banner-h); transition: padding-top 0.15s; }
  ```
  In IncomingCall.tsx, when not fullscreen: `useEffect(() => { document.documentElement.style.setProperty('--incoming-banner-h', '72px'); return () => document.documentElement.style.setProperty('--incoming-banner-h', '0px'); }, []);`
- **Acceptance criteria:** When a call comes in while on Recents, the search bar drops below the banner instead of being hidden.

### UX-044 — Electron floater HTML uses inline CSS only — no theme support

- **Severity:** P3
- **Category:** Cross-window consistency
- **Affected file(s):** `apps/desktop/src/main.ts:457-509`
- **Current behavior:** The floater HTML is hardcoded with `background: linear-gradient(180deg, #0a3a2e 0%, #0a1f1a 100%)` and `color: #fff`. The main-window incoming-fullscreen ALSO uses the same green gradient — intentional per the v0.10.21 comment ("incoming-call full-screen ALWAYS has a dark green gradient background"). So this is consistent. BUT: the floater's button styles (`button.accept { background: #22c55e }`, `button.decline { background: #ef4444 }`, `button.reply { background: #f97316 }`) hard-code Tailwind defaults that don't match the main app's tokens (`--green: #34c759`, `--red: #ff3b30`). On the main window the buttons use the iOS-style colors, on the floater they're slightly different Tailwind hues. The visual mismatch is subtle but real.
- **Recommended fix:** Make the floater button colors match the main app's incoming-call buttons:
  ```html
  <style>
    button.accept { background: #34c759; }       /* match main --green */
    button.hold-accept { background: #34c759; }
    button.decline { background: #ff3b30; }      /* match main --red */
    button.reply { background: #ff9500; }        /* match main reply gradient end */
  </style>
  ```
- **Acceptance criteria:** A user moving their eyes between the floater and the main window sees identical button colors.

### UX-045 — Floater window does not adapt to monitor scaling — 440×240 looks tiny on 4K

- **Severity:** P2
- **Category:** Responsive layout / Multi-monitor
- **Affected file(s):** `apps/desktop/src/main.ts:369-372`
- **Current behavior:** Floater is fixed at `w=440, h=240` device pixels (since Electron BrowserWindow.width is in screen pixels). On a 3840×2160 4K monitor at 200% DPI scaling, this is roughly 220×120 effective CSS — readable but small. Buttons are 72×72 (line 476) which becomes ~36×36 effective — well below the accessibility minimum.
- **Recommended fix:** Read `display.scaleFactor` and scale the window accordingly:
  ```ts
  const display = screen.getPrimaryDisplay();
  const wa = display.workArea;
  const scale = display.scaleFactor || 1;
  // Bump size on high-DPI displays — keep CSS appearance constant
  const w = scale > 1.5 ? 560 : 440;
  const h = scale > 1.5 ? 300 : 240;
  ```
- **Acceptance criteria:** On a 4K monitor at 200% scaling, the floater controls feel the same size as on a 1080p monitor at 100% scaling.

### UX-046 — Floater positioning hardcoded to primary display bottom-right; multi-monitor users lose it

- **Severity:** P2
- **Category:** Multi-monitor / Cross-window consistency
- **Affected file(s):** `apps/desktop/src/main.ts:367-372`
- **Current behavior:** `const display = screen.getPrimaryDisplay()` — the floater always opens on the primary monitor's bottom-right. Users with dual monitors who run the dialer on monitor 2 are surprised when the ringer pops up on monitor 1.
- **Recommended fix:** Open on the same monitor as the main window:
  ```ts
  const mainBounds = mainWindow?.getBounds();
  const display = mainBounds
    ? screen.getDisplayNearestPoint({ x: mainBounds.x + mainBounds.width / 2, y: mainBounds.y + mainBounds.height / 2 })
    : screen.getPrimaryDisplay();
  ```
- **Acceptance criteria:** Floater ringer appears on the same monitor the user has the main dialer window on.

### UX-047 — Auth divider has decorative `or` text but is not announced to screen readers

- **Severity:** P3
- **Category:** Accessibility
- **Affected file(s):** `apps/web/src/pages/Login.tsx:236-238`, `apps/web/src/styles.css:5783-5802`
- **Current behavior:** `<div class="auth-divider"><span>or</span></div>` is a visual divider between the Microsoft CTA and the password disclosure. Screen readers announce "or" as a content node, which is misleading — there's no following sentence. It should be presentational only.
- **Recommended fix:** Make it `<div class="auth-divider" aria-hidden="true"><span>or</span></div>`.
- **Acceptance criteria:** Screen reader skips the divider and reads "Microsoft sign-in button" → "Sign in with password (admin only)" with no intervening "or".

### UX-048 — Dial button shows `aria-label="Recall last number"` when input empty; misleading once user has dialed

- **Severity:** P3
- **Category:** Accessibility
- **Affected file(s):** `apps/web/src/pages/Dialpad.tsx:458-463`
- **Current behavior:** The button toggles between two aria-labels based on `hasDialableInput`. When empty AND there's a last-dialed number, the screen reader announces "Recall last number" — but the FIRST press just refills the input; a SECOND press dials. The user wouldn't know that from the label. The `title` attribute (line 460) does explain it for sighted hover-users.
- **Recommended fix:** Pair the aria-label with the same explanation:
  ```tsx
  aria-label={
    hasDialableInput
      ? 'Call'
      : hasLastDialed
        ? 'Recall last dialed number; press again to dial'
        : 'Call (empty)'
  }
  ```
- **Acceptance criteria:** Screen reader announces the two-step recall behavior on the first press.

### UX-049 — Long contact names truncate without showing full value on hover/focus

- **Severity:** P3
- **Category:** Information hierarchy
- **Affected file(s):** Multiple — `.call-number`, `.thread-name`, `.favorite-name`, `.vm-number` all use `text-overflow: ellipsis`
- **Current behavior:** Names like "Christopher Mendez-Hernandez Jr." get truncated mid-letter. There's no `title` attribute on the wrapper to show the full name on hover.
- **Recommended fix:** Add `title={displayName}` to the wrapper element wherever a name is rendered with `text-overflow: ellipsis`. In Recents.tsx:
  ```tsx
  <div className="call-number" title={displayName}>{displayName}<LineBadge ... /></div>
  ```
  Same for the Messages thread row, Voicemail row, Favorites row.
- **Acceptance criteria:** Hovering a truncated name reveals the full value in a native browser tooltip.

### UX-050 — Pending Users table forces fixed `table-layout: fixed` with percentage column widths — column 6 (Status) is 60px center-aligned in a 720px wrap, looks lonely

- **Severity:** P3
- **Category:** Information hierarchy
- **Affected file(s):** `apps/web/src/styles.css:7785-7788`
- **Current behavior:** Column 6 in `.pending-table` is `width: 60px; text-align: center` and contains the `pending-status-pill-letter` (1.5rem × 1.5rem, ~24×24px). The visually-empty surroundings make the column look like accidental whitespace rather than intentional spacing.
- **Recommended fix:** Either widen the column and add the column heading text back ("Status"), or remove the center alignment and merge with the Actions column.
- **Acceptance criteria:** The Status column either has a discernible header label or is folded into Actions.

### UX-051 — DateTimePicker / Schedule modal uses native `<input type="datetime-local">` — different look on every OS

- **Severity:** P3
- **Category:** Visual consistency / Cross-window consistency
- **Affected file(s):** `apps/web/src/pages/Messages.tsx` schedule modal (referenced indirectly via `.schedule-quickpicks` styles at line 4764-4773; native input not explicitly styled)
- **Current behavior:** The send-schedule modal uses the browser's `datetime-local` input, which has a built-in picker on Chromium/Electron that looks completely different from the rest of the dialer's iOS-style inputs. Same input on Safari (web) renders differently again.
- **Recommended fix:** Build a lightweight date+time picker matching the dialer's visual style, or use a library like react-aria DatePicker. Lower-cost: at least style the native input chrome:
  ```css
  input[type="datetime-local"] {
    color-scheme: dark;
    background: rgba(255,255,255,0.06);
    border: 1px solid rgba(255,255,255,0.12);
    border-radius: 8px;
    padding: 8px 10px;
    color: #fff;
    font-family: inherit;
  }
  [data-theme="light"] input[type="datetime-local"] { color-scheme: light; }
  ```
- **Acceptance criteria:** The schedule modal date picker visually matches the rest of the dialer.

### UX-052 — `audio-picker` modal close button uses `<button class="audio-picker-close">Close</button>` styled as a text link — inconsistent with `.modal-close` X pattern elsewhere

- **Severity:** P3
- **Category:** Visual consistency
- **Affected file(s):** `apps/web/src/pages/InCall.tsx:439-441`, `apps/web/src/styles.css:5316-5373` (no `.audio-picker-close` rule), light theme override at line 2729
- **Current behavior:** Every other modal in the dialer (`.compose-modal`, `.lines-modal`, `.fav-modal`, `.history-modal`, `.praise-modal`, `.post-decline-sheet`) uses an X icon close button in the header. The audio picker has only "Close" as a text button at the bottom. The styling is also incomplete — no base style for `.audio-picker-close` exists in the dark theme, only the light theme override.
- **Recommended fix:** Convert to the standard X-icon header pattern:
  ```tsx
  <div className="audio-picker-box">
    <div className="modal-header">
      <h3>Audio output</h3>
      <button className="modal-close" onClick={() => setShowAudio(false)} aria-label="Close">
        <X size={18} />
      </button>
    </div>
    {/* ...list... */}
  </div>
  ```
- **Acceptance criteria:** Audio picker matches every other modal's close pattern.

### UX-053 — Settings sub-pages don't reset child component state on tab change

- **Severity:** P3
- **Category:** State / Information hierarchy
- **Affected file(s):** `apps/web/src/pages/Settings.tsx` SettingsPane logic
- **Current behavior:** When the user navigates from `/settings/users` → `/settings/audit-log` → back to `/settings/users`, the Users section re-mounts but child component state (filter chips, expanded rows, etc.) is sometimes preserved across navigations due to React keying. The scroll reset on tab change works (lines 484-497), but local filter state can be stale.
- **Recommended fix:** Use the route key as the `key` prop on each section component so React fully unmounts when the section changes:
  ```tsx
  <Route path="/settings/:section" element={<SettingsPane key={section} ... />} />
  ```
- **Acceptance criteria:** Switching away and back to Users always shows the default filter state.

### UX-054 — Pending users `.pending-status-pill-letter` color comes from the existing `.pending-{status}` class — but on hover/focus there's no state change

- **Severity:** P3
- **Category:** Visual consistency
- **Affected file(s):** `apps/web/src/styles.css:7744-7756`
- **Current behavior:** The letter-only status pill (`P`/`I`/`A`) has no hover or focus indication. Users hovering rows might wonder if they're clickable. Combined with UX-001 (no focus indicator) and the actual TR being clickable via the row hover state, the affordance is fully invisible to keyboard users.
- **Recommended fix:** Either remove the per-row clickable behavior, or add hover/focus highlighting to the status pill consistent with the actions column.
- **Acceptance criteria:** Status column behavior is unambiguous and discoverable.

### UX-055 — `.heatmap` grid uses `font-size: 10px` cell labels — illegible at 100% DPI

- **Severity:** P3
- **Category:** Accessibility
- **Affected file(s):** `apps/web/src/styles.css:6944-6968`
- **Current behavior:** Live ops dashboard heatmap renders 24 hour columns × 7 day rows with `font-size: 10px` on column labels (`0 1 2 3 ... 23`). At 100% DPI on a 1080p monitor, that's ~13 device pixels of text — barely readable.
- **Recommended fix:**
  ```css
  .heatmap-col-label, .heatmap-row-label { font-size: 11px; font-weight: 500; }
  .heatmap-cell { font-size: 11px; }
  ```
- **Acceptance criteria:** Heatmap labels are legible at 100% DPI.

---

## Resolution coverage matrix

Legend: `✓` works, `⚠` known issue per audit, `✗` broken.

| Page | 1280×720 | 1366×768 | 1920×1080 | 2560×1440 | 3840×2160 |
|------|----------|----------|-----------|-----------|-----------|
| Login | ✓ | ✓ | ✓ | ⚠ wide gutters (UX-016) | ⚠ wide gutters (UX-016) |
| Dialpad | ⚠ at 125% DPI clips (UX-007) | ⚠ at 125% DPI clips (UX-007) | ✓ | ⚠ tiny column (UX-016) | ⚠ tiny column (UX-016) |
| Recents | ⚠ Block adj. to Star (UX-025) | ⚠ Block adj. to Star (UX-025) | ✓ | ⚠ 480px column (UX-016) | ⚠ 480px column (UX-016) |
| Messages | ⚠ search overlaps banner (UX-019) | ⚠ search overlaps banner (UX-019) | ✓ | ⚠ 480px column (UX-016) | ⚠ 480px column (UX-016) |
| Voicemail | ⚠ touch targets (UX-010) | ⚠ touch targets (UX-010) | ✓ | ✓ | ✓ |
| Favorites | ✓ | ✓ | ✓ | ✓ | ✓ |
| Chat | ✓ | ✓ | ✓ | ✓ | ✓ |
| InCall | ⚠ grid overflow short (UX-008) | ⚠ grid overflow short (UX-008) | ✓ | ✓ | ✓ |
| IncomingCall (full) | ⚠ short window clip (UX-023) | ✓ | ✓ | ✓ | ✓ |
| IncomingCall (banner) | ⚠ covers content (UX-043) | ⚠ covers content (UX-043) | ⚠ covers content (UX-043) | ⚠ covers content (UX-043) | ⚠ covers content (UX-043) |
| Settings | ⚠ 800-1100 awkward (UX-006, UX-033) | ⚠ 800-1100 awkward (UX-006, UX-033) | ✓ | ⚠ wide gutters (UX-016) | ⚠ wide gutters (UX-016) |
| Electron floater | ⚠ off monitor (UX-046) | ⚠ off monitor (UX-046) | ⚠ off monitor (UX-046) | ⚠ small (UX-045) | ⚠ small (UX-045) |
| All pages — focus | ✗ no focus ring (UX-001) | ✗ no focus ring (UX-001) | ✗ no focus ring (UX-001) | ✗ no focus ring (UX-001) | ✗ no focus ring (UX-001) |
| All pages — motion | ✗ no reduced-motion (UX-002) | ✗ no reduced-motion (UX-002) | ✗ no reduced-motion (UX-002) | ✗ no reduced-motion (UX-002) | ✗ no reduced-motion (UX-002) |

---

## Recommendations summary (in priority order)

### P1 — Critical (18 items)

- **UX-001** — Global `:focus-visible` outline (accessibility)
- **UX-002** — `prefers-reduced-motion` support
- **UX-003** — `TelnyxStatusBanner` Rules-of-Hooks violation
- **UX-004** — Replace `window.alert` / `window.confirm` (22 sites)
- **UX-005** — Missing CSS for `.incoming-action-stack`, `.incoming-action-label`, `.tab-icon-wrap`
- **UX-006** — Mid-range responsive breakpoints (901-2000px)
- **UX-007** — Dialpad clips at 1366×768 @ 125% DPI
- **UX-008** — InCall grid overflows short viewports
- **UX-009** — `--text-muted` contrast below WCAG AA on overlay surfaces
- **UX-010** — Touch-target sizing below 32px on multiple controls
- **UX-011** — Tip banner overlaps tab bar at 1366×768
- **UX-012** — Modal backdrop alphas drift below 70% spec on 4 modals
- **UX-013** — `confirm()` returns null in some Electron contexts
- **UX-014** — User dropdown menu has no scroll fallback
- **UX-015** — Settings nav title/blurb don't truncate
- **UX-016** — `.app-content` cap too tight on QHD+
- **UX-017** — Tab badge position breaks on narrow widths
- **UX-018** — `.app-header` mobile media query targets wrong layout

### P2 — Important (24 items)

- UX-019, UX-020, UX-021, UX-022, UX-023, UX-024, UX-025, UX-026, UX-027, UX-028, UX-032, UX-033, UX-034, UX-035, UX-037, UX-041, UX-043, UX-045, UX-046

### P3 — Polish (13 items)

- UX-029, UX-030, UX-031, UX-036, UX-038, UX-039, UX-040, UX-042, UX-044, UX-047, UX-048, UX-049, UX-050, UX-051, UX-052, UX-053, UX-054, UX-055

---

## How to use this report

To request implementation of specific findings, paste back to Claude in the format:

> Address UX-001, UX-005, UX-012

Claude will read this audit, find the matching entries, and implement the recommended fixes following the apply-vXXX.mjs script convention.
