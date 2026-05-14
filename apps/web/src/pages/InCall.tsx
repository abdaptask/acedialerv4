import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PhoneOff, Mic, MicOff } from 'lucide-react';
import { useSip } from '../contexts/SipContext';

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function InCall() {
  const { callState, hangup, toggleMute } = useSip();
  const [duration, setDuration] = useState(0);
  const [muted, setMuted] = useState(false);
  const navigate = useNavigate();

  // Tick the duration once we're connected.
  useEffect(() => {
    if (callState.state !== 'connected') return;
    const id = setInterval(() => setDuration((d) => d + 1), 1000);
    return () => clearInterval(id);
  }, [callState.state]);

  // Auto-return to keypad after the call ends.
  useEffect(() => {
    if (callState.state === 'ended' || callState.state === 'idle') {
      const t = setTimeout(() => navigate('/keypad'), 1200);
      return () => clearTimeout(t);
    }
  }, [callState.state, navigate]);

  const subtitle =
    callState.state === 'calling' ? 'Calling…' :
    callState.state === 'ringing' ? 'Ringing…' :
    callState.state === 'connected' ? formatDuration(duration) :
    callState.state === 'ended' ? (callState.reason ? `Ended (${callState.reason})` : 'Ended') :
    '';

  return (
    <div className="in-call">
      <div className="in-call-number">{callState.number ?? ''}</div>
      <div className="in-call-status">{subtitle}</div>

      <div className="in-call-controls">
        <button
          type="button"
          className={`in-call-btn ${muted ? 'active' : ''}`}
          onClick={() => setMuted(toggleMute())}
          disabled={callState.state !== 'connected'}
          aria-label={muted ? 'Unmute' : 'Mute'}
        >
          {muted ? <MicOff size={26} /> : <Mic size={26} />}
          <span>{muted ? 'Unmute' : 'Mute'}</span>
        </button>
      </div>

      <button
        type="button"
        className="hangup-btn"
        onClick={hangup}
        aria-label="Hang up"
      >
        <PhoneOff size={32} />
      </button>
    </div>
  );
}
