// Bundles the extension. libphonenumber-js is bundled into the content script
// so detection is accurate on international numbers rather than regex-guessed
// — a wrong underline on an ATS page is what gets this feature switched off.
import { build } from 'esbuild';
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { crc32, deflateRawSync } from 'node:zlib';

// Start clean so a file deleted from src can't linger in dist (and the zip).
rmSync('dist', { recursive: true, force: true });
mkdirSync('dist/icons', { recursive: true });

await build({
  entryPoints: {
    content: 'src/content.ts',
    background: 'src/background.ts',
    options: 'src/options.ts',
    dialerBridge: 'src/dialerBridge.ts',
  },
  outdir: 'dist',
  bundle: true,
  format: 'iife',
  target: 'chrome102',
  minify: true,
  legalComments: 'none',
});

for (const f of ['manifest.json', 'managed_schema.json', 'options.html', 'src/content.css']) {
  cpSync(f, `dist/${f.replace('src/', '')}`);
}
cpSync('icons', 'dist/icons', { recursive: true });
// The Chrome Web Store upload. Kept OUTSIDE dist/ so "Load unpacked" on dist
// never contains its own archive.
const { version } = JSON.parse(readFileSync('manifest.json', 'utf8'));
mkdirSync('release', { recursive: true });
const zipPath = `release/ace-dialer-extension-${version}.zip`;
writeFileSync(zipPath, zip('dist'));
console.log(`extension bundled → apps/extension/dist, store upload → apps/extension/${zipPath}`);

/** Minimal deflate zip writer — enough for a store upload, no dependency. */
function zip(root) {
  const files = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else files.push(p);
    }
  };
  walk(root);

  const local = [];
  const central = [];
  let offset = 0;
  for (const p of files) {
    const name = Buffer.from(relative(root, p).split('\\').join('/'));
    const data = readFileSync(p);
    const packed = deflateRawSync(data, { level: 9 });
    const crc = crc32(data);
    // Fixed DOS date (1980-01-01) keeps the archive byte-identical across
    // rebuilds of the same source.
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(0x0800, 6); // UTF-8 names
    head.writeUInt16LE(8, 8); // deflate
    head.writeUInt16LE(0, 10);
    head.writeUInt16LE(0x21, 12);
    head.writeUInt32LE(crc, 14);
    head.writeUInt32LE(packed.length, 18);
    head.writeUInt32LE(data.length, 22);
    head.writeUInt16LE(name.length, 26);
    local.push(head, name, packed);

    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(20, 4);
    dir.writeUInt16LE(20, 6);
    dir.writeUInt16LE(0x0800, 8);
    dir.writeUInt16LE(8, 10);
    dir.writeUInt16LE(0, 12);
    dir.writeUInt16LE(0x21, 14);
    dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(packed.length, 20);
    dir.writeUInt32LE(data.length, 24);
    dir.writeUInt16LE(name.length, 28);
    dir.writeUInt32LE(offset, 42);
    central.push(dir, name);
    offset += head.length + name.length + packed.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, cd, end]);
}
