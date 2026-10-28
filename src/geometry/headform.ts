/**
 * Headform — a metric adult head proxy for fitting wearables (masks, helmets,
 * glasses, headphones, hats), exposed to the manifold-js sandbox as
 * `api.headform(opts?)` with `api.headform.landmarks(opts?)` beside it.
 *
 * The figure rig's `F.head` / `F.onFace` are stylised and unitless; this is the
 * opposite: real millimetres from adult anthropometry (approximate ANSUR II
 * means), in the frame headform standards use, so a part modelled against it
 * fits a person. It is a smooth SDF blend of ellipsoids and capsules placed so
 * the surface passes through the named landmarks — a fit proxy, not a portrait.
 *
 * Frame (all millimetres):
 *   • origin  — midway between the two tragions (the ear-canal notches)
 *   • XY      — the Frankfort horizontal plane (ear canal ↔ lower eye-socket rim)
 *   • −Y      — the face points this way (the app's "front")
 *   • +X      — the wearer's LEFT (as for a figure facing −Y)
 *   • +Z      — up
 */

import { ValidationError, assertEnum, assertNoUnknownKeys, assertNumber, assertObject, assertBoolean } from '../validation/apiValidation';
import type { SdfNode } from './sdf';

/* eslint-disable @typescript-eslint/no-explicit-any */

type Vec3 = [number, number, number];

/** The measurements the proxy is built from (mm). */
export interface HeadformMeasurements {
  /** Head circumference, just above the brow ridge. */
  circumference: number;
  /** Glabella (between the brows) to the back of the head. */
  length: number;
  /** Widest side-to-side breadth of the skull, above the ears. */
  breadth: number;
  /** Tragion to tragion (ear notch to ear notch). */
  bitragionBreadth: number;
  /** Sellion (deepest point of the nose bridge) to menton (bottom of the chin). */
  faceHeight: number;
  /** Pupil centre to pupil centre. */
  pupillaryDistance: number;
  /** Height of the top of the head above the tragions. */
  vertexHeight: number;
  /** Cheekbone to cheekbone. */
  bizygomaticBreadth: number;
  /** Jaw angle to jaw angle. */
  bigonialBreadth: number;
  /** Neck circumference (the proxy's neck is a cylinder of this girth). */
  neckCircumference: number;
}

const MEASUREMENT_KEYS = [
  'circumference', 'length', 'breadth', 'bitragionBreadth', 'faceHeight', 'pupillaryDistance',
  'vertexHeight', 'bizygomaticBreadth', 'bigonialBreadth', 'neckCircumference',
] as const;

/** Adult 50th-percentile-ish measurements by sex (approximate ANSUR II means). */
const BASE: Record<'male' | 'female' | 'neutral', HeadformMeasurements> = {
  male: {
    circumference: 572, length: 197, breadth: 152, bitragionBreadth: 145, faceHeight: 123,
    pupillaryDistance: 64, vertexHeight: 132, bizygomaticBreadth: 142, bigonialBreadth: 112,
    neckCircumference: 398,
  },
  female: {
    circumference: 549, length: 187, breadth: 145, bitragionBreadth: 138, faceHeight: 113,
    pupillaryDistance: 62, vertexHeight: 126, bizygomaticBreadth: 133, bigonialBreadth: 100,
    neckCircumference: 326,
  },
  neutral: {
    circumference: 560, length: 192, breadth: 148, bitragionBreadth: 141, faceHeight: 118,
    pupillaryDistance: 63, vertexHeight: 129, bizygomaticBreadth: 137, bigonialBreadth: 106,
    neckCircumference: 362,
  },
};

/** Size presets: a uniform scale of the base head (S ≈ 5th, L ≈ 95th percentile). */
const SIZE_SCALE = { S: 0.95, M: 1, L: 1.05 } as const;

export type HeadformSize = keyof typeof SIZE_SCALE;
export type HeadformSex = keyof typeof BASE;

export interface HeadformOptions extends Partial<HeadformMeasurements> {
  size?: HeadformSize;
  sex?: HeadformSex;
  /** Include the neck (default true). */
  neck?: boolean;
  /** Mesh edge length in mm (default 3). Smaller is smoother and slower. */
  edgeLength?: number;
}

const OPTION_KEYS = ['size', 'sex', 'neck', 'edgeLength', ...MEASUREMENT_KEYS] as const;

