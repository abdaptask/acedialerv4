// Telnyx WebRTC service. Replaces the JsSIP-based implementation.
// Telnyx's SDK handles SDP munging, TURN credentials, codec negotiation, and DTLS-SRTP
// internally — all the things we were fighting manually with JsSIP.
import { TelnyxRTC } from '@telnyx/webrtc';

export type SipState = 'disconnected' | 'connecting' | 'registered' | 'failed';
export type CallState = 'idle' | 'calling' | 'ringing' | 'connected' | 'ended' | 'incoming';

export interface SipConfig {
  username: string;
  password: string;
  callerNumber?: string;
}

export interface CallEvent {
  state: CallState;
  number?: string;
  reason?: string;
  callId?: string;
  fromNumber?: string;
  toNumber?: string;
  direction?: 'inbound' | 'outbound';
  hangupCause?: string;
  /** Which slot this event belongs to. Omitted for the single-call flow. */
  line?: 'primary' | 'secondary';
}

type Listener<T = unknown> = (payload: T) => void;

function toE164(raw: string): string {
  const cleaned = raw.replace(/[^\d+]/g, '');
  if (cleaned.startsWith('+')) return cleaned;
  if (cleaned.length === 11 && cleaned.startsWith('1')) return `+${cleaned}`;
  if (cleaned.length === 10) return `+1${cleaned}`;
  return `+${cleaned}`;
}

function applySpeakerSelection(audioEl: HTMLAudioElement): void {
  const speakerId = localStorage.getItem('ace_speaker');
  if (!speakerId || speakerId === 'default') return;
  if (!('setSinkId' in audioEl)) return;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (audioEl as any).setSinkId(speakerId).catch((e: Error) => {
    // Stale device id (e.g. headset unplugged) silently routes audio nowhere.
    // Clear the bad selection so we fall back to the OS default sink on next
    // call, and unmute/restore the element just in case.
    console.warn('[sip] setSinkId failed; clearing stale ace_speaker', e.message);
    localStorage.removeItem('ace_speaker');
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (audioEl as any).setSinkId('').catch(() => { /* default sink */ });
    } catch { /* noop */ }
  });
}

function ensureAudioPlayback(audioEl: HTMLAudioElement): void {
  audioEl.muted = false;
  audioEl.volume = 1;
  // Some Electron / Chromium combos pause the element if it loses focus.
  // Kicking play() here is a no-op when already playing.
  audioEl.play().catch((e) => console.warn('[sip] audio play() rejected', e?.message ?? e));
}

function readMicId(): string | null {
  const m = localStorage.getItem('ace_mic');
  return m && m !== 'default' ? m : null;
}

function micAudioConstraint(): boolean | MediaTrackConstraints {
  const id = readMicId();
  return id ? { deviceId: { exact: id } } : true;
}

export class SipService {
  private client: TelnyxRTC | null = null;
  // The currently "active" call (the leg the user is talking to).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private currentCall: any = null;
  // A second outbound/in-progress call placed while currentCall is held.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private secondaryCall: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private incomingCall: any = null;
  /** When true, both lines have been bridged via Telnyx-side conference. */
  private conference = false;
  private callerNumber: string = '';
  private audioEl: HTMLAudioElement;
  private listeners: Map<string, Set<Listener>> = new Map();

  constructor() {
    // Reuse an existing element if one is already in the DOM (HMR re-imports
    // this module without re-rendering the body). Appending a duplicate with
    // the same id strands the SDK on the first (orphaned) element.
    const existing = document.getElementById('ace-remote-audio') as HTMLAudioElement | null;
    if (existing) {
      this.audioEl = existing;
    } else {
      this.audioEl = document.createElement('audio');
      this.audioEl.autoplay = true;
      this.audioEl.id = 'ace-remote-audio';
      document.body.appendChild(this.audioEl);
    }
    this.audioEl.muted = false;
    this.audioEl.volume = 1;
    applySpeakerSelection(this.audioEl);
  }

