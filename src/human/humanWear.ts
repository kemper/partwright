// Clothing and armor for the parametric human — pure geometry, no WASM.
//
// Every worn item is a SHELL grown from the body itself, so it follows every
// morph and every pose for free:
//
//   1. REGION — a smooth scalar field on the body's rest-pose vertices says
//      where the item is (f > 0 inside): bone-weight groups (torso, arms, legs,
//      feet…) intersected with cuts along the limbs (sleeve / leg length), at
//      heights (hem, waistband) and around the neck (neckline). The field is
//      in decimetres of the rest pose, so a cut lands in the same anatomical
//      place on every body shape.
//   2. CLIP — marching triangles cut the body surface along f = 0, so hems
//      and cuffs are smooth curves, not the mesh's triangle staircase.
//   3. OFFSET — the patch is lifted off the POSED body along its normals:
//      outer surface at +thickness (plus ease, cuffs, folds), inner surface a
//      little inside the skin so the union with the body always fuses.
//      Armor smooths its outer surface (plates hide the anatomy) and rolls a
//      thicker rim along its edges.
//   4. CLOSE — the boundary loops are stitched outer↔inner into side walls, so
//      every item is a closed, oriented mesh ready for Manifold.
//
// Skirts and dresses hang from MakeHuman's own skirt helper surface (it morphs
// and skins with the legs) instead of the body.

import type { HumanAsset, HumanMesh, Vec3 } from './humanModel';
import { makeTrilinearSampler, rasterizeOccupancy, signedFieldFromOccupancy, closeField, blurField, type GridSpec } from '../geometry/meshSdf';
import { buildFootwear, FOOTWEAR_ITEMS, type FootwearField } from './humanShoes';
import type { HairCover } from './humanHair';

// --- Small vector math ---------------------------------------------------------
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);
const smooth = (e0: number, e1: number, x: number) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };

/** A closed triangle mesh in posed world units. */
export interface ShellMesh { positions: Float32Array; triVerts: Uint32Array }

// --- Body queries on the rest pose --------------------------------------------------

/** Bone-name groups (prefix match) for regions. */
export const BONE_GROUPS = {
  torso: ['spine', 'breast', 'clavicle', 'shoulder01'],
  hips: ['root', 'pelvis'],
  arm: ['upperarm', 'lowerarm'],
  hand: ['wrist', 'finger', 'metacarpal'],
  leg: ['upperleg', 'lowerleg'],
  foot: ['foot', 'toe'],
  neck: ['neck'],
} as const;
type Group = keyof typeof BONE_GROUPS;

/** Per-vertex rest-pose context the region fields read. */
export class BodyContext {
  readonly asset: HumanAsset;
  readonly mesh: HumanMesh;
  readonly rest: Float32Array;
  readonly joints: Map<string, Vec3>;
  private groupWeight = new Map<string, Float32Array>();
  constructor(asset: HumanAsset, mesh: HumanMesh) {
    this.asset = asset;
    this.mesh = mesh;
    this.rest = mesh.rest;
    this.joints = mesh.restJoints;
  }
  /** Rest position of a joint's head (or `tail`). */
  joint(bone: string, end: 'head' | 'tail' = 'head'): Vec3 { return this.joints.get(`${bone}____${end}`)!; }
  /** Summed skin weight of the bones in `groups`, per asset vertex (cached). */
  weight(groups: Group[]): Float32Array {
    const key = groups.join('+');
    let w = this.groupWeight.get(key);
    if (w) return w;
    const prefixes = groups.flatMap((g) => BONE_GROUPS[g]);
    const boneIn = this.asset.bones.map((b) => prefixes.some((p) => b.name.startsWith(p)));
    w = new Float32Array(this.asset.nV);
    for (let v = 0; v < this.asset.nV; v++) {
      for (let k = 0; k < 4; k++) if (boneIn[this.asset.skinIndex[v * 4 + k]]) w[v] += this.asset.skinWeight[v * 4 + k];
    }
    this.groupWeight.set(key, w);
    return w;
  }
  pos(v: number): Vec3 { return [this.rest[v * 3], this.rest[v * 3 + 1], this.rest[v * 3 + 2]]; }
  /** Parameter along a 3-joint limb chain: 0 at `a`, 1 at `b`, 2 at `c`
   *  (extrapolated past either end), for the side the vertex is on. */
  limbParam(p: Vec3, a: Vec3, b: Vec3, c: Vec3): number {
    const seg = (s: Vec3, e: Vec3) => {
      const d = sub(e, s); const L2 = dot(d, d) || 1;
      const t = dot(sub(p, s), d) / L2;
      const q = [s[0] + d[0] * clamp(t, 0, 1), s[1] + d[1] * clamp(t, 0, 1), s[2] + d[2] * clamp(t, 0, 1)] as Vec3;
      return { t, dist: len(sub(p, q)) };
    };
    const s1 = seg(a, b), s2 = seg(b, c);
    if (s1.t <= 1 && (s1.dist <= s2.dist || s2.t < 0)) return s1.t;
    return 1 + s2.t;
  }
  armParam(p: Vec3): number {
    const s = p[0] >= 0 ? 'L' : 'R';
    return this.limbParam(p, this.joint(`upperarm01.${s}`), this.joint(`lowerarm01.${s}`), this.joint(`wrist.${s}`));
  }
  legParam(p: Vec3): number {
    const s = p[0] >= 0 ? 'L' : 'R';
    return this.limbParam(p, this.joint(`upperleg01.${s}`), this.joint(`lowerleg01.${s}`), this.joint(`foot.${s}`));
  }
  /** How much of vertex `v` belongs to a limb (0 torso … 1 limb), smoothed so
   *  limb-only cuts (sleeve / leg length) fade out across the shoulder / hip
   *  instead of slicing through the torso. */
  armness(v: number): number { return smooth(0.3, 0.7, this.weight(['arm', 'hand'])[v]); }
  legness(v: number): number { return smooth(0.3, 0.7, this.weight(['leg', 'foot'])[v]); }
  /** Rest length of a limb chain's first segment (dm) — converts limb params to distances. */
  /** Per asset vertex, 1 over the bust (both breasts and the cleavage
   *  between them), fading to 0 around it: where cloth bridges (cached). */
  bustRegion(): Float32Array {
    if (this.bust) return this.bust;
    const a = this.joint('breast.L', 'tail'), b = this.joint('breast.R', 'tail');
    const ab = sub(b, a), l2 = dot(ab, ab) || 1;
    const w = new Float32Array(this.asset.nV);
    for (let v = 0; v < this.asset.nV; v++) {
      const p = this.pos(v);
      const t = clamp(dot(sub(p, a), ab) / l2, 0, 1);
      const d = len(sub(p, [a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t]));
      // Front only: the back at the same height is not under the bust.
      w[v] = smooth(BUST_RADIUS_DM * 1.4, BUST_RADIUS_DM, d) * smooth(this.joint('spine01')[1] + 0.1, this.joint('spine01')[1] - 0.2, p[1]);
    }
    return (this.bust = w);
  }
  private bust: Float32Array | null = null;
  /**
   * The posed torso CLOSED by a ball of BRIDGE_RADIUS_DM around the bust:
   * signed distance (world units, negative inside), so a point in the crease
   * under the bust or in the cleavage reads how far below the taut-cloth
   * surface it lies. Arms are left out, so the cloth never bridges to them
   * (cached).
   */
  bustClosure(): (x: number, y: number, z: number) => number {
    if (this.closure) return this.closure;
    const w = this.bustRegion(), u = this.mesh.scale, P = this.mesh.posed;
    const arm = this.weight(['arm', 'hand']);
    const r = BRIDGE_RADIUS_DM * u, voxel = BRIDGE_VOXEL_DM * u;
    const lo: Vec3 = [Infinity, Infinity, Infinity], hi: Vec3 = [-Infinity, -Infinity, -Infinity];
    for (let v = 0; v < this.asset.nV; v++) {
      if (w[v] <= 0) continue;
      for (let c = 0; c < 3; c++) { lo[c] = Math.min(lo[c], P[v * 3 + c]); hi[c] = Math.max(hi[c], P[v * 3 + c]); }
    }
    const pad = r + 4 * voxel;
    const spec: GridSpec = {
      nx: Math.ceil((hi[0] - lo[0] + 2 * pad) / voxel) + 1,
      ny: Math.ceil((hi[1] - lo[1] + 2 * pad) / voxel) + 1,
      nz: Math.ceil((hi[2] - lo[2] + 2 * pad) / voxel) + 1,
      origin: [lo[0] - pad, lo[1] - pad, lo[2] - pad], voxel,
    };
    const tris: number[] = [];
    for (let t = 0; t < this.asset.nT; t++) {
      if (this.asset.triLabel[t] !== 0) continue;
      const a = this.asset.triVerts[t * 3], b = this.asset.triVerts[t * 3 + 1], c = this.asset.triVerts[t * 3 + 2];
      if (arm[a] > 0.5 || arm[b] > 0.5 || arm[c] > 0.5) continue;
      tris.push(a, b, c);
    }
    const occ = rasterizeOccupancy({ vertProperties: P, triVerts: new Uint32Array(tris), numProp: 3, numTri: tris.length / 3 }, spec, 'nonzero');
    const closed = blurField(closeField(signedFieldFromOccupancy(occ, spec), spec, r), spec);
    return (this.closure = makeTrilinearSampler(closed, spec));
  }
  private closure: ((x: number, y: number, z: number) => number) | null = null;
  /** The bust bridge a top or a breastplate passes to its shell. */
  bustBridge(): NonNullable<ShellStyle['bridge']> { return { weight: this.bustRegion(), closed: this.bustClosure(), step: BRIDGE_VOXEL_DM * this.mesh.scale, lift: BRIDGE_LIFT_DM * this.mesh.scale, depth: BRIDGE_NORMAL_DEPTH_DM * this.mesh.scale }; }
  armLen(): number { return len(sub(this.joint('lowerarm01.L'), this.joint('upperarm01.L'))); }
  legLen(): number { return len(sub(this.joint('lowerleg01.L'), this.joint('upperleg01.L'))); }
}

