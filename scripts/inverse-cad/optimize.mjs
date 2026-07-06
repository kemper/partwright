#!/usr/bin/env node
// optimize.mjs — local parameter optimization for inverse-CAD candidates.
//
// The division of labor that removes numeric guessing: the AGENT decides
// structure (which primitives, which composition) and declares the knobs
// via api.params({...}); this OPTIMIZER finds the best member of that shape
// family. Nelder-Mead over the declared numeric params, minimizing exact
// signed-distance RMS against the target, on a warm engine (~0.1-0.5s per
// eval instead of ~2s).
//
//   node scripts/inverse-cad/optimize.mjs <target.stl> <candidate.js>
//     [--params a,b,c]     subset to optimize (default: all numeric params)
//     [--bounds k=lo:hi]   override schema min/max (repeatable)
//     [--budget 200]       max objective evaluations (default 200)
//     [--samples 5000]     distance samples per eval
//     [--restarts 2]       extra jittered simplex restarts
//     [--iou-penalty]      add 5*(1 - volumeIoU) to the objective (slower)
//     [--write]            write best params back into the candidate file
//     [--out FILE]         write the optimize.json report here
//
// Output: JSON report with start/best params + objective, per-param
// sensitivity, and a verdict: 'numeric-improved' | 'structure-limited'
// (best RMS still poor and all sensitivities low → no tuning will fix this
// shape family; go back to the findings).
//
// Requires the candidate to declare api.params({...}) — without a schema
// there is nothing to bind (-p overrides are silently ignored by the
// engine; this tool hard-errors instead).

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseStl } from './stl.mjs';
import { signedMeshDistance } from './surfaceDistance.mjs';
import { voxelDiff } from './voxelDiff.mjs';
import { createPreviewSession } from '../cli/preview.mjs';

function parseArgs(argv) {
  const args = { target: null, candidate: null, params: null, bounds: {}, budget: 200, samples: 5000, restarts: 2, iouPenalty: false, write: false, out: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--params') args.params = argv[++i].split(',').map((s) => s.trim());
    else if (a === '--bounds') {
      const [k, range] = argv[++i].split('=');
      const [lo, hi] = range.split(':').map(Number);
      args.bounds[k] = { lo, hi };
    } else if (a === '--budget') args.budget = parseInt(argv[++i], 10);
    else if (a === '--samples') args.samples = parseInt(argv[++i], 10);
    else if (a === '--restarts') args.restarts = parseInt(argv[++i], 10);
    else if (a === '--iou-penalty') args.iouPenalty = true;
    else if (a === '--write') args.write = true;
    else if (a === '--out') args.out = argv[++i];
    else if (!args.target) args.target = a;
    else if (!args.candidate) args.candidate = a;
    else throw new Error('optimize: unexpected argument ' + a);
  }
  if (!args.target || !args.candidate) {
    console.error('Usage: node scripts/inverse-cad/optimize.mjs <target.stl> <candidate.js> [--params a,b] [--bounds k=lo:hi] [--budget N] [--write]');
    process.exit(2);
  }
  return args;
}

function deindex(render) {
  const { positions, triVerts } = render;
  const soup = new Float32Array(triVerts.length * 3);
  for (let i = 0; i < triVerts.length; i++) {
    const v = triVerts[i];
    soup[i * 3] = positions[v * 3];
    soup[i * 3 + 1] = positions[v * 3 + 1];
    soup[i * 3 + 2] = positions[v * 3 + 2];
  }
  return { triangles: soup };
}

// ---------- Nelder-Mead (unit-cube coordinates) ----------

