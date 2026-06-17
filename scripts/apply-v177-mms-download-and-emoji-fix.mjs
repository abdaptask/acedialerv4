#!/usr/bin/env node
// v0.10.177 - Two bundled improvements.
//
// 1. INBOUND/OUTBOUND MMS DOWNLOAD BUTTON
//    The existing MMS attachments render as <a target="_blank"><img/></a>,
//    so the only way to save an image is right-click in the new tab.
//    This adds a hover-revealed ↓ download icon overlaid on each image.
//    Click: fetch the URL as a Blob, create a temporary <a download>,
//    trigger click, revoke the object URL. Filename is derived from the
//    URL extension (defaults to .jpg). CORS-failure fallback opens the
//    URL in a new tab so users always have SOMETHING that works.
//    Clicking the image itself still opens in a new tab (preview-bigger
//    behavior preserved).
//
// 2. EMOJI PICKER POPOVER NO LONGER OVERFLOWS
//    The .emoji-picker-grid uses `repeat(12, 1fr)`. 1fr resolves to
//    minmax(auto, 1fr), so each emoji's content min-size (~38px) wins
//    over its 1/12 share of the 360px popover. Result: grid overflows
//    ~450px while the popover background stays at 360px, leaving 3
//    emojis per row floating outside. Fix: switch to
//    `repeat(8, minmax(0, 1fr))` — 24 emojis become 8 cols × 3 rows.
//
// VERSION BUMP: 0.10.176 -> 0.10.177

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
console.log(`[apply-v177] CWD: ${ROOT}`);

function applyEdits(relPath, edits) {
  const fp = join(ROOT, relPath);
  if (!existsSync(fp)) {
    console.error(`[apply-v177] FATAL: file not found: ${fp}`);
    process.exit(1);
  }
  let content = readFileSync(fp, 'utf8');
  const initialLen = content.length;
  const usesCRLF = content.includes('\r\n');
  const normalize = (s) => usesCRLF ? s.replace(/\r?\n/g, '\r\n') : s.replace(/\r\n/g, '\n');
  for (const [i, edit] of edits.entries()) {
    const find = normalize(edit.find);
    const replace = normalize(edit.replace);
    if (!content.includes(find)) {
      console.error(`[apply-v177] FATAL in ${relPath}: edit #${i+1} (${edit.label}) - anchor not found`);
      console.error(`  anchor (first 240 chars): ${JSON.stringify(find.slice(0, 240))}`);
      process.exit(1);
    }
    if (content.split(find).length - 1 > 1) {
      console.error(`[apply-v177] FATAL: duplicate match for edit #${i+1} (${edit.label}) in ${relPath}`);
      process.exit(1);
    }
    content = content.replace(find, replace);
    console.log(`  OK ${relPath} edit ${i+1}/${edits.length} (${edit.label})`);
  }
  writeFileSync(fp, content, 'utf8');
  console.log(`  ${relPath}: ${initialLen} -> ${content.length} bytes (${usesCRLF ? 'CRLF' : 'LF'})`);
}

// =====================================================================
// 1. Messages.tsx - add Download icon import + downloadMedia helper +
//    MMS image markup change.
// =====================================================================

// 1a. Add Download to the lucide-react import (placed right before
//     MessageSquare so the diff is minimal).
applyEdits('apps/web/src/pages/Messages.tsx', [
  {
    label: '1a: add Download icon import',
    find: `import { Send, ArrowLeft, RefreshCcw, MessageSquarePlus, Image as ImageIcon, Search, X, Zap, Phone, History, Star, Ban, Smile, FileText, Clock, Trash2, Pencil, MessageSquare, Voicemail as VoicemailIcon } from 'lucide-react';`,
    replace: `import { Send, ArrowLeft, RefreshCcw, MessageSquarePlus, Image as ImageIcon, Search, X, Zap, Phone, History, Star, Ban, Smile, FileText, Clock, Trash2, Pencil, MessageSquare, Voicemail as VoicemailIcon, Download } from 'lucide-react';`,
  },
]);

