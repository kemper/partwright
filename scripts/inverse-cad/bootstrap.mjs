#!/usr/bin/env node
// bootstrap.mjs — deterministic first-candidate generator for the
// inverse-CAD loop. Given a target STL, produce a working manifold-js
// snippet an agent can start iterating from (chamfer ~0.1-0.4mm instead of
// the ~2.5mm a blind first guess gets), by band-slicing the mesh along its
// most prismatic axis, fitting circles where they fit tight, and tracing
// (Douglas-Peucker simplified) 2D profiles everywhere else, then stacking
// the per-band solids with `.add`.
//
// Usage:
//   node scripts/inverse-cad/bootstrap.mjs <target.stl>
//     [--axis auto|x|y|z]   (default: auto — highest prismaticScore, ties to z)
//     [--out FILE.js]       (default: <target-without-ext>.bootstrap.js)
//     [--step N]            band-scan step (default: per-axis, see probe.mjs cmdBands)
//     [--max-bands N]        (default: 12)
//
// Algorithm (see .plans/inverse-cad/README or the module docstrings for the
// underlying primitives):
//   1. Parse target, meshBBox.
//   2. Axis pick: cmdBands for z/x/y, highest prismaticScore wins (z on
//      near-ties, since the corpus sits Z-flat on the build plate).
//   3. Merge bands: absorb thin/unstable slivers into a larger neighbor,
//      then merge the most-similar adjacent pairs until <= --max-bands.
//   4. Per band: a tight circle fit -> CrossSection.circle; otherwise trace
//      the band's mid-height slice (DP-simplified, short-edge cleaned).
//   5. Stack every band with `.add`, one `return`.
//   6. Self-score: spawn eval.mjs against the target and print
//      {chamfer, hausdorff, out}. A candidate that fails to render is a hard
//      failure (exit 1) — the emitted code must always render.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { basename, dirname, extname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseStl, meshBBox } from './stl.mjs';
import {
  sliceMesh,
  douglasPeucker,
  cleanShortEdges,
  polygonSignedArea,
} from './slice.mjs';
import { cmdBands } from './probe.mjs';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));

// ---------- band merging (pure — unit tested) ----------

/**
 * Merge a list of generic bands ({from, to, thickness, medianArea, stable,
 * bestFit, contourCount, holeCount, ...}), sorted by `from` ascending and
 * contiguous (each band's `to` meets the next one's `from`), down to a
 * workable candidate set:
 *
 *   Phase 1 — absorb slivers: any band thinner than `3 * step` AND flagged
 *   unstable gets folded into whichever adjacent neighbor is thicker (ties
 *   go to the earlier/previous neighbor). This clears the single
 *   misclassified level that would otherwise become its own tiny band.
 *
 *   Phase 2 — budget: while more than `maxBands` remain, merge the adjacent
 *   pair with the closest `medianArea` (the least information lost) until
 *   at or under budget.
 *
 * Merging two adjacent bands always produces `{from: min, to: max}` of the
 * pair, so the full extent stays covered with no gaps throughout.
 */
export function mergeBands(bands, opts = {}) {
  const { step = 0.25, maxBands = 12 } = opts;
  if (!Array.isArray(bands) || bands.length === 0) return [];
  const list = bands.map((b) => ({ ...b }));

  const thicknessOf = (b) => b.to - b.from;

  const mergeAt = (i, j) => {
    const first = Math.min(i, j);
    const second = Math.max(i, j);
    const a = list[first];
    const b = list[second];
    const lo = Math.min(a.from, b.from);
    const hi = Math.max(a.to, b.to);
    // Keep the characteristics of whichever input band is thicker — that's
    // the "real" feature; the thinner one was the sliver/near-duplicate
    // being folded in. Ties keep `a` (the earlier band).
    const keep = thicknessOf(a) >= thicknessOf(b) ? a : b;
    const merged = {
      ...keep,
      from: lo,
      to: hi,
      thickness: hi - lo,
      stable: !!a.stable && !!b.stable,
      bestFit: a.bestFit === b.bestFit ? a.bestFit : 'multi',
    };
    list.splice(first, 2, merged);
  };

  // Phase 1: absorb thin, unstable slivers into their larger neighbor.
  let progress = true;
  while (progress && list.length > 1) {
    progress = false;
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      const isSliver = thicknessOf(b) < 3 * step && b.stable === false;
      if (!isSliver) continue;
      const prev = i > 0 ? i - 1 : null;
      const next = i < list.length - 1 ? i + 1 : null;
      let target = null;
      if (prev !== null && next !== null) {
        target = thicknessOf(list[prev]) >= thicknessOf(list[next]) ? prev : next;
      } else if (prev !== null) {
        target = prev;
      } else if (next !== null) {
        target = next;
      }
      if (target === null) continue;
      mergeAt(i, target);
      progress = true;
      break;
    }
  }

  // Phase 2: reduce to at most maxBands by merging the most-similar
  // (closest medianArea) adjacent pair, repeatedly.
  while (list.length > maxBands) {
    let bestI = 0;
    let bestDiff = Infinity;
    for (let i = 0; i < list.length - 1; i++) {
      const diff = Math.abs((list[i].medianArea ?? 0) - (list[i + 1].medianArea ?? 0));
      if (diff < bestDiff) {
        bestDiff = diff;
        bestI = i;
      }
    }
    mergeAt(bestI, bestI + 1);
  }

  return list;
}

