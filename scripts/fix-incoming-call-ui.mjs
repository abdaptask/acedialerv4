// Make the IncomingCall full-screen UI more usable when Hold & Accept is
// available: bigger buttons, visible labels under each (Decline / Hold &
// Accept / Accept), wider container so all three fit comfortably.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');

// --- 1. IncomingCall.tsx: add labels under each button -----------------------

const tsxFile = resolve(repoRoot, 'apps', 'web', 'src', 'components', 'IncomingCall.tsx');
let tsx = readFileSync(tsxFile, 'utf8');
const nl = tsx.includes('\r\n') ? '\r\n' : '\n';

const oldActions = [
  '        <div className="incoming-actions">',
  '          <button className="incoming-btn decline" onClick={declineCall} aria-label="Decline">',
  '            <PhoneOff size={28} />',
  '          </button>',
  '          {canHoldAndAccept && (',
  '            <button',
  '              className="incoming-btn hold-accept"',
  '              onClick={handleHoldAndAccept}',
  '              aria-label="Hold current call and accept"',
  '              title="Hold current call and accept"',
  '            >',
  '              <PhoneForwarded size={26} />',
  '              <span className="incoming-btn-sublabel">Hold &amp; Accept</span>',
  '            </button>',
  '          )}',
  '          <button className="incoming-btn accept" onClick={handleAccept} aria-label="Accept">',
  '            <Phone size={28} />',
  '          </button>',
  '        </div>',
].join(nl);

const newActions = [
  '        <div className="incoming-actions">',
  '          <div className="incoming-action-stack">',
  '            <button className="incoming-btn decline" onClick={declineCall} aria-label="Decline">',
  '              <PhoneOff size={32} />',
  '            </button>',
  '            <div className="incoming-action-label">Decline</div>',
  '          </div>',
  '          {canHoldAndAccept && (',
  '            <div className="incoming-action-stack">',
  '              <button',
  '                className="incoming-btn hold-accept"',
  '                onClick={handleHoldAndAccept}',
  '                aria-label="Hold current call and accept"',
  '                title="Hold current call and accept"',
  '              >',
  '                <PhoneForwarded size={30} />',
  '              </button>',
  '              <div className="incoming-action-label">Hold &amp; Accept</div>',
  '            </div>',
  '          )}',
  '          <div className="incoming-action-stack">',
  '            <button className="incoming-btn accept" onClick={handleAccept} aria-label="Accept">',
  '              <Phone size={32} />',
  '            </button>',
  '            <div className="incoming-action-label">Accept</div>',
  '          </div>',
  '        </div>',
].join(nl);

function count(haystack, needle) {
  let n = 0, i = 0;
  while ((i = haystack.indexOf(needle, i)) !== -1) { n++; i += needle.length; }
  return n;
}

const cActions = count(tsx, oldActions);
if (cActions !== 1) {
  console.log(`ABORT (IncomingCall.tsx actions): found ${cActions} matches, expected 1.`);
  process.exit(1);
}
tsx = tsx.replace(oldActions, newActions);
writeFileSync(tsxFile, tsx, 'utf8');
console.log('Patched IncomingCall.tsx (added action labels)');

// --- 2. styles.css: bigger buttons, container width, label styling ----------

const cssFile = resolve(repoRoot, 'apps', 'web', 'src', 'styles.css');
let css = readFileSync(cssFile, 'utf8');

const oldActionsCss = [
  '.incoming-actions {',
  '  display: flex;',
  '  justify-content: center;',
  '  align-items: flex-end;',
  '  gap: 36px;',
  '  padding: 0 24px;',
  '}',
].join(nl);

const newActionsCss = [
  '.incoming-actions {',
  '  display: flex;',
  '  justify-content: center;',
  '  align-items: flex-start;',
  '  gap: 28px;',
  '  padding: 0 16px;',
  '  width: 100%;',
  '  max-width: 480px;',
  '  margin: 0 auto;',
  '}',
  '.incoming-action-stack {',
  '  display: flex;',
  '  flex-direction: column;',
  '  align-items: center;',
  '  gap: 10px;',
  '  flex: 1;',
  '  min-width: 0;',
  '}',
  '.incoming-action-label {',
  '  font-size: 13px;',
  '  font-weight: 600;',
  '  color: #fff;',
  '  text-align: center;',
  '  letter-spacing: 0.02em;',
  '  white-space: nowrap;',
  '  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5);',
  '}',
  '[data-theme="light"] .incoming-action-label {',
  '  color: var(--text);',
  '  text-shadow: none;',
  '}',
].join(nl);

