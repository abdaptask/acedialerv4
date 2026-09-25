# ACE Dialer — Project State

**Last updated:** September 25, 2026 (**0.10.232 end reasons + no-audio detection — web + API + webhooks LIVE, desktop tagged**; 0.10.231 search/follow-ups/insights; 0.10.230 per-person records; 0.10.229 Reports suite; 0.10.228 audio-output picker contrast fix; 0.10.227 personal SMS templates given a Settings home — web LIVE; 0.10.226 conference self-mute fix — released, on 38 devices)
**Maintained by:** Claude (update at end of every working session)

This file is a living snapshot of where the project stands. New Claude
sessions should read it first to absorb context before reading any other
file. Update the sections below as state changes — keep entries short
and dated.

---

## 0. Quick start for a new session

If you're a fresh Claude session opening this project:

1. Read this file top to bottom (takes 30 seconds).
2. Then read `CLAUDE.md` for the locked UI standards + project rules.
3. Check current versions in the workspace by reading the root `package.json`.
4. Skim the **Open tasks** section below for what's pending.
5. Skim **Recent learnings** for any architectural insights that affect new work.

---

## 1. Current state (latest releases)

| Stream | Version | Status | Where |
|---|---|---|---|
| Latest released | **v0.10.232** | Per-call end reasons, per-text failure reasons, no-audio (one-way) detection, Telnyx sip_hangup_cause + call_quality_stats stored. `d59535c`, merge `685dd1c`, **web + API + webhooks live Sep 25**. Desktop drafts 0.10.229–0.10.231 never published — **publish 0.10.232**; until then NO desktop user sends quality/packet data | `main` |
| Previously released | v0.10.231 | Contact search, Follow-ups tab, admin Insights tab, unique numbers dialled, spend hidden from non-admins. `509086e`, merge `26f82f7`, tagged `v0.10.231`, **web + API live Sep 25**. Drafts for 0.10.229/0.10.230 were never published; publish 0.10.231 | `main` |
| Previously released | v0.10.230 | Per-person call + text records and number timelines on the Reports page. `6727e05`, merge `d505029`, tagged `v0.10.230`, **web + API live Sep 25**. The v0.10.229 desktop draft was never published; publish 0.10.230 instead | `main` |
| Previously released | v0.10.229 | Reports suite (`/reports`) with per-person drill-down + client call-quality capture. Feature `0c84c8b`, merge `15cd915`, tagged `v0.10.229`, **web + API live Sep 25**; desktop installers building in CI | `main` |
| Previously released | v0.10.228 | Audio-output picker was dark-on-dark in light mode. Fix `c583aec`, release `948d5db`, tagged `v0.10.228`, **web live Sep 17**; desktop installers built by CI (see the Sep 17 entry — macOS signing is failing) | `main` |
| Previously released | v0.10.227 | Personal SMS templates given a Settings home. Merged `56efaa5`, tagged `v0.10.227`, web live (Aug 27) | `main` |
| Previously released | v0.10.226 | Conference self-mute muted the mix instead of the mic. Merged `682b270`, tagged `v0.10.226`, **published with 12 assets 2026-08-26T13:36Z — on 38 devices within a day** | `main` |
| Previously released | v0.10.225 | Silent ringer for a call arriving mid-call + ACE Bot caller names. Merged via PR #91, tagged `v0.10.225`, released to all users (Aug 26) | `main` |
| Previously released | v0.10.224 | Bulk-send template placeholders — `{recruiter}` auto-fill + a box per manual field | `main` |
| Previously released | v0.10.223 | Favorites multi-select send — one message to several favorites, each as a normal 1:1 text | `main` |
| Previously released | v0.10.222 | Scheduled-SMS failure visibility + rate limits no longer burning the retry budget | `main` |
| Previously released | v0.10.221 | Click-to-dial stale/wrong-number fixes. Merged via PR #85 (Aug 13) | `main` |
| Desktop adoption | rolling | Aug 27 15:40 — 38 on 0.10.226, 23 on 0.10.224, 14 on older builds (9 of them pre-0.10.216). A release reaches most users within a day; a residual tail does not, and why is unexplained (see the 0.10.227 entry). **Query `user_devices.app_version` for ground truth rather than assuming a release has landed** | `user_devices` table |
| Backend — `ace-api` / `ace-webhooks` | v0.10.224 processes (reloaded Aug 25, ~21h uptime) | Correct as-is: 0.10.225 touched only `apps/web` + version bumps, so there is no api/webhooks gap. Next `./deploy.sh` syncs the version string | `pm2 list` / `./deploy.sh` |
| Backend — `ace-socket` | v0.10.224 (7-day uptime) | Stub service ([[29-realtime-socket]]); nothing to sync | `pm2 list` |
| Web SPA (`ace-web`) | **v0.10.227 live** | `apps/web/dist` rebuilt Aug 27 15:40 — absolute `/assets/` base verified. Serves off disk, so a build IS a deploy — see §5 | `pm2 list` |
| Auto-update status | distributing | 0.10.224 reached 64 devices and 0.10.225 is now published, so current releases satisfy the v0.10.143 signing gate. The old "LOCKED on v0.10.132" line no longer described reality and has been removed; `docs/ev-cert-procurement.md` keeps the history | GitHub Releases |

**September 25, 2026 — v0.10.232: why calls end.** Trigger: Roshni Sahani's 3 calls to (240) 421-2248 "connected but blank". Records: far end answered in ~2s every time (a call screener: "please state the purpose of your call"), she hung up ~30s later; no other dialer user ever called that number (the colleague who heard the prompt likely used a mobile). Consistent with one-way inbound audio (see memory: turn-relay-inbound-oneway-audio), but UNPROVABLE retroactively: she runs 0.10.228, and even the 0.10.229 capture only sampled when packets arrived — so a fully silent call left no trace. 0.10.232 records rx/tx packet totals on every connected call; `rxPackets = 0` → "no audio". The Telnyx `GET /v2/call_events?filter[call_session_id]=` lookup returned unrelated events (filter ignored) — don't rely on it.

**September 25, 2026 — v0.10.231: search, follow-ups, insights.** Real numbers at release (Aug 26 – Sep 24): 48% of outbound calls reach someone for 30s+; best slot Thu 6pm (55%), worst Tue 6pm (34%); 1,626 candidates contacted by 2+ recruiters; 4 opt-outs, none texted after (16 STOPs in 90 days, all clean). Follow-ups (last 14 days): 955 unreturned missed calls, 327 texts waiting. Some numbers were dialled by 12+ recruiters — likely client switchboards; worth checking before anyone reads "shared contacts" as poaching.

**September 25, 2026 — v0.10.230: individual call/text records.** Clicking a call/text KPI on a person's report lists the records behind it; any record opens a timeline with that number. Numbers tab → Activity (Calls/Texts). `textLog` is metadata only. **Desktop publishing is a manual step:** electron-builder `--publish always` creates a DRAFT release; drafts are invisible to the auto-update feed (`latest.yml` stays on the previous version) until someone presses Publish on GitHub (`gh` isn't authed in Claude's shell — the user must do it).

**September 25, 2026 — v0.10.229 released: Reports suite (see CLAUDE.md §31)**

