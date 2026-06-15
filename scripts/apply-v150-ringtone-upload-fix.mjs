#!/usr/bin/env node
// v0.10.150 - Ringtone picker fix: admin-uploaded ringtones never played.
//
// CONFIRMED BUG: getCurrentRingtoneSlug() in apps/web/src/services/ringtone.ts
// rejects any slug not in PRESETS, so when sessionStorage holds 'upload:42'
// (a valid admin-uploaded ringtone reference), the function returns the
// default 'classic' preset. start() then never reaches its 'upload:'
// branch and the user hears the default sound, not their picked sound.
//
// FIX: widen the validation to also accept 'upload:*' slugs. Tighten the
// return type so callers know the function can return an upload reference.
// Add a console.info log on first slug resolution so DevTools shows what
// slug ringtone.start() actually saw - useful for diagnosing any
// remaining issue across the 4 built-in presets.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
console.log(`[apply-v150] CWD: ${ROOT}`);

function applyEdits(relPath, edits) {
  const fp = join(ROOT, relPath);
  if (!existsSync(fp)) { console.error(`[apply-v150] FATAL: file not found: ${fp}`); process.exit(1); }
  let content = readFileSync(fp, 'utf8');
  const initialLen = content.length;
  const usesCRLF = content.includes('\r\n');
  const normalize = (s) => usesCRLF ? s.replace(/\r?\n/g, '\r\n') : s.replace(/\r\n/g, '\n');
  for (const [i, edit] of edits.entries()) {
    const find = normalize(edit.find);
    const replace = normalize(edit.replace);
    if (!content.includes(find)) {
      console.error(`[apply-v150] FATAL in ${relPath}: edit #${i+1} (${edit.label}) - anchor not found`);
      console.error(`  anchor: ${JSON.stringify(find.slice(0, 200))}`);
      process.exit(1);
    }
    if (content.split(find).length - 1 > 1) {
      console.error(`[apply-v150] FATAL: duplicate match for edit #${i+1} (${edit.label})`);
      process.exit(1);
    }
    content = content.replace(find, replace);
    console.log(`  ✓ ${relPath} edit ${i+1}/${edits.length} (${edit.label})`);
  }
  writeFileSync(fp, content, 'utf8');
  console.log(`  ${relPath}: ${initialLen} → ${content.length} bytes (${usesCRLF ? 'CRLF' : 'LF'})`);
}

applyEdits('apps/web/src/services/ringtone.ts', [
  {
    label: 'widen RingtoneSlug type to include upload references',
    find: `export type RingtoneSlug = 'classic' | 'modern' | 'chime' | 'pulse';`,
    replace: `// v0.10.150 - widened to also accept admin-uploaded ringtone refs
// (literal 'upload:<id>' strings). Previous narrow type made the
// upload-path branch in start() unreachable because getCurrentRingtoneSlug
// would treat unknown slugs as invalid and fall back to 'classic'.
export type RingtoneSlug =
  | 'classic'
  | 'modern'
  | 'chime'
  | 'pulse'
  | \`upload:\${string}\`;`,
  },
  {
    label: 'fix getCurrentRingtoneSlug to accept upload: refs',
    find: `export function getCurrentRingtoneSlug(): RingtoneSlug {
  try {
    const v = sessionStorage.getItem('ace_ringtone') as RingtoneSlug | null;
    if (v && PRESETS[v]) return v;
  } catch { /* noop */ }
  return DEFAULT_RINGTONE;
}`,
    replace: `export function getCurrentRingtoneSlug(): RingtoneSlug {
  try {
    const v = sessionStorage.getItem('ace_ringtone');
    if (!v) return DEFAULT_RINGTONE;
    // v0.10.150 - accept either a synthesized preset slug OR an
    // 'upload:<id>' admin-uploaded ringtone reference. Previously this
    // function only validated PRESETS membership, which silently
    // dropped uploaded ringtones back to the default.
    if (v.startsWith('upload:') && v.length > 'upload:'.length) {
      return v as RingtoneSlug;
    }
    if ((PRESETS as Record<string, unknown>)[v]) {
      return v as RingtoneSlug;
    }
    console.warn('[ringtone] unknown slug in sessionStorage, using default:', v);
  } catch { /* noop */ }
  return DEFAULT_RINGTONE;
}`,
  },
  {
    label: 'add diagnostic log in start() so DevTools shows which slug actually played',
    find: `    const effectiveSlug = slug ?? getCurrentRingtoneSlug();`,
    replace: `    const effectiveSlug = slug ?? getCurrentRingtoneSlug();
    // v0.10.150 - log the resolved slug so users reporting "ringtone
    // didn't change" can be diagnosed quickly via the diagnostics log.
    console.info('[ringtone] start() resolved slug =', effectiveSlug, '(from', slug ? 'argument' : 'sessionStorage', ')');`,
  },
]);

// Version bumps to 0.10.150
const PKGS = ['package.json', 'apps/api/package.json', 'apps/web/package.json', 'apps/desktop/package.json', 'apps/socket/package.json', 'apps/webhooks/package.json', 'packages/db/package.json'];
for (const rp of PKGS) {
  const fp = join(ROOT, rp);
  let c = readFileSync(fp, 'utf8');
  const before = c;
  c = c.replace(/"version":\s*"0\.10\.149"/, '"version": "0.10.150"');
  if (c !== before) { writeFileSync(fp, c, 'utf8'); console.log(`  ✓ ${rp}: bumped`); }
}

applyEdits('apps/web/src/components/DiagnosticsSection.tsx', [
  { label: 'bump APP_VERSION', find: `const APP_VERSION = '0.10.149';`, replace: `const APP_VERSION = '0.10.150';` },
]);

applyEdits('apps/web/src/data/whatsNew.ts', [
  {
    label: 'add v0.10.150 entry',
    find: `export const WHATS_NEW: ReleaseEntry[] = [\n  {\n    version: '0.10.149',`,
    replace: `export const WHATS_NEW: ReleaseEntry[] = [\n  {\n    version: '0.10.150',\n    date: 'June 13, 2026',\n    highlight: 'Fixed: admin-uploaded ringtones now play correctly when selected',\n    changes: [\n      { type: 'fixed', text: 'When you picked an admin-uploaded ringtone in Settings, the dialer would save the selection but still play the default Classic ringtone on incoming calls. The validation function silently rejected any slug that wasnt one of the four built-in presets, dropping uploaded ringtone references and falling back to the default. The fix accepts both built-in presets and upload references. The four built-in presets (Classic, Modern, Chime, Pulse) were already working; this only affects admin-uploaded sounds.' },\n      { type: 'improved', text: 'Diagnostic: ringtone start() now logs the resolved slug at info level. If you ever report "the ringtone didnt change," your Settings > Diagnostics export will show exactly which slug played, making the diagnosis instant.' },\n    ],\n  },\n  {\n    version: '0.10.149',`,
  },
]);

console.log('\n[apply-v150] DONE');
