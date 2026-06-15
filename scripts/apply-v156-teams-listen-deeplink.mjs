#!/usr/bin/env node
// v0.10.156 - Teams voicemail Listen button -> opens desktop app.
//
// PROBLEM:
//   Teams Adaptive Card for voicemails has three buttons:
//   Listen / Call back / Send text. Call back and Send text use the
//   AutoRoute pattern (URL -> /auto/call?to=X -> ace-dialer://call?to=X
//   -> Electron focuses with prefilled number). Listen instead links
//   straight to /voicemail/{id}/play, which opens the browser web
//   playback page even when the user has the desktop app.
//
// FIX:
//   Route Listen through the same AutoRoute pattern, so it deep-links
//   into the Electron app when installed and falls back to the web
//   playback page otherwise. Adds 'voicemail' as a third deep-link
//   action across the stack (web + Electron + webhooks).
//
// 6 EDITS ACROSS 5 FILES:
//   1. apps/webhooks/src/teamsCards/types.ts   -> buildVoicemailPlaybackUrl
//                                                  emits /auto/voicemail?id=X
//                                                  instead of /voicemail/X/play
//   2. apps/desktop/src/main.ts                -> PendingDeepLink union +
//                                                  handleDeepLink + routeProtocolUrl
//                                                  all accept voicemail variant
//   3. apps/desktop/src/preload.ts             -> onDeepLink callback type
//                                                  accepts voicemail payload
//   4. apps/web/src/vite-env.d.ts              -> matching type def for the
//                                                  preload bridge
//   5. apps/web/src/App.tsx                    -> onDeepLink handler routes
//                                                  voicemail to /voicemail/X/play
//                                                  + new /auto/voicemail route
//   6. apps/web/src/pages/AutoRoute.tsx        -> supports 'voicemail' action,
//                                                  reads 'id' param (not 'to'),
//                                                  builds correct protocol URL
//                                                  and web fallback route
//
// PREREQUISITE:
//   Repo should be on v0.10.155 (responsive UI pass shipped). Script
//   bumps versions 0.10.155 -> 0.10.156. If repo is still on 0.10.154
//   (the v0.10.155 apply hasnt been run), run apply-v155-* first.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
console.log(`[apply-v156] CWD: ${ROOT}`);

function applyEdits(relPath, edits) {
  const fp = join(ROOT, relPath);
  if (!existsSync(fp)) {
    console.error(`[apply-v156] FATAL: file not found: ${fp}`);
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
      console.error(`[apply-v156] FATAL in ${relPath}: edit #${i+1} (${edit.label}) - anchor not found`);
      console.error(`  anchor (first 240 chars): ${JSON.stringify(find.slice(0, 240))}`);
      process.exit(1);
    }
    if (content.split(find).length - 1 > 1) {
      console.error(`[apply-v156] FATAL: duplicate match for edit #${i+1} (${edit.label}) in ${relPath}`);
      process.exit(1);
    }
    content = content.replace(find, replace);
    console.log(`  OK ${relPath} edit ${i+1}/${edits.length} (${edit.label})`);
  }
  writeFileSync(fp, content, 'utf8');
  console.log(`  ${relPath}: ${initialLen} -> ${content.length} bytes (${usesCRLF ? 'CRLF' : 'LF'})`);
}

// ---------------------------------------------------------------------
// 1. apps/webhooks/src/teamsCards/types.ts
// ---------------------------------------------------------------------
applyEdits('apps/webhooks/src/teamsCards/types.ts', [
  {
    label: 'buildVoicemailPlaybackUrl through /auto/voicemail',
    find: `/** Voicemail playback URL — stays as a web route (audio playback is
 *  a browser-rendered page, not a desktop action). */
export function buildVoicemailPlaybackUrl(voicemailId: number): string {
  return \`\${webBase()}/voicemail/\${voicemailId}/play\`;
}`,
    replace: `/** Voicemail playback URL.
 *  v0.10.156 - was direct web URL; now routes through /auto/voicemail
 *  so the AutoRoute page fires ace-dialer://voicemail?id=X and the
 *  Electron desktop app handles it natively when installed.
 *  Web fallback: /auto/voicemail navigates to /voicemail/{id}/play
 *  after the protocol attempt times out, so browser-only users get the
 *  same playback page they had before. */
export function buildVoicemailPlaybackUrl(voicemailId: number): string {
  return \`\${webBase()}/auto/voicemail?id=\${voicemailId}\`;
}`,
  },
]);

