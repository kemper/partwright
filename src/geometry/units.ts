// Unit system declaration — metadata only, no coordinate transformation

export type UnitSystem = 'mm' | 'cm' | 'in' | 'unitless';

const STORAGE_KEY = 'partwright-units';
const VALID_UNITS: readonly UnitSystem[] = ['mm', 'cm', 'in', 'unitless'];

// Default MUST stay 'unitless' for back-compat (it drives export filenames and
// the 3MF unit attribute). Persisted across sessions in localStorage so a
// chosen unit sticks, but a fresh browser still starts unitless.
function readPersistedUnit(): UnitSystem {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && (VALID_UNITS as readonly string[]).includes(stored)) {
      return stored as UnitSystem;
    }
  } catch {
    // localStorage unavailable (private mode / SSR) — fall through to default.
  }
  return 'unitless';
}

let currentUnit: UnitSystem = readPersistedUnit();

export function setUnits(unit: UnitSystem): void {
  currentUnit = unit;
  try {
    localStorage.setItem(STORAGE_KEY, unit);
  } catch {
    // Persisting is best-effort; the in-memory value still updates.
  }
}

export function getUnits(): UnitSystem {
  return currentUnit;
}

export function formatDimension(value: number): string {
  if (currentUnit === 'unitless') return value.toFixed(2);
  return `${value.toFixed(2)} ${currentUnit}`;
}

export function get3MFUnitString(): string {
  switch (currentUnit) {
    case 'mm': return 'millimeter';
    case 'cm': return 'centimeter';
    case 'in': return 'inch';
    default: return 'millimeter'; // 3MF requires a unit
  }
}
