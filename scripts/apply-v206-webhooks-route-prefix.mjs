#!/usr/bin/env node
// v0.10.206 - Webhooks route-prefix support.
//
// PROBLEM
//   After moving the webhooks service behind https://dialer.aptask.com/
//   webhooks/* via path-based reverse-proxy routing, Telnyx's TeXML
//   Voicemail Application calls https://dialer.aptask.com/webhooks/texml/
//   voicemail and gets 404. The proxy forwards the request to the
//   webhooks service WITHOUT stripping the /webhooks prefix, and the
//   service's routes are registered at /texml/voicemail (root path) -
//   so the catch-all 404 handler fires. Telnyx renders "an application
//   error has occurred" to the caller.
//
//   Smoke-tested confirmed: GET https://dialer.aptask.com/webhooks/
//   telnyx-status returns:
//     { "error":"not found", "path":"/webhooks/telnyx-status" }
//
//   That JSON body is our service's catch-all - so the request IS
//   reaching the service, the proxy just isn't stripping the prefix.
//
// FIX (env-driven, no proxy changes required)
//   Add a rewriteUrl() hook to the Fastify init that strips a
//   configurable route prefix from incoming URLs BEFORE Fastify's
//   router matches them. The prefix is read from WEBHOOKS_ROUTE_PREFIX
//   (explicit) OR auto-derived from the path portion of
//   WEBHOOKS_PUBLIC_URL.
//
//   Effect: setting WEBHOOKS_PUBLIC_URL=https://dialer.aptask.com/
//   webhooks (which you already need to set for the TeXML voice_url
//   bootstrap) ALSO makes the service answer at /webhooks/* paths -
//   no second env var, no proxy rewrite rule needed.
//
//   On Render, WEBHOOKS_PUBLIC_URL is typically unset (the bootstrap
//   skips); ROUTE_PREFIX therefore stays empty, rewriteUrl is a no-op,
//   and the existing Render deployment keeps working unchanged. Fully
//   backwards-compatible.
//
// SCOPE OF CHANGES
//   - apps/webhooks/src/main.ts: add ROUTE_PREFIX derivation + rewriteUrl
//     to the Fastify constructor. Boot log records the active prefix.
//   - apps/web/src/components/DiagnosticsSection.tsx: APP_VERSION bump.
//   - apps/web/src/data/whatsNew.ts: release note.
//   - 7 x package.json: 0.10.205 -> 0.10.206.
//
// VERIFY AFTER DEPLOY
//   1. webhooks boot log shows: [webhooks] route prefix = /webhooks
//   2. curl https://dialer.aptask.com/webhooks/telnyx-status -> 200 + JSON
//   3. dial the trial DID - no "application error" from Telnyx; voicemail
//      lands in the inbox within ~60s.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
console.log(`[apply-v206] CWD: ${ROOT}`);

function applyEdits(relPath, edits) {
  const fp = join(ROOT, relPath);
  if (!existsSync(fp)) {
    console.error(`[apply-v206] FATAL: file not found: ${fp}`);
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
      console.error(`[apply-v206] FATAL in ${relPath}: edit #${i+1} (${edit.label}) - anchor not found`);
      console.error(`  anchor (first 240 chars): ${JSON.stringify(find.slice(0, 240))}`);
      process.exit(1);
    }
    if (content.split(find).length - 1 > 1) {
      console.error(`[apply-v206] FATAL: duplicate match for edit #${i+1} (${edit.label}) in ${relPath}`);
      process.exit(1);
    }
    content = content.replace(find, replace);
    console.log(`  OK ${relPath} edit ${i+1}/${edits.length} (${edit.label})`);
  }
  writeFileSync(fp, content, 'utf8');
  console.log(`  ${relPath}: ${initialLen} -> ${content.length} bytes (${usesCRLF ? 'CRLF' : 'LF'})`);
}

