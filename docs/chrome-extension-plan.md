# Chrome extension — plan (Phase A + Phase B)

Status: Phase A **implemented** (`feat/extension-phase-a`) · Phase B **implemented** (`feat/extension-phase-b`) · neither deployed · Oct 20 2026 · builds on `apps/extension/` (v0.10.242, click-to-call)

Two phases, shipped separately. A makes the existing extension work for
everyone; B turns it into the place recruiters see what's waiting on them.
A full in-extension softphone (Option C) is **out of scope** — see the end.

---

## Where we start

The extension today (`apps/extension/`, MV3, ~700 lines):

- Underlines numbers on domains the user grants (`optional_host_permissions`
  + `registerContentScripts`, no `<all_urls>`).
- Click → `background.ts` opens `ace-dialer://call?to=…&src=selection` in a
  background tab that closes after 1.5s.
- No network requests, no auth, no UI except the options page.

The gaps:

1. **No desktop app → nothing happens.** The protocol launch fails silently
   by design, so web-dialer users get a dead click.
2. **Not distributed.** README describes Intune force-install, but there is no
   store listing / extension ID yet. *(Confirm — if it's already published,
   skip A3.)*
3. **It only starts calls.** Nothing pulls the user back to missed calls,
   texts or voicemails — the 27% callback rate in the Reports scorecard.

---

## Phase A — click-to-call that works for everyone

Goal: a click on a number always ends with the dialer open and the number
prefilled — desktop app *or* web dialer — and never dials.

### A1. Route the click to the right dialer

Chrome can't tell whether a protocol handler is installed, so we don't guess.
Order of preference in `background.ts`:

1. **A web dialer tab is already open** (`https://dialer.aptask.com/*`) →
   hand it the number *in place* (A2) and focus that tab. Someone with the web
   dialer open is using it; sending them to the desktop app would ring the
   wrong client.
2. **Preference = Desktop app** (default) → today's `ace-dialer://` path,
   unchanged.
3. **Preference = Web dialer** → open a new tab at
   `https://dialer.aptask.com/keypad?to=…&src=selection`. If not signed in,
   the existing route guard stashes `ace_return_to` and returns after SSO.

Options page gets one new control: **"Open numbers in: Desktop app / Web
dialer"**, stored in `chrome.storage.sync`, overridable by managed storage
(A3) so IT can set it per group.

**Never navigate an existing dialer tab with a URL.** A full navigation
reloads the SPA, which drops `sessionStorage` (JWT) and the SIP registration —
and kills an active call. That is why step 1 goes through A2 instead of
`chrome.tabs.update({ url })`.

### A2. Hand-off into a running web dialer (no reload)

