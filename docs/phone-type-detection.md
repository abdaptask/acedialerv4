# Phone-number type detection

The Dialpad and the in-call screen show what kind of line a number is:

    (732) 555-1234 · Mobile        ← carrier-verified (check-badge icon)
    (800) 555-1234 · Toll-free     ← inferred from the number format (plain text)

Hover (or a screen reader) always says which: *"Verified by carrier lookup ·
T-Mobile · ported"* vs *"Inferred from the number format — not
carrier-verified"*. See CLAUDE.md §32 for the architecture contract.

## What the free method can and cannot tell you

Free inference uses `libphonenumber-js` (already in the bundle), entirely
offline. It is reliable for what the numbering plan itself encodes:

| Detectable for free | How |
|---|---|
| Invalid number (555, 0xx/1xx area codes, too long) | plan validation |
| Toll-free (800/833/844/855/866/877/888) | NANP plan |
| Premium-rate (900) | NANP plan |
| Mobile vs landline **outside** North America (UK, India, most of Europe) | that country's plan |

**It cannot tell Mobile, Landline or VoIP apart for any US or Canadian
geographic number.** NANP assigns area codes and exchanges without
distinguishing line types, so libphonenumber returns `FIXED_LINE_OR_MOBILE`
for every one of them, and the badge shows **Unknown**. This is not
a library gap that a better library would fix:

- **Porting.** A number keeps its digits when it moves between carriers. A
  landline number ported to a mobile carrier or to a VoIP provider
  (Google Voice, RingCentral, Teams, Telnyx itself) looks identical. Only a
  live LRN/portability dip knows where it lives *now*.
- **Prefix tables go stale.** Even the old "this exchange belongs to a
  wireless carrier" tables are wrong for any ported number, and the share of
  ported numbers is large and growing.
- **International inference is still a plan-level guess.** A UK `07…` number
  is in the mobile range, but it may have been ported to a VoIP service.
  It's labelled "inferred", never "verified".

## Verified lookups (optional, paid)

Set on the API host and `pm2 reload ace-api`:

    PHONE_LOOKUP_PROVIDER=telnyx      # default: none (free inference only)
    PHONE_LOOKUP_DAILY_LIMIT=2000     # paid lookups per process per UTC day
    PHONE_LOOKUP_TTL_DAYS=30          # how long an answer is trusted

It reuses `TELNYX_API_KEY`. The provider calls `GET /v2/number_lookup/{e164}`
with no `type` parameter, which returns the portability (LRN) block, so
`line_type` reflects porting. Published price (Oct 2026): **LRN $0.0015 per
query**. `type=carrier` (MCC/MNC, $0.0025) and CNAM ($0.003) are not used.

Cost controls:
- Only valid geographic US/CA numbers are looked up. Toll-free, premium,
  invalid, incomplete and international numbers never reach Telnyx.
- One shared answer per number per TTL, across all users (`phone_type_lookups`).
- 350 ms debounce, plus in-flight dedupe on both client and server.
- Daily cap per process. Once it's hit, numbers show "Unknown" until UTC midnight.

### Expected spend (measured Oct 9, 2026 over the previous 30 days)

| Measure | Value |
|---|---|
| Distinct numbers called or received, per weekday | avg 959, max 1,219 |
| Distinct numbers over 30 days | 16,445 |
| Numbers new in the last 30 days (unseen in the prior 90) | 12,345 |

With the 30-day shared cache at $0.0015: **~$25/month, about $1.10–1.45 per
weekday.** Day one costs about $1.45, and the daily figure falls as the cache
fills. Without a cache (one lookup per call) it would be about $2.40 per
weekday. If Telnyx bills the bare lookup at the $0.0025 tier, the cached
figure becomes about $41/month. The daily cap bounds the worst case at $3 per
process per day.

## Deploying

Additive schema only. Apply before the API runs with the provider enabled.
With the provider off the table is never read, and with it on, a missing
table degrades to uncached lookups instead of errors:

```sql
CREATE TABLE IF NOT EXISTS "phone_type_lookups" (
  "e164"         TEXT PRIMARY KEY,
  "line_type"    TEXT NOT NULL,
  "carrier_name" TEXT,
  "ported"       BOOLEAN,
  "provider"     TEXT NOT NULL,
  "checked_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

Desktop users get the badge only with a new desktop release, because the
installer bundles `apps/web/dist`.
