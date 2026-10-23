// Photo-match score — a cheap, deterministic, TEXT-ONLY likeness metric that
// compares a reference photo of a subject against a flat render of the model
// from the matching camera, and says WHERE the model is off.
//
// Pure module: no DOM, no Three, no app imports. Both callers feed it plain
// RGBA buffers — the browser API (`partwright.photoMatch`, which renders the
// model through the offscreen WebGL renderer) and the headless CLI
// (`model:preview --match-photo`, which rasterizes in pure JS) — so the score is
// identical wherever it runs, and it is unit-testable in vitest.
//
// Pipeline (all O(pixels)):
//   1. Segment each image into a foreground mask: pixels far from the background
//      colour(s). The reference background is estimated from a border ring
//      (k-means over the ring, so a two-tone halftone backdrop yields two bg
//      colours) with a noise-adaptive tolerance, or given explicitly. The mask is
//      cleaned with a 3×3 open/close, reduced to the largest component plus
//      anything touching it, and hole-filled (dark pupils on a dark backdrop).
//   2. Normalise: crop each mask to its bbox and resample both to a common
//      height (aspect kept), centred horizontally on a shared canvas.
//   3. Silhouette metrics: IoU, aspect, a per-band width profile and centre
//      offset (bands named after the model regions that dominate them).
//   4. Region metrics: k-means over the reference foreground colours, SEEDED with
//      the model's region colours (regions sharing a colour share a cluster and
//      are split spatially — each photo pixel goes to the nearest model region of
//      its colour). Per region: IoU, area ratio, bbox width/height ratio,
//      centroid offset, and the photo colour the cluster converged to.
//   5. `worst[]`: the 3–5 most actionable findings, in plain words.
//
// Conventions: image y grows DOWN. Offsets are model − photo, in % of the
// normalised figure height: dx > 0 = model sits further right, dy > 0 = lower.

export type Rgb = [number, number, number];

export interface RgbaImage {
  width: number;
  height: number;
  /** RGBA, row-major, 4 bytes per pixel. */
  data: ArrayLike<number>;
}

export interface CropRect { x: number; y: number; w: number; h: number }

export interface PhotoMatchRegion { name: string; color: Rgb | string }

/** Tuning knobs. Callers read these from app config (`import.photoMatch*`)
 *  and pass them in; the module never reads config itself. */
export interface PhotoMatchTuning {
  /** Common height (px) both silhouettes are resampled to. */
  targetHeight: number;
  /** Floor (RGB distance) for the auto-estimated background tolerance. The
   *  estimate adapts to the border's noise above this floor. */
  bgToleranceMin: number;
  /** Tolerance (RGB distance) used when an explicit `bg` is passed without its
   *  own `bgTolerance`. */
  bgTolerance: number;
  /** k-means refinement iterations over the reference foreground colours. */
  kmeansIterations: number;
  /** Number of horizontal bands in the width profile. */
  bands: number;
  /** A photo pixel is only credited to a model region of its colour within
   *  this distance (fraction of the figure height); further away it is a photo
   *  detail with no model counterpart and is left unassigned. */
  maxRegionDistance: number;
  /** A region whose photo colour drifted further than this (CIE76 ΔE) from the
   *  model colour is reported as a colour mismatch. */
  colorShiftWarn: number;
  /** Warn when the photo's subject is shorter than this (original photo px):
   *  band/edge numbers finer than a few px are noise. */
  minSubjectPx: number;
  /** Regions whose photo colours converge closer than this (ΔE, lightness
   *  weighted ½) — or that share a model colour AND touch — can't be told
   *  apart in the photo: their shape findings are suppressed and they are
   *  flagged `lowConfidence`. 0 disables the auto-detection. */
  ambiguousDeltaE: number;
  /** Outline diff: edge / interior offsets smaller than this (% of the figure
   *  height) are not reported. */
  outlineMinPct: number;
  /** Outline diff: at most this many lines. */
  outlineMaxLines: number;
  /** Auto background mode: a border ring whose estimated tolerance reaches
   *  this (RGB distance) is "busy" (halftone, scenery) — segmentation then
   *  switches to the colour-model (GrabCut-lite) path. */
  busyBorderTolerance: number;
}

const PHOTO_MATCH_DEFAULTS: PhotoMatchTuning = {
  targetHeight: 160,
  bgToleranceMin: 10,
  bgTolerance: 40,
  kmeansIterations: 8,
  bands: 10,
  colorShiftWarn: 30,
  maxRegionDistance: 0.12,
  minSubjectPx: 300,
  ambiguousDeltaE: 12,
  outlineMinPct: 1.5,
  outlineMaxLines: 8,
  busyBorderTolerance: 75,
};

/** Map the app-config `import.photoMatch*` fields onto the tuning knobs.
 *  Takes a plain object so this module stays free of app imports. */
export function photoMatchTuningFromConfig(c: {
  photoMatchTargetHeight: number; photoMatchBgToleranceMin: number; photoMatchBgTolerance: number;
  photoMatchKmeansIterations: number; photoMatchBands: number; photoMatchColorShiftWarn: number;
  photoMatchMaxRegionDistance: number; photoMatchMinSubjectPx: number; photoMatchAmbiguousDeltaE: number;
  photoMatchOutlineMinPct: number; photoMatchOutlineMaxLines: number; photoMatchBusyBorderTolerance: number;
}): PhotoMatchTuning {
  return {
    targetHeight: c.photoMatchTargetHeight,
    bgToleranceMin: c.photoMatchBgToleranceMin,
    bgTolerance: c.photoMatchBgTolerance,
    kmeansIterations: c.photoMatchKmeansIterations,
    bands: c.photoMatchBands,
    colorShiftWarn: c.photoMatchColorShiftWarn,
    maxRegionDistance: c.photoMatchMaxRegionDistance,
    minSubjectPx: c.photoMatchMinSubjectPx,
    ambiguousDeltaE: c.photoMatchAmbiguousDeltaE,
    outlineMinPct: c.photoMatchOutlineMinPct,
    outlineMaxLines: c.photoMatchOutlineMaxLines,
    busyBorderTolerance: c.photoMatchBusyBorderTolerance,
  };
}

export interface PhotoMatchInput {
  reference: RgbaImage;
  /** Optional crop of the reference, in reference pixels. */
  crop?: CropRect | null;
  /** Reference background colour; default = estimated from the border ring. */
  bg?: Rgb | string | null;
  /** RGB-distance tolerance around `bg` (or around each estimated colour). */
  bgTolerance?: number | null;
  /** The model render — flat colours on a known flat background. */
  model: RgbaImage;
  /** The model render's background colour (default: estimated). */
  modelBg?: Rgb | string | null;
  /** Optional exact per-pixel region index for the model render (same size):
   *  -2 = background, -1 = foreground with no region, ≥0 = index into
   *  `regions`. When given, the model mask + region map come from it instead of
   *  from colour matching (exact even when regions share a colour). */
  modelLabels?: Int32Array | null;
  /** The model's regions: label name + display colour. */
  regions?: PhotoMatchRegion[] | null;
  /** Photo pixel aspect correction: the photo's widths are multiplied by this
   *  before comparing (e.g. 0.55 for a frame grabbed from anamorphic video that
   *  shows the subject ~1.8× too wide). Default 1. */
  pixelAspect?: number | null;
  /** 'height' (default): common height, aspect kept. 'box': the model is also
   *  stretched to the photo's bbox width, so only proportions are compared. */
  fit?: 'height' | 'box';
  /** Manual subject mask for the reference: white (and opaque) = subject.
   *  Same framing as `reference`, any resolution — `crop` is applied to it
   *  scaled. Overrides background estimation (`bg` / `bgMode`). */
  mask?: RgbaImage | null;
  /** How the reference is segmented when no `mask`/`bg` is given:
   *  'auto' (default) = backdrop estimated from the border ring, switching to
   *  'grabcut' when that ring is busy (halftone, scenery) or the result is
   *  implausible; 'border' = never switch; 'grabcut' = colour-model
   *  segmentation (learns subject vs backdrop colours, border = backdrop). */
  bgMode?: 'auto' | 'border' | 'grabcut';
  /** Region groups scored as ONE region, e.g. [['jersey','ball','socks','shoes']]
   *  — for parts the photo can't tell apart (white-on-white on a dim photo). */
  merge?: readonly (readonly string[])[] | null;
  /** Regions left out of the region analysis and findings (they still count
   *  toward the silhouette and still claim their photo pixels). Naming a
   *  member of a `merge` group ignores the whole group. */
  ignore?: readonly string[] | null;
  /** Include the normalised region maps in the result (for an overlay image). */
  debug?: boolean;
  tuning?: Partial<PhotoMatchTuning>;
}

export interface PhotoMatchBand {
  band: number;
  /** Model regions that dominate the band, e.g. "hair/skin". */
  name: string;
  /** Mean row width, % of figure height. */
  refWidth: number;
  modelWidth: number;
  /** (model − photo) / photo, %. Negative = model narrower. */
  widthDiffPct: number;
  /** Horizontal centre offset model − photo, % of height (+ = model right). */
  dx: number;
  iou: number;
  /** Outer-edge offsets, OUTWARD-positive, % of height, mean over the band's
   *  rows: > 0 = the model's edge sticks out past the photo's on that side
   *  (model-only), < 0 = the photo extends further (photo-only — grow the
   *  model there). Left/right are IMAGE sides (the viewer's). */
  left: number;
  right: number;
  /** Interior mismatch, mean width per row in % of height: photo-only pixels
   *  INSIDE the model's span (the model has a gap the photo doesn't) and
   *  model-only pixels inside the photo's span (the photo has a gap — e.g.
   *  between the legs — that the model fills). */
  innerPhotoOnly: number;
  innerModelOnly: number;
}

