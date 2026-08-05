// v0.10.216 — Shared microphone-recording engine.
//
// Extracted from the MicrophoneRecorder component in Settings.tsx (v0.10.100,
// voicemail greetings) so the SMS composer's voice-to-text can reuse it
// instead of growing a second MediaRecorder implementation.
//
// A hook rather than a shared component on purpose: the two surfaces need
// genuinely different interactions — the greeting page wants
// record → preview → save/discard, while the composer wants
// record → stop → transcribe with no audio preview at all — but they need
// *identical* handling of the parts that are easy to get wrong: codec
// selection across Chrome/Electron/Safari, the duration cap, permission
// error messages, and above all track teardown.
//
// ── Why teardown matters more here than in a normal component ──────────
// CLAUDE.md's first cross-cutting invariant is "no zombie media tracks":
// every getUserMedia stream must be stopped when its owner goes away, or
// subsequent calls degrade (echo, "tunnel voice", mic-acquire timeouts). A
// leaked recording stream is exactly that failure, and it would surface as a
// broken *call* long after the user forgot they dictated a text. So every
// exit path here — stop, cancel, cap reached, error, unmount — runs
// stopStream(), and that's the invariant to preserve if you edit this file.
import { useCallback, useEffect, useRef, useState } from 'react';

export type MicRecorderState = 'idle' | 'recording' | 'recorded';

export interface MicRecording {
  blob: Blob;
  /** The MediaRecorder mimeType actually used, e.g. "audio/webm;codecs=opus". */
  mimeType: string;
  /** Whole seconds captured, for display and audit. */
  seconds: number;
}

export interface UseMicRecorder {
  state: MicRecorderState;
  /** Seconds remaining before the cap stops the recording automatically. */
  secondsLeft: number;
  /** Seconds captured so far while recording. */
  elapsed: number;
  /** Present once state === 'recorded'. */
  recording: MicRecording | null;
  /** Object URL for the recording, or null. Revoked automatically. */
  previewUrl: string | null;
  error: string | null;
  start: () => Promise<void>;
  /** Stop and keep the audio (→ 'recorded'). */
  stop: () => void;
  /** Stop and throw the audio away (→ 'idle'). */
  cancel: () => void;
  /** Discard a finished recording and return to 'idle'. */
  reset: () => void;
}

/** MediaRecorder isn't available in every environment (older Safari, SSR). */
export function isRecordingSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.MediaRecorder !== 'undefined' &&
    Boolean(navigator.mediaDevices?.getUserMedia)
  );
}

/**
 * Pick a container/codec the browser will actually produce.
 * Chrome + Electron give WebM/Opus; Safari gives MP4/AAC. Deepgram ingests
 * both, so we just take the first supported option rather than transcoding.
 */
function pickMimeType(): string {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', ''];
  return candidates.find((m) => !m || MediaRecorder.isTypeSupported(m)) ?? '';
}

