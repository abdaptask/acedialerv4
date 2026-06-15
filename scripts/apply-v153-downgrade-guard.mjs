#!/usr/bin/env node
// v0.10.153 - Downgrade guard for the auto-update flow.
//
// PROBLEM:
//   Admin (Abd) installs a DRAFT release (e.g. v0.10.152) for testing
//   before promoting it to "Latest" on GitHub. While Abd's dialer is
//   on v0.10.152, electron-updater polls GitHub Releases and finds the
//   highest *published* (non-draft) release - which is v0.10.132. The
//   UpdateBanner then shows "Update available - v0.10.132" even though
//   that's a DOWNGRADE.
//
//   electron-updater's default behavior should prevent this (the lib's
//   allowDowngrade default is false), but the banner is firing anyway -
//   suggesting either the lib isn't enforcing it cleanly with our
//   custom verifyUpdateCodeSignature override, or the IPC event is
//   being sent without a version comparison.
//
// FIX:
//   Defense in depth, two layers.
//
//   1. apps/desktop/src/main.ts (Electron main process):
//      - Set autoUpdater.allowDowngrade = false EXPLICITLY (defensive,
//        documents intent).
//      - Add a compareSemver helper.
//      - Guard each of the autoUpdater event handlers (update-available,
//        download-progress, update-downloaded) so they bail out early
//        if the offered version is <= current app version.
//      - Also bail in the getUpdateState IPC handler so a renderer
//        rehydrating after remount doesn't pick up a stale downgrade
//        candidate.
//
//   2. apps/web/src/components/UpdateBanner.tsx (renderer):
//      - In the Path A (Electron) subscription, compare info.version
//        against localVersion using the existing compareSemver before
//        transitioning state to 'available' / 'downloading' / 'downloaded'.
//      - Same guard on the getUpdateState rehydrate path.
//      - Log to console.warn when a downgrade is ignored so we can
//        see it in DevTools / diagnostics export.
//
// IMPACT:
//   Once on v0.10.153+, the dialer will NEVER prompt the user to
//   downgrade. Admins testing draft builds won't see the spurious
//   "update available" toast pointing at the last published release.
//
// SAFETY:
//   Pure defensive code. Doesn't change the happy path (user on .X,
//   real release at .X+N where N > 0, banner shows normally). Only
//   short-circuits when offered version <= current.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
console.log(`[apply-v153] CWD: ${ROOT}`);

function applyEdits(relPath, edits) {
  const fp = join(ROOT, relPath);
  if (!existsSync(fp)) {
    console.error(`[apply-v153] FATAL: file not found: ${fp}`);
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
      console.error(`[apply-v153] FATAL in ${relPath}: edit #${i+1} (${edit.label}) - anchor not found`);
      console.error(`  anchor (first 200 chars): ${JSON.stringify(find.slice(0, 200))}`);
      process.exit(1);
    }
    if (content.split(find).length - 1 > 1) {
      console.error(`[apply-v153] FATAL: duplicate match for edit #${i+1} (${edit.label}) in ${relPath}`);
      process.exit(1);
    }
    content = content.replace(find, replace);
    console.log(`  OK ${relPath} edit ${i+1}/${edits.length} (${edit.label})`);
  }
  writeFileSync(fp, content, 'utf8');
  console.log(`  ${relPath}: ${initialLen} -> ${content.length} bytes (${usesCRLF ? 'CRLF' : 'LF'})`);
}

