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
  // v0.10.221 — remember the exact text this dial string was derived FROM, so
  // a click can verify the two still agree. See dial().
  a.dataset.aceRaw = text;
  return a;
}

/**
 * Replace our chips inside `scope` with the plain text they display.
 *
 * v0.10.221 — the scanner runs inside single-page ATS apps that re-render
 * constantly, and a chip is a `<span>` the framework doesn't know about. Once a
 * row re-renders, a chip left over from the previous render can still be
 * sitting in the DOM carrying the PREVIOUS candidate's number in its dataset —
 * which is a wrong-number call one click away. So instead of leaving chips
 * alone forever, any subtree that mutates gets its chips melted back to text
 * and rescanned from what the page now says.
 */
function unwrapChips(scope: Element): void {
  const chips = scope.querySelectorAll<HTMLElement>(`.${CHIP_CLASS}`);
  if (chips.length === 0) return;
  for (const chip of chips) {
    chip.replaceWith(document.createTextNode(chip.textContent ?? ''));
  }
  // Merge the text nodes we just left adjacent. Without this a number that had
  // been split across a chip boundary is invisible to the next pass, which
  // reads one node at a time.
  scope.normalize();
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

  // v0.10.221 — never hand over a number that disagrees with the text the user
  // is looking at.
  //
  // The dial string is computed at scan time and parked in a dataset attribute.
  // Everything else on the page can change underneath it: a virtualised table
  // recycles rows, a framework rewrites the text of a node it thinks it still
  // owns, a chip gets detached and re-inserted elsewhere. In any of those the
  // chip keeps rendering one number while carrying another — and the click
  // dials the one the user CAN'T see, which for a dialer is the worst possible
  // outcome. So the displayed text is authoritative: if it no longer matches
  // what we parsed, re-derive from what's on screen, and refuse outright when
  // that yields nothing.
  // A chip that's no longer in the document can't be what the user clicked on.
  if (!el.isConnected) return;

  const shown = el.textContent ?? '';
  let to = value;
  if (shown !== el.dataset.aceRaw) {
    const again = detectNumbers(shown);
    if (again.length !== 1) return; // ambiguous or unreadable — do nothing
    to = again[0].dialString;
    el.dataset.aceDial = to;
    el.dataset.aceRaw = shown;
  }

  el.classList.add('is-dialing');
  window.setTimeout(() => el.classList.remove('is-dialing'), 600);
  // The app validates again on its side and owns the error UI.
  chrome.runtime.sendMessage({ type: 'ace-dial', to });
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
let queued = new Set<Element>();
/** True while we're writing chips, so the observer ignores our own mutations
 *  instead of treating them as page changes and rescanning forever. */
let writing = false;
let observer: MutationObserver | null = null;

/** Drop any scope that already sits inside another queued scope — rescanning an
 *  ancestor covers its descendants, and an ATS re-render can easily queue a
 *  hundred nodes from the same table. Bounded search: with the cap below this
 *  is at worst a few thousand `contains` calls on already-live nodes. */
function outermost(scopes: Element[]): Element[] {
  return scopes.filter((s) => !scopes.some((other) => other !== s && other.contains(s)));
}

/** Upper bound on subtrees re-derived per idle tick. A page that mutates more
 *  than this in one frame is re-rendering wholesale; the next tick picks up
 *  whatever we dropped, and the alternative is competing with the ATS for the
 *  main thread. */
const MAX_SCOPES_PER_FLUSH = 64;

function flush() {
  pending = false;
  const batch = outermost([...queued]).slice(0, MAX_SCOPES_PER_FLUSH);
  queued = new Set();
  writing = true;
  try {
    for (const scope of batch) {
      // Skip a scope the page has since discarded.
      if (!scope.isConnected) continue;
      try {
        // v0.10.221 — melt our own chips first, then rescan. A chip that
        // survived a re-render can be showing one candidate's number while
        // holding another's; re-deriving from the page's current text is the
        // only way to be sure the two agree.
        unwrapChips(scope);
        scan(scope);
      } catch {
        /* keep going */
      }
    }
  } finally {
    // Discard the records our own writes generated before re-arming, or the
    // next callback re-queues everything we just touched.
    observer?.takeRecords();
    writing = false;
  }
}

/** The element whose subtree we'll re-derive. Text nodes can't be scoped on
 *  their own — we need a parent to query chips within. */
function scopeFor(node: Node): Element | null {
  if (node.nodeType === Node.ELEMENT_NODE) return node as Element;
  return node.parentElement;
}

function schedule(node: Node) {
  const scope = scopeFor(node);
  if (!scope || shouldSkip(scope)) return;
  queued.add(scope);
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

  writing = true;
  try {
    scan(document.body);
  } finally {
    writing = false;
  }

  observer = new MutationObserver((records) => {
    if (writing) return;
    for (const r of records) {
      // v0.10.221 — the MUTATED subtree, not just the added nodes. A framework
      // updating a row it already rendered shows up as a text change or a
      // sibling swap, and the chip that needs re-deriving is the one already
      // sitting in that subtree — never among addedNodes. Watching only
      // additions is what let a chip outlive the number it was made from.
      schedule(r.target);
      for (const added of Array.from(r.addedNodes)) {
        if (added.nodeType === Node.ELEMENT_NODE || added.nodeType === Node.TEXT_NODE) {
          schedule(added);
        }
      }
    }
  });
  // characterData included for the same reason: an in-place text update is the
  // most common way a stale chip is created, and it fires no childList records.
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start, { once: true });
} else {
  start();
}
