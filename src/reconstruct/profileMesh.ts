// Mesh profiler — the "how would an AI know a cylinder fits?" answer.
//
// Sweeps cross-sections along each axis, fits primitives (circle,
// rounded-rect) to every section's outer contour, and merges consecutive
// sections whose fit kind AND parameters hold steady into RUNS: "circular
// r≈2.31 from z=8.1..14.0" is a measured cylinder, "rect 12×8 cornerR 1
// from z=0..6" is a measured rounded box — no vision, no guessing. Organic
// regions (no fit passes) and multi-blob regions are reported as such so
// the caller knows where the section-interpolation baseline is the right
// tool. This is the browser port of the headless loop's profiling step.

import type { TriangleSoup, SliceAxis } from './slice2d';
import {
  sliceMesh,
  douglasPeucker,
  contourStats,
  fitCircle2D,
  fitRoundedRect2D,
  type CircleFit,
  type RoundedRectFit,
} from './slice2d';
import { meshBBox } from './meshComponents';

/** Fit-acceptance thresholds (relative to feature size — unit-free). */
const CIRCLE_RMS_REL = 0.02; // rms < 2% of radius → it IS a circle
/** Any <=N points lie near a circle trivially (4 corners of a square fit one
 *  EXACTLY) — require enough vertices for a circle verdict. A DP-simplified
 *  true circle keeps ~30+ points at the profiling tolerance; a square keeps 4. */
const CIRCLE_MIN_POINTS = 8;
const RECT_RMS_REL = 0.03; // rms < 3% of max(w,h) → it IS a (rounded) rect
/** Param drift tolerated within one run, relative to the param's size. */
const RUN_PARAM_TOL = 0.04;
/** Minimum sections for a primitive run — shorter runs fold into 'organic'. */
const MIN_RUN_SECTIONS = 3;

export type SectionKind = 'circle' | 'rect' | 'organic' | 'multi' | 'empty';

export interface SectionProbe {
  /** Coordinate along the swept axis. */
  at: number;
  kind: SectionKind;
  outerCount: number;
  holeCount: number;
  /** Stats + fits of the LARGEST outer contour (null when empty). */
  outer: {
    area: number;
    perimeter: number;
    centroid: [number, number];
    bboxMin: [number, number];
    bboxMax: [number, number];
  } | null;
  circle: CircleFit | null;
  rect: RoundedRectFit | null;
  /** Circle fits of up to 4 largest holes (bores read directly). */
  holes: CircleFit[];
}

export interface ProfileRun {
  kind: SectionKind;
  /** World-coordinate span along the swept axis. */
  from: number;
  to: number;
  sections: number;
  /** Mean fitted params over the run (present for circle/rect runs). */
  circle?: { cx: number; cy: number; r: number; rmsRel: number };
  rect?: { cx: number; cy: number; w: number; h: number; angleDeg: number; cornerR: number; rmsRel: number };
  /** Mean hole count across the run + the mid-run hole fits, for bores. */
  meanHoles?: number;
  sampleHoles?: CircleFit[];
}

export interface AxisProfile {
  axis: SliceAxis;
  /** 2D fit coordinates (u,v) map to world axes: z→(x,y), x→(y,z), y→(x,z). */
  uvAxes: [string, string];
  runs: ProfileRun[];
}

export interface MeshProfile {
  bbox: { min: [number, number, number]; max: [number, number, number] };
  sectionsPerAxis: number;
  axes: AxisProfile[];
}

const AXIS_SPAN: Record<SliceAxis, number> = { x: 0, y: 1, z: 2 };
const UV_NAMES: Record<SliceAxis, [string, string]> = { x: ['y', 'z'], y: ['x', 'z'], z: ['x', 'y'] };

/** Probe one section: slice, DP-simplify, fit primitives to the largest
 *  outer contour and up to 4 holes. Exported for the targeted single-slice
 *  measurement path (`profile({axis, at})`). */
export function probeSection(soup: TriangleSoup, axis: SliceAxis, at: number, dpTol: number): SectionProbe {
  const contours = sliceMesh(soup, axis, at).filter((c) => !c.open);
  const outers = contours.filter((c) => !c.isHole);
  const holes = contours.filter((c) => c.isHole);
  if (outers.length === 0) {
    return { at, kind: 'empty', outerCount: 0, holeCount: 0, outer: null, circle: null, rect: null, holes: [] };
  }
  const largest = outers[0]; // sliceMesh sorts by area desc
  const pts = douglasPeucker(largest.points, dpTol);
  const stats = contourStats({ points: pts });
  const circle = fitCircle2D(pts);
  const rect = fitRoundedRect2D(pts);
  const holeFits = holes.slice(0, 4).map((h) => fitCircle2D(douglasPeucker(h.points, dpTol)));

  let kind: SectionKind;
  if (outers.length > 1) kind = 'multi';
  else if (pts.length / 2 >= CIRCLE_MIN_POINTS && circle.r > 0 && circle.rmsResidual < CIRCLE_RMS_REL * circle.r) kind = 'circle';
  else if (rect.rmsResidual < RECT_RMS_REL * Math.max(rect.w, rect.h)) kind = 'rect';
  else kind = 'organic';

  return {
    at,
    kind,
    outerCount: outers.length,
    holeCount: holes.length,
    outer: stats,
    circle,
    rect,
    holes: holeFits,
  };
}

