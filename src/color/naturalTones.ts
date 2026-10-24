// Natural tones (skin, hair) offered beside the filament palette when
// colouring a part or label — figure parts rarely match a filament slot
// exactly. Pure data; shared by the part panel and the paint panel.

/** The default skin tone (the Figure label chips' face / arms colour). */
export const SKIN_TONE = '#e8b98f';

export const NATURAL_TONES: readonly { name: string; hex: string }[] = [
  { name: 'Skin (light)', hex: '#f3d2b8' },
  { name: 'Skin', hex: SKIN_TONE },
  { name: 'Skin (tan)', hex: '#c68d63' },
  { name: 'Skin (deep)', hex: '#8a5a3c' },
  { name: 'Hair (blond)', hex: '#d9b26f' },
  { name: 'Hair (brown)', hex: '#4a2e1c' },
  { name: 'Hair (black)', hex: '#1d1a1a' },
];

/** The picker section built from NATURAL_TONES (ColorPickerOptions.extraSwatches). */
export const NATURAL_TONE_SWATCHES = { title: 'Natural tones', colors: NATURAL_TONES } as const;
