// `F.hair(rig, { style: 'captured', preset })` — a hairdo CAPTURED from a real
// mesh (scripts/capture-hair.mjs) and replayed onto any rig head as one
// resolution-independent SDF.
//
// The preset is a radial height field + coverage mask over a LANDMARK frame
// (face front at eye height, face half-width W, eye-to-chin drop H — see
// hairCapture/field.ts). At build time this module measures the same landmarks
// on the target head by marching its SDF, bakes the style knobs into the
// grids, measures the target skin under every grid direction (so `volume`
// scales the thickness ABOVE the skull and the skull never pokes through), and
// returns a node whose evaluate() is the captured field. It follows headScale /
// proportions / faceShape / head pose because everything is measured on the
// real head and rig axes.
//
// Layering: like sdfFigure.ts this imports nothing from ./sdf — it receives the
// namespace and nodes structurally. sdfFigure.ts imports `buildCapturedHair`
// at the hair-style dispatch only.

import { assertBoolean, assertEnum, assertNumber } from '../validation/apiValidation';
import { bakeField, decodePreset, DEFAULT_KNOBS, fieldValue, cellDir, dirVec, sampleLinear, type HairField, type HairGrids, type HairKnobs, type V3 } from './hairCapture/field';
import type { HeadLandmarks } from './hairCapture/capture';
import { HAIR_PRESETS } from './hairCapture/presets';

/** Style-only option keys (the dispatch's allow-list / misplacement check). */
export const CAPTURED_HAIR_FIELDS = ['preset', 'spikiness', 'smooth', 'mirror', 'tilt', 'windowScale'];

/** Structural node: what this module needs from an SDF node. */
interface CapNode<N> {
  evaluate(x: number, y: number, z: number): number;
  translate(t: V3): N;
  displace(amount: number, field: (x: number, y: number, z: number) => number): N;
}
/** Structural rig: the head centre, axes, eye landmarks and head radii. */
interface CapRig {
  joints: Record<string, number[]>;
  dir: Record<string, number[]>;
  face: { eyeL: number[]; eyeR: number[] };
  r: Record<string, number>;
}

const decoded = new Map<string, HairGrids>();
function presetGrids(name: string): HairGrids {
  let g = decoded.get(name);
  if (!g) { g = decodePreset(HAIR_PRESETS[name]); decoded.set(name, g); }
  return g;
}

const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: V3 | number[], s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: V3 | number[], b: V3 | number[]): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Distance from `o` along unit `d` to where `n` first turns positive (its
 *  skin), searching up to `maxT` in `steps` then bisecting. 0 if `o` is outside. */
function exitDist(n: { evaluate(x: number, y: number, z: number): number }, o: V3, d: V3, maxT: number, steps = 64): number {
  const at = (t: number): number => n.evaluate(o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t);
  if (at(0) > 0) return 0;
  let lo = 0, hi = maxT;
  for (let i = 1; i <= steps; i++) {
    const t = (maxT * i) / steps;
    if (at(t) > 0) { lo = (maxT * (i - 1)) / steps; hi = t; break; }
  }
  for (let k = 0; k < 20; k++) { const m = (lo + hi) / 2; if (at(m) > 0) hi = m; else lo = m; }
  return (lo + hi) / 2;
}

/** The target head's landmark frame, measured on its SDF with the same
 *  definitions `landmarksFromParts` uses on a mesh: eye line + midline from the
 *  rig's eye anchors; the face front along `headForward` at eye height; the
 *  chin as the lowest skin below the eye line within 0.6 eye-separations of
 *  the front; W as the widest skin at eye height 0.38–0.93·H behind the front. */
export function measureHeadLandmarks(head: { evaluate(x: number, y: number, z: number): number }, rig: CapRig): HeadLandmarks {
  const c = rig.joints.head as V3;   // every rig has a head joint
  const f = rig.dir.headForward as V3, L = rig.dir.headLeft as V3, U = rig.dir.headUp as V3;
  const eyeH = (dot(rig.face.eyeL, U) + dot(rig.face.eyeR, U)) / 2 - dot(c, U);
  const mid = (dot(rig.face.eyeL, L) + dot(rig.face.eyeR, L)) / 2 - dot(c, L);
  const sep = Math.abs(dot(rig.face.eyeL, L) - dot(rig.face.eyeR, L)) || rig.r.headX * 0.5;
  const maxT = Math.max(rig.r.head, rig.r.headX, rig.r.headZ) * 3;
  const eyeC = add(c, add(mul(U, eyeH), mul(L, mid)));
  const front = exitDist(head, eyeC, f, maxT);
  let H = 0;
  for (let k = 0; k <= 12; k++) {
    const dd = front - 0.6 * sep * (k / 12) - 1e-3 * maxT;
    H = Math.max(H, exitDist(head, add(eyeC, mul(f, dd)), mul(U, -1), maxT));
  }
  if (H <= 0) H = rig.r.headZ * 0.8;
  let W = 0;
  for (let k = 0; k <= 11; k++) {
    const back = front - H * (0.38 + (0.55 * k) / 11);
    const o = add(eyeC, mul(f, back));
    W = Math.max(W, (exitDist(head, o, L, maxT) + exitDist(head, o, mul(L, -1), maxT)) / 2);
  }
  if (W <= 0) W = rig.r.headX;
  return { origin: add(eyeC, mul(f, front)), forward: f, left: L, up: U, W, H };
}

/** Build the 'captured' hair: `o` = the F.hair options, `head` = the head the
 *  hair sits on (the `on` node, else the default head), `t` = hair.thickness,
 *  `volume` / `lenMul` = the shared F.hair volume / length knobs. */
