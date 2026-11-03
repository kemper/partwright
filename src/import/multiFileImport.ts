// Importing several mesh files (STL and 3MF, mixed) in one go — the pure half.
//
// The files are merged into ONE source the multi-object import already knows
// how to split (`meshImportSplit.ts`): every STL is one item, every 3MF build
// object is one item, and each item's triangles are a contiguous run with its
// own vertices (so moving one item never drags another). 3MF colours carry over
// through a merged palette. The caller then lays the items out
// (`layoutMultiFileSource`), plans the objects with `planImportSplit` (modes
// `object`, `file`, `none`) and cuts them out as usual.
//
// Dependency-free so it runs in the vitest unit tier.

import type { MeshData } from '../geometry/types';
import { triangleRange, type ImportSplitItem } from './meshImportSplit';
import { shelfPack } from '../insert/partLayout';

export interface MultiFileInput {
  /** File name, with extension. */
  name: string;
  format: 'stl' | '3mf';
  /** The file's indexed mesh (an STL welded by the probe, a 3MF as parsed). */
  mesh: MeshData;
  /** 3MF: per-triangle index into `palette`, -1 = uncoloured. */
  triColor?: Int32Array | null;
  palette?: { name: string; hex: string }[];
  /** 3MF: the file's build objects as triangle runs. Absent = the whole mesh
   *  is one item (an STL). */
  objects?: { name: string; firstTriangle: number; triangleCount: number; parts?: { name: string; firstTriangle: number; triangleCount: number }[] }[];
}

export interface MultiFileItem extends ImportSplitItem {
  file: number;
  /** This item's triangles in the merged mesh: `[first, first + count)`. */
  first: number;
  count: number;
}

export interface MultiFileSource {
  /** Every item's triangles, file by file, each item with its own vertices. */
  mesh: MeshData;
  /** Per-triangle index into `palette`, -1 = uncoloured. */
  triColor: Int32Array;
  /** The 3MF palettes merged (one entry per distinct colour). */
  palette: { name: string; hex: string }[];
  items: MultiFileItem[];
  /** File names without extension, indexed by `MultiFileItem.file`. */
  files: string[];
  /** Files whose colours were left out: merging them would have taken the
   *  palette past `maxColors`. */
  uncolouredFiles: number[];
}

const baseName = (name: string) => name.replace(/\.[^.]+$/, '') || name;

/** Triangles `[first, first + count)` of `mesh` as a compact mesh of their
 *  own (order kept). `remap` is a caller-owned, all -1 scratch map over the
 *  mesh's vertices; it is all -1 again on return. */
function cutRun(mesh: MeshData, first: number, count: number, remap: Int32Array): MeshData {
  const np = mesh.numProp;
  const triVerts = new Uint32Array(count * 3);
  const used: number[] = [];
  for (let i = 0; i < count * 3; i++) {
    const v = mesh.triVerts[first * 3 + i];
    if (remap[v] < 0) { remap[v] = used.length; used.push(v); }
    triVerts[i] = remap[v];
  }
  const vertProperties = new Float32Array(used.length * 3);
  used.forEach((v, r) => {
    vertProperties[r * 3] = mesh.vertProperties[v * np];
    vertProperties[r * 3 + 1] = mesh.vertProperties[v * np + 1];
    vertProperties[r * 3 + 2] = mesh.vertProperties[v * np + 2];
    remap[v] = -1;
  });
  return { vertProperties, triVerts, numVert: used.length, numTri: count, numProp: 3 };
}

/** Merge the files into one source. Items keep file order, and a 3MF's
 *  objects keep the file's order. A file whose colours would take the merged
 *  palette past `maxColors` comes in uncoloured (the others keep theirs). */
