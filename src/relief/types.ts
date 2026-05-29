// Shared types for the Relief Studio (image → printable colour tile / stepped
// relief).
//
// A "relief" is a heightmap mesh generated from a 2D image (or an imported
// stepped STL). The user paints its surface freely (reusing the existing
// ColorRegion system), which suits AMS / multi-material printing. For
// single-nozzle printers we derive an advisory "swap guide" describing the
// layer heights at which to change filament — see heightBands.ts / swapGuide.ts.

/** How an imported image is mapped onto relief heights. */
export type ReliefImportMode = 'luminance' | 'quantized' | 'ai' | 'svg';

/** What kind of geometry the colour pipeline produces. */
export type TileOutputKind =
  /** Cluster->height cliffs — stepped relief (lithophane-adjacent). */
  | 'relief'
  /** Flat tile with colour regions painted on the top — keychain style. */
  | 'flat'
  /** Flat tile cut to the image's subject silhouette (background removed). */
  | 'silhouette';

/** Whether a stepped-relief output is validated for single-nozzle printing.
 *  Both modes produce the SAME per-cluster relief geometry (a continuous
 *  quantized-height relief, each cluster owning its top + side walls); this knob
 *  no longer changes the mesh. It only gates the downstream swap-guide layer-fit
 *  validation. Only relevant for `output: 'relief'`; flat/silhouette tiles paint
 *  the top surface 1:1 from the cluster map. */
export type PaintingMode =
  /** AMS-friendly — no single-nozzle layer-fit check (a multi-material printer
   *  can switch filament across XY, so any colour layout is printable). */
  | 'multi-color'
  /** Single-nozzle — enables the swap-guide layer-fit validation that checks
   *  each colour can be reproduced by horizontal filament swaps. Geometry is
   *  identical to 'multi-color'. */
  | 'single-nozzle';

/** Optional crop applied to the source image before sampling. Coordinates are
 *  normalised 0..1 over the source's natural width/height so the crop is
 *  resolution-independent. Default is the full image (left=0, top=0, right=1,
 *  bottom=1). */
export interface CropRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Outer profile of a flat tile (for output: 'flat'; silhouette uses the image). */
export type TileShapeKind = 'rect' | 'rounded' | 'circle';

/** Pre-processing applied to the sampled image BEFORE clustering / luminance
 *  mapping. All ranges are designed so 0 / defaults = no-op. */
export interface PreprocessOptions {
  /** -1..+1, shifts the whole image lighter/darker. 0 = unchanged. */
  brightness: number;
  /** -1..+1, expands or compresses tonal range around mid-grey. 0 = unchanged. */
  contrast: number;
  /** -1..+1, pushes colour intensity. 0 = unchanged; -1 = fully desaturated. */
  saturation: number;
  /** Black point in 0..255 — anything below this is crushed to black. */
  levelsLow: number;
  /** White point in 0..255 — anything above this is clipped to white. */
  levelsHigh: number;
}

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

/** A single circular keychain hole on a flat tile. Coordinates are model-space
 *  mm with (0, 0) at the tile centre, +Y up (the tile's top edge). */
export interface TileHole {
  cxMm: number;
  cyMm: number;
  diameterMm: number;
}

/** Color-quantized specific knobs. */
export interface QuantizedOptions {
  /** Number of color clusters. */
  clusters: number;
  /** Color space used for clustering. */
  colorSpace: 'rgb' | 'lab';
  /** Floyd–Steinberg dithering when assigning pixels to clusters. */
  dither: boolean;
  /** Output geometry kind — 'flat' makes a printable colour tile (default,
   *  Bambu-keychain style); 'relief' keeps the original cluster->height cliffs;
   *  'silhouette' cuts the flat tile to the image's subject outline. */
  output: TileOutputKind;
  /** Tile profile when output is 'flat'. */
  shape: TileShapeKind;
  /** Corner radius for 'rounded' shape, in mm. */
  cornerRadiusMm: number;
  /** Top-edge chamfer (round-over) depth in mm. 0 disables. The chamfer drops
   *  the outermost ring of top-surface vertices to topZ - chamferMm, giving the
   *  perimeter a soft beveled lip rather than a sharp corner. */
  chamferMm: number;
  /** Whether `output: 'relief'` runs the single-nozzle layer-fit validation.
   *  Both values produce the same per-cluster relief geometry; 'single-nozzle'
   *  additionally gates the swap-guide check, 'multi-color' skips it.
   *  Ignored for `output: 'flat'` and `output: 'silhouette'`. */
  paintingMode: PaintingMode;
  /** When true, flips the cluster→height assignment so DARKER colours land
   *  TALLER. Useful for the common case of a dark subject on a light
   *  background, where the default ("bright = tall") buries the subject
   *  inside a taller background. */
  invertHeights: boolean;
  /** All circular keychain holes on the tile. Each is centred at (cxMm, cyMm)
   *  in model coords. Empty = no holes. */
  holes: TileHole[];
  /** Legacy single-hole knobs. New code uses `holes[]`; clampReliefQuantized
   *  migrates these on read so old saved presets still work. */
  holeEnabled?: boolean;
  holeDiameterMm?: number;
  holeOffsetMm?: number;
  /** When set in silhouette mode, treat this colour (0..255 RGB) as the
   *  background instead of auto-detecting from the image's border colours.
   *  The user picks it by clicking the source thumbnail. */
  manualBackground?: [number, number, number];
}

export interface ReliefOptions {
  mode: ReliefImportMode;
  common: ReliefCommonOptions;
  luminance: LuminanceOptions;
  quantized: QuantizedOptions;
  /** Image-level corrections applied before sampling for clustering/luminance. */
  preprocess: PreprocessOptions;
  /** Optional crop applied to the source image before any other processing.
   *  When undefined or covering the full image (0,0,1,1), no crop occurs. */
  crop?: CropRect;
}

export const DEFAULT_RELIEF_OPTIONS: ReliefOptions = {
  // 'quantized' (Bambu-keychain-style flat colour tile) is the default — most
  // user imports are characters/logos/photos that want a flat colour print;
  // luminance lithophanes are a niche choice the user can pick explicitly.
  mode: 'quantized',
  common: {
    widthMm: 100,
    layerHeight: 0.08,
    baseThickness: 0.6,
    maxHeight: 3,
    resolution: 200,
    smoothing: 0,
  },
  luminance: { invert: false, gamma: 1, levels: 16 },
  quantized: {
    clusters: 5,
    colorSpace: 'lab',
    dither: false,
    output: 'flat',
    shape: 'rect',
    cornerRadiusMm: 4,
    chamferMm: 0,
    holes: [],
    paintingMode: 'single-nozzle',
    invertHeights: false,
  },
  preprocess: { brightness: 0, contrast: 0, saturation: 0, levelsLow: 0, levelsHigh: 255 },
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
  // The source image is NOT kept here — photos can exceed the localStorage
  // quota, so it lives in IndexedDB (the `reliefSources` store, see
  // src/relief/reliefSource.ts), keyed by session id like these settings.
}
