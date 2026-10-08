// Mesh → code transpiler: slices a triangle soup into thin Z sections,
// DP-simplifies each section's contours, and emits self-contained manifold-js
// code whose sdf(x,y,z) is a Z-lerp between adjacent sections' 2D signed
// distance fields, meshed with Manifold.levelSet — a smooth editable remake
// of the input mesh, with no reference back to the import.
//
// Ported and adapted from scripts/inverse-cad/genLevelSet.mjs (the generator
// behind the converged Benchy/Dummy-13 reconstructions). In-app adaptations:
//   - multi-component inputs are split (weld + BFS), converted per component
//     with tight per-component bounds/classification, and composed;
//   - resolution auto-scales from the mesh's own bbox against a levelSet
//     cell budget (the app has no fixed physical unit), with explicit
//     step/edge/dp overrides for power users and the AI loop;
//   - numeric precision adapts to the derived tolerance.
//
// The smooth/banded hybrid is inherited unchanged: naive Z-lerp SDF blending
// fabricates spurious handles wherever a slice has more than one separate
// outer blob, so those runs fall back to flat per-slice extrusions welded to
// the smooth chunks with a small overlap (see genLevelSet.mjs's docstring
// for the empirical history).

import type { TriangleSoup } from './slice2d';
import { sliceMesh, douglasPeucker, polygonSignedArea } from './slice2d';
import { connectedComponents, meshBBox } from './meshComponents';

/** Ratios inherited from the headless generator's validated defaults
 *  (step 0.15 / dp 0.02 / edge 0.11 on ~40mm parts). */
const STEP_PER_EDGE = 1.4;
const DP_PER_STEP = 0.13;
const MIN_STABLE_STEPS = 3;
/** levelSet grid margin beyond a component's XY bbox, in edge lengths. */
const XY_MARGIN_EDGES = 4;
/** Weld overlaps at hybrid seams / within banded stacks, as step fractions. */
const WELD_OVERLAP_STEPS = 1 / 3;
const BAND_WELD_EPS_STEPS = 1 / 3;
/** Components smaller than this fraction of the whole AND under this many
 *  triangles are export debris (sub-mm specks ride along in many STLs). */
const DEBRIS_DIAG_FRACTION = 0.01;
const DEBRIS_MAX_TRIS = 100;
/** Hard cap on converted components — beyond this the smallest are dropped
 *  with a warning rather than generating unbounded code. */
const MAX_COMPONENTS = 32;

export interface SectionCodeOptions {
  /** levelSet cell budget across all smooth segments — the speed/quality knob. */
  cellBudget: number;
  /** Optional explicit overrides (world units); derived from bbox when absent. */
  step?: number;
  edge?: number;
  dpTol?: number;
  minStable?: number;
  /** Name recorded in the generated header comment. */
  sourceName?: string;
  onProgress?: (fraction: number) => void;
}

export interface DerivedOptions {
  step: number;
  edge: number;
  dpTol: number;
  minStable: number;
  decimals: number;
}

export interface ReconstructionStats {
  components: number;
  droppedComponents: number;
  sections: number;
  smoothSegments: number;
  bandedSegments: number;
  /** Estimated levelSet sample count — proportional to build time. */
  estCells: number;
  codeBytes: number;
  options: DerivedOptions;
  warnings: string[];
}

export interface ReconstructionResult {
  code: string;
  stats: ReconstructionStats;
}

interface Section {
  z: number;
  contours: Array<{ points: number[]; isHole: boolean }>;
}

interface Segment {
  type: 'smooth' | 'banded';
  start: number;
  end: number;
}

function round(v: number, decimals: number): number {
  return +v.toFixed(decimals);
}

function jsonReplacer(decimals: number): (k: string, v: unknown) => unknown {
  return (_k, v) => (typeof v === 'number' && Number.isFinite(v) ? round(v, decimals) : v);
}

// Force CCW winding — geom.fromPoints needs a consistently-wound outline.
function ccw(points: Float64Array): Float64Array {
  if (polygonSignedArea(points) >= 0) return points;
  const n = points.length / 2;
  const out = new Float64Array(points.length);
  for (let i = 0; i < n; i++) {
    out[i * 2] = points[(n - 1 - i) * 2];
    out[i * 2 + 1] = points[(n - 1 - i) * 2 + 1];
  }
  return out;
}

function fmtPts(points: Float64Array, decimals: number): string {
  const parts: string[] = [];
  for (let i = 0; i < points.length; i += 2) {
    parts.push(`[${points[i].toFixed(decimals)},${points[i + 1].toFixed(decimals)}]`);
  }
  return '[' + parts.join(',') + ']';
}

