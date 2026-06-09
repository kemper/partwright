// Headless model preview — runs a single manifold-js model snippet against the
// REAL engine in Node (no browser, no dev server) and returns the rich stat
// block + render data an AI needs to self-correct. Loaded via vite SSR by
// scripts/model-preview.mjs (`npm run model:preview`). The execution path is the
// exact same `manifoldJsEngine` the app uses, so results are faithful.
import { manifoldJsEngine, getManifoldModule } from '../geometry/engines/manifoldJs';
import { voxelEngine } from '../geometry/engines/voxel';
import { openscadEngine, runScadAsync } from '../geometry/engines/openscad';
import type { Language } from '../geometry/engines/types';
import type { MeshResult } from '../geometry/engines/types';
import { componentsOverlap } from './bboxOverlap';

export interface PreviewComponent {
  index: number;
  triangleCount: number;
  volume: number;
  bbox: { min: number[]; max: number[]; size: number[] };
  /** Bounding-box center of this island ((min+max)/2) — the cheap "where is
   *  it" locator surfaced by `--explain-components`. Empty when the part had
   *  no measurable bounding box. */
  center: number[];
}

export interface PreviewStats {
  isManifold: boolean;
  empty: boolean;
  componentCount: number;
  triangleCount: number;
  vertexCount: number;
  volume: number;
  surfaceArea: number;
  genus: number;
  bbox: { min: number[]; max: number[]; size: number[]; center: number[] } | null;
  aspectRatio: number;        // longest bbox dim / shortest
  minEdgeLength: number;      // smallest triangle edge (sub-0.4mm ≈ unprintable detail)
  meanEdgeLength: number;
  components: PreviewComponent[];
  labels: { name: string; color: number[] | null; triangleCount: number }[];
  warnings: string[];         // actionable heuristics (fused parts, tri budget, …)
  paramsSchema: unknown;
  renderOnly: boolean;
  /** Which engine produced this preview (so the caller can label output). */
  engine: Language;
  /** Occupied-voxel count — only set for the `voxel` engine. */
  voxelCount?: number;
  /** Face-connected printable-piece count (6-neighbour) — only set for the
   *  `voxel` engine. Trust this over `componentCount` for "is this one piece?":
   *  the mesh componentCount over-reports voxel models (enclosed cavities count
   *  as a second component, edge/corner-only touches split). */
  voxelPieceCount?: number;
}

export interface PreviewRender {
  positions: Float32Array; // xyz, length numVert*3
  triVerts: Uint32Array;   // length numTri*3
  triColors: Uint8Array | null; // rgb per triangle, length numTri*3
  bbox: { min: number[]; max: number[] } | null;
}

export interface PreviewResult {
  ok: boolean;
  error: string | null;
  diagnostics?: unknown;
  stats: PreviewStats | null;
  render: PreviewRender | null;
}

function bb(box: { min: number[]; max: number[] }) {
  const size = [box.max[0] - box.min[0], box.max[1] - box.min[1], box.max[2] - box.min[2]];
  return { min: box.min, max: box.max, size };
}

// manifold-3d's boundingBox() returns {min:[x,y,z], max:[x,y,z]} (arrays), but
// some builds expose {x,y,z} objects — accept either.
function toBox(raw: { min: unknown; max: unknown }) {
  const vec = (v: unknown): number[] => Array.isArray(v)
    ? [v[0], v[1], v[2]]
    : [(v as { x: number }).x, (v as { y: number }).y, (v as { z: number }).z];
  return { min: vec(raw.min), max: vec(raw.max) };
}

/** Engines runnable in the stateless (no-browser) preview tier:
 *  - `manifold-js` — owns the WASM kernel (loaded once via init).
 *  - `voxel` — plain JS that meshes a grid (no WASM).
 *  - `scad` — OpenSCAD's Emscripten WASM, which loads cleanly under Node.
 *  `replicad` is omitted: its OpenCASCADE WASM resolves its `.wasm` to a
 *  server-style path that doesn't exist on Node's filesystem, so it runs
 *  through the Phase-2 daemon (`partwright iterate --lang replicad`) instead. */
const STATELESS_ENGINES: Language[] = ['manifold-js', 'voxel', 'scad'];