async function nelderMead(f, x0, opts) {
  const { maxEvals, tolF = 1e-5 } = opts;
  const n = x0.length;
  let evals = 0;
  const call = async (x) => { evals++; return f(x.map((v) => Math.min(1, Math.max(0, v)))); };

  // Initial simplex: x0 plus steps along each axis.
  let simplex = [{ x: x0.slice(), fx: await call(x0) }];
  for (let i = 0; i < n; i++) {
    const x = x0.slice();
    x[i] = x[i] + (x[i] > 0.5 ? -0.15 : 0.15);
    simplex.push({ x, fx: await call(x) });
  }

  while (evals < maxEvals) {
    simplex.sort((a, b) => a.fx - b.fx);
    if (Math.abs(simplex[n].fx - simplex[0].fx) < tolF) break;
    const centroid = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) centroid[j] += simplex[i].x[j] / n;
    }
    const worst = simplex[n];
    const reflect = centroid.map((c, j) => c + (c - worst.x[j]));
    const fr = await call(reflect);
    if (fr < simplex[0].fx) {
      const expand = centroid.map((c, j) => c + 2 * (c - worst.x[j]));
      const fe = await call(expand);
      simplex[n] = fe < fr ? { x: expand, fx: fe } : { x: reflect, fx: fr };
    } else if (fr < simplex[n - 1].fx) {
      simplex[n] = { x: reflect, fx: fr };
    } else {
      const contract = centroid.map((c, j) => c + 0.5 * (worst.x[j] - c));
      const fc = await call(contract);
      if (fc < worst.fx) {
        simplex[n] = { x: contract, fx: fc };
      } else {
        // Shrink toward best.
        for (let i = 1; i <= n; i++) {
          const x = simplex[i].x.map((v, j) => simplex[0].x[j] + 0.5 * (v - simplex[0].x[j]));
          simplex[i] = { x, fx: await call(x) };
        }
      }
    }
  }
  simplex.sort((a, b) => a.fx - b.fx);
  return { best: simplex[0], simplex, evals };
}

