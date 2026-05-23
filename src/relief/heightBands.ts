// Derive per-print-layer dominant surface colors from a painted relief mesh.
//
// A relief is painted freely with the ColorRegion system (which suits AMS /
// multi-material printers). For a single-nozzle printer we approximate the
// painting as a stack of horizontal colour bands — see swapGuide.ts. This
// module does the geometric tally: which colour dominates the upward-facing
// surface in each print layer, and how cleanly (confidence) a single filament
// reproduces it.

import type { MeshData } from '../geometry/types';
import type { ColorRegion } from '../color/regions';
import type { HeightBand } from './types';

type RGB = [number, number, number];

// 5-bit-per-channel quantization groups near-identical paint into one bucket so
// minor anti-alias/gradient noise doesn't fragment a band. Channels collapse to
// 32 levels (step 8 in 0..255) and pack into a single 15-bit integer key.
const QUANT_SHIFT = 3;

function quantKey(r: number, g: number, b: number): number {
  const qr = Math.min(255, Math.round(r * 255)) >> QUANT_SHIFT;
  const qg = Math.min(255, Math.round(g * 255)) >> QUANT_SHIFT;
  const qb = Math.min(255, Math.round(b * 255)) >> QUANT_SHIFT;
  return (qr << 10) | (qg << 5) | qb;
}

/** Resolve every triangle's painted colour index in one pass over the regions
 *  (higher `order` wins; `visible:false` ignored), mirroring buildTriColors.
 *  Returns -1 for unpainted triangles. `palette` holds the source colours. */
function resolveTriColors(
  numTri: number,
  regions: readonly ColorRegion[],
): { triRegion: Int32Array; palette: RGB[] } {
  const triRegion = new Int32Array(numTri).fill(-1);
  const triOrder = new Float64Array(numTri); // 0 = unpainted (orders are >= 1)
  const palette: RGB[] = [];

  const sorted = [...regions].filter(r => r.visible).sort((a, b) => a.order - b.order);
  for (const region of sorted) {
    const idx = palette.length;
    palette.push(region.color);
    for (const tri of region.triangles) {
      if (tri >= 0 && tri < numTri && region.order >= triOrder[tri]) {
        triRegion[tri] = idx;
        triOrder[tri] = region.order;
      }
    }
  }
  return { triRegion, palette };
}

interface TriGeom {
  cz: number; // centroid Z
  area: number; // world-space area
  up: boolean; // upward-facing
}

/** Single pass: centroid Z, area, and upward-facing flag per triangle. */
function computeTriGeom(mesh: MeshData, upDotMin: number): TriGeom[] {
  const { vertProperties, triVerts, numTri, numProp } = mesh;
  const out: TriGeom[] = new Array(numTri);

  for (let t = 0; t < numTri; t++) {
    const i0 = triVerts[t * 3] * numProp;
    const i1 = triVerts[t * 3 + 1] * numProp;
    const i2 = triVerts[t * 3 + 2] * numProp;

    const ax = vertProperties[i0], ay = vertProperties[i0 + 1], az = vertProperties[i0 + 2];
    const bx = vertProperties[i1], by = vertProperties[i1 + 1], bz = vertProperties[i1 + 2];
    const cx = vertProperties[i2], cy = vertProperties[i2 + 1], cz = vertProperties[i2 + 2];

    const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
    const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;

    // Cross product = 2 * area * unit-normal.
    const nx = e1y * e2z - e1z * e2y;
    const ny = e1z * e2x - e1x * e2z;
    const nz = e1x * e2y - e1y * e2x;
    const cross = Math.sqrt(nx * nx + ny * ny + nz * nz);

    out[t] = {
      cz: (az + bz + cz) / 3,
      area: cross / 2,
      up: cross > 0 && nz / cross > upDotMin,
    };
  }
  return out;
}

/** Pick the dominant quantized colour from an area-by-color tally. Returns the
 *  representative RGB, its area, and the total area tallied. */
