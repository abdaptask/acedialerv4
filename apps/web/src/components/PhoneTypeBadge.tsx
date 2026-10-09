// "(732) 555-1234 · Mobile" — the number-type annotation on the Dialpad and
// the in-call screen. Presentational only: it reads usePhoneType and renders;
// it has no handle on the call and must not be given one.
//
// The verified/inferred split is shown, not just told: a carrier-verified
// type carries the check-badge icon; an inferred one is plain, dimmer text.
// Both carry a tooltip naming the source, because "Mobile" from a numbering
// plan and "Mobile" from a carrier dip are different claims.
import { AlertCircle, BadgeCheck } from 'lucide-react';
import { usePhoneType } from '../hooks/usePhoneType';
import './PhoneTypeBadge.css';

interface Props {
  /** The raw number — dial-field text or E.164. */
  number: string | null | undefined;
  /** Optional formatted number to print before the type ("(732) … · Mobile"). */
  label?: string;
  className?: string;
}

export default function PhoneTypeBadge({ number, label, className }: Props) {
  const d = usePhoneType(number);
  if (d.state === 'hidden') {
    return label ? <span className={`phone-type ${className ?? ''}`}>{label}</span> : null;
  }

  const lead = label ? <span className="phone-type-number">{label}</span> : null;
  const sep = label ? <span className="phone-type-sep" aria-hidden="true">·</span> : null;

  if (d.state === 'invalid') {
    return (
      <span className={`phone-type is-invalid ${className ?? ''}`} role="status">
        {lead}
        {sep}
        <AlertCircle size={12} aria-hidden="true" />
        <span>{d.label}</span>
      </span>
    );
  }

  const checking = d.loading && d.lineType === 'unknown';
  const text = checking ? 'Checking…' : d.label;
  const sourceWord = d.source === 'verified' ? 'verified' : 'inferred from number format';
  return (
    <span
      className={`phone-type is-${d.source} ${d.lineType === 'unknown' ? 'is-unknown' : ''} ${className ?? ''}`}
      title={d.detail}
      // Screen readers get the source in words; the icon alone is visual.
      aria-label={`${label ? `${label}, ` : ''}${checking ? 'checking line type' : `${d.label}, ${sourceWord}`}`}
      role="status"
    >
      {lead}
      {sep}
      {d.source === 'verified' && <BadgeCheck size={13} aria-hidden="true" />}
      <span className={checking ? 'phone-type-checking' : undefined}>{text}</span>
    </span>
  );
}