// ---------- axis-specific bands -> generic bands ----------

function toGenericBands(bandsResult, axis) {
  const fromKey = axis + 'From';
  const toKey = axis + 'To';
  return bandsResult.bands.map((b) => ({
    from: b[fromKey],
    to: b[toKey],
    thickness: b.thickness,
    contourCount: b.contourCount,
    holeCount: b.holeCount,
    medianArea: b.medianArea,
    stable: b.stable,
    bestFit: b.bestFit,
    circle: b.circle,
    roundedRect: b.roundedRect,
  }));
}

// ---------- code emission ----------

function fmtPts(points, decimals) {
  const parts = [];
  for (let i = 0; i < points.length; i += 2) {
    parts.push(`[${points[i].toFixed(decimals)},${points[i + 1].toFixed(decimals)}]`);
  }
  return '[' + parts.join(',') + ']';
}

// Force CCW winding so geom.fromPoints / CrossSection.ofPolygons keeps the
// outline solid (mirrors trace2code.mjs's private `ccw`, which isn't
// exported).
function ccw(points) {
  if (polygonSignedArea(points) >= 0) return points;
  const n = points.length / 2;
  const out = new Float64Array(points.length);
  for (let i = 0; i < n; i++) {
    out[i * 2] = points[(n - 1 - i) * 2];
    out[i * 2 + 1] = points[(n - 1 - i) * 2 + 1];
  }
  return out;
}

// The local-frame "Z" translate that places a band's 0..thickness extrusion
// at its real coordinate along the *true* slicing axis. For axis 'z' and
// 'x' this is simply the band's own `from` (see the rotate derivation
// below); axis 'y' needs the flipped/mirrored form because the natural
// (u, v, axis) frame for 'y' is left-handed relative to (X, Y, Z) and the
// single rotate that fixes that also reverses which end of the band maps to
// local Z=0.
function localZTranslate(axis, band) {
  return axis === 'y' ? -band.to : band.from;
}

// The single whole-solid transform that carries the axis-agnostic "extrude
// along local Z" bands into their real orientation. Derived by solving
// R = Rz(g)*Ry(b)*Rx(a) for the exact permutation (with the sign flip on
// whichever axis makes the local (X,Y,Z) right-handed frame land on the
// real one):
//   axis 'z': identity — u=x, v=y, extrude is already along world Z.
//   axis 'x': local (X=u=y, Y=v=z, Z=depth) -> world (Y, Z, X):
//             solves to rotate([90, 0, 90]).
//   axis 'y': local (X=u=x, Y=v=z, Z=depth) -> world (X, -Z, -Y)-handed fix:
//             solves to rotate([90, 0, 0]) with localZTranslate flipped above.
function finalRotateCall(axis) {
  if (axis === 'x') return '.rotate([90, 0, 90])';
  if (axis === 'y') return '.rotate([90, 0, 0])';
  return '';
}

function emitCircleBand(trueAxis, band, index, decimals) {
  const { cx, cy, r } = band.circle;
  const lines = [];
  lines.push(`// band ${index}: circle fit r=${r.toFixed(3)} center=[${cx.toFixed(3)},${cy.toFixed(3)}] (residual=${band.circle.rmsResidual.toFixed(4)})`);
  lines.push(`const band${index} = CrossSection.circle(${r.toFixed(decimals)}, 64)`);
  lines.push(`  .translate([${cx.toFixed(decimals)}, ${cy.toFixed(decimals)}])`);
  lines.push(`  .extrude(${band.thickness.toFixed(decimals)}, 0, 0, [1, 1])`);
  lines.push(`  .translate([0, 0, ${localZTranslate(trueAxis, band).toFixed(decimals)}]);`);
  return lines;
}