function sliceSection(mesh: TriangleSoup, z: number, dpTol: number): Section['contours'] {
  // Open contours (non-watertight slice) are dropped — both the SDF even-odd
  // test and the banded fallback need closed loops.
  return sliceMesh(mesh, 'z', z)
    .filter((c) => !c.open)
    .map((c) => ({ points: Array.from(douglasPeucker(c.points, dpTol)), isHole: c.isHole }));
}

function buildSections(
  mesh: TriangleSoup,
  zLo: number,
  zHi: number,
  step: number,
  dpTol: number,
  onSection?: () => void,
): Section[] {
  const n = Math.max(1, Math.round((zHi - zLo) / step));
  const sections: Section[] = [];
  for (let i = 0; i < n; i++) {
    const z = zLo + step / 2 + i * step;
    sections.push({ z, contours: sliceSection(mesh, z, dpTol) });
    onSection?.();
  }
  return sections;
}

// Classify sections into SMOOTH (single outer blob held for >= minStable) vs
// BANDED (multi-blob or short-lived) runs — see the module docstring.
function classifySections(sections: Section[], step: number, minStable: number): Segment[] {
  const outerCounts = sections.map((s) => s.contours.filter((c) => !c.isHole).length);
  const minRunLen = Math.max(3, Math.round(minStable / step));

  const runs: Array<{ start: number; end: number; stable: boolean }> = [];
  let start = 0;
  for (let i = 1; i <= outerCounts.length; i++) {
    if (i === outerCounts.length || (outerCounts[i] === 1) !== (outerCounts[start] === 1)) {
      const single = outerCounts[start] === 1;
      runs.push({ start, end: i - 1, stable: single && i - start >= minRunLen });
      start = i;
    }
  }

  const segments: Segment[] = [];
  for (const run of runs) {
    const type = run.stable ? 'smooth' : 'banded';
    const last = segments[segments.length - 1];
    if (last && last.type === type) last.end = run.end;
    else segments.push({ type, start: run.start, end: run.end });
  }
  return segments;
}

/** Derive resolution from the whole model's bbox and the cell budget. */
export function deriveOptions(
  bbox: { min: [number, number, number]; max: [number, number, number] },
  cellBudget: number,
  overrides: Pick<SectionCodeOptions, 'step' | 'edge' | 'dpTol' | 'minStable'> = {},
): DerivedOptions {
  const dx = Math.max(bbox.max[0] - bbox.min[0], 1e-9);
  const dy = Math.max(bbox.max[1] - bbox.min[1], 1e-9);
  const dz = Math.max(bbox.max[2] - bbox.min[2], 1e-9);
  const diag = Math.hypot(dx, dy, dz);
  const volume = dx * dy * dz;
  let edge = overrides.edge ?? Math.cbrt(volume / Math.max(cellBudget, 1000));
  edge = Math.min(Math.max(edge, diag / 2000), diag / 50);
  let step = overrides.step ?? edge * STEP_PER_EDGE;
  step = Math.min(Math.max(step, dz / 600), dz / 8);
  const dpTol = overrides.dpTol ?? step * DP_PER_STEP;
  const minStable = overrides.minStable ?? step * MIN_STABLE_STEPS;
  const decimals = Math.min(6, Math.max(1, Math.ceil(-Math.log10(dpTol)) + 1));
  return { step, edge, dpTol, minStable, decimals };
}

interface EmitContext {
  step: number;
  edge: number;
  decimals: number;
  weldOverlap: number;
  bandWeldEps: number;
  sliverMinVolume: number;
}