export interface PhotoMatchRegionResult {
  name: string;
  /** The model's colour for the region. */
  color: string;
  /** The photo's colour for this region (mean of its photo pixels; when the
   *  colour matched nothing, the mean of the photo pixels under the model
   *  region). */
  photoColor: string | null;
  /** ΔE (CIE76, lightness weighted ½ to forgive shading) between `color` and
   *  `photoColor`. */
  colorShift: number | null;
  iou: number;
  /** Model share of its silhouette / photo share of its silhouette. */
  areaRatio: number | null;
  /** Model bbox width / photo bbox width, and the same for height. */
  widthRatio: number | null;
  heightRatio: number | null;
  /** Centroid offset model − photo, % of figure height. */
  dx: number | null;
  dy: number | null;
  /** Share of the figure's foreground, %. */
  modelShare: number;
  photoShare: number;
  /** Set when the photo can't separate this region from another (photo
   *  colours too close, or a shared colour + touching): its size/position
   *  findings are suppressed. Merge or ignore the group to silence it. */
  lowConfidence?: string;
}

export interface SegmentationInfo {
  bgColors: string[];
  tolerance: number[];
  fgFraction: number;
  bbox: { x: number; y: number; w: number; h: number } | null;
  /** Silhouette touches these image edges — likely truncated by the crop. */
  touchesEdges: string[];
  /** How the mask was obtained: 'border' (backdrop estimated from the border
   *  ring), 'bg' (explicit colour), 'grabcut' (colour model), 'mask' (manual),
   *  'render' (the model side). */
  method?: string;
  /** Subject bbox height in ORIGINAL image pixels (photo only). */
  subjectPx?: number;
}

export interface PhotoMatchResult {
  silhouetteIoU: number;
  aspect: { model: number; photo: number; ratio: number };
  bands: PhotoMatchBand[];
  regions: PhotoMatchRegionResult[];
  worst: string[];
  /** Compact text outline diff: where the photo's outline sticks out past the
   *  model's ("photo-only … → grow") or vice versa ("model-only … → trim"),
   *  per band run and side, most severe first. */
  outline: string[];
  segmentation: { photo: SegmentationInfo; model: SegmentationInfo };
  warnings: string[];
  /** The normalised canvas size the metrics were computed on. */
  normalized: { width: number; height: number; fit: 'height' | 'box' };
  /** Only with `debug: true`: the normalised per-pixel region maps (-2 bg,
   *  -1 foreground without a region, ≥0 region index) for an overlay image. */
  debug?: { width: number; height: number; photo: Int32Array; model: Int32Array };
}

// ---------------------------------------------------------------------------
// colour helpers

export function parseColor(c: Rgb | string | null | undefined): Rgb | null {
  if (c == null) return null;
  if (Array.isArray(c)) {
    if (c.length !== 3 || c.some((v) => typeof v !== 'number' || !Number.isFinite(v))) return null;
    // Accept 0..1 floats as well as 0..255.
    const unit = c.every((v) => v >= 0 && v <= 1) && c.some((v) => v > 0 && v < 1);
    return c.map((v) => Math.max(0, Math.min(255, Math.round(unit ? v * 255 : v)))) as Rgb;
  }
  const m = /^#?([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/.exec(String(c).trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex(c: ArrayLike<number>): string {
  return '#' + [c[0], c[1], c[2]].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
}

const SRGB_LIN = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  SRGB_LIN[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
function labF(t: number): number { return t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116; }
/** sRGB (0..255, may be fractional) → CIE Lab (D65). */
function rgbToLab(r: number, g: number, b: number, out: Float32Array | number[], o = 0): void {
  const lin = (v: number) => {
    const i = Math.max(0, Math.min(255, v));
    const lo = Math.floor(i), hi = Math.min(255, lo + 1), f = i - lo;
    return SRGB_LIN[lo] * (1 - f) + SRGB_LIN[hi] * f;
  };
  const R = lin(r), G = lin(g), B = lin(b);
  const x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
  const y = R * 0.2126 + G * 0.7152 + B * 0.0722;
  const z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const fx = labF(x), fy = labF(y), fz = labF(z);
  out[o] = 116 * fy - 16; out[o + 1] = 500 * (fx - fy); out[o + 2] = 200 * (fy - fz);
}
/** CIE76 ΔE, with an optional lightness weight (`wL` < 1 forgives the
 *  shading a photo adds to a flat model colour). */
function deltaE(a: Rgb, b: Rgb, wL = 1): number {
  const la = [0, 0, 0], lb = [0, 0, 0];
  rgbToLab(a[0], a[1], a[2], la); rgbToLab(b[0], b[1], b[2], lb);
  return Math.hypot((la[0] - lb[0]) * wL, la[1] - lb[1], la[2] - lb[2]);
}
const dist2 = (a: ArrayLike<number>, ao: number, b: ArrayLike<number>, bo: number) => {
  const d0 = a[ao] - b[bo], d1 = a[ao + 1] - b[bo + 1], d2 = a[ao + 2] - b[bo + 2];
  return d0 * d0 + d1 * d1 + d2 * d2;
};

// ---------------------------------------------------------------------------
// image helpers

interface Rgb3 {
  width: number; height: number; rgb: Float32Array;
  /** Original (cropped) image pixels per working pixel, vertically. */
  scale: number;
}

/** Crop + area-downsample to at most `maxSide` px on the longer side (box
 *  filter: averages JPEG/WEBP noise before segmentation) → float RGB. */
function clampCrop(width: number, height: number, crop: CropRect | null | undefined): CropRect {
  if (!crop) return { x: 0, y: 0, w: width, h: height };
  const x = Math.max(0, Math.min(width - 1, Math.round(crop.x)));
  const y = Math.max(0, Math.min(height - 1, Math.round(crop.y)));
  return { x, y, w: Math.max(1, Math.min(width - x, Math.round(crop.w))), h: Math.max(1, Math.min(height - y, Math.round(crop.h))) };
}

function prepare(img: RgbaImage, crop: CropRect | null | undefined, maxSide: number): Rgb3 {
  const { x: x0, y: y0, w, h } = clampCrop(img.width, img.height, crop);
  const f = Math.max(1, Math.max(w, h) / maxSide);
  const W = Math.max(1, Math.round(w / f)), H = Math.max(1, Math.round(h / f));
  const rgb = new Float32Array(W * H * 3);
  const d = img.data;
  for (let y = 0; y < H; y++) {
    const sy0 = y0 + Math.floor(y * h / H), sy1 = Math.max(sy0 + 1, y0 + Math.floor((y + 1) * h / H));
    for (let x = 0; x < W; x++) {
      const sx0 = x0 + Math.floor(x * w / W), sx1 = Math.max(sx0 + 1, x0 + Math.floor((x + 1) * w / W));
      let r = 0, g = 0, b = 0, n = 0;
      for (let sy = sy0; sy < sy1; sy++) {
        for (let sx = sx0; sx < sx1; sx++) {
          const o = (sy * img.width + sx) * 4;
          // Composite transparent pixels over white so a PNG cut-out still has
          // a well-defined (flat) background.
          const a = d[o + 3] === undefined ? 255 : d[o + 3];
          const t = a / 255;
          r += d[o] * t + 255 * (1 - t); g += d[o + 1] * t + 255 * (1 - t); b += d[o + 2] * t + 255 * (1 - t); n++;
        }
      }
      const o = (y * W + x) * 3;
      rgb[o] = r / n; rgb[o + 1] = g / n; rgb[o + 2] = b / n;
    }
  }
  return { width: W, height: H, rgb, scale: h / H };
}

/** Sample a manual mask (white + opaque = subject) onto the prepared
 *  reference grid. `crop` is in reference pixels; the mask may have its own
 *  resolution (same framing), so the crop is scaled into mask pixels. */
function prepareMask(mask: RgbaImage, refW: number, refH: number, crop: CropRect | null | undefined, W: number, H: number): Uint8Array {
  const c = clampCrop(refW, refH, crop);
  const sx = mask.width / refW, sy = mask.height / refH;
  const out = new Uint8Array(W * H);
  const d = mask.data;
  for (let y = 0; y < H; y++) {
    const my = Math.min(mask.height - 1, Math.floor((c.y + ((y + 0.5) * c.h) / H) * sy));
    for (let x = 0; x < W; x++) {
      const mx = Math.min(mask.width - 1, Math.floor((c.x + ((x + 0.5) * c.w) / W) * sx));
      const o = (my * mask.width + mx) * 4;
      const a = d[o + 3] === undefined ? 255 : d[o + 3];
      const luma = 0.299 * d[o] + 0.587 * d[o + 1] + 0.114 * d[o + 2];
      out[y * W + x] = a >= 128 && luma >= 128 ? 1 : 0;
    }
  }
  return out;
}

/** Estimate the background colour(s) from a ring just inside the border
 *  (skipping the outermost ~1.5% where frames / vignettes live). Returns the
 *  colours covering ≥15% of the ring, each with a noise-adaptive tolerance. */
/** Width (px) of the outer frame zone skipped by background estimation and
 *  cleared from the auto-segmented photo mask (borders, vignettes, a stray
 *  edge line from a video frame). */
function frameInset(W: number, H: number): number {
  const m = Math.min(W, H);
  return Math.min(Math.floor(m / 4), Math.max(1, Math.round(m * 0.015)));
}

export function estimateBackground(img: { width: number; height: number; rgb: Float32Array }, tolMin: number): { colors: Rgb[]; tol: number[] } {
  const { width: W, height: H, rgb } = img;
  const m = Math.min(W, H);
  const inset = frameInset(W, H);
  const band = Math.max(2, Math.round(m * 0.04));
  const samples: number[] = [];
  const push = (x: number, y: number) => { const o = (y * W + x) * 3; samples.push(rgb[o], rgb[o + 1], rgb[o + 2]); };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dEdge = Math.min(x, y, W - 1 - x, H - 1 - y);
      if (dEdge >= inset && dEdge < inset + band) push(x, y);
    }
  }
  const n = samples.length / 3;
  if (n === 0) return { colors: [[255, 255, 255]], tol: [tolMin] };
  // k-means (k ≤ 3) with farthest-point init over the ring samples.
  const K = Math.min(3, n);
  const centres: number[] = [];
  // Init 1: the ring's median colour (robust to a minority accent).
  const med = [0, 1, 2].map((c) => { const v: number[] = []; for (let i = 0; i < n; i++) v.push(samples[i * 3 + c]); v.sort((a, b) => a - b); return v[n >> 1]; });
  centres.push(med[0], med[1], med[2]);
  while (centres.length / 3 < K) {
    let best = -1, bestD = -1;
    for (let i = 0; i < n; i++) {
      let dmin = Infinity;
      for (let k = 0; k < centres.length / 3; k++) dmin = Math.min(dmin, dist2(samples, i * 3, centres, k * 3));
      if (dmin > bestD) { bestD = dmin; best = i; }
    }
    if (bestD < 400) break; // everything within ~20 of an existing centre
    centres.push(samples[best * 3], samples[best * 3 + 1], samples[best * 3 + 2]);
  }
  const k = centres.length / 3;
  const assign = new Int32Array(n);
  for (let it = 0; it < 6; it++) {
    const sum = new Float64Array(k * 3), cnt = new Int32Array(k);
    for (let i = 0; i < n; i++) {
      let bi = 0, bd = Infinity;
      for (let c = 0; c < k; c++) { const d = dist2(samples, i * 3, centres, c * 3); if (d < bd) { bd = d; bi = c; } }
      assign[i] = bi; cnt[bi]++;
      sum[bi * 3] += samples[i * 3]; sum[bi * 3 + 1] += samples[i * 3 + 1]; sum[bi * 3 + 2] += samples[i * 3 + 2];
    }
    for (let c = 0; c < k; c++) if (cnt[c]) for (let j = 0; j < 3; j++) centres[c * 3 + j] = sum[c * 3 + j] / cnt[c];
  }
  const colors: Rgb[] = [], tol: number[] = [];
  for (let c = 0; c < k; c++) {
    // Final centre = per-channel MEDIAN of the members: a pure-black backdrop
    // stays (0,0,0) even when a tinted frame edge leaks into the ring.
    const members: number[] = [];
    for (let i = 0; i < n; i++) if (assign[i] === c) members.push(i);
    if (members.length < n * 0.15) continue;
    for (let j = 0; j < 3; j++) {
      const v = members.map((i) => samples[i * 3 + j]).sort((a, b) => a - b);
      centres[c * 3 + j] = v[v.length >> 1];
    }
    const ds = members.map((i) => Math.sqrt(dist2(samples, i * 3, centres, c * 3)));
    ds.sort((a, b) => a - b);
    // Spread = 75th-percentile distance (a thin frame or vignette in the ring
    // must not inflate it); tolerance = a margin above the noise.
    const p75 = ds[Math.min(ds.length - 1, Math.floor(ds.length * 0.75))];
    colors.push([centres[c * 3], centres[c * 3 + 1], centres[c * 3 + 2]].map(Math.round) as Rgb);
    tol.push(Math.min(90, Math.max(tolMin, 2.5 * p75 + 4)));
  }
  if (!colors.length) { colors.push(med.map(Math.round) as Rgb); tol.push(tolMin); }
  return { colors, tol };
}

