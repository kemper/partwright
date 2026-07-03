#!/usr/bin/env node
// eval.mjs — score a candidate JS snippet against a target STL.
//
// Usage:
//   node scripts/inverse-cad/eval.mjs <target.stl> <candidate.js>
//     [--out DIR]        write metrics.json + comparison.png here (default: .plans/inverse-cad/<target>/)
//     [--samples N]      sample points per mesh for Chamfer/Hausdorff (default 5000)
//     [--size N]         per-tile pixel size for the comparison PNG (default 384)
//     [--views a,b,...]  view names to render (default front,right,top,iso)
//     [--invariants]     also emit invariants.json alongside the target
//
// Outputs (all under --out DIR):
//   metrics.json      — chamfer/hausdorff + per-direction quantiles
//   comparison.png    — target row above, candidate row below, shared bbox
//   invariants.json   — only when --invariants is passed
//   preview.png       — the standalone candidate 4-view render (from previewModel)
//
// Exits non-zero when the candidate fails to render.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { basename, dirname, extname, resolve, join } from 'node:path';
import { parseStl } from './stl.mjs';
import { signedMeshDistance } from './distance.mjs';
import { meshInvariants } from './invariants.mjs';
import { meshToRenderInputs, composeComparison } from './render.mjs';
import { runPreview, resolveViews } from '../cli/preview.mjs';

function parseArgs(argv) {
  const args = { target: null, candidate: null, out: null, samples: 5000, size: 384, views: null, invariants: false, params: {} };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') args.out = argv[++i];
    else if (a === '--samples') args.samples = parseInt(argv[++i], 10);
    else if (a === '--size') args.size = parseInt(argv[++i], 10);
    else if (a === '--views') args.views = argv[++i];
    else if (a === '--invariants') args.invariants = true;
    else if (a === '-p' || a === '--param') {
      const [k, ...v] = argv[++i].split('=');
      args.params[k] = coerce(v.join('='));
    } else if (!args.target) args.target = a;
    else if (!args.candidate) args.candidate = a;
    else throw new Error('eval: unexpected argument ' + a);
  }
  if (!args.target || !args.candidate) {
    console.error('Usage: node scripts/inverse-cad/eval.mjs <target.stl> <candidate.js> [--out DIR] [--samples N] [--size N] [--views a,b,...] [--invariants] [-p k=v]');
    process.exit(2);
  }
  return args;
}

function coerce(s) { if (s === 'true') return true; if (s === 'false') return false; const n = Number(s); return Number.isNaN(n) ? s : n; }

function fmt(n, d = 3) { return Number.isFinite(n) ? n.toFixed(d) : String(n); }

async function main() {
  const args = parseArgs(process.argv);
  const targetPath = resolve(args.target);
  const candidatePath = resolve(args.candidate);
  const targetName = basename(targetPath, extname(targetPath));
  const outDir = resolve(args.out ?? join(dirname(candidatePath), 'eval', targetName));
  mkdirSync(outDir, { recursive: true });

  // 1) Parse target STL
  const stlBuf = readFileSync(targetPath);
  const target = parseStl(new Uint8Array(stlBuf.buffer, stlBuf.byteOffset, stlBuf.byteLength));

  // 2) Invariants of target (optional but cheap)
  if (args.invariants) {
    const inv = meshInvariants(target, { samples: 4000, spheres: { rMin: 2.0, rMax: 4.0, tol: 0.15, minInliers: 60, trials: 1500 } });
    writeFileSync(join(outDir, 'invariants.json'), JSON.stringify(inv, replacerFloat, 2));
  }

  // 3) Run candidate through the real engine
  const { views, error: viewErr } = resolveViews(null, args.views);
  if (viewErr) { console.error(viewErr); process.exit(2); }
  const preview = await runPreview(candidatePath, { params: args.params, lang: 'manifold-js' });
  if (!preview.ok) {
    writeFileSync(join(outDir, 'metrics.json'), JSON.stringify({ ok: false, error: preview.error, diagnostics: preview.diagnostics }, null, 2));
    console.error('candidate failed to render:', preview.error);
    process.exit(1);
  }

  // 4) Candidate mesh in triangle-soup form for distance calc
  const candidate = deindexPreview(preview.render);
  const distance = signedMeshDistance(target, candidate, { samples: args.samples });

  // 5) Metrics report
  const stats = preview.stats;
  const report = {
    ok: true,
    target: { file: args.target, triangles: target.triangles.length / 9 },
    candidate: {
      file: args.candidate,
      triangles: stats?.triangleCount,
      volume: stats?.volume,
      surfaceArea: stats?.surfaceArea,
      componentCount: stats?.componentCount,
      isManifold: stats?.isManifold,
      bbox: stats?.bbox,
    },
    distance,
  };
  writeFileSync(join(outDir, 'metrics.json'), JSON.stringify(report, null, 2));

  // 6) Comparison PNG (target vs candidate) with matched framing
  const targetRender = meshToRenderInputs(target, [190, 200, 215]);
  const candidateRender = {
    positions: preview.render.positions,
    triVerts: preview.render.triVerts,
    triColors: preview.render.triColors,
    bbox: preview.render.bbox,
  };
  const cmp = await composeComparison({
    target: targetRender,
    candidate: candidateRender,
    size: args.size,
    views: views ?? undefined,
    label: { top: `target: ${basename(args.target)}`, bottom: `candidate: ${basename(args.candidate)}` },
  });
  const cmpPath = join(outDir, 'comparison.png');
  await cmp.toFile(cmpPath);

  // 7) Console summary
  console.log(JSON.stringify({
    outDir,
    chamfer: distance.chamfer,
    hausdorff: distance.hausdorff,
    rms: distance.rms,
    candidateTris: report.candidate.triangles,
    candidateVol: report.candidate.volume,
    candidateBBox: report.candidate.bbox,
    targetTris: report.target.triangles,
    comparison: cmpPath,
  }, null, 2));
  const bb = target.triangles.length / 9;
  console.error(
    `[eval] target=${basename(args.target)} (${bb} tris)  candidate=${basename(args.candidate)}\n` +
    `       chamfer=${fmt(distance.chamfer, 4)}mm  hausdorff=${fmt(distance.hausdorff, 4)}mm  rms=${fmt(distance.rms, 4)}mm\n` +
    `       PNG: ${cmpPath}`,
  );
}

// Convert the preview render (indexed positions + triVerts) back to a
// triangle-soup mesh for distance calculation.
function deindexPreview(render) {
  const { positions, triVerts } = render;
  const n = triVerts.length;
  const soup = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const v = triVerts[i];
    soup[i * 3] = positions[v * 3];
    soup[i * 3 + 1] = positions[v * 3 + 1];
    soup[i * 3 + 2] = positions[v * 3 + 2];
  }
  return { triangles: soup };
}

function replacerFloat(_key, v) {
  if (typeof v === 'number' && Number.isFinite(v)) return +v.toFixed(6);
  if (ArrayBuffer.isView(v)) return undefined;
  return v;
}

main().catch((e) => { console.error('eval failed:', e?.stack || e?.message || e); process.exit(1); });
