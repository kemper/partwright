// A layered photo print (`api.layeredPrint`) in the print preview's terms.
//
// The layered-print solver records a swap plan: filament blocks, each starting
// at a layer. The print preview draws bands of layers. This module turns the
// one into the other, so the preview's layer slider, cut and blending work on a
// layered print exactly as they do on `api.print.layerColors`.
//
// For the blending view it hands over the solver's OWN predicted colours (its
// ladder), not the preview's generic estimate: the model was solved against
// that prediction, so that is the picture to show.
//
// Pure: unit-tested in tests/unit/layeredPlanBands.test.ts.

import type { LayeredPrintPlanRecord } from '../relief/types';
import { computeLadder } from '../relief/layeredPrint/optics';
import { layerBottomZ, layerCount, resolveLayerBands, rgbToHex, type LayerBand, type LayerColorChange, type LayerProfile } from './layerColors';

/** "#rgb" / "RRGGBB" / "#RRGGBB" → "#rrggbb"; anything else → mid grey. */
function planHex(hex: string): string {
  const h = hex.trim().replace(/^#/, '').toLowerCase();
  if (/^[0-9a-f]{6}$/.test(h)) return `#${h}`;
  if (/^[0-9a-f]{3}$/.test(h)) return `#${h.split('').map((c) => c + c).join('')}`;
  return '#808080';
}

export interface LayeredPlanPreview {
  profile: LayerProfile;
  /** The plan as colour changes by height (the first is the base, at 0 mm). */
  changes: LayerColorChange[];
  /** Filament name of each change, in the same order. */
  names: string[];
  /** The bands that print on a model `modelHeight` mm tall. A model taller
   *  than the plan (a frame or text added around it) keeps printing in the
   *  last filament, as it would on the printer. */
  bands: LayerBand[];
  /** The solver's predicted colour on top of 0-based `layer`, as "#rrggbb". */
  colorOnTopOf: (layer: number) => string;
  /** Layers the prediction covers: every one of them can change the shade seen from above. */
  layers: number;
}

export function layeredPlanPreview(plan: LayeredPrintPlanRecord, modelHeight: number): LayeredPlanPreview {
  const profile: LayerProfile = { layerHeight: plan.layerHeight, firstLayerHeight: plan.firstLayerHeight };
  const blocks = [...plan.blocks].sort((a, b) => a.startLayer - b.startLayer);
  const changes = blocks.map((b, i) => ({ z: i === 0 ? 0 : layerBottomZ(b.startLayer, profile), color: planHex(b.hex) }));
  const names = blocks.map((b) => b.name);
  const base = changes[0]?.color ?? '#808080';
  const bands = resolveLayerBands(base, changes.slice(1), modelHeight, profile);

  const layers = Math.max(1, layerCount(modelHeight, profile), plan.totalLayers);
  let ladder: Float32Array | null = null;
  const colorOnTopOf = (layer: number): string => {
    // Worked out on first use: the opaque view never needs it.
    ladder ??= computeLadder(blocks.map((b) => ({ filament: { name: b.name, hex: b.hex, td: b.td }, startLayer: b.startLayer })), layers, profile);
    const k = Math.max(0, Math.min(layers - 1, layer)) * 3;
    return rgbToHex([ladder[k] * 255, ladder[k + 1] * 255, ladder[k + 2] * 255]);
  };
  return { profile, changes, names, bands, colorOnTopOf, layers };
}