// --- binary morphology on Uint8 masks (square structuring element) ---
function morph(src: Uint8Array, W: number, H: number, r: number, dilate: boolean): Uint8Array {
  const tmp = new Uint8Array(W * H), out = new Uint8Array(W * H);
  const want = dilate ? 1 : 0;
  // Horizontal pass, then vertical. Out-of-bounds pixels are ignored, so a
  // shape touching the frame edge doesn't erode away from it.
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let hit = false;
      for (let dx = -r; dx <= r && !hit; dx++) {
        const xx = x + dx;
        if (xx < 0 || xx >= W) continue;
        if (src[y * W + xx] === want) hit = true;
      }
      tmp[y * W + x] = dilate ? (hit ? 1 : 0) : (hit ? 0 : 1);
    }
  }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let hit = false;
      for (let dy = -r; dy <= r && !hit; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= H) continue;
        if (tmp[yy * W + x] === want) hit = true;
      }
      out[y * W + x] = dilate ? (hit ? 1 : 0) : (hit ? 0 : 1);
    }
  }
  return out;
}

/** Label 8-connected components of `mask`. Returns per-pixel component id
 *  (-1 = background) and component sizes. */
function components(mask: Uint8Array, W: number, H: number): { id: Int32Array; sizes: number[] } {
  const id = new Int32Array(W * H).fill(-1);
  const sizes: number[] = [];
  const stack = new Int32Array(W * H);
  for (let p = 0; p < W * H; p++) {
    if (!mask[p] || id[p] >= 0) continue;
    const c = sizes.length;
    let sp = 0, n = 0;
    stack[sp++] = p; id[p] = c;
    while (sp) {
      const q = stack[--sp]; n++;
      const qx = q % W, qy = (q - qx) / W;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = qy + dy; if (yy < 0 || yy >= H) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = qx + dx; if (xx < 0 || xx >= W) continue;
          const nq = yy * W + xx;
          if (mask[nq] && id[nq] < 0) { id[nq] = c; stack[sp++] = nq; }
        }
      }
    }
    sizes.push(n);
  }
  return { id, sizes };
}

/** Clean a raw foreground mask: open (drop speckle) + close (seal cracks),
 *  keep the largest component plus anything within 2 px of it (and, with
 *  `keepFrac` > 0, every component at least that fraction of the largest),
 *  fill holes. */
function cleanMask(raw: Uint8Array, W: number, H: number, keepFrac = 0): Uint8Array {
  let m = morph(morph(raw, W, H, 1, false), W, H, 1, true);
  m = morph(morph(m, W, H, 1, true), W, H, 1, false);
  const { id, sizes } = components(m, W, H);
  if (!sizes.length) return m;
  let big = 0;
  for (let c = 1; c < sizes.length; c++) if (sizes[c] > sizes[big]) big = c;
  const bigMask = new Uint8Array(W * H);
  for (let p = 0; p < W * H; p++) if (id[p] === big) bigMask[p] = 1;
  const near = morph(bigMask, W, H, 2, true);
  const keep = new Uint8Array(sizes.length); keep[big] = 1;
  if (keepFrac > 0) for (let c = 0; c < sizes.length; c++) if (sizes[c] >= sizes[big] * keepFrac) keep[c] = 1;
  for (let p = 0; p < W * H; p++) if (id[p] >= 0 && near[p]) keep[id[p]] = 1;
  const out = new Uint8Array(W * H);
  for (let p = 0; p < W * H; p++) if (id[p] >= 0 && keep[id[p]]) out[p] = 1;
  // Fill holes: background not reachable from the image border becomes fg.
  const reach = new Uint8Array(W * H);
  const stack: number[] = [];
  const seed = (p: number) => { if (!out[p] && !reach[p]) { reach[p] = 1; stack.push(p); } };
  for (let x = 0; x < W; x++) { seed(x); seed((H - 1) * W + x); }
  for (let y = 0; y < H; y++) { seed(y * W); seed(y * W + W - 1); }
  while (stack.length) {
    const q = stack.pop()!;
    const qx = q % W, qy = (q - qx) / W;
    if (qx > 0) seed(q - 1); if (qx < W - 1) seed(q + 1);
    if (qy > 0) seed(q - W); if (qy < H - 1) seed(q + W);
  }
  for (let p = 0; p < W * H; p++) if (!out[p] && !reach[p]) out[p] = 1;
  return out;
}

