// v0.10.216 — Voice-to-text for the SMS composer.
//
// Record → stop → transcribe → the text is handed to the composer, which
// appends it at the caret. Cancel and re-record are available at every stage.
//
// ── The recording is never the message ─────────────────────────────────
// Audio exists only to produce text. It is not attached as an MMS, not
// uploaded to storage, and not persisted server-side — the transcribe endpoint
// streams the bytes to the speech provider and discards them. If audio
// messaging is ever wanted, that's a separate feature with its own storage and
// consent story.
//
// ── Mic safety ─────────────────────────────────────────────────────────
// The MediaRecorder lifecycle (including guaranteed track teardown on every
// exit path) lives in useMicRecorder — see its header for why that matters to
// call quality. This component only decides *when* recording is allowed, and
// it refuses while a call is up: two consumers competing for the microphone
// risks the active call's audio, which is a far worse outcome than making
// someone type a text.
import { useEffect, useRef, useState } from 'react';
import { Loader2, Mic, RotateCcw, Square, X } from 'lucide-react';

import { transcribeSmsVoice } from '../api';
import { useMicRecorder } from '../lib/useMicRecorder';

/** Long enough for a dictated SMS; short enough to bound upload size. */
const MAX_SECONDS = 60;

export default function SmsVoiceRecorder({
  onTranscript,
  onClose,
}: {
  /** Called with the transcript. The composer appends it at the caret. */
  onTranscript: (text: string) => void;
  onClose: () => void;
}) {
  const mic = useMicRecorder(MAX_SECONDS);
  const [transcribing, setTranscribing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Guards against double-submitting the same recording. */
  const sentRef = useRef(false);

  // Start recording as soon as the panel opens — the user already clicked the
  // microphone button, so making them click "record" again is a dead step.
  // This is also where the permission prompt fires: on an explicit action,
  // never at page load.
  useEffect(() => {
    void mic.start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When a recording lands, transcribe it immediately. The user asked for
  // text; an audio preview would just be a step between them and it.
  useEffect(() => {
    if (mic.state !== 'recorded' || !mic.recording || sentRef.current) return;
    sentRef.current = true;

    const token = sessionStorage.getItem('ace_token');
    if (!token) {
      setError('Your session expired. Sign in again.');
      return;
    }

    let cancelled = false;
    setTranscribing(true);
    setError(null);

    void transcribeSmsVoice(token, mic.recording.blob, mic.recording.mimeType)
      .then((res) => {
        if (cancelled) return;
        setTranscribing(false);
        if (res.ok && res.transcript) {
          onTranscript(res.transcript);
          onClose();
        } else {
          setError(res.error ?? "Couldn't transcribe that recording.");
        }
      })
      .catch(() => {
        if (cancelled) return;
        setTranscribing(false);
        setError('Transcription failed. Try again.');
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mic.state, mic.recording]);

  function redo() {
    sentRef.current = false;
    setError(null);
    mic.reset();
    void mic.start();
  }

  function close() {
    mic.cancel();
    onClose();
  }

  const micError = mic.error;
  const shownError = micError ?? error;
  const elapsedLabel = `${Math.floor(mic.elapsed / 60)}:${String(mic.elapsed % 60).padStart(2, '0')}`;

  return (
    <div className="sms-voice-panel" role="region" aria-label="Record a message">
      {shownError ? (
        <>
          <span className="sms-voice-error">{shownError}</span>
          <div className="sms-voice-actions">
            <button type="button" className="device-action" onClick={redo}>
              <RotateCcw size={14} style={{ verticalAlign: 'middle', marginRight: 4 }} />
              Try again
            </button>
            <button type="button" className="device-action" onClick={close}>
              Close
            </button>
          </div>
        </>
      ) : transcribing ? (
        <>
          <span className="sms-voice-status">
            <Loader2 size={14} className="sms-spin" />
            Transcribing…
          </span>
          {/* No cancel here: the request is already in flight and the result is
              a few hundred ms away. Offering a cancel that can't actually stop
              the work would be a lie. */}
        </>
      ) : mic.state === 'recording' ? (
        <>
          <span className="sms-voice-status is-recording">
            <span className="sms-voice-dot" aria-hidden="true" />
            Recording {elapsedLabel}
            <span className="muted small"> · {mic.secondsLeft}s left</span>
          </span>
          <div className="sms-voice-actions">
            <button type="button" className="device-action primary" onClick={mic.stop}>
              <Square size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} />
              Stop
            </button>
            <button type="button" className="device-action" onClick={close} aria-label="Cancel recording">
              <X size={14} />
            </button>
          </div>
        </>
      ) : (
        <>
          <span className="sms-voice-status">
            <Mic size={14} />
            Starting microphone…
          </span>
          <div className="sms-voice-actions">
            <button type="button" className="device-action" onClick={close}>
              Cancel
            </button>
          </div>
        </>
      )}
    </div>
  );
}
