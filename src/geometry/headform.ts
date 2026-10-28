/**
 * Headform — a metric adult head proxy for fitting wearables (masks, helmets,
 * glasses, headphones, hats), exposed to the manifold-js sandbox as
 * `api.headform(opts?)` with `api.headform.landmarks(opts?)` beside it.
 *
 * The figure rig's `F.head` / `F.onFace` are stylised and unitless; this is the
 * opposite: real millimetres from adult anthropometric surveys (sources at
 * BASE), in the frame headform standards use, so a part modelled against it
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
  /** Tragion to tragion (ear notch to ear notch). No survey source: defaults to
   *  0.97 × breadth, where the skull's side is at ear level. */
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
  /** Nose width across the wings (alare to alare). */
  noseBreadth: number;
  /** Nose tip to where the nose meets the upper lip (pronasale to subnasale). */
  noseProtrusion: number;
  /** Nose bridge to where the nose meets the upper lip (sellion to subnasale). */
  noseLength: number;
}

const MEASUREMENT_KEYS = [
  'circumference', 'length', 'breadth', 'bitragionBreadth', 'faceHeight', 'pupillaryDistance',
  'vertexHeight', 'bizygomaticBreadth', 'bigonialBreadth', 'neckCircumference',
  'noseBreadth', 'noseProtrusion', 'noseLength',
] as const;

/** Survey means by sex, in mm, from two US surveys:
 *  - ANSUR II (2012 US Army survey; public data, 4,082 men and 1,986 women):
 *    circumference, length, breadth, faceHeight (menton–sellion),
 *    pupillaryDistance, vertexHeight (tragion–top of head), bizygomaticBreadth
 *    and neckCircumference.
 *  - NIOSH 2003 head-and-face survey of US respirator users (Zhuang &
 *    Bradtmiller, J. Occup. Environ. Hyg. 2:567–576, 2005, Table VI; 2,543
 *    men and 1,454 women): bigonialBreadth, noseBreadth, noseProtrusion and
 *    noseLength (subnasale–sellion), which ANSUR II doesn't measure.
 *  Neutral is the mean of the two. bitragionBreadth has no survey source; see
 *  HeadformMeasurements. */
type BaseMeasurements = Omit<HeadformMeasurements, 'bitragionBreadth'>;
const MALE: BaseMeasurements = {
  circumference: 574.4, length: 199.5, breadth: 154.3, faceHeight: 122.6,
  pupillaryDistance: 64.0, vertexHeight: 131.1, bizygomaticBreadth: 142.6, neckCircumference: 397.6,
  bigonialBreadth: 120.4, noseBreadth: 36.6, noseProtrusion: 21.1, noseLength: 52.0,
};
const FEMALE: BaseMeasurements = {
  circumference: 561.1, length: 189.8, breadth: 147.8, faceHeight: 113.1,
  pupillaryDistance: 61.7, vertexHeight: 126.5, bizygomaticBreadth: 133.8, neckCircumference: 329.8,
  bigonialBreadth: 110.1, noseBreadth: 33.2, noseProtrusion: 19.8, noseLength: 48.2,
};
const BASE: Record<'male' | 'female' | 'neutral', BaseMeasurements> = {
  male: MALE,
  female: FEMALE,
  neutral: Object.fromEntries(
    (Object.keys(MALE) as (keyof BaseMeasurements)[]).map(key => [key, Math.round((MALE[key] + FEMALE[key]) * 5) / 10]),
  ) as unknown as BaseMeasurements,
};

