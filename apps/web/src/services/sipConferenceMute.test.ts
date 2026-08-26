/**
 * Regression tests for conference self-mute.
 *
 * The bug: toggleMute() went through JsSIP's session.mute(), which sets
 * `sender.track.enabled = false`. During a conference the sender's track is
 * not the mic — it's the MIXED track (mic + every other participant). So one
 * press of Mute
 *   (a) silenced the whole mix on the active leg, and that participant
 *       stopped hearing the OTHER participant too, and
 *   (b) never touched the second leg's sender, leaving the user audible to
 *       them while the button read "Unmute".
 *
 * These tests drive the real startConference() / toggleMute() against a fake
 * Web Audio graph and assert the mic is the only thing self-mute moves.
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';

// ---- Fake Web Audio + media, installed before sip.ts is imported ----

type Edge = { from: string; to: string };

class FakeNode {
  constructor(public name: string, public graph: FakeCtx) {}
  connect(dest: FakeNode) {
    this.graph.edges.push({ from: this.name, to: dest.name });
    return dest;
  }
  disconnect(dest?: FakeNode) {
    this.graph.edges = this.graph.edges.filter(
      (e) => !(e.from === this.name && (dest ? e.to === dest.name : true)),
    );
  }
}

class FakeGain extends FakeNode {
  gain = {
    value: 1,
    setTargetAtTime(v: number) {
      (this as unknown as { value: number }).value = v;
    },
  };
}

class FakeDest extends FakeNode {
  stream = { getAudioTracks: () => [makeTrack(this.name)] };
}

let ctxSeq = 0;
class FakeCtx {
  edges: Edge[] = [];
  closed = false;
  currentTime = 0;
  destination = new FakeNode('speaker', this);
  private n = 0;
  constructor() {
    ctxSeq += 1;
  }
  createMediaStreamSource(s: { __label?: string; getAudioTracks?: () => { label: string }[] }) {
    const label = s.__label ?? s.getAudioTracks?.()[0]?.label ?? 'unknown';
    return new FakeNode(label, this);
  }
  createMediaStreamDestination() {
    this.n += 1;
    return new FakeDest(`dest${this.n}`, this);
  }
  createGain() {
    return new FakeGain('micGain', this);
  }
  resume() {
    return Promise.resolve();
  }
  close() {
    this.closed = true;
    return Promise.resolve();
  }
}

function makeTrack(label: string) {
  return { kind: 'audio', enabled: true, label, stop() {}, clone() { return makeTrack(label); } };
}

/** startConference() builds each leg's remote stream with `new MediaStream()`. */
class FakeMediaStream {
  tracks: { label: string; kind: string }[] = [];
  addTrack(t: { label: string; kind: string }) {
    this.tracks.push(t);
  }
  getAudioTracks() {
    return this.tracks.filter((t) => t.kind === 'audio');
  }
  getTracks() {
    return this.tracks;
  }
}

let liveCtx: FakeCtx | null = null;
function makeLeg(id: string, remoteLabel: string) {
  const sender = {
    track: makeTrack(`${id}-mic`),
    replaceTrack(t: unknown) {
      sender.track = t as ReturnType<typeof makeTrack>;
      return Promise.resolve();
    },
  };
  const counts = { mute: 0, unmute: 0, unhold: 0 };
  const state = { audioMuted: false };
  const pc = {
    getReceivers: () => [{ track: makeTrack(remoteLabel) }],
    getSenders: () => [sender],
  };
  const session = {
    connection: pc,
    isMuted: () => ({ audio: state.audioMuted }),
    mute: () => {
      state.audioMuted = true;
      sender.track.enabled = false;
      counts.mute += 1;
    },
    unmute: () => {
      state.audioMuted = false;
      sender.track.enabled = true;
      counts.unmute += 1;
    },
    unhold: () => {
      counts.unhold += 1;
    },
  };
  return { id, sender, counts, state, session };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let sipService: any;

before(async () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g = globalThis as any;
  g.AudioContext = FakeCtx;
  g.MediaStream = FakeMediaStream;
  g.window = {
    AudioContext: FakeCtx,
    addEventListener() {},
    removeEventListener() {},
  };
  g.document = {
    createElement: () => ({ play() {}, remove() {}, setSinkId() {}, muted: false }),
    addEventListener() {},
    body: { appendChild() {} },
  };
  g.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  g.navigator = {
    mediaDevices: {
      getUserMedia: () =>
        Promise.resolve({
          __label: 'mic',
          getAudioTracks: () => [makeTrack('mic')],
          getTracks: () => [makeTrack('mic')],
        }),
    },
  };
  ({ sipService } = await import('./sip.ts'));
});

/** Wire two live calls into the service and merge them. */
async function startTwoPartyConference() {
  const a = makeLeg('call-a', 'remoteA');
  const b = makeLeg('call-b', 'remoteB');
  sipService.calls.clear();
  for (const leg of [a, b]) {
    sipService.calls.set(leg.id, {
      id: leg.id,
      session: leg.session,
      direction: 'outbound',
      fromNumber: '+15550000000',
      toNumber: '+15551111111',
      destinationDisplay: leg.id,
      heldLocal: false,
      audioEl: null,
      startedAt: Date.now(),
    });
  }
  sipService.activeCallId = a.id;
  sipService.conferenceCtx = null;
  sipService.conferenceMicGain = null;
  sipService.conferenceSelfMuted = false;
  sipService.conferenceParticipants.clear();

  assert.equal(sipService.startConference(), true, 'startConference should report success');
  // The mic is acquired asynchronously; let the promise chain settle.
  await new Promise((r) => setTimeout(r, 0));
  liveCtx = sipService.conferenceCtx as FakeCtx;
  return { a, b };
}

