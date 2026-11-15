// Strict parameter validation for the image-tool code ops (#1256, Stage B):
// `api.imageTile` / `api.silhouetteTile` / `api.steppedRelief` /
// `api.lithophane` (relief → ReliefOptions) and `api.voxelsFromImage`
// (voxel → ImageToVoxelOptions).
//
// The params are the SAME object the `// @image-tool` header stores, so a
// record can move between the header and the call unchanged. Unlike the
// wizard's clamps, these throw on anything wrong (unknown key, wrong type,
// out of range) with a message that names the key — model code should fail
// loudly, not silently build something else. Pure: no DOM, no app state.

import type { ReliefOptions } from '../relief/types';
import type { ImageToVoxelOptions } from '../import/imageToVoxel';
import { reliefOptionsForOp, RELIEF_OP_FUNCTIONS, VOXEL_OP_FUNCTION, type ReliefToolId } from './descriptor';

type Obj = Record<string, unknown>;

function check(cond: unknown, fn: string, msg: string): asserts cond {
  if (!cond) throw new Error(`api.${fn}: ${msg}`);
}

function section(fn: string, raw: unknown, where: string, keys: readonly string[]): Obj {
  check(raw !== null && typeof raw === 'object' && !Array.isArray(raw), fn, `${where || 'options'} must be an object`);
  const o = raw as Obj;
  for (const k of Object.keys(o)) {
    check(keys.includes(k), fn, `unknown option "${where ? `${where}.` : ''}${k}" — allowed: ${keys.join(', ')}`);
  }
  return o;
}

function num(fn: string, o: Obj, k: string, where: string, lo: number, hi: number, int = false): void {
  const v = o[k];
  if (v === undefined) return;
  check(typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi && (!int || Number.isInteger(v)), fn,
    `${where}.${k} must be ${int ? 'an integer' : 'a number'} in ${lo}..${hi}, got ${JSON.stringify(v)}`);
}

function bool(fn: string, o: Obj, k: string, where: string): void {
  const v = o[k];
  if (v === undefined) return;
  check(typeof v === 'boolean', fn, `${where}.${k} must be true or false, got ${JSON.stringify(v)}`);
}

function oneOf(fn: string, o: Obj, k: string, where: string, values: readonly string[]): void {
  const v = o[k];
  if (v === undefined) return;
  check(typeof v === 'string' && values.includes(v), fn, `${where}.${k} must be one of ${values.map((s) => `'${s}'`).join(', ')}, got ${JSON.stringify(v)}`);
}

function isRgb255(v: unknown): boolean {
  return Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 255);
}

function rgb(fn: string, o: Obj, k: string, where: string): void {
  const v = o[k];
  if (v === undefined) return;
  check(isRgb255(v), fn, `${where}.${k} must be [r, g, b] with each 0..255`);
}

function rgbList(fn: string, o: Obj, k: string, where: string, max: number, nullable = false): void {
  const v = o[k];
  if (v === undefined || (nullable && v === null)) return;
  check(Array.isArray(v) && v.length <= max && v.every(isRgb255), fn, `${where}.${k} must be an array of at most ${max} [r, g, b] colours (each 0..255)`);
}

// ── relief tools ─────────────────────────────────────────────────────────────

const RELIEF_KEYS = ['mode', 'common', 'luminance', 'quantized', 'preprocess', 'crop'] as const;
const COMMON_KEYS = ['widthMm', 'layerHeight', 'baseThickness', 'maxHeight', 'resolution', 'smoothing', 'removeBackground'] as const;
const LUMINANCE_KEYS = ['invert', 'gamma', 'levels'] as const;
const QUANTIZED_KEYS = [
  'clusters', 'colorSpace', 'dither', 'fixedPalette', 'output', 'shape', 'cornerRadiusMm', 'chamferMm',
  'paintingMode', 'invertHeights', 'holes', 'manualBackground', 'doubleSided', 'backMirror',
] as const;
const PREPROCESS_KEYS = ['brightness', 'contrast', 'saturation', 'levelsLow', 'levelsHigh'] as const;
const CROP_KEYS = ['left', 'top', 'right', 'bottom'] as const;
const HOLE_KEYS = ['cxMm', 'cyMm', 'diameterMm'] as const;

