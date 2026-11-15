// `api.image(id)` + `api.layeredPrint(image, opts)` for manifold-js model code.
//
// layeredPrint runs the pure solver inside the engine Worker and returns the
// heightmap as a real Manifold (so it composes: frames, hanging holes, text),
// and records the swap plan so the main thread can colour the model by height
// and export a 3MF with the filament changes. Solves are memoized on the image
// content + options, so re-runs that don't change them are instant; a pinned
// `schedule` skips the filament search and only solves heights.

import { getActiveModelImage, type ModelImage } from '../../geometry/modelImages';
import type { LayeredPrintPlanRecord } from '../types';
import { solveLayeredPrint, DEFAULT_LAYERED_PRINT_OPTIONS, type LayeredPrintOptions } from './solver';
import { buildHeightfieldMesh } from './mesh';
import { layeredPrintRecord } from './plan';
import type { LayeredPrintFilament } from './filamentLibrary';

/** What `api.image(id)` returns: an opaque handle, plus its size. */
export interface ModelImageHandle {
  readonly kind: 'image';
  readonly id: string;
  readonly width: number;
  readonly height: number;
}

const OPTION_KEYS = [
  'colors', 'widthMm', 'maxHeightMm', 'baseHeightMm', 'layerHeight', 'firstLayerHeight', 'pixelSizeMm',
  'filaments', 'baseFilament', 'chromaWeight', 'smoothing', 'effort', 'seed', 'schedule',
] as const;

const USAGE = "api.layeredPrint(api.image('<attachment id>'), { colors?, widthMm?, maxHeightMm?, baseHeightMm?, layerHeight?, firstLayerHeight?, pixelSizeMm?, filaments?: [{name, hex, td}], baseFilament?, chromaWeight?, smoothing?, effort?, seed?, schedule?: [{name, hex, td, layer}] })";

interface CachedSolve {
  plan: LayeredPrintPlanRecord;
  heights: Float32Array;
  W: number;
  H: number;
  widthMm: number;
  depthMm: number;
}

const cache = new Map<string, CachedSolve>();
const CACHE_MAX = 3;

function fail(msg: string): never {
  throw new Error(`api.layeredPrint: ${msg}. Usage: ${USAGE}`);
}

function num(o: Record<string, unknown>, k: string, lo: number, hi: number): number | undefined {
  const v = o[k];
  if (v === undefined) return undefined;
  if (typeof v !== 'number' || !Number.isFinite(v) || v < lo || v > hi) fail(`${k} must be a number in ${lo}..${hi}, got ${JSON.stringify(v)}`);
  return v;
}

