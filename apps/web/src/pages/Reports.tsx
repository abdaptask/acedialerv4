// Reports — company-wide and per-person reporting.
//
// URL is the state: /reports/:tab?from=YYYY-MM-DD&to=YYYY-MM-DD&user=ID.
// That makes every view (a tab, a range, one person) a shareable link and
// keeps the browser Back button meaningful while drilling in and out.
//
// Admins see everyone and can open any person. Everyone else sees only
// their own report — the server enforces that; the UI just doesn't offer
// the picker.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { AlertTriangle, ChevronLeft, Download, RefreshCw } from 'lucide-react';
import { getReports, type User } from '../api';
import { TABS, csvFor, Person } from './reports/tabs';
import { DrillSheet, type DrillSpec } from './reports/parts';
import { ContactSearch, ContactSheet } from './reports/contact';
import {
  PRESETS, downloadCsv, fmtAgo, fmtRange, matchPreset, presetRange, todayEt, addDays, type PresetKey,
} from './reports/format';
import type { ReportsPayload } from './reports/types';
import './reports/reports.css';

const MAX_SPAN_DAYS = 92;

function spanDays(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;
}

export default function Reports({ user }: { user: User }) {
  const navigate = useNavigate();
  const { tab: tabParam } = useParams();
  const [search] = useSearchParams();
  const def = presetRange('30d');
  const from = search.get('from') ?? def.from;
  const to = search.get('to') ?? def.to;
  const userParam = search.get('user');
  const personId = user.isAdmin ? (userParam ? Number(userParam) : null) : user.id;
  const tabs = TABS.filter((t) => (!t.personOnly || personId != null) && (!t.teamOnly || personId == null) && (!t.adminOnly || user.isAdmin));
  const tab = tabs.find((t) => t.key === tabParam) ?? tabs[0];
  const TabView = tab.render;

  const [data, setData] = useState<ReportsPayload | null>(null);
  const [team, setTeam] = useState<ReportsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const [drill, setDrill] = useState<DrillSpec | null>(null);
  const [contact, setContact] = useState<string | null>(null);
  // A sheet belongs to the view it was opened from; any navigation closes it.
  useEffect(() => setDrill(null), [from, to, personId, tab.key]);
  const reqId = useRef(0);

  const go = useCallback(
    (next: { tab?: string; from?: string; to?: string; user?: number | null }) => {
      const qs = new URLSearchParams();
      qs.set('from', next.from ?? from);
      qs.set('to', next.to ?? to);
      const u = next.user === undefined ? (user.isAdmin ? personId : null) : next.user;
      if (u != null && user.isAdmin) qs.set('user', String(u));
      navigate(`/reports/${next.tab ?? tab.key}?${qs.toString()}`);
    },
    [from, to, personId, tab.key, navigate, user.isAdmin],
  );

  useEffect(() => {
    const token = sessionStorage.getItem('ace_token') ?? '';
    const id = ++reqId.current;
    setLoading(true);
    setError(null);
    const wantTeam = user.isAdmin && personId != null;
    Promise.all([
      getReports(token, { from, to, userId: personId }),
      // The team payload is only for the "team average" column; a failure
      // there shouldn't blank the person's own report.
      wantTeam ? getReports(token, { from, to }).catch(() => null) : Promise.resolve(null),
    ])
      .then(([d, t]) => {
        if (id !== reqId.current) return;
        setData(d);
        setTeam(t);
      })
      .catch((e: Error) => {
        if (id !== reqId.current) return;
        setError(e.message);
      })
      .finally(() => {
        if (id === reqId.current) setLoading(false);
      });
  }, [from, to, personId, user.isAdmin, nonce]);

  const nameOf = useMemo(() => {
    const m = new Map<number, string>();
    for (const u of team?.users ?? []) m.set(u.id, u.name);
    for (const u of data?.users ?? []) m.set(u.id, u.name);
    return (id: number) => m.get(id) ?? 'Unknown';
  }, [data, team]);

  const person = personId != null ? data?.people.find((p) => p.userId === personId) ?? null : null;
  const pickerUsers = team?.users ?? data?.users ?? [];

  const exportCsv = () => {
    if (!data) return;
    const stamp = `${from}_to_${to}`;
    const who = person ? `-${person.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}` : '';
    if (tab.key === 'activity' && data.callLog && data.textLog) {
      // Two files: calls and texts have different columns. Text files carry
      // records only — there is no message text in the payload to export.
      downloadCsv(`ace-calls${who}-${stamp}.csv`, ['When (UTC)', 'Direction', 'Number', 'Contact', 'Outcome', 'Talk seconds', 'Line'],
        data.callLog.calls.map((c) => [c.startedAt, c.direction === 'outbound' ? 'Dialled out' : 'Called in', c.number, c.name, c.outcomeLabel, c.talkSec, c.line]));
      downloadCsv(`ace-texts${who}-${stamp}.csv`, ['When (UTC)', 'Direction', 'Number', 'Contact', 'Type', 'Status', 'Failure reason', 'Billed parts'],
        data.textLog.messages.map((m) => [m.at, m.direction === 'outbound' ? 'Sent' : 'Received', m.number, m.name, m.hasMedia ? 'Picture' : 'Text', m.statusLabel, m.failReason, m.parts]));
      return;
    }
    if (tab.key === 'adoption') {
      const a = data.adoption;
      downloadCsv(`ace-adoption${who}-${stamp}.csv`, ['Person', 'Version', 'On latest', 'App', 'Last opened', 'Last sign-in', 'Features used'],
        a.people.map((x) => [nameOf(x.userId), x.appVersion, x.onLatest ? 'Yes' : 'No', x.platform, x.lastSeenAt, x.lastLoginAt, x.features.join(' ')]));
      return;
    }
    const rows = person ? [person] : data.people;
    const { header, rows: body } = csvFor(tab, rows);
    downloadCsv(`ace-${tab.csv.filename}${who}-${stamp}.csv`, header, body);
  };

  return (
    <div className="rp-root">
      <header className="rp-head">
        <div className="rp-head-title">
          {person && user.isAdmin ? (
            <button type="button" className="rp-crumb" onClick={() => go({ user: null, tab: tab.personOnly ? 'overview' : tab.key })}>
              <ChevronLeft size={16} /> Everyone
            </button>
          ) : (
            <div className="rp-eyebrow">{user.isAdmin ? 'Everyone' : 'Your numbers'}</div>
          )}
          {person ? (
            <div className="rp-person-head">
              <Person name={person.name} sub={person.email} />
            </div>
          ) : (
            <h1>Reports</h1>
          )}
          <p className="rp-range-line">
            {fmtRange(from, to)} · Eastern time
            {data && <> · compared with {fmtRange(data.range.prevFrom, data.range.prevTo)}</>}
          </p>
        </div>
        <div className="rp-controls">
          <ContactSearch isAdmin={user.isAdmin} onPick={setContact} />
          {user.isAdmin && pickerUsers.length > 0 && (
            <label className="rp-select">
              <span className="rp-sr">Person</span>
              <select
                id="rp-person"
                value={personId ?? ''}
                onChange={(e) => {
                  const next = e.target.value ? Number(e.target.value) : null;
                  go({ user: next, tab: next == null && tab.personOnly ? 'overview' : tab.key });
                }}
              >
                <option value="">Everyone</option>
                {pickerUsers.map((u) => (
                  <option key={u.id} value={u.id}>{u.name}{u.isActive ? '' : ' (deactivated)'}</option>
                ))}
              </select>
            </label>
          )}
          <button type="button" className="rp-btn" onClick={exportCsv} disabled={!data || !!tab.noCsv}>
            <Download size={15} /> Export CSV
          </button>
        </div>
      </header>

      <div className="rp-toolbar">
        <RangePicker from={from} to={to} onChange={(r) => go(r)} />
      </div>

      <nav className="rp-tabs" aria-label="Reports">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            className={t.key === tab.key ? 'active' : undefined}
            aria-current={t.key === tab.key ? 'page' : undefined}
            onClick={() => go({ tab: t.key })}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {error ? (
        <div className="rp-error" role="alert">
          <AlertTriangle size={18} />
          <div>
            <b>The report didn't load</b>
            <p>{error}</p>
          </div>
          <button type="button" className="rp-btn" onClick={() => setNonce((n) => n + 1)}>
            <RefreshCw size={15} /> Try again
          </button>
        </div>
      ) : !data ? (
        <Skeleton />
      ) : personId != null && !person ? (
        <div className="rp-error" role="alert">
          <AlertTriangle size={18} />
          <div><b>No report for this person</b><p>They may have been removed. Go back to everyone to pick someone else.</p></div>
        </div>
      ) : (
        <div className={`rp-body${loading ? ' rp-stale' : ''}`} aria-busy={loading}>
          {/* Rendered as a component, not called as a function: a tab with
              its own state (Numbers) would otherwise put its hooks on this
              page, and switching tabs changes the hook count (React #310). */}
          <TabView
            key={`${tab.key}-${personId ?? 'all'}`}
            data={data}
            team={team}
            person={person}
            open={(id) => go({ user: id })}
            nameOf={nameOf}
            drill={setDrill}
            openDay={(date) => go({ from: date, to: date })}
            openContact={setContact}
          />
          {drill && (
            <DrillSheet
              spec={drill}
              people={data.people}
              daily={data.daily}
              callLog={data.callLog}
              textLog={data.textLog}
              personName={person?.name ?? null}
              rangeLabel={fmtRange(from, to)}
              onClose={() => setDrill(null)}
              onOpenPerson={(id) => go({ user: id })}
              onOpenDay={(date) => go({ from: date, to: date })}
            />
          )}
          <footer className="rp-foot">
            <span>Updated {fmtAgo(data.generatedAt)}. Figures refresh every few minutes.</span>
            <span>Each call counts once, however many records the carrier sends. Message text is never shown.</span>
          </footer>
        </div>
      )}
      {contact && (
        <ContactSheet
          number={contact}
          isAdmin={user.isAdmin}
          onClose={() => setContact(null)}
          onOpenPerson={(id) => { setContact(null); go({ user: id }); }}
        />
      )}
    </div>
  );
}