// --- Clip + shell ------------------------------------------------------------------

/** A patch vertex: a body vertex, or a point on a body edge (a→b at t). */
interface PatchVert { a: number; b: number; t: number }

interface Patch { verts: PatchVert[]; tris: number[] }

/** Clip the triangles `tris` (asset vertex indices) to f > 0. Cut points on a
 *  shared edge are shared, so the patch stays a manifold surface. */
function clipPatch(tris: ArrayLike<number>, f: Float32Array): Patch {
  const verts: PatchVert[] = [];
  const index = new Map<string, number>();
  const vert = (a: number, b: number, t: number): number => {
    let key: string;
    if (t <= 0) { key = `${a}`; b = a; t = 0; } else if (t >= 1) { key = `${b}`; a = b; t = 0; } else key = a < b ? `${a}:${b}` : `${b}:${a}`;
    let i = index.get(key);
    if (i === undefined) {
      i = verts.length;
      // Store edge points in canonical (low, high) order.
      if (a > b && t > 0) verts.push({ a: b, b: a, t: 1 - t }); else verts.push({ a, b, t });
      index.set(key, i);
    }
    return i;
  };
  const out: number[] = [];
  for (let k = 0; k < tris.length; k += 3) {
    const tri = [tris[k], tris[k + 1], tris[k + 2]];
    const fv = tri.map((v) => f[v]);
    if (fv[0] <= 0 && fv[1] <= 0 && fv[2] <= 0) continue;
    const poly: number[] = [];
    for (let i = 0; i < 3; i++) {
      const a = tri[i], b = tri[(i + 1) % 3], fa = fv[i], fb = fv[(i + 1) % 3];
      if (fa > 0) poly.push(vert(a, a, 0));
      if ((fa > 0) !== (fb > 0)) poly.push(vert(a, b, fa / (fa - fb)));
    }
    for (let i = 1; i + 1 < poly.length; i++) {
      if (poly[0] === poly[i] || poly[i] === poly[i + 1] || poly[0] === poly[i + 1]) continue;
      out.push(poly[0], poly[i], poly[i + 1]);
    }
  }
  return { verts, tris: out };
}

/** Area-weighted vertex normals of `tris` over `pos` (every vertex index used). */
export function vertexNormals(pos: Float32Array, tris: ArrayLike<number>, nV: number): Float32Array {
  const n = new Float32Array(nV * 3);
  for (let k = 0; k < tris.length; k += 3) {
    const a = tris[k], b = tris[k + 1], c = tris[k + 2];
    const ux = pos[b * 3] - pos[a * 3], uy = pos[b * 3 + 1] - pos[a * 3 + 1], uz = pos[b * 3 + 2] - pos[a * 3 + 2];
    const vx = pos[c * 3] - pos[a * 3], vy = pos[c * 3 + 1] - pos[a * 3 + 1], vz = pos[c * 3 + 2] - pos[a * 3 + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const v of [a, b, c]) { n[v * 3] += nx; n[v * 3 + 1] += ny; n[v * 3 + 2] += nz; }
  }
  for (let v = 0; v < nV; v++) {
    const l = Math.hypot(n[v * 3], n[v * 3 + 1], n[v * 3 + 2]) || 1;
    n[v * 3] /= l; n[v * 3 + 1] /= l; n[v * 3 + 2] /= l;
  }
  return n;
}

/** Reach of the bust region round the line between the breasts' apexes (rest dm). */
const BUST_RADIUS_DM = 1.3;
/** Radius of the ball that closes the torso round the bust (rest dm): the
 *  fillet taut cloth makes across the cleavage and under the bust. */
const BRIDGE_RADIUS_DM = 1.2;
/** Lattice step of that closing (rest dm). */
const BRIDGE_VOXEL_DM = 0.06;
/** Passes relaxing the bridged surface (see buildShell). */
const BRIDGE_RELAX_PASSES = 10;
/** How far outside the closed surface (rest dm) the bridge measures from. */
const BRIDGE_LIFT_DM = 0.08;
/** Depth (rest dm) below the closed surface at which its normal fully
 *  replaces the skin's. */
const BRIDGE_NORMAL_DEPTH_DM = 0.16;

/** Passes of hem fairing (see buildShell). */
const HEM_FAIRING_PASSES = 8;
/** Rest height (dm) above the ankle joint that counts as "on the feet". */
const FEET_ZONE = 0.6;
/** Outward swing of a fully flared skirt per unit of drop below the hips. */
const SKIRT_FLARE = 0.35;
/** Shells stay at least this fraction of their offset off the skin. */
const MIN_CLEARANCE = 0.35;
/** Normal-smoothing passes every shell gets (plus 2 per `smoothPasses`). */
const NORMAL_SMOOTHING_BASE = 3;
/** Taubin smoothing weights (shrink, then inflate). */
const TAUBIN_LAMBDA = 0.5;
const TAUBIN_MU = -0.53;

export interface ShellStyle {
  /** Outer offset off the skin (world units). */
  thickness: number;
  /** How far the inner surface sinks into the skin, so the union fuses. */
  inset: number;
  /** Extra outer offset per patch vertex (ease, cuffs, folds, soles…). */
  /** `edge` is the distance (rest units) from the item's nearest hem. */
  extra?: (rest: Vec3, edge: number, normal: Vec3) => number;
  /** Laplacian passes on the outer surface (armor plates hide anatomy). */
  smoothPasses?: number;
  /** Crisp relief added AFTER the smoothing, so it keeps its edges: rolled
   *  rims, ridges, lames (world units, same arguments as `extra`). */
  detail?: (rest: Vec3, edge: number) => number;
  /** Bevel width (rest units): within it the outer offset tapers toward the
   *  hem, to BEVEL_FLOOR of its thickness at the edge itself. */
  bevel?: number;
  /** Split each triangle into four first, so fine relief resolves. */
  subdivide?: boolean;
  /** Where the shell bridges hollows instead of following them (cloth
   *  spanning the cleavage and the crease under the bust, as a real top
   *  does): a 0–1 weight per asset vertex, and the closed surface it rises
   *  to (signed distance in posed world units). */
  bridge?: { weight: Float32Array; closed: (x: number, y: number, z: number) => number; step: number; lift: number; depth: number };
  /** Studs along the hems: one every `spacing` (rest units) round each hem,
   *  `inset` in from it, of radius `radius` (world units). */
  rivets?: { spacing: number; inset: number; radius: number };
}

/** A stud on a shell's surface: centre on the outer surface, its normal, radius. */
export interface Rivet { pos: Vec3; n: Vec3; r: number }