// ---------------------------------------------------------------------
// 2. apps/desktop/src/main.ts  (3 sub-edits)
// ---------------------------------------------------------------------
applyEdits('apps/desktop/src/main.ts', [
  {
    label: 'PendingDeepLink union to include voicemail',
    find: `interface PendingDeepLink {
  action: 'call' | 'sms';
  to: string;
}
let pendingDeepLink: PendingDeepLink | null = null;`,
    replace: `// v0.10.156 - widened to a discriminated union so the deep-link
// transport supports the Teams voicemail Listen button. call/sms still
// carry a 'to' (phone number); voicemail carries an 'id' (DB row id of
// the voicemail to open).
type PendingDeepLink =
  | { action: 'call'; to: string }
  | { action: 'sms'; to: string }
  | { action: 'voicemail'; id: string };
let pendingDeepLink: PendingDeepLink | null = null;`,
  },
  {
    label: 'handleDeepLink accepts the discriminated payload',
    find: `function handleDeepLink(action: 'call' | 'sms', to: string) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (!mainWindow.isVisible()) mainWindow.show();
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
    mainWindow.webContents.send('ace:deep-link', { action, to });
    pendingDeepLink = null;
  } else {
    pendingDeepLink = { action, to };
  }
}`,
    replace: `// v0.10.156 - takes the full payload so the call/sms/voicemail
// variants all use the same plumbing. Renderer gets the same object
// it would build from a URL parser.
function handleDeepLink(payload: PendingDeepLink) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (!mainWindow.isVisible()) mainWindow.show();
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
    mainWindow.webContents.send('ace:deep-link', payload);
    pendingDeepLink = null;
  } else {
    pendingDeepLink = payload;
  }
}`,
  },
  {
    label: 'routeProtocolUrl recognises voicemail action',
    find: `    const action = parsed.hostname;
    if (action === 'call' || action === 'sms') {
      const to = parsed.searchParams.get('to') ?? '';
      if (!to) {
        console.warn('[deep-link] missing ?to= param', url);
        return;
      }
      handleDeepLink(action, to);
      return;
    }
    console.warn('[deep-link] unrecognised action', { url, host: action });`,
    replace: `    const action = parsed.hostname;
    if (action === 'call' || action === 'sms') {
      const to = parsed.searchParams.get('to') ?? '';
      if (!to) {
        console.warn('[deep-link] missing ?to= param', url);
        return;
      }
      handleDeepLink({ action, to });
      return;
    }
    // v0.10.156 - voicemail action from the Teams Listen card button.
    if (action === 'voicemail') {
      const id = parsed.searchParams.get('id') ?? '';
      if (!id) {
        console.warn('[deep-link] missing ?id= param', url);
        return;
      }
      handleDeepLink({ action: 'voicemail', id });
      return;
    }
    console.warn('[deep-link] unrecognised action', { url, host: action });`,
  },
]);

// ---------------------------------------------------------------------
// 3. apps/desktop/src/preload.ts
// ---------------------------------------------------------------------
applyEdits('apps/desktop/src/preload.ts', [
  {
    label: 'onDeepLink callback type accepts voicemail payload',
    find: `  onDeepLink: (cb: (data: { action: 'call' | 'sms'; to: string }) => void) => {
    const handler = (_e: unknown, data: { action: 'call' | 'sms'; to: string }) =>
      cb(data);
    ipcRenderer.on('ace:deep-link', handler);
    return () => ipcRenderer.removeListener('ace:deep-link', handler);
  },`,
    replace: `  // v0.10.156 - widened to accept the voicemail variant. call/sms
  // carry a 'to' field; voicemail carries an 'id' field. Renderer
  // discriminates on data.action.
  onDeepLink: (
    cb: (
      data:
        | { action: 'call'; to: string }
        | { action: 'sms'; to: string }
        | { action: 'voicemail'; id: string },
    ) => void,
  ) => {
    const handler = (
      _e: unknown,
      data:
        | { action: 'call'; to: string }
        | { action: 'sms'; to: string }
        | { action: 'voicemail'; id: string },
    ) => cb(data);
    ipcRenderer.on('ace:deep-link', handler);
    return () => ipcRenderer.removeListener('ace:deep-link', handler);
  },`,
  },
]);