test('conference graph routes the mic through a single gain node', async () => {
  await startTwoPartyConference();
  const edges = liveCtx!.edges;
  assert.ok(
    edges.some((e) => e.from === 'mic' && e.to === 'micGain'),
    'mic should feed the gain node',
  );
  const micGainOut = edges.filter((e) => e.from === 'micGain');
  assert.equal(micGainOut.length, 2, 'the gain node should feed both outgoing mixes');
  assert.ok(
    !edges.some((e) => e.from === 'mic' && e.to.startsWith('dest')),
    'the mic must not bypass the gain node',
  );
});

test('self-mute silences only the mic — participants still reach each other and the speaker', async () => {
  const { a, b } = await startTwoPartyConference();
  const before = [...liveCtx!.edges];

  const muted = sipService.toggleMute();
  assert.equal(muted, true, 'toggleMute should report muted');

  // The mic is gone from the mix...
  assert.equal(
    (sipService.conferenceMicGain as FakeGain).gain.value,
    0,
    'mic gain should be 0 while self-muted',
  );

  // ...and NOTHING else moved. This is the regression: the old code disabled
  // the mixed sender track, which took the other participant's relayed audio
  // down with it.
  const participantEdges = (es: Edge[]) => es.filter((e) => e.from.startsWith('remote'));
  assert.deepEqual(
    participantEdges(liveCtx!.edges),
    participantEdges(before),
    'no participant path may be disconnected by self-mute',
  );
  assert.ok(
    liveCtx!.edges.some((e) => e.from === 'remoteA' && e.to === 'speaker') &&
      liveCtx!.edges.some((e) => e.from === 'remoteB' && e.to === 'speaker'),
    'the user must still hear both participants',
  );

  // No SIP-layer mute, and both legs' mixed tracks stay enabled — a disabled
  // mixed track is exactly what silenced everyone for one participant.
  for (const leg of [a, b]) {
    assert.equal(leg.counts.mute, 0, `${leg.id}: session.mute() must not be used in conference`);
    assert.equal(leg.sender.track.enabled, true, `${leg.id}: mixed track must stay enabled`);
  }

  assert.equal(sipService.toggleMute(), false, 'toggling again unmutes');
  assert.equal((sipService.conferenceMicGain as FakeGain).gain.value, 1, 'mic gain restored');
});

test('a mute set before merging is carried into the conference', async () => {
  const a = makeLeg('call-a', 'remoteA');
  const b = makeLeg('call-b', 'remoteB');
  a.session.mute(); // user muted themselves on the 1:1 call, then hit Merge
  sipService.calls.clear();
  for (const leg of [a, b]) {
    sipService.calls.set(leg.id, {
      id: leg.id,
      session: leg.session,
      direction: 'outbound',
      fromNumber: '+15550000000',
      toNumber: '+15551111111',
      destinationDisplay: leg.id,
      heldLocal: false,
      audioEl: null,
      startedAt: Date.now(),
    });
  }
  sipService.activeCallId = a.id;
  sipService.conferenceCtx = null;
  sipService.conferenceParticipants.clear();
  sipService.startConference();
  await new Promise((r) => setTimeout(r, 0));

  assert.equal(sipService.isSelfMuted(), true, 'the user should still be muted after merging');
  assert.equal(
    (sipService.conferenceMicGain as FakeGain).gain.value,
    0,
    'the carried mute must reach the gain node',
  );
  // The SIP-layer flag has to be cleared, or JsSIP re-applies it on the next
  // re-INVITE and disables the MIXED track.
  assert.equal(a.state.audioMuted, false, 'stale session mute must be cleared at merge');
});

test('self-mute survives a participant dropping out of the conference', async () => {
  const { a, b } = await startTwoPartyConference();
  sipService.toggleMute();
  assert.equal(sipService.isSelfMuted(), true);

  // b drops; the conference tears down and a becomes a normal 1:1 call.
  sipService.calls.delete(b.id);
  sipService.stopConference();
  await new Promise((r) => setTimeout(r, 0));

  assert.equal(a.sender.track.enabled, false, 'restored mic track must stay muted');
  assert.equal(a.state.audioMuted, true, "JsSIP's own mute flag must be back in step");
  assert.equal(sipService.isSelfMuted(), true, 'the UI must still read as muted');
});

test('Mute pressed in the gap between Merge and the mic arriving still lands on the mic', async () => {
  const a = makeLeg('call-a', 'remoteA');
  const b = makeLeg('call-b', 'remoteB');
  sipService.calls.clear();
  for (const leg of [a, b]) {
    sipService.calls.set(leg.id, {
      id: leg.id,
      session: leg.session,
      direction: 'outbound',
      fromNumber: '+15550000000',
      toNumber: '+15551111111',
      destinationDisplay: leg.id,
      heldLocal: false,
      audioEl: null,
      startedAt: Date.now(),
    });
  }
  sipService.activeCallId = a.id;
  sipService.conferenceCtx = null;
  sipService.conferenceMicGain = null;
  sipService.conferenceSelfMuted = false;
  sipService.conferenceParticipants.clear();

  sipService.startConference();
  // getUserMedia has NOT resolved yet — the graph does not exist.
  assert.equal(sipService.conferenceMicGain, null, 'precondition: mic not wired yet');
  assert.equal(sipService.toggleMute(), true, 'mute in the gap should report muted');
  assert.equal(a.counts.mute, 0, 'must not fall back to session.mute() during the gap');

  await new Promise((r) => setTimeout(r, 0));
  assert.equal(
    (sipService.conferenceMicGain as FakeGain).gain.value,
    0,
    'the intent must be applied once the gain node exists',
  );
  assert.equal(a.sender.track.enabled, true, 'the mixed track must never be disabled');
});