export async function previewModel(
  code: string,
  opts: { params?: Record<string, unknown>; maxComponents?: number; lang?: Language } = {},
): Promise<PreviewResult> {
  const engine: Language = opts.lang ?? 'manifold-js';
  // manifold-3d is always needed: the kernel for manifold-js runs, and the
  // mesh→Manifold round-trip we use to compute stats for the voxel engine.
  await manifoldJsEngine.init();
  if (!STATELESS_ENGINES.includes(engine)) {
    return {
      ok: false,
      error: `Headless preview for the '${engine}' engine isn't supported in the stateless tier (it needs its own WASM). Use the daemon: \`partwright iterate --lang ${engine} <file>\`.`,
      stats: null,
      render: null,
    };
  }

  let raw: MeshResult;
  if (engine === 'voxel') {
    raw = voxelEngine.run(code, opts.params);
  } else if (engine === 'scad') {
    if (!openscadEngine.isReady()) await openscadEngine.init();
    raw = await runScadAsync(code, opts.params);
  } else {
    raw = manifoldJsEngine.run(code, opts.params);
  }
  const r = raw as MeshResult & {
    mesh: { vertProperties: Float32Array; triVerts: Uint32Array; numVert: number; numTri: number; numProp: number; triColors?: Uint8Array } | null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    manifold: any;
  };

  if (r.error || !r.mesh) {
    return { ok: false, error: r.error ?? 'no mesh produced', diagnostics: r.diagnostics, stats: null, render: null };
  }

  const mesh = r.mesh;
  const renderOnly = r.renderOnly === true;
  // The voxel engine returns mesh data with `manifold: null` (the grid mesher
  // never builds a live Manifold). Reconstruct one via ofMesh so volume / genus
  // / component stats come out the same as a manifold-js model — voxel meshes
  // are welded + watertight, so this round-trips cleanly. Free it at the end.
  let man = r.manifold;
  let reconstructed = false;
  if (!man && !renderOnly) {
    try { man = getManifoldModule().Manifold.ofMesh(mesh); reconstructed = true; } catch { /* leave man null → render-only stats */ }
  }

  // --- per-triangle colors ---
  // The voxel engine (and any painted mesh) carries authored per-triangle RGB
  // directly on the mesh — one rgb triple per triangle, exactly the layout the
  // rasterizer wants — so prefer it. Otherwise fall back to deriving colors
  // from model-declared labels (the manifold-js path).
  const numTri = mesh.numTri;
  let triColors: Uint8Array | null = null;
  if (mesh.triColors && mesh.triColors.length >= numTri * 3) {
    triColors = new Uint8Array(mesh.triColors.subarray(0, numTri * 3));
  } else if (r.labelMap && r.labelColors && r.labelColors.size > 0) {
    triColors = new Uint8Array(numTri * 3).fill(170); // neutral default
    for (const [name, ids] of r.labelMap) {
      const c = r.labelColors.get(name);
      if (!c) continue;
      const [cr, cg, cb] = c.map((v) => Math.round(Math.max(0, Math.min(1, v)) * 255));
      for (const id of ids) {
        if (id < 0 || id >= numTri) continue;
        triColors[id * 3] = cr; triColors[id * 3 + 1] = cg; triColors[id * 3 + 2] = cb;
      }
    }
  }

  // --- positions: take first 3 props (xyz) per vertex regardless of numProp ---
  const np = mesh.numProp;
  let positions: Float32Array;
  if (np === 3) {
    positions = mesh.vertProperties;
  } else {
    positions = new Float32Array(mesh.numVert * 3);
    for (let v = 0; v < mesh.numVert; v++) {
      positions[v * 3] = mesh.vertProperties[v * np];
      positions[v * 3 + 1] = mesh.vertProperties[v * np + 1];
      positions[v * 3 + 2] = mesh.vertProperties[v * np + 2];
    }
  }

  // --- edge-length stats (sub-0.4mm edges ≈ unprintable / wasted detail) ---
  const edge = edgeStats(positions, mesh.triVerts, numTri);

  // --- stats from the live manifold ---
  let stats: PreviewStats;
  const labels = r.labelColors
    ? [...r.labelColors.keys()].map((name) => ({
        name,
        color: (r.labelColors!.get(name) || null) as number[] | null,
        triangleCount: r.labelMap?.get(name)?.size ?? 0,
      }))
    : [];

  if (renderOnly || !man) {
    stats = {
      isManifold: false, empty: false, componentCount: 1, triangleCount: numTri,
      vertexCount: mesh.numVert, volume: 0, surfaceArea: 0, genus: 0,
      bbox: null, aspectRatio: 0, minEdgeLength: edge.min, meanEdgeLength: edge.mean,
      components: [], labels, warnings: [], paramsSchema: r.paramsSchema, renderOnly: true,
      engine, voxelCount: r.voxelCount, voxelPieceCount: r.voxelPieceCount,
    };
    stats.warnings = buildWarnings(stats);
  } else {
    const empty = man.isEmpty();
    let bbox = null;
    try { const box = toBox(man.boundingBox()); bbox = { ...bb(box), center: box.min.map((m: number, i: number) => (m + box.max[i]) / 2) }; } catch { /* ignore */ }
    // per-component decomposition (capped)
    const components: PreviewComponent[] = [];
    let componentCount = 1;
    try {
      const parts: unknown[] = man.decompose();
      componentCount = parts.length;
      const ranked = parts
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .map((p: any, index: number) => ({ index, vol: safeNum(() => p.volume()), tri: safeNum(() => p.numTri()), box: safeBox(p) }))
        .sort((a, b) => b.vol - a.vol)
        .slice(0, 16);
      for (const p of ranked) {
        const box = p.box ? bb(p.box) : { min: [], max: [], size: [] };
        const center = box.min.length === 3 ? box.min.map((m, i) => (m + box.max[i]) / 2) : [];
        components.push({ index: p.index, triangleCount: p.tri, volume: p.vol, bbox: box, center });
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const p of parts) try { (p as any).delete(); } catch { /* exit cleans up */ }
    } catch { /* decompose unsupported */ }
    const sz = bbox?.size ?? [0, 0, 0];
    const dims = sz.filter((d) => d > 0);
    const aspectRatio = dims.length ? Math.max(...sz) / Math.min(...dims) : 0;
    stats = {
      isManifold: !empty,
      empty,
      componentCount,
      triangleCount: numTri,
      vertexCount: mesh.numVert,
      volume: safeNum(() => man.volume()),
      surfaceArea: safeNum(() => man.surfaceArea()),
      genus: safeNum(() => man.genus()),
      bbox,
      aspectRatio,
      minEdgeLength: edge.min,
      meanEdgeLength: edge.mean,
      components,
      labels,
      warnings: [],
      paramsSchema: r.paramsSchema,
      renderOnly: false,
      engine, voxelCount: r.voxelCount, voxelPieceCount: r.voxelPieceCount,
    };
    stats.warnings = buildWarnings(stats);
  }

  // Free the Manifold we built solely to compute stats (the live WASM object
  // isn't returned). manifold-js models hand back their own Manifold, which
  // the short-lived SSR process reclaims on exit, so only free ours.
  if (reconstructed && man && typeof man.delete === 'function') {
    try { man.delete(); } catch { /* exit cleans up */ }
  }

  return {
    ok: true,
    error: null,
    stats,
    render: { positions, triVerts: mesh.triVerts, triColors, bbox: stats.bbox ? { min: stats.bbox.min, max: stats.bbox.max } : null },
  };
}

