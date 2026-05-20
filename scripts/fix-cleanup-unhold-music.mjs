// Fix sticky hold music: when cleanupCall promotes a HELD call back to
// active, it calls session.unhold() directly. For music-hold (no SIP hold
// was sent — we just swapped tracks), that's a no-op and leaves music on
// the outgoing sender. Use unholdCallWithMusicIfConfigured which handles
// both paths cleanly.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const file = resolve(here, '..', 'apps', 'web', 'src', 'services', 'sip.ts');
let text = readFileSync(file, 'utf8');
const nl = text.includes('\r\n') ? '\r\n' : '\n';

const oldBlock = [
  '      if (next) {',
  '        this.activeCallId = next.id;',
  '        try {',
  '          next.session.unhold();',
  '        } catch { /* noop */ }',
  '        next.heldLocal = false;',
  '        if (next.audioEl) {',
  '          this.primaryAudioEl.srcObject = next.audioEl.srcObject;',
  '        }',
  "        promotedEvent = this.buildEvent(next, 'connected');",
  "        console.log('[sip] promoted held call to active:', next.id);",
  '      }',
].join(nl);

const newBlock = [
  '      if (next) {',
  '        this.activeCallId = next.id;',
  '        // Bug fix: previously this called next.session.unhold() directly,',
  "        // which is a no-op for music-hold (we never sent a SIP hold —",
  '        // just swapped the outgoing track to the music stream). Result:',
  '        // music kept playing on the outgoing sender after promotion, and',
  '        // the user had to tap Hold/Resume 2-3 times before the mic was',
  '        // back. unholdCallWithMusicIfConfigured handles both paths:',
  '        // music-hold -> stopHoldMusic (restores fresh mic track);',
  '        // SIP-hold -> session.unhold().',
  '        void this.unholdCallWithMusicIfConfigured(next);',
  '        if (next.audioEl) {',
  '          this.primaryAudioEl.srcObject = next.audioEl.srcObject;',
  '        }',
  '        this.primaryAudioEl.muted = false;',
  "        promotedEvent = this.buildEvent(next, 'connected');",
  "        console.log('[sip] promoted held call to active:', next.id);",
  '      }',
].join(nl);

function count(haystack, needle) {
  let n = 0, i = 0;
  while ((i = haystack.indexOf(needle, i)) !== -1) { n++; i += needle.length; }
  return n;
}

const c = count(text, oldBlock);
if (c !== 1) {
  console.log(`ABORT: found ${c} matches of the old promote block, expected 1.`);
  process.exit(1);
}

text = text.replace(oldBlock, newBlock);
writeFileSync(file, text, 'utf8');
console.log('Patched sip.ts cleanupCall promote block. New line count:', text.split(nl).length);
