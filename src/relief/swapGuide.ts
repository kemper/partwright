// Turn the per-layer colour bands (heightBands.ts) into a single-nozzle filament
// swap guide: load a base filament at layer 0, then swap at each band boundary
// where the colour changes. Because painting is free per-region, this is a
// best-effort approximation; per-band confidence and an overall printability
// score flag where a single nozzle can't reproduce the painting.

import type { MeshData } from '../geometry/types';
import type { ColorRegion } from '../color/regions';
import type { Filament, HeightBand, SwapGuide, SwapInstruction } from './types';
import { analyzeHeightBands } from './heightBands';

type RGB = [number, number, number];

// Max RGB Euclidean distance (channels 0..1) for a band colour to claim a
// library filament's name. ~0.18 ≈ a perceptibly close match without forcing
// distant colours onto an unrelated filament.
const FILAMENT_MATCH_THRESHOLD = 0.18;

// Bands below this confidence get a horizontal-variation warning.
const CONFIDENCE_WARN = 0.9;

function hexToRgb(hex: string): RGB | null {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function colorDistance(a: RGB, b: RGB): number {
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

/** Nearest filament name within the match threshold, or undefined. */
function matchFilament(color: RGB, filaments: readonly Filament[] | undefined): string | undefined {
  if (!filaments || filaments.length === 0) return undefined;
  let bestName: string | undefined;
  let bestDist = Infinity;
  for (const f of filaments) {
    const rgb = hexToRgb(f.hex);
    if (!rgb) continue;
    const d = colorDistance(color, rgb);
    if (d < bestDist) {
      bestDist = d;
      bestName = f.name;
    }
  }
  return bestDist <= FILAMENT_MATCH_THRESHOLD ? bestName : undefined;
}

function sameColor(a: RGB, b: RGB): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

/**
 * Build a single-nozzle swap guide from a painted relief. The first band's
 * colour is the base (loaded at layer 0); each later band whose colour differs
 * from the previous one becomes a swap instruction. `printability` is the
 * area-weighted mean band confidence; `warnings` flag low-confidence bands
 * where horizontal colour variation can't be reproduced by one nozzle.
 */
export function buildSwapGuide(
  mesh: MeshData,
  regions: readonly ColorRegion[],
  layerHeight: number,
  filaments?: readonly Filament[],
): SwapGuide {
  const bands = analyzeHeightBands(mesh, regions, layerHeight);

  const swaps: SwapInstruction[] = [];
  const warnings: string[] = [];

  let prevColor: RGB | null = null;
  for (const band of bands) {
    if (prevColor === null) {
      prevColor = band.color;
    } else if (!sameColor(band.color, prevColor)) {
      const instruction: SwapInstruction = {
        atLayer: band.layerStart,
        atZ: band.zStart,
        color: band.color,
      };
      const name = matchFilament(band.color, filaments);
      if (name) instruction.filamentName = name;
      swaps.push(instruction);
      prevColor = band.color;
    }

    if (band.confidence < CONFIDENCE_WARN) {
      warnings.push(
        `Layers ${band.layerStart}–${band.layerEnd} mix colors at the same height; ` +
          `a single nozzle can't reproduce this — use AMS or constrain paint to Z-slabs.`,
      );
    }
  }

  let totalLayers = 0;
  for (const band of bands) {
    if (band.layerEnd > totalLayers) totalLayers = band.layerEnd;
  }

  const printability = areaWeightedConfidence(bands);

  return {
    layerHeight,
    totalLayers,
    totalHeight: totalLayers * layerHeight,
    swaps,
    bands,
    printability,
    warnings,
  };
}

/** Area-weighted mean of band confidence, weighting each band by its layer
 *  span (a proxy for printed extent). Falls back to a plain mean, then 1. */
function areaWeightedConfidence(bands: readonly HeightBand[]): number {
  if (bands.length === 0) return 1;
  let weightSum = 0;
  let acc = 0;
  for (const band of bands) {
    const w = Math.max(0, band.layerEnd - band.layerStart);
    weightSum += w;
    acc += band.confidence * w;
  }
  if (weightSum > 0) return acc / weightSum;
  let mean = 0;
  for (const band of bands) mean += band.confidence;
  return mean / bands.length;
}

/** Convert a 0..1 RGB triple to a `#rrggbb` hex string. */
export function rgbToHex([r, g, b]: RGB): string {
  const h = (v: number) =>
    Math.min(255, Math.max(0, Math.round(v * 255)))
      .toString(16)
      .padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

/** Render a swap guide as a clean, copy-pasteable plain-text summary. */
export function swapGuideToText(guide: SwapGuide): string {
  const lines: string[] = [];
  lines.push('Single-Nozzle Filament Swap Guide');
  lines.push('=================================');

  const base = guide.bands[0];
  if (base) {
    lines.push(`Base color (load at layer 0): ${rgbToHex(base.color)}`);
  } else {
    lines.push('Base color (load at layer 0): (none — empty relief)');
  }
  lines.push('');

  if (guide.swaps.length === 0) {
    lines.push('Swaps: none — single color throughout.');
  } else {
    lines.push(`Swaps (${guide.swaps.length}):`);
    guide.swaps.forEach((swap, i) => {
      const filament = swap.filamentName ? ` — ${swap.filamentName}` : '';
      lines.push(
        `  ${i + 1}. At layer ${swap.atLayer} (Z=${swap.atZ.toFixed(2)} mm): ` +
          `${rgbToHex(swap.color)}${filament}`,
      );
    });
  }
  lines.push('');

  lines.push(`Total layers: ${guide.totalLayers}`);
  lines.push(`Total height: ${guide.totalHeight.toFixed(2)} mm`);
  lines.push(`Printability: ${Math.round(guide.printability * 100)}%`);

  if (guide.warnings.length > 0) {
    lines.push('');
    lines.push('Warnings:');
    for (const w of guide.warnings) lines.push(`  - ${w}`);
  }

  return lines.join('\n');
}
