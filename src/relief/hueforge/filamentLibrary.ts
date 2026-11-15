// Built-in filament library for HueForge-style filament-layering prints.
//
// Each entry is a generic colour name, its opaque colour, and a typical
// transmission distance (TD, mm) in the HueForge convention: the thickness at
// which the filament stops letting the colour beneath show through. The TDs are
// representative values for common PLA colours, NOT measurements of any one
// product — the solver only needs them to be in the right ballpark, and users
// who own a TD meter (or a TD table for their spools) should pass their own
// filament list instead (see `HueforgeFilament`).
//
// Pure data, no DOM — used by the solver in the browser, the Worker-free CLI,
// and the unit tests.

export interface HueforgeFilament {
  /** Display name, e.g. "White". Shown in swap instructions. */
  name: string;
  /** Opaque colour, "#rrggbb". */
  hex: string;
  /** Transmission distance in mm (HueForge convention). Larger = more translucent. */
  td: number;
}

/** A broad generic set: neutrals, skin/earth tones, and saturated primaries,
 *  so the solver can pick a good subset for most photos. */
export const HUEFORGE_FILAMENT_LIBRARY: readonly HueforgeFilament[] = [
  // Neutrals
  { name: 'Black', hex: '#161616', td: 0.6 },
  { name: 'Charcoal', hex: '#3b3b3d', td: 0.9 },
  { name: 'Dark Gray', hex: '#545454', td: 1.2 },
  { name: 'Gray', hex: '#8e9089', td: 1.6 },
  { name: 'Light Gray', hex: '#b9bbb6', td: 2.2 },
  { name: 'Ivory', hex: '#f1ead8', td: 3.6 },
  { name: 'White', hex: '#f8f8f6', td: 3.2 },
  // Earth / skin tones
  { name: 'Dark Brown', hex: '#4a3121', td: 0.9 },
  { name: 'Brown', hex: '#7a4e2d', td: 1.3 },
  { name: 'Terracotta', hex: '#b5572e', td: 1.8 },
  { name: 'Caramel', hex: '#c58a4a', td: 2.4 },
  { name: 'Tan', hex: '#d6b48c', td: 3.0 },
  { name: 'Peach', hex: '#f4b98f', td: 4.0 },
  { name: 'Sand', hex: '#e6d3ae', td: 3.4 },
  // Reds / oranges / yellows
  { name: 'Maroon', hex: '#6b1a1f', td: 1.0 },
  { name: 'Red', hex: '#c62a26', td: 1.6 },
  { name: 'Orange', hex: '#f26a1b', td: 3.0 },
  { name: 'Amber', hex: '#f39a1e', td: 3.8 },
  { name: 'Gold', hex: '#e9b72b', td: 4.2 },
  { name: 'Yellow', hex: '#f6e03a', td: 5.5 },
  { name: 'Pale Yellow', hex: '#f6ec9a', td: 6.0 },
  // Pinks / purples
  { name: 'Magenta', hex: '#d0247c', td: 2.4 },
  { name: 'Pink', hex: '#f27c9a', td: 3.6 },
  { name: 'Light Pink', hex: '#f6bccb', td: 5.0 },
  { name: 'Purple', hex: '#5b3c9e', td: 1.4 },
  { name: 'Lavender', hex: '#b39ddb', td: 3.6 },
  // Blues / cyans
  { name: 'Navy', hex: '#14234f', td: 0.8 },
  { name: 'Blue', hex: '#1f4fb4', td: 1.4 },
  { name: 'Cobalt', hex: '#2f6fd0', td: 2.0 },
  { name: 'Cyan', hex: '#0e93cf', td: 2.6 },
  { name: 'Sky Blue', hex: '#7fb8e4', td: 4.0 },
  { name: 'Ice Blue', hex: '#b9dcf0', td: 5.0 },
  { name: 'Teal', hex: '#137b7a', td: 1.8 },
  // Greens
  { name: 'Dark Green', hex: '#17462f', td: 1.0 },
  { name: 'Green', hex: '#1f9a48', td: 2.2 },
  { name: 'Lime', hex: '#9ccf3c', td: 4.0 },
  { name: 'Olive', hex: '#6f6a2e', td: 1.6 },
  { name: 'Mint', hex: '#a8dcc0', td: 4.6 },
];
