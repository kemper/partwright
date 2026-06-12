// Per-browser printer / build-volume settings. These describe the physical
// 3D printer the user is targeting so the print-aware tools (printability
// checks, scale-to-fit, split-for-printing) all read one shared source of
// truth. Persisted to localStorage as one JSON blob, mirroring the
// qualitySettings.ts pattern (cache + listeners + merge-with-defaults).
//
// Units follow the app convention: "arbitrary, but treat as millimetres for
// printing." The defaults match a common 256 mm bed (e.g. Bambu X1/P1).

const STORAGE_KEY = 'partwright-printer-settings-v1';

export interface PrinterSettings {
  /** Build volume in model units (mm), [x, y, z]. */
  bed: [number, number, number];
  /** Nozzle diameter (mm). Drives the minimum-wall / small-feature checks. */
  nozzleWidth: number;
  /** First-layer / line width is derived from nozzle; kept simple here. */
  /** Steepest unsupported overhang measured from the horizontal plane, in
   *  degrees. Downward-facing surfaces shallower than this need support.
   *  45 reproduces the classic "45° rule" (a wall leaning 45° from vertical
   *  is the boundary). A flat ceiling (0° from horizontal) is always flagged. */
  overhangAngleDeg: number;
  /** Assembly clearance (mm) used for connector/dowel holes when splitting. */
  clearance: number;
}

export const DEFAULT_PRINTER_SETTINGS: PrinterSettings = {
  bed: [256, 256, 256],
  nozzleWidth: 0.4,
  overhangAngleDeg: 45,
  clearance: 0.2,
};

/** A few common printers, surfaced as quick presets in the UI. */
export const PRINTER_PRESETS: { id: string; label: string; bed: [number, number, number] }[] = [
  { id: 'bambu', label: 'Bambu X1 / P1 (256³)', bed: [256, 256, 256] },
  { id: 'prusa-mk4', label: 'Prusa MK4 (250×210×220)', bed: [250, 210, 220] },
  { id: 'ender3', label: 'Ender 3 (220×220×250)', bed: [220, 220, 250] },
  { id: 'a1mini', label: 'Bambu A1 mini (180³)', bed: [180, 180, 180] },
  { id: 'mini', label: 'Prusa Mini (180×180×180)', bed: [180, 180, 180] },
];

const MIN_BED = 10;
const MAX_BED = 2000;
const MIN_NOZZLE = 0.05;
const MAX_NOZZLE = 2;

let cached: PrinterSettings | null = null;
const listeners = new Set<(s: PrinterSettings) => void>();

function clampBedAxis(n: unknown, fallback: number): number {
  if (typeof n !== 'number' || !Number.isFinite(n)) return fallback;
  return Math.min(MAX_BED, Math.max(MIN_BED, n));
}

function mergeWithDefaults(partial: Partial<PrinterSettings>): PrinterSettings {
  const d = DEFAULT_PRINTER_SETTINGS;
  const bedIn = Array.isArray(partial.bed) ? partial.bed : d.bed;
  const bed: [number, number, number] = [
    clampBedAxis(bedIn[0], d.bed[0]),
    clampBedAxis(bedIn[1], d.bed[1]),
    clampBedAxis(bedIn[2], d.bed[2]),
  ];
  const nozzleWidth = typeof partial.nozzleWidth === 'number' && Number.isFinite(partial.nozzleWidth)
    ? Math.min(MAX_NOZZLE, Math.max(MIN_NOZZLE, partial.nozzleWidth))
    : d.nozzleWidth;
  const overhangAngleDeg = typeof partial.overhangAngleDeg === 'number' && Number.isFinite(partial.overhangAngleDeg)
    ? Math.min(89, Math.max(1, partial.overhangAngleDeg))
    : d.overhangAngleDeg;
  const clearance = typeof partial.clearance === 'number' && Number.isFinite(partial.clearance)
    ? Math.min(5, Math.max(0, partial.clearance))
    : d.clearance;
  return { bed, nozzleWidth, overhangAngleDeg, clearance };
}

export function loadPrinterSettings(): PrinterSettings {
  if (cached) return cached;
  if (typeof localStorage === 'undefined') {
    cached = { ...DEFAULT_PRINTER_SETTINGS, bed: [...DEFAULT_PRINTER_SETTINGS.bed] };
    return cached;
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      cached = mergeWithDefaults(JSON.parse(raw) as Partial<PrinterSettings>);
      return cached;
    }
  } catch {
    // Fall through to defaults on parse / storage error.
  }
  cached = { ...DEFAULT_PRINTER_SETTINGS, bed: [...DEFAULT_PRINTER_SETTINGS.bed] };
  return cached;
}

export function savePrinterSettings(next: Partial<PrinterSettings>): PrinterSettings {
  const merged = mergeWithDefaults({ ...loadPrinterSettings(), ...next });
  cached = merged;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
  } catch {
    // localStorage may be full or disabled (private browsing). Settings
    // remain applied for this session; we don't surface the failure.
  }
  for (const fn of listeners) fn(merged);
  return merged;
}

export function onPrinterSettingsChange(fn: (s: PrinterSettings) => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** Convenience: the build volume as a plain tuple. */
export function getBuildVolume(): [number, number, number] {
  return [...loadPrinterSettings().bed];
}