function maskBBox(mask: Uint8Array, W: number, H: number): { x: number; y: number; w: number; h: number } | null {
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (mask[y * W + x]) {
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

function segInfo(colors: Rgb[], tol: number[], mask: Uint8Array, W: number, H: number, margin = 0): SegmentationInfo {
  let fg = 0;
  for (let p = 0; p < mask.length; p++) fg += mask[p];
  const bbox = maskBBox(mask, W, H);
  const touches: string[] = [];
  if (bbox) {
    if (bbox.y <= margin) touches.push('top');
    if (bbox.y + bbox.h >= H - margin) touches.push('bottom');
    if (bbox.x <= margin) touches.push('left');
    if (bbox.x + bbox.w >= W - margin) touches.push('right');
  }
  return { bgColors: colors.map(toHex), tolerance: tol.map((t) => Math.round(t)), fgFraction: r3(fg / (W * H)), bbox, touchesEdges: touches };
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;
const r1 = (v: number) => Math.round(v * 10) / 10;

// ---------------------------------------------------------------------------
// normalisation

interface Normalized {
  W: number; H: number;
  mask: Uint8Array;
  /** Box-averaged foreground colour per pixel (photo). */
  rgb: Float32Array;
  /** Majority region index per pixel (model): -2 bg, -1 unlabeled, ≥0 region. */
  labels: Int32Array;
}

/** Resample the bbox of `mask` to `tw`×`TH` and centre it horizontally in a
 *  `CW`-wide canvas. (`tw` = bbox.w·TH/bbox.h keeps the aspect.) */
function normalize(mask: Uint8Array, W: number, H: number, bbox: { x: number; y: number; w: number; h: number }, TH: number, tw: number, CW: number,
  rgb: Float32Array | null, labels: Int32Array | null, nLabels: number): Normalized {
  const s = TH / bbox.h, sxs = tw / bbox.w;
  const ox = Math.floor((CW - tw) / 2);
  const outMask = new Uint8Array(CW * TH);
  const outRgb = new Float32Array(CW * TH * 3);
  const outLab = new Int32Array(CW * TH).fill(-2);
  const votes = new Int32Array(nLabels + 1);
  for (let y = 0; y < TH; y++) {
    const sy0 = bbox.y + Math.floor(y / s), sy1 = Math.max(sy0 + 1, Math.min(bbox.y + bbox.h, bbox.y + Math.floor((y + 1) / s)));
    for (let x = 0; x < tw; x++) {
      const sx0 = bbox.x + Math.floor(x / sxs), sx1 = Math.max(sx0 + 1, Math.min(bbox.x + bbox.w, bbox.x + Math.floor((x + 1) / sxs)));
      let fg = 0, tot = 0, r = 0, g = 0, b = 0;
      if (labels) votes.fill(0);
      for (let sy = sy0; sy < sy1 && sy < H; sy++) {
        for (let sx = sx0; sx < sx1 && sx < W; sx++) {
          const p = sy * W + sx; tot++;
          if (!mask[p]) continue;
          fg++;
          if (rgb) { r += rgb[p * 3]; g += rgb[p * 3 + 1]; b += rgb[p * 3 + 2]; }
          if (labels) votes[Math.max(-1, labels[p]) + 1]++;
        }
      }
      if (!tot || fg * 2 < tot) continue;
      const q = y * CW + ox + x;
      outMask[q] = 1;
      if (rgb) { outRgb[q * 3] = r / fg; outRgb[q * 3 + 1] = g / fg; outRgb[q * 3 + 2] = b / fg; }
      if (labels) {
        // Prefer a real region over "unlabeled" on ties (edge pixels).
        let best = 0, bv = -1;
        for (let i = 0; i < votes.length; i++) if (votes[i] > bv || (votes[i] === bv && i > 0 && best === 0)) { bv = votes[i]; best = i; }
        outLab[q] = best - 1;
      }
    }
  }
  return { W: CW, H: TH, mask: outMask, rgb: outRgb, labels: outLab };
}

/** Two-pass 3-4 chamfer distance to the nearest set pixel. */
function chamfer(mask: Uint8Array, W: number, H: number): Float32Array {
  const INF = 1e9;
  const d = new Float32Array(W * H);
  for (let p = 0; p < W * H; p++) d[p] = mask[p] ? 0 : INF;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const p = y * W + x; let v = d[p];
    if (x > 0) v = Math.min(v, d[p - 1] + 3);
    if (y > 0) {
      v = Math.min(v, d[p - W] + 3);
      if (x > 0) v = Math.min(v, d[p - W - 1] + 4);
      if (x < W - 1) v = Math.min(v, d[p - W + 1] + 4);
    }
    d[p] = v;
  }
  for (let y = H - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) {
    const p = y * W + x; let v = d[p];
    if (x < W - 1) v = Math.min(v, d[p + 1] + 3);
    if (y < H - 1) {
      v = Math.min(v, d[p + W] + 3);
      if (x < W - 1) v = Math.min(v, d[p + W + 1] + 4);
      if (x > 0) v = Math.min(v, d[p + W - 1] + 4);
    }
    d[p] = v;
  }
  return d;
}

// ---------------------------------------------------------------------------
// main entry

/** Foreground = far from every background colour. With `hysteresis` (a
 *  single auto-estimated backdrop), pixels only HALF as far still count when
 *  they connect to a confident foreground pixel — how dark hair on a black
 *  backdrop survives: its shadowed strands are barely above the noise, but they
 *  touch the brighter strands. */
function segment(img: Rgb3, colors: Rgb[], tol: number[], frame = 0, hysteresis = false): Uint8Array {
  const { width: W, height: H, rgb } = img;
  const raw = new Uint8Array(W * H); // 2 = strong, 1 = weak, 0 = background
  const c = colors.map((x) => [x[0], x[1], x[2]]);
  const t2 = tol.map((t) => t * t);
  const w2 = tol.map((t) => Math.max(4, t * 0.5) ** 2);
  for (let p = 0; p < W * H; p++) {
    let v = 2;
    for (let k = 0; k < c.length; k++) {
      const d = dist2(rgb, p * 3, c[k], 0);
      if (d <= t2[k]) { v = hysteresis && d > w2[k] ? 1 : 0; if (!v) break; }
    }
    raw[p] = v;
  }
  if (frame > 0) {
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (x < frame || y < frame || x >= W - frame || y >= H - frame) raw[y * W + x] = 0;
    }
  }
  const mask = new Uint8Array(W * H);
  const stack: number[] = [];
  for (let p = 0; p < W * H; p++) if (raw[p] === 2) { mask[p] = 1; stack.push(p); }
  if (hysteresis) {
    while (stack.length) {
      const q = stack.pop()!;
      const qx = q % W, qy = (q - qx) / W;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = qy + dy; if (yy < 0 || yy >= H) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = qx + dx; if (xx < 0 || xx >= W) continue;
          const n = yy * W + xx;
          if (raw[n] === 1 && !mask[n]) { mask[n] = 1; stack.push(n); }
        }
      }
    }
  }
  return cleanMask(mask, W, H);
}

/** GrabCut-lite: colour-model segmentation for busy backdrops (halftone,
 *  scenery) where no single backdrop colour exists. The border band is
 *  definite background; everything inside starts as "probably subject". Each
 *  pass builds 16³-bin colour histograms of the current subject and backdrop,
 *  scores every inner pixel by log(p_subject / p_backdrop), box-blurs that
 *  score (a cheap smoothness term standing in for the graph cut) and
 *  re-labels. The result is cleaned like the border path (largest component +
 *  hole fill). Returns the mask and the margin the border band occupies. */
function segmentGrabcut(img: Rgb3, iterations = 6): { mask: Uint8Array; margin: number } {
  const { width: W, height: H, rgb } = img;
  const N = W * H;
  const margin = frameInset(W, H) + Math.max(2, Math.round(Math.min(W, H) * 0.04));
  const NB = 4096;
  const bin = new Int32Array(N);
  for (let p = 0; p < N; p++) {
    const q = (v: number) => Math.max(0, Math.min(15, Math.floor(v / 16)));
    bin[p] = (q(rgb[p * 3]) << 8) | (q(rgb[p * 3 + 1]) << 4) | q(rgb[p * 3 + 2]);
  }
  const hard = new Uint8Array(N);
  let fg = new Uint8Array(N);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const p = y * W + x;
    if (Math.min(x, y, W - 1 - x, H - 1 - y) < margin) hard[p] = 1; else fg[p] = 1;
  }
  // Histogram of the selected pixels, blurred ±1 bin per channel so unseen
  // neighbouring shades still get probability, then normalised (log).
  const hist = (sel: (p: number) => boolean): Float64Array => {
    let h = new Float64Array(NB);
    let n = 0;
    for (let p = 0; p < N; p++) if (sel(p)) { h[bin[p]]++; n++; }
    for (let axis = 0; axis < 3; axis++) {
      const sh = axis === 0 ? 0 : axis === 1 ? 4 : 8;
      const o = new Float64Array(NB);
      for (let i = 0; i < NB; i++) {
        const c = (i >> sh) & 15;
        let s = h[i] * 2;
        if (c > 0) s += h[i - (1 << sh)];
        if (c < 15) s += h[i + (1 << sh)];
        o[i] = s;
      }
      h = o;
    }
    const tot = Math.max(1, n * 64);
    const out = new Float64Array(NB);
    for (let i = 0; i < NB; i++) out[i] = Math.log((h[i] + 0.5) / tot);
    return out;
  };
  const score = new Float32Array(N);
  const tmp = new Float32Array(N);
  const r = Math.max(1, Math.round(Math.min(W, H) / 160));
  // Pass 0 has no subject model yet: a FLAT subject prior against the border
  // band's histogram, so colours common on the border start as backdrop and
  // rare ones as subject (a whole-interior subject init would be dominated by
  // the backdrop and invert). Later passes learn both models.
  const flat = new Float64Array(NB).fill(Math.log(1 / NB));
  for (let it = 0; it < iterations; it++) {
    const cur = fg;
    const hf = it === 0 ? flat : hist((p) => cur[p] === 1), hb = hist(it === 0 ? (p) => hard[p] === 1 : (p) => cur[p] === 0);
    for (let p = 0; p < N; p++) score[p] = hard[p] ? -8 : Math.max(-8, Math.min(8, hf[bin[p]] - hb[bin[p]]));
    // Separable box blur of the score.
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let s = 0, c = 0;
      for (let dx = -r; dx <= r; dx++) { const xx = x + dx; if (xx >= 0 && xx < W) { s += score[y * W + xx]; c++; } }
      tmp[y * W + x] = s / c;
    }
    const next = new Uint8Array(N);
    let changed = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const p = y * W + x;
      if (hard[p]) continue;
      let s = 0, c = 0;
      for (let dy = -r; dy <= r; dy++) { const yy = y + dy; if (yy >= 0 && yy < H) { s += tmp[yy * W + x]; c++; } }
      next[p] = s / c > 0 ? 1 : 0;
      if (next[p] !== cur[p]) changed++;
    }
    fg = next;
    if (changed < N * 0.001) break;
  }
  // Keep every sizeable piece, not just the largest: a part the backdrop's
  // colour (blue shorts on a blue backdrop) cuts the figure in two.
  const cleaned = cleanMask(fg, W, H, 0.04);
  // Bridge the cut: within each column, fill a short vertical run of backdrop
  // between two subject pixels of DIFFERENT pieces (jersey above, socks below
  // the backdrop-coloured shorts). Gaps between the legs or under the arms
  // have no subject below/above in the same column, so they stay open.
  const { id, sizes } = components(cleaned, W, H);
  if (sizes.length > 1) {
    const bb = maskBBox(cleaned, W, H)!;
    const maxGap = Math.round(bb.h * 0.25);
    for (let x = 0; x < W; x++) {
      let lastY = -1, lastId = -1;
      for (let y = 0; y < H; y++) {
        const p = y * W + x;
        if (!cleaned[p]) continue;
        if (lastY >= 0 && id[p] !== lastId && y - lastY - 1 <= maxGap) for (let yy = lastY + 1; yy < y; yy++) cleaned[yy * W + x] = 1;
        lastY = y; lastId = id[p];
      }
    }
  }
  return { mask: cleaned, margin };
}

/** Downsample (nearest) an exact label buffer to match `prepare`'s output. */
function prepareLabels(labels: Int32Array, img: RgbaImage, W: number, H: number): Int32Array {
  const out = new Int32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const sx = Math.min(img.width - 1, Math.floor((x + 0.5) * img.width / W));
    const sy = Math.min(img.height - 1, Math.floor((y + 0.5) * img.height / H));
    out[y * W + x] = labels[sy * img.width + sx];
  }
  return out;
}

const WORK_SIDE = 640; // working resolution cap (longer side) before segmentation

const fgFraction = (m: Uint8Array) => { let n = 0; for (let p = 0; p < m.length; p++) n += m[p]; return n / Math.max(1, m.length); };

interface MatchRegion { name: string; members: number[]; colors: Rgb[]; color: Rgb | null }

