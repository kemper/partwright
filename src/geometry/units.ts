// Unit system declaration — metadata only, no coordinate transformation

import { readPerTabPref, writePerTabPref } from '../storage/perTabPref';

export type UnitSystem = 'mm' | 'cm' | 'in' | 'unitless';

const STORAGE_KEY = 'partwright-units';
const VALID_UNITS: readonly UnitSystem[] = ['mm', 'cm', 'in', 'unitless'];

// Default MUST stay 'unitless' for back-compat (it drives export filenames and
// the 3MF unit attribute). Persisted per-tab (with a shared seed for fresh
// tabs) so a chosen unit sticks for this window without retroactively changing
// the unit — and thus the export unit attribute — of another open window. A
// fresh browser still starts unitless.
function readPersistedUnit(): UnitSystem {
  const stored = readPerTabPref(STORAGE_KEY);
  if (stored && (VALID_UNITS as readonly string[]).includes(stored)) {
    return stored as UnitSystem;
  }
  return 'unitless';
}

let currentUnit: UnitSystem = readPersistedUnit();

export function setUnits(unit: UnitSystem): void {
  currentUnit = unit;
  writePerTabPref(STORAGE_KEY, unit);
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
