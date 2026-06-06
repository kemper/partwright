// Pure placement math + code-gen for the "place on plate" tools (drop-to-floor,
// center on plate). Kept dependency-light (only the MeshData type) so it lives
// in the fast vitest unit tier — see tests/unit/placement.test.ts.
//
// Two write-back strategies sit on top of this module (wired in main.ts):
//   - parametric — wrap the user's manifold-js source in an IIFE and append a
//     single `.translate([...])`, so the model stays editable code. `translateMesh`
//     is unused on this path; only `buildPlacementCode` is.
//   - bake — translate the baked mesh vertices (`translateMesh`) and commit it
//     through the same import-wrapper path the surface modifiers use. Required
//     whenever the model carries manual paint (whose world-space region
//     descriptors can't follow a parametric move) or isn't a manifold-js model.

import type { MeshData } from '../geometry/types';

export type Vec3 = [number, number, number];

export interface PlacementBox {
  min: Vec3;
  max: Vec3;
}

export interface PlacementOps {
  /** Sit the model's lowest point on Z = 0 (the print bed). */
  dropToFloor?: boolean;
  /** Center the bounding box on X (X-center → 0). */
  centerX?: boolean;
  /** Center the bounding box on Y (Y-center → 0). */
  centerY?: boolean;
  /** Center the bounding box on Z (Z-center → 0). Ignored when dropToFloor is set. */
  centerZ?: boolean;
}

/** Translate vertex positions by (dx,dy,dz) and return a new mesh. A rigid move
 *  leaves triangles, normals and per-triangle colors untouched. */
export function translateMesh(mesh: MeshData, dx: number, dy: number, dz: number): MeshData {
  const props = new Float32Array(mesh.vertProperties);
  const np = mesh.numProp;
  for (let i = 0; i < mesh.numVert; i++) {
    props[i * np] += dx;
    props[i * np + 1] += dy;
    props[i * np + 2] += dz;
  }
  return { ...mesh, vertProperties: props, triVerts: new Uint32Array(mesh.triVerts) };
}

/** The translation that applies the requested placement ops to a bounding box. */
export function computePlacementDelta(box: PlacementBox, ops: PlacementOps): Vec3 {
  const cx = (box.min[0] + box.max[0]) / 2;
  const cy = (box.min[1] + box.max[1]) / 2;
  const cz = (box.min[2] + box.max[2]) / 2;
  let dx = 0, dy = 0, dz = 0;
  if (ops.centerX) dx = -cx;
  if (ops.centerY) dy = -cy;
  if (ops.dropToFloor) dz = -box.min[2];
  else if (ops.centerZ) dz = -cz;
  return [dx, dy, dz];
}

/** A delta is a no-op (model already positioned) when every component is
 *  negligible relative to the model's size. Adaptive so it scales with units
 *  rather than hard-coding an absolute threshold. */
export function isNoopDelta(delta: Vec3, box: PlacementBox): boolean {
  const diag = Math.hypot(
    box.max[0] - box.min[0],
    box.max[1] - box.min[1],
    box.max[2] - box.min[2],
  );
  const eps = Math.max(1e-9, diag * 1e-6);
  return Math.abs(delta[0]) <= eps && Math.abs(delta[1]) <= eps && Math.abs(delta[2]) <= eps;
}

const SENTINEL = '@partwright-placement';

// Matches a wrapper this module previously emitted, capturing the inner code and
// the existing translate vector so repeated placements fold into a single
// wrapper instead of nesting IIFEs. Tolerant of the human-readable comment text.
const WRAPPER_RE =
  /^\/\/ @partwright-placement[^\n]*\nreturn \(\(\) => \{\n([\s\S]*)\n\}\)\(\)\.translate\(\[\s*(-?[\d.eE+]+)\s*,\s*(-?[\d.eE+]+)\s*,\s*(-?[\d.eE+]+)\s*\]\);\n?$/;

function fmt(n: number): string {
  // Compact, stable literal; avoid trailing float noise from summed deltas.
  const r = Number(n.toFixed(6));
  return Object.is(r, -0) ? '0' : String(r);
}

/** Wrap the user's manifold-js source so the whole returned model is translated
 *  by `delta`, preserving the original code verbatim (no re-indentation, so
 *  template literals are untouched). If `originalCode` is itself a wrapper this
 *  module produced, the deltas are summed and one wrapper is re-emitted; if the
 *  summed delta cancels out, the original inner code is returned unwrapped. */
export function buildPlacementCode(originalCode: string, delta: Vec3, label: string, date: string): string {
  let inner = originalCode;
  let [dx, dy, dz] = delta;
  const m = originalCode.match(WRAPPER_RE);
  if (m) {
    inner = m[1];
    dx += Number(m[2]);
    dy += Number(m[3]);
    dz += Number(m[4]);
  }
  if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9 && Math.abs(dz) < 1e-9) {
    return inner.endsWith('\n') ? inner : `${inner}\n`;
  }
  return `// ${SENTINEL} — ${label} (${date})\nreturn (() => {\n${inner}\n})().translate([${fmt(dx)}, ${fmt(dy)}, ${fmt(dz)}]);\n`;
}

/** Short version/label text for a set of placement ops, e.g. "drop to floor + center XY". */
export function placementLabel(ops: PlacementOps): string {
  const parts: string[] = [];
  if (ops.dropToFloor) parts.push('drop to floor');
  const axes = [ops.centerX ? 'X' : '', ops.centerY ? 'Y' : '', ops.centerZ ? 'Z' : ''].join('');
  if (axes) parts.push(`center ${axes}`);
  return parts.join(' + ') || 'placed';
}