export function photoMatch(input: PhotoMatchInput): PhotoMatchResult {
  const T: PhotoMatchTuning = { ...PHOTO_MATCH_DEFAULTS, ...(input.tuning ?? {}) };
  const TH = Math.max(32, Math.round(T.targetHeight));
  const warnings: string[] = [];
  const baseRegions = (input.regions ?? []).map((r) => ({ name: r.name, color: parseColor(r.color) }));

  // --- photo segmentation ---
  const ref = prepare(input.reference, input.crop, WORK_SIDE);
  let refBg: { colors: Rgb[]; tol: number[] } = { colors: [], tol: [] };
  let refMask: Uint8Array;
  let method: string;
  let margin = 0;
  const bgGiven = parseColor(input.bg ?? null);
  const mode = input.bgMode ?? 'auto';
  if (input.mask) {
    refMask = prepareMask(input.mask, input.reference.width, input.reference.height, input.crop, ref.width, ref.height);
    method = 'mask';
  } else if (bgGiven) {
    // An explicit bg trusts the caller's crop edge to edge.
    refBg = { colors: [bgGiven], tol: [input.bgTolerance ?? T.bgTolerance] };
    refMask = segment(ref, refBg.colors, refBg.tol, 0, false);
    method = 'bg';
  } else if (mode === 'grabcut') {
    const g = segmentGrabcut(ref);
    refMask = g.mask; margin = g.margin; method = 'grabcut';
  } else {
    refBg = estimateBackground(ref, T.bgToleranceMin);
    if (input.bgTolerance != null) refBg.tol = refBg.tol.map(() => input.bgTolerance!);
    // An auto-estimated backdrop also clears the outer frame zone (a border
    // line there would otherwise join the subject and seal gaps like the one
    // between the legs).
    margin = frameInset(ref.width, ref.height);
    refMask = segment(ref, refBg.colors, refBg.tol, margin, refBg.colors.length === 1);
    method = 'border';
    if (mode === 'auto' && input.bgTolerance == null) {
      const busy = refBg.tol.some((x) => x >= T.busyBorderTolerance);
      const f = fgFraction(refMask);
      if (busy || f > 0.85 || f < 0.02) {
        const g = segmentGrabcut(ref);
        const gf = fgFraction(g.mask);
        if (gf >= 0.02 && gf <= 0.85) {
          refMask = g.mask; margin = g.margin; method = 'grabcut'; refBg = { colors: [], tol: [] };
          warnings.push(`photo backdrop is ${busy ? 'busy (no single border colour)' : 'not separable by its border colour'} — segmented with the colour model (bgMode 'grabcut'); if the outline still looks wrong, pass a manual mask.`);
        }
      }
    }
  }

  // --- model segmentation (labels = ORIGINAL region indices for now) ---
  const mod = prepare(input.model, null, WORK_SIDE);
  let modMask: Uint8Array;
  let modLabels: Int32Array;
  let modBg: { colors: Rgb[]; tol: number[] };
  if (input.modelLabels && input.modelLabels.length === input.model.width * input.model.height) {
    modLabels = prepareLabels(input.modelLabels, input.model, mod.width, mod.height);
    modMask = new Uint8Array(mod.width * mod.height);
    for (let p = 0; p < modMask.length; p++) modMask[p] = modLabels[p] !== -2 ? 1 : 0;
    modBg = { colors: [], tol: [] };
  } else {
    const mb = parseColor(input.modelBg ?? null);
    modBg = mb ? { colors: [mb], tol: [12] } : estimateBackground(mod, T.bgToleranceMin);
    modMask = segment(mod, modBg.colors, modBg.tol);
    // Region per pixel = nearest region colour (exact for a flat render).
    modLabels = new Int32Array(mod.width * mod.height).fill(-2);
    for (let p = 0; p < modMask.length; p++) {
      if (!modMask[p]) continue;
      let best = -1, bd = 40 * 40;
      for (let i = 0; i < baseRegions.length; i++) {
        const c = baseRegions[i].color; if (!c) continue;
        const d = dist2(mod.rgb, p * 3, c, 0);
        if (d < bd) { bd = d; best = i; }
      }
      modLabels[p] = best;
    }
  }

  // --- merge groups → the regions actually scored ---
  const { regions, remap } = mergeRegions(baseRegions, input.merge ?? [], modLabels, warnings);
  for (let p = 0; p < modLabels.length; p++) if (modLabels[p] >= 0) modLabels[p] = remap[modLabels[p]];
  const nR = regions.length;
  const ignored = new Uint8Array(nR);
  if (input.ignore?.length) {
    const unknown: string[] = [];
    for (const name of input.ignore) {
      const j = regions.findIndex((r) => r.name === name || r.members.some((m) => baseRegions[m].name === name));
      if (j < 0) unknown.push(name); else ignored[j] = 1;
    }
    if (unknown.length) warnings.push(`ignore: no region named ${unknown.join(', ')} (regions: ${regions.map((r) => r.name).join(', ') || 'none'}).`);
  }

  const segPhoto = segInfo(refBg.colors, refBg.tol, refMask, ref.width, ref.height, margin);
  segPhoto.method = method;
  const segModel = segInfo(modBg.colors, modBg.tol, modMask, mod.width, mod.height);
  segModel.method = 'render';
  const refBox = segPhoto.bbox, modBox = segModel.bbox;
  if (!refBox || !modBox) {
    const which = !refBox ? 'photo' : 'model render';
    return {
      silhouetteIoU: 0, aspect: { model: 0, photo: 0, ratio: 0 }, bands: [], regions: [],
      worst: [`No foreground found in the ${which} — check ${input.mask ? 'the mask' : 'bg/crop'}.`], outline: [],
      segmentation: { photo: segPhoto, model: segModel }, warnings: [...warnings, `empty ${which} silhouette`],
      normalized: { width: 0, height: 0, fit: input.fit === 'box' ? 'box' : 'height' },
    };
  }
  segPhoto.subjectPx = Math.round(refBox.h * ref.scale);
  if (T.minSubjectPx > 0 && segPhoto.subjectPx < T.minSubjectPx) {
    warnings.push(`photo subject is only ${segPhoto.subjectPx} px tall (< ${T.minSubjectPx}) — one source pixel is ${r1(100 / segPhoto.subjectPx)}% of the height, so outline/band offsets below ~${r1(200 / segPhoto.subjectPx)}% are noise; use a larger reference for fine work.`);
  }
  if (segPhoto.touchesEdges.length) warnings.push(`photo silhouette touches the ${segPhoto.touchesEdges.join('/')} edge — it may be truncated by the crop, which skews the normalisation (crop wider, or exclude the matching model part).`);
  if (method !== 'mask') {
    if (segPhoto.fgFraction > 0.85) warnings.push('photo foreground covers >85% of the frame — background estimation probably failed; pass bg (and bgTolerance), a mask, or a tighter crop.');
    if (segPhoto.fgFraction < 0.02) warnings.push('photo foreground covers <2% of the frame — the subject was mostly classified as background; pass bg/bgTolerance, a mask, or crop to the subject.');
  }

  const pixelAspect = input.pixelAspect && input.pixelAspect > 0 ? input.pixelAspect : 1;
  const refAspect = (refBox.w * pixelAspect) / refBox.h, modAspect = modBox.w / modBox.h;
  // fit 'height' (default): both scaled to a common height, aspect kept, so the
  // band widths carry the overall aspect error too. fit 'box': the model is
  // also stretched to the photo's width, so bands/regions compare PROPORTIONS
  // only — use it when the photo is stretched or strongly foreshortened.
  const boxFit = input.fit === 'box';
  const refTw = Math.max(1, Math.round(refAspect * TH));
  const modTw = boxFit ? refTw : Math.max(1, Math.round(modAspect * TH));
  const CW = Math.max(refTw, modTw) + 8;
  const R = normalize(refMask, ref.width, ref.height, refBox, TH, refTw, CW, ref.rgb, null, nR);
  const M = normalize(modMask, mod.width, mod.height, modBox, TH, modTw, CW, null, modLabels, nR);
  if (!boxFit && Math.abs(modAspect / refAspect - 1) > 0.25) {
    warnings.push(`overall aspect differs by ${Math.round(Math.abs(modAspect / refAspect - 1) * 100)}% — if the photo is stretched, cropped or strongly foreshortened, re-run with fit: 'box' to compare proportions independent of the overall aspect.`);
  }
  const N = CW * TH;

  // --- silhouette IoU ---
  let inter = 0, uni = 0;
  for (let p = 0; p < N; p++) { const a = R.mask[p], b = M.mask[p]; if (a && b) inter++; if (a || b) uni++; }
  const silhouetteIoU = uni ? inter / uni : 0;

  // --- region assignment on the photo ---
  // Group regions whose colours are near-identical (white jersey/socks/shoes):
  // they share one k-means cluster and are split spatially afterwards. A
  // merged region may carry several colours, so it can sit in several groups.
  const visible = new Uint8Array(nR);
  for (let p = 0; p < N; p++) if (M.labels[p] >= 0) visible[M.labels[p]] = 1;
  const groups: { color: Rgb; members: number[] }[] = [];
  const scored = new Uint8Array(nR);
  for (let i = 0; i < nR; i++) {
    // Only regions actually visible in this view seed a cluster.
    if (!visible[i] || !regions[i].colors.length) continue;
    scored[i] = 1;
    for (const c of regions[i].colors) {
      let g = groups.findIndex((G) => deltaE(G.color, c) < 6);
      if (g < 0) { g = groups.length; groups.push({ color: c, members: [] }); }
      if (!groups[g].members.includes(i)) groups[g].members.push(i);
    }
  }
  const refRegion = new Int32Array(N).fill(-2);
  const lowConf = new Map<number, Map<number, string>>(); // region → partner → reason
  const noteLow = (i: number, j: number, why: string) => {
    if (i === j) return;
    for (const [a, b] of [[i, j], [j, i]]) {
      if (!lowConf.has(a)) lowConf.set(a, new Map());
      if (!lowConf.get(a)!.has(b)) lowConf.get(a)!.set(b, why);
    }
  };
  if (groups.length) {
    const K = groups.length;
    const lab = new Float32Array(N * 3);
    const fgIdx: number[] = [];
    for (let p = 0; p < N; p++) if (R.mask[p]) { rgbToLab(R.rgb[p * 3], R.rgb[p * 3 + 1], R.rgb[p * 3 + 2], lab, p * 3); fgIdx.push(p); }
    const cen = new Float32Array(K * 3);
    groups.forEach((g, k) => rgbToLab(g.color[0], g.color[1], g.color[2], cen, k * 3));
    // Lightness counts half — photo shading darkens a white shirt in shadow far
    // more than it shifts its hue.
    const wL = 0.5;
    const d2 = (p: number, k: number) => {
      const a = (lab[p * 3] - cen[k * 3]) * wL, b = lab[p * 3 + 1] - cen[k * 3 + 1], c = lab[p * 3 + 2] - cen[k * 3 + 2];
      return a * a + b * b + c * c;
    };
    const asg = new Int32Array(N).fill(-1);
    let cnt = new Int32Array(K);
    for (let it = 0; it <= Math.max(0, T.kmeansIterations); it++) {
      const sum = new Float64Array(K * 3);
      cnt = new Int32Array(K);
      for (const p of fgIdx) {
        let bk = 0, bd = Infinity;
        for (let k = 0; k < K; k++) { const d = d2(p, k); if (d < bd) { bd = d; bk = k; } }
        asg[p] = bk; cnt[bk]++;
        sum[bk * 3] += lab[p * 3]; sum[bk * 3 + 1] += lab[p * 3 + 1]; sum[bk * 3 + 2] += lab[p * 3 + 2];
      }
      if (it === T.kmeansIterations) break;
      for (let k = 0; k < K; k++) if (cnt[k]) for (let j = 0; j < 3; j++) cen[k * 3 + j] = sum[k * 3 + j] / cnt[k];
    }
    // Spatial assignment: each photo pixel goes to the NEAREST model region of
    // its colour cluster (splits white jersey/socks/shoes apart) — unless even
    // that region is further than maxRegionDistance away, in which case the
    // pixel is a photo detail the model has no counterpart for (a ball's black
    // pentagons are not "hair") and stays unassigned (-1).
    const dt = new Map<number, Float32Array>();
    for (const g of groups) for (const i of g.members) {
      if (dt.has(i)) continue;
      const m = new Uint8Array(N); for (let p = 0; p < N; p++) if (M.labels[p] === i) m[p] = 1;
      dt.set(i, chamfer(m, CW, TH));
    }
    const maxD = T.maxRegionDistance * TH * 3; // chamfer units are 3 per pixel
    for (const p of fgIdx) {
      const g = groups[asg[p]];
      let bi = -1, bd = Infinity;
      for (const i of g.members) { const d = dt.get(i)![p]; if (d < bd) { bd = d; bi = i; } }
      refRegion[p] = bd <= maxD ? bi : -1;
    }

    // --- ambiguity: regions the photo can't tell apart ---
    if (T.ambiguousDeltaE > 0) {
      // (a) different colour clusters that converged onto near-identical
      //     photo colours (white jersey vs pale skin on a dim photo).
      for (let g = 0; g < K; g++) for (let h = g + 1; h < K; h++) {
        if (!cnt[g] || !cnt[h]) continue;
        const dE = Math.hypot((cen[g * 3] - cen[h * 3]) * wL, cen[g * 3 + 1] - cen[h * 3 + 1], cen[g * 3 + 2] - cen[h * 3 + 2]);
        if (dE >= T.ambiguousDeltaE) continue;
        for (const i of groups[g].members) for (const j of groups[h].members) noteLow(i, j, `photo colours ΔE ${Math.round(dE)}`);
      }
      // (a') a region whose photo pixels (those under the model region) look
      //      like ANOTHER cluster's colour: that cluster swallows them (white
      //      shorts on the photo vs blue in the model → the white jersey grows).
      const labDist = (l: ArrayLike<number>, k: number) => Math.hypot((l[0] - cen[k * 3]) * wL, l[1] - cen[k * 3 + 1], l[2] - cen[k * 3 + 2]);
      for (let i = 0; i < nR; i++) {
        if (!scored[i]) continue;
        let n = 0;
        const m = [0, 0, 0];
        for (let p = 0; p < N; p++) if (M.labels[p] === i && R.mask[p]) { m[0] += lab[p * 3]; m[1] += lab[p * 3 + 1]; m[2] += lab[p * 3 + 2]; n++; }
        if (n < 8) continue;
        m[0] /= n; m[1] /= n; m[2] /= n;
        let own = Infinity, other = -1, od = Infinity;
        for (let k = 0; k < K; k++) {
          const d = labDist(m, k);
          if (groups[k].members.includes(i)) own = Math.min(own, d);
          else if (cnt[k] && d < od) { od = d; other = k; }
        }
        if (other >= 0 && od < T.ambiguousDeltaE && od < own) {
          for (const j of groups[other].members) noteLow(i, j, `its photo colour matches ${regions[j].name}'s (ΔE ${Math.round(od)})`);
        }
      }
      // (b) regions sharing one colour cluster that TOUCH in the model: the
      //     split between them is decided by distance to the model regions,
      //     not by anything in the photo.
      const touch = new Map<number, number>();
      const add = (a: number, b: number) => { if (a < 0 || b < 0 || a === b) return; const k = Math.min(a, b) * nR + Math.max(a, b); touch.set(k, (touch.get(k) ?? 0) + 1); };
      for (let y = 0; y < TH; y++) for (let x = 0; x < CW; x++) {
        const p = y * CW + x;
        if (x + 1 < CW) add(M.labels[p], M.labels[p + 1]);
        if (y + 1 < TH) add(M.labels[p], M.labels[p + CW]);
      }
      const minTouch = Math.max(3, Math.round(TH * 0.02));
      for (const g of groups) for (let a = 0; a < g.members.length; a++) for (let b = a + 1; b < g.members.length; b++) {
        const i = g.members[a], j = g.members[b];
        if ((touch.get(Math.min(i, j) * nR + Math.max(i, j)) ?? 0) >= minTouch) noteLow(i, j, 'same colour, touching');
      }
    }
  }

  // --- per-region stats ---
  let refFg = 0, modFg = 0;
  for (let p = 0; p < N; p++) { refFg += R.mask[p]; modFg += M.mask[p]; }
  const regionResults: PhotoMatchRegionResult[] = [];
  for (let i = 0; i < nR; i++) {
    if (!scored[i] || ignored[i]) continue;
    // Extent = 2nd..98th percentile of the region's columns/rows, so a few
    // stray pixels (JPEG specks, mask-closing slivers) can't inflate it.
    const st = (sel: (p: number) => boolean) => {
      let n = 0, sx = 0, sy = 0;
      const hx = new Int32Array(CW), hy = new Int32Array(TH);
      for (let p = 0; p < N; p++) if (sel(p)) {
        const x = p % CW, y = (p - x) / CW; n++; sx += x; sy += y; hx[x]++; hy[y]++;
      }
      const span = (h: Int32Array) => {
        const lo = n * 0.02, hi = n * 0.98;
        let acc = 0, a = 0, b = h.length - 1;
        for (let k = 0; k < h.length; k++) { acc += h[k]; if (acc > lo) { a = k; break; } }
        acc = 0;
        for (let k = 0; k < h.length; k++) { acc += h[k]; if (acc >= hi) { b = k; break; } }
        return Math.max(1, b - a + 1);
      };
      return { n, cx: n ? sx / n : 0, cy: n ? sy / n : 0, w: n ? span(hx) : 0, h: n ? span(hy) : 0 };
    };
    const a = st((p) => M.labels[p] === i), b = st((p) => refRegion[p] === i);
    let ii = 0, uu = 0;
    for (let p = 0; p < N; p++) { const x = M.labels[p] === i, y = refRegion[p] === i; if (x && y) ii++; if (x || y) uu++; }
    const color = regions[i].color!;
    // The photo's colour for the region: the mean of the photo pixels assigned
    // to it when the assignment overlaps the model region well; otherwise (the
    // photo colour is so different that k-means put those pixels elsewhere)
    // the mean of the photo pixels sitting UNDER the model region.
    const iouI = uu ? ii / uu : 0;
    const under = iouI >= 0.2 ? (p: number) => refRegion[p] === i : (p: number) => M.labels[p] === i && R.mask[p] === 1;
    let cr = 0, cg = 0, cb = 0, cn = 0;
    for (let p = 0; p < N; p++) if (under(p)) { cr += R.rgb[p * 3]; cg += R.rgb[p * 3 + 1]; cb += R.rgb[p * 3 + 2]; cn++; }
    const photoColor: Rgb | null = cn ? [cr / cn, cg / cn, cb / cn] : null;
    const low = lowConf.get(i);
    regionResults.push({
      name: regions[i].name,
      color: toHex(color),
      photoColor: photoColor ? toHex(photoColor) : null,
      colorShift: photoColor ? r1(deltaE(color, photoColor, 0.5)) : null,
      iou: r3(uu ? ii / uu : 0),
      // Share of the figure, model vs photo — independent of the overall
      // aspect, which `aspect` and the band widths already report.
      areaRatio: b.n ? r3((a.n / Math.max(1, modFg)) / (b.n / Math.max(1, refFg))) : null,
      widthRatio: b.n ? r3(a.w / b.w) : null,
      heightRatio: b.n ? r3(a.h / b.h) : null,
      dx: b.n ? r1(((a.cx - b.cx) / TH) * 100) : null,
      dy: b.n ? r1(((a.cy - b.cy) / TH) * 100) : null,
      modelShare: r1((a.n / Math.max(1, modFg)) * 100),
      photoShare: r1((b.n / Math.max(1, refFg)) * 100),
      ...(low ? { lowConfidence: `can't be separated in the photo from ${[...low.entries()].map(([j, why]) => `${regions[j].name} (${why})`).join(', ')}` } : {}),
    });
  }
  if (lowConf.size) {
    const pairs: string[] = [];
    const seen = new Set<string>();
    for (const [i, m] of lowConf) for (const [j, why] of m) {
      if (ignored[i] && ignored[j]) continue;
      const key = [i, j].sort((x, y) => x - y).join('~');
      if (seen.has(key)) continue;
      seen.add(key);
      pairs.push(`${regions[Math.min(i, j)].name}~${regions[Math.max(i, j)].name} (${why})`);
    }
    if (pairs.length) {
      const ex = [...seen][0].split('~').map((k) => JSON.stringify(regions[Number(k)].name)).join(',');
      warnings.push(`low-confidence regions — the photo can't separate ${pairs.slice(0, 6).join('; ')}${pairs.length > 6 ? '; …' : ''}. Their size/position findings are suppressed; merge them (merge [[${ex}]]) or ignore them.`);
    }
  }

  // --- bands: widths, centre, outer edges, interior gaps ---
  const B = Math.max(1, Math.min(Math.floor(TH / 2), Math.round(T.bands)));
  const bands: PhotoMatchBand[] = [];
  const pctH = (v: number) => r1((v / TH) * 100);
  for (let k = 0; k < B; k++) {
    const ya = Math.floor((k * TH) / B), yb = Math.floor(((k + 1) * TH) / B);
    let rw = 0, rc = 0, rn = 0, mw = 0, mc = 0, mn = 0, bi = 0, bu = 0;
    let sumL = 0, sumR = 0, nBoth = 0, inPhoto = 0, inModel = 0;
    const votes = new Map<number, number>();
    for (let y = ya; y < yb; y++) {
      let rl = -1, rr = -1, ml = -1, mr = -1;
      for (let x = 0; x < CW; x++) {
        const p = y * CW + x;
        if (R.mask[p]) { if (rl < 0) rl = x; rr = x; }
        if (M.mask[p]) { if (ml < 0) ml = x; mr = x; if (M.labels[p] >= 0) votes.set(M.labels[p], (votes.get(M.labels[p]) ?? 0) + 1); }
        if (R.mask[p] && M.mask[p]) bi++;
        if (R.mask[p] || M.mask[p]) bu++;
      }
      if (rl >= 0) { rw += rr - rl + 1; rc += (rl + rr) / 2; rn++; }
      if (ml >= 0) { mw += mr - ml + 1; mc += (ml + mr) / 2; mn++; }
      if (rl >= 0 && ml >= 0) {
        sumL += rl - ml; sumR += mr - rr; nBoth++;
        for (let x = Math.max(ml, rl); x <= Math.min(mr, rr); x++) {
          const p = y * CW + x;
          if (R.mask[p] && !M.mask[p]) inPhoto++;
          else if (M.mask[p] && !R.mask[p]) inModel++;
        }
      }
    }
    const rows = Math.max(1, yb - ya);
    const refWidth = rn ? rw / rn : 0, modelWidth = mn ? mw / mn : 0;
    const tot = [...votes.values()].reduce((s, v) => s + v, 0);
    const names = [...votes.entries()].sort((x, y) => y[1] - x[1]).filter(([, v], j) => j === 0 || v >= tot * 0.25).slice(0, 3).map(([i]) => regions[i].name);
    bands.push({
      band: k,
      name: names.join('/') || bandPosition(k, B),
      refWidth: pctH(refWidth),
      modelWidth: pctH(modelWidth),
      widthDiffPct: refWidth ? r1(((modelWidth - refWidth) / refWidth) * 100) : (modelWidth ? 100 : 0),
      dx: rn && mn ? pctH(mc / mn - rc / rn) : 0,
      iou: r3(bu ? bi / bu : 0),
      left: nBoth ? pctH(sumL / nBoth) : 0,
      right: nBoth ? pctH(sumR / nBoth) : 0,
      innerPhotoOnly: pctH(inPhoto / rows),
      innerModelOnly: pctH(inModel / rows),
    });
  }

  const aspect = { model: r3(modAspect), photo: r3(refAspect), ratio: r3(modAspect / refAspect) };
  const worst = buildFindings(aspect, bands, regionResults, T);
  return {
    silhouetteIoU: r3(silhouetteIoU),
    aspect,
    bands,
    regions: regionResults,
    worst,
    outline: buildOutline(bands, T),
    segmentation: { photo: segPhoto, model: segModel },
    warnings,
    normalized: { width: CW, height: TH, fit: boxFit ? 'box' : 'height' },
    ...(input.debug ? { debug: { width: CW, height: TH, photo: photoMap(R.mask, refRegion), model: M.labels } } : {}),
  };
}

