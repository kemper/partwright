// Splitting one object into several EXPORT ITEMS — the pure half of the
// export picker's "Split" control. An object normally exports as one item
// (one 3MF object / one STL / one OBJ group). Split by:
//   - pieces — one item per connected solid (what comes off the bed as its
//              own lump), named after the part covering most of it;
//   - parts  — one item per `api.label` part. Parts fused into one solid
//              can't be pulled apart without cutting the mesh open, so they
//              stay together as one item ("hair + face", `fused: true`);
//              pieces no label touches travel together as "Unlabeled".
// Items keep their modelled position and orientation; the exporter only
// translates them onto plates.
//
// Dependency-free (besides the pure piece finder) so it runs in the vitest
// unit tier.

import type { MeshData } from '../geometry/types';
import { computeMeshPieces, summarizeObjectParts, type MeshPieces } from '../geometry/meshPieces';

/** How one object is divided into export items. */
export type ExportSplitMode = 'whole' | 'pieces' | 'parts';
export const EXPORT_SPLIT_MODES: ExportSplitMode[] = ['whole', 'pieces', 'parts'];
export function isExportSplitMode(v: unknown): v is ExportSplitMode {
  return typeof v === 'string' && (EXPORT_SPLIT_MODES as string[]).includes(v);
}

/** One item an object splits into. */
export interface ExportSplitItem {
  /** Stable within the object for the same mesh (`piece:3`, `part:hair+face`). */
  key: string;
  /** Display name, unique within the object's items for this mode. */
  name: string;
  /** Source triangle ids, ascending within each piece. */
  triangles: Uint32Array;
  /** The parts (labels) this item carries, in declaration order. */
  labels: string[];
  /** Parts mode: two or more parts share a solid, so they stay together. */
  fused: boolean;
  /** Bounding-box size `[x, y, z]`. */
  size: [number, number, number];
}

export interface ObjectSplitAnalysis {
  /** Bounding-box size of the whole object. */
  size: [number, number, number];
  numTri: number;
  /** Connected pieces in the mesh. */
  pieceCount: number;
  /** Items by piece; null when there's only one piece or more than `maxItems`. */
  pieces: ExportSplitItem[] | null;
  /** Items by part; null when that would make fewer than two items (or more
   *  than `maxItems`). */
  parts: ExportSplitItem[] | null;
}

