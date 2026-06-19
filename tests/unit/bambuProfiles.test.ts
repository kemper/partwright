import { describe, it, expect } from 'vitest';
import { resolvePreset, listPresets } from '../../src/export/bambuProfiles';

// Unit coverage for the BambuStudio profile inheritance resolver (#757 foundation).
// Vendored chain so far: the H2C machine/process/filament presets.

describe('bambuProfiles resolver', () => {
  it('resolves the H2C machine chain, leaf overriding base', () => {
    const m = resolvePreset('machine', 'Bambu Lab H2C 0.4 nozzle');
    // Leaf identity + printer-specific values win over the inherited commons.
    expect(m.name).toBe('Bambu Lab H2C 0.4 nozzle');
    expect(m.printer_model).toBe('Bambu Lab H2C');
    expect(m.printable_area).toEqual(['0x0', '330x0', '330x320', '0x320']);
    // A key that only exists on an inherited base must be present after the merge.
    expect(Object.keys(m).length).toBeGreaterThan(42); // leaf alone is 42 keys
    // Chain-control keys are stripped.
    expect(m.inherits).toBeUndefined();
    expect(m.from).toBeUndefined();
  });

  it('resolves the H2C process and filament chains', () => {
    const proc = resolvePreset('process', '0.20mm Standard @BBL H2C');
    expect(proc.name).toBe('0.20mm Standard @BBL H2C');
    expect(proc.layer_height).toBeDefined(); // inherited from a process base

    const fil = resolvePreset('filament', 'Bambu PLA Basic @BBL H2C');
    expect(fil.name).toBe('Bambu PLA Basic @BBL H2C');
    expect(fil.filament_type).toBeDefined(); // inherited from fdm_filament_pla/base
  });

  it('throws on an unknown preset', () => {
    expect(() => resolvePreset('machine', 'No Such Printer')).toThrow(/unknown machine preset/);
  });

  it('lists leaf presets (not the inherited bases)', () => {
    const machines = listPresets('machine');
    expect(machines).toContain('Bambu Lab H2C 0.4 nozzle');
    // The common bases are inherited-from, so they're not leaves.
    expect(machines).not.toContain('fdm_machine_common');
    expect(machines).not.toContain('fdm_bbl_3dp_002_common');
  });
});