function filament(v: unknown, where: string): LayeredPrintFilament {
  const f = v as Record<string, unknown>;
  if (!f || typeof f !== 'object') fail(`${where} must be {name, hex, td}`);
  if (typeof f.name !== 'string' || !f.name || f.name.length > 80) fail(`${where}.name must be a non-empty string of at most 80 characters`);
  if (typeof f.hex !== 'string' || !/^#?[0-9a-fA-F]{6}$/.test(f.hex)) fail(`${where}.hex must be "#rrggbb"`);
  if (typeof f.td !== 'number' || !(f.td >= 0.05 && f.td <= 50)) fail(`${where}.td must be a number in 0.05..50 (mm)`);
  const hex = (f.hex as string).startsWith('#') ? (f.hex as string) : `#${f.hex as string}`;
  return { name: f.name as string, hex: hex.toLowerCase(), td: f.td as number };
}

/** Validate user options → solver options (throws a helpful error). */
export function parseLayeredPrintOptions(raw: unknown): Partial<LayeredPrintOptions> {
  if (raw === undefined) return {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('options must be an object');
  const o = raw as Record<string, unknown>;
  for (const k of Object.keys(o)) if (!(OPTION_KEYS as readonly string[]).includes(k)) fail(`unknown option "${k}"`);
  const out: Partial<LayeredPrintOptions> = {
    numColors: num(o, 'colors', 1, 16),
    widthMm: num(o, 'widthMm', 10, 400),
    maxHeightMm: num(o, 'maxHeightMm', 0.3, 20),
    baseHeightMm: num(o, 'baseHeightMm', 0.04, 10),
    layerHeight: num(o, 'layerHeight', 0.04, 0.4),
    firstLayerHeight: num(o, 'firstLayerHeight', 0.04, 0.6),
    pixelSizeMm: num(o, 'pixelSizeMm', 0.1, 2),
    chromaWeight: num(o, 'chromaWeight', 0, 4),
    smoothing: num(o, 'smoothing', 0, 20),
    seed: num(o, 'seed', 0, 2 ** 31),
  };
  if (out.numColors !== undefined && !Number.isInteger(out.numColors)) fail('colors must be an integer');
  const effort = num(o, 'effort', 0.1, 10);
  if (effort !== undefined) out.iterations = Math.round(DEFAULT_LAYERED_PRINT_OPTIONS.iterations * effort);
  if (o.filaments !== undefined) {
    if (!Array.isArray(o.filaments) || o.filaments.length === 0 || o.filaments.length > 200) fail('filaments must be an array of 1..200 {name, hex, td}');
    out.filaments = (o.filaments as unknown[]).map((f, i) => filament(f, `filaments[${i}]`));
  }
  if (o.baseFilament !== undefined) {
    if (typeof o.baseFilament !== 'string') fail('baseFilament must be a filament name');
    out.baseFilament = o.baseFilament;
  }
  if (o.schedule !== undefined) {
    if (!Array.isArray(o.schedule) || o.schedule.length === 0 || o.schedule.length > 16) fail('schedule must be an array of 1..16 {name, hex, td, layer}');
    const searchOnly = ['colors', 'filaments', 'baseFilament', 'effort', 'seed'].filter((k) => o[k] !== undefined);
    if (searchOnly.length > 0) fail(`${searchOnly.join(', ')} only steer the filament search, which a pinned schedule skips — remove ${searchOnly.length > 1 ? 'them' : 'it'}, or remove schedule to re-solve`);
    out.schedule = (o.schedule as unknown[]).map((e, i) => {
      const f = filament(e, `schedule[${i}]`);
      const layer = (e as Record<string, unknown>).layer;
      if (typeof layer !== 'number' || !Number.isInteger(layer) || layer < 1) fail(`schedule[${i}].layer must be the 1-based slicer layer the filament starts on`);
      return { filament: f, startLayer: (layer as number) - 1 };
    });
    const first = Math.min(...out.schedule.map((b) => b.startLayer));
    if (first !== 0) fail('the first schedule entry (the base filament) must start on layer 1');
  }
  for (const k of Object.keys(out) as Array<keyof typeof out>) if (out[k] === undefined) delete out[k];
  return out;
}

/** `api.image(id)`: the attachment's handle, or a clear error. */
export function modelImageHandle(id: unknown): ModelImageHandle {
  if (typeof id !== 'string' || !id) throw new Error("api.image: expected an attachment id string, e.g. api.image('a1b2c3'). List attachments with partwright.getImages().");
  const im = getActiveModelImage(id);
  if (!im) {
    if (typeof document === 'undefined' && typeof self === 'undefined') throw new Error(`api.image('${id}'): attachment images are only available in the browser app, not in headless preview.`);
    throw new Error(`api.image('${id}'): no usable image attachment with that id in this session. Attach the photo (Attachments tab) and use its id — images reach the model only through a literal api.image('<id>') call. (A session opened from a share link has its photos removed; ask for the session file instead.)`);
  }
  return Object.freeze({ kind: 'image' as const, id: im.id, width: im.width, height: im.height });
}

export interface LayeredPrintRun {
  /** The mesh to hand to Manifold.ofMesh. */
  mesh: { numProp: number; vertProperties: Float32Array; triVerts: Uint32Array };
  plan: LayeredPrintPlanRecord;
}

/** Solve (or reuse a cached solve) and build the heightfield mesh. */
export function runLayeredPrint(image: unknown, rawOptions: unknown, limits: { maxCells?: number; maxLayers?: number } = {}): LayeredPrintRun {
  const h = image as ModelImageHandle;
  if (!h || h.kind !== 'image') fail("first argument must be an image from api.image('<attachment id>')");
  const im: ModelImage | null = getActiveModelImage(h.id);
  if (!im) fail(`image '${h.id}' is not available in this run`);
  const options = { ...parseLayeredPrintOptions(rawOptions), ...limits };
  const key = `${im.hash}|${JSON.stringify(options)}`;
  let hit = cache.get(key);
  if (!hit) {
    const r = solveLayeredPrint(im, options);
    hit = { plan: layeredPrintRecord(r), heights: r.heightsMm, W: r.gridWidth, H: r.gridHeight, widthMm: r.widthMm, depthMm: r.depthMm };
    cache.set(key, hit);
    while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string);
  } else {
    // Refresh LRU position.
    cache.delete(key); cache.set(key, hit);
  }
  const m = buildHeightfieldMesh(hit.heights, hit.W, hit.H, hit.widthMm, hit.depthMm);
  return { mesh: { numProp: 3, vertProperties: m.vertProperties, triVerts: m.triVerts }, plan: { ...hit.plan, imageId: im.id } };
}

/** The `schedule` option that pins a plan (for code generation / plan readback). */
export function planToScheduleOption(plan: LayeredPrintPlanRecord): Array<{ name: string; hex: string; td: number; layer: number }> {
  return plan.blocks.map((b) => ({ name: b.name, hex: b.hex, td: b.td, layer: b.startLayer + 1 }));
}

/** Model code for a layered print with its solved schedule pinned, so the
 *  filaments and swap layers are plain, editable code. `options` are the
 *  solve's resolved options; only values that differ from the defaults are
 *  written (plus width and height, which always are). */
export function layeredPrintCode(attachmentId: string, options: LayeredPrintOptions, plan: LayeredPrintPlanRecord): string {
  const d = DEFAULT_LAYERED_PRINT_OPTIONS;
  const lines: string[] = [];
  const opt = (k: string, v: number) => lines.push(`  ${k}: ${String(v)},`);
  opt('widthMm', options.widthMm);
  opt('maxHeightMm', options.maxHeightMm);
  if (options.baseHeightMm !== d.baseHeightMm) opt('baseHeightMm', options.baseHeightMm);
  if (options.layerHeight !== d.layerHeight) opt('layerHeight', options.layerHeight);
  if (options.firstLayerHeight !== d.firstLayerHeight) opt('firstLayerHeight', options.firstLayerHeight);
  if (options.pixelSizeMm !== d.pixelSizeMm) opt('pixelSizeMm', options.pixelSizeMm);
  if (options.chromaWeight !== d.chromaWeight) opt('chromaWeight', options.chromaWeight);
  if (options.smoothing !== d.smoothing) opt('smoothing', options.smoothing);
  const sched = planToScheduleOption(plan)
    .map((b) => `    { name: ${JSON.stringify(b.name)}, hex: '${b.hex}', td: ${b.td}, layer: ${b.layer} },`)
    .join('\n');
  return `// Layered filament print (HueForge-style) from the attached photo.
// \`schedule\` is the filament stack, bottom to top: each filament starts on
// the given 1-based slicer layer (layer 1 = the base). Edit it to change
// colours or swap heights; delete it to let the solver re-pick the
// filaments (add \`colors: 8\` to cap how many). TD = transmission distance (mm).
// Export with the filament changes built in: command palette →
// "Export layered print 3MF" (AMS or manual-swap version).
const print = api.layeredPrint(api.image('${attachmentId}'), {
${lines.join('\n')}
  schedule: [
${sched}
  ],
});

return print;
`;
}
