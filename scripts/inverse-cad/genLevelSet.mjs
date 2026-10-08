#!/usr/bin/env node
// genLevelSet.mjs — SDF-interpolation candidate generator for the
// inverse-CAD loop. Where bootstrap.mjs stacks Z bands as flat extrusions
// (visibly stepped for organic parts), this slices the target STL into thin
// Z sections, DP-simplifies each section's contours, and emits a candidate
// whose sdf(x,y,z) is a Z-lerp between adjacent sections' 2D signed-distance
// fields (even-odd multi-loop, flat end caps) — a smooth surface meshed with
// Manifold.levelSet instead of a staircase.
//
// Usage:
//   node scripts/inverse-cad/genLevelSet.mjs <target.stl>
//     [--step 0.15]      slice pitch along Z (mm)
//     [--dp 0.02]        Douglas-Peucker tolerance per section contour (mm)
//     [--edge 0.11]      Manifold.levelSet edgeLength (mm)
//     [--out FILE.js]    default <target-without-ext>.levelset.js
//     [--voids "x,y,z,w,h,d;..."]   internal box voids (center xyz, size whd)
//        appended AFTER the levelSet — for debris shells the SDF resolution
//        doesn't reproduce (measure centers/sizes from this part's notes.md
//        or splitStl.mjs; don't guess).
//     [--min-stable 0.45]  shortest single-outer-blob run (mm) trusted for
//        SDF blending — see the classifySections note below. Pass a huge
//        value (e.g. 1000) to force pure banded extrusion everywhere: the
//        escape hatch for a target whose smooth blend is itself unstable
//        (see hand_open_left below) — still finer/cleaner than a hand-rolled
//        band-stack since it reuses this generator's own slicing/DP/weld.
//
// Validated prototype: hand_grip_left at step 0.15 / dp 0.02 / edge 0.11
// scored chamfer 0.0093mm vs its 0.028mm band-stack best, visually smooth
// (see .plans/inverse-cad/v2/hand_grip_left/notes.md). This script
// generalizes that prototype — reusing sliceMesh/douglasPeucker from
// slice.mjs — with one addition the prototype didn't need: naive Z-lerp
// SDF blending fabricates spurious handles (genus explodes) wherever the
// per-slice OUTER-loop count is genuinely volatile (several widely-separated
// blobs whose count keeps changing slice to slice — the classic case is a
// hand's separated fingertips). A quick per-slice outer-loop-count scan
// classifies the Z axis into SMOOTH runs (outer count holds steady for a
// while — safe to SDF-blend, any number of nested holes included) and
// VOLATILE runs (outer count keeps changing — fall back to a flat per-slice
// band extrusion there, same technique bootstrap.mjs/the hand-family
// band-stack recipes already use safely). The two techniques are unioned
// with a small Z overlap so they weld like any other multi-band stack.
//
// One shape defeats even that: hand_open_left's single-blob wrist/palm run
// (no separated fingers yet, so it's classified SMOOTH) still fabricates
// ~45 spurious handles regardless of --step/--dp/--edge — its very high raw
// vertex density (300+ points/slice, several times denser than the other
// hands) makes the per-slice-independent DP simplification pick different
// vertices slice to slice, and blending two independently-faceted 2D fields
// is unstable at that density REGARDLESS of resolution (confirmed: genus
// stays ~45 from --step 0.03 to 0.5). Forcing pure banding there
// (--min-stable 1000) gives a clean genus-0 result — use it for shapes that
// show the same symptom (genus that doesn't converge as you vary --step).

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { basename, dirname, extname, resolve, join } from 'node:path';
import { parseStl, meshBBox } from './stl.mjs';
import { sliceMesh, douglasPeucker, polygonSignedArea } from './slice.mjs';

const XY_MARGIN = 0.5; // levelSet grid margin beyond the target's XY bbox (mm)
const MIN_STABLE_MM_DEFAULT = 0.45; // shortest single-blob plateau trusted for SDF blending
const WELD_OVERLAP = 0.05; // extra mm a smooth/banded pair overlaps at a hybrid seam
const BAND_WELD_EPS = 0.05; // per-band top overlap within one banded run (coincident-face weld trap)
const SLIVER_MIN_VOLUME = 0.05; // drop decomposed fragments smaller than this once hybrid pieces are unioned