/** The quantized `output` (or luminance mode) each relief tool implies. */
const TOOL_SHAPE: Record<ReliefToolId, { mode: 'quantized' | 'luminance'; output?: string }> = {
  tile: { mode: 'quantized', output: 'flat' },
  silhouette: { mode: 'quantized', output: 'silhouette' },
  steppedRelief: { mode: 'quantized', output: 'relief' },
  lithophane: { mode: 'luminance' },
};

/** Validate a relief tool's params and merge them over the tool's defaults.
 *  Throws on unknown keys, wrong types, out-of-range values, a `mode` /
 *  `quantized.output` that contradicts the function, or a single-nozzle
 *  stepped relief too short for its colour count. */
export function parseReliefOpParams(tool: ReliefToolId, raw: unknown): ReliefOptions {
  const fn = RELIEF_OP_FUNCTIONS[tool];
  if (raw === undefined) return reliefOptionsForOp(tool, {});
  const top = section(fn, raw, '', RELIEF_KEYS);
  const shape = TOOL_SHAPE[tool];
  if (top.mode !== undefined) {
    check(top.mode === shape.mode, fn, `mode '${String(top.mode)}' does not match api.${fn} (it makes a ${shape.mode} relief) — drop mode, or call ${shape.mode === 'luminance' ? 'api.imageTile / api.steppedRelief' : 'api.lithophane'}`);
  }
  if (top.common !== undefined) {
    const c = section(fn, top.common, 'common', COMMON_KEYS);
    num(fn, c, 'widthMm', 'common', 1, 2000);
    num(fn, c, 'layerHeight', 'common', 0.02, 2);
    num(fn, c, 'baseThickness', 'common', 0, 50);
    num(fn, c, 'maxHeight', 'common', 0.1, 100);
    num(fn, c, 'resolution', 'common', 8, 512, true);
    num(fn, c, 'smoothing', 'common', 0, 20);
    bool(fn, c, 'removeBackground', 'common');
  }
  if (top.luminance !== undefined) {
    const l = section(fn, top.luminance, 'luminance', LUMINANCE_KEYS);
    bool(fn, l, 'invert', 'luminance');
    num(fn, l, 'gamma', 'luminance', 0.05, 10);
    num(fn, l, 'levels', 'luminance', 2, 256, true);
  }
  if (top.quantized !== undefined) {
    const q = section(fn, top.quantized, 'quantized', QUANTIZED_KEYS);
    num(fn, q, 'clusters', 'quantized', 2, 12, true);
    oneOf(fn, q, 'colorSpace', 'quantized', ['rgb', 'lab']);
    bool(fn, q, 'dither', 'quantized');
    rgbList(fn, q, 'fixedPalette', 'quantized', 64);
    oneOf(fn, q, 'output', 'quantized', ['flat', 'relief', 'silhouette']);
    if (q.output !== undefined && shape.output !== undefined) {
      check(q.output === shape.output, fn, `quantized.output '${String(q.output)}' does not match api.${fn} (it makes '${shape.output}') — drop it, or call ${q.output === 'flat' ? 'api.imageTile' : q.output === 'silhouette' ? 'api.silhouetteTile' : 'api.steppedRelief'}`);
    }
    oneOf(fn, q, 'shape', 'quantized', ['rect', 'rounded', 'circle']);
    num(fn, q, 'cornerRadiusMm', 'quantized', 0, 50);
    num(fn, q, 'chamferMm', 'quantized', 0, 5);
    oneOf(fn, q, 'paintingMode', 'quantized', ['multi-color', 'single-nozzle']);
    bool(fn, q, 'invertHeights', 'quantized');
    rgb(fn, q, 'manualBackground', 'quantized');
    bool(fn, q, 'doubleSided', 'quantized');
    bool(fn, q, 'backMirror', 'quantized');
    if (q.holes !== undefined) {
      check(Array.isArray(q.holes) && q.holes.length <= 32, fn, 'quantized.holes must be an array of at most 32 {cxMm, cyMm, diameterMm}');
      (q.holes as unknown[]).forEach((h, i) => {
        const where = `quantized.holes[${i}]`;
        const ho = section(fn, h, where, HOLE_KEYS);
        for (const k of HOLE_KEYS) check(ho[k] !== undefined, fn, `${where}.${k} is required`);
        num(fn, ho, 'cxMm', where, -2000, 2000);
        num(fn, ho, 'cyMm', where, -2000, 2000);
        num(fn, ho, 'diameterMm', where, 0.5, 200);
      });
    }
  }
  if (top.preprocess !== undefined) {
    const p = section(fn, top.preprocess, 'preprocess', PREPROCESS_KEYS);
    for (const k of ['brightness', 'contrast', 'saturation']) num(fn, p, k, 'preprocess', -1, 1);
    num(fn, p, 'levelsLow', 'preprocess', 0, 254, true);
    num(fn, p, 'levelsHigh', 'preprocess', 1, 255, true);
  }
  if (top.crop !== undefined) {
    const c = section(fn, top.crop, 'crop', CROP_KEYS);
    for (const k of CROP_KEYS) {
      check(c[k] !== undefined, fn, `crop.${k} is required`);
      num(fn, c, k, 'crop', 0, 1);
    }
    check((c.left as number) < (c.right as number) && (c.top as number) < (c.bottom as number), fn, 'crop needs left < right and top < bottom (fractions 0..1 of the image)');
  }
  const opts = reliefOptionsForOp(tool, top);
  // Pin the shape the function implies (the merge keeps the defaults for it,
  // and the checks above refused a contradicting value).
  opts.mode = shape.mode;
  if (shape.output) opts.quantized.output = shape.output as ReliefOptions['quantized']['output'];
  const fit = steppedReliefFitError(opts);
  if (fit) throw new Error(`api.${fn}: ${fit}`);
  return opts;
}

