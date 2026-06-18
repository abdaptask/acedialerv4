#!/usr/bin/env node
// v0.10.181 - Personal Usage report (non-admin users see their OWN activity).
//
// SCOPE
//   The Settings -> Reports -> Usage section has been admin-only since v0.10.11.
//   This release adds a per-user self-view so non-admins can see their OWN
//   call/SMS activity over the same 7d/30d ranges. Smallest of the 4 admin
//   reports (Usage/Quality/Recruiter/Alerts) used as a proof-of-concept
//   pattern; if this lands cleanly, v0.10.182 mirrors it to the other three.
//
// CHANGES
//   1. NEW BACKEND ENDPOINT: GET /me/reports/usage?range=today|7d|30d
//      Mirrors the existing /admin/reports/usage logic but filters every
//      Call and Message query by userId = req.user.sub. Returns the same
//      UsageReport JSON shape so the frontend can reuse types.
//   2. NEW CLIENT HELPER: getMyUsageReport(token, range) in api.ts.
//   3. UsageSection in Settings.tsx:
//      - Removes the "Admin access required" early-return gate.
//      - Conditionally calls getMyUsageReport (non-admin) or
//        getUsageReport (admin) so admins still see the fleet view.
//      - Hides the "Top users by call volume" table for non-admin
//        users (single-row table would look weird).
//      - Adjusts the section heading from "Usage" to "My Usage" for
//        non-admin users.
//   4. SECTION_DEFS: drops adminOnly:true from the Usage entry; updates
//      the blurb to remove "(admin only)" so non-admins know they can
//      open it.
//
// VERSION BUMP: 0.10.180 -> 0.10.181

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
console.log(`[apply-v181] CWD: ${ROOT}`);

function applyEdits(relPath, edits) {
  const fp = join(ROOT, relPath);
  if (!existsSync(fp)) {
    console.error(`[apply-v181] FATAL: file not found: ${fp}`);
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
      console.error(`[apply-v181] FATAL in ${relPath}: edit #${i+1} (${edit.label}) - anchor not found`);
      console.error(`  anchor (first 240 chars): ${JSON.stringify(find.slice(0, 240))}`);
      process.exit(1);
    }
    if (content.split(find).length - 1 > 1) {
      console.error(`[apply-v181] FATAL: duplicate match for edit #${i+1} (${edit.label}) in ${relPath}`);
      process.exit(1);
    }
    content = content.replace(find, replace);
    console.log(`  OK ${relPath} edit ${i+1}/${edits.length} (${edit.label})`);
  }
  writeFileSync(fp, content, 'utf8');
  console.log(`  ${relPath}: ${initialLen} -> ${content.length} bytes (${usesCRLF ? 'CRLF' : 'LF'})`);
}

