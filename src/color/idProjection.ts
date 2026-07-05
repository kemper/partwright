/**
 * Pure kernel for triangle-ID-buffer image projection (#885).
 *
 * The projection pipeline renders the scope mesh with every triangle in a
 * unique flat ID color (no lighting, no antialiasing), so each pixel of the
 * ID buffer names exactly one visible triangle — the GPU z-buffer resolves
 * occlusion exactly, which the older centroid-sampling approach could only
 * approximate with a facing-angle test. Every ID pixel then samples the
 * AI-repainted image at the aligned position and votes its palette-snapped
 * color for its triangle; per-triangle plurality kills the single-sample
 * speckle the centroid approach suffered.
 *
 * Everything here is dependency-free math over MeshData so it unit-tests
 * without a browser; the WebGL render itself lives in
 * `src/renderer/multiview.ts` (`renderTriangleIdPixels`) and the orchestration
 * in `paintByImageProjection` (main.ts).
 */

import type { MeshData } from '../geometry/types';

/** Encode a LOCAL triangle index as a flat 24-bit RGB color (0..255 each).
 *  Index is stored as `index + 1` so pure black stays reserved for the
 *  background clear color. */
export function encodeTriangleIdColor(index: number): [number, number, number] {
  const id = index + 1;
  return [(id >> 16) & 0xff, (id >> 8) & 0xff, id & 0xff];
}

/** Decode an ID-buffer pixel back to its LOCAL triangle index, or -1 for
 *  background / out-of-range values. */
export function decodeTriangleIdPixel(r: number, g: number, b: number, triangleCount: number): number {
  const id = (r << 16) | (g << 8) | b;
  if (id === 0) return -1;
  const index = id - 1;
  return index < triangleCount ? index : -1;
}

interface Hsv { h: number; s: number; v: number }

function toHsv(r: number, g: number, b: number): Hsv {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  const d = mx - mn;
  let h = 0;
  if (d > 0) {
    if (mx === r) h = ((g - b) / d) % 6;
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: mx > 0 ? d / mx : 0, v: mx };
}

/** Build a palette snapper in a shading-tolerant space: neutrals (low
 *  saturation) match by lightness, saturated colors match by hue with
 *  saturation/value as tie-breakers — so an image model's shading gradients
 *  can't flip a shaded red into black. Inputs and palette are 0..1 RGB;
 *  returns the palette index. */
export function buildPaletteSnapper(palette: readonly (readonly [number, number, number])[]): (r: number, g: number, b: number) => number {
  const paletteHsv = palette.map(c => toHsv(c[0], c[1], c[2]));
  return (r: number, g: number, b: number): number => {
    const p = toHsv(r, g, b);
    let best = 0, bestScore = Infinity;
    for (let i = 0; i < paletteHsv.length; i++) {
      const q = paletteHsv[i];
      let score: number;
      if (p.s < 0.18 || q.s < 0.18) {
        // Neutral comparison: lightness dominates; penalize matching a
        // saturated palette entry to a gray sample and vice versa.
        score = Math.abs(p.v - q.v) * 2 + Math.abs(p.s - q.s) * 1.5;
      } else {
        let dh = Math.abs(p.h - q.h);
        if (dh > 180) dh = 360 - dh;
        score = dh / 90 + Math.abs(p.s - q.s) * 0.5 + Math.abs(p.v - q.v) * 0.5;
      }
      if (score < bestScore) { bestScore = score; best = i; }
    }
    return best;
  };
}

/** Sample verdict for one ID-buffer pixel: a palette index (>= 0), or
 *  BACKGROUND_VOTE when the image is near-white there, or OFF_IMAGE when the
 *  aligned position falls outside the image. */
export const BACKGROUND_VOTE = -1;
export const OFF_IMAGE = -2;

/** Per-triangle winner codes (palette index when >= 0). */
export const WINNER_UNPAINTED = -1; // background plurality — the image left it white
export const WINNER_NO_PIXELS = -2; // never visible in the ID buffer (occluded or subpixel)

export interface VoteTally {
  /** Per LOCAL triangle: winning palette index, WINNER_UNPAINTED, or WINNER_NO_PIXELS. */
  winner: Int32Array;
  /** Total pixels observed per triangle (palette + background votes). */
  pixelCounts: Uint32Array;
  /** Diagnostics. */
  sampledPixels: number;
  backgroundPixels: number;
  offImagePixels: number;
}