function emitSmoothSegment(
  sections: Section[],
  seg: Segment,
  index: number,
  prefix: string,
  zLo: number,
  zHi: number,
  bbox: { min: [number, number, number]; max: [number, number, number] },
  ctx: EmitContext,
): { lines: string[]; cells: number } {
  const { step, edge, decimals, weldOverlap } = ctx;
  const xyMargin = XY_MARGIN_EDGES * edge;
  const slice = sections.slice(seg.start, seg.end + 1);
  const sectionsSrc = JSON.stringify(
    slice.map((s) => [s.z, s.contours.map((c) => c.points)]),
    jsonReplacer(decimals),
  );
  const isGlobalBottom = seg.start === 0;
  const isGlobalTop = seg.end === sections.length - 1;
  const segZLo = slice[0].z - step / 2;
  const segZHi = slice[slice.length - 1].z + step / 2;
  const boundsZMin = isGlobalBottom ? zLo - 2 * step : segZLo - weldOverlap;
  const boundsZMax = isGlobalTop ? zHi + 2 * step : segZHi + weldOverlap;
  const boundsMin = [bbox.min[0] - xyMargin, bbox.min[1] - xyMargin, boundsZMin];
  const boundsMax = [bbox.max[0] + xyMargin, bbox.max[1] + xyMargin, boundsZMax];
  const cells =
    ((boundsMax[0] - boundsMin[0]) * (boundsMax[1] - boundsMin[1]) * (boundsMax[2] - boundsMin[2])) /
    (edge * edge * edge);

  const lines: string[] = [];
  lines.push(
    `// smooth segment ${index}: ${slice.length} sections, z∈[${round(segZLo, decimals)},${round(segZHi, decimals)}] — SDF-interpolated`,
  );
  lines.push(`const ${prefix}SECTIONS_${index} = ${sectionsSrc};`);
  lines.push(`function ${prefix}sdf_${index}(p) {`);
  lines.push(`  const z = p[2];`);
  // Every segment boundary needs a genuine flat cap (not a bare bounds-box
  // truncation) — an SDF interior exceeding the sampling box produces a
  // jagged "egg-crate" closure following the grid cells.
  const capLo = isGlobalBottom ? `z - ${round(zLo, decimals)}` : `z - ${round(boundsZMin, decimals)}`;
  const capHi = isGlobalTop ? `${round(zHi, decimals)} - z` : `${round(boundsZMax, decimals)} - z`;
  lines.push(`  const capD = Math.min(${capLo}, ${capHi}); // flat cap at this segment's bounds edge`);
  lines.push(`  const f = (z - (${round(segZLo, decimals)} + ${step} / 2)) / ${step};`);
  lines.push(`  const i = Math.max(0, Math.min(${prefix}SECTIONS_${index}.length - 1, Math.floor(f)));`);
  lines.push(`  const i2 = Math.max(0, Math.min(${prefix}SECTIONS_${index}.length - 1, i + 1));`);
  lines.push(`  const t = Math.max(0, Math.min(1, f - i));`);
  lines.push(`  const a = sdf2d(${prefix}SECTIONS_${index}[i][1], p[0], p[1]);`);
  lines.push(`  const b = i2 === i ? a : sdf2d(${prefix}SECTIONS_${index}[i2][1], p[0], p[1]);`);
  lines.push(`  return Math.min((1 - t) * a + t * b, capD);`);
  lines.push(`}`);
  lines.push(
    `const ${prefix}bounds_${index} = { min: [${boundsMin.map((v) => round(v, decimals)).join(', ')}], max: [${boundsMax.map((v) => round(v, decimals)).join(', ')}] };`,
  );
  lines.push(`const ${prefix}chunk_${index} = Manifold.levelSet(${prefix}sdf_${index}, ${prefix}bounds_${index}, ${edge});`);
  return { lines, cells };
}

function emitBandedSegment(
  sections: Section[],
  seg: Segment,
  index: number,
  prefix: string,
  ctx: EmitContext,
): { lines: string[]; hasChunk: boolean } {
  const { step, decimals, weldOverlap, bandWeldEps } = ctx;
  const isGlobalBottom = seg.start === 0;
  const isGlobalTop = seg.end === sections.length - 1;
  const lines: string[] = [];
  lines.push(`// banded segment ${index}: sections ${seg.start}-${seg.end} — outer-loop count is volatile`);
  lines.push(`// here (separated blobs), so this run uses flat per-slice extrusion instead of SDF blending.`);
  const bandNames: string[] = [];
  for (let i = seg.start; i <= seg.end; i++) {
    const { z, contours } = sections[i];
    // A DP-simplified sliver can collapse to <3 points — drop those rather
    // than let geom.fromPoints throw.
    const valid = contours.filter((c) => c.points.length >= 6);
    const outers = valid.filter((c) => !c.isHole);
    const holes = valid.filter((c) => c.isHole);
    if (outers.length === 0) continue;
    const wind = (c: { points: number[] }) => ccw(Float64Array.from(c.points));
    outers.forEach((c, k) => {
      lines.push(`const ${prefix}s${index}_${i}_o${k} = geom.fromPoints(${fmtPts(wind(c), decimals)});`);
    });
    holes.forEach((c, k) => {
      lines.push(`const ${prefix}s${index}_${i}_h${k} = geom.fromPoints(${fmtPts(wind(c), decimals)});`);
    });
    let expr = `${prefix}s${index}_${i}_o0`;
    for (let k = 1; k < outers.length; k++) expr += `.add(${prefix}s${index}_${i}_o${k})`;
    for (let k = 0; k < holes.length; k++) expr += `.subtract(${prefix}s${index}_${i}_h${k})`;

    let bottom = z - step / 2;
    let top = z + step / 2 + bandWeldEps;
    if (i === seg.start && !isGlobalBottom) bottom -= weldOverlap;
    if (i === seg.end && !isGlobalTop) top += weldOverlap;
    const name = `${prefix}band_${index}_${i}`;
    lines.push(
      `const ${name} = (${expr}).extrude(${round(top - bottom, decimals)}, 0, 0, [1, 1]).translate([0, 0, ${round(bottom, decimals)}]);`,
    );
    bandNames.push(name);
  }
  if (bandNames.length === 0) {
    lines.push(`const ${prefix}chunk_${index} = null; // no material in this banded run`);
    return { lines, hasChunk: false };
  }
  let expr = bandNames[0];
  for (let k = 1; k < bandNames.length; k++) expr += `.add(${bandNames[k]})`;
  lines.push(`const ${prefix}chunk_${index} = ${expr};`);
  return { lines, hasChunk: true };
}