// =====================================================================
// 1. me.routes.ts - add GET /me/reports/usage endpoint
// =====================================================================
applyEdits('apps/api/src/me/me.routes.ts', [
  {
    label: '1: append GET /me/reports/usage endpoint before the closing brace of meRoutes()',
    find: `      const result = await prisma.userDevice.updateMany({
        where: { deviceId, userId: u.sub },
        data: { forceUpdateAckedAt: new Date() },
      });
      return { ok: true, updated: result.count };
    },
  );
}`,
    replace: `      const result = await prisma.userDevice.updateMany({
        where: { deviceId, userId: u.sub },
        data: { forceUpdateAckedAt: new Date() },
      });
      return { ok: true, updated: result.count };
    },
  );

  // ── GET /me/reports/usage ──────────────────────────────────────────
  //
  // v0.10.181 — Self-view of the existing admin Usage report. Returns
  // the SAME UsageReport JSON shape that /admin/reports/usage returns,
  // but every Call / Message query is filtered to userId = req.user.sub.
  // The byUser array contains a single row (this user's totals) so the
  // frontend can reuse the UsageReport TypeScript type without changes.
  //
  // Range semantics match the admin endpoint: 'today' | '7d' | '30d'.
  app.get<{ Querystring: { range?: string } }>(
    '/me/reports/usage',
    { onRequest: [app.authenticate] },
    async (request) => {
      const u = request.user as JwtPayload;
      const range = request.query.range ?? '7d';
      const now = new Date();
      let since: Date;
      if (range === 'today') {
        since = new Date(now); since.setUTCHours(0, 0, 0, 0);
      } else if (range === '30d') {
        since = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      } else {
        since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      }

      // Calls grouped by direction + status for this user only.
      const callsByDir = await prisma.call.groupBy({
        by: ['direction', 'status'],
        where: { userId: u.sub, startedAt: { gte: since } },
        _count: { _all: true },
        _sum: { durationSeconds: true },
      });
      let inbound = 0, outbound = 0, missed = 0, talkSec = 0;
      for (const r of callsByDir) {
        const c = r._count._all;
        const t = r._sum.durationSeconds ?? 0;
        if (r.direction === 'inbound') {
          if (['missed', 'no_answer', 'rejected'].includes(r.status)) missed += c;
          else inbound += c;
        } else if (r.direction === 'outbound') {
          outbound += c;
        }
        talkSec += t;
      }

      // SMS grouped by direction for this user only.
      const smsByDir = await prisma.message.groupBy({
        by: ['direction'],
        where: { userId: u.sub, createdAt: { gte: since } },
        _count: { _all: true },
      });
      let smsSent = 0, smsReceived = 0;
      for (const r of smsByDir) {
        if (r.direction === 'outbound') smsSent += r._count._all;
        else smsReceived += r._count._all;
      }

      // User row (so byUser[0] has a name/email/did for display).
      const me = await prisma.user.findUnique({
        where: { id: u.sub },
        select: { id: true, email: true, firstName: true, lastName: true, didNumber: true },
      });

      const myRow = {
        userId: u.sub,
        email: me?.email ?? '(unknown)',
        name:
          ([me?.firstName, me?.lastName].filter(Boolean).join(' ').trim() ||
            me?.email) ?? '(unknown)',
        didNumber: me?.didNumber ?? null,
        totalCalls: inbound + outbound + missed,
        inbound,
        outbound,
        missed,
        talkSeconds: talkSec,
        smsSent,
        smsReceived,
      };

      // Per-day chart, same logic as /admin/reports/usage but filtered.
      const callsInWindow = await prisma.call.findMany({
        where: { userId: u.sub, startedAt: { gte: since } },
        select: { startedAt: true, direction: true, status: true },
      });
      const days = range === 'today' ? 1 : range === '30d' ? 30 : 7;
      const byDay: Array<{ date: string; inbound: number; outbound: number; missed: number }> = [];
      for (let i = 0; i < days; i += 1) {
        const dayStart = new Date(now); dayStart.setUTCHours(0, 0, 0, 0);
        dayStart.setUTCDate(dayStart.getUTCDate() - (days - 1 - i));
        const dayEnd = new Date(dayStart); dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);
        let inb = 0, out = 0, mis = 0;
        for (const c of callsInWindow) {
          if (c.startedAt < dayStart || c.startedAt >= dayEnd) continue;
          if (c.direction === 'inbound') {
            if (['missed', 'no_answer', 'rejected'].includes(c.status)) mis += 1;
            else inb += 1;
          } else if (c.direction === 'outbound') {
            out += 1;
          }
        }
        byDay.push({ date: dayStart.toISOString().slice(0, 10), inbound: inb, outbound: out, missed: mis });
      }

      return {
        range,
        generatedAt: now.toISOString(),
        byUser: [myRow],
        byDay,
      };
    },
  );
}`,
  },
]);

