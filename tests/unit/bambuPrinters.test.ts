import { describe, test, expect } from 'vitest';
import { BAMBU_PRINTERS, DEFAULT_BAMBU_PRINTER } from '../../src/export/threemfProject';

// Pins every Bambu printer's exact `model` (printer_model) and `process`
// (print_settings_id) string. Both are verified verbatim against BambuStudio's
// live `master` profile bundle (resources/profiles/BBL, 2026-06-21): each
// `process` is the `name` of a `0.20mm Standard @BBL *` preset whose
// `compatible_printers` includes the model. If one of these strings is wrong,
// Bambu rejects the exported project as "printer not compatible with the process
// preset" (rc -17) — so a silent drift here ships a broken export. Update a row
// here ONLY after re-confirming it against the BBL bundle.
const VERIFIED: Record<string, { model: string; process: string }> = {
  h2c:    { model: 'Bambu Lab H2C',         process: '0.20mm Standard @BBL H2C' },
  h2d:    { model: 'Bambu Lab H2D',         process: '0.20mm Standard @BBL H2D' },
  h2dpro: { model: 'Bambu Lab H2D Pro',     process: '0.20mm Standard @BBL H2DP' },
  x2d:    { model: 'Bambu Lab X2D',         process: '0.20mm Standard @BBL X2D' },
  h2s:    { model: 'Bambu Lab H2S',         process: '0.20mm Standard @BBL H2S' },
  a2l:    { model: 'Bambu Lab A2L',         process: '0.20mm Standard @BBL A2L' },
  x1c:    { model: 'Bambu Lab X1 Carbon',   process: '0.20mm Standard @BBL X1C' },
  x1e:    { model: 'Bambu Lab X1E',         process: '0.20mm Standard @BBL X1C' },
  x1:     { model: 'Bambu Lab X1',          process: '0.20mm Standard @BBL X1C' },
  p1s:    { model: 'Bambu Lab P1S',         process: '0.20mm Standard @BBL X1C' },
  p1p:    { model: 'Bambu Lab P1P',         process: '0.20mm Standard @BBL P1P' },
  p2s:    { model: 'Bambu Lab P2S',         process: '0.20mm Standard @BBL P2S' },
  a1:     { model: 'Bambu Lab A1',          process: '0.20mm Standard @BBL A1' },
  a1mini: { model: 'Bambu Lab A1 mini',     process: '0.20mm Standard @BBL A1M' },
};

describe('BAMBU_PRINTERS preset strings (verified against the BBL bundle)', () => {
  test('the list matches the verified id set exactly (no silent add/remove)', () => {
    expect(BAMBU_PRINTERS.map(p => p.id).sort()).toEqual(Object.keys(VERIFIED).sort());
  });

  test('the default printer exists in the list', () => {
    expect(BAMBU_PRINTERS.some(p => p.id === DEFAULT_BAMBU_PRINTER)).toBe(true);
  });

  for (const printer of BAMBU_PRINTERS) {
    test(`${printer.id} pins its verified model + process`, () => {
      const v = VERIFIED[printer.id];
      expect(v, `unverified printer id "${printer.id}" — confirm against the BBL bundle and add it to VERIFIED`).toBeDefined();
      expect(printer.model).toBe(v.model);
      expect(printer.process).toBe(v.process);
    });
  }
});
