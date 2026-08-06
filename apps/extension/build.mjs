// Bundles the extension. libphonenumber-js is bundled into the content script
// so detection is accurate on international numbers rather than regex-guessed
// — a wrong underline on an ATS page is what gets this feature switched off.
import { build } from 'esbuild';
import { cpSync, mkdirSync } from 'node:fs';

mkdirSync('dist/icons', { recursive: true });

await build({
  entryPoints: {
    content: 'src/content.ts',
    background: 'src/background.ts',
    options: 'src/options.ts',
  },
  outdir: 'dist',
  bundle: true,
  format: 'iife',
  target: 'chrome102',
  minify: true,
  legalComments: 'none',
});

for (const f of ['manifest.json', 'options.html', 'src/content.css']) {
  cpSync(f, `dist/${f.replace('src/', '')}`);
}
cpSync('icons', 'dist/icons', { recursive: true });
console.log('extension bundled → apps/extension/dist');
