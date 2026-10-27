// Hair for the parametric human — a signed field around the head, meshed with
// Manifold.levelSet by the caller. Pure (no WASM).
//
// Everything is built in the HEAD's rest frame (origin at the head joint,
// x = figure's left, y = back, z = up, print units) from the rest-pose skin,
// then placed rigidly through the head socket — so the hair turns with the
// head in any pose.
//
//   - SCALP: the skin's own signed distance pushed out by the hair's
//     thickness, above a HAIRLINE that runs from the forehead round over the
//     ears to the nape. The thickness tapers toward the hairline, so the hair
//     grows out of the skin instead of ending in a cut step.
//   - ENVELOPES per style: an ellipsoid-and-curtain that falls from the head
//     for bob / long (clear of the face, lying on the shoulders and back), an
//     afro cloud, a bun, a mohawk crest, anime spikes.
//   - TAILS: ponytail / pigtails are tapered capsule chains, relaxed out of
//     the body so they hang over the back and shoulders instead of through them.
//   - LOCKS: shallow waving grooves radiating from the crown.
//
// The field is negative inside hair. Parts join with a smooth minimum.

import { rasterizeOccupancy, edt3dSquared, blurField, makeTrilinearSampler, smin, type GridSpec } from '../geometry/meshSdf';
import type { HumanAsset, HumanMesh, Vec3 } from './humanModel';

export const HAIR_STYLES = ['bald', 'buzz', 'short', 'bob', 'long', 'ponytail', 'pigtails', 'bun', 'afro', 'mohawk', 'spiky'] as const;
export type HairStyle = typeof HAIR_STYLES[number];
export const HAIR_FRINGES = ['none', 'bangs', 'side'] as const;
export const BEARD_STYLES = ['none', 'stubble', 'mustache', 'goatee', 'short', 'full'] as const;

export interface HairOptions {
  style: HairStyle;
  color?: string;
  /** Length multiplier for bob / long / tails (1 = the style's natural length). */
  length?: number;
  /** Volume multiplier (thickness off the scalp, curtain fullness). */
  volume?: number;
  /** 'bangs' = a straight fringe to the brows, 'side' = a swept side fringe. */
  fringe?: typeof HAIR_FRINGES[number];
  /** Facial hair, its own `beard` label. */
  beard?: typeof BEARD_STYLES[number];
  beardColor?: string;
  /** Beard length multiplier (full beards). */
  beardLength?: number;
}

export interface HairField { field: Float32Array | null; beard: Float32Array | null; spec: GridSpec }

/**
 * Headwear pressing the hair flat: above its lower edge (head-local height at
 * head-local `x, y`) the hair keeps only `keep` (print units) off the scalp,
 * so a hat or helmet sits over it instead of the hair poking through. Below
 * the edge the hair widens back to its full shape, so it shows under the brim.
 */
export interface HairCover { edge: (x: number, y: number) => number; keep: number }
/** How fast the hair widens back out below a cover (thickness per unit down). */
const COVER_FLARE = 0.6;

const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);
const smooth01 = (t: number) => { const c = clamp(t, 0, 1); return c * c * (3 - 2 * c); };

