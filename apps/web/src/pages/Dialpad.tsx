import { useState, useCallback } from 'react';
import { Phone, Delete } from 'lucide-react';

const KEYS: Array<{ digit: string; letters?: string }> = [
  { digit: '1' },
  { digit: '2', letters: 'ABC' },
  { digit: '3', letters: 'DEF' },
  { digit: '4', letters: 'GHI' },
  { digit: '5', letters: 'JKL' },
  { digit: '6', letters: 'MNO' },
  { digit: '7', letters: 'PQRS' },
  { digit: '8', letters: 'TUV' },
  { digit: '9', letters: 'WXYZ' },
  { digit: '*' },
  { digit: '0', letters: '+' },
  { digit: '#' },
];

function formatNumber(raw: string): string {
  // Light US-style formatting; full libphonenumber comes when SIP wires up.
  const d = raw.replace(/[^\d*#+]/g, '');
  if (d.length === 0) return '';
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)} ${d.slice(3)}`;
  if (d.length <= 10) return `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}`;
  return `+${d.slice(0, d.length - 10)} ${d.slice(-10, -7)} ${d.slice(-7, -4)} ${d.slice(-4)}`;
}

export default function Dialpad() {
  const [number, setNumber] = useState('');

  const append = useCallback((d: string) => setNumber((n) => n + d), []);
  const backspace = useCallback(() => setNumber((n) => n.slice(0, -1)), []);
  const longPressZero = useCallback(() => setNumber((n) => n + '+'), []);

  const handleCall = useCallback(() => {
    if (!number) return;
    // Phase 4.5: replace this alert with the real SIP call.
    alert(`Placing call to ${number}\n\n(SIP wiring lands in Phase 4.5)`);
  }, [number]);

  return (
    <div className="dialpad">
      <div className="number-display" aria-live="polite">
        {formatNumber(number) || ' '}
      </div>

      <div className="keypad">
        {KEYS.map(({ digit, letters }) => (
          <button
            key={digit}
            type="button"
            className="keypad-btn"
            onClick={() => append(digit)}
            onContextMenu={(e) => {
              if (digit === '0') {
                e.preventDefault();
                longPressZero();
              }
            }}
          >
            <span className="digit">{digit}</span>
            {letters && <span className="letters">{letters}</span>}
          </button>
        ))}
      </div>

      <div className="call-row">
        <span />
        <button
          type="button"
          className="call-btn"
          onClick={handleCall}
          disabled={!number}
          aria-label="Call"
        >
          <Phone size={32} strokeWidth={2} fill="white" />
        </button>
        {number && (
          <button
            type="button"
            className="backspace-btn"
            onClick={backspace}
            aria-label="Delete"
          >
            <Delete size={26} />
          </button>
        )}
      </div>
    </div>
  );
}