function dominant(
  areaByColor: Map<number, number>,
  repByColor: Map<number, RGB>,
): { color: RGB; domArea: number; total: number } {
  let bestKey = -1;
  let bestArea = 0;
  let total = 0;
  for (const [key, area] of areaByColor) {
    total += area;
    if (area > bestArea) {
      bestArea = area;
      bestKey = key;
    }
  }
  return {
    color: bestKey >= 0 ? repByColor.get(bestKey)! : [1, 1, 1],
    domArea: bestArea,
    total,
  };
}

/** Find the base colour: the dominant painted colour on upward-facing surface
 *  within ~one layer of the mesh bottom. Falls back to white when nothing near
 *  the bottom is painted. */
function baseColor(
  geom: TriGeom[],
  triRegion: Int32Array,
  palette: RGB[],
  minZ: number,
  layerHeight: number,
): RGB {
  const areaByColor = new Map<number, number>();
  const repByColor = new Map<number, RGB>();
  const cutoff = minZ + layerHeight;
  for (let t = 0; t < geom.length; t++) {
    const g = geom[t];
    if (!g.up || g.cz >= cutoff) continue;
    const ri = triRegion[t];
    if (ri < 0) continue;
    const c = palette[ri];
    const key = quantKey(c[0], c[1], c[2]);
    areaByColor.set(key, (areaByColor.get(key) ?? 0) + g.area);
    if (!repByColor.has(key)) repByColor.set(key, c);
  }
  if (areaByColor.size === 0) return [1, 1, 1];
  return dominant(areaByColor, repByColor).color;
}

interface LayerTally {
  color: RGB;
  coverage: number; // dominantArea / totalArea
  area: number; // total area in the layer
}

/**
 * Analyze a painted relief into bottom→top height bands of dominant surface
 * colour, one band per run of consecutive print layers sharing a colour.
 *
 * Only upward-facing triangles (normal·Z > ~0.3) are considered, since those
 * are what a top-down viewer / print surface shows at a given height. Empty
 * layers carry the previous band's colour across the gap. Robust to an
 * empty/degenerate mesh (returns []).
 */
export function analyzeHeightBands(
  mesh: MeshData,
  regions: readonly ColorRegion[],
  layerHeight: number,
): HeightBand[] {
  if (!mesh || mesh.numTri <= 0 || !(layerHeight > 0)) return [];

  const upDotMin = 0.3;
  const geom = computeTriGeom(mesh, upDotMin);
  const { triRegion, palette } = resolveTriColors(mesh.numTri, regions);

  // Min upward-facing centroid Z anchors layer 0 at the relief bottom.
  let minZ = Infinity;
  let maxZ = -Infinity;
  let anyUp = false;
  for (let t = 0; t < geom.length; t++) {
    const g = geom[t];
    if (!g.up || g.area <= 0) continue;
    anyUp = true;
    if (g.cz < minZ) minZ = g.cz;
    if (g.cz > maxZ) maxZ = g.cz;
  }
  if (!anyUp) return [];

  // Absolute build-plate datum (lowest vertex; ~0 for a relief on the plate).
  // Layer indices are reported from here so they match the printer's layer
  // count — the flat base contributes layers below the first painted surface.
  let meshMinZ = Infinity;
  for (let v = 0; v < mesh.numVert; v++) {
    const z = mesh.vertProperties[v * mesh.numProp + 2];
    if (z < meshMinZ) meshMinZ = z;
  }
  if (!Number.isFinite(meshMinZ)) meshMinZ = minZ;
  const layerOffset = Math.max(0, Math.round((minZ - meshMinZ) / layerHeight));

  const base = baseColor(geom, triRegion, palette, minZ, layerHeight);
  const baseKey = quantKey(base[0], base[1], base[2]);

  const layerCount = Math.max(1, Math.floor((maxZ - minZ) / layerHeight) + 1);

  // Per-layer area-by-color tallies. Maps keyed by quantized colour.
  const layerAreas: Array<Map<number, number>> = new Array(layerCount);
  const layerReps: Array<Map<number, RGB>> = new Array(layerCount);
  for (let k = 0; k < layerCount; k++) {
    layerAreas[k] = new Map();
    layerReps[k] = new Map();
  }

  for (let t = 0; t < geom.length; t++) {
    const g = geom[t];
    if (!g.up || g.area <= 0) continue;
    let k = Math.floor((g.cz - minZ) / layerHeight);
    if (k < 0) k = 0;
    else if (k >= layerCount) k = layerCount - 1;

    const ri = triRegion[t];
    // Unpainted upward surface counts toward the base colour for that layer.
    const c = ri >= 0 ? palette[ri] : base;
    const key = ri >= 0 ? quantKey(c[0], c[1], c[2]) : baseKey;
    const areas = layerAreas[k];
    areas.set(key, (areas.get(key) ?? 0) + g.area);
    const reps = layerReps[k];
    if (!reps.has(key)) reps.set(key, c);
  }

  // Resolve each layer's dominant colour (null = empty layer).
  const layers: Array<LayerTally | null> = new Array(layerCount);
  for (let k = 0; k < layerCount; k++) {
    if (layerAreas[k].size === 0) {
      layers[k] = null;
      continue;
    }
    const { color, domArea, total } = dominant(layerAreas[k], layerReps[k]);
    layers[k] = { color, coverage: total > 0 ? domArea / total : 1, area: total };
  }

  return collapseBands(layers, minZ, layerHeight, base, baseKey, layerOffset);
}