// 1b. Add downloadMedia helper. Place it right after the v0.10.176
//     initialsFromLabel helper so the helper cluster stays together.
applyEdits('apps/web/src/pages/Messages.tsx', [
  {
    label: '1b: add downloadMedia helper after initialsFromLabel',
    find: `// v0.10.176 — Initials from a contact label, used by the header avatar
// AND the small avatar that appears before the first bubble of each
// inbound run. Mirrors the helper used in Voicemail.tsx (v0.10.175).
function initialsFromLabel(label: string): string {
  const parts = label.trim().split(/\\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + (parts[parts.length - 1]![0] ?? '')).toUpperCase();
}`,
    replace: `// v0.10.176 — Initials from a contact label, used by the header avatar
// AND the small avatar that appears before the first bubble of each
// inbound run. Mirrors the helper used in Voicemail.tsx (v0.10.175).
function initialsFromLabel(label: string): string {
  const parts = label.trim().split(/\\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + (parts[parts.length - 1]![0] ?? '')).toUpperCase();
}

// v0.10.177 — Download an MMS attachment directly to disk instead of
// forcing the user to open it in a new tab and right-click → Save As.
// Implementation: fetch the URL with mode:'cors', read body as a Blob,
// create an object URL, programmatically click a temporary <a download>
// with that URL + a sensible filename, then revoke the object URL.
// If fetch rejects (CORS, network), fall back to window.open so users
// always get SOMETHING they can manually save from. \`baseFilename\`
// becomes 'baseFilename.ext' where the extension is sniffed from the
// URL path; falls back to .jpg.
async function downloadMedia(url: string, baseFilename: string): Promise<void> {
  const extMatch = url.match(/\\.(jpe?g|png|gif|webp|heic|mp4|mov|m4a|mp3|wav|webm|pdf)(?:\\?|$|#)/i);
  const ext = (extMatch?.[1] ?? 'jpg').toLowerCase();
  try {
    const res = await fetch(url, { mode: 'cors' });
    if (!res.ok) throw new Error(\`HTTP \${res.status}\`);
    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = \`\${baseFilename}.\${ext}\`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
  } catch {
    // CORS error or network failure — graceful degrade to opening the
    // URL in a new tab (the v0.10.176-and-prior behavior).
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}`,
  },
]);

// 1c. Replace the MMS image rendering with a positioned wrapper that
//     contains the existing link-image AND a hover-revealed download
//     button. Anchor lives inside the v0.10.176 grouped-bubble loop.
applyEdits('apps/web/src/pages/Messages.tsx', [
  {
    label: '1c: wrap MMS images with positioned container + download button overlay',
    find: `                        {m.mediaUrls?.length > 0 && (
                          <div className="bubble-media">
                            {m.mediaUrls.map((u, i) => (
                              <a key={i} href={u} target="_blank" rel="noreferrer">
                                <img src={u} alt="attachment" />
                              </a>
                            ))}
                          </div>
                        )}`,
    replace: `                        {m.mediaUrls?.length > 0 && (
                          <div className="bubble-media">
                            {m.mediaUrls.map((u, i) => (
                              <div key={i} className="bubble-media-item">
                                {/* v0.10.177 — image still opens larger in a
                                    new tab on click. Download ↓ button to the
                                    right handles the save-to-disk path so the
                                    user doesn't need to open + right-click. */}
                                <a
                                  href={u}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="bubble-media-link"
                                  title="Open full-size in new tab"
                                >
                                  <img src={u} alt="attachment" />
                                </a>
                                <button
                                  type="button"
                                  className="bubble-media-download"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    void downloadMedia(u, \`mms-\${m.id}-\${i + 1}\`);
                                  }}
                                  aria-label="Download attachment"
                                  title="Download"
                                >
                                  <Download size={14} />
                                </button>
                              </div>
                            ))}
                          </div>
                        )}`,
  },
]);

