// Settings → Help. Searchable, by-area troubleshooting reference.
//
// Content lives in data/helpCenter.ts so a wording fix or a new error message
// is a data edit, not a component change. Messages are quoted verbatim from
// the UI on purpose: users search by pasting or retyping what they saw, so a
// paraphrase would make the very entry they need unfindable.

import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { HELP_AREAS, type HelpTopic } from '../../data/helpCenter';
import './help.css';

function haystack(t: HelpTopic): string {
  return [
    t.title,
    t.summary,
    ...(t.keywords ?? []),
    ...(t.steps ?? []),
    ...t.issues.flatMap((i) => [i.message, i.meaning, i.fix ?? '']),
  ]
    .join(' \n ')
    .toLowerCase();
}

// Curly quotes in UI strings vs straight quotes typed into the box must not
// stop a match.
function fold(s: string): string {
  return s.toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/…/g, '...');
}

export default function HelpSection() {
  const [query, setQuery] = useState('');
  const [area, setArea] = useState<string | null>(null);

  const index = useMemo(
    () => HELP_AREAS.map((a) => ({ ...a, topics: a.topics.map((t) => ({ t, text: fold(haystack(t)) })) })),
    [],
  );

  const terms = fold(query).split(/\s+/).filter(Boolean);
  const searching = terms.length > 0;

  const visible = index
    .filter((a) => searching || !area || a.key === area)
    .map((a) => ({
      ...a,
      topics: a.topics.filter(({ text }) => terms.every((w) => text.includes(w))).map(({ t }) => t),
    }))
    .filter((a) => a.topics.length > 0);

  return (
    <div className="settings-section help-center">
      <p className="settings-blurb">
        What each part of the dialer does, and what its messages mean. Search
        for the words you saw on screen, or browse by area.
      </p>

      <div className="help-search">
        <Search size={15} aria-hidden />
        <input
          type="search"
          className="search-input"
          placeholder="Search, e.g. “mic unavailable” or “opted out”"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search help"
        />
      </div>

      {!searching && (
        <div className="help-areas" role="tablist" aria-label="Help areas">
          <button type="button" className={!area ? 'active' : ''} onClick={() => setArea(null)}>
            All
          </button>
          {HELP_AREAS.map((a) => (
            <button
              key={a.key}
              type="button"
              className={area === a.key ? 'active' : ''}
              onClick={() => setArea(a.key)}
            >
              {a.label}
            </button>
          ))}
        </div>
      )}

      {visible.length === 0 ? (
        <p className="muted help-empty">
          Nothing matches “{query}”. Try fewer words, or email{' '}
          <a href="mailto:support@aptask.com">support@aptask.com</a> with what you saw.
        </p>
      ) : (
        visible.map((a) => (
          <section key={a.key} className="help-area">
            <h3>{a.label}</h3>
            {a.topics.map((t) => (
              // Open every match while searching: the hit is usually inside an
              // issue row, and a collapsed card hides the reason it matched.
              <details key={t.id} className="help-topic" open={searching || undefined}>
                <summary>
                  <span className="help-topic-title">{t.title}</span>
                  <span className="help-topic-summary">{t.summary}</span>
                </summary>
                {t.steps && t.steps.length > 0 && (
                  <ul className="help-steps">
                    {t.steps.map((s, i) => <li key={i}>{s}</li>)}
                  </ul>
                )}
                {t.issues.length > 0 && (
                  <dl className="help-issues">
                    {t.issues.map((i, n) => (
                      <div key={n} className="help-issue">
                        <dt>{i.message}</dt>
                        <dd>
                          {i.meaning}
                          {i.fix && <span className="help-fix">{i.fix}</span>}
                        </dd>
                      </div>
                    ))}
                  </dl>
                )}
              </details>
            ))}
          </section>
        ))
      )}

      <p className="muted small help-footer">
        Still stuck? Go to Settings → Diagnostics, download the log, and email it to{' '}
        <a href="mailto:support@aptask.com">support@aptask.com</a> with the time it happened
        and the number involved.
      </p>
    </div>
  );
}