  // Attach the call's remote audio stream to our <audio> element. Handles
  // SDK-version differences (some expose `remoteStream`, others expose
  // `peer.remoteStreams[]` or surface tracks via the peerconnection). Also
  // ensures the element is unmuted and the sink id is current.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private attachRemoteAudio(call: any): void {
    if (!this.audioEl) return;
    const stream: MediaStream | undefined =
      call.remoteStream ||
      call.peer?.remoteStreams?.[0] ||
      call.options?.remoteStream;
    if (stream) {
      this.audioEl.srcObject = stream;
      const audioTracks = stream.getAudioTracks?.() ?? [];
      console.info('[sip] attached remote stream', {
        tracks: audioTracks.length,
        trackStates: audioTracks.map((t) => ({ enabled: t.enabled, muted: t.muted, readyState: t.readyState })),
      });
    } else {
      console.warn('[sip] active call has no remoteStream; relying on remoteElement auto-attach');
    }
    ensureAudioPlayback(this.audioEl);
    applySpeakerSelection(this.audioEl);
  }

  on<T = unknown>(event: string, handler: Listener<T>): () => void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(handler as Listener);
    return () => this.listeners.get(event)?.delete(handler as Listener);
  }

  private emit<T = unknown>(event: string, payload: T): void {
    this.listeners.get(event)?.forEach((h) => h(payload));
  }

  connect(config: SipConfig): void {
    if (this.client) this.disconnect();

    this.callerNumber = config.callerNumber ?? '';

    this.client = new TelnyxRTC({
      login: config.username,
      password: config.password,
    });

    this.client.on('telnyx.ready', () => {
      console.log('[sip] telnyx.ready');
      this.emit<SipState>('state', 'registered');
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.client.on('telnyx.error', (e: any) => {
      console.warn('[sip] telnyx.error', e);
      this.emit<SipState>('state', 'failed');
    });

    this.client.on('telnyx.socket.close', () => {
      console.log('[sip] socket closed');
      this.emit<SipState>('state', 'disconnected');
    });

    this.client.on('telnyx.socket.open', () => {
      console.log('[sip] socket open');
      this.emit<SipState>('state', 'connecting');
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.client.on('telnyx.notification', (notif: any) => {
      const call = notif.call;
      if (!call) return;

      console.log('[sip] call state', call.state, {
        id: call.id,
        rawDirection: call.direction,
        options: call.options,
        cause: call.cause,
        causeCode: call.causeCode,
        sipCode: call.sipCode,
        sipReason: call.sipReason,
      });

      // Robust direction detection. The Telnyx SDK's call.direction field
      // isn't always reliable (varies by version), so we also infer from:
      //   - call.options.remoteCallerNumber: set on inbound only by some SDK versions
      //   - whether we initiated the call (this.currentCall set in our call() method)
      //   - whether the call's destination matches OUR number (= someone dialed us)
      const sdkDir = String(call.direction ?? '').toLowerCase();
      const destNumber: string | undefined = call.options?.destinationNumber;
      const remoteCaller: string | undefined =
        call.options?.remoteCallerNumber ?? call.options?.callerNumber;
      const isPrimary = this.currentCall && this.currentCall.id === call.id;
      const isSecondary = this.secondaryCall && this.secondaryCall.id === call.id;
      const weInitiated = isPrimary || isSecondary;
      const line: 'primary' | 'secondary' = isSecondary ? 'secondary' : 'primary';

      let direction: 'inbound' | 'outbound';
      if (sdkDir === 'inbound' || sdkDir === 'incoming') {
        direction = 'inbound';
      } else if (sdkDir === 'outbound' || sdkDir === 'outgoing') {
        direction = 'outbound';
      } else if (weInitiated) {
        direction = 'outbound';
      } else if (destNumber && this.callerNumber && destNumber === this.callerNumber) {
        // Call destined to OUR number that we didn't initiate -> inbound.
        direction = 'inbound';
      } else if (remoteCaller && !weInitiated) {
        direction = 'inbound';
      } else {
        direction = 'outbound';
      }

      const fromNumber = direction === 'outbound' ? this.callerNumber : remoteCaller;
      const toNumber = direction === 'outbound' ? destNumber : this.callerNumber;

      const baseEvent: CallEvent = {
        state: 'idle',
        callId: call.id,
        fromNumber,
        toNumber,
        direction,
        number: direction === 'inbound' ? remoteCaller : destNumber,
        line,
      };

      // Route the call object into the appropriate slot. Secondary takes
      // precedence — if addCall() pre-set the secondary slot with this id, we
      // stay there. Otherwise the call goes into the primary slot.
      const writeSlot = () => {
        if (line === 'secondary') this.secondaryCall = call;
        else this.currentCall = call;
      };

      switch (call.state) {
        case 'new':
        case 'trying':
        case 'requesting':
          writeSlot();
          this.emit<CallEvent>('call', { ...baseEvent, state: 'calling' });
          break;
        case 'ringing':
        case 'early':
          if (direction === 'inbound') {
            // SDK tells us about a NEW incoming call. Hold it on the side,
            // don't promote to currentCall until the user accepts.
            this.incomingCall = call;
            this.emit<CallEvent>('call', { ...baseEvent, state: 'incoming' });
          } else {
            writeSlot();
            this.emit<CallEvent>('call', { ...baseEvent, state: 'ringing' });
          }
          break;
        case 'answering':
        case 'active':
          // For inbound, this is the moment the user (or auto-answer) picked up.
          // Promote the incomingCall to currentCall if applicable.
          if (this.incomingCall && this.incomingCall.id === call.id) {
            this.currentCall = this.incomingCall;
            this.incomingCall = null;
          } else {
            writeSlot();
          }
          this.emit<CallEvent>('call', { ...baseEvent, state: 'connected' });
          this.attachRemoteAudio(call);
          break;
        case 'held':
          // Telnyx SDK emits this when a call has been server-acknowledged as held.
          // Surface it as a state so the UI shows "Hold · mm:ss" honestly.
          this.emit<CallEvent>('call', { ...baseEvent, state: 'connected' });
          break;
        case 'hangup':
        case 'destroy':
        case 'purge':
          this.emit<CallEvent>('call', {
            ...baseEvent,
            state: 'ended',
            hangupCause: call.cause ?? call.sipReason ?? undefined,
          });
          if (this.incomingCall && this.incomingCall.id === call.id) {
            this.incomingCall = null;
          }
          if (this.currentCall && this.currentCall.id === call.id) {
            this.currentCall = null;
            // If a secondary line is still up, promote it to primary so it
            // becomes the focused line.
            if (this.secondaryCall) {
              this.currentCall = this.secondaryCall;
              this.secondaryCall = null;
            }
          } else if (this.secondaryCall && this.secondaryCall.id === call.id) {
            this.secondaryCall = null;
          }
          if (!this.currentCall && !this.secondaryCall) this.conference = false;
          break;
      }
    });

    this.emit<SipState>('state', 'connecting');
    this.client.connect();
  }

  call(rawNumber: string): void {
    if (!this.client) throw new Error('SIP not connected');
    const e164 = toE164(rawNumber);
    console.log('[sip] dialing', { rawNumber, e164, callerNumber: this.callerNumber });

    applySpeakerSelection(this.audioEl);
    ensureAudioPlayback(this.audioEl);

    this.currentCall = this.client.newCall({
      destinationNumber: e164,
      callerNumber: this.callerNumber,
      callerName: 'ACE Dialer',
      audio: micAudioConstraint(),
      video: false,
      remoteElement: 'ace-remote-audio',
    });
    this.emit<CallEvent>('call', {
      state: 'calling',
      number: e164,
      callId: this.currentCall?.id,
      fromNumber: this.callerNumber,
      toNumber: e164,
      direction: 'outbound',
      line: 'primary',
    });
  }

  /**
   * Place a SECOND call while the first is still up. The first call is put
   * on hold automatically and the new call becomes the active line.
   */
  addCall(rawNumber: string): void {
    if (!this.client) throw new Error('SIP not connected');
    if (!this.currentCall) {
      // Nothing to "add to" — just dial normally.
      return this.call(rawNumber);
    }
    if (this.secondaryCall) {
      console.warn('[sip] addCall: a secondary call is already active; ignoring');
      return;
    }
    const e164 = toE164(rawNumber);
    console.log('[sip] add-call dialing', { rawNumber, e164 });

    // Hold the current line before placing the new one.
    try {
      if (typeof this.currentCall.hold === 'function' && !this.currentCall.held) {
        this.currentCall.hold();
      }
    } catch (e) {
      console.warn('[sip] addCall: hold() on primary failed', e);
    }

    applySpeakerSelection(this.audioEl);
    ensureAudioPlayback(this.audioEl);

    this.secondaryCall = this.client.newCall({
      destinationNumber: e164,
      callerNumber: this.callerNumber,
      callerName: 'ACE Dialer',
      audio: micAudioConstraint(),
      video: false,
      remoteElement: 'ace-remote-audio',
    });
    this.emit<CallEvent>('call', {
      state: 'calling',
      number: e164,
      callId: this.secondaryCall?.id,
      fromNumber: this.callerNumber,
      toNumber: e164,
      direction: 'outbound',
      line: 'secondary',
    });
  }

  /** Returns true if a second line is active (held or connected). */
  hasSecondLine(): boolean {
    return !!this.secondaryCall;
  }

  /** Swap which line is on hold. */
  swapLines(): void {
    if (!this.currentCall || !this.secondaryCall) return;
    try {
      // The active one is the line that's NOT held.
      const primaryHeld = Boolean(this.currentCall.held);
      const secondaryHeld = Boolean(this.secondaryCall.held);
      if (!primaryHeld && typeof this.currentCall.hold === 'function') this.currentCall.hold();
      if (secondaryHeld && typeof this.secondaryCall.unhold === 'function') this.secondaryCall.unhold();
      // Swap the slot pointers so `currentCall` is always "the line user is talking to".
      const tmp = this.currentCall;
      this.currentCall = this.secondaryCall;
      this.secondaryCall = tmp;
      // Re-emit a synthetic state event so the UI repaints.
      this.emit<CallEvent>('call', {
        state: 'connected',
        callId: this.currentCall.id,
        fromNumber: this.callerNumber,
        toNumber: this.currentCall.options?.destinationNumber,
        direction: 'outbound',
        line: 'primary',
      });
    } catch (e) {
      console.warn('[sip] swapLines failed', e);
    }
  }

  /**
   * Merge two active legs into a 3-way conference. This requires backend
   * support: Telnyx's WebRTC SDK doesn't bridge calls client-side. The web
   * client just relays the request; the API server uses the Telnyx Voice
   * Call Control API to join both legs into a conference room.
   * Returns true if the request was accepted; false if not possible yet.
   */
  async mergeLines(token: string, apiBaseUrl: string): Promise<{ ok: boolean; reason?: string }> {
    if (!this.currentCall || !this.secondaryCall) {
      return { ok: false, reason: 'Need two active lines to merge' };
    }
    try {
      const res = await fetch(`${apiBaseUrl}/calls/conference`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          legA: this.currentCall.id,
          legB: this.secondaryCall.id,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        return { ok: false, reason: body.error ?? `HTTP ${res.status}` };
      }
      this.conference = true;
      this.emit<CallEvent>('call', {
        state: 'connected',
        callId: this.currentCall.id,
        direction: 'outbound',
        line: 'primary',
      });
      return { ok: true };
    } catch (e) {
      return { ok: false, reason: e instanceof Error ? e.message : 'merge request failed' };
    }
  }

  isConference(): boolean {
    return this.conference;
  }

  // Accept the currently ringing inbound call.
  acceptCall(): void {
    if (!this.incomingCall) {
      console.warn('[sip] acceptCall called but no incoming call');
      return;
    }
    applySpeakerSelection(this.audioEl);
    ensureAudioPlayback(this.audioEl);
    if (typeof this.incomingCall.answer === 'function') {
      // Pass mic constraint so inbound calls honor the user's selected mic too.
      try {
        this.incomingCall.answer({ audio: micAudioConstraint(), video: false });
      } catch {
        // Older SDKs may not accept options.
        this.incomingCall.answer();
      }
    } else {
      console.warn('[sip] incoming call has no answer() method');
    }
  }

  // Reject the currently ringing inbound call.
  declineCall(): void {
    if (!this.incomingCall) return;
    if (typeof this.incomingCall.hangup === 'function') {
      this.incomingCall.hangup();
    }
    this.incomingCall = null;
  }

  hangup(): void {
    if (this.currentCall && typeof this.currentCall.hangup === 'function') {
      this.currentCall.hangup();
    }
  }

  /** Hang up just the held / secondary line (leaves the active line up). */
  hangupSecondary(): void {
    if (this.secondaryCall && typeof this.secondaryCall.hangup === 'function') {
      this.secondaryCall.hangup();
    }
  }

  // Hold / unhold the active call. Returns true if call is now on hold.
  toggleHold(): boolean {
    if (!this.currentCall) return false;
    try {
      if (this.currentCall.held) {
        if (typeof this.currentCall.unhold === 'function') this.currentCall.unhold();
        return false;
      }
      if (typeof this.currentCall.hold === 'function') this.currentCall.hold();
      return true;
    } catch (e) {
      console.warn('[sip] hold/unhold failed', e);
      return Boolean(this.currentCall.held);
    }
  }

  isOnHold(): boolean {
    return Boolean(this.currentCall?.held);
  }

  // Blind-transfer to a destination number. Telnyx SDK exposes transfer(target).
  transfer(rawDestination: string): boolean {
    if (!this.currentCall) return false;
    if (typeof this.currentCall.transfer !== 'function') return false;
    try {
      const e164 = toE164(rawDestination);
      this.currentCall.transfer(e164);
      return true;
    } catch (e) {
      console.warn('[sip] transfer failed', e);
      return false;
    }
  }

  // Pick a different audio output device (speaker selection).
  async setAudioOutput(deviceId: string): Promise<void> {
    localStorage.setItem('ace_speaker', deviceId);
    if (!this.audioEl) return;
    if (!('setSinkId' in this.audioEl)) return;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (this.audioEl as any).setSinkId(deviceId);
    } catch (e) {
      console.warn('[sip] setSinkId failed', e);
    }
  }

  async listAudioOutputs(): Promise<MediaDeviceInfo[]> {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices.filter((d) => d.kind === 'audiooutput');
    } catch {
      return [];
    }
  }

  toggleMute(): boolean {
    if (!this.currentCall) return false;
    if (typeof this.currentCall.toggleAudioMute === 'function') {
      this.currentCall.toggleAudioMute();
      return Boolean(this.currentCall.audioMuted);
    }
    return false;
  }

  sendDTMF(digit: string): void {
    if (this.currentCall && typeof this.currentCall.dtmf === 'function') {
      this.currentCall.dtmf(digit);
    }
  }

  disconnect(): void {
    this.hangup();
    this.declineCall();
    this.client?.disconnect();
    this.client = null;
    this.currentCall = null;
    this.incomingCall = null;
  }
}

export const sipService = new SipService();
