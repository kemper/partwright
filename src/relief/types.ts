// Shared types for the Relief Studio (HueForge-style) feature.
//
// A "relief" is a heightmap mesh generated from a 2D image (or an imported
// stepped STL). The user paints its surface freely (reusing the existing
// ColorRegion system), which suits AMS / multi-material printing. For
// single-nozzle printers we derive an advisory "swap guide" describing the
// layer heights at which to change filament — see heightBands.ts / swapGuide.ts.

/** How an imported image is mapped onto relief heights. */
export type ReliefImportMode = 'luminance' | 'quantized' | 'ai';

/** Knobs shared by every import mode. Distances are in model units (mm). */
export interface ReliefCommonOptions {
  /** Physical width of the relief in mm. Height (depth) scales to keep aspect. */
  widthMm: number;
  /** Print layer height in mm — drives quantization and the swap guide. */
  layerHeight: number;
  /** Flat base/background thickness below the relief, in mm. */
  baseThickness: number;
  /** Maximum relief height (above the base), in mm. */
  maxHeight: number;
  /** Max grid columns; rows scale to keep the image aspect ratio. */
  resolution: number;
  /** Gaussian-ish blur radius in pixels applied before sampling (0 = none). */
  smoothing: number;
}

/** Luminance-relief specific knobs. */
export interface LuminanceOptions {
  /** Invert brightness→height (bright = tall vs. bright = short). */
  invert: boolean;
  /** Gamma applied to normalized luminance before height mapping. */
  gamma: number;
  /** Number of discrete height levels (after quantizing to layer multiples). */
  levels: number;
}

/** Color-quantized specific knobs. */
export interface QuantizedOptions {
  /** Number of color clusters. */
  clusters: number;
  /** Color space used for clustering. */
  colorSpace: 'rgb' | 'lab';
  /** Floyd–Steinberg dithering when assigning pixels to clusters. */
  dither: boolean;
}

export interface ReliefOptions {
  mode: ReliefImportMode;
  common: ReliefCommonOptions;
  luminance: LuminanceOptions;
  quantized: QuantizedOptions;
}

export const DEFAULT_RELIEF_OPTIONS: ReliefOptions = {
  mode: 'luminance',
  common: {
    widthMm: 100,
    layerHeight: 0.08,
    baseThickness: 0.6,
    maxHeight: 3,
    resolution: 200,
    smoothing: 0,
  },
  luminance: { invert: false, gamma: 1, levels: 16 },
  quantized: { clusters: 5, colorSpace: 'lab', dither: false },
};

/** A regular grid of heights (and optionally per-cell colors) sampled from an
 *  image. `heights[y * width + x]` is in mm, already quantized to layer
 *  multiples. `colors`, when present, is RGB (0..255) triples per cell. */
export interface HeightGrid {
  width: number;
  height: number;
  heights: Float32Array;
  colors?: Uint8Array;
}

/** A generated relief: a watertight (when possible) mesh plus the grid it came
 *  from and optional seed paint regions (color-quantized mode pre-colors the
 *  relief so the user starts with regions already painted). */
export interface ReliefMesh {
  vertProperties: Float32Array;
  triVerts: Uint32Array;
  numVert: number;
  numTri: number;
  numProp: number;
  /** True when the mesh satisfies Manifold.ofMesh's edge-manifold requirement. */
  watertight: boolean;
}

export interface SeedRegion {
  color: [number, number, number];
  triangleIds: number[];
  name: string;
}

export interface GenerateReliefResult {
  mesh: ReliefMesh;
  grid: HeightGrid;
  seedRegions?: SeedRegion[];
}

/** A filament in the user's library. `td` is the transmission distance in mm
 *  (how far light penetrates) used by the optical preview. */
export interface Filament {
  id: string;
  name: string;
  /** Hex color "#rrggbb". */
  hex: string;
  /** Transmission distance in mm. Larger = more translucent. */
  td: number;
}

/** One derived height band: the print layers in [layerStart, layerEnd) share a
 *  dominant surface color. Confidence reflects how cleanly a single filament
 *  reproduces this band on a single nozzle (1 = pure, lower = mixed/horizontal
 *  variation an AMS would be needed for). */
export interface HeightBand {
  layerStart: number;
  layerEnd: number;
  zStart: number;
  zEnd: number;
  color: [number, number, number];
  /** Fraction of the band's surface area covered by the dominant color. */
  coverage: number;
  confidence: number;
}

export interface SwapInstruction {
  /** Layer index at which to load this filament (0 = base). */
  atLayer: number;
  /** Z height in mm at which the swap occurs. */
  atZ: number;
  color: [number, number, number];
  /** Resolved filament name, when a palette match was found. */
  filamentName?: string;
}

export interface SwapGuide {
  layerHeight: number;
  totalLayers: number;
  totalHeight: number;
  swaps: SwapInstruction[];
  bands: HeightBand[];
  /** 0..1 overall how faithfully a single nozzle can reproduce the painting. */
  printability: number;
  /** Human-readable caveats (e.g. horizontal color variation in a band). */
  warnings: string[];
}

/** Optical preview mode. */
export type PreviewMode = 'flat' | 'ams' | 'single-nozzle';

/** Per-session relief settings, persisted in localStorage (keyed by session).
 *  Kept out of the IndexedDB schema to avoid a migration; the relief mesh
 *  itself persists via the existing `importedMeshes` channel. */
export interface ReliefSettings {
  isRelief: boolean;
  layerHeight: number;
  baseThickness: number;
  previewMode: PreviewMode;
  options?: ReliefOptions;
  sourceImage?: string;
}