/** Size presets: a uniform scale of the base head. ±5% spans roughly the 5th
 *  to 95th percentile of head circumference in both surveys. */
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
  alareL: Vec3; alareR: Vec3;
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
  if (o.edgeLength !== undefined) assertNumber(o.edgeLength, `${where}.edgeLength`, { min: 1, max: 20 });
  const base = BASE[sex];
  let k = SIZE_SCALE[size];
  // A circumference sets the overall scale (in place of `size`); the other
  // measurements then override one dimension each, so the girth the mesh
  // ends up with is reported separately (`achieved`).
  if (o.circumference !== undefined) {
    assertNumber(o.circumference, `${where}.circumference`, { min: 300, max: 800 });
    k = (o.circumference as number) / base.circumference;
  }
  const m = {} as HeadformMeasurements;
  for (const key of MEASUREMENT_KEYS) {
    const v = o[key];
    if (v !== undefined) {
      assertNumber(v, `${where}.${key}`, { min: 5, max: 800 });
      m[key] = v as number;
    } else if (key === 'bitragionBreadth') {
      m[key] = NaN; // derived below, from the (possibly overridden) breadth
    } else {
      m[key] = Math.round(base[key] * k * 10) / 10;
    }
  }
  if (Number.isNaN(m.bitragionBreadth)) m.bitragionBreadth = Math.round(0.97 * m.breadth * 10) / 10;
  if (m.pupillaryDistance >= m.bizygomaticBreadth || m.bitragionBreadth > m.breadth * 1.1
    || m.bigonialBreadth >= m.bizygomaticBreadth * 1.05 || m.noseBreadth >= m.pupillaryDistance
    || m.noseProtrusion >= m.noseLength || m.noseLength >= 0.6 * m.faceHeight) {
    throw new ValidationError(`${where}: the measurements don't describe a head (pupillaryDistance < bizygomaticBreadth, bitragionBreadth ≲ breadth, bigonialBreadth ≲ bizygomaticBreadth, noseBreadth < pupillaryDistance, noseProtrusion < noseLength < 0.6 × faceHeight).`);
  }
  return { measurements: m, neck: o.neck !== false, edgeLength: (o.edgeLength as number | undefined) ?? 3 };
}

/** Where each landmark sits, as a function of the measurements. The SDF in
 *  `headformSdf` is laid out to pass near these points (`surfaceLandmarks`
 *  then snaps them onto it). */