// =====================================================================
// 2. api.ts - add getMyUsageReport client helper
// =====================================================================
applyEdits('apps/web/src/api.ts', [
  {
    label: '2: add getMyUsageReport helper right after getUsageReport',
    find: `export async function getUsageReport(token: string, range: 'today' | '7d' | '30d' = '7d'): Promise<UsageReport> {
  const res = await fetch(\`\${API_URL}/admin/reports/usage?range=\${range}\`, {
    headers: { Authorization: \`Bearer \${token}\` },
  });
  if (!res.ok) throw new Error(\`HTTP \${res.status}\`);
  return (await res.json()) as UsageReport;
}`,
    replace: `export async function getUsageReport(token: string, range: 'today' | '7d' | '30d' = '7d'): Promise<UsageReport> {
  const res = await fetch(\`\${API_URL}/admin/reports/usage?range=\${range}\`, {
    headers: { Authorization: \`Bearer \${token}\` },
  });
  if (!res.ok) throw new Error(\`HTTP \${res.status}\`);
  return (await res.json()) as UsageReport;
}

// v0.10.181 — Per-user self-view of the Usage report. Same JSON shape
// as the admin version but \`byUser\` contains a single row (this user)
// and every aggregation is filtered to req.user.sub on the server side.
export async function getMyUsageReport(token: string, range: 'today' | '7d' | '30d' = '7d'): Promise<UsageReport> {
  const res = await fetch(\`\${API_URL}/me/reports/usage?range=\${range}\`, {
    headers: { Authorization: \`Bearer \${token}\` },
  });
  if (!res.ok) throw new Error(\`HTTP \${res.status}\`);
  return (await res.json()) as UsageReport;
}`,
  },
]);