/** A bevelled edge keeps this fraction of the plate's thickness at the hem. */
const BEVEL_FLOOR = 0.4;
/** Hem loops shorter than this many rivet spacings get no rivets (a tiny
 *  loop round a fingertip is not a plate edge). */
const RIVET_MIN_LOOP = 3;

/**
 * Studs round every hem loop: walk each loop by rest arc length, and at every
 * `spacing` step inward from the hem (up the edge-distance field) to the
 * vertex `inset` in, and seat a stud on the outer surface there.
 */
function placeRivets(o: NonNullable<ShellStyle['rivets']>, hemNbr: number[][], nbr: number[][], R: Vec3[], F: Float64Array, outer: Vec3[], Ns: Vec3[]): Rivet[] {
  const out: Rivet[] = [];
  const seen = new Uint8Array(hemNbr.length);
  for (let s = 0; s < hemNbr.length; s++) {
    if (seen[s] || hemNbr[s].length !== 2) continue;
    // Trace the loop.
    const loop = [s];
    seen[s] = 1;
    let prev = s, cur = hemNbr[s][0];
    while (cur !== s && !seen[cur] && hemNbr[cur].length === 2) {
      loop.push(cur); seen[cur] = 1;
      const next = hemNbr[cur][0] === prev ? hemNbr[cur][1] : hemNbr[cur][0];
      prev = cur; cur = next;
    }
    let total = 0;
    for (let i = 0; i < loop.length; i++) total += len(sub(R[loop[i]], R[loop[(i + 1) % loop.length]]));
    if (total < o.spacing * RIVET_MIN_LOOP) continue;
    // An even count round the loop, so the studs close up evenly.
    const n = Math.round(total / o.spacing), step = total / n;
    let walked = 0, nextAt = step / 2;
    for (let i = 0; i < loop.length && out.length < 10_000; i++) {
      const a = loop[i], seg = len(sub(R[a], R[loop[(i + 1) % loop.length]]));
      while (walked + seg >= nextAt) {
        // Climb the edge-distance field to the stud line.
        let v = a;
        for (let k = 0; k < 64 && F[v] < o.inset; k++) {
          let best = v;
          for (const j of nbr[v]) if (F[j] > F[best] && F[j] < Infinity) best = j;
          if (best === v) break;
          v = best;
        }
        if (Math.abs(F[v] - o.inset) < o.inset) out.push({ pos: outer[v], n: Ns[v], r: o.radius });
        nextAt += step;
      }
      walked += seg;
    }
  }
  return out;
}

/** Lift a patch off the posed surface and close it into a solid shell.
 *  `base` (per asset vertex, world units) is what's already worn there: the
 *  shell starts from it, so later items layer over earlier ones. Returns the
 *  shell plus each covered asset vertex's new outer offset. */
