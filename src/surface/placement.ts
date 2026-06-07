// Pure placement + rotation math and code-gen for the "Place/Rotate" tools
// (drop-to-floor, center on plate, free rotate, auto lay-flat). Kept
// dependency-light (only the MeshData type) so it lives in the fast vitest unit
// tier — see tests/unit/placement.test.ts.
//
// Two write-back strategies sit on top of this module (wired in main.ts):
//   - parametric — append a chain of `.rotate([...])` / `.translate([...])`
//     calls to the user's manifold-js source (wrapped in an IIFE), so the model
//     stays editable code. `buildTransformCode` emits/extends that chain.
//   - bake — apply the same chain to the baked mesh vertices (`applySteps`) and
//     commit it through the import-wrapper path the surface modifiers use.
// Both paths share `eulerToMatrix`, so a baked rotation is bit-identical to the
// `.rotate(...)` manifold would run (verified by a parity e2e).

import type { MeshData } from '../geometry/types';

export type Vec3 = [number, number, number];
/** Row-major 3×3, applied as p'[i] = Σ_j M[i*3+j] · p[j]. */
export type Mat3 = number[];

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

/** One step in a transform chain. Rotation angles are Euler degrees in
 *  manifold's `.rotate([x,y,z])` convention (X applied first, then Y, then Z). */
export type TransformStep =
  | { kind: 'translate'; v: Vec3 }
  | { kind: 'rotate'; v: Vec3 };

const DEG = Math.PI / 180;

// ---- linear algebra -------------------------------------------------------

function matMul(a: Mat3, b: Mat3): Mat3 {
  const out = new Array(9).fill(0) as Mat3;
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      let s = 0;
      for (let k = 0; k < 3; k++) s += a[r * 3 + k] * b[k * 3 + c];
      out[r * 3 + c] = s;
    }
  }
  return out;
}

/** Rotation matrix for manifold's `.rotate([rx,ry,rz])`: M = Rz·Ry·Rx, so the X
 *  rotation is applied to the point first. Bake and parametric paths both use
 *  this, guaranteeing they agree with the engine's rotation. */
export function eulerToMatrix(rx: number, ry: number, rz: number): Mat3 {
  const a = rx * DEG, b = ry * DEG, c = rz * DEG;
  const ca = Math.cos(a), sa = Math.sin(a);
  const cb = Math.cos(b), sb = Math.sin(b);
  const cc = Math.cos(c), sc = Math.sin(c);
  const Rx: Mat3 = [1, 0, 0, 0, ca, -sa, 0, sa, ca];
  const Ry: Mat3 = [cb, 0, sb, 0, 1, 0, -sb, 0, cb];
  const Rz: Mat3 = [cc, -sc, 0, sc, cc, 0, 0, 0, 1];
  return matMul(Rz, matMul(Ry, Rx));
}

/** Inverse of eulerToMatrix: extract Euler degrees (manifold order) from a
 *  rotation matrix, with a gimbal-lock fallback when cos(ry) ≈ 0. */