/** Tally palette votes for every triangle from an ID buffer. `sample(x, y)`
 *  receives ID-buffer pixel-center coordinates and returns a palette index,
 *  BACKGROUND_VOTE, or OFF_IMAGE (the caller owns image alignment + snapping).
 *  A triangle's winner is the plurality palette color, unless background
 *  votes outnumber ALL palette votes combined — near-silhouette pixels
 *  sampling the white background must not paint the rim. */
export function tallyProjectionVotes(opts: {
  idData: Uint8Array | Uint8ClampedArray;
  idWidth: number;
  idHeight: number;
  triangleCount: number;
  paletteCount: number;
  sample: (x: number, y: number) => number;
}): VoteTally {
  const { idData, idWidth, idHeight, triangleCount, paletteCount, sample } = opts;
  const votes = new Uint32Array(triangleCount * paletteCount);
  const backgroundVotes = new Uint32Array(triangleCount);
  const pixelCounts = new Uint32Array(triangleCount);
  let sampledPixels = 0, backgroundPixels = 0, offImagePixels = 0;

  for (let y = 0; y < idHeight; y++) {
    for (let x = 0; x < idWidth; x++) {
      const i = (y * idWidth + x) * 4;
      const tri = decodeTriangleIdPixel(idData[i], idData[i + 1], idData[i + 2], triangleCount);
      if (tri < 0) continue;
      const verdict = sample(x + 0.5, y + 0.5);
      if (verdict === OFF_IMAGE) { offImagePixels++; continue; }
      pixelCounts[tri]++;
      if (verdict === BACKGROUND_VOTE) {
        backgroundVotes[tri]++;
        backgroundPixels++;
      } else {
        votes[tri * paletteCount + verdict]++;
        sampledPixels++;
      }
    }
  }

  const winner = new Int32Array(triangleCount);
  for (let t = 0; t < triangleCount; t++) {
    if (pixelCounts[t] === 0) { winner[t] = WINNER_NO_PIXELS; continue; }
    let best = -1, bestVotes = 0, paletteTotal = 0;
    for (let p = 0; p < paletteCount; p++) {
      const v = votes[t * paletteCount + p];
      paletteTotal += v;
      if (v > bestVotes) { bestVotes = v; best = p; }
    }
    winner[t] = (paletteTotal === 0 || backgroundVotes[t] > paletteTotal) ? WINNER_UNPAINTED : best;
  }

  return { winner, pixelCounts, sampledPixels, backgroundPixels, offImagePixels };
}

/** Edge adjacency restricted to a scope, in LOCAL indices: flat array where
 *  slots [t*3 .. t*3+2] hold the local indices of the up-to-3 triangles
 *  sharing an edge with local triangle t (-1 for open/boundary slots).
 *  Edges are keyed by vertex-index pairs — meshes here come through
 *  manifold-3d, which welds shared vertices, so index pairs identify edges. */
export function buildScopeEdgeAdjacency(mesh: MeshData, ordered: readonly number[]): Int32Array {
  const { triVerts } = mesh;
  const n = ordered.length;
  const adjacency = new Int32Array(n * 3).fill(-1);
  const slotCount = new Uint8Array(n);
  // Edge key -> local triangle that registered it first.
  const edgeOwner = new Map<number, number>();
  const numVert = mesh.numVert;

  const link = (a: number, b: number) => {
    if (slotCount[a] < 3) adjacency[a * 3 + slotCount[a]++] = b;
    if (slotCount[b] < 3) adjacency[b * 3 + slotCount[b]++] = a;
  };

  for (let local = 0; local < n; local++) {
    const t = ordered[local];
    for (let e = 0; e < 3; e++) {
      const v0 = triVerts[t * 3 + e];
      const v1 = triVerts[t * 3 + ((e + 1) % 3)];
      const key = v0 < v1 ? v0 * numVert + v1 : v1 * numVert + v0;
      const owner = edgeOwner.get(key);
      if (owner === undefined) {
        edgeOwner.set(key, local);
      } else {
        link(owner, local);
        edgeOwner.delete(key); // manifold: an edge joins exactly 2 triangles
      }
    }
  }
  return adjacency;
}

/** Per-LOCAL-triangle dot(face normal, camera direction) — the facing score
 *  used to gate the gap fill and as the multi-view compositing confidence. */
