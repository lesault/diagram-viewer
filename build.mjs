// Concatenate src modules + vendored libs into one self-contained dist/viewer.html (no bundler).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const r = p => readFileSync(new URL(p, import.meta.url), 'utf8');
const order = ['xml', 'loader', 'model', 'graph', 'context', 'subset', 'render', 'router', 'tidy', 'diagnose', 'export'];
const strip = s => s.replace(/^import .*?;\s*$/gm, '').replace(/^export (async function|function|const|class)/gm, '$1');
const noClose = s => s.replace(/<\/script/gi, '<\\/script');   // keep inline <script> bodies intact

const vendor = ['pako_inflate.min.js', 'jszip.min.js', 'elk.bundled.js'].map(f => `/* ${f} */\n` + r('vendor/' + f)).join('\n;\n');
const sample = JSON.stringify(r(process.argv[2] || 'samples/security.drawio'));   // optional: node build.mjs path/to/other.drawio
const app = '(function(){"use strict";\n' + order.map(m => strip(r(`src/${m}.js`))).join('\n') + '\n' + strip(r('src/app.js')).replace("/*__SAMPLE__*/''", sample) + '\n})();';
const html = r('src/index.html')
  .replace('/*__CSS__*/', () => r('src/style.css'))
  .replace('/*__VENDOR__*/', () => noClose(vendor))
  .replace('/*__APP__*/', () => noClose(app));
mkdirSync(new URL('dist/', import.meta.url), { recursive: true });
writeFileSync(new URL('dist/viewer.html', import.meta.url), html);
console.log(`dist/viewer.html  ${(html.length / 1024).toFixed(0)} KB`);