function emitComponent(
  soup: TriangleSoup,
  prefix: string,
  derived: DerivedOptions,
  minStable: number,
  onSection?: () => void,
): { lines: string[]; solidName: string | null; sections: number; smooth: number; banded: number; cells: number } {
  const bbox = meshBBox(soup);
  const zLo = bbox.min[2];
  const zHi = bbox.max[2];
  const ctx: EmitContext = {
    step: derived.step,
    edge: derived.edge,
    decimals: derived.decimals,
    weldOverlap: derived.step * WELD_OVERLAP_STEPS,
    bandWeldEps: derived.step * BAND_WELD_EPS_STEPS,
    // Hybrid seams can leave sliver fragments — anything under ~a couple of
    // cells' volume is seam debris, not model.
    sliverMinVolume: derived.edge ** 3 * 8,
  };
  const sections = buildSections(soup, zLo, zHi, derived.step, derived.dpTol, onSection);
  const segments = classifySections(sections, derived.step, minStable);
  const smooth = segments.filter((s) => s.type === 'smooth').length;

  const lines: string[] = [];
  let cells = 0;
  const chunkNames: string[] = [];
  segments.forEach((seg, index) => {
    if (seg.type === 'smooth') {
      const r = emitSmoothSegment(sections, seg, index, prefix, zLo, zHi, bbox, ctx);
      lines.push(...r.lines);
      cells += r.cells;
      chunkNames.push(`${prefix}chunk_${index}`);
    } else {
      const { lines: segLines, hasChunk } = emitBandedSegment(sections, seg, index, prefix, ctx);
      lines.push(...segLines);
      if (hasChunk) chunkNames.push(`${prefix}chunk_${index}`);
    }
    lines.push('');
  });

  if (chunkNames.length === 0) {
    return { lines, solidName: null, sections: sections.length, smooth, banded: segments.length - smooth, cells };
  }

  const solidName = `${prefix}solid`;
  lines.push(`let ${solidName} = ${chunkNames[0]};`);
  for (let i = 1; i < chunkNames.length; i++) lines.push(`${solidName} = ${solidName}.add(${chunkNames[i]});`);

  if (segments.length > 1) {
    lines.push(`// hybrid smooth+banded assembly can leave sliver fragments at the seams — drop them.`);
    lines.push(`{`);
    lines.push(`  let clean = null;`);
    lines.push(`  for (const part of ${solidName}.decompose()) {`);
    lines.push(`    if (part.volume() > ${round(ctx.sliverMinVolume, 6)}) clean = clean ? clean.add(part) : part;`);
    lines.push(`  }`);
    lines.push(`  if (clean) ${solidName} = clean;`);
    lines.push(`}`);
  }
  lines.push('');
  return { lines, solidName, sections: sections.length, smooth, banded: segments.length - smooth, cells };
}

/**
 * Convert a triangle soup into self-contained manifold-js code. Splits into
 * connected components, drops export debris, converts each component with
 * its own tight bounds, and composes the results.
 */