export function buildMultiFileSource(inputs: MultiFileInput[], opts: { maxColors?: number } = {}): MultiFileSource {
  const pieces: { mesh: MeshData; triColor: Int32Array | null }[] = [];
  const items: MultiFileItem[] = [];
  const palette: { name: string; hex: string }[] = [];
  const paletteIndex = new Map<string, number>();
  const uncolouredFiles: number[] = [];
  let triOffset = 0;

  inputs.forEach((input, file) => {
    const fresh = new Set((input.palette ?? []).map(e => e.hex.toLowerCase()).filter(k => !paletteIndex.has(k)));
    const fits = palette.length + fresh.size <= (opts.maxColors ?? Infinity);
    if (!fits) uncolouredFiles.push(file);
    // This file's palette slots → merged palette indices.
    const slotMap = (fits ? input.palette ?? [] : []).map(entry => {
      const key = entry.hex.toLowerCase();
      let idx = paletteIndex.get(key);
      if (idx === undefined) {
        idx = palette.length;
        palette.push({ name: entry.name, hex: entry.hex });
        paletteIndex.set(key, idx);
      }
      return idx;
    });
    const objects = input.objects ?? [{ name: baseName(input.name), firstTriangle: 0, triangleCount: input.mesh.numTri }];
    // One vertex map per file, reset between objects (a full-size map per
    // object would churn on a big 3MF with many objects).
    const remap = new Int32Array(input.mesh.numVert).fill(-1);
    for (const o of objects) {
      const mesh = cutRun(input.mesh, o.firstTriangle, o.triangleCount, remap);
      let triColor: Int32Array | null = null;
      if (input.triColor && slotMap.length > 0) {
        triColor = new Int32Array(o.triangleCount);
        for (let k = 0; k < o.triangleCount; k++) {
          const c = input.triColor[o.firstTriangle + k];
          triColor[k] = c >= 0 && c < slotMap.length ? slotMap[c] : -1;
        }
      }
      pieces.push({ mesh, triColor });
      const parts = o.parts?.map(r => ({ name: r.name, firstTriangle: triOffset + r.firstTriangle - o.firstTriangle, triangleCount: r.triangleCount }));
      items.push({
        name: o.name,
        file,
        first: triOffset,
        count: o.triangleCount,
        triangles: triangleRange(triOffset, o.triangleCount),
        ...(parts && parts.length > 0 ? { parts } : {}),
      });
      triOffset += o.triangleCount;
    }
  });

  let numVert = 0;
  for (const p of pieces) numVert += p.mesh.numVert;
  const vertProperties = new Float32Array(numVert * 3);
  const triVerts = new Uint32Array(triOffset * 3);
  const triColor = new Int32Array(triOffset).fill(-1);
  let v = 0, t = 0;
  for (const p of pieces) {
    vertProperties.set(p.mesh.vertProperties.subarray(0, p.mesh.numVert * 3), v * 3);
    for (let i = 0; i < p.mesh.numTri * 3; i++) triVerts[t * 3 + i] = p.mesh.triVerts[i] + v;
    if (p.triColor) triColor.set(p.triColor, t);
    v += p.mesh.numVert;
    t += p.mesh.numTri;
  }
  return {
    mesh: { vertProperties, triVerts, numVert, numTri: triOffset, numProp: 3 },
    triColor,
    palette,
    items,
    files: inputs.map(i => baseName(i.name)),
    uncolouredFiles,
  };
}

/** Where the models go:
 *  - `keep`   — exactly where the files put them (parts of one assembly).
 *  - `center` — each centred on the origin, sitting on the plate (z = 0).
 *  - `grid`   — side by side in rows on the plate, centred as a whole. */
export type MultiFileLayout = 'keep' | 'center' | 'grid';

interface Box { min: [number, number, number]; max: [number, number, number] }

/** The bounding box of each item, by the vertices its triangles use. Items
 *  own their vertices (see `buildMultiFileSource`), so each one's vertices are
 *  a contiguous run too. */
function itemVertexRanges(source: MultiFileSource): { start: number; end: number }[] {
  const { triVerts } = source.mesh;
  return source.items.map(it => {
    let start = Infinity, end = -1;
    for (let i = it.first * 3; i < (it.first + it.count) * 3; i++) {
      const vi = triVerts[i];
      if (vi < start) start = vi;
      if (vi > end) end = vi;
    }
    return end < 0 ? { start: 0, end: -1 } : { start, end };
  });
}

function boxOf(vp: Float32Array, start: number, end: number): Box {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let v = start; v <= end; v++) {
    for (let k = 0; k < 3; k++) {
      const x = vp[v * 3 + k];
      if (x < min[k]) min[k] = x;
      if (x > max[k]) max[k] = x;
    }
  }
  return { min, max };
}

function itemBoxes(source: MultiFileSource): Box[] {
  return itemVertexRanges(source).map(r => boxOf(source.mesh.vertProperties, r.start, r.end));
}

/** The layout to start with: `grid` when two of the models sit mostly on top
 *  of each other (separately made parts, each modelled around the origin),
 *  else `keep` (they were placed relative to each other — an assembly).
 *  "Mostly": their footprints overlap by more than `overlap` of the smaller
 *  one, and the smaller is at least `similarSize` of the bigger (a small part
 *  nested in a big one is an assembly). */
export function suggestMultiFileLayout(source: MultiFileSource, opts: { overlap: number; similarSize: number }): MultiFileLayout {
  const boxes = itemBoxes(source);
  const area = (b: Box) => Math.max(0, b.max[0] - b.min[0]) * Math.max(0, b.max[1] - b.min[1]);
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      const w = Math.min(a.max[0], b.max[0]) - Math.max(a.min[0], b.min[0]);
      const d = Math.min(a.max[1], b.max[1]) - Math.max(a.min[1], b.min[1]);
      if (w <= 0 || d <= 0) continue;
      const small = Math.min(area(a), area(b)), big = Math.max(area(a), area(b));
      if (small > 0 && (w * d) / small > opts.overlap && small / big >= opts.similarSize) return 'grid';
    }
  }
  return 'keep';
}

/** The merged mesh with the `selected` items moved per `layout` (a copy;
 *  `keep` returns the source mesh itself, which callers must not modify).
 *  Items move together in units: each item (`unit: 'item'`), or each file
 *  (`unit: 'file'` — a 3MF's objects keep their arrangement, for an import
 *  that puts a file, or everything, into one object). `gapRatio` is the grid
 *  gap as a fraction of the units' average footprint size. */
