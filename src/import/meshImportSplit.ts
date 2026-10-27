// Splitting one imported mesh into several objects — the pure half of the
// multi-object import flow shared by 3MF (one object per 3MF object, or per
// slicer build plate), STL (one object per connected piece) and multi-file
// imports (one object per model, or per file — see `multiFileImport.ts`).
//
// An import is described as a list of ITEMS (a 3MF build item, an STL piece),
// each a set of triangles of the parsed source mesh. `planImportSplit` turns
// the user's choice (split mode + which items) into GROUPS — one per object to
// create — and `extractTriangles` cuts a group's triangles out as its own
// compact mesh, keeping triangle order so per-triangle colours stay aligned.
//
// Dependency-free so it runs in the vitest unit tier.

import type { MeshData } from '../geometry/types';

/** How an import is divided into objects:
 *  - `none`   — everything selected lands as ONE object (the classic import).
 *  - `object` — one object per item (3MF object / build item).
 *  - `plate`  — one object per slicer build plate (3MF projects with plates).
 *  - `piece`  — one object per connected piece (STL).
 *  - `file`   — one object per source file (a multi-file import). */
export type ImportSplitMode = 'none' | 'object' | 'plate' | 'piece' | 'file';

export interface ImportSplitItem {
  name: string;
  /** Triangle ids of this item in the source mesh. */
  triangles: ArrayLike<number>;
  /** Build plate id (3MF projects with a plate layout). */
  plate?: number;
  /** Source file index (multi-file imports): into `PlanImportSplitOptions.files`. */
  file?: number;
  /** Named parts inside the item (a 3MF object's parts): runs of SOURCE
   *  triangle ids; a name may span several runs. */
  parts?: { name: string; firstTriangle: number; triangleCount: number }[];
}

interface ImportSplitPlate { id: number; name: string }

/** One object to create. */
interface ImportSplitGroup {
  /** Object name (unique within the plan). */
  name: string;
  /** Object-list group (the plate name, when objects come from several plates). */
  group?: string;
  /** Indices into the items list, in order. */
  items: number[];
}

interface PlanImportSplitOptions {
  /** Items to include (indices into `items`). Default: all of them. */
  selected?: number[];
  /** The file's build plates, for plate names and order. */
  plates?: ImportSplitPlate[];
  /** Source file names (multi-file imports), indexed by `ImportSplitItem.file`:
   *  the object names in `file` mode, and the object-list group of a file's
   *  objects in `object` mode when that file holds several. */
  files?: string[];
  /** Name of the single object in `none` mode (usually the file's base name). */
  baseName: string;
}

/** Make `name` unique against `used` by appending " (2)", " (3)", …. */
function uniqueName(name: string, used: Set<string>): string {
  const base = name.trim() || 'Object';
  let out = base;
  for (let n = 2; used.has(out.toLowerCase()); n++) out = `${base} (${n})`;
  used.add(out.toLowerCase());
  return out;
}

