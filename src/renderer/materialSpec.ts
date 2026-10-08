// Viewport material presets — pure data, deliberately free of any `three`
// import so the geometry Worker (which records `api.material(...)` calls) can
// validate against the same table the renderer applies. The preset changes how
// the model is SHADED in the viewport (PBR params against the studio IBL);
// geometry, exports, and printability are untouched — it's the "what will this
// look like in brass?" layer, not a manufacturing property.

export interface MaterialSpec {
  /** Named preset this spec started from (for display / round-tripping). */
  preset?: MaterialPresetName;
  /** Base color as 0..1 RGB. Omitted = the preset's own color (or, for painted
   *  models, the paint shows through unchanged). */
  color?: [number, number, number];
  metalness?: number;    // 0..1
  roughness?: number;    // 0..1
  clearcoat?: number;    // 0..1 — lacquered/ceramic sheen
  transmission?: number; // 0..1 — glass-like transparency (physical material)
  opacity?: number;      // 0..1 — plain alpha fade (1 = opaque)
}

export type MaterialPresetName =
  | 'plastic' | 'matte' | 'satin'
  | 'gold' | 'brass' | 'copper' | 'steel' | 'chrome'
  | 'glass' | 'rubber' | 'ceramic' | 'wood';

/** The preset table. Colors are 0..1 RGB; omitted fields fall back to the
 *  studio default material's values at apply time. */
export const MATERIAL_PRESETS: Record<MaterialPresetName, MaterialSpec> = {
  plastic: { roughness: 0.45, metalness: 0 },
  matte: { roughness: 1, metalness: 0 },
  satin: { roughness: 0.3, metalness: 0, clearcoat: 0.35 },
  gold: { color: [1.0, 0.77, 0.34], roughness: 0.24, metalness: 1 },
  brass: { color: [0.85, 0.70, 0.36], roughness: 0.3, metalness: 1 },
  copper: { color: [0.78, 0.49, 0.31], roughness: 0.3, metalness: 1 },
  steel: { color: [0.75, 0.77, 0.78], roughness: 0.35, metalness: 1 },
  chrome: { color: [0.87, 0.88, 0.9], roughness: 0.07, metalness: 1 },
  glass: { color: [0.9, 0.95, 0.97], roughness: 0.08, metalness: 0, transmission: 0.92 },
  rubber: { color: [0.13, 0.13, 0.14], roughness: 0.92, metalness: 0 },
  ceramic: { color: [0.95, 0.94, 0.9], roughness: 0.16, metalness: 0, clearcoat: 0.55 },
  wood: { color: [0.54, 0.38, 0.22], roughness: 0.72, metalness: 0 },
};

export const MATERIAL_PRESET_NAMES = Object.keys(MATERIAL_PRESETS) as MaterialPresetName[];

export function isMaterialPresetName(v: unknown): v is MaterialPresetName {
  return typeof v === 'string' && v in MATERIAL_PRESETS;
}

/** Resolve a preset name + overrides into a concrete spec (overrides win). */
export function resolveMaterialSpec(spec: MaterialSpec): MaterialSpec {
  const base = spec.preset ? MATERIAL_PRESETS[spec.preset] : {};
  return { ...base, ...Object.fromEntries(Object.entries(spec).filter(([, v]) => v !== undefined)) };
}
