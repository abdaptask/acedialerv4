# Remove Supabase: move all media to the `apt-dialer` S3 bucket

**Date:** 2026-09-03
**Status:** Approved, not yet implemented
**Affects:** `apps/api`, `apps/webhooks`, `scripts/`, CLAUDE.md §3.4 / §18.2 / §19.2

---

## 1. Problem

Supabase Storage is the last active Supabase dependency in the monorepo (CLAUDE.md §3.4). It
holds three kinds of media:

| Media | Upload site | DB column |
|---|---|---|
| Outbound MMS attachments | `apps/api/src/messages/messages.routes.ts:251` | `Message.mediaUrls[]`, `ScheduledMessage.mediaUrls[]` |
| Voicemail greetings (no-answer + busy) | `apps/api/src/voicemailGreeting/voicemailGreeting.routes.ts:306` | `User.voicemailGreetingUrl`, `User.voicemailBusyGreetingUrl` |
| Voicemail recordings (Call Control path only) | `apps/webhooks/src/voicemailCallControl.ts:242` | `Voicemail.recordingUrl` |

Two further facts drive this work:

1. **Voicemail recordings are mostly not ours at all.** Only the Call Control path copies the
   recording into storage. The Hosted Voicemail path (`apps/webhooks/src/main.ts:911`) and the
   TeXML path store Telnyx's own presigned S3 URL and never copy the bytes. Those URLs expire
   (observed: `X-Amz-Expires=604800`, 7 days, on Telnyx's `voice-mail-prod` bucket).
2. **Nothing in the repo ever deletes a stored object.** `purgeExpired()`
   (`apps/api/src/voicemails/voicemails.routes.ts:172`) deletes DB rows only. Every object ever
   uploaded to Supabase is still there, orphaned.

Note that expiring Telnyx URLs are *not* currently a user-visible playback bug: `GET
/voicemails/:id/fresh-url` (v0.10.163) re-queries the Telnyx Recordings API on row expand, and
`GET /voicemails/:id` proxies audio server-side with a retry-on-403. This migration is about
owning the data, not repairing playback.

## 2. Goals

- Every object we own lives in the ApTask-owned `apt-dialer` bucket (`us-east-1`, account
  `216898427665`).
- Existing objects are migrated, not stranded — Supabase can be deleted at the end.
- Voicemail recordings are persisted for **all** voicemail paths, not just Call Control.
- Stored objects expire in step with the 30-day retention the UI already promises.

## 3. Non-goals

- **Inbound MMS media stays on Telnyx.** `main.ts:1086-1087` stores `payload.media[].url` raw.
  Copying those is a separate ticket: it needs a download-on-webhook path that cannot block the
  Telnyx ack, plus a backfill over historic rows whose URLs may already be dead.
- **No move to private objects or presigned URLs.** Public-read is retained (see §4.2).
- No change to the web client. It has no Supabase code — only stale comments in `api.ts:729`,
  `api.ts:1162` (`'[mms upload] supabase error:'`), `Settings.tsx:1382,1791`, and `whatsNew.ts:698`.
  It renders whatever URL the API hands it.

## 4. Decisions

### 4.1 Approach: mirror the existing shape

Swap the three `fetch()`-based uploads for S3 `PutObject`. Keep storing a **full public URL** in
the DB, exactly as today, so every read path is untouched: the voicemail `<audio src>`
(`Voicemail.tsx:857-860`), MMS `<img>`, the scheduled-message worker
(`scheduledMessageWorker.ts:231`), and the webhook handing `voicemailGreetingUrl` to Telnyx
`playback_start`.

*Rejected — store the object key and build the URL at read time.* Real benefits (flip to private
later without a second migration; bucket/region moves become config). Rejected because it needs a
resolver in every consumer including `apps/webhooks`, plus a schema decision and a mixed-format
migration period — roughly triple the surface area to hedge a decision already made.

*Rejected — hand-rolled SigV4 to avoid a dependency.* ~100 lines of request-signing crypto per
service. Not worth the footgun.

### 4.2 Access model: public-read, carried over

Objects are public-read via bucket policy, matching today's Supabase posture. This is a conscious
carry-over, and it has a cost worth recording: **permanent unauthenticated links to voicemail
audio and candidate MMS attachments.** Anyone who obtains a URL keeps access indefinitely.

It is retained because two consumers are Telnyx's servers, not our browser session — `media_urls`
on MMS send, and the greeting URL via `playback_start` — and because `ScheduledMessage.mediaUrls`
can sit for days before send, which any short-lived-URL scheme would break.

### 4.3 Duplicated helper, not a shared module

CLAUDE.md §1.4 forbids code in `packages/` outside `db`, and forbids `apps/webhooks` importing
from `apps/api`. The Supabase logic being replaced is *already* duplicated across the same three
sites, so a duplicated `s3.ts` is consistent with the codebase rather than new debt.

## 5. Key layout

```
media/voicemails/u{userId}/{voicemailId}.{ext}
media/greetings/u{userId}/{noanswer|busy}/{ts}_{safeName}
media/mms/out/u{userId}/{ts}_{safeName}
```

Everything under `media/` so it cannot collide with the bucket's existing `updates` prefix (the
bucket policy's current statement is named `PublicReadSpecificUpdates`). This also fixes a current
wart: MMS objects sit at Supabase bucket root as `u{userId}/...`.

`{ext}` for voicemail recordings is derived from the source URL, not hardcoded — see §7.

## 6. Storage helper

Two files, same contents: `apps/api/src/lib/s3.ts` and `apps/webhooks/src/s3.ts`.

```ts
putObject({ key, body, contentType }): Promise<{ publicUrl: string }>
```

- Backed by `@aws-sdk/client-s3`, added as a dependency to both services.
- Public URL is `${S3_PUBLIC_BASE}/${key}`, where `S3_PUBLIC_BASE` defaults to
  `https://{S3_BUCKET}.s3.{S3_REGION}.amazonaws.com`. The indirection exists so a CloudFront or
  custom domain later is a config change, not a code change. The resolved URL is still written
  into DB rows — the accepted tradeoff of §4.1.
- Throws on a failed put; callers own the error mapping.

**Env vars:** `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`,
`S3_PUBLIC_BASE` (optional).

`apps/api` reads them via a new block in `config.ts`, replacing the `supabase*` entries at lines
64-67. `apps/webhooks` reads `process.env` directly, matching how it already handles Supabase in
`voicemailCallControl.ts:220-222`.

**Unconfigured behaviour must match today's:** the MMS route returns 500, the webhook logs and
skips. A missing var never hard-crashes a service.

## 7. Upload site changes

| Site | Change |
|---|---|
| `messages.routes.ts:251` | MMS upload → `putObject`. Retain the error-hint mapping at `:264-283`, remapped to S3 causes: 403 → IAM policy missing `PutObject` on `media/*`; 404 → bucket or region wrong; `NoSuchBucket` → check `S3_BUCKET`. |
| `voicemailGreeting.routes.ts:306` | Greeting → `putObject`. Preserve `effectiveMime` so the ffmpeg webm→WAV path (v0.10.152) keeps its correct content-type. |
| `voicemailCallControl.ts:242` | Recording → `putObject`, **and fix the hardcoded `.mp3` / `audio/mpeg` at `:241,247`.** Derive extension and content-type from the source URL — Hosted Voicemail serves `.wav`, so the current constants would mislabel every object once §8 lands. |

Rename `persistRecordingToSupabase` → `persistRecording`.

## 8. Persist recordings on all voicemail paths

`persistRecording` is currently called only from `voicemailCallControl.ts:465`, so only Call
Control voicemails are ever copied into our storage.

There are **two** `prisma.voicemail.create` seams in `apps/webhooks/src/main.ts`, and both need
the call:

| Seam | Serves |
|---|---|
| `main.ts:990`, inside `case 'calls.voicemail.completed'` | Telnyx Hosted Voicemail |
| `main.ts:1903`, inside `processVoicemail()` | `POST /texml/voicemail/recording-complete` (:1784), the legacy `/webhooks/telnyx/voicemail` route (:2031), and the injected callbacks at :1662 and :2126 |

The comment at `main.ts:1927` refers to "when we refactored the Hosted VM handler into
processVoicemail()", but the Hosted VM handler still has its own inline create at `:990`. Do not
assume one call site covers both. Unifying the two seams is out of scope here — add the call
twice.

Constraints, inherited from the existing function and non-negotiable per CLAUDE.md §16.4:

- Fire-and-forget. The Telnyx 200 has already been sent; this must never block or throw into the
  handler.
- Failure leaves `recordingUrl` pointing at Telnyx. Playback still works via the existing
  fresh-url and proxy paths, so a failed copy degrades rather than breaks.

Both seams already hold the created row, so `voicemailId` and `userId` are in scope for the key.

## 9. Bucket and IAM configuration

**Bucket policy** — add a statement alongside the existing `PublicReadSpecificUpdates`, do not
replace it:

- `s3:GetObject` on `arn:aws:s3:::apt-dialer/media/*`, principal `*`.
- Nothing broader. No `s3:ListBucket` to the public.

**Lifecycle rule** — expire objects under prefix `media/voicemails/` after 30 days, matching
`VOICEMAIL_RETENTION_DAYS` (`voicemails.routes.ts:166`). No other prefix expires: greetings and
MMS attachments are long-lived. This rule is what stops S3 inheriting the orphan leak described in
§1.

**Block Public Access** — "Block *all* public access" stays off (the policy needs to grant public
read), but enable both ACL-related sub-settings. Public access comes from the bucket policy only,
never from object ACLs.

**Default encryption** — SSE-S3. Confirm it is on.

**IAM** — a dedicated user with `s3:PutObject`, `s3:GetObject`, `s3:DeleteObject` on
`arn:aws:s3:::apt-dialer/media/*` and nothing else. No `s3:*`, no other bucket, no
`s3:ListAllMyBuckets`.

**Credential hygiene** — the access key pasted during design (`AKIAIZEP7…`) is exposed in a chat
transcript and session logs. It must be deactivated in IAM and never used. The replacement key
goes only into the host's repo-root `.env`, which `.gitignore` covers at line 9. No credential
value appears in this spec, in the repo, or in any log line.

## 10. Backfill: `scripts/migrate-supabase-to-s3.mjs`

Follows the existing one-off operator-script pattern in `scripts/` (§1.4: operator tools, never
imported by `apps/`). Idempotent; `--dry-run` is the default and `--commit` is required to write.

For each object: download from the Supabase public URL, `PutObject` to the new key, then update
the DB column. Columns, all five:

- `Voicemail.recordingUrl` — single string
- `User.voicemailGreetingUrl`, `User.voicemailBusyGreetingUrl` — single strings
- `Message.mediaUrls[]` — array
- `ScheduledMessage.mediaUrls[]` — array

**The array columns are the primary risk.** `Message.mediaUrls` mixes outbound Supabase URLs with
inbound Telnyx URLs (`main.ts:1086`). The mapper rewrites **only** entries whose prefix matches the
Supabase storage base and passes every other entry through untouched. A blind replace here
corrupts inbound message history.

Idempotency comes from the same prefix test: an already-migrated row has no Supabase-prefixed
entries left and is skipped.

The script writes an old→new manifest to `scripts/out/supabase-to-s3-manifest.json` for rollback,
and logs per-column counts (scanned / rewritten / skipped / failed). A download or upload failure
leaves that row's URL unchanged and is recorded in the manifest as failed — a partial run is safe
to re-run.

## 11. Cutover sequence

1. Deactivate the exposed access key. Create the scoped IAM user. Apply the bucket policy
   statement, the lifecycle rule, and the Block-Public-Access settings from §9.
2. Deploy the code with the S3 env vars set. New uploads go to S3 from this moment; existing rows
   still point at Supabase and still work.
3. Run the backfill dry-run. Review the counts. Run with `--commit`.
4. Run the §12 verification pass.
5. Leave the Supabase bucket alive and read-only for ~2 weeks.
6. Delete the `SUPABASE_*` env vars, strip the remaining Supabase code and the stale web comments
   listed in §3, and update CLAUDE.md §3.4, §18.2, §19.2.

Steps 2 and 3 are separately revertible; step 6 is the point of no return.

## 12. Verification

Run after step 3, before step 5:

- `curl -D- -o /dev/null <migrated voicemail URL>` → `200` with the correct audio content-type.
- Play a migrated voicemail in the UI; play a collapsed row (exercises the duration probe at
  `Voicemail.tsx:660`).
- Confirm Telnyx `playback_start` plays a **migrated** greeting on a real inbound voicemail call.
- Send an MMS with a new attachment and confirm **delivery status**, not merely our own 200 —
  Telnyx must be able to fetch the URL.
- Leave a real voicemail on a Hosted-Voicemail DID and confirm an object appears under
  `media/voicemails/` (this is the §8 path).
- View an old MMS thread containing inbound media; confirm the Telnyx-hosted entries were not
  rewritten.
- Final assertion: zero `supabase.co` strings across all five columns in §10.

## 13. Tests

- Unit-test the key builder for all three media types, including filename sanitisation and the
  `{noanswer|busy}` split.
- Unit-test the public-URL builder with and without `S3_PUBLIC_BASE`.
- **TDD the backfill URL mapper.** Given an array mixing Supabase and Telnyx URLs, only the
  Supabase entries are rewritten and order is preserved. Cover: empty array, all-Telnyx,
  all-Supabase, mixed, already-migrated. This mapper is the one component that can silently
  corrupt message history.
- Unit-test extension/content-type derivation from a source URL: `.wav`, `.mp3`, and a URL with a
  query string (Telnyx presigned URLs carry `?X-Amz-...`).

## 14. Rollback

- **Before step 3:** revert the deploy. New uploads return to Supabase; nothing was migrated.
- **After step 3:** replay `supabase-to-s3-manifest.json` in reverse to restore the old URLs. The
  Supabase objects still exist — this is why step 5 waits two weeks before deletion.
- **After step 6:** no rollback. Verify fully before taking it.

## 15. Risks

| Risk | Mitigation |
|---|---|
| Blind array rewrite corrupts inbound MMS history | Prefix-matched mapper, TDD'd (§13); verification item in §12 |
| Bucket policy misses `media/*`, every URL 403s | Policy applied in step 1, before any migration; §12 `curl` catches it |
| Voicemail objects accumulate forever | Lifecycle rule on `media/voicemails/` (§9) |
| Objects mislabelled `audio/mpeg` when they are WAV | Extension and content-type derived from source URL (§7), unit-tested (§13) |
| §8 copy failure loses a recording | Fails open — `recordingUrl` stays on Telnyx, playback still works via fresh-url and the proxy |
| Exposed AWS key used in production | Deactivated in step 1 before any wiring (§9) |
| Public-read links to voicemail audio and candidate PII | Accepted and recorded (§4.2). Revisit by adopting the rejected key-in-DB approach if the posture changes |