function buildShell(
  patch: Patch,
  ctx: { posed: Float32Array; normals: Float32Array; rest: Float32Array; f: Float32Array; base: Float32Array },
  style: ShellStyle,
): { mesh: ShellMesh; covered: Map<number, number>; rivets: Rivet[] } | null {
  if (patch.tris.length === 0) return null;
  const lerp = (arr: Float32Array, pv: PatchVert): Vec3 => {
    const { a, b, t } = pv;
    return [arr[a * 3] + (arr[b * 3] - arr[a * 3]) * t, arr[a * 3 + 1] + (arr[b * 3 + 1] - arr[a * 3 + 1]) * t, arr[a * 3 + 2] + (arr[b * 3 + 2] - arr[a * 3 + 2]) * t];
  };
  const unit = (n: Vec3): Vec3 => { const l = len(n) || 1; return [n[0] / l, n[1] / l, n[2] / l]; };
  // Per patch vertex: posed point, rest point, skin normal, what's worn under it.
  const P0 = patch.verts.map((pv) => lerp(ctx.posed, pv));
  const R = patch.verts.map((pv) => lerp(ctx.rest, pv));
  const N = patch.verts.map((pv) => unit(lerp(ctx.normals, pv)));
  const B = patch.verts.map((pv) => ctx.base[pv.a] + (ctx.base[pv.b] - ctx.base[pv.a]) * pv.t);
  const bw = style.bridge?.weight;
  const W = bw ? patch.verts.map((pv) => bw[pv.a] + (bw[pv.b] - bw[pv.a]) * pv.t) : null;
  let tris: number[] = Array.from(patch.tris);
  if (style.subdivide) {
    // Midpoint split: each edge gets one new vertex (appended after the
    // patch's own, so `covered` below still maps the originals).
    const mid = new Map<string, number>();
    const avg = (u: Vec3, v: Vec3): Vec3 => [(u[0] + v[0]) / 2, (u[1] + v[1]) / 2, (u[2] + v[2]) / 2];
    const at = (a: number, b: number) => {
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      let m = mid.get(key);
      if (m === undefined) {
        m = P0.length;
        P0.push(avg(P0[a], P0[b])); R.push(avg(R[a], R[b])); N.push(unit(avg(N[a], N[b]))); B.push((B[a] + B[b]) / 2);
        W?.push((W[a] + W[b]) / 2);
        mid.set(key, m);
      }
      return m;
    };
    const out: number[] = [];
    for (let k = 0; k < tris.length; k += 3) {
      const a = tris[k], b = tris[k + 1], c = tris[k + 2];
      const ab = at(a, b), bc = at(b, c), ca = at(c, a);
      out.push(a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca);
    }
    tris = out;
  }
  const nv = P0.length;
  // Boundary edges (used by one triangle) and each boundary vertex's two
  // neighbours along its hem.
  const edgeUse = new Map<string, number>();
  for (let k = 0; k < tris.length; k += 3) {
    for (let c = 0; c < 3; c++) {
      const a = tris[k + c], b = tris[k + (c + 1) % 3];
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      edgeUse.set(key, (edgeUse.get(key) ?? 0) + 1);
    }
  }
  const hemNbr: number[][] = Array.from({ length: nv }, () => []);
  for (const [key, n] of edgeUse) {
    if (n !== 1) continue;
    const [a, b] = key.split(',').map(Number);
    hemNbr[a].push(b); hemNbr[b].push(a);
  }
  const onHem = (i: number) => hemNbr[i].length === 2;
  // Fair a hem polyline: average each hem vertex with its two hem neighbours.
  // The cut follows a field that is linear per skin triangle, so its contour
  // zig-zags at triangle scale; a few passes turn it into a clean seam.
  // Tangential only (the normal component of each move is dropped), so the
  // seam stays on the skin instead of cutting chords through or off it.
  const fairHem = (pts: Vec3[], passes: number): Vec3[] => {
    for (let it = 0; it < passes; it++) {
      pts = pts.map((p, i) => {
        if (!onHem(i)) return p;
        const [a, b] = hemNbr[i];
        const d: Vec3 = [(pts[a][0] + pts[b][0]) * 0.25 - p[0] * 0.5, (pts[a][1] + pts[b][1]) * 0.25 - p[1] * 0.5, (pts[a][2] + pts[b][2]) * 0.25 - p[2] * 0.5];
        const dn = dot(d, N[i]);
        return [p[0] + d[0] - N[i][0] * dn, p[1] + d[1] - N[i][1] * dn, p[2] + d[2] - N[i][2] * dn] as Vec3;
      });
    }
    return pts;
  };

  const nbr: number[][] = Array.from({ length: nv }, () => []);
  for (let k = 0; k < tris.length; k += 3) {
    for (let c = 0; c < 3; c++) { const a = tris[k + c], b = tris[k + (c + 1) % 3]; nbr[a].push(b); nbr[b].push(a); }
  }
  // Smoothing spreads about one vertex spacing per √pass, so a subdivided
  // patch (half the spacing) needs four times the passes for the same reach.
  const reach = style.subdivide ? 4 : 1;
  const P = fairHem(P0, HEM_FAIRING_PASSES * reach);
  // Distance from the hem across the patch (rest units). Cuffs and rims are
  // banded by it: the cut field's own value would make them as uneven as its
  // gradient.
  const F = new Float64Array(nv).fill(Infinity);
  const queue: number[] = [];
  for (let i = 0; i < nv; i++) if (hemNbr[i].length) { F[i] = 0; queue.push(i); }
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q];
    for (const j of nbr[i]) {
      const d = F[i] + len(sub(R[i], R[j]));
      if (d < F[j] - 1e-9) { F[j] = d; queue.push(j); }
    }
  }

  let off = P.map((_, i) => B[i] + style.thickness + (style.extra ? style.extra(R[i], F[i], N[i]) : 0));

  // An offset along raw skin normals folds wherever it is deeper than the
  // skin's curvature (armpits, the neck, between the shoulder blades), and
  // copies every small bump. Offset instead from a smoothed copy of the skin
  // along smoothed normals; `smoothPasses` sets how stiff the item is.
  const passes = (style.smoothPasses ?? 0) * reach;
  const mean = (arr: Vec3[], ns: number[]): Vec3 => {
    const m: Vec3 = [0, 0, 0];
    for (const j of ns) { const v = arr[j]; m[0] += v[0]; m[1] += v[1]; m[2] += v[2]; }
    return [m[0] / ns.length, m[1] / ns.length, m[2] / ns.length];
  };
  // The surface the shell is offset from: the skin, except where it bridges
  // (see ShellStyle.bridge) — there, the skin projected onto the closed
  // surface along its gradient, with the gradient as its normal. The inner
  // face and the clearance checks stay on the real skin.
  let S = P, SN = N;
  if (W) {
    const { closed, step: e, lift, depth } = style.bridge!;
    const grad = (p: Vec3): Vec3 => unit([
      closed(p[0] + e, p[1], p[2]) - closed(p[0] - e, p[1], p[2]),
      closed(p[0], p[1] + e, p[2]) - closed(p[0], p[1] - e, p[2]),
      closed(p[0], p[1], p[2] + e) - closed(p[0], p[1], p[2] - e),
    ]);
    const sn: Vec3[] = N.slice();
    S = P.map((p, i) => {
      if (!W[i] || hemNbr[i].length) return p;
      // The lattice leaves the closed surface a little inside the skin on
      // open ground; measured from just outside it, the lift meets the skin
      // tangentially instead of at a kink.
      const c = closed(p[0], p[1], p[2]) - lift;
      if (!(c < 0)) return p;
      const g = grad(p), t = -c * W[i];
      // Deep in the crease the closed surface's normal takes over.
      const k = W[i] * smooth(0, depth, -c);
      const n = N[i];
      sn[i] = unit([n[0] + (g[0] - n[0]) * k, n[1] + (g[1] - n[1]) * k, n[2] + (g[2] - n[2]) * k]);
      return [p[0] + g[0] * t, p[1] + g[1] * t, p[2] + g[2] * t] as Vec3;
    });
    // Projection squeezes both walls of a crease onto one patch of the
    // closed surface, so neighbours can swap order there (a fold line).
    // Relax the lifted vertices toward their neighbours' mean, re-seated on
    // the closed surface each pass; vertices that weren't lifted anchor it.
    const lifted = S.map((q, i) => q !== P[i]);
    for (let it = 0; it < BRIDGE_RELAX_PASSES * reach; it++) {
      S = S.map((q, i) => {
        if (!lifted[i]) return q;
        const m = mean(S, nbr[i]);
        const c = closed(m[0], m[1], m[2]) - lift;
        const g = grad(m);
        // Never below the skin it covers.
        const r: Vec3 = [m[0] - g[0] * c, m[1] - g[1] * c, m[2] - g[2] * c];
        return dot(sub(r, P[i]), N[i]) > 0 ? r : q;
      });
    }
    SN = sn.map((n, i) => (lifted[i] ? unit([n[0] + grad(S[i])[0], n[1] + grad(S[i])[1], n[2] + grad(S[i])[2]]) : n));
  }
  let Ps = S, Ns = SN;
  // Taubin λ/μ passes (a plain Laplacian would shrink the convex torso and
  // the clearance clamp below would then pop every nipple back out), clamped
  // each pass so the surface never sinks more than (1 − MIN_CLEARANCE) of
  // its offset below the real skin: the smooth surface rides over bumps
  // instead of copying them.
  const step = (lambda: number) => {
    Ps = Ps.map((p, i) => {
      // Hem vertices stay on their (faired) seam.
      if (hemNbr[i].length || !nbr[i].length) return p;
      const m = mean(Ps, nbr[i]);
      // Move along the normal only: sliding sideways over the uneven
      // triangles a clip leaves behind would crumple the surface.
      let h = dot(sub(p, S[i]), SN[i]) + dot(sub(m, p), SN[i]) * lambda;
      h = Math.max(h, -off[i] * (1 - MIN_CLEARANCE));
      return [S[i][0] + SN[i][0] * h, S[i][1] + SN[i][1] * h, S[i][2] + SN[i][2] * h] as Vec3;
    });
  };
  for (let it = 0; it < passes; it++) { step(TAUBIN_LAMBDA); step(TAUBIN_MU); }
  for (let it = 0; it < NORMAL_SMOOTHING_BASE + passes * 2; it++) {
    Ns = Ns.map((n, i) => {
      if (!nbr[i].length) return n;
      const m = mean(Ns, nbr[i]);
      const v: Vec3 = [n[0] + m[0], n[1] + m[1], n[2] + m[2]];
      const l = len(v) || 1;
      return [v[0] / l, v[1] / l, v[2] / l];
    });
  }
  for (let it = 0; it < passes; it++) {
    off = off.map((o, i) => {
      const ns = hemNbr[i].length === 2 ? hemNbr[i] : nbr[i];
      if (!ns.length) return o;
      let m = 0;
      for (const j of ns) m += off[j];
      return o * 0.5 + (m / ns.length) * 0.5;
    });
  }
  // Bevel and relief go on after the smoothing, so they stay crisp.
  if (style.bevel || style.detail) {
    off = off.map((o, i) => {
      let x = o;
      if (style.bevel) x = B[i] + (x - B[i]) * (BEVEL_FLOOR + (1 - BEVEL_FLOOR) * smooth(0, style.bevel, F[i]));
      if (style.detail) x += style.detail(R[i], F[i]);
      return x;
    });
  }
  const outer = Ps.map((p, i) => {
    let q: Vec3 = [p[0] + Ns[i][0] * off[i], p[1] + Ns[i][1] * off[i], p[2] + Ns[i][2] * off[i]];
    // Never closer to the real skin than a fraction of the offset, so a bump
    // the smoothing flattened can't poke through.
    const h = dot(sub(q, P[i]), N[i]);
    const min = off[i] * MIN_CLEARANCE;
    if (h < min) q = [q[0] + N[i][0] * (min - h), q[1] + N[i][1] * (min - h), q[2] + N[i][2] * (min - h)];
    return q;
  });
  const inner = P.map((p, i) => { const d = B[i] - style.inset; return [p[0] + N[i][0] * d, p[1] + N[i][1] * d, p[2] + N[i][2] * d] as Vec3; });

  const positions = new Float32Array(nv * 6);
  outer.forEach((p, i) => positions.set(p, i * 3));
  inner.forEach((p, i) => positions.set(p, (nv + i) * 3));
  const shellTris: number[] = [];
  for (let k = 0; k < tris.length; k += 3) {
    const a = tris[k], b = tris[k + 1], c = tris[k + 2];
    shellTris.push(a, b, c);                 // outer, same winding as the skin
    shellTris.push(nv + a, nv + c, nv + b);  // inner, reversed
  }
  // Boundary edges get a side wall outer↔inner.
  for (let k = 0; k < tris.length; k += 3) {
    for (let c = 0; c < 3; c++) {
      const a = tris[k + c], b = tris[k + (c + 1) % 3];
      if (edgeUse.get(a < b ? `${a},${b}` : `${b},${a}`) !== 1) continue;
      shellTris.push(a, nv + a, nv + b, a, nv + b, b);
    }
  }
  // A source surface whose normals point inward (or a mirrored offset)
  // closes inside-out; flip it so the volume is positive.
  let vol = 0;
  for (let k = 0; k < shellTris.length; k += 3) {
    const a = shellTris[k] * 3, b = shellTris[k + 1] * 3, c = shellTris[k + 2] * 3;
    vol += positions[a] * (positions[b + 1] * positions[c + 2] - positions[b + 2] * positions[c + 1])
      - positions[a + 1] * (positions[b] * positions[c + 2] - positions[b + 2] * positions[c])
      + positions[a + 2] * (positions[b] * positions[c + 1] - positions[b + 1] * positions[c]);
  }
  if (vol < 0) for (let k = 0; k < shellTris.length; k += 3) { const t = shellTris[k + 1]; shellTris[k + 1] = shellTris[k + 2]; shellTris[k + 2] = t; }
  const covered = new Map<number, number>();
  patch.verts.forEach((pv, i) => { if (pv.t === 0) covered.set(pv.a, dot(sub(outer[i], P[i]), N[i])); });
  const rivets = style.rivets ? placeRivets(style.rivets, hemNbr, nbr, R, F, outer, Ns) : [];
  return { mesh: { positions, triVerts: new Uint32Array(shellTris) }, covered, rivets };
}

