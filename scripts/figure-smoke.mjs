#!/usr/bin/env node
// figure:smoke — fast headless paint + structure QC for a catalog figure (or any
// manifold-js model). Runs <file.js> against the REAL engine in Node (no browser,
// no xvfb, ~2s) and reports the things model:preview's normal-shaded view CAN'T
// show: per-label PAINTABLE TRIANGLE COUNTS (a 0 = a buried/aliased-away feature
// that bakes as nothing — the trap that shipped eyeless figures), plus manifold /
// component / genus sanity.
//
//   npm run figure:smoke -- <file.js> [--require-labels eyes,iris,pupil] [-p k=v]
//
// With --require-labels it exits non-zero if any listed label resolves to 0
// paintable triangles — the headless twin of build-catalog-entry.cjs's gate, so
// authoring agents catch buried-eye paint failures in ~2s WITHOUT the ~75s xvfb
// colored bake. Closed-lid / closed-mouth figures legitimately paint 0 for those
// labels, so pass only the labels THIS figure must show.
//
// Note: `components` is the Node SSR count and can UNDER-report vs the browser
// bake for near-threshold thin features (the Node mesher bridges gaps the browser
// leaves open) — see CLAUDE.md. Trust it for paint resolution; verify component
// splits in the browser bake. See docs/headless-cli.md.
import { resolve } from 'node:path';
import { runPreview } from './cli/preview.mjs';
import { checkRequireLabels } from './cli/gates.mjs';

function coerce(s) { if (s === 'true') return true; if (s === 'false') return false; const n = Number(s); return Number.isNaN(n) ? s : n; }

function parseArgs(argv) {
  const a = { params: {}, file: null, lang: 'manifold-js', requireLabels: null };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === '--lang') a.lang = argv[++i];
    else if (t === '--require-labels') a.requireLabels = argv[++i];
    else if (t === '-p' || t === '--param') { const [k, ...v] = argv[++i].split('='); a.params[k] = coerce(v.join('=')); }
    else if (!a.file && !t.startsWith('-')) a.file = t;
  }
  return a;
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  if (!a.file) {
    console.error('Usage: npm run figure:smoke -- <file.js> [--require-labels eyes,iris,pupil] [--lang manifold-js] [-p k=v]');
    process.exit(2);
  }
  const result = await runPreview(resolve(a.file), { params: a.params, lang: a.lang });
  if (!result.ok) {
    console.error(`figure:smoke: model failed to run: ${result.error}`);
    process.exit(1);
  }

  const s = result.stats;
  const labels = Array.isArray(s.labels) ? s.labels : [];
  const zero = labels.filter((l) => l.triangleCount === 0).map((l) => l.name);

  console.log(`figure:smoke  ${a.file}`);
  console.log(`  manifold=${s.isManifold}  components=${s.componentCount}  genus=${s.genus}  tris=${s.triangleCount}`);
  if (!labels.length) {
    console.log('  labels: none declared');
  } else {
    console.log(`  labels (${labels.length}):`);
    for (const l of labels) {
      const flag = l.triangleCount === 0 ? '   ← 0 PAINTABLE TRIANGLES (buried/aliased)' : '';
      console.log(`    ${l.name}: ${l.triangleCount}${l.color ? '' : ' (no color)'}${flag}`);
    }
  }
  if (zero.length) console.log(`  ⚠ ${zero.length} label(s) paint nothing: ${zero.join(', ')}`);
  for (const w of (s.warnings || [])) console.log(`  • ${w}`);

  const reqErr = checkRequireLabels(s, a.requireLabels);
  if (reqErr) { console.error(`\n${reqErr}`); process.exit(1); }
  if (a.requireLabels) console.log(`  ✓ required labels all paint: ${a.requireLabels}`);
}

main().catch((e) => { console.error('figure:smoke failed:', e?.stack || e?.message || e); process.exit(1); });
