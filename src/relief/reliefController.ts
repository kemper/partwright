// Glue between the painted relief mesh and the optical preview / swap guide.
// Pure-ish: reads the global color regions + filament library and runs the
// analysis modules. No DOM, no main.ts imports (so no import cycle).

import type { MeshData } from '../geometry/types';
import type { PreviewMode, SwapGuide } from './types';
import { getRegions } from '../color/regions';
import { analyzeHeightBands } from './heightBands';
import { buildSwapGuide } from './swapGuide';
import { buildPreviewTriColors } from './opticalPreview';
import { listFilaments } from './filaments';

let previewMode: PreviewMode = 'flat';

export function getPreviewMode(): PreviewMode {
  return previewMode;
}

export function setPreviewMode(mode: PreviewMode): void {
  previewMode = mode;
}

export function isPreviewActive(): boolean {
  return previewMode !== 'flat';
}

/** triColors for the active preview mode, or null when 'flat' — the caller
 *  should then fall back to the normal region-color path (applyTriColors). */
export function computeReliefTriColors(mesh: MeshData, layerHeight: number): Uint8Array | null {
  if (previewMode === 'flat') return null;
  const regions = getRegions();
  const filaments = listFilaments();
  const bands = analyzeHeightBands(mesh, regions, layerHeight);
  return buildPreviewTriColors(mesh, regions, bands, filaments, previewMode, layerHeight);
}

export function getSwapGuideFor(mesh: MeshData, layerHeight: number): SwapGuide {
  return buildSwapGuide(mesh, getRegions(), layerHeight, listFilaments());
}
