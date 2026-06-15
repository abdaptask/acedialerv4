#!/usr/bin/env node
// v0.10.150 HOTFIX - Unblock Render API deploy.
//
// Render build is failing with:
//   TS7016: Could not find a declaration file for module 'fluent-ffmpeg'
//   TS7006: Parameter 'err' implicitly has an 'any' type.
//
// Root cause: @types/fluent-ffmpeg lives in devDependencies, but Render's
// production install path is skipping it (either NODE_ENV=production at
// install time or stale package-lock.json after v0.10.149's dep additions).
//
// Three-pronged fix (belt-and-suspenders so this can't break again):
//   1. Move @types/fluent-ffmpeg from devDependencies -> dependencies
//      in apps/api/package.json so production install always includes it.
//   2. Add ambient module declaration at apps/api/src/types/fluent-ffmpeg.d.ts
//      declaring just the methods we actually use. tsc resolves this
//      whether or not @types/fluent-ffmpeg made it into node_modules.
//   3. Type the err parameter in voicemailGreeting.routes.ts so TS7006
//      can't fire even if the ambient module isn't picked up.
//
// Version unchanged - stays at 0.10.150. This is a build-time hotfix;
// runtime behavior identical to current .150 source.
//
// After running:
//   1. cd <repo>
//   2. Remove-Item package-lock.json -Force
//      then `npm install` to regenerate the lockfile with the new dep
//      position
//   3. git add -A && git commit -m "v0.10.150 hotfix: fix @types/fluent-ffmpeg resolution on Render"
//   4. git push origin main
//   5. Render auto-redeploys via render-deploy.yml hook

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

const ROOT = process.cwd();
console.log(`[apply-v150-hotfix] CWD: ${ROOT}`);

function applyEdits(relPath, edits) {
  const fp = join(ROOT, relPath);
  if (!existsSync(fp)) {
    console.error(`[apply-v150-hotfix] FATAL: file not found: ${fp}`);
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
      console.error(`[apply-v150-hotfix] FATAL in ${relPath}: edit #${i+1} (${edit.label}) - anchor not found`);
      console.error(`  anchor: ${JSON.stringify(find.slice(0, 200))}`);
      process.exit(1);
    }
    if (content.split(find).length - 1 > 1) {
      console.error(`[apply-v150-hotfix] FATAL: duplicate match for edit #${i+1} (${edit.label}) in ${relPath}`);
      process.exit(1);
    }
    content = content.replace(find, replace);
    console.log(`  OK ${relPath} edit ${i+1}/${edits.length} (${edit.label})`);
  }
  writeFileSync(fp, content, 'utf8');
  console.log(`  ${relPath}: ${initialLen} -> ${content.length} bytes (${usesCRLF ? 'CRLF' : 'LF'})`);
}

function writeNew(relPath, body) {
  const fp = join(ROOT, relPath);
  const dir = dirname(fp);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
    console.log(`  + created dir ${dir}`);
  }
  writeFileSync(fp, body, 'utf8');
  console.log(`  + wrote ${relPath} (${body.length} bytes)`);
}

// ---------------------------------------------------------------------
// 1. apps/api/package.json - move @types/fluent-ffmpeg to dependencies
// ---------------------------------------------------------------------
applyEdits('apps/api/package.json', [
  {
    label: 'add @types/fluent-ffmpeg to dependencies',
    find: `    "fluent-ffmpeg": "^2.1.3",
    "ioredis": "^5.11.1",`,
    replace: `    "fluent-ffmpeg": "^2.1.3",
    "@types/fluent-ffmpeg": "^2.1.27",
    "ioredis": "^5.11.1",`,
  },
  {
    label: 'remove @types/fluent-ffmpeg from devDependencies',
    find: `  "devDependencies": {
    "@types/bcryptjs": "^2.4.6",
    "@types/fluent-ffmpeg": "^2.1.27",
    "@types/node": "^20.11.0"
  }`,
    replace: `  "devDependencies": {
    "@types/bcryptjs": "^2.4.6",
    "@types/node": "^20.11.0"
  }`,
  },
]);

// ---------------------------------------------------------------------
// 2. apps/api/src/types/fluent-ffmpeg.d.ts - ambient module fallback
// ---------------------------------------------------------------------
writeNew('apps/api/src/types/fluent-ffmpeg.d.ts', `// v0.10.150 hotfix - Ambient module declaration for fluent-ffmpeg.
//
// We DO have @types/fluent-ffmpeg in dependencies (post-hotfix), but Render
// has been intermittently flaky about installing devDependencies during
// the build phase. This .d.ts is a belt-and-suspenders fallback: if the
// @types package somehow doesn't make it into node_modules, tsc still has
// enough to resolve the import and check the call sites in
// voicemailGreeting.routes.ts.
//
// Only declares the methods we actually use. If we expand fluent-ffmpeg
// usage in the future and add new calls, this file may need extending
// (or you can rely entirely on the real @types package).

declare module 'fluent-ffmpeg' {
  interface FfmpegCommand {
    audioCodec(codec: string): FfmpegCommand;
    audioBitrate(bitrate: string | number): FfmpegCommand;
    audioChannels(channels: number): FfmpegCommand;
    toFormat(format: string): FfmpegCommand;
    on(event: 'end', listener: () => void): FfmpegCommand;
    on(event: 'error', listener: (err: Error) => void): FfmpegCommand;
    on(event: string, listener: (...args: unknown[]) => void): FfmpegCommand;
    save(output: string): FfmpegCommand;
  }
  function ffmpeg(input?: string): FfmpegCommand;
  namespace ffmpeg {
    function setFfmpegPath(path: string): void;
  }
  export = ffmpeg;
}
`);

// ---------------------------------------------------------------------
// 3. voicemailGreeting.routes.ts - type the err callback parameter
// ---------------------------------------------------------------------
applyEdits('apps/api/src/voicemailGreeting/voicemailGreeting.routes.ts', [
  {
    label: 'type err parameter in .on(error, ...) callback',
    find: `        .on('end', () => resolve())
        .on('error', (err) => reject(err))
        .save(tmpOut);`,
    replace: `        .on('end', () => resolve())
        .on('error', (err: Error) => reject(err))
        .save(tmpOut);`,
  },
]);

console.log('\n[apply-v150-hotfix] DONE');
console.log('');
console.log('NEXT STEPS (run in repo root):');
console.log('  Remove-Item package-lock.json -Force');
console.log('  npm install');
console.log('  npx tsc --noEmit -p apps/api/tsconfig.json   # local sanity check');
console.log('  git add -A');
console.log('  git status');
console.log('  git commit -m "v0.10.150 hotfix: fix @types/fluent-ffmpeg resolution on Render"');
console.log('  git push origin main');
console.log('');
console.log('Then watch Render dashboard - ace-dialer-api deploy should now succeed.');