// =====================================================================
// 3. Settings.tsx - UsageSection: drop admin gate, conditional fetch,
//    hide per-user table for non-admin, retitle for non-admin.
// =====================================================================
applyEdits('apps/web/src/pages/Settings.tsx', [
  {
    label: '3a: import getMyUsageReport alongside getUsageReport',
    find: `  getUsageReport,`,
    replace: `  getUsageReport,
  getMyUsageReport,`,
  },
  {
    label: '3b: UsageSection fetches /me when non-admin, /admin when admin',
    find: `  useEffect(() => {
    const tok = sessionStorage.getItem('ace_token');
    if (!tok) return;
    setLoading(true);
    getUsageReport(tok, range)
      .then((r) => { setData(r); setError(null); })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [range]);

  if (me && !me.isAdmin) {
    return <div className="admin-empty"><ShieldCheck size={28} /><p><strong>Admin access required</strong></p></div>;
  }`,
    replace: `  useEffect(() => {
    const tok = sessionStorage.getItem('ace_token');
    if (!tok || !me) return;
    setLoading(true);
    // v0.10.181 — admins still see the fleet view via /admin/reports/usage;
    // non-admins see their OWN data via the new /me/reports/usage endpoint.
    const fetcher = me.isAdmin ? getUsageReport : getMyUsageReport;
    fetcher(tok, range)
      .then((r) => { setData(r); setError(null); })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [range, me]);

  // v0.10.181 — admin-only gate removed. Section now renders the
  // per-user view for non-admins (byUser table hidden; only the byDay
  // chart + the user's own row stats shown).`,
  },
  {
    label: '3c: retitle the section to "My Usage" for non-admins',
    find: `      <div className="liveops-header">
        <div>
          <h3 style={{ margin: 0 }}>Usage</h3>
          <p className="muted small" style={{ margin: '2px 0 0' }}>Per-user volume + talk time</p>
        </div>`,
    replace: `      <div className="liveops-header">
        <div>
          {/* v0.10.181 — admins see the fleet-wide Usage title; non-admins
              see "My Usage" since their view is their own data only. */}
          <h3 style={{ margin: 0 }}>{me?.isAdmin ? 'Usage' : 'My Usage'}</h3>
          <p className="muted small" style={{ margin: '2px 0 0' }}>
            {me?.isAdmin ? 'Per-user volume + talk time' : 'Your call + SMS volume and talk time'}
          </p>
        </div>`,
  },
  {
    label: '3d: hide the per-user table for non-admins (single-row would look weird)',
    find: `      <div className="liveops-section-title">Top users by call volume</div>
      <table className="presence-table">
        <thead>
          <tr><th>#</th><th>User</th><th>Total</th><th>In</th><th>Out</th><th>Missed</th><th>Talk time</th><th>SMS sent/recv</th></tr>
        </thead>
        <tbody>
          {data.byUser.slice(0, 25).map((u, i) => (
            <tr key={u.userId}>
              <td><span className="liveops-rank">{i + 1}</span></td>
              <td>
                <div>{u.name}</div>
                <div className="muted small">{u.email}</div>
              </td>
              <td><strong>{u.totalCalls}</strong></td>
              <td>{u.inbound}</td>
              <td>{u.outbound}</td>
              <td>{u.missed}</td>
              <td>{fmtTalk(u.talkSeconds)}</td>
              <td className="muted small">{u.smsSent} / {u.smsReceived}</td>
            </tr>
          ))}
          {data.byUser.length === 0 && <tr><td colSpan={8} className="muted" style={{ padding: '1rem', textAlign: 'center' }}>No activity in this range.</td></tr>}
        </tbody>
      </table>`,
    replace: `      {/* v0.10.181 — admin view shows the fleet-wide top users table;
          non-admin view hides it (a single-row table would just be the
          user's own activity summary, which is already visible from the
          per-day chart above). Non-admins instead see a compact
          summary card with their totals. */}
      {me?.isAdmin ? (
        <>
          <div className="liveops-section-title">Top users by call volume</div>
          <table className="presence-table">
            <thead>
              <tr><th>#</th><th>User</th><th>Total</th><th>In</th><th>Out</th><th>Missed</th><th>Talk time</th><th>SMS sent/recv</th></tr>
            </thead>
            <tbody>
              {data.byUser.slice(0, 25).map((u, i) => (
                <tr key={u.userId}>
                  <td><span className="liveops-rank">{i + 1}</span></td>
                  <td>
                    <div>{u.name}</div>
                    <div className="muted small">{u.email}</div>
                  </td>
                  <td><strong>{u.totalCalls}</strong></td>
                  <td>{u.inbound}</td>
                  <td>{u.outbound}</td>
                  <td>{u.missed}</td>
                  <td>{fmtTalk(u.talkSeconds)}</td>
                  <td className="muted small">{u.smsSent} / {u.smsReceived}</td>
                </tr>
              ))}
              {data.byUser.length === 0 && <tr><td colSpan={8} className="muted" style={{ padding: '1rem', textAlign: 'center' }}>No activity in this range.</td></tr>}
            </tbody>
          </table>
        </>
      ) : (
        <>
          <div className="liveops-section-title">Your totals</div>
          {(() => {
            const u = data.byUser[0];
            if (!u || u.totalCalls + u.smsSent + u.smsReceived === 0) {
              return <div className="muted" style={{ padding: '1rem' }}>No activity in this range.</div>;
            }
            return (
              <div className="my-usage-stat-grid">
                <div className="my-usage-stat-card">
                  <div className="my-usage-stat-label">Total calls</div>
                  <div className="my-usage-stat-value">{u.totalCalls}</div>
                </div>
                <div className="my-usage-stat-card">
                  <div className="my-usage-stat-label">Talk time</div>
                  <div className="my-usage-stat-value">{fmtTalk(u.talkSeconds)}</div>
                </div>
                <div className="my-usage-stat-card">
                  <div className="my-usage-stat-label">Inbound</div>
                  <div className="my-usage-stat-value">{u.inbound}</div>
                </div>
                <div className="my-usage-stat-card">
                  <div className="my-usage-stat-label">Outbound</div>
                  <div className="my-usage-stat-value">{u.outbound}</div>
                </div>
                <div className="my-usage-stat-card">
                  <div className="my-usage-stat-label">Missed</div>
                  <div className="my-usage-stat-value">{u.missed}</div>
                </div>
                <div className="my-usage-stat-card">
                  <div className="my-usage-stat-label">SMS sent</div>
                  <div className="my-usage-stat-value">{u.smsSent}</div>
                </div>
                <div className="my-usage-stat-card">
                  <div className="my-usage-stat-label">SMS received</div>
                  <div className="my-usage-stat-value">{u.smsReceived}</div>
                </div>
              </div>
            );
          })()}
        </>
      )}`,
  },
  {
    label: '3e: drop adminOnly:true from Usage SECTION_DEFS entry + update blurb',
    find: `  { key: 'usage', category: 'Reports', label: 'Usage', icon: TrendingUp, blurb: 'Per-user volume + talk time (admin only)', Component: UsageSection, adminOnly: true },`,
    replace: `  // v0.10.181 — Usage section now also available to non-admin users.
  // Personal view (their own activity) for non-admins; fleet view for admins.
  { key: 'usage', category: 'Reports', label: 'Usage', icon: TrendingUp, blurb: 'Your call + SMS volume and talk time', Component: UsageSection },`,
  },
]);