// --- Garment catalog -------------------------------------------------------------------

/** A limb cut that only applies on the limb: far from it the cut is a
 *  harmless +1 dm, blended by the vertex's limb membership. */
const limbCut = (cut: number, limb: number) => cut * limb + 1 * (1 - limb);

/** Region field weight → distance scale: a bone-group weight of 0.5 is the
 *  edge, and each 0.1 of weight past it counts as this many dm. */
const WEIGHT_TO_DM = 0.5;

export type Sleeve = 'none' | 'cap' | 'short' | 'elbow' | 'three-quarter' | 'long';
export type Neckline = 'crew' | 'scoop' | 'v' | 'turtle' | 'boat';
export type TopLength = 'crop' | 'waist' | 'hip' | 'tunic';
export type LegLength = 'briefs' | 'shorts' | 'knee' | 'capri' | 'full';

const SLEEVE_END: Record<Sleeve, number> = { none: -0.02, cap: 0.18, short: 0.45, elbow: 1.05, 'three-quarter': 1.5, long: 1.93 };
const LEG_END: Record<LegLength, number> = { briefs: 0.12, shorts: 0.5, knee: 1.05, capri: 1.55, full: 1.97 };

/** Everything a worn item needs: where (field), how (shell style), which surface. */
interface ItemSpec {
  label: string;
  surface: 'body' | 'skirt';
  field: (ctx: BodyContext, v: number) => number;
  style: ShellStyle;
}

export interface WearOptions {
  item: string;
  label?: string;
  color?: string;
  /** Thickness multiplier (1 = the item's natural thickness). */
  thickness?: number;
  /** Looseness, 0–1: lifts the cloth further off the skin. */
  fit?: number;
  sleeve?: Sleeve;
  neckline?: Neckline;
  length?: TopLength | LegLength | number;
  rise?: 'low' | 'mid' | 'high';
  /** Skirt / dress flare, 0–1. */
  flare?: number;
  /** Armor: studs along the plate edges (default true). */
  rivets?: boolean;
  /** Belt / band width as a fraction of the torso height. */
  width?: number;
}

/** Heights (rest dm) of the anatomical landmarks the cuts use. */
function landmarks(ctx: BodyContext) {
  const z = (b: string, e: 'head' | 'tail' = 'head') => ctx.joint(b, e)[2];
  return {
    crotch: z('upperleg01.L'),
    hip: z('spine05'),
    waist: z('spine03'),
    ribs: z('spine02'),
    chest: z('spine01'),
    neck: z('neck01'),
    neckY: ctx.joint('neck01')[1],
    knee: z('lowerleg01.L'),
  };
}

/** Distance (dm) above which a top's hem sits, below the neck, etc. */
function topField(ctx: BodyContext, o: WearOptions): (c: BodyContext, v: number) => number {
  const L = landmarks(ctx);
  const sleeveEnd = SLEEVE_END[o.sleeve ?? 'short'];
  const lengthZ = typeof o.length === 'number' ? L.crotch + o.length * (L.chest - L.crotch)
    : { crop: L.ribs, waist: (L.waist + L.hip) / 2, hip: L.crotch + 0.15, tunic: L.crotch - 0.9 }[(o.length as TopLength) ?? 'hip'] ?? L.crotch + 0.15;
  const neckline = o.neckline ?? 'crew';
  // Sleeveless: the armhole follows the arm's own weight boundary (a smooth
  // seam round the shoulder) rather than a cut along the arm.
  const sleeveless = (o.sleeve ?? 'short') === 'none';
  const wTorso = ctx.weight(sleeveless ? ['torso', 'hips', 'leg'] : ['torso', 'hips', 'arm', 'leg']);
  const wOff = ctx.weight(sleeveless ? ['neck', 'hand', 'arm'] : ['neck', 'hand']);
  const armLen = ctx.armLen();
  return (c, v) => {
    const p = c.pos(v);
    // Neckline: one smooth curve round the neck — a drop below the neck joint
    // that depends on the angle around the body's vertical axis (θ = 0 at the
    // front centre, π at the back).
    const theta = Math.abs(Math.atan2(p[0], L.neckY - p[1]));
    const frontness = Math.max(0, Math.cos(theta));
    const drop = neckline === 'turtle' ? -0.45
      : neckline === 'crew' ? 0.3 + 0.12 * frontness
        : neckline === 'boat' ? 0.15 + 0.1 * frontness
          : neckline === 'scoop' ? 0.3 + 0.75 * frontness ** 2
            : 0.3 + 1.3 * Math.max(0, 1 - theta / 0.55);           // v
    // Boat necks reach wide toward the shoulders: lift the cut there.
    const neckCut = (L.neck - drop) - p[2] + (neckline === 'boat' ? 0.35 * Math.sin(theta) ** 2 : 0);
    const hem = p[2] - lengthZ;
    const sleeve = sleeveless ? 1 : limbCut((sleeveEnd - c.armParam(p)) * armLen, c.armness(v));
    const region = (wTorso[v] - wOff[v] - 0.5) * WEIGHT_TO_DM;
    return Math.min(region, neckCut, hem, sleeve);
  };
}

function pantsField(ctx: BodyContext, o: WearOptions): (c: BodyContext, v: number) => number {
  const L = landmarks(ctx);
  const legEnd = typeof o.length === 'number' ? o.length : LEG_END[(o.length as LegLength) ?? 'full'] ?? LEG_END.full;
  const riseZ = { low: L.hip, mid: (L.hip + L.waist) / 2 + 0.1, high: L.waist + 0.25 }[o.rise ?? 'mid'];
  const w = ctx.weight(['hips', 'leg', 'torso']);
  const wOff = ctx.weight(['foot', 'arm', 'hand']);
  const legLen = ctx.legLen();
  return (c, v) => {
    const p = c.pos(v);
    const region = (w[v] - wOff[v] - 0.5) * WEIGHT_TO_DM;
    return Math.min(region, riseZ - p[2], limbCut((legEnd - c.legParam(p)) * legLen, c.legness(v)));
  };
}

function footField(top: number): (ctx: BodyContext) => (c: BodyContext, v: number) => number {
  return (ctx) => {
    const w = ctx.weight(['foot', 'leg']);
    const legLen = ctx.legLen();
    return (c, v) => Math.min((w[v] - 0.5) * WEIGHT_TO_DM, limbCut((c.legParam(c.pos(v)) - top) * legLen, c.legness(v)));
  };
}

function handField(cuff: number): (ctx: BodyContext) => (c: BodyContext, v: number) => number {
  return (ctx) => {
    const w = ctx.weight(['hand', 'arm']);
    const armLen = ctx.armLen();
    return (c, v) => Math.min((w[v] - 0.5) * WEIGHT_TO_DM, limbCut((c.armParam(c.pos(v)) - cuff) * armLen, c.armness(v)));
  };
}

function bandField(ctx: BodyContext, centreZ: number, halfWidth: number) {
  const w = ctx.weight(['torso', 'hips']);
  return (c: BodyContext, v: number) => Math.min((w[v] - 0.5) * WEIGHT_TO_DM, halfWidth - Math.abs(c.pos(v)[2] - centreZ));
}

/** Folds: shallow rings round the elbows / knees, deepening with fit. */
function foldExtra(ctx: BodyContext, unit: number, ease: number) {
  const elbowL = ctx.joint('lowerarm01.L'), elbowR = ctx.joint('lowerarm01.R');
  const kneeL = ctx.joint('lowerleg01.L'), kneeR = ctx.joint('lowerleg01.R');
  return (rest: Vec3) => {
    // Rings of folds around the elbows and knees, fading with distance from the joint.
    let fold = 0;
    const near = (j: Vec3, r: number) => Math.exp(-(len(sub(rest, j)) ** 2) / (r * r));
    const e = rest[0] >= 0 ? elbowL : elbowR, kn = rest[0] >= 0 ? kneeL : kneeR;
    const ne = near(e, 0.45), nk = near(kn, 0.6);
    if (ne > 0.05) fold += ne * Math.sin(ctx.armParam(rest) * 40);
    if (nk > 0.05) fold += nk * Math.sin(ctx.legParam(rest) * 34);
    return unit * (ease + 0.35 * fold * (0.4 + ease));
  };
}

