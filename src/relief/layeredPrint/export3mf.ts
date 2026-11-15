// Layered-print solve (HueForge-style) → Bambu Studio / Orca 3MF with filament changes at layer
// heights. One object (the heightmap), one plate, the slicer's layer heights
// and 100% infill set to match the plan.

import { build3MFProject, build3MFProjectAsync, type Build3MFProjectOptions, type LayerSwapPlan, type PartExport } from '../../export/threemfProject';
import type { BuiltExport } from '../../export/gltf';
import type { MeshData } from '../../geometry/types';
import type { LayeredPrintResult } from './solver';
import { layeredPrintMesh } from './mesh';
import { layeredPrintRecord, layeredPrintZRegions, planSwaps } from './plan';
import { snapTriColorsToFilaments } from './paintedExport';
import { LAYERED_PRINT_FILAMENT_LIBRARY, type LayeredPrintFilament } from './filamentLibrary';
import type { LayeredPrintPlanRecord } from '../types';

export type LayeredPrintSwapMode = LayerSwapPlan['swapMode'];

export function layeredPrintLayerPlan(r: LayeredPrintResult, swapMode: LayeredPrintSwapMode): LayerSwapPlan {
  return planToLayerSwapPlan(layeredPrintRecord(r), swapMode);
}

export function layeredPrintMeshData(r: LayeredPrintResult): MeshData {
  const m = layeredPrintMesh(r);
  return { vertProperties: m.vertProperties, triVerts: m.triVerts, numVert: m.numVert, numTri: m.numTri, numProp: m.numProp };
}

/** How the 3MF makes the colours:
 *  - `'layer-swap'` — the HueForge technique: one object, filament changes at
 *    layer heights; translucent layers blend (`swapMode` = AMS tool changes or
 *    manual pauses).
 *  - `'painted'` — each region printed in its own filament, coloured with the
 *    print's predicted look and reduced to `slots` AMS filaments. Needs an AMS;
 *    colours are direct (no reliance on TD values) at the cost of more swaps. */
export type LayeredExportMode = 'layer-swap' | 'painted';

export interface LayeredPrint3MFOptions {
  mode?: LayeredExportMode;
  swapMode?: LayeredPrintSwapMode;
  /** Painted mode: number of AMS filaments, 1..16 (default 8). */
  slots?: number;
  /** Painted mode: filaments to snap the colours to (default: the built-in
   *  list), or `'exact'` to keep the predicted shades as filament colours. */
  paintFilaments?: readonly LayeredPrintFilament[] | 'exact';
  /** Bambu printer id (see BAMBU_PRINTERS). */
  printer?: string;
  nozzle?: string;
  name?: string;
  /** Reuse an already-built mesh (e.g. the session's) instead of rebuilding. */
  mesh?: MeshData;
}

export interface LayeredPrintExport {
  built: BuiltExport;
  mode: LayeredExportMode;
  /** Filaments the file asks for, in slot order (layer-swap: bottom → top). */
  filaments: Array<{ name: string; hex: string; share?: number }>;
  /** Filament changes at layer heights (layer-swap mode; 0 for painted). */
  swaps: number;
}

/** Synchronous, uncompressed (ZIP STORE) build — see {@link buildLayeredPrint3MFAsync}. */
export function buildLayeredPrint3MF(r: LayeredPrintResult, opts: LayeredPrint3MFOptions = {}): LayeredPrintExport {
  return buildPlan3MF(layeredPrintRecord(r), opts.mesh ?? layeredPrintMeshData(r), opts);
}

/** {@link buildLayeredPrint3MF} with the 3MF DEFLATE-compressed (~4× smaller). */
export function buildLayeredPrint3MFAsync(r: LayeredPrintResult, opts: LayeredPrint3MFOptions = {}): Promise<LayeredPrintExport> {
  return buildPlan3MFAsync(layeredPrintRecord(r), opts.mesh ?? layeredPrintMeshData(r), opts);
}

/** The single export path for a layered print (dialog, editor, API, CLI).
 *  Layer-swap mode drops any per-triangle colours on `mesh` (the plan colours
 *  it); painted mode uses them when present (the editor's colours, incl. any
 *  labels/paint), else the plan's predicted colours by height.
 *  Synchronous and uncompressed — downloads use {@link buildPlan3MFAsync}. */
function buildPlan3MF(plan: LayeredPrintPlanRecord, mesh: MeshData, opts: LayeredPrint3MFOptions = {}): LayeredPrintExport {
  const job = planProject(plan, mesh, opts);
  return { ...job.result, built: build3MFProject(job.parts, job.projectOpts) };
}

/** {@link buildPlan3MF} with the 3MF DEFLATE-compressed (STORE fallback). */
export async function buildPlan3MFAsync(plan: LayeredPrintPlanRecord, mesh: MeshData, opts: LayeredPrint3MFOptions = {}): Promise<LayeredPrintExport> {
  const job = planProject(plan, mesh, opts);
  return { ...job.result, built: await build3MFProjectAsync(job.parts, job.projectOpts) };
}

/** What to hand the 3MF builder for a plan, plus the export summary. */
function planProject(plan: LayeredPrintPlanRecord, mesh: MeshData, opts: LayeredPrint3MFOptions): { parts: PartExport[]; projectOpts: Build3MFProjectOptions; result: Omit<LayeredPrintExport, 'built'> } {
  const name = opts.name ?? 'layered-print';
  const mode = opts.mode ?? 'layer-swap';
  const bare: MeshData = { vertProperties: mesh.vertProperties, triVerts: mesh.triVerts, numVert: mesh.numVert, numTri: mesh.numTri, numProp: mesh.numProp };
  if (mode === 'painted') {
    let source = mesh.triColors;
    if (!source || source.length !== mesh.numTri * 3) {
      source = new Uint8Array(mesh.numTri * 3);
      for (const g of layeredPrintZRegions(bare, plan)) {
        const r = Math.round(g.color[0] * 255), gg = Math.round(g.color[1] * 255), b = Math.round(g.color[2] * 255);
        for (const t of g.triangles) { source[t * 3] = r; source[t * 3 + 1] = gg; source[t * 3 + 2] = b; }
      }
    }
    const snapped = snapTriColorsToFilaments(source, mesh.numTri, opts.slots ?? 8, opts.paintFilaments ?? LAYERED_PRINT_FILAMENT_LIBRARY);
    return {
      parts: [{ name, mesh: { ...bare, triColors: snapped.triColors } }],
      projectOpts: { bambu: true, customName: name, printer: opts.printer, nozzle: opts.nozzle, filament: 'pla' },
      result: { mode, filaments: snapped.filaments, swaps: 0 },
    };
  }
  return {
    parts: [{ name, mesh: bare }],
    projectOpts: {
      bambu: true,
      customName: name,
      printer: opts.printer,
      nozzle: opts.nozzle,
      filament: 'pla',
      layerPlan: planToLayerSwapPlan(plan, opts.swapMode ?? 'ams'),
    },
    result: { mode, filaments: plan.blocks.map((b) => ({ name: b.name, hex: b.hex })), swaps: plan.blocks.length - 1 },
  };
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