function round(v, decimals) {
  return +v.toFixed(decimals);
}

function jsonReplacer(decimals) {
  return (_k, v) => (typeof v === 'number' && Number.isFinite(v) ? round(v, decimals) : v);
}

// Force CCW winding (mirrors bootstrap.mjs's private ccw — geom.fromPoints
// needs a consistently-wound outline to stay solid).
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

function fmtPts(points, decimals) {
  const parts = [];
  for (let i = 0; i < points.length; i += 2) {
    parts.push(`[${points[i].toFixed(decimals)},${points[i + 1].toFixed(decimals)}]`);
  }
  return '[' + parts.join(',') + ']';
}

// Slice the mesh at Z=z, keep only closed contours, DP-simplify each. Open
// contours (non-watertight slice) are dropped — both the SDF even-odd test
// and the banded fallback need closed loops.
function sliceSection(mesh, z, dpTol) {
  const contours = sliceMesh(mesh, 'z', z).filter((c) => !c.open);
  return contours.map((c) => ({
    points: Array.from(douglasPeucker(c.points, dpTol)),
    isHole: !!c.isHole,
  }));
}

// Uniform mid-band sections covering [zLo, zHi]: section i samples at
// zLo + step/2 + i*step.
function buildSections(mesh, zLo, zHi, step, dpTol) {
  const n = Math.max(1, Math.round((zHi - zLo) / step));
  const sections = [];
  for (let i = 0; i < n; i++) {
    const z = zLo + step / 2 + i * step;
    sections.push({ z, contours: sliceSection(mesh, z, dpTol) });
  }
  return sections;
}

// Classify sections into contiguous SMOOTH (single outer blob, any number of
// nested holes, held for at least MIN_STABLE_MM) vs BANDED (multiple
// separate outer blobs) runs, merging adjacent same-tag runs. Naive Z-lerp
// SDF blending is safe for a lone blob morphing/gaining-or-losing holes, but
// fabricates handles once there's more than one separate blob in a slice —
// even when the blob COUNT itself holds steady, the blobs still drift
// relative to each other and a combined-field blend can bridge/pinch them.
// Empirically: hand_grip_left's separating-fingertip region (count churns
// 2→3→5→4) breaks either way; hand_open_left's spread-finger region (a
// *stable* 4-blob run for ~2mm) still breaks under a count-stability-only
// rule, so any multi-blob slice is unconditionally banded regardless of run
// length (see the module docstring).
function classifySections(sections, step, minStableMm) {
  const outerCounts = sections.map((s) => s.contours.filter((c) => !c.isHole).length);
  const minRunLen = Math.max(3, Math.round(minStableMm / step));

  const runs = [];
  let start = 0;
  for (let i = 1; i <= outerCounts.length; i++) {
    if (i === outerCounts.length || (outerCounts[i] === 1) !== (outerCounts[start] === 1)) {
      const single = outerCounts[start] === 1;
      runs.push({ start, end: i - 1, stable: single && i - start >= minRunLen });
      start = i;
    }
  }

  const segments = [];
  for (const run of runs) {
    const type = run.stable ? 'smooth' : 'banded';
    const last = segments[segments.length - 1];
    if (last && last.type === type) last.end = run.end;
    else segments.push({ type, start: run.start, end: run.end });
  }
  return segments;
}

function parseVoids(spec) {
  if (!spec) return [];
  return spec
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((group) => {
      const nums = group.split(',').map(Number);
      if (nums.length !== 6 || nums.some((n) => !Number.isFinite(n))) {
        throw new Error(`--voids: expected "x,y,z,w,h,d" per group, got "${group}"`);
      }
      const [x, y, z, w, h, d] = nums;
      return { x, y, z, w, h, d };
    });
}

// ---------- code emission ----------

