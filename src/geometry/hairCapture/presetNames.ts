// Names of the captured hair presets (the 'captured' hair style's `preset`).
// A dependency-free leaf, so the Character Creator spec can resolve names
// without pulling in the ~24 KB preset data.

/** The default (and currently only) captured preset: a shaggy, spiky mop. */
export const DEFAULT_HAIR_PRESET = 'shaggy';

/** Former preset names still found in saved figures and specs. */
export const RENAMED_HAIR_PRESETS: Readonly<Record<string, string>> = { tsubasa: 'shaggy' };

/** A preset name with former names mapped to their current one. */
export function resolveHairPresetName(name: string): string {
  return Object.prototype.hasOwnProperty.call(RENAMED_HAIR_PRESETS, name) ? RENAMED_HAIR_PRESETS[name] : name;
}