// ---------------------------------------------------------------------
// 4. apps/web/src/vite-env.d.ts
// ---------------------------------------------------------------------
applyEdits('apps/web/src/vite-env.d.ts', [
  {
    label: 'onDeepLink type def in vite-env.d.ts',
    find: `  // v0.10.4 Task 10 — Deep-link bridge (Teams card buttons)
  onDeepLink?: (
    cb: (data: { action: 'call' | 'sms'; to: string }) => void,
  ) => () => void;`,
    replace: `  // v0.10.4 Task 10 — Deep-link bridge (Teams card buttons)
  // v0.10.156 - widened for the voicemail Listen button.
  onDeepLink?: (
    cb: (
      data:
        | { action: 'call'; to: string }
        | { action: 'sms'; to: string }
        | { action: 'voicemail'; id: string },
    ) => void,
  ) => () => void;`,
  },
]);

// ---------------------------------------------------------------------
// 5. apps/web/src/App.tsx  (2 sub-edits)
// ---------------------------------------------------------------------
applyEdits('apps/web/src/App.tsx', [
  {
    label: 'onDeepLink handler discriminates on action',
    find: `    if (!window.ace?.onDeepLink) return;
    const unsub = window.ace.onDeepLink((data) => {
      if (!data?.to) return;
      const route =
        data.action === 'call'
          ? \`/keypad?to=\${encodeURIComponent(data.to)}\`
          : \`/messages?to=\${encodeURIComponent(data.to)}\`;
      navigate(route);
    });`,
    replace: `    if (!window.ace?.onDeepLink) return;
    const unsub = window.ace.onDeepLink((data) => {
      // v0.10.156 - voicemail variant carries id, not to.
      if (data.action === 'voicemail') {
        if (!data.id) return;
        navigate(\`/voicemail/\${encodeURIComponent(data.id)}/play\`);
        return;
      }
      if (!data.to) return;
      const route =
        data.action === 'call'
          ? \`/keypad?to=\${encodeURIComponent(data.to)}\`
          : \`/messages?to=\${encodeURIComponent(data.to)}\`;
      navigate(route);
    });`,
  },
  {
    label: 'add /auto/voicemail route',
    find: `      <Route path="/auto/call" element={<AutoRoute action="call" />} />
      <Route path="/auto/sms" element={<AutoRoute action="sms" />} />`,
    replace: `      <Route path="/auto/call" element={<AutoRoute action="call" />} />
      <Route path="/auto/sms" element={<AutoRoute action="sms" />} />
      {/* v0.10.156 - voicemail Listen button from Teams cards. Same
          pattern: try to fire ace-dialer://voicemail?id=X, fall back to
          the web playback page if no desktop app or after timeout. */}
      <Route path="/auto/voicemail" element={<AutoRoute action="voicemail" />} />`,
  },
]);