export function matrixToEuler(m: Mat3): Vec3 {
  // M20 = -sin(ry); M21 = cos(ry)sin(rx); M22 = cos(ry)cos(rx);
  // M10 = sin(rz)cos(ry); M00 = cos(rz)cos(ry).
  const sb = Math.max(-1, Math.min(1, -m[6]));
  const b = Math.asin(sb);
  const cb = Math.cos(b);
  let a: number, c: number;
  if (Math.abs(cb) > 1e-6) {
    a = Math.atan2(m[7], m[8]);
    c = Math.atan2(m[3], m[0]);
  } else {
    // Gimbal lock: fold rx into rz.
    a = 0;
    c = Math.atan2(-m[1], m[4]);
  }
  return [a / DEG, b / DEG, c / DEG];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function dot(a: Vec3, b: Vec3): number { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function len(a: Vec3): number { return Math.hypot(a[0], a[1], a[2]); }

/** Rotation matrix mapping unit vector `n` onto unit vector `d` (shortest arc).
 *  Handles the parallel and antiparallel degeneracies. */
export function rotationFromTo(n: Vec3, d: Vec3): Mat3 {
  const v = cross(n, d);
  const s = len(v);
  const c = dot(n, d);
  if (s < 1e-9) {
    if (c > 0) return [1, 0, 0, 0, 1, 0, 0, 0, 1]; // already aligned
    // Antiparallel: 180° about any axis perpendicular to n.
    const axis: Vec3 = Math.abs(n[0]) < 0.9 ? cross(n, [1, 0, 0]) : cross(n, [0, 1, 0]);
    const al = len(axis) || 1;
    const [x, y, z] = [axis[0] / al, axis[1] / al, axis[2] / al];
    // Rodrigues at θ=180°: R = 2·(axis⊗axis) − I.
    return [
      2 * x * x - 1, 2 * x * y, 2 * x * z,
      2 * x * y, 2 * y * y - 1, 2 * y * z,
      2 * x * z, 2 * y * z, 2 * z * z - 1,
    ];
  }
  // Rodrigues via skew: R = I + [v]× + [v]×² · (1/(1+c)).
  const k = 1 / (1 + c);
  const K: Mat3 = [0, -v[2], v[1], v[2], 0, -v[0], -v[1], v[0], 0];
  const K2 = matMul(K, K);
  const out = new Array(9) as Mat3;
  for (let i = 0; i < 9; i++) out[i] = (i % 4 === 0 ? 1 : 0) + K[i] + K2[i] * k;
  return out;
}

// ---- mesh transforms ------------------------------------------------------

/** Apply a transform chain to a copy of the mesh's vertex positions. Used by the
 *  bake write-back and for measuring the post-rotation bbox (lay-flat). */
export function applySteps(mesh: MeshData, steps: TransformStep[]): MeshData {
  const props = new Float32Array(mesh.vertProperties);
  const np = mesh.numProp;
  for (const step of steps) {
    if (step.kind === 'translate') {
      const [dx, dy, dz] = step.v;
      for (let i = 0; i < mesh.numVert; i++) {
        props[i * np] += dx; props[i * np + 1] += dy; props[i * np + 2] += dz;
      }
    } else {
      const m = eulerToMatrix(step.v[0], step.v[1], step.v[2]);
      for (let i = 0; i < mesh.numVert; i++) {
        const o = i * np;
        const x = props[o], y = props[o + 1], z = props[o + 2];
        props[o] = m[0] * x + m[1] * y + m[2] * z;
        props[o + 1] = m[3] * x + m[4] * y + m[5] * z;
        props[o + 2] = m[6] * x + m[7] * y + m[8] * z;
      }
    }
  }
  return { ...mesh, vertProperties: props, triVerts: new Uint32Array(mesh.triVerts) };
}

/** Axis-aligned bounding box of a mesh's vertex positions. */
export function meshBox(mesh: MeshData): PlacementBox {
  const np = mesh.numProp;
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < mesh.numVert; i++) {
    for (let a = 0; a < 3; a++) {
      const v = mesh.vertProperties[i * np + a];
      if (v < min[a]) min[a] = v;
      if (v > max[a]) max[a] = v;
    }
  }
  return { min, max };
}

function boxCenter(box: PlacementBox): Vec3 {
  return [
    (box.min[0] + box.max[0]) / 2,
    (box.min[1] + box.max[1]) / 2,
    (box.min[2] + box.max[2]) / 2,
  ];
}

// ---- placement deltas -----------------------------------------------------

/** The translation that applies the requested placement ops to a bounding box. */
export function computePlacementDelta(box: PlacementBox, ops: PlacementOps): Vec3 {
  const c = boxCenter(box);
  let dx = 0, dy = 0, dz = 0;
  if (ops.centerX) dx = -c[0];
  if (ops.centerY) dy = -c[1];
  if (ops.dropToFloor) dz = -box.min[2];
  else if (ops.centerZ) dz = -c[2];
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

/** Rotation (Euler degrees) is negligible when every angle is within ~0.01°. */
export function isNoopRotation(euler: Vec3): boolean {
  return Math.abs(euler[0]) < 1e-2 && Math.abs(euler[1]) < 1e-2 && Math.abs(euler[2]) < 1e-2;
}

/** Wrap a free rotation so it spins the model about its own center rather than
 *  the world origin: translate(-center) → rotate → translate(+center). */
export function rotateAboutCenterSteps(box: PlacementBox, euler: Vec3): TransformStep[] {
  if (isNoopRotation(euler)) return [];
  const c = boxCenter(box);
  return [
    { kind: 'translate', v: [-c[0], -c[1], -c[2]] },
    { kind: 'rotate', v: euler },
    { kind: 'translate', v: [c[0], c[1], c[2]] },
  ];
}

// ---- auto lay-flat: find the flattest face --------------------------------

/** Find the model's largest flat face and the Euler rotation (manifold order)
 *  that lays it on the bed (its outward normal → −Z). Returns null for a
 *  degenerate mesh or one with no usable area. The rotation is about the world
 *  origin; callers wrap it about the model center and then drop to the floor. */
export function bestFlatDownRotation(mesh: MeshData): Vec3 | null {
  const np = mesh.numProp;
  const pos = mesh.vertProperties;
  const tv = mesh.triVerts;
  // Bucket triangles by quantized normal, summing area and an area-weighted
  // normal so we recover a precise representative direction per flat face.
  const buckets = new Map<string, { area: number; n: Vec3 }>();
  const get = (i: number): Vec3 => [pos[i * np], pos[i * np + 1], pos[i * np + 2]];
  for (let t = 0; t < mesh.numTri; t++) {
    const a = get(tv[t * 3]), b = get(tv[t * 3 + 1]), c = get(tv[t * 3 + 2]);
    const e1: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const e2: Vec3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const cr = cross(e1, e2);
    const area2 = len(cr);
    // Skip degenerate and non-finite triangles (a NaN vertex would otherwise
    // bucket under "NaN,NaN,NaN" and poison the chosen rotation).
    if (!(area2 >= 1e-12)) continue;
    const n: Vec3 = [cr[0] / area2, cr[1] / area2, cr[2] / area2];
    const area = area2 / 2;
    const key = `${Math.round(n[0] * 100)},${Math.round(n[1] * 100)},${Math.round(n[2] * 100)}`;
    const cur = buckets.get(key);
    if (cur) {
      cur.area += area;
      cur.n = [cur.n[0] + n[0] * area, cur.n[1] + n[1] * area, cur.n[2] + n[2] * area];
    } else {
      buckets.set(key, { area, n: [n[0] * area, n[1] * area, n[2] * area] });
    }
  }
  let best: { area: number; n: Vec3 } | null = null;
  for (const v of buckets.values()) if (!best || v.area > best.area) best = v;
  if (!best) return null;
  const nl = len(best.n) || 1;
  const normal: Vec3 = [best.n[0] / nl, best.n[1] / nl, best.n[2] / nl];
  const R = rotationFromTo(normal, [0, 0, -1]);
  return matrixToEuler(R);
}

// ---- parametric code-gen --------------------------------------------------

const SENTINEL = '@partwright-placement';

// Captures a wrapper this module emitted: the inner code and the existing
// transform chain (a run of `.rotate(...)`/`.translate(...)` calls). Tolerant of
// the human-readable comment text so repeated transforms extend one wrapper
// instead of nesting IIFEs.
const WRAPPER_RE =
  /^\/\/ @partwright-placement[^\n]*\nreturn \(\(\) => \{\n([\s\S]*)\n\}\)\(\)((?:\.(?:rotate|translate)\(\[[^\]]*\]\))+);\n?$/;
const CALL_RE = /\.(rotate|translate)\(\[\s*(-?[\d.eE+]+)\s*,\s*(-?[\d.eE+]+)\s*,\s*(-?[\d.eE+]+)\s*\]\)/g;

function fmt(n: number): string {
  const r = Number(n.toFixed(6));
  return Object.is(r, -0) ? '0' : String(r);
}

function parseChain(chain: string): TransformStep[] {
  const steps: TransformStep[] = [];
  for (const m of chain.matchAll(CALL_RE)) {
    steps.push({ kind: m[1] as 'rotate' | 'translate', v: [Number(m[2]), Number(m[3]), Number(m[4])] });
  }
  return steps;
}

function callStr(step: TransformStep): string {
  return `.${step.kind}([${fmt(step.v[0])}, ${fmt(step.v[1])}, ${fmt(step.v[2])}])`;
}

/** Fold steps into a clean chain: merge a translate into an immediately
 *  preceding translate (rigid translates commute and sum), and drop steps that
 *  reduce to identity. Rotations are never merged (Euler composition is
 *  non-trivial); they simply chain in order. */
function normalizeChain(steps: TransformStep[]): TransformStep[] {
  const out: TransformStep[] = [];
  for (const s of steps) {
    const last = out[out.length - 1];
    if (s.kind === 'translate' && last && last.kind === 'translate') {
      last.v = [last.v[0] + s.v[0], last.v[1] + s.v[1], last.v[2] + s.v[2]];
    } else {
      out.push({ kind: s.kind, v: [...s.v] as Vec3 });
    }
  }
  return out.filter(s =>
    s.kind === 'translate'
      ? Math.abs(s.v[0]) > 1e-9 || Math.abs(s.v[1]) > 1e-9 || Math.abs(s.v[2]) > 1e-9
      : !isNoopRotation(s.v),
  );
}

/** Wrap the user's manifold-js source so the whole returned model is transformed
 *  by `steps`, preserving the original code verbatim (no re-indentation, so
 *  template literals are untouched). If `originalCode` is already a wrapper this
 *  module produced, the new steps extend its chain; if the chain folds away to
 *  nothing, the original inner code is returned unwrapped. */
export function buildTransformCode(originalCode: string, steps: TransformStep[], label: string, date: string): string {
  let inner = originalCode;
  let chain: TransformStep[] = [];
  const m = originalCode.match(WRAPPER_RE);
  if (m) {
    inner = m[1];
    chain = parseChain(m[2]);
  }
  const all = normalizeChain([...chain, ...steps]);
  if (all.length === 0) {
    return inner.endsWith('\n') ? inner : `${inner}\n`;
  }
  return `// ${SENTINEL} — ${label} (${date})\nreturn (() => {\n${inner}\n})()${all.map(callStr).join('')};\n`;
}

// ---- labels ---------------------------------------------------------------

/** Short version/label text for a set of placement ops, e.g. "drop to floor + center XY". */
export function placementLabel(ops: PlacementOps): string {
  const parts: string[] = [];
  if (ops.dropToFloor) parts.push('drop to floor');
  // dropToFloor owns the Z axis, so a co-requested centerZ is a no-op there —
  // don't let the label claim a Z-center that computePlacementDelta ignored.
  const centerZ = ops.centerZ && !ops.dropToFloor;
  const axes = [ops.centerX ? 'X' : '', ops.centerY ? 'Y' : '', centerZ ? 'Z' : ''].join('');
  if (axes) parts.push(`center ${axes}`);
  return parts.join(' + ') || 'placed';
}

/** Short label for a free rotation, e.g. "rotate (0°, 90°, 0°)". */
export function rotationLabel(euler: Vec3): string {
  return `rotate (${fmt(euler[0])}°, ${fmt(euler[1])}°, ${fmt(euler[2])}°)`;
}
