import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, NavLink, Navigate } from 'react-router-dom';
import {
  ArrowLeft,
  Mic,
  Volume2,
  Check,
  Play,
  RotateCcw,
  Phone,
  Eye,
  EyeOff,
  ChevronRight,
} from 'lucide-react';

interface AudioDevice {
  deviceId: string;
  label: string;
}

interface SectionDef {
  key: string;
  label: string;
  icon: typeof Mic;
  blurb: string;
  Component: React.FC;
}

const SECTIONS: SectionDef[] = [
  { key: 'telnyx', label: 'Telnyx', icon: Phone, blurb: 'SIP credentials', Component: TelnyxSection },
  { key: 'microphone', label: 'Microphone', icon: Mic, blurb: 'Input device', Component: MicrophoneSection },
  { key: 'speaker', label: 'Speaker', icon: Volume2, blurb: 'Output device', Component: SpeakerSection },
];

const DEFAULT_SECTION = SECTIONS[0].key;

export default function Settings() {
  const { section } = useParams<{ section?: string }>();
  const navigate = useNavigate();

  // Redirect /settings → /settings/<default>
  if (!section) return <Navigate to={`/settings/${DEFAULT_SECTION}`} replace />;
  const active = SECTIONS.find((s) => s.key === section);
  if (!active) return <Navigate to={`/settings/${DEFAULT_SECTION}`} replace />;
  const ActiveComponent = active.Component;

  return (
    <div className="settings settings-split">
      <aside className="settings-nav">
        <div className="settings-nav-header">
          <button
            onClick={() => navigate(-1)}
            className="settings-back"
            aria-label="Back"
          >
            <ArrowLeft size={20} />
          </button>
          <h1>Settings</h1>
        </div>
        <nav className="settings-nav-list">
          {SECTIONS.map((s) => (
            <NavLink
              key={s.key}
              to={`/settings/${s.key}`}
              className={({ isActive }) =>
                `settings-nav-item ${isActive ? 'active' : ''}`
              }
            >
              <span className="settings-nav-icon"><s.icon size={18} /></span>
              <span className="settings-nav-label">
                <span className="settings-nav-title">{s.label}</span>
                <span className="settings-nav-blurb">{s.blurb}</span>
              </span>
              <ChevronRight size={14} className="settings-nav-chev" />
            </NavLink>
          ))}
        </nav>
      </aside>

      <main className="settings-pane">
        <header className="settings-pane-header">
          <span className="settings-pane-icon"><active.icon size={20} /></span>
          <h2>{active.label}</h2>
        </header>
        <div className="settings-pane-body">
          <ActiveComponent />
        </div>
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Telnyx credentials section
// ---------------------------------------------------------------------------
function TelnyxSection() {
  const [username, setUsername] = useState(() => localStorage.getItem('ace_sip_username') ?? '');
  const [password, setPassword] = useState(() => localStorage.getItem('ace_sip_password') ?? '');
  const [fromNumber, setFromNumber] = useState(() => localStorage.getItem('ace_sip_from_number') ?? '');
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);

  function save() {
    if (username) localStorage.setItem('ace_sip_username', username);
    else localStorage.removeItem('ace_sip_username');
    if (password) localStorage.setItem('ace_sip_password', password);
    else localStorage.removeItem('ace_sip_password');
    if (fromNumber) localStorage.setItem('ace_sip_from_number', fromNumber);
    else localStorage.removeItem('ace_sip_from_number');
    setSaving(true);
    setTimeout(() => window.location.reload(), 400);
  }

  function clearAll() {
    localStorage.removeItem('ace_sip_username');
    localStorage.removeItem('ace_sip_password');
    localStorage.removeItem('ace_sip_from_number');
    setUsername('');
    setPassword('');
    setFromNumber('');
  }

  return (
    <div className="settings-section">
      <p className="settings-blurb">
        Telnyx SIP credential username + password for your WebRTC-enabled connection.
        Stored locally on this device only.
      </p>
      <div className="cred-grid">
        <label className="cred-field">
          <span>Username</span>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Telnyx SIP credential username"
            autoComplete="username"
          />
        </label>
        <label className="cred-field">
          <span>Password</span>
          <div className="cred-password">
            <input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Telnyx SIP credential password"
              autoComplete="new-password"
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              className="cred-eye"
            >
              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </label>
        <label className="cred-field">
          <span>From number (E.164)</span>
          <input
            type="tel"
            value={fromNumber}
            onChange={(e) => setFromNumber(e.target.value)}
            placeholder="+15555550100"
          />
        </label>
      </div>
      <div className="device-actions">
        <button
          type="button"
          className="device-action primary"
          onClick={save}
          disabled={!username || !password || saving}
        >
          {saving ? 'Reconnecting…' : 'Save & reconnect'}
        </button>
        {(username || password || fromNumber) && (
          <button type="button" className="device-action" onClick={clearAll}>
            Clear
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Microphone section
// ---------------------------------------------------------------------------
function MicrophoneSection() {
  const [mics, setMics] = useState<AudioDevice[]>([]);
  const [selected, setSelected] = useState<string>(localStorage.getItem('ace_mic') || 'default');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((stream) => {
        stream.getTracks().forEach((t) => t.stop());
        return navigator.mediaDevices.enumerateDevices();
      })
      .then((devices) => {
        setMics(
          devices
            .filter((d) => d.kind === 'audioinput')
            .map((d) => ({ deviceId: d.deviceId, label: d.label || 'Microphone' })),
        );
      })
      .catch((e) => setError(e?.message ?? 'Mic access denied'));
  }, []);

  function pick(id: string) {
    setSelected(id);
    if (id === 'default') localStorage.removeItem('ace_mic');
    else localStorage.setItem('ace_mic', id);
  }

  return (
    <div className="settings-section">
      <p className="settings-blurb">Choose which microphone the dialer uses for outgoing audio.</p>
      {error && <div className="error">{error}</div>}
      <DeviceList
        devices={[{ deviceId: 'default', label: 'System default' }, ...mics]}
        selected={selected}
        onPick={pick}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Speaker section
// ---------------------------------------------------------------------------
function SpeakerSection() {
  const [speakers, setSpeakers] = useState<AudioDevice[]>([]);
  const [selected, setSelected] = useState<string>(localStorage.getItem('ace_speaker') || 'default');
  const [error, setError] = useState<string | null>(null);
  const [supportsSinkId, setSupportsSinkId] = useState(true);
  const audioCtxRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    setSupportsSinkId('setSinkId' in HTMLMediaElement.prototype);
    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((stream) => {
        stream.getTracks().forEach((t) => t.stop());
        return navigator.mediaDevices.enumerateDevices();
      })
      .then((devices) => {
        setSpeakers(
          devices
            .filter((d) => d.kind === 'audiooutput')
            .map((d) => ({ deviceId: d.deviceId, label: d.label || 'Speaker' })),
        );
      })
      .catch((e) => setError(e?.message ?? 'Mic access denied'));
  }, []);

  function pick(id: string) {
    setSelected(id);
    if (id === 'default' || !id) localStorage.removeItem('ace_speaker');
    else localStorage.setItem('ace_speaker', id);
    const audioEl = document.getElementById('ace-remote-audio') as HTMLAudioElement | null;
    if (audioEl && 'setSinkId' in audioEl) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (audioEl as any).setSinkId(id === 'default' ? '' : id).catch((e: Error) => setError(e.message));
    }
  }

  async function testSpeaker() {
    setError(null);
    try {
      const ctx = (audioCtxRef.current ??= new AudioContext());
      if (ctx.state === 'suspended') await ctx.resume();
      const dest = ctx.createMediaStreamDestination();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = 660;
      gain.gain.value = 0.06;
      osc.connect(gain).connect(dest);
      const audio = new Audio();
      audio.autoplay = true;
      audio.srcObject = dest.stream;
      if (selected && selected !== 'default' && 'setSinkId' in audio) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (audio as any).setSinkId(selected).catch((e: Error) => setError(`setSinkId: ${e.message}`));
      }
      osc.start();
      await audio.play();
      setTimeout(() => {
        osc.stop();
        audio.srcObject = null;
      }, 900);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Test playback failed');
    }
  }

  return (
    <div className="settings-section">
      <p className="settings-blurb">
        Choose which speaker the dialer routes incoming call audio to.
      </p>
      {!supportsSinkId && (
        <p className="muted small">Speaker selection not supported in this browser. Uses system default.</p>
      )}
      {error && <div className="error">{error}</div>}
      <DeviceList
        devices={[{ deviceId: 'default', label: 'System default' }, ...speakers]}
        selected={selected}
        onPick={pick}
        disabled={!supportsSinkId}
      />
      <div className="device-actions">
        <button type="button" className="device-action" onClick={testSpeaker}>
          <Play size={14} /> Test speaker
        </button>
        <button type="button" className="device-action" onClick={() => pick('default')}>
          <RotateCcw size={14} /> Use system default
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared device list
// ---------------------------------------------------------------------------
function DeviceList({
  devices,
  selected,
  onPick,
  disabled,
}: {
  devices: AudioDevice[];
  selected: string;
  onPick: (id: string) => void;
  disabled?: boolean;
}) {
  if (devices.length === 0) return <p className="muted">No devices found.</p>;
  return (
    <div className="device-list">
      {devices.map((d) => (
        <button
          key={d.deviceId}
          type="button"
          className={`device-row ${selected === d.deviceId ? 'selected' : ''}`}
          onClick={() => onPick(d.deviceId)}
          disabled={disabled}
        >
          <span className="device-label">{d.label}</span>
          {selected === d.deviceId && <Check size={18} />}
        </button>
      ))}
    </div>
  );
}