// =====================================================================
// apps/webhooks/src/main.ts - add ROUTE_PREFIX derivation + rewriteUrl
// =====================================================================
applyEdits('apps/webhooks/src/main.ts', [
  {
    label: 'add ROUTE_PREFIX + rewriteUrl to Fastify init',
    find: `const app = Fastify({
  logger: { level: process.env.LOG_LEVEL ?? 'info' },
  ignoreTrailingSlash: true,
});`,
    replace: `// v0.10.206 - Route-prefix support so the service answers at e.g.
// /webhooks/texml/voicemail when fronted by a reverse proxy that
// doesn't strip /webhooks before forwarding. Reads WEBHOOKS_ROUTE_PREFIX
// (explicit) OR auto-derives the path portion of WEBHOOKS_PUBLIC_URL.
// Empty => no rewrite, identical to pre-v206 behavior.
function deriveRoutePrefix() {
  const explicit = (process.env.WEBHOOKS_ROUTE_PREFIX ?? '').trim();
  if (explicit) return explicit.replace(/\\/+$/, '');
  const publicUrl = (process.env.WEBHOOKS_PUBLIC_URL ?? '').trim();
  if (!publicUrl) return '';
  try {
    const u = new URL(publicUrl);
    return u.pathname.replace(/\\/+$/, '');
  } catch {
    return '';
  }
}
const ROUTE_PREFIX = deriveRoutePrefix();
console.log(\`[webhooks] route prefix = "\${ROUTE_PREFIX}" (empty = no rewrite)\`);

const app = Fastify({
  logger: { level: process.env.LOG_LEVEL ?? 'info' },
  ignoreTrailingSlash: true,
  // v0.10.206 - Strip ROUTE_PREFIX from incoming URLs BEFORE router
  // matching. Examples (with ROUTE_PREFIX = "/webhooks"):
  //   /webhooks/texml/voicemail        -> /texml/voicemail
  //   /webhooks/texml/voicemail?To=... -> /texml/voicemail?To=...
  //   /webhooks                        -> /
  //   /webhooks?foo=bar                -> /?foo=bar
  //   /other/path                      -> /other/path (no-op)
  rewriteUrl: ROUTE_PREFIX
    ? (rawReq) => {
        const url = rawReq.url ?? '/';
        if (url === ROUTE_PREFIX) return '/';
        if (url.startsWith(ROUTE_PREFIX + '/')) return url.slice(ROUTE_PREFIX.length);
        if (url.startsWith(ROUTE_PREFIX + '?')) return '/' + url.slice(ROUTE_PREFIX.length);
        return url;
      }
    : undefined,
});`,
  },
]);

// =====================================================================
// DiagnosticsSection APP_VERSION
// =====================================================================
applyEdits('apps/web/src/components/DiagnosticsSection.tsx', [
  {
    label: 'bump APP_VERSION',
    find: `const APP_VERSION = '0.10.205';`,
    replace: `const APP_VERSION = '0.10.206';`,
  },
]);

// =====================================================================
// whatsNew.ts
// =====================================================================
applyEdits('apps/web/src/data/whatsNew.ts', [
  {
    label: 'add v0.10.206 entry at top of WHATS_NEW',
    find: `export const WHATS_NEW: ReleaseEntry[] = [
  {
    version: '0.10.205',`,
    replace: `export const WHATS_NEW: ReleaseEntry[] = [
  {
    version: '0.10.206',
    date: 'June 25, 2026',
    highlight: 'Backend infrastructure fix for the new self-hosted environment.',
    changes: [
      { type: 'fixed', text: 'Inbound voicemail flow on the new self-hosted webhooks endpoint (dialer.aptask.com/webhooks) was returning 404 because the reverse proxy did not strip the /webhooks path prefix. Server now strips it internally based on the public URL configured for the environment. Users would have seen "an application error has occurred" when calling certain numbers.' },
    ],
  },
  {
    version: '0.10.205',`,
  },
]);

// =====================================================================
// Version bumps 0.10.205 -> 0.10.206
// =====================================================================
const PKGS = [
  'package.json',
  'apps/api/package.json',
  'apps/web/package.json',
  'apps/desktop/package.json',
  'apps/socket/package.json',
  'apps/webhooks/package.json',
  'packages/db/package.json',
];
let bumped = 0;
for (const rp of PKGS) {
  const fp = join(ROOT, rp);
  if (!existsSync(fp)) continue;
  let c = readFileSync(fp, 'utf8');
  const before = c;
  c = c.replace(/"version":\s*"0\.10\.205"/, '"version": "0.10.206"');
  if (c !== before) {
    writeFileSync(fp, c, 'utf8');
    console.log(`  OK ${rp}: bumped 0.10.205 -> 0.10.206`);
    bumped++;
  }
}
if (bumped === 0) {
  console.error('[apply-v206] FATAL: no package.json files bumped. Aborting.');
  process.exit(1);
}
if (bumped !== PKGS.length) {
  console.warn(`[apply-v206] WARN: only ${bumped}/${PKGS.length} package.json files bumped (expected all 7)`);
}

console.log('');
console.log('[apply-v206] DONE');
console.log('');
console.log('NEXT (run from the repo root in PowerShell):');
console.log('  node scripts/strip-null-bytes.mjs');
console.log('  npx tsc --noEmit -p apps/webhooks/tsconfig.json');
console.log('  npx tsc --noEmit -p apps/web/tsconfig.json');
console.log('  git add -A');
console.log('  git commit -m "v0.10.206: webhooks ROUTE_PREFIX rewrite - serve /webhooks/* without proxy rewrite"');
console.log('  git tag v0.10.206');
console.log('  git push origin main');
console.log('  git push origin v0.10.206');
console.log('');
console.log('AFTER DEPLOY - set on the webhooks service env, then restart:');
console.log('  WEBHOOKS_PUBLIC_URL=https://dialer.aptask.com/webhooks');
console.log('  (WEBHOOKS_ROUTE_PREFIX is auto-derived from the path of WEBHOOKS_PUBLIC_URL,');
console.log('   but you can also set it explicitly if you want.)');
console.log('');
console.log('VERIFY:');
console.log('  curl https://dialer.aptask.com/webhooks/telnyx-status   (should return JSON, not 404)');
console.log('  Telnyx TeXML app boot log should show: [texml] App verified at Telnyx');
