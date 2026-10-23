// Label chips (#1050) — named parts with default colours that the Part
// Detection panel offers as one-click "pick, then click the model" pins, so
// splitting a figurine needs no typing. Pure data + helpers (no DOM): the
// panel draws the chips, listPartDetectors() hands the same lists to agents
// so a seeded detectParts can use the same names and colours.

import { overlayColor } from './draft';

export interface LabelChip {
  name: string;
  /** Default part colour (`#rrggbb`) — becomes the part's colour. */
  color: string;
}

export type LabelPresetId = 'figure' | 'generic';

export interface LabelPreset {
  id: LabelPresetId;
  title: string;
  chips: LabelChip[];
}

/** Skin tone shared by the face and arms chips. */
const SKIN = '#e8b98f';

export const LABEL_PRESETS: readonly LabelPreset[] = [
  {
    id: 'figure',
    title: 'Figure',
    chips: [
      { name: 'hair', color: '#4a2e1c' },
      { name: 'face', color: SKIN },
      { name: 'eyes', color: '#16161a' },
      { name: 'shirt', color: '#f2f2f2' },
      { name: 'arms', color: SKIN },
      { name: 'shorts', color: '#2f4a8a' },
      { name: 'socks', color: '#e4e8ee' },
      { name: 'shoes', color: '#2a2a2e' },
      { name: 'ball', color: '#fafafa' },
    ],
  },
  {
    id: 'generic',
    title: 'Generic',
    chips: Array.from({ length: 9 }, (_, i) => ({ name: `part ${i + 1}`, color: overlayColor(i, null) })),
  },
];

export function labelPreset(id: LabelPresetId): LabelPreset {
  return LABEL_PRESETS.find((p) => p.id === id) ?? LABEL_PRESETS[0];
}

/** What a chip shows for the current draft: `owned` when a part of that
 *  name covers at least `minAreaFrac` of the surface (✓ + the part's
 *  colour), `missed` when a pin was placed for it but its part came out
 *  empty or below that size ("missed — click again"), else `idle`. */
export type ChipState = 'owned' | 'missed' | 'idle';

export function chipState(
  name: string,
  parts: readonly { name: string; areaFrac: number }[],
  pinned: boolean,
  minAreaFrac: number,
): ChipState {
  const p = parts.find((x) => x.name === name);
  if (p && p.areaFrac >= minAreaFrac) return 'owned';
  return pinned ? 'missed' : 'idle';
}