function RangePicker({ from, to, onChange }: { from: string; to: string; onChange: (r: { from: string; to: string }) => void }) {
  const active = matchPreset(from, to);
  const [custom, setCustom] = useState(active === 'custom');
  const [draft, setDraft] = useState({ from, to });
  useEffect(() => setDraft({ from, to }), [from, to]);
  const today = todayEt();
  const span = spanDays(draft.from, draft.to);
  const problem = !draft.from || !draft.to
    ? 'Pick both dates.'
    : draft.from > draft.to
      ? 'The start date is after the end date.'
      : span > MAX_SPAN_DAYS
        ? `Pick ${MAX_SPAN_DAYS} days or fewer.`
        : null;

  const pick = (k: PresetKey) => {
    if (k === 'custom') { setCustom(true); return; }
    setCustom(false);
    onChange(presetRange(k));
  };

  return (
    <div className="rp-range">
      <div className="rp-seg" role="group" aria-label="Date range">
        {PRESETS.map((p) => (
          <button key={p.key} type="button" aria-pressed={!custom && active === p.key} onClick={() => pick(p.key)}>{p.label}</button>
        ))}
        <button type="button" aria-pressed={custom || active === 'custom'} onClick={() => pick('custom')}>Custom</button>
      </div>
      {(custom || active === 'custom') && (
        <form
          className="rp-custom"
          onSubmit={(e) => { e.preventDefault(); if (!problem) onChange(draft); }}
        >
          <label htmlFor="rp-from" className="rp-sr">From</label>
          <input id="rp-from" type="date" value={draft.from} max={today} min={addDays(today, -730)} onChange={(e) => setDraft((d) => ({ ...d, from: e.target.value }))} />
          <span aria-hidden="true">–</span>
          <label htmlFor="rp-to" className="rp-sr">To</label>
          <input id="rp-to" type="date" value={draft.to} max={today} min={addDays(today, -730)} onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value }))} />
          <button type="submit" className="rp-btn rp-btn-primary" disabled={!!problem || (draft.from === from && draft.to === to)}>Apply</button>
          {problem && <span className="rp-field-error">{problem}</span>}
        </form>
      )}
    </div>
  );
}

function Skeleton() {
  return (
    <div className="rp-body" aria-busy="true" aria-label="Loading report">
      <div className="rp-kpis rp-kpis-4">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="rp-kpi"><div className="rp-sk rp-sk-s" /><div className="rp-sk rp-sk-l" /><div className="rp-sk rp-sk-s" /></div>
        ))}
      </div>
      <div className="rp-grid">
        <section className="rp-panel rp-span-12"><div className="rp-sk rp-sk-s" /><div className="rp-sk rp-sk-chart" /></section>
      </div>
    </div>
  );
}