function bboxSize(mesh: MeshData, tris: ArrayLike<number> | null): [number, number, number] {
  const { vertProperties: vp, triVerts: tv, numProp: np } = mesh;
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  const visit = (v: number) => {
    const x = vp[v * np], y = vp[v * np + 1], z = vp[v * np + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  };
  if (tris) {
    for (let i = 0; i < tris.length; i++) {
      const t = tris[i];
      visit(tv[t * 3]); visit(tv[t * 3 + 1]); visit(tv[t * 3 + 2]);
    }
  } else {
    for (let t = 0; t < mesh.numTri; t++) { visit(tv[t * 3]); visit(tv[t * 3 + 1]); visit(tv[t * 3 + 2]); }
  }
  if (!Number.isFinite(minX)) return [0, 0, 0];
  return [maxX - minX, maxY - minY, maxZ - minZ];
}

/** Make `name` unique against `used` (case-insensitive) with " (2)", " (3)", …. */
function uniqueName(name: string, used: Set<string>): string {
  const base = name.trim() || 'Item';
  let out = base;
  for (let n = 2; used.has(out.toLowerCase()); n++) out = `${base} (${n})`;
  used.add(out.toLowerCase());
  return out;
}

function concat(lists: Uint32Array[]): Uint32Array {
  let n = 0;
  for (const l of lists) n += l.length;
  const out = new Uint32Array(n);
  let o = 0;
  for (const l of lists) { out.set(l, o); o += l.length; }
  return out;
}

/**
 * Work out the pieces and parts `mesh` can be split into. `labelMap` is the
 * run's label → triangle ids map (null when the object declares no parts).
 * `maxItems` caps either list (a mesh of thousands of loose shells isn't a
 * sensible thing to spread over plates); a mode over the cap comes back null.
 */
export function analyzeObjectSplit(
  mesh: MeshData,
  labelMap: ReadonlyMap<string, Set<number>> | null,
  opts: { maxItems?: number; pieces?: MeshPieces } = {},
): ObjectSplitAnalysis {
  const maxItems = opts.maxItems ?? Infinity;
  const pieceInfo = opts.pieces ?? computeMeshPieces(mesh);
  const summary = summarizeObjectParts(mesh, labelMap, pieceInfo);
  const size = bboxSize(mesh, null);

  let pieces: ExportSplitItem[] | null = null;
  if (pieceInfo.count >= 2 && pieceInfo.count <= maxItems) {
    const used = new Set<string>();
    pieces = summary.pieces.map(p => ({
      key: `piece:${p.index}`,
      name: uniqueName(p.part ?? `Piece ${p.index + 1}`, used),
      triangles: p.triangles,
      labels: p.part ? [p.part] : [],
      fused: false,
      size: bboxSize(mesh, p.triangles),
    }));
  }

  // Parts: join pieces and labels into groups — a label spanning several
  // pieces pulls them together, and a piece carrying several labels fuses
  // those labels into one item (they share a solid).
  let parts: ExportSplitItem[] | null = null;
  const labelNames = summary.parts.filter(p => p.triangles.size > 0).map(p => p.name);
  if (labelNames.length >= 1) {
    const P = pieceInfo.count;
    const parent = new Int32Array(P + labelNames.length);
    for (let i = 0; i < parent.length; i++) parent[i] = i;
    const find = (x: number): number => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
    const labelOfPiece = new Uint8Array(P);
    labelNames.forEach((name, li) => {
      for (const t of labelMap!.get(name)!) {
        if (t < 0 || t >= mesh.numTri) continue;
        const p = pieceInfo.pieceOfTri[t];
        if (p < 0) continue;
        labelOfPiece[p] = 1;
        const a = find(P + li), b = find(p);
        if (a !== b) parent[b] = a;
      }
    });
    // Group in label declaration order; unlabeled pieces collect at the end.
    const compOrder: number[] = [];
    const compLabels = new Map<number, string[]>();
    labelNames.forEach((name, li) => {
      const r = find(P + li);
      let arr = compLabels.get(r);
      if (!arr) { arr = []; compLabels.set(r, arr); compOrder.push(r); }
      arr.push(name);
    });
    const compPieces = new Map<number, Uint32Array[]>();
    const loose: Uint32Array[] = [];
    for (let p = 0; p < P; p++) {
      const tris = summary.pieces[p].triangles;
      if (!labelOfPiece[p]) { loose.push(tris); continue; }
      const r = find(p);
      let arr = compPieces.get(r);
      if (!arr) { arr = []; compPieces.set(r, arr); }
      arr.push(tris);
    }
    const used = new Set<string>();
    const items: ExportSplitItem[] = compOrder.map(r => {
      const labels = compLabels.get(r)!;
      const triangles = concat(compPieces.get(r) ?? []);
      return {
        key: `part:${JSON.stringify(labels)}`,
        name: uniqueName(labels.join(' + '), used),
        triangles,
        labels,
        fused: labels.length > 1,
        size: bboxSize(mesh, triangles),
      };
    });
    if (loose.length > 0) {
      const triangles = concat(loose);
      items.push({ key: 'unlabeled', name: uniqueName('Unlabeled', used), triangles, labels: [], fused: false, size: bboxSize(mesh, triangles) });
    }
    // A label whose ids all fall outside this mesh touches no piece: no item.
    const real = items.filter(it => it.triangles.length > 0);
    if (real.length >= 2 && real.length <= maxItems) parts = real;
  }

  return { size, numTri: mesh.numTri, pieceCount: pieceInfo.count, pieces, parts };
}

/** The split modes that apply to an analysed object (always includes `whole`). */
export function availableSplitModes(a: ObjectSplitAnalysis): ExportSplitMode[] {
  const out: ExportSplitMode[] = ['whole'];
  if (a.pieces) out.push('pieces');
  if (a.parts) out.push('parts');
  return out;
}

/** The items for `mode` (null for `whole`, or a mode the object can't use). */
export function splitItems(a: ObjectSplitAnalysis, mode: ExportSplitMode): ExportSplitItem[] | null {
  if (mode === 'pieces') return a.pieces;
  if (mode === 'parts') return a.parts;
  return null;
}

/** Cut `tris` out of `mesh` as a compact mesh of its own, keeping each
 *  triangle's colour and its modelled position (no recentering — the
 *  exporter places items on the bed). */
export function extractItemMesh(mesh: MeshData, tris: ArrayLike<number>): MeshData {
  const np = mesh.numProp;
  const remap = new Int32Array(mesh.numVert).fill(-1);
  const used: number[] = [];
  const triVerts = new Uint32Array(tris.length * 3);
  const src = mesh.triColors;
  const triColors = src ? new Uint8Array(tris.length * 3) : undefined;
  let numVert = 0;
  for (let i = 0; i < tris.length; i++) {
    const t = tris[i];
    for (let k = 0; k < 3; k++) {
      const v = mesh.triVerts[t * 3 + k];
      if (remap[v] < 0) { remap[v] = numVert++; used.push(v); }
      triVerts[i * 3 + k] = remap[v];
    }
    if (triColors) { triColors[i * 3] = src![t * 3]; triColors[i * 3 + 1] = src![t * 3 + 1]; triColors[i * 3 + 2] = src![t * 3 + 2]; }
  }
  const vertProperties = new Float32Array(numVert * 3);
  for (const v of used) {
    const r = remap[v];
    for (let k = 0; k < 3; k++) vertProperties[r * 3 + k] = mesh.vertProperties[v * np + k];
  }
  return { vertProperties, triVerts, numVert, numTri: tris.length, numProp: 3, ...(triColors ? { triColors } : {}) };
}

/** The export name of a split item: "<object> · <item>". */
export function splitItemName(objectName: string, itemName: string): string {
  return `${objectName} · ${itemName}`;
}
