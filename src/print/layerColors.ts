// Colour-by-layer-height for a print job: "from this height up, print in this
// colour". Pure logic, no DOM and no engine, so it unit-tests in the vitest tier
// (tests/unit/layerColors.test.ts) and can be shared by the viewport preview,
// the 3MF exporter/importer and the headless tools.
//
// How the slicer treats these was measured against a real slice, not assumed
// (see the prompt log for the experiment):
//   - A filament switch at a layer is stored per plate in
//     `Metadata/custom_gcode_per_layer.xml` as `<layer top_z= type="2"
//     extruder= color= …/>`. `top_z` is the TOP of the first layer printed in
//     the new filament: an entry at top_z 8.0 (0.2 mm layers) makes the layer
//     spanning 7.8-8.0 the first one in the new filament.
//   - It only applies to an object printed in ONE filament. On an object that
//     also carries per-triangle paint, the slicer ignores these entries.
//   - `type="0"` is a manual colour swap on the same filament slot: the
//     printer pauses and the slicer still counts one filament.

/** One requested change: from height `z` (mm above the bed) up, print in `color`. */
export interface LayerColorChange {
  z: number;
  /** `#rrggbb`. */
  color: string;
}

/** What `api.print.layerColors(changes, options)` declares in model code. Plain data. */
export interface LayerColorsSpec {
  changes: LayerColorChange[];
  /** Override the profile's layer height for this model, in mm. */
  layerHeight?: number;
  /** Override the profile's first-layer height for this model, in mm. */
  firstLayerHeight?: number;
}

/** Most colour changes one model may declare. */
export const MAX_LAYER_COLOR_CHANGES = 256;

/**
 * Validate the arguments of `api.print.layerColors` into a spec. The ONE
 * validator shared by the engine's recorder, the Worker-message check and the
 * console API, so all three accept exactly the same input. Throws an `Error`
 * whose message names the bad argument; unknown keys are rejected.
 */
export function parseLayerColorsSpec(changes: unknown, options?: unknown): LayerColorsSpec {
  const isPlain = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
  if (!Array.isArray(changes)) throw new Error('layerColors: expected an array of { z, color } changes.');
  if (changes.length > MAX_LAYER_COLOR_CHANGES) throw new Error(`layerColors: at most ${MAX_LAYER_COLOR_CHANGES} changes.`);
  const out: LayerColorChange[] = changes.map((c, i) => {
    if (!isPlain(c)) throw new Error(`layerColors: change ${i} must be an object { z, color }.`);
    for (const k of Object.keys(c)) if (k !== 'z' && k !== 'color') throw new Error(`layerColors: change ${i} has an unknown key "${k}" (allowed: z, color).`);
    if (typeof c.z !== 'number' || !Number.isFinite(c.z) || c.z < 0) throw new Error(`layerColors: change ${i} needs z as a non-negative number of mm above the bed.`);
    if (typeof c.color !== 'string' || !/^#?[0-9a-f]{6}$/i.test(c.color.trim())) throw new Error(`layerColors: change ${i} needs color as "#rrggbb".`);
    return { z: c.z, color: normalizeHex(c.color) };
  });
  const spec: LayerColorsSpec = { changes: out.sort((a, b) => a.z - b.z) };
  if (options !== undefined) {
    if (!isPlain(options)) throw new Error('layerColors: options must be an object { layerHeight, firstLayerHeight }.');
    for (const k of Object.keys(options)) if (k !== 'layerHeight' && k !== 'firstLayerHeight') throw new Error(`layerColors: unknown option "${k}" (allowed: layerHeight, firstLayerHeight).`);
    for (const k of ['layerHeight', 'firstLayerHeight'] as const) {
      const v = options[k];
      if (v === undefined) continue;
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 0.04 || v > 2) throw new Error(`layerColors: ${k} must be a number of mm between 0.04 and 2.`);
      spec[k] = v;
    }
  }
  return spec;
}

