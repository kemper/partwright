const STORAGE_KEY = 'partwright-scad-font-v1';

export const SCAD_FONT_FAMILIES = [
  { value: 'Liberation Sans', label: 'Sans' },
  { value: 'Liberation Serif', label: 'Serif' },
  { value: 'Liberation Mono', label: 'Mono' },
] as const;

export type ScadFontFamily = typeof SCAD_FONT_FAMILIES[number]['value'];

/** Worker-side override set via the execute message. Never set on the main thread. */
let _override: ScadFontFamily | null = null;

export function setScadFontOverride(font: ScadFontFamily): void {
  _override = font;
}

export function getScadFont(): ScadFontFamily {
  if (_override !== null) return _override;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'Liberation Sans' || stored === 'Liberation Serif' || stored === 'Liberation Mono') {
      return stored;
    }
  } catch { /* Worker context — no localStorage */ }
  return 'Liberation Sans';
}

export function setScadFont(font: ScadFontFamily): void {
  localStorage.setItem(STORAGE_KEY, font);
}