// =====================================================================
// 2. styles.css - emoji grid fix + new bubble-media-item CSS
// =====================================================================
applyEdits('apps/web/src/styles.css', [
  {
    label: '2a: emoji-picker-grid changes from 12 cols (overflowing) to 8 cols × 3 rows',
    find: `.emoji-picker-grid {
  display: grid;
  grid-template-columns: repeat(12, 1fr);
  gap: 4px;
}`,
    replace: `.emoji-picker-grid {
  /* v0.10.177 — was repeat(12, 1fr) which let each cell hit its
     content min-size (~38px) and overflow the 360px popover. With
     8 columns and minmax(0, 1fr) every cell shrinks to fit (24
     emojis become a 8 × 3 grid). */
  display: grid;
  grid-template-columns: repeat(8, minmax(0, 1fr));
  gap: 4px;
}`,
  },
  {
    label: '2b: append bubble-media-item + bubble-media-download CSS after the v0.10.176 send-btn block',
    find: `.compose-row .send-btn svg { transform: translateX(1px); /* nudge paper plane visually */ }`,
    replace: `.compose-row .send-btn svg { transform: translateX(1px); /* nudge paper plane visually */ }

/* v0.10.177 — MMS attachment download overlay.
   Each image bubble item is a positioned container holding the
   existing <a><img/></a> (still opens in a new tab on click) plus
   a small ↓ download button that appears on hover (and is always
   visible on touch devices via the no-hover media query). The
   button stops propagation so clicking it doesn't also trigger
   the parent link. */
.bubble-media-item {
  position: relative;
  display: inline-block;
  max-width: 100%;
}
.bubble-media-link {
  display: block;
  line-height: 0;
}
.bubble-media-link img {
  max-width: min(100%, 240px);
  border-radius: 10px;
  display: block;
}
.bubble-media-download {
  position: absolute;
  top: 6px;
  right: 6px;
  width: 28px;
  height: 28px;
  border-radius: 8px;
  background: rgba(15, 23, 42, 0.72);
  color: #fff;
  border: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  opacity: 0;
  transform: translateY(-2px);
  transition: opacity 0.12s ease, transform 0.12s ease, background 0.12s ease;
  padding: 0;
  backdrop-filter: blur(2px);
}
.bubble-media-item:hover .bubble-media-download,
.bubble-media-item:focus-within .bubble-media-download {
  opacity: 1;
  transform: translateY(0);
}
.bubble-media-download:hover {
  background: rgba(15, 23, 42, 0.92);
}
.bubble-media-download:focus-visible {
  outline: 2px solid #4f46e5;
  outline-offset: 2px;
}
/* Always-visible on touch devices (no hover support). */
@media (hover: none) {
  .bubble-media-download {
    opacity: 1;
    transform: translateY(0);
  }
}`,
  },
]);

console.log('  CSS additions + emoji fix done.');

// =====================================================================
// 3. Version bumps 0.10.176 -> 0.10.177
// =====================================================================
const PKGS = [
  'package.json',
  'apps/api/package.json',
  'apps/web/package.json',
  'apps/desktop/package.json',
  'apps/socket/package.json',
  'apps/webhooks/package.json',
  'packages/db/package.json',
];
let bumped = 0;
for (const rp of PKGS) {
  const fp = join(ROOT, rp);
  if (!existsSync(fp)) continue;
  let c = readFileSync(fp, 'utf8');
  const before = c;
  c = c.replace(/"version":\s*"0\.10\.176"/, '"version": "0.10.177"');
  if (c !== before) {
    writeFileSync(fp, c, 'utf8');
    console.log(`  OK ${rp}: bumped 0.10.176 -> 0.10.177`);
    bumped++;
  } else {
    console.warn(`  WARN ${rp}: no 0.10.176 anchor found (already bumped?)`);
  }
}
if (bumped === 0) {
  console.error('[apply-v177] FATAL: no package.json files bumped. Aborting.');
  process.exit(1);
}

applyEdits('apps/web/src/components/DiagnosticsSection.tsx', [
  {
    label: 'bump APP_VERSION',
    find: `const APP_VERSION = '0.10.176';`,
    replace: `const APP_VERSION = '0.10.177';`,
  },
]);

applyEdits('apps/web/src/data/whatsNew.ts', [
  {
    label: 'add v0.10.177 entry at top of WHATS_NEW array',
    find: `export const WHATS_NEW: ReleaseEntry[] = [
  {
    version: '0.10.176',`,
    replace: `export const WHATS_NEW: ReleaseEntry[] = [
  {
    version: '0.10.177',
    date: 'June 17, 2026',
    highlight: 'Download MMS images directly + emoji picker fits properly.',
    changes: [
      { type: 'new', text: 'Inbound (and outbound) MMS images now have a small ↓ download button overlaid on the top-right corner. Click it to save the image to disk — no more opening the image in a new tab and right-clicking to save.' },
      { type: 'improved', text: 'Clicking the image itself still opens the full-size version in a new tab, same as before. Only the new ↓ button triggers the download.' },
      { type: 'fixed', text: 'Emoji picker popover no longer has 3 emojis spilling out the right side. The grid is now 8 columns × 3 rows (was a 12-column grid that overflowed the popover background).' },
    ],
  },
  {
    version: '0.10.176',`,
  },
]);

console.log('\n[apply-v177] DONE');
console.log('');
console.log('NEXT:');
console.log('  npx tsc --noEmit -p apps/web/tsconfig.json');
console.log('  git diff --stat');
console.log('  git add -A');
console.log('  git commit -m "v0.10.177: MMS download button + emoji picker grid fix"');
console.log('  git tag v0.10.177');
console.log('  git push origin main');
console.log('  git push origin v0.10.177');
