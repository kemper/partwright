import { describe, it, expect } from 'vitest';
import { encodePaintColorState, decodePaintColorState, MAX_PAINT_STATE } from '../../src/export/paintColor3mf';

describe('paint_color encoding (Bambu/Orca per-triangle filament)', () => {
  it('state 0 (NONE) encodes to the empty string (attribute omitted)', () => {
    expect(encodePaintColorState(0)).toBe('');
    expect(decodePaintColorState('')).toBe(0);
  });

  it('matches the known short-form leaf values for states 1–2', () => {
    // Documented worked example: paint_color="4" => Extruder1 (filament slot 1).
    expect(encodePaintColorState(1)).toBe('4');
    expect(encodePaintColorState(2)).toBe('8');
  });

  it('matches the known escape-form value for state 3 ("0C" => Extruder3)', () => {
    expect(encodePaintColorState(3)).toBe('0C');
    expect(encodePaintColorState(4)).toBe('1C');
    expect(encodePaintColorState(16)).toBe('DC');
  });

  it('produces uppercase-only hex (Bambu silently ignores lowercase)', () => {
    for (let s = 1; s <= MAX_PAINT_STATE; s++) {
      const enc = encodePaintColorState(s);
      expect(enc).toMatch(/^[0-9A-F]+$/);
    }
  });

  it('round-trips every state in the supported range', () => {
    for (let s = 0; s <= MAX_PAINT_STATE; s++) {
      expect(decodePaintColorState(encodePaintColorState(s))).toBe(s);
    }
  });

  it('crosses the 16→17 escape2 boundary correctly', () => {
    expect(decodePaintColorState(encodePaintColorState(16))).toBe(16);
    expect(decodePaintColorState(encodePaintColorState(17))).toBe(17);
    expect(decodePaintColorState(encodePaintColorState(18))).toBe(18);
  });

  it('rejects out-of-range and non-integer states', () => {
    expect(() => encodePaintColorState(-1)).toThrow();
    expect(() => encodePaintColorState(255)).toThrow();
    expect(() => encodePaintColorState(1.5)).toThrow();
  });

  it('rejects malformed / split-node decode input', () => {
    expect(() => decodePaintColorState('zz')).toThrow();
    // A split node has non-zero low 2 bits in the root nibble: 0b0001 = '1'.
    expect(() => decodePaintColorState('1')).toThrow();
  });
});