/** Rolled cuff / hem: a band of extra thickness along the item's edge. */
const cuff = (unit: number, width: number, bump: number) => (f: number) => unit * bump * (1 - smooth(0, width, f));

/** Build the spec for a worn item, given the body context and the print unit
 *  (`u` = world units per dm, i.e. the human's print scale). */
function itemSpec(ctx: BodyContext, o: WearOptions, u: number): ItemSpec | ItemSpec[] {
  const k = o.thickness ?? 1;
  const ease = clamp(o.fit ?? 0.3, 0, 1);
  const cloth = (base: number) => ({ thickness: base * u * k, inset: 0.05 * u, smoothPasses: 6 });
  const label = o.label ?? o.item;
  const L = landmarks(ctx);
  const folds = foldExtra(ctx, 0.06 * u, ease);
  switch (o.item) {
    case 'shirt': case 'top': case 'tshirt': case 'sweater': case 'jacket': case 'coat': {
      const heavy = o.item === 'sweater' || o.item === 'jacket' || o.item === 'coat';
      const defaults: Partial<WearOptions> = o.item === 'tshirt' ? { sleeve: 'short', neckline: 'crew' }
        : o.item === 'sweater' ? { sleeve: 'long', neckline: 'crew' }
          : o.item === 'jacket' ? { sleeve: 'long', neckline: 'v', length: 'hip' }
            : o.item === 'coat' ? { sleeve: 'long', neckline: 'v', length: 'tunic' } : {};
      const spec = { ...defaults, ...o };
      const cuffs = cuff(u, 0.12, heavy ? 0.12 : 0.06);
      const top: ItemSpec = {
        label, surface: 'body', field: topField(ctx, o.item === 'coat' ? { ...spec, length: 'hip' } : spec),
        style: { ...cloth(heavy ? 0.16 : 0.1), extra: (r, f) => folds(r) + cuffs(f), bridge: ctx.bustBridge() },
      };
      if (o.item !== 'coat') return top;
      // A coat's skirts hang free from the waist (the skirt helper), to the
      // knee unless `length` says otherwise.
      const hemZ = typeof o.length === 'number' ? o.length : { tunic: L.crotch - 0.9, hip: L.crotch, knee: L.knee + 0.2, full: L.knee - 2.4 }[String(o.length ?? 'knee')] ?? L.knee + 0.2;
      return [top, {
        label, surface: 'skirt', field: (c, v) => c.pos(v)[2] - hemZ,
        style: { thickness: 0.08 * u * k, inset: 0.08 * u * k, extra: (_r, f) => cuff(u, 0.1, 0.06)(f) },
      }];
    }
    case 'pants': case 'shorts': case 'jeans': case 'leggings': case 'briefs': {
      const defaults: Partial<WearOptions> = o.item === 'shorts' ? { length: 'shorts' } : o.item === 'briefs' ? { length: 'briefs', rise: 'low' } : { length: 'full' };
      const spec = { ...defaults, ...o };
      const tight = o.item === 'leggings' || o.item === 'briefs';
      const cuffs = cuff(u, 0.1, 0.05);
      return {
        label, surface: 'body', field: pantsField(ctx, spec),
        style: { ...cloth(tight ? 0.06 : o.item === 'jeans' ? 0.12 : 0.1), extra: tight ? undefined : (r, f) => folds(r) + cuffs(f) },
      };
    }
    case 'socks':
      return { label, surface: 'body', field: footField(o.length === undefined ? 1.45 : Number(o.length))(ctx), style: cloth(0.05) };
    case 'gloves':
      return { label, surface: 'body', field: handField(1.85)(ctx), style: { ...cloth(0.05), extra: (_r, f) => cuff(u, 0.08, 0.05)(f) } };
    case 'belt': {
      const z = typeof o.length === 'number' ? o.length : (L.hip + L.waist) / 2 + 0.1;
      const half = (o.width ?? 0.06) * (L.neck - L.crotch) / 2;
      return { label, surface: 'body', field: bandField(ctx, z, half), style: { thickness: 0.24 * u * k, inset: 0.05 * u, smoothPasses: 3, extra: (_r, f) => u * 0.04 * smooth(0, 0.06, f) } };
    }
    case 'straps': {
      // Two bands over the shoulders, front and back (backpack straps,
      // suspenders, a harness), from the ribs up.
      const x0 = 0.62, half = (o.width ?? 0.035) * (L.neck - L.crotch);
      const wT = ctx.weight(['torso']);
      return {
        label, surface: 'body',
        field: (c, v) => { const p = c.pos(v); return Math.min((wT[v] - 0.5) * WEIGHT_TO_DM, half - Math.abs(Math.abs(p[0]) - x0), p[2] - L.ribs); },
        style: { thickness: 0.14 * u * k, inset: 0.05 * u, smoothPasses: 3 },
      };
    }
    case 'scarf': {
      const wN = ctx.weight(['neck', 'torso']);
      return {
        label, surface: 'body',
        field: (c, v) => { const z = c.pos(v)[2]; return Math.min((wN[v] - 0.5) * WEIGHT_TO_DM, z - (L.neck - 0.45), (L.neck + 0.55) - z); },
        style: { thickness: 0.3 * u * k, inset: 0.05 * u, smoothPasses: 8, extra: (r) => 0.08 * u * Math.sin(Math.atan2(r[0], r[1]) * 5 + r[2] * 8) },
      };
    }
    case 'skirt': case 'dress-skirt': {
      const lengthZ = typeof o.length === 'number' ? o.length : { mini: L.crotch - 0.9, knee: L.knee + 0.2, midi: L.knee - 1.4, maxi: L.knee - 3.2 }[String(o.length ?? 'knee')] ?? L.knee + 0.2;
      return {
        label, surface: 'skirt',
        field: (c, v) => c.pos(v)[2] - lengthZ,
        style: { thickness: 0.06 * u * k, inset: 0.06 * u * k, extra: (_r, f) => cuff(u, 0.1, 0.05)(f) },
      };
    }
    default:
      throw new Error(`unknown worn item "${o.item}"`);
  }
}

export const WEAR_ITEMS = ['shirt', 'top', 'tshirt', 'sweater', 'jacket', 'coat', 'pants', 'jeans', 'shorts', 'leggings', 'briefs', 'skirt', 'socks', 'shoes', 'sneakers', 'boots', 'gloves', 'belt', 'straps', 'scarf'] as const;

// --- Armor -------------------------------------------------------------------------------

export const ARMOR_ITEMS = ['breastplate', 'backplate', 'cuirass', 'pauldrons', 'vambraces', 'gauntlets', 'cuisses', 'greaves', 'sabatons', 'gorget', 'helmet', 'tassets'] as const;

/** The helmet's lower edge above the neck joint (rest decimetres). */
const HELMET_EDGE_DM = 0.25;
/** Hair under a helmet keeps this much off the scalp (rest decimetres), well
 *  inside the shell. */
const HELMET_HAIR_KEEP_DM = 0.1;

/** The helmet's lower edge (rest z) at angle `a` round the head (0 = straight
 *  ahead, π = the back): at the brow over the ears, at a nape guard behind. */
function helmetEdge(a: number, eyeZ: number, neckZ: number): number {
  return eyeZ + 0.3 + (neckZ + HELMET_EDGE_DM - eyeZ - 0.3) * smooth(1.85, 2.45, a);
}

/** Where a helmet presses the hair flat, in the hair's head-local frame. */
export function helmetHairCover(mesh: HumanMesh, o: WearOptions): HairCover {
  const k = mesh.scale;
  const J = (n: string) => mesh.restJoints.get(`${n}____head`)!;
  const head = J('head'), neckZ = J('neck01')[2], eyeZ = J('eye.L')[2];
  return {
    edge: (x, y) => (helmetEdge(Math.abs(Math.atan2(x, -y)), eyeZ, neckZ) - head[2]) * k,
    keep: HELMET_HAIR_KEEP_DM * k * (o.thickness ?? 1),
  };
}

/** Plate relief, all in rest decimetres. A bevel tapers the last
 *  PLATE_BEVEL_DM of every plate; a rolled bead runs just inside it. */
