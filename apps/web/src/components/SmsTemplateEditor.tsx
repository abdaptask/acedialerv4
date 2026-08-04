// v0.10.216 — Create/edit a personal SMS template.
//
// Mirrors the admin editor's layout (Settings.tsx → SmsTemplateEditModal) so
// the two feel like one feature, with three additions the admin one doesn't
// have: an "Insert field" picker, live client-side placeholder validation, and
// a preview resolved against the conversation you're in.
//
// Validation is duplicated here and on the server on purpose — the client copy
// exists to give an inline "did you mean {firstName}?" before the round-trip;
// the server copy is the one that's authoritative. If they ever disagree, the
// server wins and the save fails with its message.
import { useMemo, useRef, useState } from 'react';
import { ChevronDown, MessageSquare } from 'lucide-react';

import {
  createMySmsTemplate,
  updateMySmsTemplate,
  type SmsPlaceholder,
  type SmsTemplate,
  type SmsTemplateCategory,
} from '../api';
import { measureSms, formatSmsLength } from '../lib/smsSegments';
import { previewTemplateBody, type FillContext } from '../lib/smsPlaceholderFill';

/**
 * Mirror of the server's scanner (lib/smsPlaceholders.ts). Kept small and
 * deliberately conservative: it reports the same problems in the same order,
 * and anything it isn't sure about it lets through for the server to reject.
 */
function validateBody(
  body: string,
  registry: SmsPlaceholder[],
): { error: string | null } {
  const known = new Map(registry.map((p) => [p.key.toLowerCase(), p.key]));

  let i = 0;
  while (i < body.length) {
    const ch = body[i];
    if (ch === '}') return { error: 'Closing brace with no matching opening brace: }' };
    if (ch !== '{') {
      i += 1;
      continue;
    }
    const close = body.indexOf('}', i + 1);
    const nextOpen = body.indexOf('{', i + 1);
    if (close === -1) return { error: 'Opening brace is never closed' };
    if (nextOpen !== -1 && nextOpen < close) return { error: 'Braces cannot be nested' };

    const inner = body.slice(i + 1, close);
    if (inner.length === 0) return { error: 'Empty field name: {}' };
    if (/\s/.test(inner)) return { error: `Field names cannot contain spaces: {${inner}}` };
    if (!known.has(inner.toLowerCase())) {
      const suggestion = closestKey(inner, registry);
      return {
        error: suggestion
          ? `{${inner}} isn't a supported field — did you mean {${suggestion}}?`
          : `{${inner}} isn't a supported field.`,
      };
    }
    i = close + 1;
  }
  return { error: null };
}

function closestKey(raw: string, registry: SmsPlaceholder[]): string | undefined {
  const needle = raw.toLowerCase();
  let best: string | undefined;
  let bestScore = Infinity;
  for (const p of registry) {
    if (p.hidden) continue;
    const score = distance(needle, p.key.toLowerCase());
    if (score < bestScore) {
      bestScore = score;
      best = p.key;
    }
  }
  return bestScore <= 2 ? best : undefined;
}

function distance(a: string, b: string): number {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    const curr = [i];
    for (let j = 1; j <= b.length; j += 1) {
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = curr;
  }
  return prev[b.length];
}