function near(a: number, b: number, scale: number): boolean {
  return Math.abs(a - b) <= RUN_PARAM_TOL * Math.max(scale, 1e-9);
}

function sameRun(a: SectionProbe, b: SectionProbe): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'circle' && a.circle && b.circle) {
    return (
      near(a.circle.r, b.circle.r, a.circle.r) &&
      near(a.circle.cx, b.circle.cx, a.circle.r) &&
      near(a.circle.cy, b.circle.cy, a.circle.r)
    );
  }
  if (a.kind === 'rect' && a.rect && b.rect) {
    const s = Math.max(a.rect.w, a.rect.h);
    return (
      near(a.rect.w, b.rect.w, s) &&
      near(a.rect.h, b.rect.h, s) &&
      near(a.rect.cx, b.rect.cx, s) &&
      near(a.rect.cy, b.rect.cy, s)
    );
  }
  return true; // organic/multi/empty merge on kind alone
}

function buildRun(probes: SectionProbe[], step: number): ProfileRun {
  const first = probes[0];
  const last = probes[probes.length - 1];
  const run: ProfileRun = {
    kind: first.kind,
    from: first.at - step / 2,
    to: last.at + step / 2,
    sections: probes.length,
  };
  const mean = (get: (p: SectionProbe) => number) => probes.reduce((acc, p) => acc + get(p), 0) / probes.length;
  if (first.kind === 'circle') {
    const r = mean((p) => p.circle?.r ?? 0);
    run.circle = {
      cx: mean((p) => p.circle?.cx ?? 0),
      cy: mean((p) => p.circle?.cy ?? 0),
      r,
      rmsRel: r > 0 ? mean((p) => p.circle?.rmsResidual ?? 0) / r : Infinity,
    };
  }
  if (first.kind === 'rect') {
    const w = mean((p) => p.rect?.w ?? 0);
    const h = mean((p) => p.rect?.h ?? 0);
    run.rect = {
      cx: mean((p) => p.rect?.cx ?? 0),
      cy: mean((p) => p.rect?.cy ?? 0),
      w,
      h,
      angleDeg: mean((p) => p.rect?.angleDeg ?? 0),
      cornerR: mean((p) => p.rect?.cornerR ?? 0),
      rmsRel: mean((p) => p.rect?.rmsResidual ?? 0) / Math.max(w, h, 1e-9),
    };
  }
  if (first.kind !== 'empty') {
    run.meanHoles = mean((p) => p.holeCount);
    if (run.meanHoles > 0) run.sampleHoles = probes[Math.floor(probes.length / 2)].holes;
  }
  return run;
}

/** Merge probes into runs; primitive runs shorter than MIN_RUN_SECTIONS
 *  demote to organic and fold into their neighbours. */
function detectRuns(probes: SectionProbe[], step: number): ProfileRun[] {
  const groups: SectionProbe[][] = [];
  for (const p of probes) {
    const g = groups[groups.length - 1];
    if (g && sameRun(g[g.length - 1], p)) g.push(p);
    else groups.push([p]);
  }
  // Demote short primitive runs, then re-merge adjacent same-kind groups.
  const demoted = groups.map((g) => {
    if ((g[0].kind === 'circle' || g[0].kind === 'rect') && g.length < MIN_RUN_SECTIONS) {
      return g.map((p) => ({ ...p, kind: 'organic' as SectionKind }));
    }
    return g;
  });
  const merged: SectionProbe[][] = [];
  for (const g of demoted) {
    const last = merged[merged.length - 1];
    if (last && last[0].kind === g[0].kind && (g[0].kind === 'organic' || g[0].kind === 'multi' || g[0].kind === 'empty')) {
      last.push(...g);
    } else merged.push(g);
  }
  return merged.map((g) => buildRun(g, step));
}

export interface ProfileOptions {
  /** Sections sampled per axis (default 48). */
  sectionsPerAxis?: number;
  /** Axes to sweep (default all three). */
  axes?: SliceAxis[];
  onProgress?: (fraction: number) => void;
}

export function profileMesh(soup: TriangleSoup, opts: ProfileOptions = {}): MeshProfile {
  const bbox = meshBBox(soup);
  const n = Math.max(8, Math.min(256, Math.round(opts.sectionsPerAxis ?? 48)));
  const axes = opts.axes ?? (['z', 'x', 'y'] as SliceAxis[]);
  const diag = Math.hypot(bbox.max[0] - bbox.min[0], bbox.max[1] - bbox.min[1], bbox.max[2] - bbox.min[2]);
  const dpTol = diag / 1500; // fine enough to not blur real corners into arcs

  const out: AxisProfile[] = [];
  let done = 0;
  const total = axes.length * n;
  for (const axis of axes) {
    const ai = AXIS_SPAN[axis];
    const lo = bbox.min[ai];
    const hi = bbox.max[ai];
    const step = (hi - lo) / n;
    const probes: SectionProbe[] = [];
    for (let i = 0; i < n; i++) {
      probes.push(probeSection(soup, axis, lo + (i + 0.5) * step, dpTol));
      done++;
      if (done % 8 === 0 || done === total) opts.onProgress?.(done / total);
    }
    out.push({ axis, uvAxes: UV_NAMES[axis], runs: detectRuns(probes, step) });
  }
  return { bbox, sectionsPerAxis: n, axes: out };
}