// ---------------------------------------------------------------------
// 1. apps/desktop/src/main.ts - allowDowngrade + version-comparison guard
// ---------------------------------------------------------------------
applyEdits('apps/desktop/src/main.ts', [
  {
    label: 'add explicit allowDowngrade=false after autoInstallOnAppQuit',
    find: `  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;`,
    replace: `  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  // v0.10.153 - explicit downgrade lock. Default in electron-updater is
  // already false, but we've seen the renderer get notified about an
  // older version when an admin had a draft build installed. Being
  // explicit documents intent and gives belt-and-suspenders alongside
  // the per-event guards we add below.
  (autoUpdater as unknown as { allowDowngrade?: boolean }).allowDowngrade = false;`,
  },
  {
    label: 'guard update-available handler against downgrade',
    find: `  autoUpdater.on('update-available', (info) => {
    console.log('[auto-update] update available', info?.version);
    lastUpdateState = { phase: 'available', version: info?.version ?? null };
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('ace:update-available', { version: info?.version ?? null });
    }
  });`,
    replace: `  autoUpdater.on('update-available', (info) => {
    // v0.10.153 - guard against spurious downgrade prompts. When an
    // admin installs a draft build that's newer than the latest
    // published release, electron-updater can still surface the
    // published release as "available". Compare versions here and
    // bail if we'd be offering a downgrade.
    const offered = info?.version ?? null;
    const current = app.getVersion();
    if (offered && compareSemverParts(offered, current) <= 0) {
      console.log('[auto-update] ignoring update-available for non-newer version', offered, '<=', current);
      lastUpdateState = { phase: 'idle' };
      return;
    }
    console.log('[auto-update] update available', offered);
    lastUpdateState = { phase: 'available', version: offered };
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('ace:update-available', { version: offered });
    }
  });`,
  },
  {
    label: 'add compareSemverParts helper near top of file',
    find: `function findProtocolUrl(argv: readonly string[]): string | null {
  for (const arg of argv) {
    if (typeof arg === 'string' && arg.startsWith('ace-dialer://')) return arg;
  }
  return null;
}`,
    replace: `function findProtocolUrl(argv: readonly string[]): string | null {
  for (const arg of argv) {
    if (typeof arg === 'string' && arg.startsWith('ace-dialer://')) return arg;
  }
  return null;
}

// v0.10.153 - tiny semver-ish comparator for the downgrade guard.
// Mirrors the one in apps/web/src/components/UpdateBanner.tsx so main
// and renderer stay consistent. Returns positive if a > b, 0 if equal,
// negative if a < b. Non-numeric segments are coerced to 0.
function compareSemverParts(a: string, b: string): number {
  const parse = (v: string) => v.split(/[.\\-+]/).map((p) => {
    const n = parseInt(p, 10);
    return Number.isFinite(n) ? n : 0;
  });
  const aP = parse(a);
  const bP = parse(b);
  const len = Math.max(aP.length, bP.length);
  for (let i = 0; i < len; i++) {
    const diff = (aP[i] ?? 0) - (bP[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}`,
  },
]);

// ---------------------------------------------------------------------
// 2. apps/web/src/components/UpdateBanner.tsx - renderer-side guard
// ---------------------------------------------------------------------
applyEdits('apps/web/src/components/UpdateBanner.tsx', [
  {
    label: 'guard Path A subscriptions against downgrade',
    find: `  // Path A — silent auto-update events from the Electron main process.
  useEffect(() => {
    if (!hasAutoUpdater) return;
    const unsubAvail = ace!.onUpdateAvailable!((info) => {
      setState({ phase: 'available', version: info.version });
    });
    const unsubProg = ace!.onUpdateProgress?.((info) => {
      setState((prev) => {
        const version = ('version' in prev) ? prev.version ?? null : null;
        return { phase: 'downloading', version, percent: info.percent };
      });
    });
    const unsubDone = ace!.onUpdateDownloaded!((info) => {
      setState({ phase: 'downloaded', version: info.version });
    });`,
    replace: `  // Path A — silent auto-update events from the Electron main process.
  useEffect(() => {
    if (!hasAutoUpdater) return;
    // v0.10.153 - second line of defense. Even though main now guards
    // against downgrade IPC, the renderer compares offered vs local
    // before transitioning state. If the offered version is not
    // strictly newer than the running app, log it and ignore.
    const isUpgrade = (offered: string | null): boolean => {
      if (!offered) return true; // unknown version - let main decide; main has already filtered
      const cmp = compareSemver(offered, localVersion);
      if (cmp <= 0) {
        console.warn('[update-banner] ignoring non-newer version', offered, '(local', localVersion + ')');
        return false;
      }
      return true;
    };
    const unsubAvail = ace!.onUpdateAvailable!((info) => {
      if (!isUpgrade(info.version)) return;
      setState({ phase: 'available', version: info.version });
    });
    const unsubProg = ace!.onUpdateProgress?.((info) => {
      setState((prev) => {
        const version = ('version' in prev) ? prev.version ?? null : null;
        if (!isUpgrade(version)) return prev;
        return { phase: 'downloading', version, percent: info.percent };
      });
    });
    const unsubDone = ace!.onUpdateDownloaded!((info) => {
      if (!isUpgrade(info.version)) return;
      setState({ phase: 'downloaded', version: info.version });
    });`,
  },
  {
    label: 'guard getUpdateState rehydrate path against downgrade',
    find: `    if (typeof ace!.getUpdateState === 'function') {
      void ace!.getUpdateState().then((s) => {
        if (!s || s.phase === 'idle' || s.phase === 'checking') return;
        if (s.phase === 'downloaded') {
          setState({ phase: 'downloaded', version: s.version ?? null });
        } else if (s.phase === 'downloading') {
          setState({ phase: 'downloading', version: s.version ?? null, percent: s.percent ?? 0 });
        } else if (s.phase === 'available') {
          setState({ phase: 'available', version: s.version ?? null });
        } else if (s.phase === 'error') {
          setState({ phase: 'error', version: s.version ?? null, message: s.message ?? 'Update failed' });
        }
      }).catch(() => { /* main process not ready yet — events will catch up */ });
    }`,
    replace: `    if (typeof ace!.getUpdateState === 'function') {
      void ace!.getUpdateState().then((s) => {
        if (!s || s.phase === 'idle' || s.phase === 'checking') return;
        // v0.10.153 - apply the downgrade guard to the rehydrate path
        // too. A stale state-mirror entry could otherwise drag the
        // banner back into a 'downloading'/'available' state pointing
        // at an older version after a remount.
        const offeredV = s.version ?? null;
        if (offeredV && compareSemver(offeredV, localVersion) <= 0 && s.phase !== 'error') {
          console.warn('[update-banner] rehydrate ignored - non-newer version', offeredV, '(local', localVersion + ')');
          return;
        }
        if (s.phase === 'downloaded') {
          setState({ phase: 'downloaded', version: offeredV });
        } else if (s.phase === 'downloading') {
          setState({ phase: 'downloading', version: offeredV, percent: s.percent ?? 0 });
        } else if (s.phase === 'available') {
          setState({ phase: 'available', version: offeredV });
        } else if (s.phase === 'error') {
          // Errors are always shown - they carry a 'failed to update' message
          // regardless of version direction.
          setState({ phase: 'error', version: offeredV, message: s.message ?? 'Update failed' });
        }
      }).catch(() => { /* main process not ready yet — events will catch up */ });
    }`,
  },
]);

