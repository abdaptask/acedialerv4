// v0.10.195 — Message reactions persistence helper.
//
// Stores a per-message list of emoji reactions in localStorage. MVP is
// local-only (per device, per user account on this device). The shape:
//
//   { "<messageId>": ["❤️", "👍"], "<messageId>": ["😂"], ... }
//
// keyed under `ace_message_reactions_v1`.
//
// Future v0.10.196+: same API surface but backed by a server-side
// reactions table so reactions sync across devices and are visible to
// other ACE users on the same thread.

const STORAGE_KEY = 'ace_message_reactions_v1';

type ReactionMap = Record<string, string[]>;

function load(): ReactionMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      // Best-effort validation: keep only string[] values.
      const out: ReactionMap = {};
      for (const [k, v] of Object.entries(parsed)) {
        if (Array.isArray(v) && v.every((x) => typeof x === 'string')) {
          out[k] = v;
        }
      }
      return out;
    }
    return {};
  } catch {
    return {};
  }
}

function save(map: ReactionMap): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // localStorage may be unavailable in private windows / Electron edge
    // cases; reactions silently revert to in-memory-only for this session.
  }
}

/** Returns the user's current reactions for a given message id. */
export function getMessageReactions(messageId: number | string): string[] {
  const map = load();
  return map[String(messageId)] ?? [];
}

/** Adds an emoji reaction. No-op if the user has already reacted with
 *  this emoji (one of each per user, like iMessage). */
export function addMessageReaction(messageId: number | string, emoji: string): void {
  const map = load();
  const id = String(messageId);
  const existing = map[id] ?? [];
  if (existing.includes(emoji)) return;
  map[id] = [...existing, emoji];
  save(map);
}

/** Removes a specific emoji reaction. */
export function removeMessageReaction(messageId: number | string, emoji: string): void {
  const map = load();
  const id = String(messageId);
  const existing = map[id];
  if (!existing) return;
  const next = existing.filter((e) => e !== emoji);
  if (next.length === 0) {
    delete map[id];
  } else {
    map[id] = next;
  }
  save(map);
}

/** Convenience: returns true if the user has the given reaction on a
 *  message. Currently unused but exported for future call sites. */
export function hasMessageReaction(messageId: number | string, emoji: string): boolean {
  return getMessageReactions(messageId).includes(emoji);
}

/** v0.10.195 — Fixed set of "quick" reactions surfaced by the
 *  hover-reveal popover. Matches the iMessage Tapback set. The full
 *  emoji picker integration is deferred to v0.10.196+. */
export const QUICK_REACTIONS: readonly string[] = ['❤️', '👍', '👎', '😂', '‼️', '❓'];
