/**
 * Text-to-geometry helpers for the manifold-js sandbox.
 *
 * Lazy-loads opentype.js + Liberation Sans font files on first use
 * (same font set the OpenSCAD engine uses), then converts glyph outlines
 * into Vec2[][] contours suitable for CrossSection.ofPolygons().
 *
 * The Worker pre-loads fonts before calling manifoldJsEngine.run() whenever
 * sourceUsesManifoldText() fires — so api.text / api.textSection are
 * always synchronous from inside user code.
 */

import type { Font } from 'opentype.js';

type Vec2 = [number, number];

export type FontVariant = 'regular' | 'bold' | 'italic' | 'bold-italic';

const FONT_FILES: Record<FontVariant, string> = {
  regular: 'LiberationSans-Regular.ttf',
  bold: 'LiberationSans-Bold.ttf',
  italic: 'LiberationSans-Italic.ttf',
  'bold-italic': 'LiberationSans-BoldItalic.ttf',
};
const FONTS_PREFIX = '/openscad-libs/fonts';

const fontCache = new Map<FontVariant, Font>();
let loadPromise: Promise<void> | null = null;

export function sourceUsesManifoldText(code: string): boolean {
  // Match api.text(, api.textSection(, api.Curves.text(, api.Curves.textSection(
  return /\bapi\.(?:Curves\.)?textSection\s*\(/.test(code) ||
         /\bapi\.(?:Curves\.)?text\s*\(/.test(code) ||
         /\bCurves\.textSection\s*\(/.test(code) ||
         /\bCurves\.text\s*\(/.test(code);
}

export async function preloadTextFonts(): Promise<void> {
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    const variants = Object.keys(FONT_FILES) as FontVariant[];
    const [opentype, ...buffers] = await Promise.all([
      import('opentype.js'),
      ...variants.map(async (v) => {
        const r = await fetch(`${FONTS_PREFIX}/${FONT_FILES[v]}`);
        if (!r.ok) throw new Error(`api.text: failed to fetch font "${v}": ${r.status}`);
        return r.arrayBuffer();
      }),
    ]);
    for (let i = 0; i < variants.length; i++) {
      fontCache.set(variants[i], opentype.parse(buffers[i]));
    }
  })();
  return loadPromise;
}

export interface TextOptions {
  size?: number;
  font?: FontVariant;
  spacing?: number;
  segments?: number;
}

/** Convert text to an array of closed 2D contours (one per glyph subpath).
 *  Contours use model coordinates (Y-up). CrossSection.ofPolygons with the
 *  even-odd fill rule handles holes (inside of "O", "B", etc.) automatically. */
export function textToContours(text: string, opts: TextOptions = {}): Vec2[][] {
  const size = opts.size ?? 10;
  const variant = opts.font ?? 'regular';
  const spacing = opts.spacing ?? 1.0;
  const segments = opts.segments ?? 8;

  if (typeof size !== 'number' || !Number.isFinite(size) || size <= 0) {
    throw new Error('api.text: size must be a positive number');
  }
  if (typeof segments !== 'number' || !Number.isInteger(segments) || segments < 1) {
    throw new Error('api.text: segments must be a positive integer');
  }
  const validVariants: FontVariant[] = ['regular', 'bold', 'italic', 'bold-italic'];
  if (!validVariants.includes(variant)) {
    throw new Error(`api.text: font must be one of ${validVariants.map(v => `"${v}"`).join(', ')}`);
  }

  const font = fontCache.get(variant);
  if (!font) {
    throw new Error(
      'api.text: Liberation Sans fonts are not yet loaded. ' +
      'This usually means the text-detection heuristic did not fire before this run. ' +
      'Use `api.text(...)` or `api.Curves.text(...)` directly (not a destructured alias) ' +
      'so the engine can pre-load the fonts. The next run will work once fonts are cached.',
    );
  }

  if (spacing === 1.0) {
    const path = font.getPath(text, 0, 0, size);
    return pathCommandsToContours(path.commands, segments);
  }

  // Custom spacing: lay out glyph-by-glyph, scaling advance width by the multiplier.
  const scale = size / font.unitsPerEm;
  const all: Vec2[][] = [];
  let x = 0;
  for (const char of text) {
    const glyph = font.charToGlyph(char);
    if (!glyph) continue;
    const glyphPath = glyph.getPath(x, 0, size);
    all.push(...pathCommandsToContours(glyphPath.commands, segments));
    x += (glyph.advanceWidth ?? 0) * scale * spacing;
  }
  return all;
}

/** Bounding rect of a set of contours. */
export function contourBounds(contours: Vec2[]): { minX: number; maxX: number; minY: number; maxY: number } {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const pt of contours) {
    if (pt[0] < minX) minX = pt[0];
    if (pt[0] > maxX) maxX = pt[0];
    if (pt[1] < minY) minY = pt[1];
    if (pt[1] > maxY) maxY = pt[1];
  }
  return { minX, maxX, minY, maxY };
}

// ---------------------------------------------------------------------------

function sampleBezier(pts: Vec2[], segments: number): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const work = pts.map((p): Vec2 => [p[0], p[1]]);
    for (let r = work.length - 1; r > 0; r--) {
      for (let j = 0; j < r; j++) {
        work[j] = [work[j][0] * (1 - t) + work[j + 1][0] * t, work[j][1] * (1 - t) + work[j + 1][1] * t];
      }
    }
    out.push(work[0]);
  }
  return out;
}

function pathCommandsToContours(commands: import('opentype.js').PathCommand[], segments: number): Vec2[][] {
  const contours: Vec2[][] = [];
  let current: Vec2[] = [];
  let cx = 0, cy = 0;

  const push = (x: number, y: number) => { cx = x; cy = y; current.push([x, -y]); };

  for (const cmd of commands) {
    if (cmd.type === 'M') {
      if (current.length >= 3) contours.push(current);
      current = [];
      push(cmd.x, cmd.y);
    } else if (cmd.type === 'L') {
      push(cmd.x, cmd.y);
    } else if (cmd.type === 'Q') {
      const sampled = sampleBezier([[cx, -cy], [cmd.x1, -cmd.y1], [cmd.x, -cmd.y]], segments);
      for (let i = 1; i < sampled.length; i++) current.push(sampled[i]);
      cx = cmd.x; cy = cmd.y;
    } else if (cmd.type === 'C') {
      const sampled = sampleBezier([[cx, -cy], [cmd.x1, -cmd.y1], [cmd.x2, -cmd.y2], [cmd.x, -cmd.y]], segments);
      for (let i = 1; i < sampled.length; i++) current.push(sampled[i]);
      cx = cmd.x; cy = cmd.y;
    } else if (cmd.type === 'Z') {
      if (current.length >= 3) contours.push(current);
      current = [];
    }
  }
  if (current.length >= 3) contours.push(current);

  return contours;
}
