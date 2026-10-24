// Export colour palette: list the distinct per-triangle colours a coloured mesh
// will carry into a 3MF (each distinct hex = one filament in the slicer), suggest
// merges of near-identical shades, and apply a colour remap to the export copy.
//
// Why: every exact hex becomes its own filament. A figure painted "black" in five
// places with five slightly different blacks (#0D0D0D eyes, #1B1B1B shoes, a
// #1F1712 hair, …) opens in Bambu Studio / Orca with five near-identical black
// filaments. Merging is an EXPORT-ONLY transform — the session's paint is never
// touched — so the user can collapse the palette for the printer they have.
//
// Pure (no DOM/IndexedDB): unit-tested in tests/unit/exportColors.test.ts.

import type { MeshData } from '../geometry/types';
import { isPainted } from '../color/regions';
import { rgbToLab } from '../relief/imageToRelief';
import { triColorHex, DEFAULT_COLOR_HEX } from './meshClean';

/** One distinct export colour. `hex` is lowercase `#rrggbb`. */
export interface ExportColor {
  hex: string;
  /** Triangles carrying this colour, summed over every mesh. */
  triangles: number;
  /** Fraction of all triangles (0–1). */
  share: number;
  /** True when (some of) these triangles are unpainted and fall back to the
   *  default model colour rather than carrying paint of their own. */
  unpainted?: boolean;
}

/** source hex → target hex. Both lowercase `#rrggbb`. Identity entries are allowed
 *  (and ignored). */
export type ColorRemap = Record<string, string>;

export interface ColorMergeOptions {
  /** Merge colours within this CIE76 ΔE of an already-kept, more-used colour.
   *  0 = merge only exact duplicates (i.e. nothing). ~2 is a just-noticeable
   *  difference; ~10 collapses "the same colour, painted twice slightly
   *  differently". */
  tolerance?: number;
  /** Cap the number of resulting colours: the least-used colours fold into their
   *  nearest kept colour until at most this many remain. */
  maxColors?: number;
}

const HEX_RE = /^#?[0-9a-f]{6}$/i;