/** The base colour (an entry at the bed) and the later changes of a spec. `fallback` is used when no entry sits on the bed. */
export function splitBaseColor(spec: LayerColorsSpec, profile: LayerProfile, fallback: string): { base: string; changes: LayerColorChange[] } {
  const onBed = spec.changes.filter((c) => startLayerFor(c.z, profile) === 0);
  return { base: onBed.length > 0 ? onBed[onBed.length - 1].color : normalizeHex(fallback), changes: spec.changes.filter((c) => startLayerFor(c.z, profile) > 0) };
}

/** The slice settings that decide where layer boundaries fall. */
export interface LayerProfile {
  /** Height of every layer after the first, in mm. */
  layerHeight: number;
  /** Height of the first layer, in mm. */
  firstLayerHeight: number;
}

/** A run of consecutive layers printed in one colour. */
export interface LayerBand {
  color: string;
  /** Index of the first and last layer in the band (0-based, inclusive). */
  firstLayer: number;
  lastLayer: number;
  /** Bottom of the first layer and top of the last, in mm. */
  fromZ: number;
  toZ: number;
}

const EPS = 1e-6;

export function normalizeHex(color: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(color.trim());
  if (!m) throw new Error(`Layer colour must be #rrggbb, got "${color}".`);
  return `#${m[1].toLowerCase()}`;
}

function assertProfile(p: LayerProfile): void {
  if (!(p.layerHeight > 0) || !(p.firstLayerHeight > 0)) throw new Error('Layer height and first-layer height must be positive.');
}

/** Height of the bottom of layer `index` (0-based). Layer 0 starts on the bed. */
export function layerBottomZ(index: number, p: LayerProfile): number {
  return index <= 0 ? 0 : p.firstLayerHeight + (index - 1) * p.layerHeight;
}

/** Height of the top of layer `index` (0-based). */
export function layerTopZ(index: number, p: LayerProfile): number {
  return p.firstLayerHeight + index * p.layerHeight;
}

/** How many layers a model of this height prints in (the slicer rounds to whole layers). */
export function layerCount(modelHeight: number, p: LayerProfile): number {
  assertProfile(p);
  if (!(modelHeight > 0)) return 0;
  return Math.max(1, 1 + Math.round((modelHeight - p.firstLayerHeight) / p.layerHeight));
}

/** Index of the layer that contains height `z` (a point exactly on a boundary belongs to the layer below). */
export function layerIndexAt(z: number, p: LayerProfile): number {
  if (z <= p.firstLayerHeight + EPS) return 0;
  return Math.ceil((z - p.firstLayerHeight) / p.layerHeight - EPS);
}

/** Index of the first layer that prints in a colour requested "from height z": the layer whose BOTTOM is the boundary nearest z. */
export function startLayerFor(z: number, p: LayerProfile): number {
  if (z <= p.firstLayerHeight / 2) return 0;
  return Math.max(1, Math.round((z - p.firstLayerHeight) / p.layerHeight) + 1);
}

/**
 * Turn a base colour plus requested changes into the bands that actually
 * print. Changes are snapped to layer boundaries; one that lands on the same
 * layer as a later one, repeats the colour already printing, or sits at or
 * above the top of the model, is dropped.
 */
export function resolveLayerBands(baseColor: string, changes: readonly LayerColorChange[], modelHeight: number, profile: LayerProfile): LayerBand[] {
  assertProfile(profile);
  const count = layerCount(modelHeight, profile);
  if (count === 0) return [];
  // start layer → colour; a later entry for the same layer wins.
  const starts = new Map<number, string>([[0, normalizeHex(baseColor)]]);
  for (const c of [...changes].sort((a, b) => a.z - b.z)) {
    if (!Number.isFinite(c.z) || c.z < 0) throw new Error(`Layer change height must be a non-negative number, got ${c.z}.`);
    const start = startLayerFor(c.z, profile);
    if (start < count) starts.set(start, normalizeHex(c.color));
  }
  const bands: LayerBand[] = [];
  for (const start of [...starts.keys()].sort((a, b) => a - b)) {
    const color = starts.get(start)!;
    const prev = bands[bands.length - 1];
    if (prev && prev.color === color) continue; // no visible change
    if (prev) { prev.lastLayer = start - 1; prev.toZ = layerTopZ(start - 1, profile); }
    bands.push({ color, firstLayer: start, lastLayer: count - 1, fromZ: layerBottomZ(start, profile), toZ: layerTopZ(count - 1, profile) });
  }
  return bands;
}