const PLATE_BEVEL_DM = 0.05;
const RIM_AT_DM = 0.085;
const RIM_HALF_DM = 0.055;
/** Rivets: spacing round the hem, distance in from it, radius. */
const RIVET_SPACING_DM = 0.32;
const RIVET_INSET_DM = 0.2;
const RIVET_RADIUS_DM = 0.045;
/** Ridges (shin, thigh, forearm, helmet crest): half-width and height. */
const RIDGE_HALF_DM = 0.1;
const RIDGE_HEIGHT_DM = 0.08;
/** Lames (overlapping bands on pauldrons, gorget, tassets): band width and step. */
const LAME_DM = 0.3;
const LAME_STEP_DM = 0.06;

/** 1 at t = 0 falling smoothly to 0 at |t| = 1. */
const bump = (t: number) => (Math.abs(t) >= 1 ? 0 : (1 - t * t) ** 2);
/** Overlapping bands across a coordinate: each band rises toward its far
 *  edge and drops at the next — a lame overlapping the one below it. */
const lames = (x: number) => { const f = x / LAME_DM - Math.floor(x / LAME_DM); return smooth(0, 0.85, f) - smooth(0.85, 1, f); };

function armorSpec(ctx: BodyContext, o: WearOptions, u: number): ItemSpec {
  const k = o.thickness ?? 1;
  const label = o.label ?? o.item;
  const L = landmarks(ctx);
  const studs = o.rivets === false ? undefined : { spacing: RIVET_SPACING_DM, inset: RIVET_INSET_DM, radius: RIVET_RADIUS_DM * u * Math.sqrt(k) };
  // Plate: thick, smoothed so the muscles vanish, with a bevelled edge, a
  // rolled bead just inside it, rivets along it, and any piece's own relief.
  const plate = (base: number, rim = 0.12, passes = 24, relief?: (r: Vec3, f: number) => number, rivets: typeof studs | null = studs): ShellStyle => ({
    thickness: base * u * k, inset: 0.06 * u, smoothPasses: passes, subdivide: true, bevel: PLATE_BEVEL_DM,
    detail: (r, f) => u * (rim * 0.6 * bump((f - RIM_AT_DM) / RIM_HALF_DM) + (relief ? relief(r, f) * smooth(RIM_AT_DM, RIM_AT_DM + 2 * RIM_HALF_DM, f) : 0)),
    rivets: rivets ?? undefined,
  });
  // A ridge down a limb segment a→b on the side facing `dir` (rest frame).
  const limbRidge = (a: Vec3, b: Vec3, dir: Vec3) => {
    const ax = sub(b, a), al = len(ax) || 1;
    const t: Vec3 = [ax[0] / al, ax[1] / al, ax[2] / al];
    const fd = sub(dir, [t[0] * dot(dir, t), t[1] * dot(dir, t), t[2] * dot(dir, t)]);
    const fl = len(fd) || 1;
    const front: Vec3 = [fd[0] / fl, fd[1] / fl, fd[2] / fl];
    const side: Vec3 = [t[1] * front[2] - t[2] * front[1], t[2] * front[0] - t[0] * front[2], t[0] * front[1] - t[1] * front[0]];
    return (p: Vec3) => {
      const w = sub(p, a);
      return dot(w, front) > 0 ? RIDGE_HEIGHT_DM * bump(dot(w, side) / RIDGE_HALF_DM) : 0;
    };
  };
  const sideOf = (p: Vec3) => (p[0] >= 0 ? 'L' : 'R');
  const armLen = ctx.armLen(), legLen = ctx.legLen();
  const w = (g: Group[]) => ctx.weight(g);
  switch (o.item) {
    case 'breastplate': case 'backplate': case 'cuirass': {
      const top = topField(ctx, { item: 'cuirass', sleeve: 'none', neckline: 'crew', length: 'waist' });
      const ny = L.neckY;
      const half = o.item === 'breastplate' ? 1 : o.item === 'backplate' ? -1 : 0;
      return {
        label, surface: 'body',
        // A front (or back) half: cut where the surface crosses the body's
        // coronal plane, through the neck joint.
        field: (c, v) => {
          const base = Math.min(top(c, v), (c.pos(v)[2] - L.waist + 0.15));
          if (!half) return base;
          return Math.min(base, half * (ny + 0.2 - c.pos(v)[1]));
        },
        style: {
          ...plate(0.24),
          // A keel down the centre front.
          extra: (r) => u * 0.1 * smooth(0.25, 0, Math.abs(r[0])) * smooth(ny + 0.2, ny - 0.6, r[1]),
          bridge: ctx.bustBridge(),
        },
      };
    }
    case 'pauldrons': {
      const wa = w(['torso', 'arm']);
      return {
        label, surface: 'body',
        field: (c, v) => {
          const p = c.pos(v);
          const s = p[0] >= 0 ? 'L' : 'R';
          const j = c.joint(`upperarm01.${s}`);
          const r = len(sub(p, j));
          return Math.min((wa[v] - 0.5) * WEIGHT_TO_DM, 1.25 - r, p[2] - (j[2] - 0.65), Math.abs(p[0]) - 0.75);
        },
        // Lames stepping down the arm from the shoulder cap.
        style: plate(0.3, 0.16, 18, (p) => {
          const j = ctx.joint(`upperarm01.${sideOf(p)}`);
          return LAME_STEP_DM * lames(Math.max(0, j[2] + 0.1 - p[2]));
        }),
      };
    }
    case 'vambraces':
      return {
        label, surface: 'body',
        field: (c, v) => { const t = c.armParam(c.pos(v)); return Math.min((w(['arm', 'hand'])[v] - 0.5) * WEIGHT_TO_DM, (t - 1.18) * armLen, (1.86 - t) * armLen); },
        // A ridge down the outside of the forearm.
        style: plate(0.2, 0.12, 24, (p) => {
          const s = sideOf(p);
          return limbRidge(ctx.joint(`lowerarm01.${s}`), ctx.joint(`wrist.${s}`), [s === 'L' ? 1 : -1, 0, 0])(p);
        }),
      };
    case 'gauntlets':
      return { label, surface: 'body', field: handField(1.8)(ctx), style: { ...plate(0.1, 0.05, 2, undefined, null), subdivide: false } };
    case 'cuisses':
      return {
        label, surface: 'body',
        field: (c, v) => { const t = c.legParam(c.pos(v)); return Math.min((w(['leg'])[v] - 0.5) * WEIGHT_TO_DM, (t - 0.12) * legLen, (0.92 - t) * legLen); },
        // A ridge down the front of the thigh.
        style: plate(0.2, 0.12, 24, (p) => { const s = sideOf(p); return limbRidge(ctx.joint(`upperleg01.${s}`), ctx.joint(`lowerleg01.${s}`), [0, -1, 0])(p); }),
      };
    case 'greaves':
      return {
        label, surface: 'body',
        field: (c, v) => { const t = c.legParam(c.pos(v)); return Math.min((w(['leg', 'foot'])[v] - 0.5) * WEIGHT_TO_DM, (t - 1.1) * legLen, (1.86 - t) * legLen); },
        // A ridge down the shin.
        style: plate(0.2, 0.12, 24, (p) => { const s = sideOf(p); return limbRidge(ctx.joint(`lowerleg01.${s}`), ctx.joint(`foot.${s}`), [0, -1, 0])(p); }),
      };
    case 'gorget':
      return {
        label, surface: 'body',
        field: (c, v) => { const z = c.pos(v)[2]; return Math.min((w(['neck', 'torso'])[v] - 0.5) * WEIGHT_TO_DM, z - (L.neck - 0.55), (L.neck + 0.45) - z); },
        // Lames stepping down from the throat.
        style: plate(0.2, 0.12, 10, (p) => LAME_STEP_DM * lames(Math.max(0, L.neck + 0.45 - p[2]))),
      };
    case 'tassets':
      return {
        label, surface: 'skirt', field: (c, v) => c.pos(v)[2] - (L.crotch - 0.9),
        style: {
          thickness: 0.1 * u * k, inset: 0.1 * u * k, smoothPasses: 6, subdivide: true, bevel: PLATE_BEVEL_DM,
          // Lames hanging from the belt line.
          detail: (r, f) => u * (0.06 * bump((f - RIM_AT_DM) / RIM_HALF_DM) + LAME_STEP_DM * lames(Math.max(0, L.hip - r[2])) * smooth(RIM_AT_DM, RIM_AT_DM + 2 * RIM_HALF_DM, f)),
        },
      };
    case 'helmet': {
      const eyeZ = ctx.joint('eye.L')[2];
      const headY = ctx.joint('head')[1];
      const wBody = ctx.weight(['neck', 'torso', 'arm', 'hand', 'hips', 'leg', 'foot']);
      return {
        label, surface: 'body',
        field: (c, v) => {
          const p = c.pos(v);
          const front = p[1] < headY - 0.55;
          // Open face: below the brow at the front stays bare.
          const face = front && Math.abs(p[0]) < 0.75 ? p[2] - (eyeZ + 0.3) : 1;
          // The edge rides over the ears at the sides (a shell over an ear
          // copies its shape) and drops to a nape guard at the back.
          const edge = helmetEdge(Math.abs(Math.atan2(p[0], headY - p[1])), eyeZ, L.neck);
          return Math.min(p[2] - edge, face, (0.5 - wBody[v]) * WEIGHT_TO_DM);
        },
        // A crest from the brow over the crown to the nape.
        style: plate(0.34, 0.14, 24, (p) => RIDGE_HEIGHT_DM * 1.2 * bump(p[0] / RIDGE_HALF_DM) * smooth(eyeZ + 0.3, eyeZ + 0.8, p[2])),
      };
    }
    default:
      throw new Error(`unknown armor piece "${o.item}"`);
  }
}