- New tiny content script `dialer-bridge.js`, statically declared for
  `https://dialer.aptask.com/*` only (one fixed origin we own — not a user
  site, so this doesn't touch the per-domain scanner model).
- `background.ts` → `chrome.tabs.sendMessage(tabId, { type: 'ace-dial', to })`
  → bridge → `window.postMessage({ source: 'ace-extension', type: 'dial', to,
  src: 'selection' }, location.origin)`.
- Web app: a listener mounted in `Layout.tsx` checks `event.origin ===
  location.origin` and `event.source === window`, then
  `navigate('/keypad?to=…&src=selection')` via `useNavigate`. Dialpad's
  existing strict-parse path (`UNTRUSTED_SOURCES`) does the rest — same
  validation, same error messages, same "never auto-dial" rule.
- If a call is live, don't yank the user off `/in-call`: show the number as a
  toast with "Open in keypad", matching how a second capture would behave in
  the desktop app. *(Decide during build — check what desktop does today
  when a capture lands mid-call and match it.)*
- Manifest: add `"tabs"`? **No** — querying tabs by URL only needs host access
  to that URL, so add `https://dialer.aptask.com/*` to `host_permissions`.
  That's the first required host permission the extension has ever had; the
  README and store justification must say why.

### A3. Distribution

- Chrome Web Store, **Unlisted** (or private to the aptask.com Workspace if
  available), using the store-listing text already in the README plus the new
  host-permission justification.
- Intune: `ExtensionInstallForcelist` for Chrome + Edge, plus a
  `3rdparty/extensions/<id>` managed-storage policy carrying
  `allowedOrigins` (e.g. `https://app.jobdiva.com/*`) and `openIn`. Needs a
  `managed_schema` JSON in the manifest so Chrome accepts the policy.
- `background.ts` merges managed origins with user-added ones; managed ones
  show on the options page as locked ("Set by your administrator").
- Pin the extension ID: generate a key once and commit the public `key` in the
  manifest so dev builds and the store build share one ID (the policies
  reference it).

### A4. Release plumbing

- The extension already version-bumps with the app. Add a zip step to
  `build.mjs` (`dist/ace-dialer-extension-<version>.zip`) so a release
  produces the store upload.
- Only republish to the store when `apps/extension/` actually changed —
  store review takes days and gains nothing from no-op uploads.

### A — tests & done-when

- Unit: routing decision table (tab open / desktop / web × signed in / out).
- Manual: desktop installed, desktop absent, web tab open mid-call, web tab
  open idle, signed-out web, Edge.
- Help Center (`helpCenter.ts`) + `docs/features.md` entries in the same
  change (CLAUDE.md §5.4).
- **Done when:** a recruiter with only the web dialer clicks a number in
  JobDiva and lands on the keypad with it filled in, without losing an
  active call.

---

## Phase B — Follow-ups side panel

Goal: the recruiter sees, next to JobDiva, every missed call, unanswered text
and voicemail still waiting on them, and can act on each in one click.

### B1. What the panel shows

Chrome `side_panel` (Chrome 114+, so bump `minimum_chrome_version`):

- **Header:** "N waiting" + last refreshed.
- **Three groups**, newest first, same data as Reports → Follow-ups:
  missed calls (attempts, last attempt), texts waiting on a reply, voicemails
  with no callback.
- **Each row:** saved name (Favorites → JobDiva → formatted number), how long
  it's been waiting, and two buttons: **Call back** and **Text**. Both go
  through the Phase A router — prefill only, never dial.
- **No message bodies or transcripts** in the panel. It's an extension page
  that stays open beside other sites; show "3 texts waiting", not what they
  say. Reading the thread happens in the dialer.
- Empty state: "Nothing waiting. Nice." in the visual-system tone (no
  confetti — §27).

**Toolbar badge:** the count of open items, refreshed every 2 minutes and on
panel open. This is the nudge — it's visible on every page, panel open or not.

Clicking the toolbar icon opens the side panel (options move to the panel's
settings gear and the extension's right-click menu).

### B2. API work

- **`GET /me/follow-ups/count` → `{ count }`.** The badge polls this, so per
  §5.4 it must be a cheap counter. Back it with `computeFollowUps(userId)`
  plus a short per-user in-process cache (60s) — the badge fires from every
  open browser of every user.
- **`GET /me/follow-ups`** → the panel list for the caller only (no `userId`
  param, so there's no admin-scope surface on an extension token). Same
  computation, response trimmed to: kind, number, savedName, attempts, since,
  lastAt. Strip `body`.
- Reuse `computeFollowUps`; don't fork the logic. Reports and the panel must
  agree on what "open" means or users will stop trusting both.
- **Resolved:** `computeFollowUps` filtered voicemails on `listenedAt: null`
  despite its own comment and CLAUDE.md §31 saying not to. The filter was the
  bug; removed in Phase B.

### B3. Sign-in

The extension can't borrow the web app's token (it's in a tab's
`sessionStorage` on purpose), so it signs in on its own:

- `chrome.identity.launchWebAuthFlow` → Microsoft `/authorize` with PKCE +
  state → redirect `https://<extension-id>.chromiumapp.org/` → POST to the
  existing `/auth/microsoft/exchange`. `getMsalClient` already accepts any
  https redirect; add the chromiumapp.org URI to the Entra app registration.
  Same SSO, same Conditional Access, same audit trail — no password form in
  the extension.
- **Scoped token.** Exchange accepts `client: 'extension'` and mints a JWT
  with `scope: 'ext'`. `app.authenticate` rejects `scope: 'ext'` on every
  route except an allowlist (`/me/follow-ups*`, `/me` name fields). An
  extension token must not be able to fetch SIP credentials, send SMS, or
  read message bodies — the extension sits next to arbitrary sites all day
  and shouldn't carry a full-power credential.
- Store the token in `chrome.storage.session` (memory only, cleared when the
  browser quits) — the extension equivalent of the `sessionStorage` rule in
  §2.4. A 401 clears it and the panel shows "Sign in".
- Audit: `auth.extension_signin` via `recordAudit()`.

### B4. Freshness

- `chrome.alarms` every 2 minutes (MV3 workers can't hold timers) → count
  endpoint → `chrome.action.setBadgeText`.
- Panel open → fetch the list immediately, then every 60s while visible.
- No socket — §29 is still a stub; polling stays canonical.

### B — tests & done-when

- API: scope enforcement (ext token gets 403 on `/me`, `/messages`, SIP
  creds), count == list length, no `body` in the response.
- Extension: badge updates, signed-out state, 401 → sign-in, Call back /
  Text route through Phase A.
- Help Center + `reports-guide.md` (Follow-ups) updated together.
- **Done when:** a recruiter sees "4" on the toolbar while in JobDiva, opens
  the panel, clicks Call back, and the dialer opens with the number filled in.
- **Measure:** Reports → Missed & voicemail "Missed calls returned" for users
  on the extension vs. not, 30 days after rollout (baseline 27%).

---

## Guardrails (carry into CLAUDE.md §4.4 when shipped)

- Every path from the extension ends in **prefill**. Nothing in the extension
  can place a call or send a text.
- The page scanner stays per-domain. The only static host permission is
  `dialer.aptask.com`, for the bridge.
- Never reload a web dialer tab to deliver a number.
- The extension token is scoped and memory-only; it never sees SIP creds or
  message content.
- The panel shows counts and names, not message text.

---

## Rough sizing

| Piece | Est. |
|---|---|
| A1–A2 routing + bridge + web listener | 2 days |
| A3–A4 store listing, managed policy, zip, ID pinning | 1–2 days (+ store review) |
| B2 API (count, list, cache) | 1 day |
| B3 scoped SSO token | 2 days |
| B1/B4 side panel UI, badge, polling | 3 days |
| Docs, help entries, test pass | 1 day |

Phase A can ship on its own; B depends on A's router and on the A3 extension
ID (needed for the Entra redirect URI).

## Not doing: in-extension softphone (Option C)

MV3 service workers can't hold a WebSocket or WebRTC session, so a softphone
needs an offscreen document. It would also be a third SIP registration per
user (the dual-Contact fork problem in §6.3) and a third client to maintain,
all to duplicate what the desktop app and web dialer already do. Revisit only
if users have neither of those available.