/** Merge consecutive same-colour layers into bands; carry the last seen colour
 *  across empty layers so a gap doesn't split an otherwise-uniform band. */
function collapseBands(
  layers: Array<LayerTally | null>,
  minZ: number,
  layerHeight: number,
  base: RGB,
  baseKey: number,
  layerOffset: number,
): HeightBand[] {
  const bands: HeightBand[] = [];
  let curKey = -1;
  let curColor: RGB = base;
  let lastFilledKey = baseKey;
  let lastFilledColor: RGB = base;

  // Accumulators for the open band.
  let startLayer = 0;
  let areaSum = 0;
  let coverageAreaSum = 0; // coverage weighted by layer area
  let minConfidence = 1;

  const flush = (endLayerExclusive: number) => {
    if (curKey < 0) return;
    const coverage = areaSum > 0 ? coverageAreaSum / areaSum : 1;
    bands.push({
      layerStart: startLayer + layerOffset,
      layerEnd: endLayerExclusive + layerOffset,
      zStart: minZ + startLayer * layerHeight,
      zEnd: minZ + endLayerExclusive * layerHeight,
      color: curColor,
      coverage,
      confidence: minConfidence,
    });
  };

  for (let k = 0; k < layers.length; k++) {
    const layer = layers[k];
    // Resolve this layer's effective colour/key, carrying across gaps.
    let key: number;
    let color: RGB;
    let coverage: number;
    let area: number;
    if (layer) {
      key = quantKey(layer.color[0], layer.color[1], layer.color[2]);
      color = layer.color;
      coverage = layer.coverage;
      area = layer.area;
      lastFilledKey = key;
      lastFilledColor = color;
    } else {
      key = lastFilledKey;
      color = lastFilledColor;
      coverage = 1; // empty layer adds no mixing evidence
      area = 0;
    }

    if (key !== curKey) {
      flush(k);
      curKey = key;
      curColor = color;
      startLayer = k;
      areaSum = 0;
      coverageAreaSum = 0;
      minConfidence = 1;
    }

    areaSum += area;
    coverageAreaSum += coverage * area;
    if (area > 0) minConfidence = Math.min(minConfidence, coverage);
  }
  flush(layers.length);

  return bands;
}
