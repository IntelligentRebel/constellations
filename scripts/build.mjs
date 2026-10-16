// Bundles the game into a single self-contained HTML file (works offline by double-click).
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { deflateSync, strToU8 } from 'fflate';
import { rewrite, englishKeySet, SKIP_FILES } from './i18n-core.mjs';
const prod = process.argv.includes('--prod');

// i18n: the French texts listed in i18n/source.json are rewritten into lookups; each catalogue is compressed into
// the page (French needs none). LANGS=en,de limits the catalogues (quicker builds while testing).
const only = process.env.LANGS ? new Set(process.env.LANGS.split(',')) : null;
const known = new Set(fs.existsSync('i18n/source.json') ? JSON.parse(fs.readFileSync('i18n/source.json', 'utf8')).map(e => e.key) : []);
const catalogs = {};
for (const f of fs.existsSync('i18n') ? fs.readdirSync('i18n') : []) {
  const m = f.match(/^([a-z]{2})\.json$/);
  if (!m || (only && !only.has(m[1]))) continue;
  const cat = JSON.parse(fs.readFileSync(path.join('i18n', f), 'utf8'));
  catalogs[m[1]] = Buffer.from(deflateSync(strToU8(JSON.stringify(cat)), { level: 9 })).toString('base64');
}
const eng = known.size ? englishKeySet(process.cwd()) : new Set();
const i18nPlugin = {
  name: 'i18n',
  setup(b) {
    b.onLoad({ filter: /[\\/]src[\\/].*\.tsx?$/ }, async (args) => {
      const rel = path.relative(process.cwd(), args.path).split(path.sep).join('/');
      const src = await fs.promises.readFile(args.path, 'utf8');
      if (!known.size || SKIP_FILES.has(rel) || rel === 'src/i18n.ts') return { contents: src, loader: rel.endsWith('x') ? 'tsx' : 'ts' };
      return { contents: rewrite(src, rel, eng, known), loader: rel.endsWith('x') ? 'tsx' : 'ts' };
    });
  },
};
const res = await esbuild.build({
  entryPoints: ['src/ui/main.tsx'], bundle: true, write: false, outdir: 'dist', format: 'iife', target: 'es2020',
  jsx: 'automatic', jsxImportSource: 'preact', minify: prod, sourcemap: false, legalComments: 'none', logLevel: 'warning',
  define: { __VERSION__: JSON.stringify(JSON.parse(fs.readFileSync('package.json', 'utf8')).version), __I18N__: JSON.stringify(catalogs) },
  plugins: [i18nPlugin],
});
let js = '', css = '';
for (const f of res.outputFiles) { if (f.path.endsWith('.js')) js = f.text; else if (f.path.endsWith('.css')) css = f.text; }
const version = JSON.parse(fs.readFileSync('package.json', 'utf8')).version;
const FONTS = '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Chakra+Petch:wght@500;600;700&display=swap">';
const script = `<script>${js.replace(/<\/script/g, '<\\/script')}</script>`;
const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Constellations</title>
<meta name="description" content="Constellations ${version} : stratégie spatiale au tour par tour dans l'esprit de Stars!">
${FONTS}
<style>${css}</style>
</head>
<body>
<div id="app"></div>
${script}
</body>
</html>`;
// the playable file sits at the root of the project: double-click index.html
fs.writeFileSync('index.html', html);
fs.mkdirSync('dist', { recursive: true });
// Variant for the hosted artifact viewer: it supplies doctype/head/body itself.
const artifact = `<title>Constellations</title>
${FONTS}
<style>${css}</style>
<div id="app"></div>
${script}
`;
fs.writeFileSync('dist/artifact.html', artifact);
console.log('index.html', (html.length / 1024).toFixed(0), 'KB');