function emitTracedBand(mesh, trueAxis, band, index, dpTol, minEdge, decimals) {
  const mid = band.from + band.thickness / 2;
  const contours = sliceMesh(mesh, trueAxis, mid);
  const closed = contours.filter((c) => !c.open);
  const outers = closed.filter((c) => !c.isHole);
  const holes = closed.filter((c) => c.isHole);
  const lines = [];
  lines.push(`// band ${index}: traced slice ${trueAxis}=${mid.toFixed(3)} (${outers.length} outer, ${holes.length} hole${holes.length === 1 ? '' : 's'})${band.stable === false ? ' — UNSTABLE (staircased; consider a sphere/revolve here)' : ''}`);
  if (outers.length === 0) {
    // Degenerate (no material at the band midpoint) — fall back to a
    // hairline-thin box at the band's fitted extent so the union still
    // renders; the header flags this band as staircased for the agent.
    lines.push(`const band${index} = Manifold.cube([0.01, 0.01, ${band.thickness.toFixed(decimals)}], true);`);
    return lines;
  }
  const simplify = (c) => ccw(cleanShortEdges(douglasPeucker(c.points, dpTol), minEdge));
  outers.forEach((c, i) => {
    const pts = simplify(c);
    lines.push(`const b${index}outer${i} = geom.fromPoints(${fmtPts(pts, decimals)});`);
  });
  holes.forEach((c, i) => {
    const pts = simplify(c);
    lines.push(`const b${index}hole${i} = geom.fromPoints(${fmtPts(pts, decimals)});`);
  });
  let expr = `b${index}outer0`;
  for (let i = 1; i < outers.length; i++) expr += `.add(b${index}outer${i})`;
  for (let i = 0; i < holes.length; i++) expr += `.subtract(b${index}hole${i})`;
  lines.push(`const band${index} = (${expr})`);
  lines.push(`  .extrude(${band.thickness.toFixed(decimals)}, 0, 0, [1, 1])`);
  lines.push(`  .translate([0, 0, ${localZTranslate(trueAxis, band).toFixed(decimals)}]);`);
  return lines;
}

function buildCandidateCode(mesh, targetPath, axis, bandsResult, mergedBands, opts) {
  const { dpTol, minEdge, decimals } = opts;
  const bbox = meshBBox(mesh);
  const staircased = mergedBands
    .map((b, i) => ({ b, i }))
    .filter(({ b }) => b.stable === false);

  const headerLines = [];
  headerLines.push(`// AUTO-GENERATED first candidate — scripts/inverse-cad/bootstrap.mjs`);
  headerLines.push(`// target: ${basename(targetPath)}`);
  headerLines.push(`// bbox: min=[${bbox.min.map((v) => v.toFixed(3)).join(',')}] max=[${bbox.max.map((v) => v.toFixed(3)).join(',')}] size=[${bbox.size.map((v) => v.toFixed(3)).join(',')}]`);
  headerLines.push(`// axis: ${axis}  prismaticScore=${bandsResult.prismaticScore.toFixed(3)}`);
  headerLines.push(`// bands (${mergedBands.length}, post-merge):`);
  mergedBands.forEach((b, i) => {
    const fit = b.circle && b.bestFit === 'circle' ? `circle r=${b.circle.rmsResidual < 0.08 ? b.circle.r.toFixed(3) : `${b.circle.r.toFixed(3)} (residual too high, traced)`}` : (b.bestFit || 'traced');
    headerLines.push(
      `//   [${i}] ${axis}∈[${b.from.toFixed(3)},${b.to.toFixed(3)}] thickness=${b.thickness.toFixed(3)} fit=${fit}${b.stable === false ? ' STAIRCASED' : ''}`,
    );
  });
  if (staircased.length > 0) {
    headerLines.push(
      `// STAIRCASED bands (${staircased.map(({ i }) => i).join(', ')}): contour shape changes materially slice-to-slice —`,
    );
    headerLines.push(
      `// these were traced at the band midpoint as a flat prismatic stand-in. Likely a sphere/revolve/loft;`,
    );
    headerLines.push(`// replace with the appropriate primitive once identified.`);
  } else {
    headerLines.push(`// no unstable/staircased bands — model reads as prismatic along ${axis}.`);
  }
  headerLines.push('');
  headerLines.push('const { Manifold, CrossSection, geom } = api;');
  headerLines.push('');

  const bodyLines = [];
  mergedBands.forEach((band, i) => {
    if (band.bestFit === 'circle' && band.circle && band.circle.rmsResidual < 0.08) {
      bodyLines.push(...emitCircleBand(axis, band, i, decimals));
    } else {
      bodyLines.push(...emitTracedBand(mesh, axis, band, i, dpTol, minEdge, decimals));
    }
    bodyLines.push('');
  });

  let stackExpr = 'band0';
  for (let i = 1; i < mergedBands.length; i++) stackExpr += `.add(band${i})`;
  const rotateCall = finalRotateCall(axis);
  bodyLines.push(`return (${stackExpr})${rotateCall};`);

  return headerLines.join('\n') + '\n' + bodyLines.join('\n') + '\n';
}

