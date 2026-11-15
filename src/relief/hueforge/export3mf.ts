// HueForge solve → Bambu Studio / Orca 3MF with filament changes at layer
// heights. One object (the heightmap), one plate, the slicer's layer heights
// and 100% infill set to match the plan.

import { build3MFProject, type LayerSwapPlan } from '../../export/threemfProject';
import type { BuiltExport } from '../../export/gltf';
import type { MeshData } from '../../geometry/types';
import type { HueforgeResult } from './solver';
import { hueforgeMesh } from './mesh';
import { hueforgeRecord, planToLayerSwapPlan } from './plan';
import type { HueforgePlanRecord } from '../types';

export type HueforgeSwapMode = LayerSwapPlan['swapMode'];

export function hueforgeLayerPlan(r: HueforgeResult, swapMode: HueforgeSwapMode): LayerSwapPlan {
  return planToLayerSwapPlan(hueforgeRecord(r), swapMode);
}

export function hueforgeMeshData(r: HueforgeResult): MeshData {
  const m = hueforgeMesh(r);
  return { vertProperties: m.vertProperties, triVerts: m.triVerts, numVert: m.numVert, numTri: m.numTri, numProp: m.numProp };
}

export interface Hueforge3MFOptions {
  swapMode?: HueforgeSwapMode;
  /** Bambu printer id (see BAMBU_PRINTERS). */
  printer?: string;
  nozzle?: string;
  name?: string;
  /** Reuse an already-built mesh (e.g. the session's) instead of rebuilding. */
  mesh?: MeshData;
}

export function buildHueforge3MF(r: HueforgeResult, opts: Hueforge3MFOptions = {}): BuiltExport {
  return buildPlan3MF(hueforgeRecord(r), opts.mesh ?? hueforgeMeshData(r), opts);
}

/** Same, from a persisted plan record + the session's heightmap mesh. Any
 *  per-triangle colours on `mesh` are dropped (the layer plan colours it). */
export function buildPlan3MF(plan: HueforgePlanRecord, mesh: MeshData, opts: Hueforge3MFOptions = {}): BuiltExport {
  const name = opts.name ?? 'hueforge';
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
