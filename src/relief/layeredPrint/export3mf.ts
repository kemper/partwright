// Layered-print solve (HueForge-style) → Bambu Studio / Orca 3MF with filament changes at layer
// heights. One object (the heightmap), one plate, the slicer's layer heights
// and 100% infill set to match the plan.

import { build3MFProject, type LayerSwapPlan } from '../../export/threemfProject';
import type { BuiltExport } from '../../export/gltf';
import type { MeshData } from '../../geometry/types';
import type { LayeredPrintResult } from './solver';
import { layeredPrintMesh } from './mesh';
import { layeredPrintRecord, planSwaps } from './plan';
import type { LayeredPrintPlanRecord } from '../types';

export type LayeredPrintSwapMode = LayerSwapPlan['swapMode'];

export function layeredPrintLayerPlan(r: LayeredPrintResult, swapMode: LayeredPrintSwapMode): LayerSwapPlan {
  return planToLayerSwapPlan(layeredPrintRecord(r), swapMode);
}

export function layeredPrintMeshData(r: LayeredPrintResult): MeshData {
  const m = layeredPrintMesh(r);
  return { vertProperties: m.vertProperties, triVerts: m.triVerts, numVert: m.numVert, numTri: m.numTri, numProp: m.numProp };
}

export interface LayeredPrint3MFOptions {
  swapMode?: LayeredPrintSwapMode;
  /** Bambu printer id (see BAMBU_PRINTERS). */
  printer?: string;
  nozzle?: string;
  name?: string;
  /** Reuse an already-built mesh (e.g. the session's) instead of rebuilding. */
  mesh?: MeshData;
}

export function buildLayeredPrint3MF(r: LayeredPrintResult, opts: LayeredPrint3MFOptions = {}): BuiltExport {
  return buildPlan3MF(layeredPrintRecord(r), opts.mesh ?? layeredPrintMeshData(r), opts);
}

/** Same, from a persisted plan record + the session's heightmap mesh. Any
 *  per-triangle colours on `mesh` are dropped (the layer plan colours it). */
export function buildPlan3MF(plan: LayeredPrintPlanRecord, mesh: MeshData, opts: LayeredPrint3MFOptions = {}): BuiltExport {
  const name = opts.name ?? 'layered-print';
  const bare: MeshData = { vertProperties: mesh.vertProperties, triVerts: mesh.triVerts, numVert: mesh.numVert, numTri: mesh.numTri, numProp: mesh.numProp };
  return build3MFProject([{ name, mesh: bare }], {
    bambu: true,
    customName: name,
    printer: opts.printer,
    nozzle: opts.nozzle,
    filament: 'pla',
    layerPlan: planToLayerSwapPlan(plan, opts.swapMode ?? 'ams'),
  });
}

function planToLayerSwapPlan(p: LayeredPrintPlanRecord, swapMode: LayerSwapPlan['swapMode']): LayerSwapPlan {
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
