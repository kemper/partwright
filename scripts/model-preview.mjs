#!/usr/bin/env node
// model:preview — headless preview of ONE manifold-js model snippet.
//
//   npm run model:preview -- <file.js> [--png <out.png>] [--json] [--size N]
//                              [-p key=value ...]
//
// Runs <file.js> against the REAL manifold-js engine in Node (via vite SSR —
// no dev server, no browser, ~1-2s), prints a rich JSON stat block to stdout,
// and writes a 4-view PNG (front / right / top / iso).
//
// This is a thin back-compat wrapper: the implementation now lives in
// scripts/cli/preview.mjs and is also exposed as `partwright preview`
// (bin/partwright.mjs). See docs/headless-cli.md.
import { resolve, dirname, basename, join } from 'node:path';
import { runPreview, composePng } from './cli/preview.mjs';

function parseArgs(argv) {
  const a = { params: {}, size: 480, json: false, png: null, file: null };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === '--json') a.json = true;
    else if (t === '--size') a.size = parseInt(argv[++i], 10);
    else if (t === '--png') a.png = argv[++i];
    else if (t === '-p' || t === '--param') { const [k, ...v] = argv[++i].split('='); a.params[k] = coerce(v.join('=')); }
    else if (!a.file && !t.startsWith('-')) a.file = t;
  }
  return a;
}
function coerce(s) { if (s === 'true') return true; if (s === 'false') return false; const n = Number(s); return Number.isNaN(n) ? s : n; }

async function main() {
  const a = parseArgs(process.argv.slice(2));
  if (!a.file) { console.error('Usage: npm run model:preview -- <file.js> [--png out.png] [--json] [--size N] [-p k=v]'); process.exit(2); }
  const file = resolve(a.file);
  const result = await runPreview(file, { params: a.params });

  if (!result.ok) {
    console.log(JSON.stringify({ ok: false, error: result.error, diagnostics: result.diagnostics }, null, 2));
    process.exit(1);
  }

  let pngPath = null;
  if (!a.json && result.render) {
    pngPath = a.png ? resolve(a.png) : join(dirname(file), basename(file).replace(/\.[^.]+$/, '') + '.preview.png');
    const img = composePng(result.render.positions, result.render.triVerts, result.render.triColors, result.render.bbox, a.size);
    await img.toFile(pngPath);
  }
  console.log(JSON.stringify({ ok: true, png: pngPath, stats: result.stats }, (_k, v) => (ArrayBuffer.isView(v) ? undefined : v), 2));
}
main().catch((e) => { console.error('model:preview failed:', e?.stack || e?.message || e); process.exit(1); });