export default function SmsTemplateEditor({
  template,
  categories,
  placeholders,
  fillContext,
  onClose,
  onSaved,
}: {
  /** Present when editing; absent when creating. */
  template?: SmsTemplate;
  categories: SmsTemplateCategory[];
  placeholders: SmsPlaceholder[];
  fillContext: FillContext;
  onClose: () => void;
  onSaved: (saved: SmsTemplate) => void;
}) {
  const [category, setCategory] = useState(template?.category ?? 'custom');
  const [name, setName] = useState(template?.name ?? '');
  const [body, setBody] = useState(template?.body ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [showFields, setShowFields] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const offered = useMemo(() => placeholders.filter((p) => !p.hidden), [placeholders]);
  const validation = useMemo(() => validateBody(body, placeholders), [body, placeholders]);
  const measure = useMemo(() => measureSms(body), [body]);
  const preview = useMemo(
    () => previewTemplateBody(body, fillContext, placeholders),
    [body, fillContext, placeholders],
  );

  const canSubmit =
    !submitting && category.trim() !== '' && name.trim() !== '' && body.trim() !== '' && !validation.error;

  /** Insert a token at the caret, keeping the cursor after it. */
  function insertField(token: string) {
    const el = bodyRef.current;
    if (!el) {
      setBody((b) => b + token);
      setShowFields(false);
      return;
    }
    const start = el.selectionStart ?? body.length;
    const end = el.selectionEnd ?? body.length;
    const next = body.slice(0, start) + token + body.slice(end);
    setBody(next);
    setShowFields(false);
    requestAnimationFrame(() => {
      el.focus();
      const caret = start + token.length;
      try {
        el.setSelectionRange(caret, caret);
      } catch {
        /* older browsers */
      }
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const token = sessionStorage.getItem('ace_token');
    if (!token || !canSubmit) return;

    setSubmitting(true);
    setServerError(null);
    const input = { category: category.trim(), name: name.trim(), body: body.trim() };
    const res = template
      ? await updateMySmsTemplate(token, template.id, input)
      : await createMySmsTemplate(token, input);
    setSubmitting(false);

    if (res.ok && res.template) {
      onSaved(res.template);
    } else {
      setServerError(res.error ?? 'Save failed');
    }
  }

  return (
    <div className="compose-modal" onClick={submitting ? undefined : onClose}>
      <div
        className="fav-modal sms-template-editor"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-labelledby="my-sms-tmpl-title"
        style={{ maxWidth: 640 }}
      >
        <div className="fav-modal-header">
          <MessageSquare size={18} className="fav-modal-icon" />
          <h3 id="my-sms-tmpl-title">{template ? 'Edit template' : 'New template'}</h3>
        </div>

        <form onSubmit={handleSubmit} autoComplete="off">
          <div className="fav-modal-row">
            <label className="fav-modal-field">
              <span className="fav-modal-label">Category</span>
              <select
                className="fav-modal-input"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                disabled={submitting}
                style={{ colorScheme: 'light dark' }}
              >
                {categories.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="fav-modal-field">
              <span className="fav-modal-label">Name</span>
              <input
                className="fav-modal-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Rate follow-up"
                maxLength={80}
                disabled={submitting}
              />
            </label>
          </div>

          <label className="fav-modal-field" style={{ marginTop: 12 }}>
            <span className="fav-modal-label">Message</span>
            <textarea
              ref={bodyRef}
              className="fav-modal-input"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={5}
              maxLength={1600}
              disabled={submitting}
              placeholder="Hi {firstName}, following up on the {role} role…"
            />
          </label>

          {/* Insert field — so nobody has to remember the exact spelling of a
              placeholder, which is what produced typo'd fields before. */}
          <div className="sms-field-inserter">
            <button
              type="button"
              className="device-action"
              onClick={() => setShowFields((v) => !v)}
              disabled={submitting}
              aria-expanded={showFields}
            >
              Insert field
              <ChevronDown size={14} style={{ verticalAlign: 'middle', marginLeft: 4 }} />
            </button>
            <span className="muted small">{formatSmsLength(measure)}</span>
          </div>

          {showFields && (
            <div className="sms-field-menu" role="menu">
              {offered.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  className="sms-field-menu-item"
                  onClick={() => insertField(p.token)}
                  role="menuitem"
                >
                  <code>{p.token}</code>
                  <span className="sms-field-menu-label">{p.label}</span>
                  {p.source !== 'manual' && (
                    <span className="sms-field-menu-auto">auto-fills</span>
                  )}
                </button>
              ))}
            </div>
          )}

          {validation.error && (
            <div className="error small" style={{ marginTop: 10 }}>
              {validation.error}
            </div>
          )}
          {serverError && !validation.error && (
            <div className="error small" style={{ marginTop: 10 }}>
              {serverError}
            </div>
          )}

          {body.trim() !== '' && !validation.error && (
            <div className="sms-template-preview">
              <div className="sms-template-preview-label">Preview</div>
              <div className="sms-template-preview-body">{preview}</div>
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
            <button type="button" className="device-action" onClick={onClose} disabled={submitting}>
              Cancel
            </button>
            <button type="submit" className="device-action primary" disabled={!canSubmit}>
              {submitting ? 'Saving…' : template ? 'Save changes' : 'Create template'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