/** A single-nozzle stepped relief needs each colour on its own layer band:
 *  `maxHeight >= (clusters - 1) * layerHeight`. Null when it fits. */
export function steppedReliefFitError(opts: ReliefOptions): string | null {
  if (opts.mode !== 'quantized' || opts.quantized.output !== 'relief' || opts.quantized.paintingMode !== 'single-nozzle') return null;
  const lh = opts.common.layerHeight;
  const need = (opts.quantized.clusters - 1) * lh;
  if (opts.common.maxHeight + 1e-6 >= need) return null;
  return `a single-nozzle stepped relief needs common.maxHeight ≥ ${need.toFixed(2)} mm for ${opts.quantized.clusters} colours at ${lh} mm layers — raise maxHeight, lower quantized.clusters, or set quantized.paintingMode: 'multi-color'`;
}

// ── voxel tool ───────────────────────────────────────────────────────────────

const VOXEL_KEYS = [
  'maxSize', 'mode', 'depth', 'maxHeight', 'baseThickness', 'invert', 'alphaThreshold', 'colorMode', 'flatColor',
  'gamma', 'brightness', 'contrast', 'saturation', 'posterizeColors', 'palette', 'constrainToPalette',
  'removeBackground', 'backgroundColor', 'codeStyle',
] as const;

/** Validate `api.voxelsFromImage` options (the voxel tool's stored params).
 *  `codeStyle` and `constrainToPalette` are accepted (a stored record carries
 *  them) but only steer the import panel, not the grid. */
export function parseVoxelOpParams(raw: unknown): ImageToVoxelOptions {
  const fn = VOXEL_OP_FUNCTION;
  if (raw === undefined) return {};
  const o = section(fn, raw, '', VOXEL_KEYS);
  const w = 'options';
  num(fn, o, 'maxSize', w, 1, 256, true);
  oneOf(fn, o, 'mode', w, ['billboard', 'heightmap']);
  num(fn, o, 'depth', w, 1, 256, true);
  num(fn, o, 'maxHeight', w, 1, 256, true);
  num(fn, o, 'baseThickness', w, 0, 256, true);
  bool(fn, o, 'invert', w);
  num(fn, o, 'alphaThreshold', w, 0, 255);
  oneOf(fn, o, 'colorMode', w, ['original', 'grayscale', 'flat']);
  rgb(fn, o, 'flatColor', w);
  num(fn, o, 'gamma', w, 0.05, 10);
  for (const k of ['brightness', 'contrast', 'saturation']) num(fn, o, k, w, -1, 1);
  num(fn, o, 'posterizeColors', w, 0, 32, true);
  rgbList(fn, o, 'palette', w, 64, true);
  bool(fn, o, 'constrainToPalette', w);
  bool(fn, o, 'removeBackground', w);
  rgb(fn, o, 'backgroundColor', w);
  oneOf(fn, o, 'codeStyle', w, ['decode', 'calls']);
  return JSON.parse(JSON.stringify(o)) as ImageToVoxelOptions;
}