/** Collapse `merge` groups into single scored regions. Returns the scored
 *  regions and the original-index → scored-index map. A merged region keeps
 *  every distinct member colour (each seeds the photo clustering) and shows
 *  the colour of its largest member. */
function mergeRegions(base: { name: string; color: Rgb | null }[], merge: readonly (readonly string[])[], labels: Int32Array, warnings: string[]): { regions: MatchRegion[]; remap: Int32Array } {
  const area = new Float64Array(base.length);
  for (let p = 0; p < labels.length; p++) if (labels[p] >= 0 && labels[p] < base.length) area[labels[p]]++;
  const groupOf = new Int32Array(base.length).fill(-1);
  const unknown: string[] = [];
  merge.forEach((group, g) => {
    for (const name of group) {
      const i = base.findIndex((r) => r.name === name);
      if (i < 0) unknown.push(name);
      else if (groupOf[i] < 0) groupOf[i] = g;
    }
  });
  if (unknown.length) warnings.push(`merge: no region named ${unknown.join(', ')} (regions: ${base.map((r) => r.name).join(', ') || 'none'}).`);
  const regions: MatchRegion[] = [];
  const remap = new Int32Array(base.length).fill(-1);
  const groupIndex = new Map<number, number>();
  for (let i = 0; i < base.length; i++) {
    const g = groupOf[i];
    if (g >= 0 && groupIndex.has(g)) { remap[i] = groupIndex.get(g)!; regions[remap[i]].members.push(i); continue; }
    remap[i] = regions.length;
    if (g >= 0) groupIndex.set(g, regions.length);
    regions.push({ name: base[i].name, members: [i], colors: [], color: null });
  }
  for (const r of regions) {
    if (r.members.length > 1) r.name = r.members.map((m) => base[m].name).join('+');
    const byArea = [...r.members].sort((a, b) => area[b] - area[a]);
    for (const m of byArea) {
      const c = base[m].color;
      if (c && !r.colors.some((x) => x[0] === c[0] && x[1] === c[1] && x[2] === c[2])) r.colors.push(c);
    }
    r.color = r.colors[0] ?? null;
  }
  return { regions, remap };
}