export function useMicRecorder(maxSeconds = 60): UseMicRecorder {
  const [state, setState] = useState<MicRecorderState>('idle');
  const [secondsLeft, setSecondsLeft] = useState(maxSeconds);
  const [elapsed, setElapsed] = useState(0);
  const [recording, setRecording] = useState<MicRecording | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const tickRef = useRef<number | null>(null);
  const startedAtRef = useRef<number>(0);
  /** Set when the user cancels, so onstop discards instead of publishing. */
  const discardRef = useRef(false);
  const urlRef = useRef<string | null>(null);

  const stopStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }, []);

  const clearTick = useCallback(() => {
    if (tickRef.current !== null) {
      window.clearInterval(tickRef.current);
      tickRef.current = null;
    }
  }, []);

  const revokeUrl = useCallback(() => {
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
    setPreviewUrl(null);
  }, []);

  // Unmount: tear down everything. Navigating away mid-recording must not
  // leave the mic held open — see the header note.
  useEffect(
    () => () => {
      discardRef.current = true;
      try {
        if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
      } catch {
        /* already stopped */
      }
      stopStream();
      clearTick();
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    },
    [stopStream, clearTick],
  );

  const start = useCallback(async () => {
    if (!isRecordingSupported()) {
      setError('Recording is not supported in this browser.');
      return;
    }
    setError(null);
    revokeUrl();
    setRecording(null);
    chunksRef.current = [];
    discardRef.current = false;

    let stream: MediaStream;
    try {
      // Permission is requested here — on an explicit user action — and never
      // at page load, which browsers flag as spammy (CLAUDE.md §25).
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      const msg = (e as Error)?.message ?? '';
      const name = (e as Error)?.name ?? '';
      setError(
        name === 'NotAllowedError' || /permission/i.test(msg)
          ? 'Microphone permission was denied. Check your browser or system settings.'
          : name === 'NotFoundError'
            ? 'No microphone was found.'
            : `Couldn't access the microphone: ${msg || name || 'unknown error'}`,
      );
      setState('idle');
      return;
    }

    streamRef.current = stream;

    try {
      const mimeType = pickMimeType();
      const mr = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recorderRef.current = mr;

      mr.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };

      mr.onstop = () => {
        clearTick();
        stopStream();
        const seconds = Math.max(1, Math.round((Date.now() - startedAtRef.current) / 1000));

        if (discardRef.current) {
          chunksRef.current = [];
          setState('idle');
          setElapsed(0);
          setSecondsLeft(maxSeconds);
          return;
        }

        const type = mr.mimeType || mimeType || 'audio/webm';
        const blob = new Blob(chunksRef.current, { type });
        chunksRef.current = [];

        if (blob.size === 0) {
          setError("The recording came back empty. Try again.");
          setState('idle');
          return;
        }

        const url = URL.createObjectURL(blob);
        urlRef.current = url;
        setPreviewUrl(url);
        setRecording({ blob, mimeType: type, seconds });
        setState('recorded');
      };

      startedAtRef.current = Date.now();
      mr.start();
      setState('recording');
      setSecondsLeft(maxSeconds);
      setElapsed(0);

      tickRef.current = window.setInterval(() => {
        setElapsed(Math.round((Date.now() - startedAtRef.current) / 1000));
        setSecondsLeft((s) => {
          if (s <= 1) {
            // Cap reached — stop and keep what we have.
            try {
              if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
            } catch {
              /* already stopped */
            }
            return 0;
          }
          return s - 1;
        });
      }, 1000);
    } catch (e) {
      // MediaRecorder construction can throw on an unsupported mimeType even
      // after isTypeSupported said otherwise (seen on some Linux Chromium
      // builds). Release the mic rather than holding it on a dead recorder.
      stopStream();
      clearTick();
      setError(`Couldn't start recording: ${(e as Error)?.message ?? 'unknown error'}`);
      setState('idle');
    }
  }, [maxSeconds, revokeUrl, stopStream, clearTick]);

  const stop = useCallback(() => {
    discardRef.current = false;
    try {
      if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
    } catch {
      /* already stopped */
    }
  }, []);

  const cancel = useCallback(() => {
    discardRef.current = true;
    try {
      if (recorderRef.current?.state === 'recording') {
        recorderRef.current.stop();
      } else {
        // Not recording (already stopped, or never started) — clean up directly
        // so a cancel from the 'recorded' state still releases everything.
        stopStream();
        clearTick();
        setState('idle');
      }
    } catch {
      stopStream();
      clearTick();
      setState('idle');
    }
    revokeUrl();
    setRecording(null);
    setError(null);
    setElapsed(0);
    setSecondsLeft(maxSeconds);
  }, [maxSeconds, revokeUrl, stopStream, clearTick]);

  const reset = useCallback(() => {
    revokeUrl();
    setRecording(null);
    setError(null);
    setState('idle');
    setElapsed(0);
    setSecondsLeft(maxSeconds);
  }, [maxSeconds, revokeUrl]);

  return {
    state,
    secondsLeft,
    elapsed,
    recording,
    previewUrl,
    error,
    start,
    stop,
    cancel,
    reset,
  };
}