export function triangleFacing(mesh: MeshData, ordered: readonly number[], camDir: readonly [number, number, number]): Float32Array {
  const { triVerts, vertProperties, numProp } = mesh;
  const facing = new Float32Array(ordered.length);
  for (let local = 0; local < ordered.length; local++) {
    const t = ordered[local];
    const v0 = triVerts[t * 3], v1 = triVerts[t * 3 + 1], v2 = triVerts[t * 3 + 2];
    const ax = vertProperties[v0 * numProp], ay = vertProperties[v0 * numProp + 1], az = vertProperties[v0 * numProp + 2];
    const e1x = vertProperties[v1 * numProp] - ax, e1y = vertProperties[v1 * numProp + 1] - ay, e1z = vertProperties[v1 * numProp + 2] - az;
    const e2x = vertProperties[v2 * numProp] - ax, e2y = vertProperties[v2 * numProp + 1] - ay, e2z = vertProperties[v2 * numProp + 2] - az;
    const nx = e1y * e2z - e1z * e2y;
    const ny = e1z * e2x - e1x * e2z;
    const nz = e1x * e2y - e1y * e2x;
    const nl = Math.hypot(nx, ny, nz) || 1;
    facing[local] = (nx * camDir[0] + ny * camDir[1] + nz * camDir[2]) / nl;
  }
  return facing;
}

/** Close the last coverage gap geometrically: multi-source BFS from every
 *  painted triangle over the scope's edge adjacency, assigning each
 *  unpainted triangle the color of its NEAREST painted neighbor (in hops).
 *  This is the deterministic finisher for the multi-view projection loop —
 *  the triangles no ortho view sees well are deep occlusions (crevices,
 *  hole interiors), and inheriting the surrounding color is visually
 *  correct by construction for geometry that can't be seen from outside.
 *  Mutates `colorIndex` (-1 = unpainted) in place; returns filled locals.
 *  Unreachable triangles (no painted triangle in their adjacency component)
 *  stay -1. */
export function fillFromNearestPainted(opts: {
  colorIndex: Int32Array;
  adjacency: Int32Array;
}): number[] {
  const { colorIndex, adjacency } = opts;
  const n = colorIndex.length;
  const queue: number[] = [];
  for (let t = 0; t < n; t++) {
    if (colorIndex[t] >= 0) queue.push(t);
  }
  const filled: number[] = [];
  for (let head = 0; head < queue.length; head++) {
    const t = queue[head];
    const color = colorIndex[t];
    for (let e = 0; e < 3; e++) {
      const nb = adjacency[t * 3 + e];
      if (nb < 0 || colorIndex[nb] >= 0) continue;
      colorIndex[nb] = color;
      filled.push(nb);
      queue.push(nb);
    }
  }
  return filled;
}

/** Absorb tiny DISCONNECTED color fragments into their dominant surrounding
 *  color. Image back-projection leaves assignment noise — scattered islets a
 *  few triangles wide where the source image had outlines, dither, or
 *  compression artifacts. A connected same-color component smaller than
 *  `minTriangles` is reassigned to whichever neighboring color shares the
 *  most boundary edges with it. Only components strictly smaller than the
 *  threshold move, and only whole components move — connected thin features
 *  (outline rings, seam lines) are safe because they connect to their large
 *  parent component. Unpainted (-1) triangles neither move nor absorb.
 *  Mutates `colorIndex`; returns the changed local indices. */