/** Multi-view summary: mean / minimum silhouette IoU and the per-view
 *  findings interleaved (each prefixed with its view label). */
export interface PhotoMatchCombined {
  /** Mean silhouette IoU over the views — the single number to watch. */
  silhouetteIoU: number;
  minIoU: number;
  views: { label: string; silhouetteIoU: number }[];
  worst: string[];
  warnings: string[];
}

export function combinePhotoMatches(views: readonly { label: string; result: PhotoMatchResult }[], maxWorst = 6): PhotoMatchCombined {
  const ious = views.map((v) => v.result.silhouetteIoU);
  const lists = views.map((v) => v.result.worst.filter((w) => w !== 'no significant mismatch found').map((w) => `[${v.label}] ${w}`));
  const worst: string[] = [];
  for (let k = 0; worst.length < maxWorst && lists.some((l) => k < l.length); k++) {
    for (const l of lists) if (k < l.length && worst.length < maxWorst) worst.push(l[k]);
  }
  return {
    silhouetteIoU: ious.length ? r3(ious.reduce((s, v) => s + v, 0) / ious.length) : 0,
    minIoU: ious.length ? r3(Math.min(...ious)) : 0,
    views: views.map((v) => ({ label: v.label, silhouetteIoU: v.result.silhouetteIoU })),
    worst: worst.length ? worst : ['no significant mismatch found'],
    warnings: views.flatMap((v) => v.result.warnings.map((w) => `[${v.label}] ${w}`)),
  };
}

/** Text outline diff from the per-band edge offsets: runs of consecutive
 *  bands where one outline sticks out past the other on the same side, most
 *  severe first, capped at `outlineMaxLines`. */
function buildOutline(bands: PhotoMatchBand[], T: PhotoMatchTuning): string[] {
  type Pick = (b: PhotoMatchBand) => number; // signed: < 0 photo-only, > 0 model-only
  const sides: { side: string; pick: Pick }[] = [
    { side: 'left', pick: (b) => b.left },
    { side: 'right', pick: (b) => b.right },
    { side: 'inside', pick: (b) => (b.innerModelOnly >= b.innerPhotoOnly ? b.innerModelOnly : -b.innerPhotoOnly) },
  ];
  const out: { score: number; text: string }[] = [];
  for (const { side, pick } of sides) {
    let k = 0;
    while (k < bands.length) {
      const v = pick(bands[k]);
      if (Math.abs(v) < T.outlineMinPct || bands[k].refWidth === 0) { k++; continue; }
      const sign = Math.sign(v);
      let j = k;
      while (j + 1 < bands.length && bands[j + 1].refWidth > 0 && Math.sign(pick(bands[j + 1])) === sign && Math.abs(pick(bands[j + 1])) >= T.outlineMinPct) j++;
      const run = bands.slice(k, j + 1);
      const max = Math.max(...run.map((b) => Math.abs(pick(b))));
      const names = [...new Set(run.flatMap((b) => b.name.split('/')))].slice(0, 3).join('/');
      const range = k === j ? `band ${k}` : `bands ${k}–${j}`;
      const kind = sign < 0 ? 'photo-only' : 'model-only';
      const hint = side === 'inside'
        ? (sign < 0 ? 'model has a gap the photo fills' : 'photo has a gap the model fills')
        : (sign < 0 ? 'grow' : 'trim');
      out.push({ score: max * Math.sqrt(run.length), text: `${kind} ${side === 'inside' ? `inside ${range}` : `at ${range} ${side}`}: ${run.length > 1 ? 'up to ' : ''}${r1(max)}% of height (${names}) → ${hint}` });
      k = j + 1;
    }
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, Math.max(0, Math.round(T.outlineMaxLines))).map((o) => o.text);
}

/** Render the debug maps as one RGBA strip of three panels — photo regions,
 *  model regions, and the silhouette diff (grey = both, red = photo only,
 *  blue = model only) — for a checkpoint look without a full re-render. */