// --- Entry point -----------------------------------------------------------------------

/** A worn item: a closed shell mesh, or (footwear) signed-distance fields for the caller to mesh. */
export interface WornShell { label: string; color?: string; mesh?: ShellMesh; fields?: FootwearField[]; rivets?: Rivet[] }

/** Build every worn item (clothing + armor) as a closed shell around the posed body. */
export function buildWear(asset: HumanAsset, mesh: HumanMesh, items: WearOptions[], height: number): WornShell[] {
  const ctx = new BodyContext(asset, mesh);
  const u = mesh.scale;
  const out: WornShell[] = [];
  const bodyTris: number[] = [], skirtTris: number[] = [];
  for (let t = 0; t < asset.nT; t++) {
    const l = asset.triLabel[t];
    if (l === 0) bodyTris.push(asset.triVerts[t * 3], asset.triVerts[t * 3 + 1], asset.triVerts[t * 3 + 2]);
    else if (l === 2) skirtTris.push(asset.triVerts[t * 3], asset.triVerts[t * 3 + 1], asset.triVerts[t * 3 + 2]);
  }
  const normals = {
    body: vertexNormals(mesh.posed, bodyTris, asset.nV),
    skirt: vertexNormals(mesh.posed, skirtTris, asset.nV),
  };
  // Layering: how far out (world units) the outermost worn layer sits over
  // each body vertex. Items stack in list order.
  const cover = new Float32Array(asset.nV);
  const zero = new Float32Array(asset.nV);
  // Each skirt-helper vertex's nearest body vertex (rest pose), to push the
  // skirt out past whatever is worn beneath it.
  const skirtVerts = [...new Set(skirtTris)];
  const bodyVerts = [...new Set(bodyTris)];
  const nearestBody = new Map<number, number>();
  for (const sv of skirtVerts) {
    let best = -1, bestD = Infinity;
    for (const bv of bodyVerts) {
      const d = (mesh.rest[sv * 3] - mesh.rest[bv * 3]) ** 2 + (mesh.rest[sv * 3 + 1] - mesh.rest[bv * 3 + 1]) ** 2 + (mesh.rest[sv * 3 + 2] - mesh.rest[bv * 3 + 2]) ** 2;
      if (d < bestD) { bestD = d; best = bv; }
    }
    nearestBody.set(sv, best);
  }
  // Flare: swing the skirt surface out from the hips, more the further it
  // falls below them (an A-line at 0.3, a bell at 1).
  const hipC = mesh.joints.get('spine05____head')!;
  const hipZ = ctx.joint('spine05')[2];
  const skirtSurface = (gap: number, flare: number): Float32Array => {
    const pos = new Float32Array(mesh.posed);
    if (flare > 0) {
      for (const sv of skirtVerts) {
        const drop = Math.max(0, hipZ - mesh.rest[sv * 3 + 2]);
        const dx = pos[sv * 3] - hipC[0], dy = pos[sv * 3 + 1] - hipC[1];
        const r = Math.hypot(dx, dy) || 1;
        const push = flare * SKIRT_FLARE * drop * u;
        pos[sv * 3] += (dx / r) * push; pos[sv * 3 + 1] += (dy / r) * push;
      }
    }
    for (const [sv, bv] of nearestBody) {
      const n: Vec3 = [normals.body[bv * 3], normals.body[bv * 3 + 1], normals.body[bv * 3 + 2]];
      const d = dot([mesh.posed[sv * 3] - mesh.posed[bv * 3], mesh.posed[sv * 3 + 1] - mesh.posed[bv * 3 + 1], mesh.posed[sv * 3 + 2] - mesh.posed[bv * 3 + 2]], n);
      const need = cover[bv] + gap;
      if (d >= need) continue;
      const sn: Vec3 = [normals.skirt[sv * 3], normals.skirt[sv * 3 + 1], normals.skirt[sv * 3 + 2]];
      // Push along whichever side of the skirt faces away from the body.
      const sign = dot(sn, n) >= 0 ? 1 : -1;
      for (let c = 0; c < 3; c++) pos[sv * 3 + c] += sn[c] * sign * (need - d);
    }
    return pos;
  };
  for (const o of items) {
    if ((FOOTWEAR_ITEMS as readonly string[]).includes(o.item)) {
      // Clear whatever is already on the feet (socks).
      let under = 0;
      const ankleZ = ctx.joint('foot.L')[2] + FEET_ZONE;
      for (let v = 0; v < asset.nV; v++) if (mesh.rest[v * 3 + 2] < ankleZ) under = Math.max(under, cover[v]);
      const fields = buildFootwear(asset, mesh, o.item as typeof FOOTWEAR_ITEMS[number], height, o.thickness ?? 1, under);
      out.push({ label: o.label ?? o.item, color: o.color, fields });
      // Later layers (greaves over boots) sit outside the footwear.
      for (const fw of fields) {
        const at = makeTrilinearSampler(fw.field, fw.spec);
        for (let v = 0; v < asset.nV; v++) {
          const d = at(mesh.posed[v * 3], mesh.posed[v * 3 + 1], mesh.posed[v * 3 + 2]);
          if (d < 0) cover[v] = Math.max(cover[v], -d);
        }
      }
      continue;
    }
    const made = (ARMOR_ITEMS as readonly string[]).includes(o.item) ? armorSpec(ctx, o, u) : itemSpec(ctx, o, u);
    for (const spec of Array.isArray(made) ? made : [made]) {
    const f = new Float32Array(asset.nV);
    for (let v = 0; v < asset.nV; v++) {
      const x = spec.field(ctx, v);
      // Nudge exact zeros so the clip never produces a degenerate cut point.
      f[v] = Math.abs(x) < 1e-6 ? -1e-6 : x;
    }
    const patch = clipPatch(spec.surface === 'body' ? bodyTris : skirtTris, f);
    const body = spec.surface === 'body';
    const surface = body ? mesh.posed : skirtSurface(spec.style.inset + 0.05 * u, o.flare ?? 0);
    const shell = buildShell(patch, {
      posed: surface, normals: normals[spec.surface],
      rest: mesh.rest, f, base: body ? cover : zero,
    }, spec.style);
    if (!shell) continue;
    out.push({ label: spec.label, color: o.color, mesh: shell.mesh, ...(shell.rivets.length ? { rivets: shell.rivets } : {}) });
    if (body) for (const [v, offset] of shell.covered) cover[v] = Math.max(cover[v], offset);
    else {
      // A skirt (or coat tails) covers the body beneath it too: a belt or
      // tassets worn after it go outside it.
      for (const [sv, offset] of shell.covered) {
        const bv = nearestBody.get(sv);
        if (bv === undefined) continue;
        const n: Vec3 = [normals.body[bv * 3], normals.body[bv * 3 + 1], normals.body[bv * 3 + 2]];
        const d = dot([surface[sv * 3] - mesh.posed[bv * 3], surface[sv * 3 + 1] - mesh.posed[bv * 3 + 1], surface[sv * 3 + 2] - mesh.posed[bv * 3 + 2]], n) + offset;
        if (d > 0) cover[bv] = Math.max(cover[bv], d);
      }
    }
    }
  }
  return out;
}