export function layoutMultiFileSource(source: MultiFileSource, layout: MultiFileLayout, opts: { selected?: number[]; gapRatio: number; unit?: 'item' | 'file' }): MeshData {
  if (layout === 'keep') return source.mesh;
  const vp = source.mesh.vertProperties.slice();
  const mesh: MeshData = { ...source.mesh, vertProperties: vp };
  const selected = opts.selected ?? source.items.map((_, i) => i);
  const ranges = itemVertexRanges(source);
  // Units, in order of first appearance, with their items' combined box.
  const unitOf = (i: number) => (opts.unit === 'file' ? `f${source.items[i].file}` : `i${i}`);
  const units = new Map<string, { items: number[]; box: Box }>();
  for (const i of selected) {
    const r = ranges[i];
    if (r.end < r.start) continue;
    const b = boxOf(vp, r.start, r.end);
    const u = units.get(unitOf(i));
    if (!u) { units.set(unitOf(i), { items: [i], box: b }); continue; }
    u.items.push(i);
    for (let k = 0; k < 3; k++) {
      u.box.min[k] = Math.min(u.box.min[k], b.min[k]);
      u.box.max[k] = Math.max(u.box.max[k], b.max[k]);
    }
  }
  const list = [...units.values()];
  const offsets: [number, number, number][] = [];

  if (layout === 'center') {
    for (const { box: b } of list) offsets.push([-(b.min[0] + b.max[0]) / 2, -(b.min[1] + b.max[1]) / 2, -b.min[2]]);
  } else {
    // Shelf packing: fill rows left to right up to a width that makes the
    // whole layout roughly square, then centre the layout on the origin.
    const dims = list.map(({ box: b }) => [b.max[0] - b.min[0], b.max[1] - b.min[1]] as const);
    const mean = dims.length > 0 ? dims.reduce((sum, [w, d]) => sum + (w + d) / 2, 0) / dims.length : 0;
    const gap = Math.max(mean * opts.gapRatio, 0);
    // Rows run from the back (+Y) toward the viewer, like reading order.
    const { centers } = shelfPack(dims, gap);
    list.forEach(({ box: b }, k) => {
      offsets.push([centers[k][0] - (b.min[0] + b.max[0]) / 2, centers[k][1] - (b.min[1] + b.max[1]) / 2, -b.min[2]]);
    });
  }

  list.forEach(({ items }, k) => {
    const [dx, dy, dz] = offsets[k];
    for (const i of items) {
      const r = ranges[i];
      for (let v = r.start; v <= r.end; v++) {
        vp[v * 3] += dx;
        vp[v * 3 + 1] += dy;
        vp[v * 3 + 2] += dz;
      }
    }
  });
  return mesh;
}

/** The import signature an object's mesh import leaves behind: the import's
 *  file name and triangle count, its id (stable across the object's
 *  versions), and the name of the object holding it. */
export interface ImportSignature { filename: string; numTri: number; id?: string; objectName?: string }

/** Which items look already imported into the session. Each distinct import
 *  of a file with an item's triangle count accounts for ONE item of that file
 *  with that count — an item named like the object holding the import first,
 *  then in file order — so a file of identical objects (four feet) isn't all
 *  ticked off by one. An import with the whole file's triangle count (the
 *  file came in as one object) accounts for every item of the file. */
export function alreadyImportedItems(source: MultiFileSource, fileNames: string[], existing: ImportSignature[]): boolean[] {
  // Distinct imports per (file, triangle count), with their objects' names.
  const imports = new Map<string, Map<string, string | undefined>>();
  for (const sig of existing) {
    const key = `${sig.filename}\0${sig.numTri}`;
    if (!imports.has(key)) imports.set(key, new Map());
    imports.get(key)!.set(sig.id ?? key, sig.objectName);
  }
  const fileTotals = new Map<number, number>();
  for (const it of source.items) fileTotals.set(it.file, (fileTotals.get(it.file) ?? 0) + it.count);
  const out = source.items.map(it => imports.has(`${fileNames[it.file]}\0${fileTotals.get(it.file)}`));
  // Group the remaining items by (file, count) and spend that key's imports.
  const byKey = new Map<string, number[]>();
  source.items.forEach((it, i) => {
    if (out[i]) return;
    const key = `${fileNames[it.file]}\0${it.count}`;
    if (!imports.has(key)) return;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key)!.push(i);
  });
  for (const [key, members] of byKey) {
    const owners = [...imports.get(key)!.values()];
    let budget = owners.length;
    const names = new Set(owners.filter((n): n is string => !!n).map(n => n.toLowerCase()));
    for (const i of members) {
      if (budget > 0 && names.has(source.items[i].name.toLowerCase())) { out[i] = true; budget--; }
    }
    for (const i of members) {
      if (budget > 0 && !out[i]) { out[i] = true; budget--; }
    }
  }
  return out;
}
