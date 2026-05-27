-- ============================================================================
-- v0.10.0 — Multi-DID per user (Pillar 1 of feature/multi-num-teams-routing)
--
-- Adds user_dids table + users.active_user_did_id pointer. Backfills one
-- user_dids row per existing user that has a did_number, marked isDefault.
-- Sets users.active_user_did_id to that row so today's outbound SMS keeps
-- working unchanged (the API will look up via the active pointer, which
-- resolves to the same number that User.did_number currently holds).
--
-- This migration is additive — nothing is dropped. User.did_number +
-- User.telnyx_number_id remain in place (deprecated, removed in v1.0).
--
-- Idempotent: re-running the migration is safe. The backfill INSERT uses
-- ON CONFLICT DO NOTHING on did_number, and the pointer UPDATE is a no-op
-- if active_user_did_id is already set.
-- ============================================================================

-- ── 1. user_dids table ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS user_dids (
  id                BIGSERIAL PRIMARY KEY,
  user_id           INTEGER REFERENCES users(id) ON DELETE CASCADE,
  did_number        TEXT NOT NULL UNIQUE,
  telnyx_number_id  TEXT,
  connection_id     TEXT,
  label             TEXT NOT NULL DEFAULT 'Line',
  color_hex         TEXT NOT NULL DEFAULT '#3b82f6',
  is_default        BOOLEAN NOT NULL DEFAULT FALSE,
  ring_group_id     INTEGER,        -- FK added in Pillar 3 migration
  ivr_menu_id       INTEGER,        -- FK added in Pillar 4 migration
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS user_dids_user_id_idx       ON user_dids(user_id);
CREATE INDEX IF NOT EXISTS user_dids_ring_group_id_idx ON user_dids(ring_group_id);
CREATE INDEX IF NOT EXISTS user_dids_ivr_menu_id_idx   ON user_dids(ivr_menu_id);

-- ── 2. users.active_user_did_id pointer ─────────────────────────────────────

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS active_user_did_id BIGINT
    REFERENCES user_dids(id) ON DELETE SET NULL;

-- ── 3. Backfill: one user_dids row per existing user.did_number ─────────────
--
-- Existing model: users.did_number is unique per user. We mint a UserDid for
-- each, copying telnyx_number_id verbatim. Label defaults to 'Main', color
-- to ACE blue. isDefault=true since this is the user's only DID at backfill
-- time. created_at mirrors users.created_at so audit/history makes sense.

INSERT INTO user_dids (user_id, did_number, telnyx_number_id, label, color_hex, is_default, created_at, updated_at)
SELECT
  u.id,
  u.did_number,
  u.telnyx_number_id,
  'Main',
  '#3b82f6',
  TRUE,
  u.created_at,
  u.created_at
FROM users u
WHERE u.did_number IS NOT NULL
  AND u.is_active = TRUE
ON CONFLICT (did_number) DO NOTHING;

-- ── 4. Point users.active_user_did_id at the backfilled row ─────────────────

UPDATE users u
SET active_user_did_id = ud.id
FROM user_dids ud
WHERE ud.user_id = u.id
  AND ud.is_default = TRUE
  AND u.active_user_did_id IS NULL;

-- ── 5. Sanity check (logged via the migration runner — does nothing on prod
--      besides emit a NOTICE if counts are odd) ─────────────────────────────

DO $$
DECLARE
  user_count             INTEGER;
  user_with_did_count    INTEGER;
  user_did_count         INTEGER;
  active_pointer_count   INTEGER;
BEGIN
  SELECT COUNT(*) INTO user_count             FROM users WHERE is_active = TRUE;
  SELECT COUNT(*) INTO user_with_did_count    FROM users WHERE is_active = TRUE AND did_number IS NOT NULL;
  SELECT COUNT(*) INTO user_did_count         FROM user_dids;
  SELECT COUNT(*) INTO active_pointer_count   FROM users WHERE active_user_did_id IS NOT NULL;

  RAISE NOTICE '[migration] active users: %, with DID: %, user_dids rows: %, active pointers set: %',
    user_count, user_with_did_count, user_did_count, active_pointer_count;

  IF user_with_did_count <> user_did_count THEN
    RAISE NOTICE '[migration] WARNING: user_with_did_count (%) != user_did_count (%). Some users with did_number did not get a user_dids row.',
      user_with_did_count, user_did_count;
  END IF;
  IF user_with_did_count <> active_pointer_count THEN
    RAISE NOTICE '[migration] WARNING: user_with_did_count (%) != active_pointer_count (%). Some users have a DID but no active pointer.',
      user_with_did_count, active_pointer_count;
  END IF;
END $$;
