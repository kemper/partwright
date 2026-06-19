// BambuStudio profile resolver — the foundation of the printer-aware Bambu export
// (tracking #757). Bambu's official presets live in `bambuProfiles/{machine,process,
// filament}/*.json`, each optionally carrying an `inherits` pointer to a base preset.
// A printer's full config is the leaf preset merged onto its inherited chain
// (base → leaf, leaf wins), e.g.:
//   machine "Bambu Lab H2C 0.4 nozzle" → fdm_bbl_3dp_002_common → fdm_machine_common
//
// This module resolves those chains into a single flat preset. Composing the three
// resolved presets (machine + process + filament) into a project_settings.config —
// and wiring a printer picker — builds on top of this in follow-up work; this layer
// is deliberately pure + dependency-free so it unit-tests headlessly.
//
// The vendored JSONs are BambuStudio's open-source system profiles (AGPL-3.0);
// see the PR for the licensing note. Only the H2C chain is vendored so far (the
// regression anchor that matches the shipped hardcoded template); more printers are
// added by dropping their preset chains into these folders.

export type ProfileKind = 'machine' | 'process' | 'filament';
export type Preset = Record<string, unknown>;

// Eagerly bundle every vendored profile JSON. Vite/vitest resolve import.meta.glob
// at build time, so this is static (no runtime fetch).
const RAW: Record<ProfileKind, Record<string, Preset>> = {
  machine: importKind(import.meta.glob('./bambuProfiles/machine/*.json', { eager: true })),
  process: importKind(import.meta.glob('./bambuProfiles/process/*.json', { eager: true })),
  filament: importKind(import.meta.glob('./bambuProfiles/filament/*.json', { eager: true })),
};

/** Index a glob result by each preset's `name` field (which `inherits` references). */
function importKind(mods: Record<string, unknown>): Record<string, Preset> {
  const out: Record<string, Preset> = {};
  for (const mod of Object.values(mods)) {
    const preset = ((mod as { default?: Preset }).default ?? mod) as Preset;
    const name = preset.name;
    if (typeof name === 'string') out[name] = preset;
  }
  return out;
}

/** List the available leaf presets of a kind (those not used purely as a base). A
 *  preset is a "leaf" if no other preset inherits from it. */
export function listPresets(kind: ProfileKind): string[] {
  const all = RAW[kind];
  const usedAsBase = new Set<string>();
  for (const p of Object.values(all)) if (typeof p.inherits === 'string') usedAsBase.add(p.inherits);
  return Object.keys(all).filter(name => !usedAsBase.has(name)).sort();
}

/**
 * Resolve a preset's full key set by merging its `inherits` chain (base first, leaf
 * overrides). A child key replaces the parent's value wholesale (Bambu semantics —
 * arrays are not concatenated). The chain-control keys (`inherits`, `from`) are
 * dropped from the result; `name` is kept (it's the preset identity).
 * Throws on an unknown name or an inheritance cycle.
 */
export function resolvePreset(kind: ProfileKind, name: string): Preset {
  const all = RAW[kind];
  // Walk leaf → root, collecting the chain.
  const chain: Preset[] = [];
  const seen = new Set<string>();
  let cur: string | undefined = name;
  while (cur) {
    if (seen.has(cur)) throw new Error(`bambuProfiles: inheritance cycle at "${cur}" (${kind})`);
    seen.add(cur);
    const preset: Preset | undefined = all[cur];
    if (!preset) throw new Error(`bambuProfiles: unknown ${kind} preset "${cur}"`);
    chain.push(preset);
    cur = typeof preset.inherits === 'string' ? preset.inherits : undefined;
  }
  // Merge root → leaf so leaf wins.
  const merged: Preset = {};
  for (let i = chain.length - 1; i >= 0; i--) Object.assign(merged, chain[i]);
  delete merged.inherits;
  delete merged.from;
  return merged;
}