// ---------------------------------------------------------------------
// 6. apps/web/src/pages/AutoRoute.tsx
// ---------------------------------------------------------------------
applyEdits('apps/web/src/pages/AutoRoute.tsx', [
  {
    label: 'AutoRoute supports voicemail action',
    find: `interface AutoRouteProps {
  /** 'call' for /auto/call, 'sms' for /auto/sms. Drives the protocol
   *  scheme suffix + the eventual web route the fallback navigates to. */
  action: 'call' | 'sms';
}

export default function AutoRoute({ action }: AutoRouteProps) {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const to = params.get('to') ?? '';
  const [protocolTried, setProtocolTried] = useState(false);

  useEffect(() => {
    if (!to) {
      // Missing required param — bounce to keypad/messages without it.
      navigate(action === 'call' ? '/keypad' : '/messages', { replace: true });
      return;
    }

    // v0.10.67 — If we're ALREADY inside the Electron desktop app, skip
    // the protocol launch entirely. Trying ace-dialer:// from inside
    // Electron either does nothing (if the protocol handler defers to
    // the running instance) or bounces the user out to a "no handler"
    // browser dialog. Just navigate directly to the destination route
    // inside this same Electron window.
    const inElectron = typeof window !== 'undefined' && !!(window as { ace?: unknown }).ace;
    if (inElectron) {
      const webRoute =
        action === 'call'
          ? \`/keypad?to=\${encodeURIComponent(to)}\`
          : \`/messages?to=\${encodeURIComponent(to)}\`;
      navigate(webRoute, { replace: true });
      return;
    }

    // v0.10.6 — switched from a hidden-iframe protocol launch to
    // window.location.href. Modern Chrome / Edge block iframe-driven
    // custom-protocol launches as a silent-redirect security measure,
    // which made the previous implementation always fall back to web
    // even when the desktop app was installed.
    //
    // window.location.href is the standard pattern (Slack/Zoom/Teams
    // all use it). The browser shows a native "Open <app>?" dialog
    // on first launch; once the user clicks Allow + checks
    // "Always allow", subsequent clicks open the desktop directly
    // with no prompt.
    const url = \`ace-dialer://\${action}?to=\${encodeURIComponent(to)}\`;
    try {
      window.location.href = url;
    } catch {
      /* harmless — we'll just rely on the fallback */
    }
    setProtocolTried(true);`,
    replace: `interface AutoRouteProps {
  /** 'call' for /auto/call, 'sms' for /auto/sms, 'voicemail' for
   *  /auto/voicemail (v0.10.156). Drives the protocol scheme suffix
   *  + the eventual web route the fallback navigates to. */
  action: 'call' | 'sms' | 'voicemail';
}

export default function AutoRoute({ action }: AutoRouteProps) {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  // v0.10.156 - call/sms carry a 'to' phone number; voicemail carries
  // an 'id' (DB row id of the voicemail to play). Read the right param
  // based on action so the rest of the component is action-agnostic.
  const to = action === 'voicemail'
    ? (params.get('id') ?? '')
    : (params.get('to') ?? '');
  const [protocolTried, setProtocolTried] = useState(false);

  useEffect(() => {
    if (!to) {
      // Missing required param — bounce to a sensible fallback page.
      const missingFallback =
        action === 'call' ? '/keypad' :
        action === 'sms' ? '/messages' :
        '/voicemail';
      navigate(missingFallback, { replace: true });
      return;
    }

    // v0.10.67 — If we're ALREADY inside the Electron desktop app, skip
    // the protocol launch entirely. Trying ace-dialer:// from inside
    // Electron either does nothing (if the protocol handler defers to
    // the running instance) or bounces the user out to a "no handler"
    // browser dialog. Just navigate directly to the destination route
    // inside this same Electron window.
    const inElectron = typeof window !== 'undefined' && !!(window as { ace?: unknown }).ace;
    if (inElectron) {
      const webRoute =
        action === 'call' ? \`/keypad?to=\${encodeURIComponent(to)}\` :
        action === 'sms'  ? \`/messages?to=\${encodeURIComponent(to)}\` :
                            \`/voicemail/\${encodeURIComponent(to)}/play\`;
      navigate(webRoute, { replace: true });
      return;
    }

    // v0.10.6 — switched from a hidden-iframe protocol launch to
    // window.location.href. Modern Chrome / Edge block iframe-driven
    // custom-protocol launches as a silent-redirect security measure,
    // which made the previous implementation always fall back to web
    // even when the desktop app was installed.
    //
    // v0.10.156 - voicemail action uses ?id= query param to match the
    // Electron protocol-handler's parsing (see apps/desktop/src/main.ts
    // routeProtocolUrl).
    const url = action === 'voicemail'
      ? \`ace-dialer://voicemail?id=\${encodeURIComponent(to)}\`
      : \`ace-dialer://\${action}?to=\${encodeURIComponent(to)}\`;
    try {
      window.location.href = url;
    } catch {
      /* harmless — we'll just rely on the fallback */
    }
    setProtocolTried(true);`,
  },
  {
    label: 'AutoRoute label + fallbackText + fallbackRoute support voicemail',
    find: `  const label = action === 'call' ? 'Opening the dialer' : 'Opening the composer';
  const fallbackText =
    action === 'call'
      ? 'Open in browser dialer'
      : 'Open in browser composer';
  const fallbackRoute =
    action === 'call'
      ? \`/keypad?to=\${encodeURIComponent(to)}\`
      : \`/messages?to=\${encodeURIComponent(to)}\`;`,
    replace: `  // v0.10.156 - voicemail variant gets its own label + fallback.
  const label =
    action === 'call' ? 'Opening the dialer' :
    action === 'sms'  ? 'Opening the composer' :
                        'Opening voicemail';
  const fallbackText =
    action === 'call' ? 'Open in browser dialer' :
    action === 'sms'  ? 'Open in browser composer' :
                        'Open voicemail in browser';
  const fallbackRoute =
    action === 'call' ? \`/keypad?to=\${encodeURIComponent(to)}\` :
    action === 'sms'  ? \`/messages?to=\${encodeURIComponent(to)}\` :
                        \`/voicemail/\${encodeURIComponent(to)}/play\`;`,
  },
]);