/** Normalize `#RRGGBB` / `rrggbb` → `#rrggbb`, or null when malformed. */
export function normalizeHex(hex: string): string | null {
  if (typeof hex !== 'string' || !HEX_RE.test(hex.trim())) return null;
  return '#' + hex.trim().replace(/^#/, '').toLowerCase();
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace(/^#/, '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/** Perceptual distance (CIE76 ΔE in L*a*b*) between two hex colours. */
export function colorDistance(a: string, b: string): number {
  const [l1, a1, b1] = rgbToLab(...hexToRgb(a));
  const [l2, a2, b2] = rgbToLab(...hexToRgb(b));
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}

/**
 * Distinct colours across `meshes`, most-used first. Returns [] when no mesh
 * carries paint (an unpainted export has no colour data at all). Unpainted
 * triangles on a partly-painted mesh are counted under the default model colour
 * (what the 3MF writers emit for them) and flagged `unpainted`; meshes with no
 * colour buffer are skipped.
 */
export function collectExportColors(meshes: MeshData[]): ExportColor[] {
  const counts = new Map<string, number>();
  const unpaintedHexes = new Set<string>();
  let total = 0;
  let anyPainted = false;
  for (const mesh of meshes) {
    // A mesh with no colour buffer is written without colour data (the slicer
    // gives it the first filament), so it contributes no palette entry.
    const tc = mesh.triColors;
    if (!tc) continue;
    total += mesh.numTri;
    for (let t = 0; t < mesh.numTri; t++) {
      const painted = isPainted(tc, t);
      if (painted) anyPainted = true;
      else unpaintedHexes.add(DEFAULT_COLOR_HEX);
      const hex = triColorHex(tc, t);
      counts.set(hex, (counts.get(hex) ?? 0) + 1);
    }
  }
  if (!anyPainted || total === 0) return [];
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .map(([hex, triangles]) => ({
      hex, triangles, share: triangles / total,
      ...(unpaintedHexes.has(hex) ? { unpainted: true } : {}),
    }));
}

/**
 * Suggest a merge map for `colors` (as returned by {@link collectExportColors}).
 * Greedy, most-used first: each colour folds into the nearest already-kept colour
 * within `tolerance`, else it is kept. Then, if `maxColors` is set, the least-used
 * kept colours fold into their nearest remaining kept colour until the cap holds.
 * Targets are always real colours from the list (never a blend), so the merged
 * filament is one the user actually painted. Only changed entries are returned.
 */
export function suggestColorMerges(colors: ExportColor[], opts: ColorMergeOptions = {}): ColorRemap {
  const tolerance = Math.max(0, opts.tolerance ?? 0);
  const ordered = [...colors].sort((a, b) => b.triangles - a.triangles);
  const assign = new Map<string, string>();       // source → kept representative
  const kept: string[] = [];
  const weight = new Map<string, number>();       // kept → aggregated triangles
  for (const c of ordered) {
    let best: string | null = null, bestD = Infinity;
    for (const k of kept) {
      const d = colorDistance(c.hex, k);
      if (d < bestD) { bestD = d; best = k; }
    }
    if (best !== null && tolerance > 0 && bestD <= tolerance) {
      assign.set(c.hex, best);
      weight.set(best, (weight.get(best) ?? 0) + c.triangles);
    } else {
      kept.push(c.hex);
      assign.set(c.hex, c.hex);
      weight.set(c.hex, c.triangles);
    }
  }

  const max = opts.maxColors;
  if (max !== undefined && Number.isFinite(max) && max >= 1) {
    while (kept.length > max) {
      // Fold the least-used kept colour into its nearest surviving neighbour.
      let victimIdx = 0;
      for (let i = 1; i < kept.length; i++) {
        if ((weight.get(kept[i]) ?? 0) < (weight.get(kept[victimIdx]) ?? 0)) victimIdx = i;
      }
      const victim = kept[victimIdx];
      kept.splice(victimIdx, 1);
      let into = kept[0], bestD = Infinity;
      for (const k of kept) {
        const d = colorDistance(victim, k);
        if (d < bestD) { bestD = d; into = k; }
      }
      weight.set(into, (weight.get(into) ?? 0) + (weight.get(victim) ?? 0));
      weight.delete(victim);
      for (const [src, rep] of assign) if (rep === victim) assign.set(src, into);
    }
  }

  const out: ColorRemap = {};
  for (const [src, rep] of assign) if (src !== rep) out[src] = rep;
  return out;
}

/**
 * Validate + normalize a caller-supplied remap: lowercase `#rrggbb` keys/values,
 * identity entries dropped, chains collapsed (a→b, b→c ⇒ a→c, b→c). Returns
 * `{ error }` on a malformed hex or a cycle (a→b, b→a).
 */
export function normalizeColorRemap(remap: Record<string, string>): ColorRemap | { error: string } {
  const flat: ColorRemap = {};
  for (const [k, v] of Object.entries(remap)) {
    const from = normalizeHex(k);
    const to = typeof v === 'string' ? normalizeHex(v) : null;
    if (!from) return { error: `colorMap: "${k}" is not a #rrggbb colour.` };
    if (!to) return { error: `colorMap: "${String(v)}" (for ${k}) is not a #rrggbb colour.` };
    if (from !== to) flat[from] = to;
  }
  const out: ColorRemap = {};
  for (const from of Object.keys(flat)) {
    let to = flat[from];
    const seen = new Set([from]);
    while (flat[to] !== undefined) {
      if (seen.has(to)) return { error: `colorMap: cycle involving ${from}.` };
      seen.add(to);
      to = flat[to];
    }
    if (to !== from) out[from] = to;
  }
  return out;
}

/** Compose two remaps: apply `first`, then `second` to its result. */
export function composeColorRemaps(first: ColorRemap, second: ColorRemap): ColorRemap {
  const out: ColorRemap = {};
  const keys = new Set([...Object.keys(first), ...Object.keys(second)]);
  for (const k of keys) {
    const mid = first[k] ?? k;
    const end = second[mid] ?? mid;
    if (end !== k) out[k] = end;
  }
  return out;
}

/** Number of distinct colours left after applying `remap` to `colors`. */
export function countRemappedColors(colors: ExportColor[], remap: ColorRemap): number {
  return new Set(colors.map(c => remap[c.hex] ?? c.hex)).size;
}

/**
 * Return a copy of `mesh` with its triangle colours remapped. The source mesh is
 * never mutated (it may be the live viewport mesh). A remapped triangle is marked
 * painted — so remapping the default colour of unpainted triangles paints them
 * the target colour. No-op (returns `mesh`) when there's nothing to remap.
 */
export function applyColorRemap(mesh: MeshData, remap: ColorRemap): MeshData {
  const tc = mesh.triColors;
  if (!tc || Object.keys(remap).length === 0) return mesh;
  const rgb = new Map<string, [number, number, number]>();
  for (const [from, to] of Object.entries(remap)) rgb.set(from, hexToRgb(to));
  const n = mesh.numTri;
  const out = new Uint8Array(n * 3);
  const painted = new Uint8Array(n);
  let changed = false;
  for (let t = 0; t < n; t++) {
    const target = rgb.get(triColorHex(tc, t));
    if (target) {
      out[t * 3] = target[0]; out[t * 3 + 1] = target[1]; out[t * 3 + 2] = target[2];
      painted[t] = 1;
      changed = true;
    } else {
      out[t * 3] = tc[t * 3]; out[t * 3 + 1] = tc[t * 3 + 1]; out[t * 3 + 2] = tc[t * 3 + 2];
      painted[t] = isPainted(tc, t) ? 1 : 0;
    }
  }
  if (!changed) return mesh;
  (out as Uint8Array & { _painted?: Uint8Array })._painted = painted;
  return { ...mesh, triColors: out };
}