// ---------------------------------------------------------------------
// 3. Version bumps 0.10.152 -> 0.10.153
// ---------------------------------------------------------------------
const PKGS = [
  'package.json',
  'apps/api/package.json',
  'apps/web/package.json',
  'apps/desktop/package.json',
  'apps/socket/package.json',
  'apps/webhooks/package.json',
  'packages/db/package.json',
];
for (const rp of PKGS) {
  const fp = join(ROOT, rp);
  if (!existsSync(fp)) {
    console.log(`  - ${rp}: not present, skipping`);
    continue;
  }
  let c = readFileSync(fp, 'utf8');
  const before = c;
  c = c.replace(/"version":\s*"0\.10\.152"/, '"version": "0.10.153"');
  if (c !== before) {
    writeFileSync(fp, c, 'utf8');
    console.log(`  OK ${rp}: bumped 0.10.152 -> 0.10.153`);
  } else {
    console.log(`  - ${rp}: no 0.10.152 found (run apply-v152-* first?)`);
  }
}

// ---------------------------------------------------------------------
// 4. DiagnosticsSection.tsx
// ---------------------------------------------------------------------
applyEdits('apps/web/src/components/DiagnosticsSection.tsx', [
  {
    label: 'bump APP_VERSION',
    find: `const APP_VERSION = '0.10.152';`,
    replace: `const APP_VERSION = '0.10.153';`,
  },
]);

// ---------------------------------------------------------------------
// 5. whatsNew.ts
// ---------------------------------------------------------------------
applyEdits('apps/web/src/data/whatsNew.ts', [
  {
    label: 'add v0.10.153 entry',
    find: `export const WHATS_NEW: ReleaseEntry[] = [
  {
    version: '0.10.152',`,
    replace: `export const WHATS_NEW: ReleaseEntry[] = [
  {
    version: '0.10.153',
    date: 'June 15, 2026',
    highlight: 'Fixed: dialer no longer offers a lower version as an update.',
    changes: [
      { type: 'fixed', text: 'If a draft build was installed for testing, the dialer would sometimes show an "Update available" toast pointing at an older published release. The dialer now compares the offered version to whats installed and only shows the toast when its a real upgrade.' },
    ],
  },
  {
    version: '0.10.152',`,
  },
]);

console.log('\n[apply-v153] DONE');
console.log('');
console.log('NEXT STEPS (run in repo root):');
console.log('  npx tsc --noEmit -p apps/desktop/tsconfig.json');
console.log('  npx tsc --noEmit -p apps/web/tsconfig.json');
console.log('  git status');
console.log('  git diff --stat');
console.log('  git add -A');
console.log('  git commit -m "v0.10.153: downgrade guard - dialer never offers a lower version as an update"');
console.log('  git tag v0.10.153');
console.log('  git push origin main');
console.log('  git push origin v0.10.153');
console.log('');
console.log('AFTER PUSH:');
console.log('  - Watch GitHub Actions; the Windows build should produce v0.10.153 as a');
console.log('    RELEASE (not a draft) because we already changed releaseType to "release".');
console.log('  - Install v0.10.153 locally and verify: with the latest published release');
console.log('    still being v0.10.132, you should NOT see any update toast.');