// =====================================================================
// 4. styles.css - new compact stat-grid for the non-admin Usage view
// =====================================================================
applyEdits('apps/web/src/styles.css', [
  {
    label: '4: append .my-usage-stat-grid + .my-usage-stat-card CSS after the v0.10.180 .tab block',
    find: `.tab.active { color: #007aff; }`,
    replace: `.tab.active { color: #007aff; }

/* v0.10.181 — Compact stat grid shown in the non-admin Usage view
   instead of the fleet-wide table. Auto-fit columns so the cards
   wrap to one row on wide windows and reflow to 2 columns on narrow
   ones. Pure CSS, no library. */
.my-usage-stat-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 10px;
  margin-top: 8px;
  margin-bottom: 12px;
}
.my-usage-stat-card {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 10px;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
[data-theme="light"] .my-usage-stat-card {
  background: #fff;
  border-color: rgba(0, 0, 0, 0.08);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.02);
}
.my-usage-stat-label {
  font-size: 0.75rem;
  color: var(--text-dim);
  font-weight: 500;
  letter-spacing: 0.01em;
}
.my-usage-stat-value {
  font-size: 1.4rem;
  font-weight: 700;
  color: var(--text);
  font-variant-numeric: tabular-nums;
  line-height: 1.1;
}`,
  },
]);

// =====================================================================
// 5. Version bumps 0.10.180 -> 0.10.181
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
  c = c.replace(/"version":\s*"0\.10\.180"/, '"version": "0.10.181"');
  if (c !== before) {
    writeFileSync(fp, c, 'utf8');
    console.log(`  OK ${rp}: bumped 0.10.180 -> 0.10.181`);
    bumped++;
  } else {
    console.warn(`  WARN ${rp}: no 0.10.180 anchor found (already bumped?)`);
  }
}
if (bumped === 0) {
  console.error('[apply-v181] FATAL: no package.json files bumped. Aborting.');
  process.exit(1);
}

applyEdits('apps/web/src/components/DiagnosticsSection.tsx', [
  {
    label: 'bump APP_VERSION',
    find: `const APP_VERSION = '0.10.180';`,
    replace: `const APP_VERSION = '0.10.181';`,
  },
]);

applyEdits('apps/web/src/data/whatsNew.ts', [
  {
    label: 'add v0.10.181 entry at top of WHATS_NEW array',
    find: `export const WHATS_NEW: ReleaseEntry[] = [
  {
    version: '0.10.180',`,
    replace: `export const WHATS_NEW: ReleaseEntry[] = [
  {
    version: '0.10.181',
    date: 'June 18, 2026',
    highlight: 'See your own call + SMS activity under Settings → Usage.',
    changes: [
      { type: 'new', text: 'Settings → Usage is no longer admin-only. Every user can now see their own calls (inbound / outbound / missed), talk time, and SMS sent/received — over the last 7, 30, or today range.' },
      { type: 'new', text: 'Per-day stacked chart visualizes when your activity peaked.' },
      { type: 'improved', text: 'Admins still see the original fleet-wide table (Top Users by Call Volume). Non-admins see a compact card grid of their own totals instead.' },
    ],
  },
  {
    version: '0.10.180',`,
  },
]);

console.log('\n[apply-v181] DONE');
console.log('');
console.log('NEXT:');
console.log('  npx tsc --noEmit -p apps/web/tsconfig.json');
console.log('  npx tsc --noEmit -p apps/api/tsconfig.json');
console.log('  git diff --stat');
console.log('  git add -A');
console.log('  git commit -m "v0.10.181: Personal Usage report (non-admin self-view)"');
console.log('  git tag v0.10.181');
console.log('  git push origin main');
console.log('  git push origin v0.10.181');
