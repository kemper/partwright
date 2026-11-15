// Layered-print solve (HueForge-style) → Bambu Studio / Orca 3MF with filament changes at layer
// heights. One object (the heightmap), one plate, the slicer's layer heights
// and 100% infill set to match the plan.

import { build3MFProject, type LayerSwapPlan } from '../../export/threemfProject';
import type { BuiltExport } from '../../export/gltf';
import type { MeshData } from '../../geometry/types';
import type { LayeredPrintResult } from './solver';
import { layeredPrintMesh } from './mesh';
import { layeredPrintRecord, layeredPrintZRegions, planSwaps } from './plan';
import { snapTriColorsToFilaments } from './paintedExport';
import { photoTriColors, planSwapPlanesZ, stripeSideColors, type PhotoPixels } from './photoColors';
import { splitMeshAtZPlanes } from './zPlaneSplit';
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
 *  - `'painted'` — each region printed in its own filament, coloured from the
 *    photo (or the predicted look) and reduced to `slots` AMS filaments. Needs
 *    an AMS; colours are direct (no reliance on TD values) at the cost of more
 *    swaps. */
export type LayeredExportMode = 'layer-swap' | 'painted';

/** Painted mode: where each region's colour comes from.
 *  - `'photo'` — the source photo at that point (default): a painted print
 *    uses real filaments, so it can show hues the layer blend can't.
 *  - `'preview'` — the predicted layer-swap look (the viewport colours). */
export type LayeredPaintColors = 'photo' | 'preview';

/** Painted mode: how the side walls are coloured.
 *  - `'region'` — each side takes its region's colour (default).
 *  - `'layers'` — sides are cut at the swap heights and each band shows the
 *    filament printed there, like the layer stripes of a layer-swap print. */
export type LayeredPaintSides = 'region' | 'layers';

export interface LayeredPrint3MFOptions {
  mode?: LayeredExportMode;
  swapMode?: LayeredPrintSwapMode;
  /** Painted mode: number of AMS filaments, 1..16 (default 8). */
  slots?: number;
  /** Painted mode: filaments to snap the colours to (default: the built-in
   *  list), or `'exact'` to keep the predicted shades as filament colours. */
  paintFilaments?: readonly LayeredPrintFilament[] | 'exact';
  /** Painted mode: colour source (default `'photo'` when `photo` is given). */
  paintColors?: LayeredPaintColors;
  /** Painted mode: the source photo (RGBA, row 0 = top) for `paintColors: 'photo'`.
   *  Without it the export falls back to the preview colours. */
  photo?: PhotoPixels;
  /** Painted mode: side colouring (default `'region'`). */
  sides?: LayeredPaintSides;
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
  /** Painted mode: the colour source actually used (`'preview'` when photo
   *  colours were asked for but no photo was given or none of the model is
   *  inside the print's footprint). */
  paintColors?: LayeredPaintColors;
  /** Painted mode: the side colouring used. */
  sides?: LayeredPaintSides;
}

export function buildLayeredPrint3MF(r: LayeredPrintResult, opts: LayeredPrint3MFOptions = {}): LayeredPrintExport {
  return buildPlan3MF(layeredPrintRecord(r), opts.mesh ?? layeredPrintMeshData(r), opts);
}

/** The single export path for a layered print (dialog, editor, API, CLI).
 *  Layer-swap mode drops any per-triangle colours on `mesh` (the plan colours
 *  it). Painted mode starts from the mesh's colours when present (the
 *  editor's, incl. any labels/paint), else the plan's predicted colours by
 *  height; with `paintColors: 'photo'` the print's own triangles then take the
 *  photo's colour (anything outside the print keeps its colour), and with
 *  `sides: 'layers'` the sides are cut into bands at the swap heights. */
export function buildPlan3MF(plan: LayeredPrintPlanRecord, mesh: MeshData, opts: LayeredPrint3MFOptions = {}): LayeredPrintExport {
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
    let paintColors: LayeredPaintColors = 'preview';
    if ((opts.paintColors ?? 'photo') === 'photo' && opts.photo) {
      const p = photoTriColors(bare, plan, opts.photo, source);
      if (p.fromPhoto > 0) { source = p.triColors; paintColors = 'photo'; }
    }
    const sides = opts.sides ?? 'region';
    let out: MeshData = bare;
    if (sides === 'layers' && plan.blocks.length > 1) {
      let bedZ = Infinity;
      for (let v = 0; v < bare.numVert; v++) bedZ = Math.min(bedZ, bare.vertProperties[v * bare.numProp + 2]);
      const split = splitMeshAtZPlanes(mesh, planSwapPlanesZ(plan, bedZ));
      const inherited = new Uint8Array(split.mesh.numTri * 3);
      for (let t = 0; t < split.mesh.numTri; t++) {
        const s = split.parent[t] * 3;
        inherited[t * 3] = source[s]; inherited[t * 3 + 1] = source[s + 1]; inherited[t * 3 + 2] = source[s + 2];
      }
      out = split.mesh;
      source = stripeSideColors(out, plan, inherited).triColors;
    }
    const snapped = snapTriColorsToFilaments(source, out.numTri, opts.slots ?? 8, opts.paintFilaments ?? LAYERED_PRINT_FILAMENT_LIBRARY);
    const built = build3MFProject([{ name, mesh: { ...out, triColors: snapped.triColors } }], {
      bambu: true, customName: name, printer: opts.printer, nozzle: opts.nozzle, filament: 'pla',
    });
    return { built, mode, filaments: snapped.filaments, swaps: 0, paintColors, sides };
  }
  const built = build3MFProject([{ name, mesh: bare }], {
    bambu: true,
    customName: name,
    printer: opts.printer,
    nozzle: opts.nozzle,
    filament: 'pla',
    layerPlan: planToLayerSwapPlan(plan, opts.swapMode ?? 'ams'),
  });
  return { built, mode, filaments: plan.blocks.map((b) => ({ name: b.name, hex: b.hex })), swaps: plan.blocks.length - 1 };
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