function emitSmoothSegment(sections, seg, index, zLo, zHi, step, edge, bbox, decimals) {
  const slice = sections.slice(seg.start, seg.end + 1);
  const sectionsSrc = JSON.stringify(
    slice.map((s) => [s.z, s.contours.map((c) => c.points)]),
    jsonReplacer(decimals),
  );
  const isGlobalBottom = seg.start === 0;
  const isGlobalTop = seg.end === sections.length - 1;
  const segZLo = slice[0].z - step / 2;
  const segZHi = slice[slice.length - 1].z + step / 2;
  const boundsZMin = isGlobalBottom ? zLo - 2 * step : segZLo - WELD_OVERLAP;
  const boundsZMax = isGlobalTop ? zHi + 2 * step : segZHi + WELD_OVERLAP;
  const boundsMin = [bbox.min[0] - XY_MARGIN, bbox.min[1] - XY_MARGIN, boundsZMin];
  const boundsMax = [bbox.max[0] + XY_MARGIN, bbox.max[1] + XY_MARGIN, boundsZMax];

  const lines = [];
  lines.push(`// smooth segment ${index}: ${slice.length} sections, z∈[${round(segZLo, decimals)},${round(segZHi, decimals)}] — SDF-interpolated`);
  lines.push(`const SECTIONS_${index} = ${sectionsSrc};`);
  lines.push(`function sdf_${index}(p) {`);
  lines.push(`  const z = p[2];`);
  // A hybrid seam ALSO needs a genuine flat cap (not a bare bounds-box
  // truncation) — Manifold.levelSet's own docs warn that letting the field's
  // interior exceed the sampling box produces a jagged "egg-crate" closure
  // following the grid cells, which then unions badly with the neighboring
  // banded chunk's straight prism edge (verified: this was the actual source
  // of a genus-40+ explosion on hand_open_left, not the banded technique
  // itself). So every segment boundary gets a real capD taper to zero at its
  // own bounds edge — global bounds at the model's true extent, internal
  // seams at their WELD_OVERLAP-extended edge.
  const capParts = [];
  capParts.push(isGlobalBottom ? `z - ${round(zLo, decimals)}` : `z - ${round(boundsZMin, decimals)}`);
  capParts.push(isGlobalTop ? `${round(zHi, decimals)} - z` : `${round(boundsZMax, decimals)} - z`);
  lines.push(`  const capD = Math.min(${capParts[0]}, ${capParts[1]});          // flat cap at this segment's own bounds edge`);
  lines.push(`  const f = (z - (${round(segZLo, decimals)} + ${step} / 2)) / ${step};`);
  lines.push(`  const i = Math.max(0, Math.min(SECTIONS_${index}.length - 1, Math.floor(f)));`);
  lines.push(`  const i2 = Math.max(0, Math.min(SECTIONS_${index}.length - 1, i + 1));`);
  lines.push(`  const t = Math.max(0, Math.min(1, f - i));`);
  lines.push(`  const a = sdf2d(SECTIONS_${index}[i][1], p[0], p[1]);`);
  lines.push(`  const b = i2 === i ? a : sdf2d(SECTIONS_${index}[i2][1], p[0], p[1]);`);
  lines.push(`  return Math.min((1 - t) * a + t * b, capD);`);
  lines.push(`}`);
  lines.push(`const bounds_${index} = { min: [${boundsMin.map((v) => round(v, decimals)).join(', ')}], max: [${boundsMax.map((v) => round(v, decimals)).join(', ')}] };`);
  lines.push(`const chunk_${index} = Manifold.levelSet(sdf_${index}, bounds_${index}, ${edge});`);
  return lines;
}

