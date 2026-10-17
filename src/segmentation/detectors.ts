// Foundation detectors: `pieces` (connected components) and
// `crease-watershed` (seeded growth over the concave-crease field).
// Further algorithms register alongside these in `registry.ts`.

import { nearestTriangle } from './features';
import { growFromSeeds, vertexCostField, type GrowthRule } from './growth';
import type { DetectorResult, MeshFeatures, PartDetector, SegMesh, SegSeed } from './types';

export const piecesDetector: PartDetector = {
  id: 'pieces',
  name: 'Separate pieces',
  description: 'One part per physically separate solid (edge-connected component). Instant and exact, but finds nothing inside a single fused shell.',
  bestFor: 'Multi-body STLs (many multi-colour figure files ship one body per colour). Always worth trying first.',
  seeds: 'none',
  params: [],
  run(_mesh, f): DetectorResult {
    const partNames = Array.from({ length: f.pieceCount }, (_, i) => `piece ${i + 1}`);
    return { triPart: Int32Array.from(f.pieceOfTri), partNames, diagnostics: { pieceCount: f.pieceCount } };
  },
};

/** Group seeds by label (first appearance order) and resolve each to a
 *  triangle. Seeds whose label is empty are dropped. */
export function resolveSeeds(
  f: MeshFeatures,
  seeds: SegSeed[],
  allow?: Uint8Array,
): { names: string[]; seedTris: Int32Array; seedLabels: Int32Array } {
  const names: string[] = [];
  const index = new Map<string, number>();
  const tris: number[] = [];
  const labels: number[] = [];
  for (const s of seeds) {
    const name = s.label.trim();
    if (!name) continue;
    let li = index.get(name);
    if (li === undefined) { li = names.length; names.push(name); index.set(name, li); }
    let t = typeof s.triangle === 'number' && s.triangle >= 0 && s.triangle < f.triCount ? s.triangle : -1;
    if (t < 0 || (allow && !allow[t])) t = nearestTriangle(f, s.point, allow ? (x) => allow[x] === 1 : undefined);
    if (t < 0) continue;
    tris.push(t);
    labels.push(li);
  }
  return { names, seedTris: Int32Array.from(tris), seedLabels: Int32Array.from(labels) };
}

export const creaseWatershedDetector: PartDetector = {
  id: 'crease-watershed',
  name: 'Crease watershed (seeded)',
  description: 'Grows named seeds across the surface; boundaries settle on the strongest concave grooves between competing seeds, so small gaps in a groove do not leak. You supply the meaning (one or more seeds per part), the algorithm supplies the exact edges.',
  bestFor: 'Fused figurines and sculpts whose colour regions are separated by sculpted grooves (hairlines, eyes, hems, cuffs).',
  seeds: 'required',
  params: [
    {
      key: 'growth', label: 'Growth rule', type: 'enum', default: 'hybrid', options: ['hybrid', 'minimax', 'summed'],
      hint: 'hybrid: grooves decide, path length breaks ties (recommended). minimax: grooves only. summed: path length + crease toll (smooth splits on flat areas, but small enclosed seeds can leak).',
    },
    {
      key: 'creaseQuantumDeg', label: 'Crease step (°)', type: 'number', default: 5, min: 0.5, max: 45, step: 0.5,
      hint: 'Hybrid only: creases within this many degrees count as equal, so path length decides between them. Raise it to ignore faint grooves.',
    },
    {
      key: 'creaseWeight', label: 'Crease toll', type: 'number', default: 1, min: 0, max: 20, step: 0.1,
      hint: 'Path-length cost of crossing one degree of crease, in median edge lengths. Higher = boundaries cling harder to grooves.',
    },
  ],
  run(mesh: SegMesh, f: MeshFeatures, ctx): DetectorResult {
    const { names, seedTris, seedLabels } = resolveSeeds(f, ctx.seeds);
    if (names.length === 0) throw new Error('crease-watershed needs at least one seed ({ label, point }).');
    const g = growFromSeeds(f, seedTris, seedLabels, {
      growth: ctx.params.growth as GrowthRule,
      creaseQuantumDeg: Number(ctx.params.creaseQuantumDeg),
      creaseWeight: Number(ctx.params.creaseWeight),
      signal: ctx.signal,
      progress: ctx.progress,
    });
    let unreached = 0;
    for (let t = 0; t < f.triCount; t++) if (g.triLabel[t] < 0) unreached++;
    return {
      triPart: g.triLabel,
      partNames: names,
      vertexCosts: vertexCostField(mesh.triVerts, mesh.positions.length / 3, g.triLabel, g.cost),
      diagnostics: { seedCount: seedTris.length, unreachedTriangles: unreached },
    };
  },
};