/** The named points on the proxy's surface, in the headform frame (mm). */
export interface HeadformLandmarks {
  tragionL: Vec3; tragionR: Vec3;
  vertex: Vec3; glabella: Vec3; opisthocranion: Vec3;
  sellion: Vec3; pupilL: Vec3; pupilR: Vec3;
  pronasale: Vec3; subnasale: Vec3; stomion: Vec3; menton: Vec3;
  zygionL: Vec3; zygionR: Vec3; gonionL: Vec3; gonionR: Vec3;
}

interface Resolved {
  measurements: HeadformMeasurements;
  neck: boolean;
  edgeLength: number;
}

function resolve(opts: unknown, where: string): Resolved {
  const o = opts === undefined ? {} : assertObject(opts, where)!;
  assertNoUnknownKeys(o, OPTION_KEYS, where);
  const size = o.size === undefined ? 'M' : assertEnum(o.size, ['S', 'M', 'L'] as const, `${where}.size`);
  const sex = o.sex === undefined ? 'neutral' : assertEnum(o.sex, ['neutral', 'female', 'male'] as const, `${where}.sex`);
  assertBoolean(o.neck, `${where}.neck`, { optional: true });
  if (o.edgeLength !== undefined) assertNumber(o.edgeLength, `${where}.edgeLength`, { min: 0.5, max: 20 });
  const base = BASE[sex];
  let k = SIZE_SCALE[size];
  // A circumference sets the overall size; the other measurements override
  // one dimension each.
  if (o.circumference !== undefined) {
    assertNumber(o.circumference, `${where}.circumference`, { min: 300, max: 800 });
    k = (o.circumference as number) / base.circumference;
  }
  const m = {} as HeadformMeasurements;
  for (const key of MEASUREMENT_KEYS) {
    const v = o[key];
    if (v !== undefined) {
      assertNumber(v, `${where}.${key}`, { min: 10, max: 800 });
      m[key] = v as number;
    } else {
      m[key] = Math.round(base[key] * k * 10) / 10;
    }
  }
  if (m.pupillaryDistance >= m.bizygomaticBreadth || m.bitragionBreadth > m.breadth * 1.1 || m.bigonialBreadth >= m.bizygomaticBreadth * 1.05) {
    throw new ValidationError(`${where}: the measurements don't describe a head (pupillaryDistance < bizygomaticBreadth, bitragionBreadth ≲ breadth and bigonialBreadth ≲ bizygomaticBreadth).`);
  }
  return { measurements: m, neck: o.neck !== false, edgeLength: (o.edgeLength as number | undefined) ?? 3 };
}

/** Where each landmark sits, as a function of the measurements. The SDF in
 *  `headformSdf` is laid out to pass near these points (`surfaceLandmarks`
 *  then snaps them onto it). */
function landmarksOf(m: HeadformMeasurements): HeadformLandmarks {
  const L = m.length, F = m.faceHeight;
  const sellionZ = 0.18 * F;
  return {
    tragionL: [m.bitragionBreadth / 2, 0, 0],
    tragionR: [-m.bitragionBreadth / 2, 0, 0],
    vertex: [0, 0.02 * L, m.vertexHeight],
    glabella: [0, -0.51 * L, 0.3 * F],
    opisthocranion: [0, 0.49 * L, 0.25 * F],
    sellion: [0, -0.475 * L, sellionZ],
    pupilL: [m.pupillaryDistance / 2, -0.425 * L, 0.12 * F],
    pupilR: [-m.pupillaryDistance / 2, -0.425 * L, 0.12 * F],
    pronasale: [0, -0.585 * L, sellionZ - 0.4 * F],
    subnasale: [0, -0.525 * L, sellionZ - 0.47 * F],
    stomion: [0, -0.51 * L, sellionZ - 0.66 * F],
    menton: [0, -0.44 * L, sellionZ - F],
    zygionL: [m.bizygomaticBreadth / 2, -0.3 * L, 0.02 * F],
    zygionR: [-m.bizygomaticBreadth / 2, -0.3 * L, 0.02 * F],
    gonionL: [m.bigonialBreadth / 2, -0.07 * L, sellionZ - 0.66 * F],
    gonionR: [-m.bigonialBreadth / 2, -0.07 * L, sellionZ - 0.66 * F],
  };
}