- **Scope:** `/reports` page, 8 tabs + a person-only Numbers tab (dialled/incoming numbers + call log). Every KPI, outcome bar and daily bar drills down (by person on the team view, by day on a person's view). One endpoint `GET /reports` computes everything; admins see everyone, others only themselves (server-enforced).
- **The old admin reports were wrong in four ways**, all fixed in the new engine: (1) every outbound call counted twice — app row + Telnyx row, 52,789 rows vs 26,658 calls in 30 days; (2) talk time used webhook `durationSeconds`, which includes ringing (a caller who hangs up while it rings got ~20s); (3) days split at UTC midnight (8pm ET); (4) the Quality report looked for SMS status `failed`, but real failures are `delivery_failed`, so it saw none. Also: the host `.env` has `TELNYX_COST_*` keys set EMPTY, so `parseFloat('')` = NaN blanked every cost in `/admin/reports/cost`.
- **Real numbers leadership will ask about (Aug 26 – Sep 24):** 43% of inbound calls answered; 31% of missed calls returned within 24h (median 9 min); 74% of text conversations replied within 24h; 27% of voicemails heard (median 14.8h). Many people show 0% voicemails heard — NOT yet verified whether listening from the Teams card/email marks `listenedAt`; check before anyone acts on that column.
- **Schema:** four nullable `calls` columns (`avg_jitter_ms`, `avg_loss_pct`, `max_loss_pct`, `avg_rtt_ms`), applied by hand as the exact `prisma migrate diff` SQL (additive only) BEFORE `prisma generate`, so a pm2 restart could never run a client that expects missing columns. The client also now sends JsSIP's originator as `hangupSource` on its own rows. Confirmed-drop and audio-quality figures only exist for calls made on ≥0.10.229.
- **Performance:** a team 30-day report loads ~137k call rows across two periods. Prisma costs ~15µs per result cell (`findMany` 5.7s); calls load through one raw query packing each row into a single delimited text cell (~1.4s). Cold team report ~3.5s; cached 2 min (range includes today) / 1h (past ranges). One person ~0.3s.
- **Visual verification without a display:** Electron won't start here (missing GTK libs, no sudo). What worked: `npx @puppeteer/browsers install chrome-headless-shell@stable`, then `apt-get download` the missing `.so` packages (libatk, libgbm, libxcomposite, libxdamage, libxfixes, libxrandr, libasound, libatspi, libxrender, libxi…), `dpkg -x` them into scratch and run with `LD_LIBRARY_PATH`. Render a page in isolation with a temporary Vite entry + a Fastify stub that registers only the route under test (never boot `apps/api/src/main.ts` locally: its workers would send real scheduled texts).
- **Bug caught only by rendering:** the page called `tab.render(props)` as a plain function, so the Numbers tab's hooks attached to the page and switching tabs threw React #310. Tabs are now rendered as components.
- **Leadership proposal page:** https://claude.ai/artifact/DwQiuDgSruNVvqZuy2Eaqf (private; real names and figures, click-to-drill).

**September 17, 2026 — v0.10.228 released: in-call audio-output picker unreadable in light mode**

- **Symptom (reported against the desktop app):** opening Audio during a call listed every output device, but only the *selected* one was legible; the rest were dark text on a dark fill.
- **Root cause — a cascade gap, not a missing colour.** `.audio-picker-item` (styles.css) hardcodes `background:#1f2937`, which only makes sense against the dark theme's `#111827` box. The light-theme block flipped **only** the text to `var(--text)` (`#1c1c1e`) and never overrode that fill, so unselected rows were near-black on near-black. The selected row escaped it purely because `.active` supplies its own background — which is exactly why it was the one readable item, and why the bug reads as "only the selection renders properly".
- **Second, subtler half:** in light mode the selected row was white-on-10%-blue (~1.3:1). The base `.active { color:#fff }` was beating the light-mode text colour on **source order alone** — `[data-theme="light"] .audio-picker-item` and `.audio-picker-item.active` both score one class + one attribute. The new light `.active` selector carries an extra class so it wins on specificity regardless of file position. Light mode now measures ~15:1 unselected / ~14.8:1 selected; the compiled dark-theme rules are byte-for-byte unchanged.
- **Dark theme never had this bug** — the box supplies `color:#e5e7eb`, which inherits onto `#1f2937` fine. This was light-mode-only.
- **`styles.css` has mixed line endings and the edit tooling will silently normalise them.** The file is 10,927 CRLF lines plus a contiguous 433-line LF-only tail (the bulk-send section, ~10928-11360). A whole-file rewrite turned the tail to CRLF and produced a 446/436-line diff for a 13-line change — caught via `git diff --stat` vs `--ignore-all-space`, rebuilt from the original bytes, amended. **Check the stat on any `styles.css` edit**, or `git blame` on someone else's section gets wiped. A `.gitattributes` with `*.css text eol=lf` would end this class of problem.
- **Desktop needs its own release for a CSS change.** `apps/desktop/package.json` copies `../web/dist` into the installer via `extraResources` and `main.ts:378` `loadFile`s it from inside the package — the web deploy cannot reach desktop users. Version bumped across all 8 `package.json` + `package-lock`, What's new entry added, tagged `v0.10.228`.
- **macOS installers were dead for ~3 weeks, and the error blames the wrong thing. RESOLVED by pinning `runs-on: macos-15` (`78a2dc3`).** Every Mac build died in ~5s at `signApp` with `SecKeychainUnlock: The user name or passphrase you entered is not correct`, which reads exactly like a bad `APPLE_CSC_KEY_PASSWORD`. **It is not.** electron-builder 25.1.8 creates its temp keychain with a random 32-byte password, then calls `security set-key-partition-list -k <the P12 password>` — the wrong secret (`app-builder-lib/out/codeSign/macCodeSign.js`, `keychainPassword` ~line 140 vs `importCerts` ~line 165). `-k` is consulted **only when the keychain is locked**, so the preceding `unlock-keychain` hid the mismatch for years. When `macos-latest` rolled to macOS 26 (Darwin 25.x) the keychain began locking first and exposed it. Rotating the cert changes nothing — we rotated it mid-incident and the failure was byte-identical.
- **Confirming it's environmental, not ours:** the workflow file and `build` config are unchanged between `v0.10.227` (Mac shipped Aug 27) and `v0.10.228`; only the version moved. Aug 27's sign step ran 257s; the broken runs ran ~5s ×3.
- **Neither rung of the retry/fallback ladder can rescue a signing failure.** The "signed-only" fallback drops only the `APPLE_*` notarization vars and keeps `CSC_LINK` + `CSC_KEY_PASSWORD`, so it re-runs the identical failing step. There is no unsigned rung, so a signing break yields **no `.dmg` at all**, not a degraded one.
- **Durable fix is electron-builder >= 26** (we're on 25.1.8; 26.15.3 current). Deliberately NOT bundled into this release — a major bump moves packaging, signing and auto-update metadata and needs its own test pass. The pin holds until then.
- **Reading the step results is a trap:** the sign step carries `continue-on-error: true`, so its *conclusion* shows `success` even when its *outcome* was failure. The real signal is whether the **fallback step ran** — it's gated on `outcome == 'failure'`. On the fixed run both show "success" and the fallback ran for 117s, meaning signing worked and **notarization still failed**. Mac users get a signed-but-unnotarized `.dmg` (right-click → Open the first time), which is the designed degraded path and matches Aug 27.
- **Note on CI triggers:** `build-desktop.yml` fires on any push to `main` touching `apps/web/**` or `**/package.json`, so a web-only commit starts a desktop build at the *unchanged* version. It re-upserts the existing release rather than advancing anyone — only a version bump moves users.

**August 4, 2026 — v0.10.216 staged (UNCOMMITTED, NOT DEPLOYED): SMS composer — personal templates, voice-to-text, AI rewrite**

- **Scope:** four asks — user-created SMS templates (previously admin-only), voice dictation, "Rewrite with AI", plus accurate character/segment counts and audit coverage.
- **Templates now have two scopes** on one table via a new nullable `SmsTemplate.ownerUserId`: `NULL` = company-wide (admin CRUD, unchanged), non-null = personal (owner CRUD via new `/me/sms-templates` POST/PATCH/DELETE). The read filter in `GET /me/sms-templates` (`OR: [{ownerUserId: null}, {ownerUserId: me}]`) is the security boundary; all writes use compound `updateMany` on `(id, ownerUserId)`. Admin handlers are symmetrically scoped `ownerUserId: null` so the admin pane cannot see or touch anyone's personal templates (deliberate privacy call — approved).
- **Placeholder registry is new** (`apps/api/src/lib/smsPlaceholders.ts`). Placeholders were previously free-form text with only `{firstName}` / `{recruiter}` resolved by two hardcoded regexes in `Messages.tsx`; nothing validated them, so a typo shipped silently to a candidate. Now: canonical `{camelCase}` keys, case-insensitive matching (`{FirstName}` works), malformed-syntax detection, did-you-mean suggestions, and validation on save. `{lastName}`, `{jobTitle}`, `{companyName}`, `{recruiterName}` added and auto-fill from JobDiva/`/me`; legacy `{recruiter}` + `{currentCompany}` stay valid but hidden from the picker.
- **Verified against production before enabling strict validation:** the live `sms_templates` table holds exactly the 20 seeded rows using exactly 16 placeholder keys — no admin ever created a custom template, so no existing template can fail validation. A test asserts all 20 seed bodies validate clean and normalize to themselves.
- **Voice-to-text** reuses the existing Deepgram account (`nova-3`, `language=multi`) — no new vendor. `apps/api/src/lib/deepgram.ts` is a deliberate ~40-line copy of the webhooks helper (CLAUDE.md §1.4 forbids cross-app TS sharing); both files now cross-reference each other. Audio is request-scoped only: never written to disk/Postgres/Supabase, never sent as MMS. Recording is **blocked while a call is live** (mic contention would risk the call's audio) and all teardown runs through the new shared `useMicRecorder` hook, which `Settings.tsx`'s voicemail-greeting recorder was refactored onto.
- **AI rewrite runs on our own DGX — no new vendor, no per-token cost, and no draft text leaves the network.** Provider layer `apps/api/src/lib/llm.ts`; default `LLM_PROVIDER=ollama` against `http://172.16.219.222:11434` with `qwen3.5:9b`. Anthropic is retained as a dormant fallback that only runs on an explicit `LLM_PROVIDER=anthropic`, so a stray key can never start billing. Kill switch is `LLM_PROVIDER=off`.
- **Verified live end-to-end (2026-08-04):** DGX reachable from the app host in 13ms (internal IP, no tunnel/VPN needed). The production `rewriteSmsDraft()` delivered **6/6** realistic recruiting drafts at **~1.0–1.15s** each, with the two invented `$` symbols correctly surfaced as warnings rather than blocked.
- **Three corrections to the internal QWEN-MIGRATION-GUIDE.md** (worth sending upstream — the guide is dated 2026-03-31 and will mislead the next team):
  1. Its recommended default `qwen3:32b` **does not exist** on the box (`qwen3:8b` does). Live inventory is 21 models incl. a whole `qwen3.5` family and `-nothink` variants — check `curl http://172.16.219.222:11434/api/tags`.
  2. The headline "drop-in OpenAI-compatible" claim **breaks on Qwen3**, a hybrid reasoning model. `/v1` cannot disable thinking (`chat_template_kwargs.enable_thinking: false` is silently ignored — verified): 16,031ms vs 772ms, ~640 vs 24 output tokens, 5/7 vs 7/7 guard pass. The two `/v1` failures returned HTTP 200 with **empty content** because reasoning consumed all of `max_tokens`, with the reasoning hidden in a separate `reasoning` field. Must use native `/api/chat` + `think: false`.
  3. Cold start measured at **~47s**, not the documented 10–30s. Mitigated by `prewarmLlm()` on boot + `LLM_KEEP_ALIVE=30m`.
- **Guards recalibrated after the first live run.** `qwen3.5:9b` rewrote "last 2 paystubs" → "last two payslips" — a good edit the original digit guard rejected. Numeral↔word equivalence (0–12) now passes; a changed value or a vanished number still fails closed. Added-fact detection (invented `$`/`%`) warns instead of blocking. New `factsToVerify()` feeds a "Verify: 65/hr · Friday · meet.example.com" line into the review sheet, so the human review the feature depends on is directed at specific tokens rather than a general proofread. Request carries the draft text ONLY — no thread history, contact, user id, or metadata; nothing logged or persisted. Model output is mechanically validated before display (placeholder multiset, digit runs, URLs/emails, length ratio) and **fails closed** to the user's original. Mandatory review sheet: Use / Edit / Keep original / Regenerate (capped at 3). No code path reaches the send path.
- **Character/segment counter** added (`apps/web/src/lib/smsSegments.ts`) — there was none before, so requirement 4's "counts remain accurate" was really "build them". GSM-7 160/153 vs UCS-2 70/67, extended chars count double, emoji count as 1 char / 2 units.
- **Kill switches:** voice is gated on `DEEPGRAM_API_KEY` (already set on the host); rewrite on `LLM_PROVIDER` (`off` disables). Either + `pm2 restart ace-api` removes the feature in seconds with no deploy and no effect on ordinary SMS. `ANTHROPIC_API_KEY` is deliberately **unset** and unnecessary — the DGX path needs no key.
- **Tests:** 84 api (76 new) + 26 web (all new) passing. `apps/web` gained a `test` script + tsconfig test exclusion, mirroring `apps/api`. `tsc` clean for api + web; web production build clean.
- **DONE since:** migration applied (`db:push`; 20 rows before and after), ownership boundary verified against the live DB, version bumped to 0.10.216 across all 7 `package.json` + the hardcoded `APP_VERSION` in `DiagnosticsSection.tsx`, committed as `979240e` on `release/0.10.216`, pushed, draft PR opened, `ace-api` reloaded so the routes are live. Verified live: `POST /me/sms/rewrite` → 200 with a correct rewrite off the DGX; `GET /me/sms-placeholders` → 200 (20 fields, 9 categories).
- **RELEASED.** PR #77 merged `979240e` to `main`; the feature is live for the team.
- **Caveat on that merge:** it landed `979240e` only — the follow-up docs commit raced the merge and did **not** make it into `main`. Recovered separately (this file + the CLAUDE.md build guardrails).
- **This has now happened twice.** PR #78 (0.10.217) likewise merged at `f1afde6`, leaving `76cf47e` (the dead-Vercel-domain fallback fix) out of `main`. It rides along in the 0.10.218 branch, so nothing is lost — but the pattern is real: a push that lands after the merge button is pressed silently misses the release. **Always run `git merge-base --is-ancestor <sha> origin/main` after a merge** rather than assuming the branch state at push time is what shipped.
- ~~**STILL OUTSTANDING:**~~ *(resolved — as of Aug 25 all pm2 services run 0.10.224-era code, and desktop publishing resumed; users are on 0.10.224/0.10.225, not v0.10.132.)* `ace-webhooks` and `ace-socket` were still running pre-0.10.216 processes — the only change in that area was a comment, so there is no functional gap, but the next `./deploy.sh` should sync them. Desktop publish remains gated on the EV cert, so Electron users are still on v0.10.132 and do not yet see the new composer; **web users have it now**.
- **Cannot be verified headlessly:** Electron microphone behaviour during a live call (the recording-blocked-while-on-a-call path) needs an on-device pass. Also the real voice→transcript round trip, which needs actual audio from a browser — the endpoint itself is confirmed wired (a deliberately invalid payload returned 502 from Deepgram, not 501, so the key is loaded). Everything else, including the full rewrite path against the live DGX, has been exercised.
- **Two self-inflicted production incidents during this session, both fixed — see §5 learnings.** Building the web bundle silently deployed the frontend while the API kept running 4-day-old code (404s on every new route), and that build omitted `VITE_FORCE_ABSOLUTE_BASE=1`, which blanked every nested route including the SSO callback.

**July 29, 2026 — v0.10.215 released: short-code SMS threads open empty / show wrong messages**

- **Root cause:** `GET /messages/threads/:number` ran the conversation key through `toE164()` before matching. The threads-list groups by the EXACT stored `thread_key`, so normalizing prepended `+` to short-code / alphanumeric sender IDs and hit the wrong bucket. Confirmed against live DB: `thread_key` `72524` (3 msgs) was queried as `+72524` → 0 rows → **empty thread** (Bug 1); `83356` (1 msg, the preview) was queried as `+83356` → loaded a *different* 6-msg June bucket → **preview ≠ thread** (Bug 2). Short codes split into drifted buckets (`83356` vs `+83356`) still exist in data — each now opens faithfully; auto-merging them was deliberately left out of scope (destructive data call).
- **Fix:** new `apps/api/src/messages/threadKey.ts` — `threadKeyCandidates()` matches the stored key VERBATIM (guaranteeing preview == thread latest), adding an E.164 alias ONLY for real ≥10-digit numbers (deep links). Detail + `/read` + `/unread` now match `threadKey IN (candidates)`; this also lets short-code threads be marked read (old `length===10` gate 400'd them, so their unread dot never cleared).
- **UI:** `Messages.tsx` gained an explicit empty-state ("No messages yet") + a distinct load-error state with Retry, so a failed load can't masquerade as a valid empty thread.
- **Tests:** first tests in the repo — `apps/api/src/messages/threadKey.test.ts` via `node:test` + `tsx` (`npm run test -w apps/api`, 8/8). Covers both bugs as regressions + a list/thread preview-consistency model. Test files excluded from the api `tsc` build.
- **Ships with:** the previously-staged 0.10.212–0.10.214 work (in-call keypad + diag logging), consolidated into this release. Version 0.10.214 → 0.10.215 across all 7 `package.json` + `APP_VERSION`; What's New entry added. `tsc` (api + web) clean.
- **Note:** the reported bugs are fixed by the backend deploy alone (server-side matching); the desktop publish only carries the empty/error-state UI.

**July 22, 2026 — v0.10.213 staged: In-call DTMF UX + non-blocking Electron inbound**

- **Non-blocking inbound (Electron):** `IncomingCall.tsx` no longer forces the full-window green ringer on the desktop shell. Electron now always renders the compact top banner so the nav rail + bottom tabs (Favorites/Messages/Recents/Keypad/Voicemail) stay visible and usable while a call rings; the native floating ringer popup (main process) still surfaces the call. Web build keeps the full-screen ringer on idle surfaces (`/keypad`, `/`, `/login`) + when there's an active call to hold. Change: `fullScreen` gated on `!isElectron`.
- **In-call DTMF visual input bar:** new `.ick-display` bar above the keypad grid (`InCall.tsx`) echoes every digit sent this call (monospace, most-recent-visible, 32-char cap) with a backspace button (double-click = clear all, disabled when empty). Light/dark themed.
- **Physical-keyboard DTMF:** while `callState === 'connected'`, a `keydown` listener sends `0-9 * #` (Numpad + top row) through the EXISTING `sendDTMF`, appends to the display bar, and auto-opens the keypad. Ignores keystrokes while an input/textarea is focused (Transfer field) or a modifier is held. Bound on connect, torn down on hangup/unmount.
- **Status:** production build + full `tsc -b` typecheck clean. NOT yet committed/tagged. On-device pass pending (live-call DTMF into an IVR + Electron banner behavior can't be driven headlessly). Open question for the reviewer: physical-key digits auto-open the keypad panel — drop `setShowKeypad(true)` if silent send is preferred.
- Files: `apps/web/src/components/IncomingCall.tsx`, `apps/web/src/pages/InCall.tsx`, `apps/web/src/styles.css`. Version bumped 0.10.212 → 0.10.213 across root + web + desktop `package.json`.

**June 25, 2026 — v0.10.205 staged: Admin "Force Update" feature**

- New Settings → Force update admin pane (admin-only, Zap icon, sits above Users in the Admin category). Lists every active user with their latest device/version/lastSeen.
- "Force update ALL users" red button + "Force update selected" + per-row checkboxes. Confirmation modal before any push.
- Blocking ForceUpdateModal mounted at app root. When the server signals a pending force-update for this device on the next heartbeat, HeartbeatReporter dispatches `ace:force-update-required`; the modal takes over: kicks off ace.checkForUpdates(), shows full-viewport block with download progress, defers install while sipService.calls.size > 0, auto-installs ~10s after download completes (or sooner on click).
- Re-uses the existing v0.10.101 UserDevice schema; no migration required. Three new admin endpoints (`GET /admin/devices/overview`, `POST /admin/force-update/all`, `POST /admin/force-update/users`). All write AuditLog entries (`admin.force_update_all`, `admin.force_update_users`).
- Behavior preserved: the existing per-device Users → Devices "Force update" button (v0.10.101) still works for one-off pushes.

**June 12, 2026 shipping summary — 22 releases in one day:**
- v0.10.128 (baseline) → v0.10.149 (webm transcode)
- All 14 P1 UX findings closed (UI_UX_AUDIT.md)
- 3 P0 QA findings closed: QA-001 socket auth, QA-003 EV cert gate, QA-005 webhook_dedup
- 10 P2/P3 UX findings shipped across v0.10.144-148
- 1 production bug fixed: voicemail greeting application error (webm→mp3 transcode)
- 1 stability fix: React error #310 in Reply with Text (v0.10.130)
- 1 major-architectural: connection-id-based canonical toNumber (v0.10.133/134)

**What v0.10.132 includes for users:**

- React error #310 fix (Reply with Text floater crash on inbound call)
- Unified incoming-call UI: stacked-call mode shows 3 buttons (Decline / Reply with Text / Hold & Accept), plain Accept removed (audio-merge bug)
- Reply with Text now works in both no-call AND stacked-call modes
- Orange pause badge on Hold & Accept button (visually distinct from plain Accept)
- Floater row top-aligned so multi-line labels don't push buttons up

**What v0.10.133/v0.10.134 fixed (server-only, no client install needed):**

- Inbound calls missing from Recents tab for TeXML voicemail trial users. Root cause: SIP-delivery-leg webhooks store toNumber as SIP credential username (e.g. `userabdulla74993`) not the phone number, and the Recents query had a v0.10.108 filter excluding any sipUsername match. Fix: `canonicalInboundToNumber` helper in `apps/webhooks/src/main.ts` looks up `UserDid.didNumber` via the matched userDidId (Pass 0) OR userId fallback (Pass 1/2). Call rows now always store real phone numbers.
- Historical 4905 rows backfilled via two scripts: `backfill-sip-username-tonumbers.ts` (v2, userDidId-gated) for 159 non-trial users' rows; same script logic in v3 form for the 4746 TeXML-trial rows including Abdulla's 4646.

**What v0.10.135 experiments with (canary):**

- The v0.10.113 "60s periodic full SIP UA reconnect" is feature-flagged OFF (`ENABLE_60S_PERIODIC_RECONNECT = false` in `apps/web/src/services/sip.ts`).
- 15s force-register continues normally (keeps SIP registration alive via gentle REGISTER refresh).
- Hypothesis: the Telnyx server-side INVITE-routing-staleness bug that v0.10.113 was solving is fixed, and the 600ms gap every minute is causing ~1% inbound failure baseline + the "Disconnected" UI state after SSO.
- **Validation procedure:** Abdulla installs v0.10.135 .exe on his own machine, runs for 24h, monitors via Settings → Diagnostics → Download logs. If clean: publish v0.10.135 to all testers. If routing stale: install v0.10.132 .exe back over the canary, then ship v0.10.136 with the flag flipped back to true.

---

**August 25, 2026 — Caller names in ACE Bot Teams cards + notification emails (LIVE — `ace-webhooks` reloaded)**

- **Problem:** every Teams card and notification email led with a bare formatted number, so a missed call from a saved contact read exactly like a cold call from a stranger.
- **Root shape of the fix:** the card builders in `apps/webhooks/src/teamsCards/` have accepted an optional `fromName` since v0.10.0 and already render `Sarah Chen — (732) 200-1305`. Nothing ever populated it. So this is a resolver plus six call sites, not a card rewrite.
- **New:** `apps/webhooks/src/contactName.ts` → `resolveContactName(userId, phone)`. Resolution order is the user's own Favorites (including the v0.10.66 `FavoriteNumber` children) then another ACE user's `UserDid` → coworker name. Last-10-digit matching, JS-side filter like the blocklist. Fails open to `null` (number only) on any DB error; returns `null` under 10 digits so short codes and withheld callers can't collide with a real contact.
- **Wired into** all three `notify*` in `teamsNotifier.ts` and all three in `emailNotifier.ts` (same gap existed there). Emails go through a new `callerLabels()` helper: body gets `Name — number`, subject lines and header titles get the name alone.
- **Deliberately NOT included:** JobDiva enrichment. `apps/webhooks` can't import from `apps/api` (CLAUDE.md §1.4) and the notify path shouldn't grow an external HTTP call while a voicemail's 30s fallback timer runs. Documented as a guardrail with what it would take.
- **Verified read-only against production:** saved favorites resolve by name, the loose `(973) 727-0611` form resolves identically to `+19737270611`, a coworker's DID resolves to their name, and unknown numbers / a 5-digit short code / `anonymous` all return `null`. `tsc -p apps/webhooks --noEmit` exits 0.
- **CLAUDE.md:** the whole outbound-notification stack was undocumented (modules stopped at 29). Added **module 30 — Outbound Notifications (Teams Cards + Email)** with the no-queue seam, the name-resolution order, and the fail-open / dedup / no-JobDiva guardrails, plus cross-refs from modules 16 and 25.
- **Shipped server-side.** Committed as `cabca0d`, `npm run build -w apps/webhooks`, `pm2 reload ace-webhooks` — new pid up, listening on 3002, TeXML app re-verified, zero `[contactName]` warnings since. Applies to every user on any client version; api and web bundle untouched, no client install needed.
- **Web + api deployed same session (Aug 25).** The live web bundle was still **0.10.216** (built Aug 5), so building it published 0.10.217 → 0.10.224 to every *browser* user in one step — desktop users are unaffected until a release is published. Order was deliberate: `ace-api` rebuilt and reloaded FIRST (its dist was from Aug 17 and predated `0cf08c6`, which derives campaign status instead of storing it), then `VITE_FORCE_ABSOLUTE_BASE=1 npm run build:web`. Verified: `/health` 200 on the new api pid, `dist/index.html` references `/assets/…` absolutely, `/assets/<hash>.js` serves `application/javascript`, and `/settings/email-notifications` serves the SPA. Root `build:api` was deliberately NOT used — it chains `db:push:ci` against the production database and there was no schema change.
- **CLAUDE.md §1.4 verification command was wrong and is fixed.** It told you to curl `/settings/assets/<hashed>.js` and expect `application/javascript`; that path returns `text/html` even on a correct build, because with an absolute base nothing requests it and the SPA fallback answers. Following it literally reads as "the absolute-base fix didn't work".
- **Release notes** (`5878929`): What's new entry + section 3 of `docs/email-0.10.224-users.md`. The rest of that branch (`e7f3292`, the bulk-send `{recruiter}` fix) is web-only and still NOT deployed — `apps/web/dist` is untouched, so the announcement's sections 1 and 2 are not live yet. Don't send that email until the web bundle is built.

---

**August 27, 2026 — 0.10.227: personal SMS templates were unreachable, not missing (WEB LIVE)**

- **Reported as:** users can't create their own SMS templates, and they should see every placeholder while writing one. Both were built — 0.10.216 (personal templates) and 0.10.224 (full field list open by default when creating). Neither was broken.
- **Checked before changing anything:** `POST /me/sms-templates` returns **401, not 404** on the live API (route present), and the table holds **16 personal templates** — `afreenp@aptask.com` created one the previous afternoon. The feature works end to end.
- **The real number: 3 users out of 83 have ever created one.** afreenp (14), saifalin (1), soumyas (1) — and the last two both stopped on Aug 5, the day it shipped.
- **Cause is discoverability, and it was structural.** There was exactly ONE route to the editor: Messages → open a conversation with a specific person → Templates pill → New (`Messages.tsx:1951`, inside `ThreadDetail`). **You could not write a template without first having a text thread open with somebody.** A template is a thing you write *before* you need it; the feature demanded you already be mid-conversation.
- **Settings actively sent people the wrong way.** Settings → **Quick replies** carried the blurb "**SMS templates**" — a different, device-local feature. Someone hunting for templates found that, concluded it was the feature, and stopped looking. The real pane, Settings → SMS templates, is `adminOnly`. So the honest answer to "why can't users create templates" is that Settings told them these were their templates and they weren't.
- **Fix:** new **Settings → My SMS templates** (Personal), listing your own templates with create / edit / delete, plus a line pointing at the company set. It mounts the SAME `SmsTemplateEditor` the composer uses, so the field list — open by default on create, split into auto-fill vs type-it-yourself with examples — comes along unchanged. The Quick replies blurb now reads "One-tap canned replies, saved on this device". Delete uses an inline confirm, not `window.confirm`, which doesn't render in the Electron shell (UX-004).
- **Version drift is the smaller half, but it is real.** Of 85 devices active in the last 7 days: **9 users are on builds older than 0.10.216 and literally cannot create a template**, and **12 more are on <0.10.224**, so their editor still hides the field list behind a collapsed button. 64 are current. No code change reaches those 21.
- **Why those 21 are stuck is NOT established.** Releases publish fine and auto-update demonstrably works (0.10.226 → 38 devices in a day), so "the release wasn't published" is not the explanation. Candidates not yet checked: the app never restarted, the v0.10.143 signing gate failing on those machines, or update errors in their logs. Settings → Force update can push them regardless, but somebody should find out why first — 21 users a version behind is a symptom, and force-update only treats it.
- **Not verified:** the new pane hasn't been opened by a human. It reuses the admin section's proven class set (`settings-section`, `users-admin-table`, `device-action`) rather than new CSS, and typechecks and builds clean, but nobody has looked at it.
- **SHIPPED (Aug 27).** Bumped to 0.10.227 across the 9 manifests + `APP_VERSION` with a What's New entry, merged `56efaa5` to `main`, tagged `v0.10.227`, and `apps/web/dist` rebuilt on the host. Verified live: absolute `/assets/` base, `index-CDvzqIA6.js` serves as `application/javascript`, `/settings/my-sms-templates` returns 200, and the shipped bundle contains the new pane. Desktop installers build off the tag.

---

**August 26, 2026 — 0.10.226: conference self-mute muted the wrong things (WEB LIVE; desktop draft awaiting publish)**

- **Reported as:** muting myself in a conference mutes everyone. That was half of it. `toggleMute()` called JsSIP's `session.mute()`, which is `sender.track.enabled = false` — and in conference the sender's track is not the mic, it's the **mixed** track (mic + every other participant) that `startConference()` puts there via `replaceTrack`. So the active leg's participant lost the whole mix, including the other participant's relayed voice; that's the reported symptom.
- **The unreported half is worse.** `toggleMute()` only ever touches the ACTIVE call, so the second leg's sender was never muted at all — the user stayed fully audible to that participant while the button read "Unmute". Someone believing they were muted kept talking. Both halves come from the same line.
- **Fix:** the mic now feeds every outgoing destination through one `GainNode`, and self-mute sets that gain (0 / 1, 10ms ramp so it doesn't click on the far end). Participants' relayed paths and the speaker path both sit downstream of it and are untouched, so everyone keeps hearing everyone. `toggleMute()` branches on a new `isConferenceActive()`; participant-mute (the per-pill button, which disconnects a source node) was already correct and is unchanged.
- **Three state-desync corollaries fixed with it**, each of which silently un-mutes a user who believes they're muted: (1) merging while muted — the mixed track arrives `enabled`, so the mute vanished at Merge; now carried into the gain node, and the stale `_audioMuted` is cleared on every leg because JsSIP re-applies it on the next re-INVITE and would disable the mixed track. (2) A participant dropping — `stopConference()` restores mic tracks via `replaceTrack(clone)`, and clones arrive `enabled`; now restored muted, with `session.mute()` re-applied so JsSIP agrees. (3) The gap between Merge committing and `getUserMedia` resolving — self-mute is graph-owned from the merge (`conferencePending`), so a Mute pressed in that window can't take the SIP path.
- **UI:** `InCall`'s `muted` was local `useState(false)` and went stale across both transitions. `SipContext` now exposes `isSelfMuted()` and the component resyncs when `conferenceActive` flips.
- **Tests:** 5 new in `apps/web/src/services/sipConferenceMute.test.ts` (93 web total, passing). They drive the real `startConference()`/`toggleMute()` against a fake Web Audio graph and assert on the graph edges — that self-mute moves the mic gain and disconnects **no** participant path, and that no leg's mixed track is ever disabled. Verified as real regression tests: reinstating the old one-line behaviour fails 2 of them, restoring the fix passes 5/5. First test in the repo to cover `services/` — `sip.ts` imports cleanly under `node --import tsx` with light `window`/`document`/`navigator`/`MediaStream` stubs, which is worth knowing for future SIP work.
- **Not verifiable headlessly:** the actual three-party audio. A real conference on hardware still needs a pass — confirm each participant can hear the other while you're muted, and that unmuting comes back cleanly.
- **Version bumped to 0.10.226** across all 9 `package.json`/`manifest.json` files + the hardcoded `APP_VERSION` in `DiagnosticsSection.tsx`, with a What's New block. `tsc` clean for web/api/desktop; bundle verified via a scratch outDir so `apps/web/dist` was NOT republished.
- **SHIPPED to web (Aug 26).** Merged fast-forward to `main` (`682b270`), pushed, tagged `v0.10.226`. `apps/web/dist` rebuilt on the host with `VITE_FORCE_ABSOLUTE_BASE=1` — verified live: absolute `/assets/` base, `index-Xl1qbPbx.js` returns `application/javascript` through nginx, `/settings/notifications` returns 200, and the shipped bundle contains the new conference self-mute path.
- **Backend deliberately not reloaded.** The change is `apps/web` only — no new routes, so there is nothing for `ace-api`/`ace-webhooks` to serve. They keep reporting 0.10.224 and that is correct, not drift.
- ~~**DESKTOP STILL NEEDS A HUMAN.**~~ **This was wrong — corrected Aug 27.** `apps/desktop/package.json` does set `releaseType: "draft"`, but the GitHub API shows every recent tag published with 12 assets: `v0.10.225` at 2026-08-26T12:52Z, `v0.10.226` at 13:36Z, both `draft=false`. The draft does not sit there; it gets published as part of the normal flow. **The tag push is the whole desktop release step.** The "0.10.225 only reached 2 devices" figure that this claim was built on was ordinary auto-update lag measured an hour after the tag — 0.10.226 was on 38 devices within a day. Do not re-derive the draft theory from the `releaseType` line alone; check the API.
- **Shipped without the on-hardware conference pass**, at the user's explicit call. The three-party audio has not been heard by a human: tests prove the graph topology (self-mute moves the mic gain, disconnects no participant path, never disables a mixed track), not what comes out of a speaker. If a report comes in, that pass is the first thing to run.

---

**August 25–26, 2026 — 0.10.225: silent ringer for a call arriving mid-call (RELEASED TO ALL USERS)**

- **Ask:** a second candidate calling during a live conversation rang loudly and disrupted it. Wanted a preference, the sound suppressed, the call still visible.
- **Two sound sources, not one.** The synth ringtone in `IncomingCall.tsx` is the obvious one; `lib/notify.ts` hardcoded `silent: false` on the OS notification, and `notify()` only fires when the window is HIDDEN — i.e. exactly the mid-call case where the user is working in another app. Silencing only the ringtone would have left the Windows ding on top of the call and read as "the toggle doesn't work". `notify.ts` now takes `silent?: boolean`.
- **The Electron floating ringer plays no audio** — no `<audio>`, no oscillator in its inline HTML; the sound is entirely the main renderer's. The `webPreferences` comment at `apps/desktop/src/main.ts:538` claiming otherwise is stale. Nothing in the desktop shell needed to change, and the floater keeps providing the visual alert (it already receives `hasActiveCall` since v0.10.120).
- **Pref:** `NotificationPrefs.silenceRingerDuringCall`, device-local like the rest, **default ON**. Approved as a default rather than opt-in: the loud ring was the complaint and the call stays fully visible. Settings → Notifications, under Ringtone volume.
- **Decided once per incoming call** (a ref stamped on `incoming.callId`, deliberately not re-evaluated when `hasActiveCall` changes): if the user hangs up the first call while the second is still ringing, a ringtone starting abruptly mid-ring is worse than staying quiet.
- **Scope:** silences only while a call is `connected`, matching the `hasActiveCall` definition Hold & Accept already uses. A call arriving while you're *dialing out* (hearing ringback) still rings — deliberate, easy to widen.
- **`apps/web/src/api.ts` touched for an unrelated reason.** `import.meta.env.VITE_API_URL` was read at module scope, so any lib importing `api` was untestable under the `node --import tsx --test` harness — the suite died on import before one assertion. Now `import.meta.env?.`; Vite still statically replaces it at build time, so production is byte-identical. This is what made `userPrefs` testable at all.
- **Tests:** 4 new (88 total, all passing). The one that matters asserts an existing user whose stored prefs predate this key still reads the default — otherwise 60 users would read `undefined`, keep the loud ring, and see the toggle showing "off" for something they never set.
- **Version bumped to 0.10.225** across all 9 `package.json`/`manifest.json` files + the hardcoded `APP_VERSION` in `DiagnosticsSection.tsx`. `tsc` clean for web/api/desktop; bundle verified via a scratch outDir so `apps/web/dist` was NOT republished.
- **What's new** now has a 0.10.225 block holding this feature plus the ACE Bot caller-names line, which was **moved out of 0.10.224** — no 0.10.224 installer ever contained it, so it could never have been seen there.
- **SHIPPED (Aug 26).** PR #91 merged (`f0f0a0c`, ancestry confirmed on `origin/main`), tagged `v0.10.225`, desktop release published to all users, and `apps/web/dist` rebuilt so browser users have it too. Backend needed nothing — no api/webhooks change in this bump, which is why `ace-api`/`ace-webhooks` correctly still report 0.10.224.

---

## 2. Open tasks (prioritized)

| # | Priority | Title | Where to start |
|---|---|---|---|
| **UI/UX Audit** | high | **55 UX findings in `UI_UX_AUDIT.md`** (18 P1, 24 P2, 13 P3). Each finding has stable ID (UX-001..UX-055). User selects items to implement by pasting "Address UX-NNN, UX-NNN" back. Top P1s: UX-001 (no focus-visible), UX-003 (TelnyxStatusBanner Rules-of-Hooks - latent crash same as v0.10.122/.125/.127/.129), UX-004 (22 alert/confirm sites broken in Electron), UX-007 (Dialpad call button clipped at 1366×768 / 125% DPI), UX-012 (modal backdrops below CLAUDE.md locked spec) | `UI_UX_AUDIT.md` |
| **#1** | high (next major) | **v0.11.0 MAJOR — Voicemail Retention + Global Presence + DND**. Three feature areas combined into one major release. (1) Soft-delete voicemails + Trash tab + 30-day hard cap + 7-day trash retention. (2) Global Presence: user-controlled status (Available/Busy/Meeting/Away/Custom) with auto-on-call + idle detection, visible across the app. (3) Do Not Disturb: mute incoming calls (server-side INVITE → voicemail short-circuit) with timer auto-disable + optional schedule. Full design in task #1's TaskUpdate description. | `apps/web/src/pages/Voicemail.tsx`, `apps/webhooks/src/main.ts`, `apps/api/src/me/me.routes.ts`, `apps/socket`, Prisma schema |
| **#18** | medium (in-flight) | **v0.10.135 canary validation 24h** — install on abdulla's machine, monitor, decide promote vs revert | GitHub Releases Draft v0.10.135 |
| **#19** | low | First-launch UX polish — dialer shows blank → black → SSO sequence at launch. BrowserWindow `show: false` until `did-finish-load`, set `backgroundColor: '#0f1116'` to avoid white flash | `apps/desktop/src/main.ts` |
| **#1 (orig)** | n/a | Voicemail duplicate notification — superseded by v0.11.0 retention design (#1) | n/a |
| TeXML trial monitoring | ongoing | 5-7 day observation window on the 8 testers (himank, Rahul S, Stefan, mansi, eela, rajat, Ravindra, nilesh). Watch their voicemail/Recents behavior, gather feedback | server logs + ask testers directly |

---

## 3. Architecture cheat sheet

**Monorepo layout (npm workspaces):**

- `apps/api` — Fastify API server (port 3000). Self-hosted under pm2 as `ace-api`.
- `apps/socket` — Socket.IO server for real-time events. pm2 `ace-socket` (:3001).
- `apps/webhooks` — Telnyx webhook receiver. pm2 `ace-webhooks` (:3002).
- `apps/web` — Vite + React dialer UI. Served static by pm2 `ace-web` (:3010) AND packaged into Electron via `apps/desktop`.
- `apps/desktop` — Electron main process. Builds the .exe via `electron-builder`.
- `packages/db` — Prisma schema + scripts (diagnose, backfill, seed, etc.).

**Hosting:** fully self-hosted on the `dialer.aptask.com` host (pm2 via `ecosystem.config.cjs`, behind an nginx reverse proxy; `/api/*`→:3000, `/webhooks/*`→:3002). Deploy with `./deploy.sh`. Env from repo-root `.env`. No Render/Vercel.

**Database:** self-hosted PostgreSQL on the app host. `DATABASE_URL=postgresql://…@127.0.0.1:5432/acedialer`. Schema in `packages/db/prisma/schema.prisma`.

**SIP backend:** Telnyx. Each user has a SIP credential (`sipUsername` like `userabdulla74993`) registered against `sip.telnyx.com:7443` over WSS. JsSIP library handles the WebRTC + SIP plumbing.

**Voicemail flows (two variants):**

1. **Hosted Voicemail** (default for most users): Telnyx hosts a recording app. Webhooks fire `call.recording.saved`.
2. **TeXML Voicemail trial** (8 testers + abdulla, gated by `TEXML_TRIAL_DIDS` env var): we host the TeXML XML response and the recording flows through Telnyx differently. Per-call recording-status polling is a workaround for a Telnyx bug where recordingStatusCallback doesn't fire for Dial-then-Record flows.

**Attribution chain (resolveUserAndDid in webhooks/main.ts):**

1. **Pass 0** — connection_id from webhook payload matches `UserDid.connectionId` or `UserDid.preMigrationConnectionId`. Sets userId AND userDidId. Skipped if connection_id is the shared `TELNYX_VOICEMAIL_CC_APP_ID` because that ID is shared across all TeXML trial users.
2. **Pass 1** — `payload.sip_username` field matches `User.sipUsername`. Sets userId only.
3. **Pass 2** — `payload.toNumber` (when it looks like a sipUsername — no `+`, no digits, no `@`) matches `User.sipUsername`. Sets userId only.
4. **Pass 3** — last 10 digits of toNumber match `UserDid.didNumber`. For inbound, this is authoritative.

If none match: row is dropped (v0.10.108 guard). Pre-v0.10.108 the fallback was userId=1 which contaminated abdulla's call history with thousands of unrelated calls.

**Canonical toNumber (v0.10.133/134):** at write time, if rawToNumber isn't a phone number (e.g. it's a SIP credential username), look up the matched UserDid's didNumber OR the user's primary UserDid via userId fallback. So Call rows always store dialed phone numbers, not SIP usernames.

---

## 4. Critical conventions when modifying this codebase

### The workspace-sync corruption pattern

The Cowork workspace bridge has a recurring bug that corrupts files during round-trips. Symptoms: null-byte padding at EOF, truncated tails, content drift in unrelated files.

**Mitigations in place:**

- `scripts/strip-null-bytes.mjs` runs as `prebuild` hook on every build (added v0.10.128).
- All multi-step source changes go through a single `scripts/apply-vXXX-*.mjs` local Node script that does ALL edits in one execution (no Cowork tool round-trips). Pattern established v0.10.129+.
- The apply-script reads files once, applies a list of `find` → `replace` edits using exact-anchor matching, fails loudly with `FATAL` if any anchor isn't found, and writes once at the end. Handles LF/CRLF automatically.

**When making changes:** ALWAYS write an apply-vXXX-name.mjs script. Don't use the Edit/Write tools directly across multiple files — corruption WILL happen. The user runs the script locally on Windows via `node scripts/apply-vXXX-name.mjs` which bypasses the bridge entirely.

### Release-script template (`scripts/apply-vXXX-*.mjs`)

Every release should follow this shape (see `scripts/apply-v131-icon.mjs`, `apply-v132-unify.mjs`, etc. as canonical examples):

```js
function applyEdits(relPath, edits) {
  // Read file
  // Detect LF/CRLF
  // Normalize each anchor's line endings to match file
  // includes() check, fail loudly if not found
  // String.replace + uniqueness check
  // Write once at end
}

// 1. Source code edits (sip.ts, IncomingCall.tsx, etc.)
applyEdits('apps/...', [{ find: '...', replace: '...', label: '...' }]);

// 2. Version bumps in all 7 package.json files
const PKGS = ['package.json', 'apps/api/package.json', 'apps/web/package.json',
              'apps/desktop/package.json', 'apps/socket/package.json',
              'apps/webhooks/package.json', 'packages/db/package.json'];
// Replace "0.10.XYZ" → "0.10.XYZ+1"

// 3. DiagnosticsSection APP_VERSION bump

// 4. WhatsNew entry at top of WHATS_NEW array

console.log('ALL EDITS APPLIED SUCCESSFULLY');
console.log('Next steps: strip-null-bytes, tsc, diff, commit, push');
```

### CI/CD setup

- **Backend + web:** no CI. Self-hosted — deploy by running `./deploy.sh` on the `dialer.aptask.com` host (git pull + install + prisma generate + build + `pm2 startOrReload ecosystem.config.cjs`).
- **Desktop:** `build-desktop.yml` — builds the Electron installer via electron-builder and publishes a Draft GitHub release (clients auto-update). This is the only GitHub Actions workflow. (The old `render-deploy.yml` was removed when we left Render.)

### User constraints (don't violate these)

From `CLAUDE.md`:

- **95% confidence rule**: don't make changes until 95% sure of what's needed. Ask follow-up questions if not sure.
- **No mistakes**: critical-path code MUST be correct first try.
- **Confirmation before run**: don't tell user to run multi-step shell commands without first describing what each step will do.
- **Don't invent names**: stop using random names when you don't know who/what someone is.
- **No new modal CSS class without inheriting overlay behavior**: see CLAUDE.md UI Standards section 5.

From session history:

- Always present a small visual mockup before changing icon/visual design (user prefers to see proposed UI before code lands).
- For risky behavioral changes (like v0.10.135 60s reconnect disabled), ship as **Draft canary**, validate on abdulla's machine 24h, THEN promote.
- For UI-only changes, ship to all users directly via Published release.

---

## 5. Recent learnings (debugging discoveries)

**August 13, 2026 — v0.10.221 STAGED (UNCOMMITTED, NOT BUILT): "click to dial keeps repeating stale numbers or incorrect numbers" (reported by abdulla on 0.10.220):**
Ground truth first: the `user_devices` heartbeat showed abdulla on **0.10.220**, so the 0.10.220 repeat fix (`bceef60`) was already in the reporting build — this was a live bug, not a stale install. Everyone else is on 0.10.217 or older, i.e. no click-to-dial at all, so there is exactly one reporter and no comparison data. Three symptoms, three distinct causes; only the first was a defect in the click-to-dial code itself.
- **The stale number came from the last-dialed recall, not from the capture.** A failed capture empties the field (0.10.220, deliberately), the user presses Call again, and `handleCall`'s empty-field branch recalls `ace_last_dialed` — planting an unrelated old number directly under the red error, one press from being dialled. The two behaviours are individually correct and jointly a wrong-number bug. Recall is now suppressed while a capture error is showing, and the Call button is disabled rather than silently doing nothing.
- **"A number I selected previously" is the clipboard hotkey working as designed.** It reads the clipboard, not the selection, and it cannot do otherwise (no clipboard polling, no synthesised Ctrl+C — both rejected in 0.10.218 for good reasons). Highlight without Ctrl+C and you get your previous copy, correctly and invisibly. Unfixable as behaviour; fixed as *legibility*: `src` now names the capture path (`clipboard`/`tel`/`selection`), main flags a repeat press on unchanged clipboard content, and every refusal quotes the text it read. Only the `invalid` branch quoted before, so "that's too short to dial" was the one message that gave the user nothing to check.
- **Ambiguous text was resolved by position.** `parseSelectedNumber` returned the first candidate that validated, so among equally long ones the leading token won — on a recruiting screen as likely a 10-digit candidate id as a phone, and `isValid()` can't distinguish them. Now evaluates a whole digit-count tier and refuses with both numbers named. Incidental finding while writing the test: `555xxxxxxx` is not a valid US number to libphonenumber, so any test that wants two plausible numbers needs two real area codes.
- **The extension could dial a number the user couldn't see.** The dial string is parked in `data-ace-dial` at scan time, but a chip is a `<span>` injected into someone else's SPA — an ATS re-render can leave it displaying one number while carrying another. `dial()` now treats the displayed text as authoritative, and the observer watches `characterData` and re-derives the whole mutated subtree (unwrap chips → rescan) instead of only inspecting `addedNodes`, which by definition never contains the stale chip.
- **Known residual limit, worth writing down:** when a framework updates a text node we replaced, it writes into the node we detached, so the page itself goes stale and our chip goes with it. Nothing inside a content script can fix that — the user is then looking at an out-of-date row and dialling what it shows. If that turns out to be common in JobDiva, the fix is to stop injecting chips and go back to a context-menu action on the selection (removed in the Aug 6 scope change; one small commit to restore).
- **Verified:** `tsc` clean across web/desktop/extension, 72 web tests (8 new) + 8 extension tests pass. **NOT built and NOT deployed** — the web bundle is a production deploy on this host and the desktop side needs an Electron release, so both wait for a go-ahead.

**August 6, 2026 — v0.10.218 STAGED (UNCOMMITTED): Click-to-Dial for highlighted numbers (branch `release/0.10.218`, off 0.10.217):**
Key finding from the investigation: ~70% already existed. `ace-dialer://call?to=…` → prefill (no auto-dial) has been in production since v0.10.4 for the Teams card buttons, so this was never a "how do we dial from outside" problem — only a "how do we capture highlighted text" one.
- **Shipped (≥95% confidence):** `parseSelectedNumber()` in `lib/phone.ts` (strict extractor for arbitrary text — extensions → post-dial DTMF, unicode punctuation from Word/PDFs, prose-embedded numbers, vanity rejection; 45 web tests); `tel:`/`callto:` handling in `main.ts` + electron-builder protocols; opt-in registration and a clipboard-read global hotkey via IPC from Settings; a strict-validation branch in `Dialpad.tsx` gated on `src=selection`; MV3 browser extension in `apps/extension/`.
- **Deliberately NOT shipped, per the 95% gate:** the macOS Automator Quick Action (needs a notarization/Gatekeeper spike) and the Windows auto-copy hotkey (needs a native input-synthesis module, which AV/EDR flags as keylogging and macOS gates behind Accessibility). The clipboard-read hotkey is the safe substitute — no native module, no OS permission.
- **Windows has no OS-level "right-click on selected text" API.** The shell context menu operates on files. In-browser right-click is the extension's job; outside the browser, Windows gets `tel:` links plus the hotkey. This is an OS limitation, not a design choice.
- **The extension requests `contextMenus` and nothing else** — no content script, no host permission. Our users work in an ATS full of candidate PII; `<all_urls>` would be a materially different security review for one convenience feature.
- **Scheduling constraint:** every desktop piece needs an Electron release. *(Aug 26 correction: the "auto-update is EV-cert-locked with users on v0.10.132" half of this is no longer true — releases through 0.10.225 have reached users. The constraint that remains is simply that desktop changes wait on an installer build.)* The extension is the exception — it distributes via the Chrome/Edge stores or Intune, independent of the desktop release, so it can reach users first.
- **macOS Services item built but NOT auto-installed** (`apps/desktop/resources/Call with ACE Dialer.workflow`). Complete, hand-installable in one `cp -R`, documented with a test checklist. Left unwired on purpose: Automator Quick Actions with a shell action interact with Gatekeeper/notarization and the macOS automation-consent flow in ways that can't be verified without a Mac, and auto-copying a bundle into `~/Library/Services` either silently no-ops or throws an unexpected consent prompt. macOS users aren't blocked meanwhile — `tel:` links and the clipboard hotkey both work there today; the Services item only adds right-click-on-selection *outside* the browser.
- **SCOPE CHANGE (Aug 6, requested):** right-click-on-selection was dropped in favour of **auto-detect + highlight**. The extension now scans page text, underlines real phone numbers, and one click prefills the desktop dialer. The context-menu code was removed; it's one small commit away if detection turns out to miss numbers in practice and a manual fallback is wanted.
- **This required the permission I had argued against, and it was flagged before building.** Auto-detection means reading page text — unavoidable. But it was built so the extension has **no `host_permissions` and no static `content_scripts`**: it can read nothing on install, and registers the scanner dynamically per domain granted on its options page (Chrome's own prompt; revocable per site; pre-grantable by Intune policy). Blanket `<all_urls>` would mean a compromise exposes every page a recruiter visits; this exposes only the ATS domains someone enabled.
- **False positives are the real risk, not missed numbers.** An ATS page is full of candidate IDs, req numbers, invoice refs, salaries, ZIP+4. Detection uses libphonenumber `isValid()` (bundled into the content script — hence ~125 KB), a negative-context word list, digit-glue and currency guards, and a 10–15 digit window. 8 tests pin both directions; 28/28 on a realistic sample including every false positive I could think of.
- **Page-safety rules** (documented as CLAUDE.md guardrails): never touch `<input>`/`<textarea>`/`contenteditable`, skip script/style/anchors and our own output, wrap only in a `<span>`, batch writes, debounce the MutationObserver via `requestIdleCallback`, cap nodes per pass, skip iframes.
- **Extension launch path hardened.** The first version navigated the ACTIVE tab to the `ace-dialer://` URL. That's fine when the desktop app is installed, but when it isn't, Chrome navigates the tab to an error page and the user loses whatever they were looking at — destroying a half-filled ATS form because someone right-clicked a number. Now opens a background tab (`active:false`) and closes it after 1.5s.
- **Extension icon** taken from the real 1024×1024 app icon rather than inventing artwork or adding a native image dependency (no ImageMagick/sharp on the host) purely to downscale. Chrome scales a single 128 entry; generate exact 16/48 before store submission if review asks.
- **Store listing copy drafted** in `apps/extension/README.md`, including the permission justifications and the data-use disclosure ("collects nothing, makes no network requests"). Recommend **Unlisted**, not Public — it's useless without the desktop app.
- **Outstanding before this ships:** store publication or Intune force-install; the on-device matrix test per app/platform; and the macOS checklist in `resources/README-macos-services.md` before wiring the Quick Action into the installer.

**August 5, 2026 — v0.10.217: SMS length cap + scheduled-send counter (branch `release/0.10.217`, off `main`):**
Two follow-ups measured against 90 days of real traffic (21,060 outbound messages: p90 body ~337 chars, 27.7% multi-segment, 9.9% non-ASCII, 8.8% carrying fixable typographic punctuation, **0.00% over 1600 chars**).
- `MAX_SMS_BODY_CHARS = 1600` added to `messages/sendMessage.ts` and enforced inside `sendMessageImmediate`, so the immediate route AND the scheduled worker are both covered by one check. `POST /messages` and scheduled-create validate up front for a clean 400. Cannot reject real traffic (nothing has ever exceeded it); it exists to stop a pathological paste going out as 30+ billed segments.
- The scheduled-send modal had **no** length feedback and no cap — fixed, it now uses the same counter as the composer.
- Deliberately NOT done: no `maxLength` on the textarea (silently truncates a paste), no warning on multi-segment (27.7% of traffic is legitimately 2–3 segments), no emoji stripping. The typographic-normalization nudge was scoped out — real but worth only single-digit dollars a month.
- **Dead-domain fallbacks removed.** `apps/webhooks/src/emailNotifier.ts` and `teamsCards/types.ts` both defaulted to `https://ace-dialer.vercel.app` when `WEB_BASE_URL` was unset. Never fired in production (the var is set on the host) but it was a silent landmine: dropping one env var would have pointed every missed-call / SMS / voicemail email and every Teams card button at a decommissioned site, with nothing in the logs. Both now default to `https://dialer.aptask.com`. Verified no functional dead-domain default remains anywhere in `apps/` or `packages/` — the surviving `vercel.app` / `onrender.com` strings are all historical comments.
- **Unrelated but discovered here: the Vercel GitHub App is still installed on the repo** and still linked to a Vercel project (`acedialerv4-web`), so every PR builds a public preview and `vercel[bot]` comments on it. Nothing in the repo triggers this — it's a GitHub/Vercel-side integration that survived the migration off Vercel. Worth deleting the project (takes the public preview down) and removing repo access from the app. A live, unauthenticated preview of the dialer on a random `*.vercel.app` subdomain is the actual concern, not the email noise.

**August 5, 2026 — `npm run build -w apps/web` IS a production deploy of the frontend:**
pm2's `ace-web` serves `apps/web/dist` **directly off disk**. There is no copy step, no cache, no restart needed — the moment a build writes that directory, every web user is on the new bundle. During the v0.10.216 session, builds run purely to typecheck silently published the new UI while `ace-api` kept running a 4-day-old in-memory process, so users saw Record/Rewrite buttons that 404'd on every click. **If you build the web bundle on the host, you have deployed it** — either finish the job (`pm2 reload ace-api` so the backend matches) or don't build in the repo working copy. Note `pm2 reload` alone does NOT pick up code the way a fresh start does for *other* services: `ace-webhooks` and `ace-socket` were left on old processes and needed the same treatment.

**August 5, 2026 — a bare web build blanks every nested route (missing `VITE_FORCE_ABSOLUTE_BASE=1`):**
Vite's base here defaults to `'./'` (relative), which is correct for Electron's `file://` load and **wrong for the self-hosted SPA**. With relative paths, a browser on `/settings/audio` resolves `./assets/index.js` to `/settings/assets/index.js`; the SPA fallback answers with `index.html` as `text/html`; the browser refuses it ("Failed to load module script") and renders a **blank page**. Single-segment routes (`/messages`, `/keypad`) happen to work, which makes this easy to miss — the broken ones are `/settings/:section` and `/auth/microsoft/callback`, i.e. **SSO login**. `deploy.sh` sets the flag; a hand-run `npm run build -w apps/web` does not. Always use `VITE_FORCE_ABSOLUTE_BASE=1 npm run build:web` for the host, and verify with:
`curl -D- -o /dev/null http://127.0.0.1:3010/settings/assets/<hashed>.js` → must be `application/javascript`, never `text/html`.

**August 4, 2026 — Qwen3 on the DGX: the OpenAI-compatible `/v1` endpoint is unusable for short tasks:**
Qwen3 is a hybrid *reasoning* model and Ollama's `/v1` path offers no way to turn thinking off — the documented `chat_template_kwargs: {enable_thinking: false}` is silently ignored. Measured with the SMS-rewrite prompt: **16,031ms vs 772ms**, ~640 vs 24 output tokens, 5/7 vs 7/7 guard passes. The failures are the nasty part: HTTP 200 with **empty `content`**, because reasoning consumed all of `max_tokens` and the reasoning went into a separate `reasoning` field. Use the native `/api/chat` with `think: false`. Also: the internal `QWEN-MIGRATION-GUIDE.md` recommends `qwen3:32b`, which **does not exist** on the box (`curl http://172.16.219.222:11434/api/tags` for the real list), and cold start is ~47s not 10–30s. The DGX is reachable from the app host at `172.16.219.222:11434` in ~13ms with no VPN or tunnel.

**June 12, 2026 — React error #310 in Reply with Text (v0.10.122/.125/.127/.129 all crashed):**
Three prior attempts to add Reply with Text to the Electron floater crashed the renderer when an incoming call arrived. Root cause finally caught via DevTools console capture in v0.10.129: the new useEffect was placed AFTER the `if (!incoming) return null` early-return guard in IncomingCall.tsx, making it a conditional hook. On first render (no call) only 3 hooks ran; on second render (call arrives) the 4th hook tried to run, React detected the mismatch and threw error #310. Fix in v0.10.130: move the useEffect to BEFORE the early-return, compute callerLabel inside the handler instead of depending on it. Always place hooks at top of component, NEVER after early-returns.

**June 12, 2026 — Pre-v0.10.108 attribution contamination:**
For months before v0.10.108, calls that couldn't be attributed via any signal fell back to `userId=1` (admin). This means abdulla's user record contains thousands of calls that were never actually his — they were Rahul's, Stefan's, etc., but Telnyx didn't send identifiable signals. When designing any "for each user, show their data" UI or backfill, account for this contamination by also checking `userDidId IS NOT NULL` or other consistency markers.

**June 12, 2026 — Telnyx TeXML voicemail uses shared connection_id:**
Migrated TeXML voicemail trial users have `UserDid.connectionId = TELNYX_VOICEMAIL_CC_APP_ID` (a single shared ID across all migrated users). The Edge Case A guard in `resolveUserAndDid` skips Pass 0 lookup for this shared ID, so attribution falls through to Pass 1/2 (sipUsername match). When designing code that depends on `userDidId` being set, account for the fact that Pass 1/2 don't populate it — add a userId fallback path. See `canonicalInboundToNumber` for the pattern.

**June 12, 2026 — Voicemail re-import after delete:**
When a user deletes a voicemail row, the per-call recording-poll safety sweep runs ~60s later, finds no matching DB row for the Telnyx recording, treats it as new, creates the row again with a fresh Teams notification. The v0.11.0 retention design (soft-delete) naturally fixes this because the row stays in the DB just with `deletedAt` set, and the sweep's existence check will find it.

**June 12, 2026 — 60s SIP UA reconnect causes ~1% inbound failure:**
The v0.10.113 fix tears down + rebuilds the JsSIP UA every 60 seconds to combat Telnyx INVITE routing staleness. Confirmed via diagnostic log: ~600ms gap each cycle where SIP is fully torn down. Calls arriving in that window go to TeXML voicemail. May no longer be needed (Telnyx server-side fix?) — testing via v0.10.135 canary with the periodic reconnect feature-flagged OFF.

---

## 6. Quick reference

**Common commands:**

```powershell
cd C:\Users\asheikh\Documents\Claude\Projects\Dialer\acedialerv4

# Diagnose missing inbound calls in Recents
npx tsx --env-file=.env packages/db/scripts/diagnose-missing-call.ts

# Diagnose duplicate voicemails
npx tsx --env-file=.env packages/db/scripts/diagnose-duplicate-voicemail.ts

# Check workspace-sync corruption (strips null bytes)
node scripts/strip-null-bytes.mjs

# TypeScript check (per workspace)
npx tsc --noEmit -p apps/desktop/tsconfig.json
npx tsc --noEmit -p apps/web/tsconfig.json
npx tsc --noEmit -p apps/api/tsconfig.json
npx tsc --noEmit -p apps/webhooks/tsconfig.json

# Pre-flight before commit
node scripts/strip-null-bytes.mjs && npx tsc --noEmit -p apps/web/tsconfig.json && git diff --stat
```

**Env vars (production, in repo-root `.env` on the host):**

- `DATABASE_URL` — self-hosted PostgreSQL, `postgresql://…@127.0.0.1:5432/acedialer`
- `TELNYX_API_KEY` — Telnyx API key
- `TELNYX_VOICEMAIL_CC_APP_ID` — shared TeXML voicemail App ID (treated as "shared" by Pass 0)
- `TEXML_TRIAL_DIDS` — comma-separated list of phone numbers on the TeXML trial
- `DEEPGRAM_API_KEY` — voicemail transcription

**Telnyx connection:**

- Display name: `abdulla-aptask-com` (renamed today from `ace-dialer`)
- The connection_id didn't change with the rename — display only

**ApTask testers on TeXML trial (8 people + abdulla):**

himank, Rahul S, Stefan, mansi, eela, rajat, Ravindra, nilesh
Emails: nileshd@aptask.com, ravindra@aptask.co, stefan@aptask.com, himankj@aptask.com, mansiv@aptask.com, eelak@aptask.com, rahuls@aptask.com, rajatp@aptask.com

---

## 7. Session checkpoint protocol

**At the END of every Claude session, update this file:**

1. Bump the "Last updated" date at the top.
2. Update Current state section if versions shipped.
3. Update Open tasks if any opened/closed.
4. Add a Recent learnings entry if a meaningful discovery was made.
5. Commit this file along with whatever release work was done.

**At the START of every Claude session:**

1. Read this file first.
2. Then read `CLAUDE.md` for the locked rules.
3. Then engage with the user's request.

This pattern keeps context absorbed in 30 seconds even after compaction.