/** Group the selected items into the objects an import should create. */
export function planImportSplit(items: ImportSplitItem[], mode: ImportSplitMode, opts: PlanImportSplitOptions): ImportSplitGroup[] {
  const selected = (opts.selected ?? items.map((_, i) => i)).filter(i => i >= 0 && i < items.length);
  if (selected.length === 0) return [];
  const plateName = new Map((opts.plates ?? []).map(p => [p.id, p.name]));
  const nameOfPlate = (id: number) => plateName.get(id) ?? `Plate ${id}`;
  const used = new Set<string>();

  if (mode === 'none') return [{ name: uniqueName(opts.baseName, used), items: selected }];

  if (mode === 'plate') {
    // Plate order: the file's own, then any plate ids it didn't declare.
    const order = (opts.plates ?? []).map(p => p.id);
    const byPlate = new Map<number, number[]>();
    const loose: number[] = [];
    for (const i of selected) {
      const p = items[i].plate;
      if (p === undefined) { loose.push(i); continue; }
      if (!byPlate.has(p)) byPlate.set(p, []);
      byPlate.get(p)!.push(i);
      if (!order.includes(p)) order.push(p);
    }
    const groups: ImportSplitGroup[] = [];
    for (const p of order) {
      const members = byPlate.get(p);
      if (members) groups.push({ name: uniqueName(nameOfPlate(p), used), items: members });
    }
    // Objects no plate claims stay objects of their own.
    for (const i of loose) groups.push({ name: uniqueName(items[i].name, used), items: [i] });
    return groups;
  }

  const nameOfFile = (f: number) => opts.files?.[f] ?? `File ${f + 1}`;
  if (mode === 'file') {
    const byFile = new Map<number, number[]>();
    const loose: number[] = [];
    for (const i of selected) {
      const f = items[i].file;
      if (f === undefined) { loose.push(i); continue; }
      if (!byFile.has(f)) byFile.set(f, []);
      byFile.get(f)!.push(i);
    }
    const groups: ImportSplitGroup[] = [...byFile].map(([f, members]) => ({ name: uniqueName(nameOfFile(f), used), items: members }));
    for (const i of loose) groups.push({ name: uniqueName(items[i].name, used), items: [i] });
    return groups;
  }

  // object / piece: one object each. Thread them under their plate in the
  // object list when the selection spans more than one plate — or, in a
  // multi-file import, under their file when it contributes several.
  const platesUsed = new Set(selected.map(i => items[i].plate).filter(p => p !== undefined));
  const grouped = platesUsed.size > 1;
  const perFile = new Map<number, number>();
  for (const i of selected) {
    const f = items[i].file;
    if (f !== undefined) perFile.set(f, (perFile.get(f) ?? 0) + 1);
  }
  const fileGrouped = perFile.size > 1;
  return selected.map(i => {
    const p = items[i].plate;
    const f = items[i].file;
    const group = grouped && p !== undefined ? nameOfPlate(p)
      : fileGrouped && f !== undefined && perFile.get(f)! > 1 ? nameOfFile(f)
      : undefined;
    return {
      name: uniqueName(items[i].name, used),
      ...(group !== undefined ? { group } : {}),
      items: [i],
    };
  });
}

/** `count` consecutive triangle ids starting at `first`. */
export function triangleRange(first: number, count: number): Uint32Array {
  const out = new Uint32Array(count);
  for (let i = 0; i < count; i++) out[i] = first + i;
  return out;
}

/** The items of an STL split by connected piece, largest first ("Piece 1" is
 *  the biggest). `pieceOfTri` is `computeMeshPieces(mesh).pieceOfTri`. */
export function pieceItems(pieceOfTri: Int32Array, count: number): ImportSplitItem[] {
  const sizes = new Uint32Array(count);
  for (let t = 0; t < pieceOfTri.length; t++) sizes[pieceOfTri[t]]++;
  const lists = Array.from(sizes, n => new Uint32Array(n));
  const fill = new Uint32Array(count);
  for (let t = 0; t < pieceOfTri.length; t++) {
    const p = pieceOfTri[t];
    lists[p][fill[p]++] = t;
  }
  const order = Array.from({ length: count }, (_, i) => i).sort((a, b) => sizes[b] - sizes[a] || a - b);
  return order.map((p, rank) => ({ name: `Piece ${rank + 1}`, triangles: lists[p] }));
}

/** Cut `tris` (source triangle ids, in the order given) out of `mesh` as a
 *  compact mesh of its own, with the matching `triColor` entries. With
 *  `recenter`, the result's XY bounding-box centre moves to the origin (Z is
 *  kept: z = 0 is the build plate). `remap` is an optional scratch vertex map
 *  (length `mesh.numVert`, all -1, and all -1 again on return) for callers
 *  cutting many pieces from one big mesh, so each cut costs its own size
 *  rather than the whole mesh's. */
