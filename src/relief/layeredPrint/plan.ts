// layered-print plan record helpers: the small, persistable form of a solve
// (filament blocks + layer heights), the 3MF layer-swap plan derived from it,
// swap text, and viewport colouring of a heightmap mesh by predicted colour.
// Pure — shared by the browser API, the export, and the unit tests.

import type { MeshData } from '../../geometry/types';
import type { LayeredPrintPlanRecord } from '../types';
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

/** Colour a mesh the way a single-nozzle print with this plan's swaps comes
 *  out, measured from the mesh's own bottom (the bed): every up- or side-facing
 *  triangle gets the composited colour seen at its highest point (so sides
 *  read as their region's colour, not as slivers of mid-stack filaments); the
 *  underside gets the base filament. Works for the
 *  whole model — a frame or text added around the print is coloured by the
 *  filament that is loaded at its height, as it would print. Grouped by colour. */
export function layeredPrintZRegions(mesh: MeshData, p: LayeredPrintPlanRecord): Array<{ name: string; color: [number, number, number]; triangles: Set<number> }> {
  const spec = specOf(p);
  const blocks = p.blocks.map((b) => ({ filament: { name: b.name, hex: b.hex, td: b.td }, startLayer: b.startLayer }));
  const vp = mesh.vertProperties, tv = mesh.triVerts, np = mesh.numProp;
  let minZ = Infinity, maxZ = -Infinity;
  for (let v = 0; v < mesh.numVert; v++) { const z = vp[v * np + 2]; if (z < minZ) minZ = z; if (z > maxZ) maxZ = z; }
  if (!Number.isFinite(minZ)) return [];
  // Layers the mesh spans (a composed model can be taller than the print),
  // capped so a very tall model can't allocate an enormous colour ladder.
  const MAX_COLOUR_LAYERS = 4000;
  const L = Math.min(MAX_COLOUR_LAYERS, Math.max(p.totalLayers, Math.ceil((maxZ - minZ - spec.firstLayerHeight) / spec.layerHeight) + 1, 1));
  const ladder = computeLadder(blocks, L, spec);
  const filCols = p.blocks.map((b) => hexToRgb01(b.hex));
  const layerOfZ = (z: number) => Math.max(0, Math.min(L - 1, Math.round((z - minZ - spec.firstLayerHeight) / spec.layerHeight)));
  const groups = new Map<string, { name: string; color: [number, number, number]; triangles: Set<number> }>();
  const add = (key: string, name: string, color: [number, number, number], t: number) => {
    let g = groups.get(key);
    if (!g) { g = { name, color, triangles: new Set() }; groups.set(key, g); }
    g.triangles.add(t);
  };
  for (let t = 0; t < mesh.numTri; t++) {
    const a = tv[t * 3] * np, b = tv[t * 3 + 1] * np, c = tv[t * 3 + 2] * np;
    const e1x = vp[b] - vp[a], e1y = vp[b + 1] - vp[a + 1], e1z = vp[b + 2] - vp[a + 2];
    const e2x = vp[c] - vp[a], e2y = vp[c + 1] - vp[a + 1], e2z = vp[c + 2] - vp[a + 2];
    const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
    const up = nz / (Math.hypot(nx, ny, nz) || 1);
    if (up < -0.5) {
      add('f0', `layered print: ${p.blocks[0].name}`, filCols[0], t);
    } else {
      // Tops AND sides take the colour seen at the triangle's highest point.
      // A steep side of the heightmap is a long thin triangle spanning many
      // layers; colouring it by its mid-height filament gave saw-tooth slivers
      // of whichever filament sits mid-stack (and a zig-zag base strip). Taking
      // the top colour makes each region read as one colour down its sides.
      const k = layerOfZ(Math.max(vp[a + 2], vp[b + 2], vp[c + 2]));
      add(`L${k}`, `layered print: layer ${k + 1}`, [ladder[k * 3], ladder[k * 3 + 1], ladder[k * 3 + 2]], t);
    }
  }
  return [...groups.values()];
}