/** Distance from p to the capsule a→b with radii ra→rb. */
function capsule(p: Vec3, a: Vec3, b: Vec3, ra: number, rb: number): number {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ap = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
  const t = clamp((ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / ((ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2) || 1), 0, 1);
  return Math.hypot(ap[0] - ab[0] * t, ap[1] - ab[1] * t, ap[2] - ab[2] * t) - (ra + (rb - ra) * t);
}

/** Scalp thickness per style, as a fraction of the print height. */
const THICKNESS: Record<HairStyle, number> = {
  bald: 0, buzz: 0.0035, short: 0.011, bob: 0.012, long: 0.012, ponytail: 0.007, pigtails: 0.008, bun: 0.007, afro: 0.012, mohawk: 0.003, spiky: 0.012,
};
/** The jaw-weight field: lattice coarsening, and the light blur that
 *  smooths its seams once the skin's weights are carried outward. */
const JAW_FIELD_COARSEN = 2;
const JAW_FIELD_BLURS = 2;
/** The bare patch round the lips, in lip half-heights. */
const LIP_CLEAR = 1.35;

/** Summed skin weight of the bones `pick` accepts, for asset vertex `v`. */
function boneWeight(asset: HumanAsset, v: number, pick: (name: string, bone: number) => boolean): number {
  let w = 0;
  for (let q = 0; q < 4; q++) { const b = asset.skinIndex[v * 4 + q]; if (pick(asset.bones[b].name, b)) w += asset.skinWeight[v * 4 + q]; }
  return w;
}
/** Head-room above the crown the lattice needs, as a fraction of the height. */
const HEADROOM: Partial<Record<HairStyle, number>> = { afro: 0.08, mohawk: 0.06, spiky: 0.07, bun: 0.06 };

interface Tail { pts: Vec3[]; r: number[] }

/** The hair field in head-local coordinates. `voxel` is the lattice step (print units). */
export function buildHairField(asset: HumanAsset, mesh: HumanMesh, o: HairOptions, height: number, voxel: number, cover: HairCover | null = null): HairField {
  const h = height;
  const k = mesh.scale;
  const head = mesh.restJoints.get('head____head')!;
  const toLocal = (v: number): Vec3 => [(mesh.rest[v * 3] - head[0]) * k, (mesh.rest[v * 3 + 1] - head[1]) * k, (mesh.rest[v * 3 + 2] - head[2]) * k];
  const J = (n: string): Vec3 => { const p = mesh.restJoints.get(`${n}____head`)!; return [(p[0] - head[0]) * k, (p[1] - head[1]) * k, (p[2] - head[2]) * k]; };

  // Landmarks (head-local, print units).
  const eye = J('eye.L');
  const nape = J('neck02');
  const chest = J('spine01');
  const skinTris: number[] = [];
  for (let t = 0; t < asset.nT; t++) {
    if (asset.triLabel[t] !== 0) continue;
    skinTris.push(asset.triVerts[t * 3], asset.triVerts[t * 3 + 1], asset.triVerts[t * 3 + 2]);
  }
  const used = new Set(skinTris);
  let top = -Infinity, rx = 0, front = Infinity, back = -Infinity;
  for (const v of used) {
    const p = toLocal(v);
    if (p[2] < eye[2] - 0.05 * h) continue;
    top = Math.max(top, p[2]);
    if (Math.abs(p[2] - (eye[2] + 0.04 * h)) < 0.02 * h) { rx = Math.max(rx, Math.abs(p[0])); front = Math.min(front, p[1]); back = Math.max(back, p[1]); }
  }
  const yc = (front + back) / 2, ry = (back - front) / 2;
  const headH = top - eye[2];
  const style = o.style;
  const vol = o.volume ?? 1;
  const L = o.length ?? 1;
  const thick = THICKNESS[style] * h * vol;
  const isCurtain = style === 'bob' || style === 'long';

  // Hairline heights by angle round the head (0 = straight ahead).
  const lineFront = eye[2] + headH * (style === 'ponytail' || style === 'bun' ? 0.66 : 0.6);
  const lineSide = eye[2] + headH * 0.1;
  const lineBack = nape[2] + 0.008 * h;
  const fringeZ = eye[2] + headH * 0.3;          // brow line
  const hairline = (x: number, a: number): number => {
    let front0 = lineFront;
    if (o.fringe === 'bangs') front0 = fringeZ;
    else if (o.fringe === 'side') front0 = eye[2] + headH * (0.32 + 0.3 * smooth01((x / rx + 1) / 2));
    // A real hairline recedes a little at the temples before it drops in
    // front of the ears.
    let z = front0 + (o.fringe ? 0 : headH * 0.04 * smooth01(a / 0.75));
    z += (lineSide - z) * smooth01((a - 0.8) / 0.75);
    z += (lineBack - z) * smooth01((a - 1.8) / 0.9);
    return z;
  };

  // Mouth and chin, for facial hair.
  const beardStyle = o.beard ?? 'none';
  const cornerL = J('oris03.L'), cornerR = J('oris03.R');
  const mouth: Vec3 = [(cornerL[0] + cornerR[0]) / 2, (cornerL[1] + cornerR[1]) / 2, (cornerL[2] + cornerR[2]) / 2];
  const mouthHalf = Math.abs(cornerL[0] - cornerR[0]) / 2;
  const chin = J('special04');
  const beardLen = o.beardLength ?? 1;
  // The lips themselves (the lip bones' skin, as the `lips` paint label uses):
  // the corner joints sit above the lips' centre, so the clear patch round
  // the mouth is centred on the lips instead.
  let lipLo = Infinity, lipHi = -Infinity;
  for (const v of used) if (boneWeight(asset, v, (n) => n.startsWith('oris01') || n.startsWith('oris05')) > 0.5) { const z = toLocal(v)[2]; lipLo = Math.min(lipLo, z); lipHi = Math.max(lipHi, z); }
  const lipZ = Number.isFinite(lipLo) ? (lipLo + lipHi) / 2 : mouth[2];
  const lipHalf = Number.isFinite(lipLo) ? (lipHi - lipLo) / 2 : 0.008 * h;

  // Curtain length (bob / long).
  const longZ = style === 'bob' ? eye[2] - headH * 1.0 * L : chest[2] - headH * 1.2 * L;

  // Lattice over the head (and down the back for long styles / tails).
  const tailLen = (style === 'ponytail' ? 0.24 : 0.18) * h * L;
  const lowZ = Math.min(
    nape[2] - 0.04 * h,
    isCurtain ? longZ - 0.02 * h : Infinity,
    style === 'ponytail' || style === 'pigtails' ? eye[2] - tailLen - 0.03 * h : Infinity,
    // (An open jaw drops the chin, so short beards get room below it too.)
    beardStyle === 'full' ? chin[2] - 0.08 * h * beardLen : beardStyle !== 'none' ? chin[2] - 0.06 * h : Infinity,
  );
  const reach = rx + (style === 'afro' ? 0.075 : style === 'spiky' ? 0.06 : isCurtain ? 0.06 : style === 'pigtails' ? 0.06 : 0.03) * h * vol;
  const pad = 3 * voxel;
  const min: Vec3 = [-reach - pad, front - (style === 'afro' ? 0.06 : 0.03) * h * vol - pad, lowZ - pad];
  const max: Vec3 = [reach + pad, back + (style === 'ponytail' || style === 'bun' || style === 'afro' || isCurtain ? 0.08 : 0.04) * h * vol + pad, top + (HEADROOM[style] ?? 0.03) * h * vol + pad];
  const spec: GridSpec = {
    nx: Math.ceil((max[0] - min[0]) / voxel) + 1,
    ny: Math.ceil((max[1] - min[1]) / voxel) + 1,
    nz: Math.ceil((max[2] - min[2]) / voxel) + 1,
    origin: min, voxel,
  };

  // Signed distance to the skin (negative inside the body), on the lattice.
  const local = new Float32Array(asset.nV * 3);
  for (const v of used) { const p = toLocal(v); local[v * 3] = p[0]; local[v * 3 + 1] = p[1]; local[v * 3 + 2] = p[2]; }
  const occ = rasterizeOccupancy({ vertProperties: local, triVerts: new Uint32Array(skinTris), numProp: 3, numTri: skinTris.length / 3 }, spec, 'nonzero');
  const dOut = edt3dSquared((i) => occ[i] !== 0, spec.nx, spec.ny, spec.nz);
  const dIn = edt3dSquared((i) => occ[i] === 0, spec.nx, spec.ny, spec.nz);
  let body = new Float32Array(occ.length);
  for (let i = 0; i < body.length; i++) body[i] = (Math.sqrt(dOut[i]) - Math.sqrt(dIn[i])) * voxel;
  body = blurField(body, spec);
  const bodyAt = makeTrilinearSampler(body, spec);

  // Push a point out of the body until it clears it by `r`.
  const relax = (p: Vec3, r: number): Vec3 => {
    const q: Vec3 = [p[0], p[1], p[2]];
    const e = voxel;
    for (let it = 0; it < 40; it++) {
      const d = bodyAt(q[0], q[1], q[2]);
      if (d >= r || d > 1e5) break;
      const g = [
        bodyAt(q[0] + e, q[1], q[2]) - bodyAt(q[0] - e, q[1], q[2]),
        bodyAt(q[0], q[1] + e, q[2]) - bodyAt(q[0], q[1] - e, q[2]),
        bodyAt(q[0], q[1], q[2] + e) - bodyAt(q[0], q[1], q[2] - e),
      ];
      const n = Math.hypot(g[0], g[1], g[2]) || 1;
      const step = Math.max(r - d, voxel * 0.5);
      for (let c = 0; c < 3; c++) q[c] += (g[c] / n) * step * 0.5;
    }
    return q;
  };
  // A hanging tail: from `base`, out along `out`, then falling, each joint
  // relaxed clear of the body so it lies over the back / shoulders.
  const tail = (base: Vec3, out: Vec3, len: number, r0: number): Tail => {
    const n = 7;
    const pts: Vec3[] = [base], r: number[] = [r0];
    let p: Vec3 = [base[0] + out[0], base[1] + out[1], base[2] + out[2]];
    for (let s = 1; s <= n; s++) {
      // Full through the middle, tapering to a tip.
      const u = s / n;
      const rr = r0 * (0.8 + 0.35 * Math.sin(Math.PI * Math.min(1, u * 1.4))) * (1 - 0.7 * u ** 2.5);
      // Clear the skin by the tail's radius plus room for a collar.
      p = relax(p, rr + 0.012 * h);
      pts.push(p); r.push(rr);
      // Fall, and lean in toward the head's axis (relax holds it off the
      // skin, so it drapes over the back / shoulders).
      const toAxis = Math.hypot(p[0], p[1] - yc) || 1;
      p = [p[0] - (p[0] / toAxis) * 0.012 * h, p[1] - ((p[1] - yc) / toAxis) * 0.012 * h, p[2] - len / n];
    }
    return { pts, r };
  };

  const tails: Tail[] = [];
  // Under a hat the tails leave the head just below its edge.
  const tailZ = (z: number) => (cover ? Math.min(z, cover.edge(0, back) - 0.012 * h) : z);
  if (style === 'ponytail') {
    const zb = tailZ(eye[2] + headH * 0.5);
    tails.push(tail([0, back + 0.006 * h, zb], [0, 0.02 * h, -0.01 * h], tailLen, 0.024 * h * vol));
  } else if (style === 'pigtails') {
    for (const sx of [-1, 1]) {
      tails.push(tail([sx * rx * 0.8, yc + ry * 0.7, tailZ(eye[2] + headH * 0.55)], [sx * 0.014 * h, 0.01 * h, -0.016 * h], tailLen, 0.017 * h * vol));
    }
  }
  // Spikes: golden-spiral directions over the top / back of the head.
  const spikes: { a: Vec3; b: Vec3; r: number }[] = [];
  if (style === 'spiky') {
    const c: Vec3 = [0, yc, eye[2] + headH * 0.25];
    const n = 46;
    for (let i = 0; i < n; i++) {
      const zz = 1 - (i + 0.5) / n * 1.25;                    // down to ~25° below the equator
      const rr = Math.sqrt(Math.max(0, 1 - zz * zz));
      const ph = i * 2.399963;
      const dir: Vec3 = [rr * Math.cos(ph), rr * Math.sin(ph), zz];
      // Keep the face clear: drop downward-pointing spikes over the forehead.
      if (dir[1] < -0.45 && dir[2] < 0.55) continue;
      if (zz < -0.1 && dir[1] < 0) continue;
      const tilt = dir[2] < 0.3 ? 0.35 : 0;                   // side / back spikes droop
      const d: Vec3 = [dir[0], dir[1], dir[2] - tilt];
      const dn = Math.hypot(d[0], d[1], d[2]);
      const R = Math.hypot(dir[0] * rx, dir[1] * ry, dir[2] * headH * 0.75);
      const len = (0.032 + 0.012 * Math.sin(i * 7.31)) * h * vol;
      spikes.push({
        a: [c[0] + dir[0] * R * 0.6, c[1] + dir[1] * R * 0.6, c[2] + dir[2] * R * 0.6],
        b: [c[0] + dir[0] * R + (d[0] / dn) * len, c[1] + dir[1] * R + (d[1] / dn) * len, c[2] + dir[2] * R + (d[2] / dn) * len],
        r: 0.016 * h * vol,
      });
    }
    // A fringe of spikes over the forehead.
    for (const fx of [-0.55, -0.15, 0.25, 0.6]) {
      const a: Vec3 = [fx * rx, front + ry * 0.35, eye[2] + headH * 0.8];
      spikes.push({ a, b: [fx * rx * 1.1, front - 0.012 * h, eye[2] + headH * 0.28], r: 0.012 * h * vol });
    }
  }
  // Mohawk blades: a row along the mid-line from the forehead to the nape,
  // each pointing out from the head's centre.
  const blades: { a: Vec3; b: Vec3; r: number }[] = [];
  if (style === 'mohawk') {
    const c: Vec3 = [0, yc, eye[2] + headH * 0.1];
    const n = 7;
    for (let i = 0; i < n; i++) {
      const ang = -0.55 + (i / (n - 1)) * 2.55;               // from over the brow (forward) back past the crown
      const dir: Vec3 = [0, Math.sin(ang), Math.cos(ang)];
      const R = Math.hypot(dir[1] * ry, dir[2] * (headH * 0.9));
      const len = (0.042 - 0.012 * Math.abs(i - 2) / (n - 1)) * h * vol;
      blades.push({
        a: [0, c[1] + dir[1] * R * 0.75, c[2] + dir[2] * R * 0.75],
        b: [0, c[1] + dir[1] * (R + len) + 0.01 * h, c[2] + dir[2] * (R + len)],
        r: 0.014 * h * vol,
      });
    }
  }
  // Afro bumps: three plane waves in skewed directions.
  const W = (2 * Math.PI) / (0.028 * h);
  const waves: Vec3[] = [[0.8, 0.5, 0.33], [-0.3, 0.85, 0.42], [0.45, -0.25, 0.86]];

  // Facial hair: a shell over the jaw, chin and (by style) cheeks and upper
  // lip, with the lips left clear; a full beard adds a mass below the chin.
  const beardThick = { none: 0, stubble: 0.003, mustache: 0.006, goatee: 0.007, short: 0.007, full: 0.01 }[beardStyle] * h;
  const beardAt = (p: Vec3, d: number, a: number): number => {
    const [x, y, z] = p;
    // Lips (an ellipse round the mouth) stay bare.
    const lips = 1 - Math.hypot(x / (mouthHalf * 1.25), (z - lipZ) / (lipHalf * LIP_CLEAR));
    const front = y - (mouth[1] + 0.03 * h);                 // < 0 on the face side
    // Mustache: over the upper lip, drooping at the corners.
    const droop = smooth01((Math.abs(x) - mouthHalf * 0.7) / (mouthHalf * 0.6)) * 0.012 * h;
    const mustache = Math.max(Math.abs(x) - mouthHalf * 1.4, z - (mouth[2] + 0.017 * h), mouth[2] + 0.003 * h - droop - z, front);
    const chinPatch = Math.max(Math.abs(x) - mouthHalf * 1.05, z - (mouth[2] - 0.006 * h), chin[2] - 0.026 * h - z, front);
    let region: number;
    if (beardStyle === 'mustache') region = mustache;
    else if (beardStyle === 'goatee') region = Math.min(mustache, chinPatch);
    else {
      // Jaw and cheeks forward of the ears: up to a cheek line that rises
      // toward the sideburns, down under the chin at the front and along
      // the jawline at the sides.
      const top = mouth[2] + (eye[2] - mouth[2]) * (0.3 + 0.55 * smooth01((a - 0.45) / 1.0));
      const bottom = chin[2] - 0.028 * h + (mouth[2] - 0.006 * h - (chin[2] - 0.028 * h)) * smooth01((a - 0.5) / 0.8);
      region = Math.min(Math.max(a - 1.5, z - top, bottom - z, chin[2] - 0.03 * h - z), mustache);
    }
    region = Math.max(region, lips);
    const t = beardThick * (0.4 + 0.6 * smooth01(-region / (0.008 * h)));
    let b = Math.max(d - t, region);
    if (beardStyle === 'full') {
      // A broad rounded mass under the jaw, longer at the chin.
      const c: Vec3 = [0, chin[1] + 0.006 * h, chin[2] - 0.024 * h * beardLen];
      const mass = Math.hypot(x / (mouthHalf * 2.7), (y - c[1]) / (0.03 * h), (z - c[2]) / (0.034 * h * beardLen)) - 1;
      const strands = 0.0012 * h * Math.abs(Math.sin(Math.atan2(x, -(y - c[1])) * 10 + z * 0.4));
      b = smin(b, Math.max(mass * 0.03 * h + strands, front - 0.015 * h, z - mouth[2] + 0.01 * h), 0.008 * h);
    }
    return b;
  };

  // The jaw moves on its own bone (expression.jawOpen): carry the beard
  // below the mouth with it. For a sample at head-frame q, the rest point it
  // came from is the jaw's motion relative to the head, undone; the sample
  // blends toward it below the mouth line. (Bone transforms are world =
  // R·(k·rest) + T; the head frame is the head socket's.)
  const bi = new Map(asset.bones.map((b, i) => [b.name, i]));
  const Rh = mesh.bones.R[bi.get('head')!], Rj = mesh.bones.R[bi.get('jaw')!];
  const Th = mesh.bones.T[bi.get('head')!], Tj = mesh.bones.T[bi.get('jaw')!];
  // A = Rhᵀ·Rj, c = Rhᵀ·(Tj − Th), so posed head-frame q = A·X + c − k·h.
  const A = [0, 1, 2].flatMap((r) => [0, 1, 2].map((col) => Rh[r] * Rj[col] + Rh[3 + r] * Rj[3 + col] + Rh[6 + r] * Rj[6 + col]));
  const dT = [Tj[0] - Th[0], Tj[1] - Th[1], Tj[2] - Th[2]];
  const cJ = [0, 1, 2].map((r) => Rh[r] * dT[0] + Rh[3 + r] * dT[1] + Rh[6 + r] * dT[2]);
  const kh = [head[0] * k, head[1] * k, head[2] * k];
  const jawMoves = A.some((v, i) => Math.abs(v - (i % 4 === 0 ? 1 : 0)) > 1e-6);
  // How much each point rides the jaw: the skin's own jaw weights (the jaw
  // and the bones it carries), splatted onto a coarse lattice and carried out
  // into the space the beard fills, so the beard follows the skin the way
  // skinning moves it (a height cut tore the mouth corners).
  let jawW: ((x: number, y: number, z: number) => number) | null = null;
  if (jawMoves && beardStyle !== 'none') {
    const jawBones = new Set<number>();
    asset.bones.forEach((b, i) => { if (b.name === 'jaw' || (b.parent >= 0 && jawBones.has(b.parent))) jawBones.add(i); });
    const cs: GridSpec = {
      nx: Math.ceil(spec.nx / JAW_FIELD_COARSEN) + 1, ny: Math.ceil(spec.ny / JAW_FIELD_COARSEN) + 1, nz: Math.ceil(spec.nz / JAW_FIELD_COARSEN) + 1,
      origin: min, voxel: voxel * JAW_FIELD_COARSEN,
    };
    const num = new Float32Array(cs.nx * cs.ny * cs.nz), den = new Float32Array(num.length);
    // Splatted where the skin IS (posed, in the head's frame), since a sample
    // asks how much the skin around it now rides the jaw.
    const Ph = mesh.joints.get('head____head')!;
    for (const v of used) {
      const d = [mesh.posed[v * 3] - Ph[0], mesh.posed[v * 3 + 1] - Ph[1], mesh.posed[v * 3 + 2] - Ph[2]];
      const q = [0, 1, 2].map((r) => Rh[r] * d[0] + Rh[3 + r] * d[1] + Rh[6 + r] * d[2]);
      const ix = Math.round((q[0] - min[0]) / cs.voxel), iy = Math.round((q[1] - min[1]) / cs.voxel), iz = Math.round((q[2] - min[2]) / cs.voxel);
      if (ix < 0 || iy < 0 || iz < 0 || ix >= cs.nx || iy >= cs.ny || iz >= cs.nz) continue;
      const c = ix + iy * cs.nx + iz * cs.nx * cs.ny;
      num[c] += boneWeight(asset, v, (_n, b) => jawBones.has(b)); den[c] += 1;
    }
    // Cells with skin take its mean weight; every other cell takes the weight
    // of the nearest skin (a breadth-first fill outward), then a light blur.
    let wgt = new Float32Array(num.length);
    const queue: number[] = [];
    const done = new Uint8Array(num.length);
    for (let c = 0; c < num.length; c++) if (den[c] > 0) { wgt[c] = num[c] / den[c]; done[c] = 1; queue.push(c); }
    const sx = 1, sy = cs.nx, sz = cs.nx * cs.ny;
    for (let qi = 0; qi < queue.length; qi++) {
      const c = queue[qi];
      const x = c % cs.nx, y = Math.floor(c / sy) % cs.ny, z = Math.floor(c / sz);
      for (const [d, ok] of [[-sx, x > 0], [sx, x < cs.nx - 1], [-sy, y > 0], [sy, y < cs.ny - 1], [-sz, z > 0], [sz, z < cs.nz - 1]] as [number, boolean][]) {
        if (!ok || done[c + d]) continue;
        done[c + d] = 1; wgt[c + d] = wgt[c]; queue.push(c + d);
      }
    }
    for (let it = 0; it < JAW_FIELD_BLURS; it++) wgt = blurField(wgt, cs);
    const ws = makeTrilinearSampler(wgt, cs);
    jawW = (x, y, z) => { const w = ws(x, y, z); return w < 1e5 ? clamp(w, 0, 1) : 0; };
  }
  const toRest = (p: Vec3, w: number): Vec3 => {
    const r = [p[0] + kh[0] - cJ[0], p[1] + kh[1] - cJ[1], p[2] + kh[2] - cJ[2]];
    // X = Aᵀ·r, back in the head-local frame.
    const q = [0, 1, 2].map((col) => A[col] * r[0] + A[3 + col] * r[1] + A[6 + col] * r[2] - kh[col]);
    return [p[0] + (q[0] - p[0]) * w, p[1] + (q[1] - p[1]) * w, p[2] + (q[2] - p[2]) * w];
  };
  const unJaw = (p: Vec3): Vec3 => toRest(p, jawW!(p[0], p[1], p[2]));

  const field = style === 'bald' ? null : new Float32Array(occ.length);
  const beard = beardStyle === 'none' ? null : new Float32Array(occ.length);
  const lockAmp = (style === 'buzz' || style === 'spiky' || style === 'mohawk' ? 0 : isCurtain ? 0.0018 : 0.0014) * h * vol;
  const ramp = 0.03 * h;
  const faceAngle = 0.95;                                     // radians either side of straight ahead
  for (let kz = 0; kz < spec.nz; kz++) for (let jy = 0; jy < spec.ny; jy++) for (let ix = 0; ix < spec.nx; ix++) {
    const i = ix + jy * spec.nx + kz * spec.nx * spec.ny;
    const x = min[0] + ix * voxel, y = min[1] + jy * voxel, z = min[2] + kz * voxel;
    const p: Vec3 = [x, y, z];
    const d = body[i];
    const theta = Math.atan2(x, -(y - yc));                   // 0 = straight ahead, ±π = back
    const a = Math.abs(theta);
    const hl = hairline(x, a);
    // Locks: shallow grooves radiating from the crown, waving as they fall,
    // faded out at the crown where they would converge.
    const rh = Math.hypot(x, y - yc);
    const crown = smooth01(rh / (0.7 * rx));
    const wave = Math.sin((z / headH) * 3.2 + theta * 1.7) * 0.35;
    const locks = lockAmp * crown * (Math.abs(Math.sin(theta * 9 + wave)) * 2 - 1);
    // Scalp: thickness ramps up from the hairline, and grows toward the crown.
    const lift = smooth01((z - eye[2]) / headH);
    const t = thick * (0.15 + 0.85 * smooth01((z - hl) / ramp)) * (1 + 0.35 * lift);
    let f = Math.max(d - t + locks, hl - z);

    if (isCurtain) {
      // Ellipsoid round the head over a curtain that flares as it falls.
      const zc = eye[2] + headH * 0.2;
      const grow = (style === 'long' ? 1.6 : 1.45) * thick;
      const drop = clamp((zc - z) / headH, 0, 4);
      const flare = 1 + 0.08 * drop;
      const ex = x / ((rx + grow) * flare), ey = (y - yc) / ((ry + grow) * flare), ez = z > zc ? (z - zc) / (top + thick - zc) : 0;
      const env = (Math.hypot(ex, ey, ez) - 1) * rx;
      const below = longZ + 0.006 * h * Math.sin(theta * 9) - z;
      // Open the face below the hairline (or below the fringe).
      const face = Math.min((faceAngle - a) * rx, (o.fringe === 'bangs' ? fringeZ : hl) - z);
      let mass = Math.max(env + locks, below, face);
      // Below the chin, lie on the shoulders / back instead of standing off them.
      const w = smooth01((eye[2] - headH * 0.9 - z) / (0.04 * h));
      mass = Math.max(mass, d - 0.03 * h * vol - (1 - w) * h);
      // Below the shoulders it falls down the back only (front locks end at
      // the collarbone instead of running down the sides under the arms).
      const wS = smooth01((nape[2] - 0.01 * h - z) / (0.02 * h));
      mass = Math.max(mass, (1.95 - a) * rx - (1 - wS) * h);
      f = smin(f, mass, 0.006 * h);
    }
    for (const tl of tails) {
      let td = Infinity;
      for (let s = 0; s + 1 < tl.pts.length; s++) td = Math.min(td, capsule(p, tl.pts[s], tl.pts[s + 1], tl.r[s], tl.r[s + 1]));
      // Twisted strands along the tail.
      f = smin(f, td + lockAmp * 0.6 * Math.sin(Math.atan2(x - tl.pts[0][0], y - tl.pts[0][1]) * 6 + z * 1.3), 0.008 * h);
    }
    if (style === 'ponytail' || style === 'pigtails') {
      // A tie round each tail where it leaves the head.
      for (const tl of tails) f = Math.min(f, capsule(p, tl.pts[0], tl.pts[1], tl.r[0] * 0.95, tl.r[1] * 0.95) + 0.0015 * h);
    }
    if (style === 'bun') {
      const r = 0.036 * h * vol;
      const c: Vec3 = [0, back + r * 0.35, eye[2] + headH * 0.92];
      const q = [x - c[0], y - c[1], z - c[2]];
      const swirl = lockAmp * Math.sin(Math.atan2(q[0], q[2]) * 5 + Math.hypot(q[0], q[2]) / r * 4);
      f = smin(f, Math.hypot(q[0], q[1] * 1.15, q[2]) - r + swirl, 0.01 * h);
    }
    if (style === 'afro') {
      // A cloud set back on the head (less growth over the face).
      const g = 0.07 * h * vol;
      const c: Vec3 = [0, yc + ry * 0.2, eye[2] + headH * 0.45];
      const gy = y < c[1] ? g * 0.35 : g;
      const e = Math.hypot(x / (rx + g), (y - c[1]) / (ry + gy), (z - c[2]) / (headH * 0.85 + g)) - 1;
      let bumps = 0;
      for (const wv of waves) bumps += Math.sin((x * wv[0] + y * wv[1] + z * wv[2]) * W);
      const cloud = e * (rx + g) + 0.0035 * h * bumps / 3;
      // An underside that follows the hairline and curls up as it leaves the
      // skin, so the cloud frames the face instead of ending in a flat brim.
      const edge = hl + (Math.min(hl, eye[2] - 0.01 * h) - hl) * smooth01((a - 0.7) / 0.5);
      const under = edge + Math.max(d, 0) ** 2 / (0.09 * h) - z;
      // Over the face, roll the cloud down onto the forehead hairline.
      const sf = (1 - smooth01((a - 0.7) / 0.6)) * (1 - smooth01((z - hl - 0.03 * h) / (0.03 * h)));
      const roll = d - thick - 0.1 * h * smooth01((z - hl) / (0.05 * h)) - (1 - sf) * h;
      f = smin(f, Math.max(cloud, under, roll), 0.008 * h);
    }
    if (style === 'mohawk') {
      // A low strip along the mid-line under a row of flattened blades.
      f = Math.min(f, Math.max(Math.abs(x) - 0.008 * h * vol, d - 0.008 * h * vol, hl - z));
      const q: Vec3 = [x * 2.4, y, z];
      for (const b of blades) f = smin(f, capsule(q, b.a, b.b, b.r, 0.001 * h), 0.004 * h);
    }
    for (const s of spikes) f = smin(f, capsule(p, s.a, s.b, s.r, 0.0008 * h), 0.004 * h);
    // Pressed flat under headwear, widening back out below its edge.
    if (cover) f = Math.max(f, d - cover.keep - Math.max(0, cover.edge(x, y) - z) * COVER_FLARE);
    if (field) field[i] = f;
    if (beard) {
      if (jawW) {
        const q = unJaw(p);
        beard[i] = beardAt(q, bodyAt(q[0], q[1], q[2]), Math.abs(Math.atan2(q[0], -(q[1] - yc))));
      } else beard[i] = beardAt(p, d, a);
    }
  }
  return { field, beard, spec };
}