const cCssActions = count(css, oldActionsCss);
if (cCssActions !== 1) {
  console.log(`ABORT (styles.css actions): found ${cCssActions} matches, expected 1.`);
  process.exit(1);
}
css = css.replace(oldActionsCss, newActionsCss);

// Bump button sizes (was 72px, hold-accept 64px -> all 80px so they're uniform
// and readable; small variant stays at 40)
const oldBtnCss = [
  '.incoming-btn {',
  '  width: 72px;',
  '  height: 72px;',
  '  border-radius: 50%;',
  '  border: none;',
  '  display: flex;',
  '  align-items: center;',
  '  justify-content: center;',
  '  color: #fff;',
  '  cursor: pointer;',
  '  transition: transform 0.1s, box-shadow 0.1s;',
  '  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.3);',
  '}',
].join(nl);

const newBtnCss = [
  '.incoming-btn {',
  '  width: 80px;',
  '  height: 80px;',
  '  border-radius: 50%;',
  '  border: none;',
  '  display: flex;',
  '  align-items: center;',
  '  justify-content: center;',
  '  color: #fff;',
  '  cursor: pointer;',
  '  transition: transform 0.1s, box-shadow 0.1s;',
  '  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.3);',
  '  padding: 0;',
  '}',
].join(nl);

const cBtnCss = count(css, oldBtnCss);
if (cBtnCss !== 1) {
  console.log(`ABORT (styles.css .incoming-btn): found ${cBtnCss} matches, expected 1.`);
  process.exit(1);
}
css = css.replace(oldBtnCss, newBtnCss);

// Make hold-accept button uniform size (was 64px, special flex direction).
// With separate label rows, the button itself is just a circle like the others.
const oldHoldAcceptCss = [
  '/* "Hold & Accept" — shown only when a call is already in progress and',
  '   a second call rings in. Amber to distinguish from green accept and red',
  '   decline, and slightly smaller so the visual hierarchy stays:',
  '   Accept (primary, animated) > Hold & Accept (secondary) > Decline. */',
  '.incoming-btn.hold-accept {',
  '  background: #f59e0b;',
  '  width: 64px;',
  '  height: 64px;',
  '  position: relative;',
  '  flex-direction: column;',
  '  gap: 2px;',
  '  /* No pulse — the accept button already pulses; two pulsing buttons reads',
  '     as noisy. */',
  '}',
  '',
  '.incoming-btn.hold-accept.small {',
  '  width: 40px;',
  '  height: 40px;',
  '  flex-direction: row;',
  '}',
  '',
  '.incoming-btn-sublabel {',
  '  position: absolute;',
  '  bottom: -22px;',
  '  left: 50%;',
  '  transform: translateX(-50%);',
  '  color: #fff;',
  '  font-size: 11px;',
  '  font-weight: 600;',
  '  white-space: nowrap;',
  '  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.6);',
  '}',
].join(nl);

const newHoldAcceptCss = [
  '/* "Hold & Accept" — shown only when a call is already in progress and',
  '   a second call rings in. Amber to distinguish from green accept and red',
  '   decline. Same size as the others now that we have a sibling label. */',
  '.incoming-btn.hold-accept {',
  '  background: #f59e0b;',
  '  /* No pulse — the accept button already pulses; two pulsing buttons reads',
  '     as noisy. */',
  '}',
  '',
  '.incoming-btn.hold-accept.small {',
  '  width: 40px;',
  '  height: 40px;',
  '}',
  '',
  '.incoming-btn-sublabel { /* legacy — replaced by .incoming-action-label */',
  '  display: none;',
  '}',
].join(nl);

const cHoldAcceptCss = count(css, oldHoldAcceptCss);
if (cHoldAcceptCss !== 1) {
  console.log(`ABORT (styles.css .hold-accept): found ${cHoldAcceptCss} matches, expected 1.`);
  process.exit(1);
}
css = css.replace(oldHoldAcceptCss, newHoldAcceptCss);

writeFileSync(cssFile, css, 'utf8');
console.log('Patched styles.css (bigger buttons, action labels, wider container)');
console.log('');
console.log('Done. Verify:  git diff apps/web/src/components/IncomingCall.tsx apps/web/src/styles.css');