function safeNum(fn: () => number): number {
  try { const v = fn(); return Number.isFinite(v) ? v : 0; } catch { return 0; }
}

// Min + mean triangle edge length, scanned over the whole mesh.
function edgeStats(positions: Float32Array, tri: Uint32Array, numTri: number): { min: number; mean: number } {
  let min = Infinity, sum = 0, n = 0;
  const d = (a: number, b: number) => Math.hypot(
    positions[a * 3] - positions[b * 3], positions[a * 3 + 1] - positions[b * 3 + 1], positions[a * 3 + 2] - positions[b * 3 + 2],
  );
  for (let t = 0; t < numTri; t++) {
    const a = tri[t * 3], b = tri[t * 3 + 1], c = tri[t * 3 + 2];
    for (const e of [d(a, b), d(b, c), d(c, a)]) { if (e < min) min = e; sum += e; n++; }
  }
  return { min: n ? +min.toFixed(4) : 0, mean: n ? +(sum / n).toFixed(4) : 0 };
}

// Cheap, actionable heuristics an AI can act on without re-deriving them.
function buildWarnings(s: PreviewStats): string[] {
  const w: string[] = [];
  if (s.renderOnly) w.push('Render-only mesh (no Manifold): volume/genus/watertight not measured — isManifold is unverified, not failed.');
  if (s.empty) w.push('Result is EMPTY — the returned shape has no volume.');
  if (!s.renderOnly && !s.isManifold && !s.empty) w.push('Not watertight / not a valid 2-manifold — a boolean likely failed (check overlap ≥0.5 units).');
  const distinctLabelColors = new Set(s.labels.filter((l) => l.color).map((l) => l.color!.join(','))).size;
  if (s.labels.length >= 2 && s.componentCount === 1) {
    w.push(`Declared ${s.labels.length} labels but componentCount=1 — for a print-in-place mechanism the parts are FUSED (increase the clearance gap, or check for collisions).`);
  }
  if (distinctLabelColors >= 2 && s.componentCount === 1) {
    w.push('Multiple colors but a single component — separate moving parts should report componentCount ≥ 2.');
  }
  // For voxel models the mesh componentCount over-reports pieces (an enclosed
  // cavity is a second component; edge/corner-only touches split), so the
  // face-connected voxelPieceCount is the trustworthy "one printable piece?"
  // number. Surface the distinction so the AI reads the right one and doesn't
  // chase a phantom "extra part", and use pieces (not componentCount) to gate
  // the clearance check below.
  const isVoxel = s.engine === 'voxel';
  if (isVoxel && typeof s.voxelPieceCount === 'number' && s.componentCount > s.voxelPieceCount) {
    w.push(`componentCount=${s.componentCount} counts enclosed cavities / edge-only touches, but this is ${s.voxelPieceCount} face-connected printable piece${s.voxelPieceCount === 1 ? '' : 's'} (voxelPieceCount). Trust voxelPieceCount for "is this one piece?".`);
  }
  // Clearance / unintended-fragmentation check: separate components whose
  // bounding boxes overlap are interpenetrating-but-not-fused. For an unlabeled
  // model meant to be ONE solid, that's a boolean that didn't take (insufficient
  // overlap); for an intentional multi-part / print-in-place assembly it's a cue
  // to sanity-check the clearance gap. Skipped for voxel models: their
  // decompose-based components over-report (an enclosed cavity nests inside the
  // shell's bbox), so the overlap signal is meaningless — voxelPieceCount above
  // is the right cue there. Gated to no-labels so it doesn't double up with the
  // FUSED-labels warning.
  if (!s.renderOnly && !s.empty && !isVoxel && s.componentCount >= 2 && s.labels.length === 0 && componentsOverlap(s.components)) {
    w.push(`componentCount=${s.componentCount} with overlapping component bounding boxes (top ${Math.min(s.componentCount, s.components.length)} by volume checked) — separate parts whose bounds overlap, so they may interpenetrate. If this should be ONE solid, a boolean didn't fuse (increase overlap ≥0.5 units); if it's an intentional multi-part / print-in-place assembly, verify the clearance gap. Inspect islands with model:preview --explain-components.`);
  }
  if (s.triangleCount > 200000) w.push(`High triangle count (${Math.round(s.triangleCount / 1000)}k) — exceeds the ~200k catalog budget; lower circular segments / nDivisions or feature density.`);
  if (s.aspectRatio > 12) w.push(`Extreme aspect ratio (${s.aspectRatio.toFixed(1)}:1) — tall/thin parts can be fragile or tip-droppy on FDM.`);
  if (s.minEdgeLength > 0 && s.minEdgeLength < 0.4) w.push(`Smallest edge ${s.minEdgeLength}mm (<0.4mm extrusion width) — sub-extrusion detail may vanish on the print.`);
  return w;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function safeBox(p: any): { min: number[]; max: number[] } | null {
  try { return toBox(p.boundingBox()); } catch { return null; }
}