function emitBandedSegment(sections, seg, index, step, decimals) {
  const isGlobalBottom = seg.start === 0;
  const isGlobalTop = seg.end === sections.length - 1;
  const lines = [];
  lines.push(`// banded segment ${index}: sections ${seg.start}-${seg.end} — outer-loop count is volatile here`);
  lines.push(`// (widely-separated blobs whose count keeps changing), so this run falls back to`);
  lines.push(`// flat per-slice extrusion instead of SDF blending (see module docstring).`);
  const bandNames = [];
  for (let i = seg.start; i <= seg.end; i++) {
    const { z, contours } = sections[i];
    // A DP-simplified sliver can collapse to <3 points (not a valid polygon)
    // — drop those rather than let geom.fromPoints throw.
    const valid = contours.filter((c) => c.points.length >= 6);
    const outers = valid.filter((c) => !c.isHole);
    const holes = valid.filter((c) => c.isHole);
    if (outers.length === 0) continue; // no material at this slice — skip
    const simplify = (c) => ccw(Float64Array.from(c.points));
    outers.forEach((c, k) => {
      lines.push(`const s${index}_${i}_o${k} = geom.fromPoints(${fmtPts(simplify(c), decimals)});`);
    });
    holes.forEach((c, k) => {
      lines.push(`const s${index}_${i}_h${k} = geom.fromPoints(${fmtPts(simplify(c), decimals)});`);
    });
    let expr = `s${index}_${i}_o0`;
    for (let k = 1; k < outers.length; k++) expr += `.add(s${index}_${i}_o${k})`;
    for (let k = 0; k < holes.length; k++) expr += `.subtract(s${index}_${i}_h${k})`;

    let bottom = z - step / 2;
    let top = z + step / 2 + BAND_WELD_EPS;
    if (i === seg.start && !isGlobalBottom) bottom -= WELD_OVERLAP;
    if (i === seg.end && !isGlobalTop) top += WELD_OVERLAP;
    const thickness = top - bottom;
    const name = `band_${index}_${i}`;
    lines.push(`const ${name} = (${expr}).extrude(${round(thickness, decimals)}, 0, 0, [1, 1]).translate([0, 0, ${round(bottom, decimals)}]);`);
    bandNames.push(name);
  }
  if (bandNames.length === 0) {
    lines.push(`const chunk_${index} = null; // no material in this banded run`);
    return { lines, hasChunk: false };
  }
  let expr = bandNames[0];
  for (let k = 1; k < bandNames.length; k++) expr += `.add(${bandNames[k]})`;
  lines.push(`const chunk_${index} = ${expr};`);
  return { lines, hasChunk: true };
}

function buildCandidateCode(mesh, targetPath, opts) {
  const { step, dpTol, edge, voids, decimals, minStableMm } = opts;
  const bbox = meshBBox(mesh);
  const zLo = bbox.min[2];
  const zHi = bbox.max[2];
  const sections = buildSections(mesh, zLo, zHi, step, dpTol);
  const segments = classifySections(sections, step, minStableMm);
  const smoothCount = segments.filter((s) => s.type === 'smooth').length;
  const bandedCount = segments.length - smoothCount;

  const lines = [];
  lines.push(`// AUTO-GENERATED levelSet SDF-interpolation candidate — scripts/inverse-cad/genLevelSet.mjs`);
  lines.push(`// target: ${basename(targetPath)}`);
  lines.push(`// ${sections.length} Z sections at step ${step}mm (DP tol ${dpTol}mm); the surface is a`);
  lines.push(`// SMOOTH linear interpolation of the measured 2D signed-distance fields — no band`);
  lines.push(`// staircase, EXCEPT ${bandedCount} volatile-topology run(s) (widely-separated blobs`);
  lines.push(`// whose outer-loop count won't settle) that fall back to a flat per-slice extrusion`);
  lines.push(`// stack, exactly like this part's earlier band-stack recipe. levelSet edgeLength ${edge}mm.`);
  lines.push(`// Segments (${segments.length}): ${segments.map((s) => `${s.type}[${s.start}-${s.end}]`).join(', ')}`);
  lines.push(`const { Manifold, CrossSection, geom } = api;`);
  lines.push('');
  lines.push(`// signed distance to a polygon set (even-odd holes), positive INSIDE`);
  lines.push(`function sdf2d(polys, x, y) {`);
  lines.push(`  let d = Infinity, inside = false;`);
  lines.push(`  for (const poly of polys) {`);
  lines.push(`    const n = poly.length / 2;`);
  lines.push(`    for (let i = 0, j = n - 1; i < n; j = i++) {`);
  lines.push(`      const xi = poly[i*2], yi = poly[i*2+1], xj = poly[j*2], yj = poly[j*2+1];`);
  lines.push(`      // distance to segment`);
  lines.push(`      const dx = xj - xi, dy = yj - yi;`);
  lines.push(`      const t = Math.max(0, Math.min(1, ((x - xi) * dx + (y - yi) * dy) / (dx*dx + dy*dy || 1e-12)));`);
  lines.push(`      const px = xi + t * dx - x, py = yi + t * dy - y;`);
  lines.push(`      const dd = px*px + py*py;`);
  lines.push(`      if (dd < d) d = dd;`);
  lines.push(`      // even-odd crossing`);
  lines.push(`      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;`);
  lines.push(`    }`);
  lines.push(`  }`);
  lines.push(`  return (inside ? 1 : -1) * Math.sqrt(d);`);
  lines.push(`}`);
  lines.push('');

  const chunkNames = [];
  segments.forEach((seg, index) => {
    if (seg.type === 'smooth') {
      lines.push(...emitSmoothSegment(sections, seg, index, zLo, zHi, step, edge, bbox, decimals));
      chunkNames.push(`chunk_${index}`);
    } else {
      const { lines: segLines, hasChunk } = emitBandedSegment(sections, seg, index, step, decimals);
      lines.push(...segLines);
      if (hasChunk) chunkNames.push(`chunk_${index}`);
    }
    lines.push('');
  });

  lines.push(`let solid = ${chunkNames[0]};`);
  for (let i = 1; i < chunkNames.length; i++) lines.push(`solid = solid.add(${chunkNames[i]});`);

  if (segments.length > 1) {
    lines.push('');
    lines.push(`// hybrid smooth+banded assembly can leave sliver fragments at the seams — drop`);
    lines.push(`// any decomposed piece under ${SLIVER_MIN_VOLUME}mm³ before the (larger) debris voids below.`);
    lines.push(`{`);
    lines.push(`  let clean = null;`);
    lines.push(`  for (const part of solid.decompose()) {`);
    lines.push(`    if (part.volume() > ${SLIVER_MIN_VOLUME}) clean = clean ? clean.add(part) : part;`);
    lines.push(`  }`);
    lines.push(`  solid = clean;`);
    lines.push(`}`);
  }

  if (voids.length) {
    lines.push('');
    lines.push(`// internal debris-shell voids the levelSet resolution doesn't reproduce`);
    lines.push(`// (measured on the target — see this part's notes.md / splitStl.mjs):`);
    for (const v of voids) {
      lines.push(
        `solid = solid.subtract(Manifold.cube([${round(v.w, decimals)}, ${round(v.h, decimals)}, ${round(v.d, decimals)}], true).translate([${round(v.x, decimals)}, ${round(v.y, decimals)}, ${round(v.z, decimals)}]));`,
      );
    }
  }

  lines.push('');
  lines.push('return solid;');
  lines.push('');
  return lines.join('\n');
}