export function extractTriangles(
  mesh: MeshData,
  triColor: Int32Array | null,
  tris: ArrayLike<number>,
  opts: { recenter?: boolean; remap?: Int32Array } = {},
): { mesh: MeshData; triColor: Int32Array | null } {
  const np = mesh.numProp;
  const remap = opts.remap ?? new Int32Array(mesh.numVert).fill(-1);
  const used: number[] = [];
  const triVerts = new Uint32Array(tris.length * 3);
  const outColor = triColor ? new Int32Array(tris.length) : null;
  let numVert = 0;
  for (let i = 0; i < tris.length; i++) {
    const t = tris[i];
    for (let k = 0; k < 3; k++) {
      const v = mesh.triVerts[t * 3 + k];
      if (remap[v] < 0) { remap[v] = numVert++; used.push(v); }
      triVerts[i * 3 + k] = remap[v];
    }
    if (outColor) outColor[i] = triColor![t];
  }
  const vertProperties = new Float32Array(numVert * 3);
  for (const v of used) {
    const r = remap[v];
    for (let k = 0; k < 3; k++) vertProperties[r * 3 + k] = mesh.vertProperties[v * np + k];
    remap[v] = -1;
  }
  if (opts.recenter && numVert > 0) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < vertProperties.length; i += 3) {
      const x = vertProperties[i], y = vertProperties[i + 1];
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    const dx = (minX + maxX) / 2, dy = (minY + maxY) / 2;
    for (let i = 0; i < vertProperties.length; i += 3) {
      vertProperties[i] -= dx;
      vertProperties[i + 1] -= dy;
    }
  }
  return {
    mesh: { vertProperties, triVerts, numVert, numTri: tris.length, numProp: 3 },
    triColor: outColor,
  };
}

/** Concatenate the triangle lists of `items[group.items]`, in order. */
export function groupTriangles(items: ImportSplitItem[], group: ImportSplitGroup): Uint32Array {
  let n = 0;
  for (const i of group.items) n += items[i].triangles.length;
  const out = new Uint32Array(n);
  let o = 0;
  for (const i of group.items) {
    const tris = items[i].triangles;
    for (let k = 0; k < tris.length; k++) out[o++] = tris[k];
  }
  return out;
}

/** Part labels for one planned object, per triangle of `groupTriangles`'
 *  order: an item's own named parts, and — when several items share the
 *  object (a plate, or everything as one) — each item as a part of its own
 *  ("<object> · <part>" for an item that has parts). Null when that leaves
 *  fewer than two parts. Names are unique. */
export function groupPartLabels(items: ImportSplitItem[], group: ImportSplitGroup): { names: string[]; triPart: Int32Array } | null {
  const multi = group.items.length > 1;
  const names: string[] = [];
  const used = new Set<string>();
  const indexOf = new Map<string, number>();
  const labelIndex = (key: string, name: string): number => {
    let i = indexOf.get(key);
    if (i === undefined) {
      i = names.length;
      names.push(uniqueName(name, used));
      indexOf.set(key, i);
    }
    return i;
  };
  let n = 0;
  for (const i of group.items) n += items[i].triangles.length;
  const triPart = new Int32Array(n).fill(-1);
  let o = 0;
  for (const i of group.items) {
    const item = items[i];
    const tris = item.triangles;
    const runs = item.parts ?? [];
    if (runs.length > 0) {
      // Triangles mostly walk the runs in order — try the last match first.
      let last = runs[0];
      const inRun = (r: typeof last, t: number) => t >= r.firstTriangle && t < r.firstTriangle + r.triangleCount;
      for (let k = 0; k < tris.length; k++) {
        const t = tris[k];
        const run = inRun(last, t) ? last : runs.find(r => inRun(r, t));
        if (run) last = run;
        if (run) triPart[o + k] = labelIndex(`${i}\0${run.name}`, multi ? `${item.name} · ${run.name}` : run.name);
        else if (multi) triPart[o + k] = labelIndex(`${i}`, item.name);
      }
    } else if (multi) {
      triPart.fill(labelIndex(`${i}`, item.name), o, o + tris.length);
    }
    o += tris.length;
  }
  return names.length >= 2 ? { names, triPart } : null;
}
