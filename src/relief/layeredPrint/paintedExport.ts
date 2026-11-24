// "Painted (AMS)" export for a layered print: instead of swapping filament at
// layer heights, every region is printed in its own filament, coloured with
// the print's predicted look. The predicted shades are reduced to a fixed
// number of AMS slots — snapped to real filaments (the built-in list or the
// user's palette), or kept as exact shades — so the 3MF asks for filaments the
// user can actually load. Pure; unit-tested.

import { hexToRgb01, rgb01ToLab } from './optics';
import type { LayeredPrintFilament } from './filamentLibrary';

export interface PaintedFilament {
  name: string;
  hex: string;
  /** Fraction of triangles painted with it. */
  share: number;
}

export interface SnappedColors {
  /** numTri × 3 RGB bytes, every triangle one of `filaments`. */
  triColors: Uint8Array;
  filaments: PaintedFilament[];
}

interface ColorBucket { rgb: [number, number, number]; lab: [number, number, number]; weight: number }

function buckets(triColors: Uint8Array, numTri: number): { list: ColorBucket[]; triBucket: Int32Array } {
  const index = new Map<number, number>();
  const list: ColorBucket[] = [];
  const triBucket = new Int32Array(numTri);
  for (let t = 0; t < numTri; t++) {
    const r = triColors[t * 3], g = triColors[t * 3 + 1], b = triColors[t * 3 + 2];
    const key = (r << 16) | (g << 8) | b;
    let i = index.get(key);
    if (i === undefined) {
      i = list.length;
      index.set(key, i);
      list.push({ rgb: [r, g, b], lab: rgb01ToLab(r / 255, g / 255, b / 255), weight: 0 });
    }
    list[i].weight++;
    triBucket[t] = i;
  }
  return { list, triBucket };
}

const d2 = (a: readonly number[], b: readonly number[]) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

const toHex = (rgb: readonly number[]) => '#' + rgb.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');

/** Pick up to `slots` candidates minimising the weighted colour error (greedy
 *  facility location), then map every shade to its nearest pick. */
function snapToCandidates(list: ColorBucket[], slots: number, candidates: readonly LayeredPrintFilament[]): Array<{ name: string; rgb: [number, number, number] }> {
  const cand = candidates.map((f) => {
    const [r, g, b] = hexToRgb01(f.hex);
    return { name: f.name, rgb: [r * 255, g * 255, b * 255] as [number, number, number], lab: rgb01ToLab(r, g, b) };
  });
  const best = list.map(() => Infinity);
  const chosen: number[] = [];
  for (let s = 0; s < Math.min(slots, cand.length); s++) {
    let pick = -1, pickCost = Infinity;
    for (let c = 0; c < cand.length; c++) {
      if (chosen.includes(c)) continue;
      let cost = 0;
      for (let i = 0; i < list.length; i++) cost += list[i].weight * Math.sqrt(Math.min(best[i], d2(list[i].lab, cand[c].lab)));
      if (cost < pickCost) { pickCost = cost; pick = c; }
    }
    if (pick < 0) break;
    chosen.push(pick);
    for (let i = 0; i < list.length; i++) best[i] = Math.min(best[i], d2(list[i].lab, cand[pick].lab));
  }
  return chosen.map((c) => ({ name: cand[c].name, rgb: cand[c].rgb }));
}

/** Weighted k-means in Lab over the shades → `slots` exact colours. */
function exactShades(list: ColorBucket[], slots: number): Array<{ name: string; rgb: [number, number, number] }> {
  const sorted = [...list].sort((a, b) => b.weight - a.weight);
  if (sorted.length <= slots) return sorted.map((b, i) => ({ name: `Shade ${i + 1}`, rgb: b.rgb }));
  // Farthest-point seeding from the heaviest shade.
  const centres: ColorBucket[] = [sorted[0]];
  while (centres.length < slots) {
    let far = sorted[0], farD = -1;
    for (const b of sorted) {
      const d = Math.min(...centres.map((c) => d2(b.lab, c.lab))) * Math.sqrt(b.weight);
      if (d > farD) { farD = d; far = b; }
    }
    centres.push(far);
  }
  const lab = centres.map((c) => [...c.lab]);
  const rgb = centres.map((c) => [...c.rgb]);
  for (let iter = 0; iter < 10; iter++) {
    const acc = lab.map(() => [0, 0, 0, 0, 0, 0, 0]);
    for (const b of list) {
      let k = 0, kd = Infinity;
      lab.forEach((c, j) => { const d = d2(b.lab, c); if (d < kd) { kd = d; k = j; } });
      const a = acc[k];
      a[0] += b.lab[0] * b.weight; a[1] += b.lab[1] * b.weight; a[2] += b.lab[2] * b.weight;
      a[3] += b.rgb[0] * b.weight; a[4] += b.rgb[1] * b.weight; a[5] += b.rgb[2] * b.weight; a[6] += b.weight;
    }
    acc.forEach((a, j) => {
      if (a[6] > 0) { lab[j] = [a[0] / a[6], a[1] / a[6], a[2] / a[6]]; rgb[j] = [a[3] / a[6], a[4] / a[6], a[5] / a[6]]; }
    });
  }
  return rgb.map((c, i) => ({ name: `Shade ${i + 1}`, rgb: [Math.round(c[0]), Math.round(c[1]), Math.round(c[2])] as [number, number, number] }));
}

/**
 * Reduce a coloured mesh's per-triangle colours to `slots` filaments.
 * `candidates` = real filaments to snap to, or `'exact'` for the k-means shades
 * themselves (the look of the preview, but filament colours you may not own).
 */
export function snapTriColorsToFilaments(triColors: Uint8Array, numTri: number, slots: number, candidates: readonly LayeredPrintFilament[] | 'exact'): SnappedColors {
  const n = Math.max(1, Math.min(16, Math.round(slots)));
  const { list, triBucket } = buckets(triColors, numTri);
  const picks = candidates === 'exact' ? exactShades(list, n) : snapToCandidates(list, n, candidates);
  if (picks.length === 0) throw new Error('painted export: no filaments to choose from');
  const pickLab = picks.map((p) => rgb01ToLab(p.rgb[0] / 255, p.rgb[1] / 255, p.rgb[2] / 255));
  const bucketPick = list.map((b) => {
    let k = 0, kd = Infinity;
    pickLab.forEach((l, j) => { const d = d2(b.lab, l); if (d < kd) { kd = d; k = j; } });
    return k;
  });
  const out = new Uint8Array(numTri * 3);
  // Every triangle is painted — say so explicitly, so a pure-black filament
  // isn't read as "unpainted" by the exporters (see color/regions isPainted).
  (out as Uint8Array & { _painted?: Uint8Array })._painted = new Uint8Array(numTri).fill(1);
  const count = new Array<number>(picks.length).fill(0);
  for (let t = 0; t < numTri; t++) {
    const k = bucketPick[triBucket[t]];
    count[k]++;
    out[t * 3] = picks[k].rgb[0]; out[t * 3 + 1] = picks[k].rgb[1]; out[t * 3 + 2] = picks[k].rgb[2];
  }
  const filaments = picks
    .map((p, k) => ({ name: p.name, hex: toHex(p.rgb), share: numTri > 0 ? count[k] / numTri : 0 }))
    .filter((f) => f.share > 0)
    .sort((a, b) => b.share - a.share);
  return { triColors: out, filaments };
}
