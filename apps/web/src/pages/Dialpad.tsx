import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Phone, Delete } from 'lucide-react';
import { useSip } from '../contexts/SipContext';

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
  const d = raw.replace(/[^\d*#+]/g, '');
  if (d.length === 0) return '';
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)} ${d.slice(3)}`;
  if (d.length <= 10) return `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}`;
  return `+${d.slice(0, d.length - 10)} ${d.slice(-10, -7)} ${d.slice(-7, -4)} ${d.slice(-4)}`;
}

export default function Dialpad() {
  const [number, setNumber] = useState('');
  const { sipState, call } = useSip();
  const navigate = useNavigate();

  const append = useCallback((d: string) => setNumber((n) => n + d), []);
  const backspace = useCallback(() => setNumber((n) => n.slice(0, -1)), []);

  const handleCall = useCallback(() => {
    if (!number) return;
    if (sipState !== 'registered') {
      alert(`Can't call yet — SIP state: ${sipState}. Wait for "Registered" badge above keypad.`);
      return;
    }
    call(number);
    navigate('/in-call');
  }, [number, sipState, call, navigate]);

  const statusLabel =
    sipState === 'registered' ? 'Registered' :
    sipState === 'connecting' ? 'Connecting…' :
    sipState === 'failed' ? 'Connection failed' :
    'Disconnected';

  const statusClass =
    sipState === 'registered' ? 'sip-status ok' :
    sipState === 'failed' ? 'sip-status err' :
    'sip-status warn';

  return (
    <div className="dialpad">
      <div className={statusClass}>{statusLabel}</div>

      <div className="number-display" aria-live="polite">
        {formatNumber(number) || ' '}
      </div>

      <div className="keypad">
        {KEYS.map(({ digit, letters }) => (
          <button
            key={digit}
            type="button"
            className="keypad-btn"
            onClick={() => append(digit)}
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
          disabled={!number || sipState !== 'registered'}
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