export function photoMatchOverlay(debug: NonNullable<PhotoMatchResult['debug']>, regionColors: readonly (Rgb | string | null)[]): RgbaImage {
  const { width: w, height: h, photo, model } = debug;
  const gap = 4, W = w * 3 + gap * 2;
  const data = new Uint8ClampedArray(W * h * 4).fill(255);
  // Region panels sit on pale green so white and black regions both read.
  const cols = regionColors.map((c) => parseColor(c));
  const put = (x: number, y: number, c: ArrayLike<number>) => { const o = (y * W + x) * 4; data[o] = c[0]; data[o + 1] = c[1]; data[o + 2] = c[2]; data[o + 3] = 255; };
  const regionColor = (v: number): ArrayLike<number> => (v >= 0 ? cols[v] ?? [150, 150, 150] : v === -1 ? [150, 150, 150] : [190, 220, 190]);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const p = y * w + x;
    put(x, y, regionColor(photo[p]));
    put(x + w + gap, y, regionColor(model[p]));
    const a = photo[p] !== -2, b = model[p] !== -2;
    put(x + 2 * (w + gap), y, a && b ? [170, 170, 170] : a ? [220, 40, 40] : b ? [40, 80, 220] : [255, 255, 255]);
  }
  return { width: W, height: h, data };
}

/** Per-pixel photo map for debug output: -2 bg, -1 fg with no region, ≥0 region. */
function photoMap(mask: Uint8Array, region: Int32Array): Int32Array {
  const out = new Int32Array(mask.length);
  for (let p = 0; p < mask.length; p++) out[p] = mask[p] ? Math.max(-1, region[p]) : -2;
  return out;
}

function bandPosition(k: number, B: number): string {
  const f = (k + 0.5) / B;
  return f < 0.2 ? 'top' : f < 0.4 ? 'upper' : f < 0.6 ? 'middle' : f < 0.8 ? 'lower' : 'bottom';
}

interface Finding { score: number; text: string }

/** Rank the actionable discrepancies and phrase the top few in plain words. */
function buildFindings(aspect: PhotoMatchResult['aspect'], bands: PhotoMatchBand[], regions: PhotoMatchRegionResult[], T: PhotoMatchTuning): string[] {
  const out: Finding[] = [];
  const pct = (v: number) => `${Math.round(Math.abs(v))}%`;

  // Aspect: the whole silhouette is too tall/narrow or too squat/wide.
  const ad = (aspect.ratio - 1) * 100;
  if (Math.abs(ad) >= 5) {
    out.push({ score: Math.abs(ad) * 1.3, text: `silhouette ${ad < 0 ? 'too tall/narrow' : 'too wide/squat'}: aspect (w/h) ${aspect.model.toFixed(2)} vs photo ${aspect.photo.toFixed(2)}` });
  }

  // Width profile: merge consecutive bands that are off in the same direction.
  const TH_BAND = 8;
  let k = 0;
  while (k < bands.length) {
    const b = bands[k];
    const sign = Math.sign(b.widthDiffPct);
    if (Math.abs(b.widthDiffPct) < TH_BAND || b.refWidth === 0) { k++; continue; }
    let j = k;
    while (j + 1 < bands.length && Math.sign(bands[j + 1].widthDiffPct) === sign && Math.abs(bands[j + 1].widthDiffPct) >= TH_BAND && bands[j + 1].refWidth > 0) j++;
    const run = bands.slice(k, j + 1);
    const avg = run.reduce((s, x) => s + x.widthDiffPct, 0) / run.length;
    const names = [...new Set(run.flatMap((x) => x.name.split('/')))].slice(0, 3).join('/');
    const range = k === j ? `band ${k}` : `bands ${k}–${j}`;
    // Long runs matter more; cap so one huge outlier band doesn't drown the rest.
    const mag = Math.min(Math.abs(avg), 60);
    // Band widths are the most robust signal (pure silhouette, no colour).
    // Long runs (fine --bands) list their ends only, to keep the line short.
    const vals = run.map((x) => `${x.modelWidth}/${x.refWidth}`);
    const shown = vals.length > 4 ? [vals[0], vals[1], '…', vals[vals.length - 1]] : vals;
    out.push({ score: mag * 1.5 * (1 + 0.15 * (run.length - 1)), text: `${names}: model ${pct(avg)} ${avg < 0 ? 'narrower' : 'wider'} across ${range} (${shown.join(', ')} % of height, model/photo)` });
    k = j + 1;
  }
  for (const b of bands) {
    if (Math.abs(b.dx) >= 4 && b.refWidth > 0) out.push({ score: Math.abs(b.dx) * 2, text: `band ${b.band} (${b.name}): model shifted ${b.dx > 0 ? 'right' : 'left'} by ${Math.abs(b.dx)}% of height` });
  }

  for (const r of regions) {
    // Weight by how much of the figure the region covers, but keep small,
    // likeness-critical parts (shoes, eyes) in play.
    const share = Math.max(r.modelShare, r.photoShare);
    const w = Math.min(1, Math.max(0.2, Math.sqrt(share / 10)));
    // Shape stats of tiny regions (pupils, trims, numerals) are dominated by
    // a few pixels of misalignment — only colour findings apply to them.
    const shapeOk = share >= 1.5;
    if (r.colorShift != null && r.colorShift >= T.colorShiftWarn && (r.iou < 0.2 || r.photoShare >= 0.5)) {
      out.push({ score: Math.min(r.colorShift, 80) * 0.8 * w + (r.iou < 0.2 ? 10 : 0), text: `${r.name}: colour mismatch — photo shows ${r.photoColor} where the model has ${r.color} (ΔE ${Math.round(r.colorShift)})` });
    }
    if (r.areaRatio == null) {
      if (r.modelShare >= 1 && r.photoColor == null) out.push({ score: 20 + r.modelShare, text: `${r.name}: present in the model (${r.modelShare}% of silhouette) but no matching colour found in the photo` });
      continue;
    }
    // A region the photo can't separate from its neighbour has no reliable
    // shape — its size/position numbers measure the split, not the figure.
    if (!shapeOk || r.lowConfidence) continue;
    // Magnitudes are scored in log space so "half the size" and "twice the
    // size" weigh the same.
    const logPct = (ratio: number) => Math.abs(Math.log(ratio)) * 100;
    const ar = r.areaRatio;
    if (ar < 0.8 || ar > 1.25) {
      const d = (ar - 1) * 100;
      out.push({ score: Math.min(logPct(ar), 80) * w * 0.8, text: `${r.name}: model region ${pct(d)} ${d < 0 ? 'smaller' : 'larger'} (area ${r.modelShare}% vs ${r.photoShare}% of silhouette)` });
    }
    if (r.widthRatio != null && (r.widthRatio < 0.85 || r.widthRatio > 1.18)) {
      const d = (r.widthRatio - 1) * 100;
      out.push({ score: Math.min(logPct(r.widthRatio), 60) * w * 0.9, text: `${r.name}: model ${pct(d)} ${d < 0 ? 'narrower' : 'wider'} than in the photo` });
    }
    if (r.heightRatio != null && (r.heightRatio < 0.85 || r.heightRatio > 1.18)) {
      const d = (r.heightRatio - 1) * 100;
      out.push({ score: Math.min(logPct(r.heightRatio), 60) * w * 0.9, text: `${r.name}: model ${pct(d)} ${d < 0 ? 'shorter' : 'taller'} than in the photo` });
    }
    const off = Math.hypot(r.dx ?? 0, r.dy ?? 0);
    if (off >= 4) {
      const parts: string[] = [];
      if (Math.abs(r.dy ?? 0) >= 2.5) parts.push(`${Math.abs(r.dy!)}% of height too ${r.dy! > 0 ? 'low' : 'high'}`);
      if (Math.abs(r.dx ?? 0) >= 2.5) parts.push(`${Math.abs(r.dx!)}% too far ${r.dx! > 0 ? 'right' : 'left'}`);
      out.push({ score: off * 2 * w, text: `${r.name}: model sits ${parts.join(' and ')}` });
    }
  }
  out.sort((a, b) => b.score - a.score);
  const top = out.filter((f) => f.score >= 6).slice(0, 5).map((f) => f.text);
  return top.length ? top : ['no significant mismatch found'];
}

// ---------------------------------------------------------------------------
// helpers shared by the browser API and the CLI

/** Group triangles into match regions: by label name when the triangle has
 *  one, otherwise by its colour (`#rrggbb`). Excluded labels map to -3 (the
 *  caller drops those triangles from the render). Region colour = the most
 *  common colour of its triangles. */
export function buildTriangleRegions(
  numTri: number,
  triColors: ArrayLike<number> | null,
  triLabel: ArrayLike<number> | null,
  labelNames: readonly string[],
  exclude: readonly string[] = [],
  /** Optional per-triangle "is coloured" flags (the viewport's `_painted`):
   *  a 0 means the triangle's colour slot is a placeholder, not a colour. */
  painted: ArrayLike<number> | null = null,
): { regions: { name: string; color: string }[]; triRegion: Int32Array } {
  const ex = new Set(exclude);
  const triRegion = new Int32Array(numTri).fill(-1);
  const index = new Map<string, number>();
  const counts: Map<number, number>[] = [];
  const names: string[] = [];
  for (let t = 0; t < numTri; t++) {
    const li = triLabel ? triLabel[t] : -1;
    const label = li >= 0 ? labelNames[li] : null;
    if (label && ex.has(label)) { triRegion[t] = -3; continue; }
    const hasCol = !!triColors && (!painted || painted[t] === 1);
    const col = hasCol ? (triColors![t * 3] << 16) | (triColors![t * 3 + 1] << 8) | triColors![t * 3 + 2] : -1;
    const key = label ?? (col >= 0 ? `color ${toHex([triColors![t * 3], triColors![t * 3 + 1], triColors![t * 3 + 2]])}` : null);
    if (!key) continue;
    if (!label && key && ex.has(key)) { triRegion[t] = -3; continue; }
    let r = index.get(key);
    if (r === undefined) { r = names.length; index.set(key, r); names.push(key); counts.push(new Map()); }
    triRegion[t] = r;
    if (col >= 0) counts[r].set(col, (counts[r].get(col) ?? 0) + 1);
  }
  const regions = names.map((name, i) => {
    let best = -1, bc = -1;
    for (const [c, n] of counts[i]) if (n > bc) { bc = n; best = c; }
    return { name, color: best >= 0 ? toHex([(best >> 16) & 255, (best >> 8) & 255, best & 255]) : '' };
  });
  return { regions, triRegion };
}
