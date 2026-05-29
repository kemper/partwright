export interface SvgFillMask {
  /** Per-cell mask, length = width*height, 1 where this fill covers the cell. */
  mask: Uint8Array;
  /** Fill colour as 0..1 RGB. */
  color: [number, number, number];
  /** Source fill string (e.g. "#1a2b3c", "rgb(...)") — for region naming. */
  source: string;
}

export interface ParsedSvgTile {
  /** Grid resolution (width = the caller's `resolution` cap; height keeps SVG aspect). */
  width: number;
  height: number;
  /** Union of all fills (1 = any fill present at the cell). Used by the tile
   *  builder as the SHAPE mask for an SVG-shaped silhouette tile. */
  unionMask: Uint8Array;
  /** Per-fill masks in SVG document order. Z-order is respected via colour-
   *  matching the fully-rendered image rather than isolating each fill in turn,
   *  so a path covered by a later opaque path produces a mask only where it
   *  remains visible at the end. */
  fills: SvgFillMask[];
}

const NAMED_COLORS: Record<string, [number, number, number]> = {
  black: [0, 0, 0],
  white: [255, 255, 255],
  red: [255, 0, 0],
  green: [0, 128, 0],
  lime: [0, 255, 0],
  blue: [0, 0, 255],
  yellow: [255, 255, 0],
  orange: [255, 165, 0],
  purple: [128, 0, 128],
  magenta: [255, 0, 255],
  fuchsia: [255, 0, 255],
  cyan: [0, 255, 255],
  aqua: [0, 255, 255],
  gray: [128, 128, 128],
  grey: [128, 128, 128],
  silver: [192, 192, 192],
  maroon: [128, 0, 0],
  olive: [128, 128, 0],
  navy: [0, 0, 128],
  teal: [0, 128, 128],
  pink: [255, 192, 203],
  brown: [165, 42, 42],
};

const FILL_BEARING_TAGS = new Set([
  'path',
  'rect',
  'circle',
  'ellipse',
  'polygon',
  'polyline',
]);

const COLOR_MATCH_TOLERANCE = 12;

function emptyTile(width: number, height: number): ParsedSvgTile {
  return {
    width,
    height,
    unionMask: new Uint8Array(width * height),
    fills: [],
  };
}

function clampResolution(resolution: number): number {
  if (!Number.isFinite(resolution)) return 8;
  return Math.max(8, Math.min(1024, Math.round(resolution)));
}

function parseColorComponent(c: string): number | null {
  const s = c.trim();
  if (s.endsWith('%')) {
    const v = parseFloat(s.slice(0, -1));
    if (!Number.isFinite(v)) return null;
    return Math.max(0, Math.min(255, Math.round((v / 100) * 255)));
  }
  const v = parseFloat(s);
  if (!Number.isFinite(v)) return null;
  return Math.max(0, Math.min(255, Math.round(v)));
}

/** Resolve an SVG fill string to RGB bytes. Returns null when the fill is "none"
 *  or otherwise unresolvable (gradients/url() references fall through to mid-grey
 *  in the caller). */
function resolveFillRGB(raw: string): [number, number, number] | null {
  const s = raw.trim().toLowerCase();
  if (!s || s === 'none' || s === 'transparent') return null;

  if (s.startsWith('#')) {
    const hex = s.slice(1);
    if (hex.length === 3) {
      const r = parseInt(hex[0] + hex[0], 16);
      const g = parseInt(hex[1] + hex[1], 16);
      const b = parseInt(hex[2] + hex[2], 16);
      if ([r, g, b].some(v => Number.isNaN(v))) return null;
      return [r, g, b];
    }
    if (hex.length === 6) {
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      if ([r, g, b].some(v => Number.isNaN(v))) return null;
      return [r, g, b];
    }
    return null;
  }

  const rgbMatch = /^rgba?\(([^)]+)\)$/.exec(s);
  if (rgbMatch) {
    const parts = rgbMatch[1].split(/[,\s]+/).filter(Boolean);
    if (parts.length < 3) return null;
    const r = parseColorComponent(parts[0]);
    const g = parseColorComponent(parts[1]);
    const b = parseColorComponent(parts[2]);
    if (r === null || g === null || b === null) return null;
    return [r, g, b];
  }

  if (s in NAMED_COLORS) return NAMED_COLORS[s];

  return null;
}

/** Read the fill from an element, honoring inline `style="fill:..."` over the
 *  `fill` attribute. An element with NO explicit fill but a non-none `stroke`
 *  is treated as no-fill (otherwise outline-only icon sets register a phantom
 *  black region covering just the stroke pixels). Plain elements with neither
 *  fill nor stroke default to "black" per SVG. */
function readFill(el: Element): string {
  const style = el.getAttribute('style');
  if (style) {
    const m = /(?:^|;)\s*fill\s*:\s*([^;]+)/i.exec(style);
    if (m) return m[1].trim();
  }
  const attr = el.getAttribute('fill');
  if (attr !== null) return attr.trim();
  const strokeAttr = el.getAttribute('stroke');
  const styleStroke = style ? /(?:^|;)\s*stroke\s*:\s*([^;]+)/i.exec(style) : null;
  const strokeVal = styleStroke ? styleStroke[1].trim() : strokeAttr;
  if (strokeVal && strokeVal.toLowerCase() !== 'none') return 'none';
  return 'black';
}