export function buildReconstructionCode(soup: TriangleSoup, opts: SectionCodeOptions): ReconstructionResult {
  if (soup.triangles.length < 9 * 4) throw new Error('convertToCode: mesh has too few triangles');
  const warnings: string[] = [];
  const wholeBBox = meshBBox(soup);
  const wholeDiag = Math.hypot(
    wholeBBox.max[0] - wholeBBox.min[0],
    wholeBBox.max[1] - wholeBBox.min[1],
    wholeBBox.max[2] - wholeBBox.min[2],
  );
  const derived = deriveOptions(wholeBBox, opts.cellBudget, opts);

  let components = connectedComponents(soup);
  const beforeDebris = components.length;
  components = components.filter((c) => {
    const b = meshBBox(c);
    const diag = Math.hypot(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]);
    return !(diag < wholeDiag * DEBRIS_DIAG_FRACTION && c.triangles.length / 9 < DEBRIS_MAX_TRIS);
  });
  const debrisDropped = beforeDebris - components.length;
  if (debrisDropped > 0) warnings.push(`dropped ${debrisDropped} debris component(s) (tiny specks in the source mesh)`);
  if (components.length > MAX_COMPONENTS) {
    warnings.push(`converted the largest ${MAX_COMPONENTS} of ${components.length} components`);
    components = components.slice(0, MAX_COMPONENTS);
  }
  if (components.length === 0) throw new Error('convertToCode: no substantial components in the mesh');

  // Progress: sections dominate generation time; pre-count them.
  const totalSections = components.reduce((acc, c) => {
    const b = meshBBox(c);
    return acc + Math.max(1, Math.round((b.max[2] - b.min[2]) / derived.step));
  }, 0);
  let doneSections = 0;
  const onSection = () => {
    doneSections++;
    if (doneSections % 8 === 0 || doneSections === totalSections) opts.onProgress?.(doneSections / totalSections);
  };

  const lines: string[] = [];
  lines.push(`// AUTO-GENERATED by Partwright convert-to-code${opts.sourceName ? ` — source: ${opts.sourceName}` : ''}`);
  lines.push(`// The surface is a smooth interpolation of measured Z-section signed-distance`);
  lines.push(`// fields, meshed with Manifold.levelSet. Multi-blob slice runs fall back to flat`);
  lines.push(`// per-slice extrusions. Every number below was measured from the source mesh.`);
  lines.push(`// Resolution: step ${round(derived.step, 4)}, levelSet edgeLength ${round(derived.edge, 4)} (smaller = finer + slower).`);
  lines.push(`const { Manifold, geom } = api;`);
  lines.push('');
  lines.push(`// signed distance to a polygon set (even-odd holes), positive INSIDE`);
  lines.push(`function sdf2d(polys, x, y) {`);
  lines.push(`  let d = Infinity, inside = false;`);
  lines.push(`  for (const poly of polys) {`);
  lines.push(`    const n = poly.length / 2;`);
  lines.push(`    for (let i = 0, j = n - 1; i < n; j = i++) {`);
  lines.push(`      const xi = poly[i*2], yi = poly[i*2+1], xj = poly[j*2], yj = poly[j*2+1];`);
  lines.push(`      const dx = xj - xi, dy = yj - yi;`);
  lines.push(`      const t = Math.max(0, Math.min(1, ((x - xi) * dx + (y - yi) * dy) / (dx*dx + dy*dy || 1e-12)));`);
  lines.push(`      const px = xi + t * dx - x, py = yi + t * dy - y;`);
  lines.push(`      const dd = px*px + py*py;`);
  lines.push(`      if (dd < d) d = dd;`);
  lines.push(`      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;`);
  lines.push(`    }`);
  lines.push(`  }`);
  lines.push(`  return (inside ? 1 : -1) * Math.sqrt(d);`);
  lines.push(`}`);
  lines.push('');

  const solidNames: string[] = [];
  let sections = 0,
    smooth = 0,
    banded = 0,
    cells = 0;
  components.forEach((component, ci) => {
    const prefix = components.length > 1 ? `c${ci}_` : '';
    if (components.length > 1) lines.push(`// ---- component ${ci + 1} of ${components.length} ----`);
    // The section data is flattened per-component; a component whose slices
    // never close (fully non-watertight) yields no chunks and is skipped.
    const r = emitComponent(component, prefix, derived, derived.minStable, onSection);
    lines.push(...r.lines);
    sections += r.sections;
    smooth += r.smooth;
    banded += r.banded;
    cells += r.cells;
    if (r.solidName) solidNames.push(r.solidName);
    else warnings.push(`component ${ci + 1} produced no closed sections (non-watertight?) and was skipped`);
  });

  if (solidNames.length === 0) throw new Error('convertToCode: no component produced closed sections — is the mesh watertight?');
  lines.push(
    solidNames.length === 1
      ? `return ${solidNames[0]};`
      : `return Manifold.compose([${solidNames.join(', ')}]);`,
  );
  lines.push('');

  const code = lines.join('\n');
  return {
    code,
    stats: {
      components: solidNames.length,
      droppedComponents: debrisDropped,
      sections,
      smoothSegments: smooth,
      bandedSegments: banded,
      estCells: Math.round(cells),
      codeBytes: code.length,
      options: derived,
      warnings,
    },
  };
}