/** The band a height falls in (clamped to the first/last band), or null when there are none. */
export function bandAtZ(bands: readonly LayerBand[], z: number, profile: LayerProfile): LayerBand | null {
  if (bands.length === 0) return null;
  const layer = layerIndexAt(z, profile);
  return bands.find((b) => layer >= b.firstLayer && layer <= b.lastLayer) ?? (layer < bands[0].firstLayer ? bands[0] : bands[bands.length - 1]);
}

// ── Slicer project file ──────────────────────────────────────────────────

/** One `<layer>` entry of the slicer's per-layer file. */
export interface SlicerLayerEntry {
  /** Top of the first layer the entry applies to, in mm. */
  topZ: number;
  /** `'filament'`: switch to filament slot `slot` (type 2). `'swap'`: manual colour swap on the same slot (type 0). */
  kind: 'filament' | 'swap';
  /** 1-based filament slot. */
  slot: number;
  /** `#rrggbb` the slicer shows for the entry. */
  color: string;
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * The slicer entries for a set of bands: one filament switch per band after
 * the first. `slotOf` maps a colour to its 1-based filament slot. The first
 * band is the object's own filament and needs no entry.
 */
export function bandsToSlicerEntries(bands: readonly LayerBand[], profile: LayerProfile, slotOf: (color: string) => number): SlicerLayerEntry[] {
  return bands.slice(1).map((b) => ({ topZ: round3(layerTopZ(b.firstLayer, profile)), kind: 'filament' as const, slot: slotOf(b.color), color: b.color }));
}

/** Requested changes equivalent to a list of slicer entries (the inverse of {@link bandsToSlicerEntries}). */
export function slicerEntriesToChanges(entries: readonly SlicerLayerEntry[], profile: LayerProfile): LayerColorChange[] {
  return [...entries]
    .sort((a, b) => a.topZ - b.topZ)
    .map((e) => ({ z: round3(layerBottomZ(layerIndexAt(e.topZ, profile), profile)), color: normalizeHex(e.color) }));
}

const escAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Serialise per-plate entries as `Metadata/custom_gcode_per_layer.xml`.
 * `plates` maps a 1-based plate id to its entries; plates with none are
 * omitted. Returns '' when no plate has any entry (write no file then).
 */
export function serializeLayerEntriesXml(plates: ReadonlyMap<number, readonly SlicerLayerEntry[]>): string {
  const blocks: string[] = [];
  for (const [plateId, entries] of [...plates.entries()].sort((a, b) => a[0] - b[0])) {
    if (entries.length === 0) continue;
    const lines = [...entries].sort((a, b) => a.topZ - b.topZ).map((e) => {
      const tool = e.kind === 'filament';
      return `<layer top_z="${round3(e.topZ)}" type="${tool ? 2 : 0}" extruder="${e.slot}" color="${escAttr(e.color.toUpperCase())}" extra="" gcode="${tool ? 'tool_change' : ''}"/>`;
    });
    // "MultiAsSingle": a multi-filament printer printing a one-filament object, the only case where layer switches apply.
    blocks.push(`<plate>\n<plate_info id="${plateId}"/>\n${lines.join('\n')}\n<mode value="MultiAsSingle"/>\n</plate>`);
  }
  if (blocks.length === 0) return '';
  return `<?xml version="1.0" encoding="utf-8"?>\n<custom_gcodes_per_layer>\n${blocks.join('\n')}\n</custom_gcodes_per_layer>\n`;
}

/**
 * Parse `Metadata/custom_gcode_per_layer.xml` into per-plate entries. Pauses,
 * templates and custom G-code (types 1, 3, 4) carry no colour and are skipped.
 * Tolerant of unknown attributes and of files with no plate wrapper.
 */
export function parseLayerEntriesXml(xml: string): Map<number, SlicerLayerEntry[]> {
  const out = new Map<number, SlicerLayerEntry[]>();
  const attr = (tag: string, name: string): string | null => {
    const m = new RegExp(`\\b${name}="([^"]*)"`).exec(tag);
    return m ? m[1].replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&') : null;
  };
  const readLayers = (chunk: string, plateId: number) => {
    for (const m of chunk.matchAll(/<layer\b[^>]*>/g)) {
      const type = Number(attr(m[0], 'type'));
      const topZ = Number(attr(m[0], 'top_z'));
      const color = attr(m[0], 'color') ?? '';
      if ((type !== 0 && type !== 2) || !Number.isFinite(topZ) || !/^#?[0-9a-f]{6}/i.test(color)) continue;
      const slot = Number(attr(m[0], 'extruder'));
      const entry: SlicerLayerEntry = { topZ, kind: type === 2 ? 'filament' : 'swap', slot: Number.isInteger(slot) && slot > 0 ? slot : 1, color: normalizeHex(color.slice(0, color.startsWith('#') ? 7 : 6)) };
      if (!out.has(plateId)) out.set(plateId, []);
      out.get(plateId)!.push(entry);
    }
  };
  const plates = [...xml.matchAll(/<plate\b[^>]*>([\s\S]*?)<\/plate>/g)];
  if (plates.length === 0) readLayers(xml, 1);
  for (const p of plates) {
    const info = /<plate_info\b[^>]*>/.exec(p[1]);
    const id = Number(info ? attr(info[0], 'id') : NaN);
    readLayers(p[1], Number.isInteger(id) && id > 0 ? id : 1);
  }
  for (const list of out.values()) list.sort((a, b) => a.topZ - b.topZ);
  return out;
}

// ── Estimated blending ───────────────────────────────────────────────────

export type Rgb = [number, number, number];

export function hexToRgb(hex: string): Rgb {
  const h = normalizeHex(hex).slice(1);
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

export function rgbToHex(rgb: Rgb): string {
  return `#${rgb.map((c) => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, '0')).join('')}`;
}

/** How opaque one layer of thickness `h` is for a filament that stops transmitting light at `transmissionDistance` mm. */
export function layerOpacity(h: number, transmissionDistance: number): number {
  if (!(transmissionDistance > 0)) return 1;
  // 10% of the light is left after `transmissionDistance` mm of the filament.
  return 1 - Math.pow(0.1, h / transmissionDistance);
}

/**
 * ESTIMATE of the colour seen looking straight down at a surface at height
 * `z`: the layers under it are composited top-down, each as opaque as its
 * filament's transmission distance makes one layer. It is a rough guide for
 * thin top layers, not a colour-accurate simulation: real results depend on
 * the filament, the light and the infill underneath.
 *
 * @param transmissionOf mm of a colour's filament that light gets through (smaller = more opaque)
 * @param maxLayers how many layers down to look before treating the rest as opaque
 */
export function estimateTopColor(bands: readonly LayerBand[], z: number, profile: LayerProfile, transmissionOf: (color: string) => number, maxLayers: number): string | null {
  if (bands.length === 0) return null;
  const top = Math.min(layerIndexAt(z, profile), bands[bands.length - 1].lastLayer);
  const out: Rgb = [0, 0, 0];
  let remaining = 1; // light not yet stopped by the layers above
  for (let layer = top, n = 0; layer >= 0 && remaining > 0.004; layer--, n++) {
    const band = bands.find((b) => layer >= b.firstLayer && layer <= b.lastLayer) ?? bands[0];
    const h = layer === 0 ? profile.firstLayerHeight : profile.layerHeight;
    const last = n >= maxLayers - 1 || layer === 0;
    const a = last ? 1 : layerOpacity(h, transmissionOf(band.color));
    const rgb = hexToRgb(band.color);
    for (let i = 0; i < 3; i++) out[i] += rgb[i] * a * remaining;
    remaining *= 1 - a;
  }
  return rgbToHex(out);
}
