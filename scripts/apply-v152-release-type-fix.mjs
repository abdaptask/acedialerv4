#!/usr/bin/env node
// v0.10.152 - CRITICAL FIX: change electron-builder releaseType from
// "draft" to "release" so GitHub Releases publishes the build as the
// new "latest", not as a hidden draft.
//
// ROOT CAUSE OF "USERS STUCK ON v0.10.132":
//   apps/desktop/package.json had "releaseType": "draft" in the publish
//   config. electron-builder honored that and created every release
//   since v0.10.133 as a HIDDEN DRAFT on the GitHub Releases page.
//   electron-updater's poll for /releases/latest skips drafts, so users
//   never saw any version after the last one that was manually promoted
//   (which was v0.10.132).
//
// IMPACT:
//   Without this fix, even a successful v0.10.152 build will create
//   another invisible draft and users on v0.10.132 will remain stuck.
//   WITH this fix, the v0.10.152 release goes public immediately on
//   build success and electron-updater on user machines picks it up
//   on next poll (within ~1 hour).
//
// VERIFICATION STEPS AFTER PUSH:
//   1. Watch GitHub Actions - build-desktop.yml Windows job goes green
//   2. Open https://github.com/abdaptask/acedialerv4/releases - the
//      v0.10.152 release should appear at the TOP, NOT under
//      "Drafts" (you may have to log in to see Drafts).
//   3. Hit https://github.com/abdaptask/acedialerv4/releases/latest
//      in a browser - should redirect to /releases/tag/v0.10.152
//   4. OPTIONAL CLEANUP: if you log into GitHub and see a stack of
//      drafts for v0.10.133 through v0.10.151, those can be safely
//      DELETED. They were never published, no user ever saw them,
//      and they're just clutter at this point.
//
// This script is independent of any version bump - it only edits the
// publish config in apps/desktop/package.json. Safe to run anytime.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
console.log(`[apply-release-type-fix] CWD: ${ROOT}`);

function applyEdits(relPath, edits) {
  const fp = join(ROOT, relPath);
  if (!existsSync(fp)) {
    console.error(`[apply-release-type-fix] FATAL: file not found: ${fp}`);
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
      console.error(`[apply-release-type-fix] FATAL in ${relPath}: edit #${i+1} (${edit.label}) - anchor not found`);
      console.error(`  anchor: ${JSON.stringify(find.slice(0, 200))}`);
      process.exit(1);
    }
    if (content.split(find).length - 1 > 1) {
      console.error(`[apply-release-type-fix] FATAL: duplicate match for edit #${i+1} (${edit.label}) in ${relPath}`);
      process.exit(1);
    }
    content = content.replace(find, replace);
    console.log(`  OK ${relPath} edit ${i+1}/${edits.length} (${edit.label})`);
  }
  writeFileSync(fp, content, 'utf8');
  console.log(`  ${relPath}: ${initialLen} -> ${content.length} bytes (${usesCRLF ? 'CRLF' : 'LF'})`);
}

applyEdits('apps/desktop/package.json', [
  {
    label: 'switch releaseType from draft to release',
    find: `    "publish": [
      {
        "provider": "github",
        "owner": "abdaptask",
        "repo": "acedialerv4",
        "releaseType": "draft"
      }
    ],`,
    replace: `    "publish": [
      {
        "provider": "github",
        "owner": "abdaptask",
        "repo": "acedialerv4",
        "releaseType": "release"
      }
    ],`,
  },
]);

console.log('\n[apply-release-type-fix] DONE');
console.log('');
console.log('This is a TINY change but the most consequential one in this whole release.');
console.log('Without it, v0.10.152 will go up as another invisible draft.');
console.log('');
console.log('Commit it alongside the other v0.10.152 changes (bypass restore + wav transcode).');