function parseArgs(argv) {
  const args = { target: null, step: 0.15, dp: 0.02, edge: 0.11, out: null, voids: null, minStable: MIN_STABLE_MM_DEFAULT };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--step') args.step = parseFloat(argv[++i]);
    else if (a === '--dp') args.dp = parseFloat(argv[++i]);
    else if (a === '--edge') args.edge = parseFloat(argv[++i]);
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--voids') args.voids = argv[++i];
    else if (a === '--min-stable') args.minStable = parseFloat(argv[++i]);
    else if (!args.target) args.target = a;
    else throw new Error('genLevelSet: unexpected argument ' + a);
  }
  if (!args.target) {
    console.error(
      'Usage: node scripts/inverse-cad/genLevelSet.mjs <target.stl> [--step 0.15] [--dp 0.02] [--edge 0.11] [--out FILE.js] [--voids "x,y,z,w,h,d;..."] [--min-stable 0.45]',
    );
    process.exit(2);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  const targetPath = resolve(args.target);
  const buf = readFileSync(targetPath);
  const mesh = parseStl(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
  const voids = parseVoids(args.voids);

  const code = buildCandidateCode(mesh, targetPath, {
    step: args.step,
    dpTol: args.dp,
    edge: args.edge,
    voids,
    decimals: 3,
    minStableMm: args.minStable,
  });

  const outPath = args.out
    ? resolve(args.out)
    : join(dirname(targetPath), basename(targetPath, extname(targetPath)) + '.levelset.js');
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, code);

  console.log(JSON.stringify({ out: outPath, sizeBytes: Buffer.byteLength(code, 'utf8') }, null, 2));
}

const isMain = process.argv[1] && import.meta.url.endsWith(basename(process.argv[1]));
if (isMain) {
  main().catch((e) => {
    console.error('genLevelSet failed:', e?.stack || e?.message || e);
    process.exit(1);
  });
}

export { buildCandidateCode, parseVoids, buildSections, classifySections };