async function main() {
  const args = parseArgs(process.argv);
  const t0 = Date.now();
  const stlBuf = readFileSync(resolve(args.target));
  const target = parseStl(new Uint8Array(stlBuf.buffer, stlBuf.byteOffset, stlBuf.byteLength));
  const code = readFileSync(resolve(args.candidate), 'utf8');

  const session = await createPreviewSession();
  try {
    // Baseline run: discover the schema.
    const base = await session.preview(code);
    if (!base.ok) {
      console.error('candidate failed to render:', base.error);
      process.exit(1);
    }
    // paramsSchema is an ARRAY of { key, type, label, default, min, max }.
    const schema = base.stats?.paramsSchema;
    if (!Array.isArray(schema) || schema.length === 0) {
      console.error(
        'optimize: candidate declares no api.params({...}) schema — there is nothing to bind.\n' +
        'Fix: hoist the dimensions you want tuned into  const p = api.params({ r: { type: "number", default: 2.9, min: 2.5, max: 3.3 }, ... })  and use p.r in the code.',
      );
      process.exit(2);
    }
    const numeric = schema.filter((s) => s?.type === 'number');
    const names = (args.params ?? numeric.map((s) => s.key)).filter((k) => numeric.some((s) => s.key === k));
    if (names.length === 0) {
      console.error('optimize: none of the requested params are numeric params in the schema. Numeric keys: ' + numeric.map((s) => s.key).join(', '));
      process.exit(2);
    }
    const bounds = names.map((k) => {
      const s = numeric.find((e) => e.key === k);
      const o = args.bounds[k];
      const lo = o?.lo ?? s.min ?? s.default * 0.5;
      const hi = o?.hi ?? s.max ?? s.default * 1.5;
      if (!(hi > lo)) throw new Error(`optimize: bad bounds for ${k}: ${lo}:${hi}`);
      return { k, lo, hi, default: s.default };
    });

    const toParams = (x) => Object.fromEntries(bounds.map((b, i) => [b.k, b.lo + x[i] * (b.hi - b.lo)]));
    const trace = [];
    const objective = async (x) => {
      const params = toParams(x);
      let r;
      try {
        r = await session.preview(code, { params });
      } catch {
        return 1e9;
      }
      if (!r?.ok) return 1e9;
      const cand = deindex(r.render);
      const d = signedMeshDistance(target, cand, { samples: args.samples });
      let val = d.rms;
      if (args.iouPenalty) {
        const v = voxelDiff(target, cand, { res: 0.3 });
        val += 5 * (1 - v.volumeIoU);
      }
      trace.push({ params, rms: d.rms, objective: val });
      return val;
    };

    // Start point: schema defaults, in unit coords.
    const x0 = bounds.map((b) => (b.default - b.lo) / (b.hi - b.lo));
    const startVal = await objective(x0.map((v) => Math.min(1, Math.max(0, v))));

    let best = null;
    let totalEvals = 1;
    const starts = [x0];
    for (let r = 1; r <= args.restarts; r++) {
      // Deterministic jitter per restart.
      starts.push(x0.map((v, i) => Math.min(1, Math.max(0, v + ((((r * 7 + i * 13) % 11) - 5) / 11) * 0.4))));
    }
    for (const s of starts) {
      if (totalEvals >= args.budget) break;
      const res = await nelderMead(objective, s, { maxEvals: Math.floor((args.budget - totalEvals) / (args.restarts + 1 - starts.indexOf(s)) + 1) });
      totalEvals += res.evals;
      if (!best || res.best.fx < best.fx) best = res.best;
    }

    // Sensitivity: central differences around the best point (unit coords ±0.02).
    const sensitivity = {};
    for (let i = 0; i < bounds.length; i++) {
      const h = 0.02;
      const xp = best.x.slice(); xp[i] = Math.min(1, xp[i] + h);
      const xm = best.x.slice(); xm[i] = Math.max(0, xm[i] - h);
      const fp = await objective(xp);
      const fm = await objective(xm);
      totalEvals += 2;
      sensitivity[bounds[i].k] = +(Math.abs(fp - fm) / (xp[i] - xm[i] || 1)).toFixed(4);
    }

    const bestParams = toParams(best.x);
    const improved = best.fx < startVal * 0.98;
    const allInsensitive = Object.values(sensitivity).every((s) => s < 0.02);
    const verdict = best.fx > 0.15 && allInsensitive ? 'structure-limited' : improved ? 'numeric-improved' : 'already-optimal';

    let written = false;
    if (args.write && improved) {
      written = writeBack(resolve(args.candidate), code, bestParams);
    }

    const report = {
      ok: true,
      evals: totalEvals,
      wallTime_s: +((Date.now() - t0) / 1000).toFixed(1),
      params: names,
      bounds: Object.fromEntries(bounds.map((b) => [b.k, [b.lo, b.hi]])),
      start: { params: Object.fromEntries(bounds.map((b) => [b.k, b.default])), objective: +startVal.toFixed(5) },
      best: { params: Object.fromEntries(Object.entries(bestParams).map(([k, v]) => [k, +v.toFixed(4)])), objective: +best.fx.toFixed(5) },
      sensitivity,
      verdict,
      written,
    };
    if (args.out) writeFileSync(resolve(args.out), JSON.stringify({ ...report, trace }, null, 2));
    console.log(JSON.stringify(report, null, 2));
    if (verdict === 'structure-limited') {
      console.error('\nSTRUCTURE-LIMITED: no parameter of this shape family moves the objective — tuning cannot fix it. Re-read the findings (turn.mjs) and restructure.');
    }
  } finally {
    await session.close();
  }
}

// Best-effort write-back: replace each param's `default: <num>` inside the
// api.params block. Verified by re-reading — if any param fails to bind,
// nothing is written.
function writeBack(path, code, bestParams) {
  let out = code;
  for (const [k, v] of Object.entries(bestParams)) {
    const re = new RegExp(`(\\b${k}\\s*:\\s*\\{[^}]*?default\\s*:\\s*)(-?[\\d.eE+]+)`, 's');
    if (!re.test(out)) {
      console.error(`--write: could not locate  ${k}: { ... default: <num> }  — skipping write-back entirely`);
      return false;
    }
    out = out.replace(re, `$1${+v.toFixed(4)}`);
  }
  writeFileSync(path, out);
  return true;
}

main().catch((e) => {
  console.error('optimize failed:', e?.stack || e?.message || e);
  process.exit(1);
});
