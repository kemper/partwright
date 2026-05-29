import { describe, it, expect, beforeEach, vi } from 'vitest';

// A minimal localStorage stub for the node test environment. units.ts reads
// the persisted value at module-init, so we install the stub before importing.
function installLocalStorageStub(): Map<string, string> {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => { store.set(k, String(v)); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => { store.clear(); },
  });
  return store;
}

describe('units', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it('defaults to unitless (back-compat) when nothing is persisted', async () => {
    installLocalStorageStub();
    const { getUnits, get3MFUnitString, formatDimension } = await import('../../src/geometry/units');
    expect(getUnits()).toBe('unitless');
    // 3MF still requires a concrete unit — unitless maps to millimeter.
    expect(get3MFUnitString()).toBe('millimeter');
    // formatDimension shows no unit suffix when unitless.
    expect(formatDimension(1)).toBe('1.00');
  });

  it('maps mm to millimeter and suffixes formatted dimensions', async () => {
    installLocalStorageStub();
    const { setUnits, get3MFUnitString, formatDimension } = await import('../../src/geometry/units');
    setUnits('mm');
    expect(get3MFUnitString()).toBe('millimeter');
    expect(formatDimension(1)).toBe('1.00 mm');
  });

  it('maps cm and in to their 3MF unit strings', async () => {
    installLocalStorageStub();
    const { setUnits, get3MFUnitString } = await import('../../src/geometry/units');
    setUnits('cm');
    expect(get3MFUnitString()).toBe('centimeter');
    setUnits('in');
    expect(get3MFUnitString()).toBe('inch');
  });

  it('persists the chosen unit and restores it on a fresh module load', async () => {
    const store = installLocalStorageStub();
    const first = await import('../../src/geometry/units');
    first.setUnits('cm');
    expect(store.get('partwright-units')).toBe('cm');

    // Simulate a reload: reset the module cache but keep the same storage.
    vi.resetModules();
    const second = await import('../../src/geometry/units');
    expect(second.getUnits()).toBe('cm');
  });

  it('ignores a corrupt persisted value and falls back to unitless', async () => {
    const store = installLocalStorageStub();
    store.set('partwright-units', 'furlongs');
    const { getUnits } = await import('../../src/geometry/units');
    expect(getUnits()).toBe('unitless');
  });
});