function landmarksOf(m: HeadformMeasurements): HeadformLandmarks {
  const L = m.length, F = m.faceHeight;
  const sellionZ = 0.18 * F;
  const sellionY = -0.475 * L;
  // The nose from its measurements: the subnasale sits noseLength from the
  // sellion (slightly forward of it), and the tip noseProtrusion from the
  // subnasale, forward and tilted up (the columella rises ~25°).
  const subY = -0.525 * L;
  const subZ = sellionZ - Math.sqrt(Math.max(m.noseLength ** 2 - (sellionY - subY) ** 2, 1));
  const tilt = 25 * Math.PI / 180;
  const alare = (sgn: number): Vec3 => [sgn * m.noseBreadth / 2, subY + 0.25 * m.noseProtrusion, subZ + 0.12 * m.noseLength + 3];
  return {
    tragionL: [m.bitragionBreadth / 2, 0, 0],
    tragionR: [-m.bitragionBreadth / 2, 0, 0],
    vertex: [0, 0.02 * L, m.vertexHeight],
    glabella: [0, -0.51 * L, 0.3 * F],
    opisthocranion: [0, 0.49 * L, 0.25 * F],
    sellion: [0, sellionY, sellionZ],
    pupilL: [m.pupillaryDistance / 2, -0.425 * L, 0.12 * F],
    pupilR: [-m.pupillaryDistance / 2, -0.425 * L, 0.12 * F],
    pronasale: [0, subY - m.noseProtrusion * Math.cos(tilt), subZ + m.noseProtrusion * Math.sin(tilt)],
    subnasale: [0, subY, subZ],
    stomion: [0, subY - 3, sellionZ - 0.66 * F],
    menton: [0, -0.44 * L, sellionZ - F],
    zygionL: [m.bizygomaticBreadth / 2, -0.3 * L, 0.02 * F],
    zygionR: [-m.bizygomaticBreadth / 2, -0.3 * L, 0.02 * F],
    gonionL: [m.bigonialBreadth / 2, -0.07 * L, sellionZ - 0.66 * F],
    gonionR: [-m.bigonialBreadth / 2, -0.07 * L, sellionZ - 0.66 * F],
    alareL: alare(1),
    alareR: alare(-1),
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
  // Midface (maxilla), behind the nose and upper lip: its front sits well
  // behind the subnasale, so the nose stands proud of the cheeks beside it.
  const midRy = 0.2 * L;
  head = head.smoothUnion(at(sdf.ellipsoid(0.47 * m.bizygomaticBreadth, midRy, 0.34 * F), [0, p.subnasale[1] + 0.6 * m.noseProtrusion + midRy, p.sellion[2] - 0.4 * F]), kf);
  // Mouth and chin as ONE tall, gently curved mass: its front passes the
  // stomion and its underside the menton, so lips and chin are not blobs.
  const mouthRy = 0.12 * L, mouthRz = 0.22 * F;
  head = head.smoothUnion(
    at(sdf.ellipsoid(0.24 * F + 8, mouthRy, mouthRz), [0, p.stomion[1] + mouthRy + 7, p.stomion[2] - 0.055 * F]),
    kf,
  );
  // Upper lip: from the stomion up to the subnasale, where the nose meets it.
  // A deep, broad mass blended wide, so it slopes back into the cheeks
  // instead of standing out as a disc; its top stays below the nose.
  const lipH = p.subnasale[2] - p.stomion[2], lipRy = 0.08 * L;
  head = head.smoothUnion(
    at(sdf.ellipsoid(0.32 * F, lipRy, 0.55 * lipH), [0, p.subnasale[1] + lipRy - 6, p.stomion[2] + 0.4 * lipH]),
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
  // Under the chin, a slope back to the neck (the submental region); without
  // a neck it would stick out as a tube.
  if (neck) {
    head = head.smoothUnion(
      sdf.capsule([0, p.menton[1] + 26, p.menton[2] + 12], [0, 0.1 * L, p.menton[2] - 30], 0.14 * F),
      1.2 * kf,
    );
  }
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
  // Nose, from its measurements: a dorsum ridge from the bridge to the tip, a
  // rounded tip whose front is the pronasale, the wings (alae) out to the
  // alare points, and the columella down to the subnasale.
  const nb = m.noseBreadth, np = m.noseProtrusion, nl = m.noseLength;
  const tipR = 0.27 * nb;
  const tip: Vec3 = [0, p.pronasale[1] + tipR, p.pronasale[2]];
  // The dorsum widens from the bridge (~16 mm, the nasal root breadth) toward
  // the tip: a chain of spheres blended into one wedge.
  let nose: SdfNode = at(sdf.sphere(tipR), tip);
  const top: Vec3 = [0, p.sellion[1] + 8, p.sellion[2] - 3];
  for (let i = 0; i <= 4; i++) {
    const t = i / 5, r = 8 + (tipR - 8) * t;
    nose = nose.smoothUnion(at(sdf.sphere(r), [0, top[1] + (tip[1] - top[1]) * t, top[2] + (tip[2] + 0.3 * tipR - top[2]) * t]), 6);
  }
  // The base spans wing to wing and reaches forward under the tip, so the
  // nose is one solid with no gap (or tunnel) behind the tip. Both stop above
  // the subnasale, where the nose meets the lip. The wings' widest point (the
  // alare) sits in front of the cheek, as on a real face.
  nose = nose.smoothUnion(
    at(sdf.ellipsoid(nb / 2, 0.55 * np, 0.12 * nl), [0, p.alareL[1], p.alareL[2]]),
    6,
  );
  nose = nose.smoothUnion(
    at(sdf.ellipsoid(0.3 * nb, 0.45 * np, 0.12 * nl), [0, (tip[1] + p.alareL[1]) / 2, p.subnasale[2] + 0.2 * nl]),
    6,
  );
  // A tight blend keeps a crease where the wings meet the cheeks.
  head = head.smoothUnion(nose, 3);
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
  alareL: [1, 0, 0], alareR: [-1, 0, 0],
};

/** The landmarks moved onto the proxy's actual surface (the blend shifts it a
 *  few mm from the nominal points), so a part placed on one touches the skin. */
function surfaceLandmarks(node: SdfNode, m: HeadformMeasurements): HeadformLandmarks {
  const nominal = landmarksOf(m);
  const out = {} as HeadformLandmarks;
  const reach = 0.4 * m.faceHeight;
  for (const key of Object.keys(nominal) as (keyof HeadformLandmarks)[]) {
    const p = nominal[key], d = OUTWARD[key];
    const at = (t: number): Vec3 => [p[0] + d[0] * t, p[1] + d[1] * t, p[2] + d[2] * t];
    const f = (t: number) => { const q = at(t); return node.evaluate(q[0], q[1], q[2]); };
    // Step out from inside until the sign flips, then bisect.
    // The wings are found walking out from the middle of the nose, not from
    // the far cheek.
    const start = key === 'alareL' || key === 'alareR' ? -m.noseBreadth / 2 + 1 : -reach;
    let lo = start, hi = NaN;
    for (let t = start; t <= reach; t += 0.5) {
      if (f(t) > 0) { hi = t; break; }
      lo = t;
    }
    // No crossing, or already outside at the start: no surface to snap to.
    if (Number.isNaN(hi) || hi === start) {
      throw new ValidationError(`headform: couldn't place the ${key} landmark on the surface — these measurements are too far apart to make one head.`);
    }
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2;
      if (f(mid) > 0) hi = mid; else lo = mid;
    }
    out[key] = at((lo + hi) / 2);
  }
  return out;
}

/** What the built proxy actually measures, from its snapped landmarks and a
 *  girth line just above the brow. Overriding single measurements moves the
 *  blend, so these can differ from the requested ones. */
function achievedMeasurements(node: SdfNode, m: HeadformMeasurements, p: HeadformLandmarks): Partial<HeadformMeasurements> {
  // Girth: walk out from the skull's centre at the brow line, ray by ray.
  const z = p.glabella[2] + 8, cy = -0.01 * m.length;
  const ring: [number, number][] = [];
  for (let i = 0; i < 180; i++) {
    const a = (i / 180) * 2 * Math.PI, dx = Math.cos(a), dy = Math.sin(a);
    let lo = 0, hi = m.length;
    for (let j = 0; j < 30; j++) {
      const mid = (lo + hi) / 2;
      if (node.evaluate(dx * mid, cy + dy * mid, z) > 0) hi = mid; else lo = mid;
    }
    ring.push([dx * lo, cy + dy * lo]);
  }
  let circumference = 0, breadth = 0;
  for (let i = 0; i < ring.length; i++) {
    const [ax, ay] = ring[i], [bx, by] = ring[(i + 1) % ring.length];
    circumference += Math.hypot(bx - ax, by - ay);
    breadth = Math.max(breadth, 2 * Math.abs(ax));
  }
  const r = (n: number) => Math.round(n * 10) / 10;
  return {
    circumference: r(circumference),
    length: r(p.opisthocranion[1] - p.glabella[1]),
    breadth: r(breadth),
    bitragionBreadth: r(p.tragionL[0] - p.tragionR[0]),
    faceHeight: r(p.sellion[2] - p.menton[2]),
    pupillaryDistance: r(p.pupilL[0] - p.pupilR[0]),
    vertexHeight: r(p.vertex[2]),
    bizygomaticBreadth: r(p.zygionL[0] - p.zygionR[0]),
    bigonialBreadth: r(p.gonionL[0] - p.gonionR[0]),
    noseBreadth: r(p.alareL[0] - p.alareR[0]),
    noseProtrusion: r(Math.hypot(p.pronasale[1] - p.subnasale[1], p.pronasale[2] - p.subnasale[2])),
    noseLength: r(Math.hypot(p.sellion[1] - p.subnasale[1], p.sellion[2] - p.subnasale[2])),
  };
}

function round1(v: Vec3): Vec3 {
  return v.map(n => Math.round(n * 10) / 10) as Vec3;
}

/** `api.headform` for one run: a callable that builds the proxy, with
 *  `landmarks` (pure data, no geometry) beside it. */
export function createHeadform(sdf: any): any {
  const headform = (opts?: HeadformOptions) => {
    const r = resolve(opts, 'headform(opts)');
    return headformSdf(sdf, r.measurements, r.neck).build({ edgeLength: r.edgeLength });
  };
  headform.landmarks = (opts?: HeadformOptions) => {
    const r = resolve(opts, 'headform.landmarks(opts)');
    const node = headformSdf(sdf, r.measurements, r.neck);
    const points = surfaceLandmarks(node, r.measurements);
    const out = {} as HeadformLandmarks;
    for (const key of Object.keys(points) as (keyof HeadformLandmarks)[]) out[key] = round1(points[key]);
    return {
      units: 'mm',
      frame: 'origin between the tragions; XY = Frankfort plane; face toward −Y; +X = wearer\'s left; +Z up',
      measurements: r.measurements,
      achieved: achievedMeasurements(node, r.measurements, points),
      points: out,
    };
  };
  return headform;
}

export const __headformTestables__ = { resolve, landmarksOf, surfaceLandmarks, headformSdf, achievedMeasurements };
