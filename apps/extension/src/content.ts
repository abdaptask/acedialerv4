// ACE Dialer — page scanner.
//
// Finds phone numbers in the page text, wraps them in a clickable chip, and
// on click hands the number to the desktop app (which prefills the dialer —
// it does not place the call).
//
// ── The rules this file has to respect ─────────────────────────────────
// It runs inside someone else's page, on an ATS a recruiter is actively
// working in. Breaking that page is a far worse outcome than missing a phone
// number, so:
//
//   * Never touch text inside <input>, <textarea>, or contenteditable.
//     Rewriting a form field the user is typing in would destroy their work.
//   * Never touch <script>, <style>, <code>, <pre>, or existing <a> tags.
//   * Never re-process our own output (infinite MutationObserver loop).
//   * Batch DOM writes and debounce the observer — an ATS re-renders
//     constantly, and a scanner that runs on every mutation will make the
//     page feel broken.
//   * Only ever wrap a text node in a span. No layout changes, no reordering,
//     nothing that can shift the page.
import { detectNumbers } from './detect';

const CHIP_CLASS = 'ace-dialer-chip';
const PROCESSED = 'data-ace-dialer-scanned';
/** Stop scanning a page that's pathologically large rather than hanging it. */
const MAX_NODES_PER_PASS = 4000;

const SKIP_TAGS = new Set([
  'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT', 'SELECT', 'OPTION',
  'CODE', 'PRE', 'KBD', 'SAMP', 'A', 'BUTTON', 'SVG', 'CANVAS', 'IFRAME',
]);

function shouldSkip(node: Node): boolean {
  let el: HTMLElement | null =
    node.nodeType === Node.ELEMENT_NODE
      ? (node as HTMLElement)
      : node.parentElement;
  while (el) {
    if (SKIP_TAGS.has(el.tagName)) return true;
    if (el.isContentEditable) return true;
    if (el.classList?.contains(CHIP_CLASS)) return true;
    el = el.parentElement;
  }
  return false;
}

function makeChip(text: string, dialString: string): HTMLElement {
  const a = document.createElement('span');
  a.className = CHIP_CLASS;
  a.setAttribute('role', 'button');
  a.setAttribute('tabindex', '0');
  a.title = 'Call with ACE Dialer';
  a.textContent = text;
  a.dataset.aceDial = dialString;
  return a;
}

/** Replace detected numbers inside one text node with chips. */
function processTextNode(node: Text): boolean {
  const text = node.nodeValue ?? '';
  if (text.length < 10 || !/\d/.test(text)) return false;

  const found = detectNumbers(text);
  if (found.length === 0) return false;

  const frag = document.createDocumentFragment();
  let cursor = 0;
  for (const hit of found) {
    if (hit.start > cursor) frag.appendChild(document.createTextNode(text.slice(cursor, hit.start)));
    frag.appendChild(makeChip(hit.raw, hit.dialString));
    cursor = hit.end;
  }
  if (cursor < text.length) frag.appendChild(document.createTextNode(text.slice(cursor)));

  node.parentNode?.replaceChild(frag, node);
  return true;
}

function scan(root: Node): void {
  if (shouldSkip(root)) return;

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(n) {
      if (!n.nodeValue || n.nodeValue.length < 10) return NodeFilter.FILTER_REJECT;
      if (shouldSkip(n)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  // Collect first, mutate after: replacing nodes while walking invalidates
  // the walker and silently skips half the page.
  const targets: Text[] = [];
  let n: Node | null;
  while ((n = walker.nextNode()) !== null) {
    targets.push(n as Text);
    if (targets.length >= MAX_NODES_PER_PASS) break;
  }
  for (const t of targets) {
    try {
      processTextNode(t);
    } catch {
      /* one bad node must never stop the pass */
    }
  }
}

function dial(el: HTMLElement): void {
  const value = el.dataset.aceDial;
  if (!value) return;
  el.classList.add('is-dialing');
  window.setTimeout(() => el.classList.remove('is-dialing'), 600);
  // The app validates again on its side and owns the error UI.
  chrome.runtime.sendMessage({ type: 'ace-dial', to: value });
}

document.addEventListener(
  'click',
  (e) => {
    const target = (e.target as HTMLElement | null)?.closest?.(`.${CHIP_CLASS}`);
    if (!target) return;
    e.preventDefault();
    e.stopPropagation();
    dial(target as HTMLElement);
  },
  true, // capture: some ATS pages swallow clicks on the bubble phase
);

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const target = (e.target as HTMLElement | null)?.closest?.(`.${CHIP_CLASS}`);
  if (!target) return;
  e.preventDefault();
  dial(target as HTMLElement);
});

// ── Initial pass + observing dynamic content ────────────────────────────
// A modern ATS renders results asynchronously, so a single pass at load time
// would find nothing. The observer is debounced because those pages mutate
// continuously; running a full scan per mutation would peg the CPU.
let pending = false;
let queued: Node[] = [];

function flush() {
  pending = false;
  const batch = queued;
  queued = [];
  for (const node of batch) {
    try {
      scan(node);
    } catch {
      /* keep going */
    }
  }
}

function schedule(node: Node) {
  queued.push(node);
  if (pending) return;
  pending = true;
  // requestIdleCallback keeps us off the critical path; the timeout stops us
  // waiting forever on a permanently busy page.
  const ric = (window as unknown as { requestIdleCallback?: typeof requestIdleCallback })
    .requestIdleCallback;
  if (ric) ric(flush, { timeout: 800 });
  else window.setTimeout(flush, 250);
}

function start() {
  if (document.documentElement.hasAttribute(PROCESSED)) return;
  document.documentElement.setAttribute(PROCESSED, '1');

  scan(document.body);

  new MutationObserver((records) => {
    for (const r of records) {
      for (const added of Array.from(r.addedNodes)) {
        if (added.nodeType === Node.ELEMENT_NODE || added.nodeType === Node.TEXT_NODE) {
          schedule(added);
        }
      }
    }
  }).observe(document.body, { childList: true, subtree: true });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start, { once: true });
} else {
  start();
}