export function despeckleColors(opts: {
  colorIndex: Int32Array;
  adjacency: Int32Array;
  minTriangles: number;
  maxRounds?: number;
}): number[] {
  const { colorIndex, adjacency, minTriangles } = opts;
  const maxRounds = opts.maxRounds ?? 8;
  const n = colorIndex.length;
  const changedAll: number[] = [];

  for (let round = 0; round < maxRounds; round++) {
    const componentOf = new Int32Array(n).fill(-1);
    const members: number[][] = [];
    for (let seed = 0; seed < n; seed++) {
      if (componentOf[seed] >= 0 || colorIndex[seed] < 0) continue;
      const id = members.length;
      const queue = [seed];
      componentOf[seed] = id;
      const list: number[] = [];
      for (let head = 0; head < queue.length; head++) {
        const t = queue[head];
        list.push(t);
        for (let e = 0; e < 3; e++) {
          const nb = adjacency[t * 3 + e];
          if (nb < 0 || componentOf[nb] >= 0 || colorIndex[nb] !== colorIndex[seed]) continue;
          componentOf[nb] = id;
          queue.push(nb);
        }
      }
      members.push(list);
    }

    const pending: Array<[number[], number]> = [];
    for (const list of members) {
      if (list.length >= minTriangles) continue;
      // Vote by boundary edge count into each neighboring painted COMPONENT,
      // considering only components strictly larger than this fragment —
      // small fragments absorbing each other would churn (and can oscillate);
      // absorbing only upward guarantees termination.
      const votes = new Map<number, number>();
      for (const t of list) {
        for (let e = 0; e < 3; e++) {
          const nb = adjacency[t * 3 + e];
          if (nb < 0) continue;
          const comp = componentOf[nb];
          if (comp < 0 || comp === componentOf[t]) continue;
          if (members[comp].length <= list.length) continue;
          votes.set(comp, (votes.get(comp) ?? 0) + 1);
        }
      }
      let best = -1, bestVotes = 0;
      for (const [comp, v] of votes) {
        if (v > bestVotes) { bestVotes = v; best = comp; }
      }
      if (best >= 0) pending.push([list, colorIndex[members[best][0]]]);
    }
    if (pending.length === 0) break;
    for (const [list, color] of pending) {
      for (const t of list) {
        colorIndex[t] = color;
        changedAll.push(t);
      }
    }
  }
  return changedAll;
}

/** Per-mesh multi-view compositing state: for every GLOBAL triangle, the
 *  facing confidence of the projection that last painted it (0 = never
 *  projection-painted). Keyed by MeshData identity, so re-running the model
 *  code naturally resets the composite. */
const confidenceStore = new WeakMap<MeshData, Float32Array>();

export function getProjectionConfidence(mesh: MeshData): Float32Array {
  let arr = confidenceStore.get(mesh);
  if (!arr || arr.length !== mesh.numTri) {
    arr = new Float32Array(mesh.numTri);
    confidenceStore.set(mesh, arr);
  }
  return arr;
}

/** Region ids created by projection calls on this mesh — later views shrink
 *  earlier views' regions so each triangle stays in exactly one region. */
const regionRegistry = new WeakMap<MeshData, Set<number>>();

export function projectionRegionRegistry(mesh: MeshData): Set<number> {
  let s = regionRegistry.get(mesh);
  if (!s) {
    s = new Set();
    regionRegistry.set(mesh, s);
  }
  return s;
}

/** Fill triangles the ID buffer never saw (subpixel slivers, pinholes) from
 *  agreeing painted edge-neighbors. Conservative by construction: a triangle
 *  fills only when at least TWO of its edge-neighbors are painted AND they
 *  all agree on the color, so fills grow from consensus and stop at any
 *  boundary between colors. Only camera-facing triangles (facing >= minFacing)
 *  are candidates — occluded back geometry stays unpainted for a later view.
 *  Mutates `winner` in place; returns the LOCAL indices that were filled. */
export function fillUnvotedFromNeighbors(opts: {
  winner: Int32Array;
  adjacency: Int32Array;
  facing: Float32Array;
  minFacing: number;
  maxRounds?: number;
}): number[] {
  const { winner, adjacency, facing, minFacing } = opts;
  const maxRounds = opts.maxRounds ?? 16;
  const filled: number[] = [];
  const n = winner.length;

  for (let round = 0; round < maxRounds; round++) {
    // Two-phase per round (collect, then apply) so a round's fills are based
    // solely on the previous round's state — no scan-order dependence.
    const pending: Array<[number, number]> = [];
    for (let t = 0; t < n; t++) {
      if (winner[t] !== WINNER_NO_PIXELS || facing[t] < minFacing) continue;
      let color = -1, agree = 0, conflict = false;
      for (let e = 0; e < 3; e++) {
        const nb = adjacency[t * 3 + e];
        if (nb < 0) continue;
        const w = winner[nb];
        if (w < 0) continue;
        if (color === -1) { color = w; agree = 1; }
        else if (w === color) agree++;
        else { conflict = true; break; }
      }
      if (!conflict && agree >= 2) pending.push([t, color]);
    }
    if (pending.length === 0) break;
    for (const [t, color] of pending) {
      winner[t] = color;
      filled.push(t);
    }
  }
  return filled;
}