export function buildCapturedHair<N extends CapNode<N>>(
  sdf: { box(size: V3): N }, rig: CapRig, o: Record<string, unknown>, head: N, t: number, volume: number, lenMul: number,
): N {
  const presetName = o.preset === undefined ? 'tsubasa' : assertEnum(o.preset, Object.keys(HAIR_PRESETS), 'hair.preset');
  const nOpt = (k: string, def: number, min: number, max: number): number =>
    (o[k] === undefined ? def : assertNumber(o[k], `hair.${k}`, { min, max }) as number);
  const knobs: HairKnobs = {
    ...DEFAULT_KNOBS,
    volume,
    length: lenMul,
    spikiness: nOpt('spikiness', 1, 0, 3),
    smooth: nOpt('smooth', 0, 0, 1),
    fringe: nOpt('fringe', 1, 0.3, 2),
    tilt: nOpt('tilt', 0, -40, 40),
    windowScale: nOpt('windowScale', 1, 0.5, 2),
    mirror: o.mirror === undefined ? false : assertBoolean(o.mirror, 'hair.mirror') as boolean,
  };
  const preset = HAIR_PRESETS[presetName];
  const src = presetGrids(presetName);
  const lm = measureHeadLandmarks(head, rig);
  const { forward: f, left: L, up: U } = lm;
  // m-space → world: axis k scales by shape[k] × (W, W, H)[k].
  const S: V3 = [preset.shape[0] * lm.W, preset.shape[1] * lm.W, preset.shape[2] * lm.H];
  const C = add(lm.origin, add(mul(f, preset.centre[0] * lm.W), add(mul(L, preset.centre[1] * lm.W), mul(U, preset.centre[2] * lm.H))));
  const worldDir = (d: V3): { w: V3; lam: number } => {
    const w = add(mul(f, d[0] * S[0]), add(mul(L, d[1] * S[1]), mul(U, d[2] * S[2])));
    const lam = Math.hypot(w[0], w[1], w[2]);
    return { w: mul(w, 1 / lam), lam };
  };
  // Target skin radius (m units) under every cell, at half resolution then
  // bilinearly upsampled (the skull is smooth); the guard keeps a minimum
  // thickness of hair above it.
  const half = { nAz: src.nAz / 2, nEl: src.nEl / 2, elMin: src.elMin, elMax: src.elMax };
  const coarse = new Float64Array(half.nAz * half.nEl);
  const maxT = Math.max(S[0], S[1], S[2]) * 1.6;
  for (let j = 0; j < half.nEl; j++) for (let i = 0; i < half.nAz; i++) {
    const { w, lam } = worldDir(dirVec(...cellDir(half, i, j)));
    coarse[j * half.nAz + i] = exitDist(head, C, w, maxT, 48) / lam;
  }
  const n = src.nAz * src.nEl;
  const skin = new Float64Array(n), minThick = new Float64Array(n);
  const tMin = t * MIN_THICK_FRAC;
  for (let j = 0; j < src.nEl; j++) for (let i = 0; i < src.nAz; i++) {
    const [az, el] = cellDir(src, i, j);
    skin[j * src.nAz + i] = sampleLinear(coarse, half, az, el);
    minThick[j * src.nAz + i] = tMin / worldDir(dirVec(az, el)).lam;
  }
  const field: HairField = bakeField(src, knobs, skin, minThick);
  // World AABB of the covered hair (plus a margin) — the node's bounds.
  const lo: V3 = [C[0], C[1], C[2]], hi: V3 = [C[0], C[1], C[2]];
  for (let j = 0; j < field.nEl; j++) for (let i = 0; i < field.nAz; i++) {
    const k = j * field.nAz + i;
    if (field.mask[k] < -3) continue;
    const { w, lam } = worldDir(dirVec(...cellDir(field, i, j)));
    const p = add(C, mul(w, field.radius[k] * lam));
    for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], p[a]); hi[a] = Math.max(hi[a], p[a]); }
  }
  const pad = Math.max(S[0], S[1], S[2]) * 0.06;
  const size: V3 = [hi[0] - lo[0] + 2 * pad, hi[1] - lo[1] + 2 * pad, hi[2] - lo[2] + 2 * pad];
  const box = sdf.box(size).translate([(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2]);
  /** Captured hair SDF at a world point (≈ world units, negative inside). */
  const hairAt = (x: number, y: number, z: number): number => {
    const q: V3 = [x - C[0], y - C[1], z - C[2]];
    const m: V3 = [dot(q, f) / S[0], dot(q, L) / S[1], dot(q, U) / S[2]];
    const v = fieldValue(field, m);
    if (v.rho < 1e-9) return v.d * Math.min(S[0], S[1], S[2]);
    return v.d * worldDir([m[0] / v.rho, m[1] / v.rho, m[2] / v.rho]).lam;
  };
  return carryField(box, hairAt, pad);
}

/** Value standing in for a non-finite field sample: far OUTSIDE, so a NaN can
 *  never turn into solid hair. */
const OUTSIDE = 1e9;

/** A node whose evaluate() is `field`, carried by `box`: displace(pad,
 *  (box − field) / pad) evaluates to exactly `field` (box − pad·(box − field)/pad)
 *  while the bounds stay the box's, grown only by `pad` (the existing margin) —
 *  not a fixed world unit that would bloat a small figure's march. */
export function carryField<N extends CapNode<N>>(box: N, field: (x: number, y: number, z: number) => number, pad: number): N {
  return box.displace(pad, (x, y, z) => {
    const h = field(x, y, z);
    return (box.evaluate(x, y, z) - (Number.isFinite(h) ? h : OUTSIDE)) / pad;
  });
}

/** Minimum hair thickness above the target skull, × hair.thickness. */
const MIN_THICK_FRAC = 0.4;