// ---------------------------------------------------------------------
// Version bumps 0.10.155 -> 0.10.156
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
  c = c.replace(/"version":\s*"0\.10\.155"/, '"version": "0.10.156"');
  if (c !== before) {
    writeFileSync(fp, c, 'utf8');
    console.log(`  OK ${rp}: bumped 0.10.155 -> 0.10.156`);
  } else {
    console.log(`  - ${rp}: no 0.10.155 found (run apply-v155-* first?)`);
  }
}

applyEdits('apps/web/src/components/DiagnosticsSection.tsx', [
  {
    label: 'bump APP_VERSION',
    find: `const APP_VERSION = '0.10.155';`,
    replace: `const APP_VERSION = '0.10.156';`,
  },
]);

applyEdits('apps/web/src/data/whatsNew.ts', [
  {
    label: 'add v0.10.156 entry',
    find: `export const WHATS_NEW: ReleaseEntry[] = [
  {
    version: '0.10.155',`,
    replace: `export const WHATS_NEW: ReleaseEntry[] = [
  {
    version: '0.10.156',
    date: 'June 15, 2026',
    highlight: 'Teams voicemail Listen button now opens the desktop dialer.',
    changes: [
      { type: 'fixed', text: 'Clicking Listen on a voicemail notification in Teams used to open the web playback page in your browser. It now opens the ACE Dialer desktop app directly, matching how the Call back and Send text buttons already worked. If you do not have the desktop app installed, it still falls back to the web page so nothing breaks.' },
    ],
  },
  {
    version: '0.10.155',`,
  },
]);

console.log('\n[apply-v156] DONE');
console.log('');
console.log('TEST PLAN:');
console.log('  1. Build + install v0.10.156 desktop locally');
console.log('  2. Trigger a voicemail (call yourself, let it ring out)');
console.log('  3. Open the Teams notification when it arrives');
console.log('  4. Click Listen -> should focus the ACE Dialer desktop app');
console.log('     and navigate to the voicemail playback page directly.');
console.log('     Should NOT open a browser tab.');
console.log('  5. On a machine WITHOUT the desktop app: same Teams click should');
console.log('     open the browser, hit /auto/voicemail?id=X, attempt the');
console.log('     protocol launch (fails silently), then navigate to');
console.log('     /voicemail/X/play. Old behaviour, just via the AutoRoute step.');
console.log('');
console.log('NEXT:');
console.log('  npx tsc --noEmit -p apps/web/tsconfig.json');
console.log('  npx tsc --noEmit -p apps/desktop/tsconfig.json');
console.log('  npx tsc --noEmit -p apps/webhooks/tsconfig.json');
console.log('  git add -A');
console.log('  git commit -m "v0.10.156: Teams voicemail Listen button opens desktop app"');
console.log('  git tag v0.10.156');
console.log('  git push origin main');
console.log('  git push origin v0.10.156');
