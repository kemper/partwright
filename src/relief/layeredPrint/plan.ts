// layered-print plan record helpers: the small, persistable form of a solve
// (filament blocks + layer heights), the 3MF layer-swap plan derived from it,
// swap text, and viewport colouring of a heightmap mesh by predicted colour.
// Pure — shared by the browser API, the export, and the unit tests.

import type { MeshData } from '../../geometry/types';
import type { LayeredPrintPlanRecord, SeedRegion } from '../types';
import type { LayerSwapPlan } from '../../export/threemfProject';
import type { LayeredPrintResult } from './solver';
import { computeLadder, hexToRgb01, layerTop, type LayerSpec } from './optics';

export function layeredPrintRecord(r: LayeredPrintResult): LayeredPrintPlanRecord {
  return {
    blocks: r.blocks.map((b) => ({ name: b.filament.name, hex: b.filament.hex, td: b.filament.td, startLayer: b.startLayer })),
    layerHeight: r.options.layerHeight,
    firstLayerHeight: r.options.firstLayerHeight,
    totalLayers: r.totalLayers,
    totalHeightMm: r.totalHeightMm,
    widthMm: Math.round(r.widthMm * 10) / 10,
    depthMm: Math.round(r.depthMm * 10) / 10,
    meanDeltaE: Math.round(r.meanDeltaE * 10) / 10,
  };
}

function specOf(p: LayeredPrintPlanRecord): LayerSpec {
  return { firstLayerHeight: p.firstLayerHeight, layerHeight: p.layerHeight };
}

/** The swaps of a plan, in slicer terms (1-based layer, print_z). */
export function planSwaps(p: LayeredPrintPlanRecord): Array<{ layer: number; z: number; name: string; hex: string; td: number }> {
  const spec = specOf(p);
  return p.blocks.slice(1).map((b) => ({ layer: b.startLayer + 1, z: Math.round(layerTop(b.startLayer, spec) * 1000) / 1000, name: b.name, hex: b.hex, td: b.td }));
}

export function planToLayerSwapPlan(p: LayeredPrintPlanRecord, swapMode: LayerSwapPlan['swapMode']): LayerSwapPlan {
  return {
    filamentColors: p.blocks.map((b) => b.hex),
    filamentNames: p.blocks.map((b) => b.name),
    changes: planSwaps(p).map((s, i) => ({ z: s.z, filament: i + 2 })),
    layerHeight: p.layerHeight,
    firstLayerHeight: p.firstLayerHeight,
    swapMode,
    infillDensity: '100%',
  };
}

/** Why `mesh` no longer matches the plan (the model was edited, scaled, or
 *  another object is open), or null when it does. The swap heights only make
 *  sense on the heightmap they were solved for. */
export function planMeshMismatch(p: LayeredPrintPlanRecord, mesh: MeshData): string | null {
  const vp = mesh.vertProperties, np = mesh.numProp;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let v = 0; v < mesh.numVert; v++) {
    const x = vp[v * np], y = vp[v * np + 1], z = vp[v * np + 2];
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
    if (z < z0) z0 = z; if (z > z1) z1 = z;
  }
  const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;
  const h = z1 - z0, w = x1 - x0, d = y1 - y0;
  if (!near(h, p.totalHeightMm, p.layerHeight / 2) || !near(w, p.widthMm, 0.5 + 0.01 * p.widthMm) || !near(d, p.depthMm, 0.5 + 0.01 * p.depthMm)) {
    return `the open model (${w.toFixed(1)} × ${d.toFixed(1)} × ${h.toFixed(2)} mm) no longer matches the solved plan (${p.widthMm} × ${p.depthMm} × ${p.totalHeightMm} mm), so the swap heights would land on the wrong layers. Re-create the layered print, or load the version it made.`;
  }
  return null;
}

/** Human swap instructions for a plan record. */
export function planSwapText(p: LayeredPrintPlanRecord): string {
  const lines = [
    `HueForge-style print — ${p.blocks.length} filaments, ${p.totalLayers} layers, ${p.totalHeightMm} mm tall, ${p.widthMm} × ${p.depthMm} mm`,
    `Slicer: layer height ${p.layerHeight} mm, first layer ${p.firstLayerHeight} mm, 100% infill, print flat (face up).`,
    '',
    `Start with: ${p.blocks[0].name} (${p.blocks[0].hex}, TD ${p.blocks[0].td})`,
    ...planSwaps(p).map((s) => `At layer ${s.layer} (Z ${s.z.toFixed(2)} mm): swap to ${s.name} (${s.hex}, TD ${s.td})`),
    '',
    `Predicted mean colour error: ΔE ${p.meanDeltaE}`,
    ...(p.blocks.length > 4 ? ['', `Note: ${p.blocks.length} filaments needs ${p.blocks.length} AMS slots for automatic changes (one AMS holds 4) — or use manual swaps.`] : []),
  ];
  return lines.join('\n');
}

/** Paint a layered-print heightmap mesh with what the print should look like:
 *  up-facing triangles get the composited colour of the layer they sit at;
 *  walls get the plain filament printed at that height (what the edge of the
 *  real print shows); the underside gets the base filament. Regions are
 *  grouped by colour (one per visible layer shade). */
export function layeredPrintSeedRegions(mesh: MeshData, p: LayeredPrintPlanRecord): SeedRegion[] {
  const spec = specOf(p);
  const L = Math.max(1, p.totalLayers);
  const blocks = p.blocks.map((b) => ({ filament: { name: b.name, hex: b.hex, td: b.td }, startLayer: b.startLayer }));
  const ladder = computeLadder(blocks, L, spec);
  const filCols = p.blocks.map((b) => hexToRgb01(b.hex));
  const blockAtLayer = (k: number) => { let bi = 0; for (let j = 0; j < blocks.length; j++) if (blocks[j].startLayer <= k) bi = j; return bi; };
  const layerOfZ = (z: number) => Math.max(0, Math.min(L - 1, Math.round((z - spec.firstLayerHeight) / spec.layerHeight)));
  const groups = new Map<string, SeedRegion>();
  const add = (key: string, name: string, color: [number, number, number], t: number) => {
    let g = groups.get(key);
    if (!g) { g = { name, color, triangleIds: [] }; groups.set(key, g); }
    g.triangleIds.push(t);
  };
  const vp = mesh.vertProperties, tv = mesh.triVerts, np = mesh.numProp;
  for (let t = 0; t < mesh.numTri; t++) {
    const a = tv[t * 3] * np, b = tv[t * 3 + 1] * np, c = tv[t * 3 + 2] * np;
    const e1x = vp[b] - vp[a], e1y = vp[b + 1] - vp[a + 1], e1z = vp[b + 2] - vp[a + 2];
    const e2x = vp[c] - vp[a], e2y = vp[c + 1] - vp[a + 1], e2z = vp[c + 2] - vp[a + 2];
    const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
    const len = Math.hypot(nx, ny, nz) || 1;
    const up = nz / len;
    const cz = (vp[a + 2] + vp[b + 2] + vp[c + 2]) / 3;
    if (up < -0.5) {
      add('f0', p.blocks[0].name, filCols[0], t);
    } else if (up > 0.2) {
      const k = layerOfZ(Math.max(vp[a + 2], vp[b + 2], vp[c + 2]));
      add(`L${k}`, `layer ${k + 1}`, [ladder[k * 3], ladder[k * 3 + 1], ladder[k * 3 + 2]], t);
    } else {
      const bi = blockAtLayer(layerOfZ(cz));
      add(`f${bi}`, p.blocks[bi].name, filCols[bi], t);
    }
  }
  return [...groups.values()];
}