function collectUniqueFills(doc: Document): Array<{ source: string; rgb: [number, number, number] }> {
  const fills: Array<{ source: string; rgb: [number, number, number] }> = [];
  const seen = new Set<string>();
  const all = doc.querySelectorAll('*');
  for (let i = 0; i < all.length; i++) {
    const el = all[i];
    const tag = el.tagName.toLowerCase();
    if (!FILL_BEARING_TAGS.has(tag)) continue;
    const source = readFill(el);
    const lower = source.toLowerCase();
    if (lower === 'none' || lower === 'transparent') continue;
    let rgb = resolveFillRGB(source);
    // Gradient and other url() references can't be resolved without rendering;
    // assign mid-grey as a representative so the path still produces a region.
    // Surface a console warning so a user sees why their gradient SVG imports
    // imperfectly (the colour-match mask only catches mid-grey pixels).
    if (!rgb) {
      if (/^url\(/i.test(source)) {
        console.warn(`SVG import: gradient/url() fill ${source} is not resolved — using mid-grey. Flatten gradients to solid fills for crisp regions.`);
      }
      rgb = [128, 128, 128];
    }
    const key = `${rgb[0]},${rgb[1]},${rgb[2]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    fills.push({ source, rgb });
  }
  return fills;
}

function parseLengthPx(raw: string | null): number | null {
  if (!raw) return null;
  const m = /^\s*([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)/.exec(raw);
  if (!m) return null;
  const v = parseFloat(m[1]);
  if (!Number.isFinite(v) || v <= 0) return null;
  return v;
}

function readSvgDimensions(doc: Document): { w: number; h: number } | null {
  const root = doc.documentElement;
  if (!root || root.tagName.toLowerCase() !== 'svg') return null;
  const vb = root.getAttribute('viewBox');
  if (vb) {
    const parts = vb.trim().split(/[\s,]+/).map(Number);
    if (parts.length >= 4 && parts.slice(0, 4).every(Number.isFinite)) {
      const w = parts[2];
      const h = parts[3];
      if (w > 0 && h > 0) return { w, h };
    }
  }
  const w = parseLengthPx(root.getAttribute('width'));
  const h = parseLengthPx(root.getAttribute('height'));
  if (w !== null && h !== null) return { w, h };
  return null;
}

async function rasterizeSvg(svgText: string, width: number, height: number): Promise<ImageData | null> {
  const blob = new Blob([svgText], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement | null>(resolve => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => resolve(null);
      el.src = url;
    });
    if (!img) return null;

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.imageSmoothingEnabled = true;
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    return ctx.getImageData(0, 0, width, height);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Build a per-fill mask by matching each pixel of the fully-rendered SVG against
 *  the fill's resolved RGB. Anti-aliased boundary pixels between two fills land
 *  in neither mask (their colour is the interpolation of both), leaving a
 *  one-cell-wide gap that the union mask still covers and the downstream tile
 *  builder treats as a clean boundary. */
function colorMatchMask(
  image: ImageData,
  rgb: [number, number, number],
  tol: number,
): Uint8Array {
  const { width, height, data } = image;
  const out = new Uint8Array(width * height);
  const tol2 = tol * tol;
  const [tr, tg, tb] = rgb;
  for (let i = 0, p = 0; i < out.length; i++, p += 4) {
    const a = data[p + 3];
    if (a < 128) continue;
    const dr = data[p] - tr;
    const dg = data[p + 1] - tg;
    const db = data[p + 2] - tb;
    if (dr * dr + dg * dg + db * db <= tol2) out[i] = 1;
  }
  return out;
}

/** Parse SVG text and rasterise each unique fill colour into a binary cell mask
 *  at the requested grid resolution. Discards strokes-only paths, gradients,
 *  masks, and clip-paths. Returns one mask per UNIQUE fill colour (paths with
 *  the same fill are merged into one mask). Browser SVG rasterisation runs
 *  through `<img>` + canvas, which is inherently async, so this returns a
 *  Promise. */
export async function parseSvgToTile(svgText: string, resolution: number): Promise<ParsedSvgTile> {
  if (typeof svgText !== 'string' || svgText.trim().length === 0) {
    return emptyTile(clampResolution(resolution), 1);
  }

  const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
  // DOMParser surfaces failures by inserting a <parsererror> child rather than
  // throwing — promote it to a real exception so callers see a clear message.
  const parserError = doc.querySelector('parsererror');
  if (parserError) {
    const detail = parserError.textContent?.trim().split('\n')[0] ?? 'unknown error';
    throw new Error(`SVG parse error: ${detail}`);
  }

  const dims = readSvgDimensions(doc);
  if (!dims) return emptyTile(clampResolution(resolution), 1);

  const width = clampResolution(resolution);
  const height = Math.max(1, Math.round(width * (dims.h / dims.w)));

  const fillsMeta = collectUniqueFills(doc);
  if (fillsMeta.length === 0) return emptyTile(width, height);

  const image = await rasterizeSvg(svgText, width, height);
  if (!image) return emptyTile(width, height);

  const fills: SvgFillMask[] = [];
  for (const meta of fillsMeta) {
    const mask = colorMatchMask(image, meta.rgb, COLOR_MATCH_TOLERANCE);
    let hasAny = false;
    for (let i = 0; i < mask.length; i++) { if (mask[i]) { hasAny = true; break; } }
    if (!hasAny) continue;
    fills.push({
      mask,
      color: [meta.rgb[0] / 255, meta.rgb[1] / 255, meta.rgb[2] / 255],
      source: meta.source,
    });
  }

  const unionMask = new Uint8Array(width * height);
  for (const f of fills) {
    const m = f.mask;
    for (let i = 0; i < m.length; i++) if (m[i]) unionMask[i] = 1;
  }

  return { width, height, unionMask, fills };
}