// ---------- axis selection ----------

function pickAxis(mesh, requestedAxis, step) {
  if (requestedAxis && requestedAxis !== 'auto') {
    const args = { axis: requestedAxis, step: step ?? null };
    return { axis: requestedAxis, bandsResult: cmdBands(mesh, args) };
  }
  const results = {};
  for (const axis of ['z', 'x', 'y']) {
    results[axis] = cmdBands(mesh, { axis, step: step ?? null });
  }
  let best = 'z';
  for (const axis of ['x', 'y']) {
    if (results[axis].prismaticScore > results[best].prismaticScore) best = axis;
  }
  // Prefer z on near-ties (parts sit Z-flat on the build plate). Widened
  // from the nominal +/-0.05 to +/-0.10: cmdBands' contour-similarity
  // heuristic is measurably biased against the thin/print axis on this
  // corpus's frame parts — frame_ankle_2x (z=0.25 vs its winning axis'
  // 0.30) and frame_knee_and_elbow_4x (z=0.18 vs 0.27) are BOTH genuinely
  // Z-prismatic (their hand-converged candidates are single-Z-slice
  // extrusions scoring <=0.08mm chamfer) yet z loses by 0.05-0.09 to an
  // axis whose "stable" bands are an artifact of slow contour drift never
  // tripping the similarity threshold, not real prismatic constancy.
  // Forcing z on both scores ~4x better than the raw-winner axis; +/-0.10
  // recovers that without flipping genuinely non-prismatic parts (frame_hips
  // and frame_thigh_2x's non-z axes still win by >0.2, far outside this band).
  if (best !== 'z') {
    const gap = Math.round((results[best].prismaticScore - results.z.prismaticScore) * 100) / 100;
    if (gap <= 0.1) best = 'z';
  }
  return { axis: best, bandsResult: results[best] };
}

// ---------- CLI ----------

function parseArgs(argv) {
  const args = { target: null, axis: 'auto', out: null, step: null, maxBands: 12 };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--axis') args.axis = argv[++i];
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--step') args.step = parseFloat(argv[++i]);
    else if (a === '--max-bands') args.maxBands = parseInt(argv[++i], 10);
    else if (!args.target) args.target = a;
    else throw new Error('bootstrap: unexpected argument ' + a);
  }
  if (!args.target) {
    console.error('Usage: node scripts/inverse-cad/bootstrap.mjs <target.stl> [--axis auto|x|y|z] [--out FILE.js] [--step N] [--max-bands N]');
    process.exit(2);
  }
  return args;
}

function runSelfScore(targetPath, candidatePath) {
  const evalScript = join(SCRIPT_DIR, 'eval.mjs');
  const res = spawnSync('node', [evalScript, targetPath, candidatePath], { encoding: 'utf8' });
  const targetName = basename(targetPath, extname(targetPath));
  const metricsPath = join(dirname(candidatePath), 'eval', targetName, 'metrics.json');
  let metrics = null;
  try {
    metrics = JSON.parse(readFileSync(metricsPath, 'utf8'));
  } catch {
    // fall through — surfaced below as a failure
  }
  if (!metrics || metrics.ok !== true) {
    const error = metrics?.error || res.stderr || res.stdout || 'eval.mjs produced no metrics.json';
    console.error('candidate failed to render:', error);
    process.exit(1);
  }
  console.log(JSON.stringify({
    chamfer: metrics.distance.chamfer,
    hausdorff: metrics.distance.hausdorff,
    out: candidatePath,
  }, null, 2));
}

async function main() {
  const args = parseArgs(process.argv);
  const targetPath = resolve(args.target);
  const buf = readFileSync(targetPath);
  const mesh = parseStl(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));

  const { axis, bandsResult } = pickAxis(mesh, args.axis, args.step);
  const genericBands = toGenericBands(bandsResult, axis);
  const mergedBands = mergeBands(genericBands, { step: bandsResult.step, maxBands: args.maxBands });

  const code = buildCandidateCode(mesh, targetPath, axis, bandsResult, mergedBands, {
    dpTol: 0.05,
    minEdge: 0.15,
    decimals: 4,
  });

  const outPath = args.out
    ? resolve(args.out)
    : join(dirname(targetPath), basename(targetPath, extname(targetPath)) + '.bootstrap.js');
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, code);

  runSelfScore(targetPath, outPath);
}

const isMain = process.argv[1] && import.meta.url.endsWith(basename(process.argv[1]));
if (isMain) {
  main().catch((e) => {
    console.error('bootstrap failed:', e?.stack || e?.message || e);
    process.exit(1);
  });
}

export { pickAxis, toGenericBands, buildCandidateCode };