/** The proxy as an SDF tree, from a bound `api.sdf` namespace. */
function headformSdf(sdf: any, m: HeadformMeasurements, neck: boolean): SdfNode {
  const L = m.length, B = m.breadth, F = m.faceHeight, V = m.vertexHeight;
  const p = landmarksOf(m);
  const k = 0.08 * F;
  const at = (node: SdfNode, c: Vec3) => node.translate(c);
  const pair = (node: () => SdfNode, c: Vec3) =>
    at(node(), c).union(at(node(), [-c[0], c[1], c[2]]));

  // Skull: front at the glabella, back at the opisthocranion, top at the vertex.
  const cz = 0.2 * V;
  let head: SdfNode = at(sdf.ellipsoid(B / 2, L / 2, V - cz), [0, -0.01 * L, cz]);
  // Real skulls are fuller than an ellipsoid: fill out the back (parietals)
  // and the temples, keeping the length and breadth.
  head = head.smoothUnion(at(sdf.ellipsoid(B / 2 - 1, 0.4 * L, 0.8 * (V - cz)), [0, 0.08 * L, cz]), k);
  head = head.smoothUnion(at(sdf.ellipsoid(0.45 * B, 0.4 * L, 0.75 * (V - cz)), [0, -0.1 * L, cz]), k);
  // Square the plan view a little: real skulls are boxier than an ellipse, and
  // the stated circumference needs the fuller front/back corners.
  for (const sgn of [1, -1]) {
    head = head.smoothUnion(
      at(sdf.ellipsoid(0.45 * L, 0.37 * B, 0.8 * (V - cz)).rotate([0, 0, sgn * 40]), [0, -0.01 * L, cz]),
      k,
    );
  }
  // No separate brow mass: the skull already reaches the glabella and the eye
  // sockets below it read as the brow.
  const kf = 0.17 * F; // face masses blend wide so they read as one surface
  // Cheekbones out to the zygions.
  head = head.smoothUnion(at(sdf.ellipsoid(m.bizygomaticBreadth / 2 - 3.5, 0.17 * L, 0.19 * F), [0, -0.3 * L, p.zygionL[2]]), kf);
  // Midface (maxilla), behind the nose and upper lip.
  head = head.smoothUnion(at(sdf.ellipsoid(0.47 * m.bizygomaticBreadth, 0.2 * L, 0.34 * F), [0, -0.315 * L, p.sellion[2] - 0.4 * F]), kf);
  // Mouth and chin as ONE tall, gently curved mass: its front passes the
  // stomion and its underside the menton, so lips and chin are not blobs.
  const mouthRy = 0.12 * L, mouthRz = 0.22 * F;
  head = head.smoothUnion(
    at(sdf.ellipsoid(0.24 * F + 8, mouthRy, mouthRz), [0, p.stomion[1] + mouthRy + 7, p.stomion[2] - 0.08 * F]),
    kf,
  );
  // Jaw: a fill to the jaw angles, then the jaw lines from just inside each
  // gonion (so the surface passes through the landmark) forward to the chin.
  head = head.smoothUnion(at(sdf.ellipsoid(m.bigonialBreadth / 2 - 6, 0.18 * L, 0.24 * F), [0, -0.3 * L, p.sellion[2] - 0.7 * F]), kf);
  const jawR = 0.1 * F;
  const chin: Vec3 = [0, p.menton[1] + 8, p.menton[2] + jawR + 3];
  head = head.smoothUnion(
    sdf.capsule([p.gonionL[0] - jawR - 4.5, p.gonionL[1], p.gonionL[2]], chin, jawR)
      .union(sdf.capsule([p.gonionR[0] + jawR + 4.5, p.gonionR[1], p.gonionR[2]], chin, jawR)),
    kf,
  );
  // Under the chin, a slope back to the neck (the submental region).
  head = head.smoothUnion(
    sdf.capsule([0, p.menton[1] + 26, p.menton[2] + 12], [0, 0.1 * L, p.menton[2] - 30], 0.14 * F),
    1.2 * kf,
  );
  // Eye sockets, then the eyes (front of each eye at its pupil landmark).
  const eyeR = 0.1 * F;
  head = head.smoothSubtract(
    pair(() => sdf.sphere(0.11 * F), [m.pupillaryDistance / 2, p.sellion[1] - 0.02 * L, p.pupilL[2]]),
    k * 0.6,
  );
  // The nose bridge sits back from the brow: a groove from socket to socket
  // whose back is at the sellion.
  const grooveR = 0.09 * F;
  head = head.smoothSubtract(
    sdf.capsule([-m.pupillaryDistance / 2, p.sellion[1] - grooveR, p.sellion[2]], [m.pupillaryDistance / 2, p.sellion[1] - grooveR, p.sellion[2]], grooveR),
    k * 0.4,
  );
  head = head.union(pair(() => sdf.sphere(eyeR), [m.pupillaryDistance / 2, p.pupilL[1] + eyeR, p.pupilL[2]]));
  // Nose: the bridge-to-tip ridge, then the base (alae).
  const noseR = 0.05 * F;
  head = head.smoothUnion(
    sdf.capsule([0, p.sellion[1] + noseR + 4, p.sellion[2] - 4], [p.pronasale[0], p.pronasale[1] + noseR, p.pronasale[2] + 2], noseR),
    k * 0.3,
  );
  head = head.smoothUnion(at(sdf.ellipsoid(0.15 * F, 0.045 * L, 0.075 * F), [0, p.subnasale[1] + 0.03 * L, p.subnasale[2] + 0.06 * F]), k * 0.5);
  // Ears: flat ovals standing out from the tragions.
  head = head.smoothUnion(pair(() => sdf.ellipsoid(0.05 * F, 0.1 * L, 0.27 * F), [m.bitragionBreadth / 2 + 3, 0.1 * L + 2, 0.05 * F]), k * 0.4);
  if (neck) {
    const r = m.neckCircumference / (2 * Math.PI);
    const top = -0.3 * F, bottom = -1.6 * F;
    head = head.smoothUnion(at(sdf.cylinder(r, top - bottom), [0, 0.12 * L, (top + bottom) / 2]), 1.5 * k);
  }
  return head;
}

/** Which way each landmark faces: it's found by walking out from inside the
 *  head along this direction to where the surface is. */
const OUTWARD: Record<keyof HeadformLandmarks, Vec3> = {
  tragionL: [1, 0, 0], tragionR: [-1, 0, 0],
  vertex: [0, 0, 1], glabella: [0, -1, 0], opisthocranion: [0, 1, 0],
  sellion: [0, -1, 0], pupilL: [0, -1, 0], pupilR: [0, -1, 0],
  pronasale: [0, -1, 0], subnasale: [0, -1, 0], stomion: [0, -1, 0], menton: [0, 0, -1],
  zygionL: [1, 0, 0], zygionR: [-1, 0, 0], gonionL: [1, 0, 0], gonionR: [-1, 0, 0],
};

/** The landmarks moved onto the proxy's actual surface (the blend shifts it a
 *  few mm from the nominal points), so a part placed on one touches the skin. */
function surfaceLandmarks(node: SdfNode, m: HeadformMeasurements): HeadformLandmarks {
  const nominal = landmarksOf(m);
  const out = {} as HeadformLandmarks;
  const reach = 0.2 * m.faceHeight;
  for (const key of Object.keys(nominal) as (keyof HeadformLandmarks)[]) {
    const p = nominal[key], d = OUTWARD[key];
    const at = (t: number): Vec3 => [p[0] + d[0] * t, p[1] + d[1] * t, p[2] + d[2] * t];
    const f = (t: number) => { const q = at(t); return node.evaluate(q[0], q[1], q[2]); };
    // Step out from inside until the sign flips, then bisect.
    let lo = -reach, hi = lo;
    for (let t = -reach; t <= reach; t += 0.5) {
      if (f(t) > 0) { hi = t; break; }
      lo = t;
    }
    if (hi === lo) { out[key] = p; continue; }
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2;
      if (f(mid) > 0) hi = mid; else lo = mid;
    }
    out[key] = at((lo + hi) / 2);
  }
  return out;
}

function round1(v: Vec3): Vec3 {
  return v.map(n => Math.round(n * 10) / 10) as Vec3;
}

/** `api.headform` for one run: a callable that builds the proxy, with
 *  `landmarks` (pure data, no geometry) and the presets beside it. */
export function createHeadform(sdf: any): any {
  const headform = (opts?: HeadformOptions) => {
    const r = resolve(opts, 'headform(opts)');
    return headformSdf(sdf, r.measurements, r.neck).build({ edgeLength: r.edgeLength });
  };
  headform.landmarks = (opts?: HeadformOptions) => {
    const r = resolve(opts, 'headform.landmarks(opts)');
    const points = surfaceLandmarks(headformSdf(sdf, r.measurements, r.neck), r.measurements);
    const out = {} as HeadformLandmarks;
    for (const key of Object.keys(points) as (keyof HeadformLandmarks)[]) out[key] = round1(points[key]);
    return {
      units: 'mm',
      frame: 'origin between the tragions; XY = Frankfort plane; face toward −Y; +X = wearer\'s left; +Z up',
      measurements: r.measurements,
      points: out,
    };
  };
  headform.sizes = Object.freeze({ ...SIZE_SCALE });
  return headform;
}

export const __headformTestables__ = { resolve, landmarksOf, surfaceLandmarks, headformSdf };
