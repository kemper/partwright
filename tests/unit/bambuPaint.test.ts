import { describe, it, expect } from 'vitest';
import { encodePaintColor, paintColorForMaterial } from '../../src/export/bambuPaint';

describe('encodePaintColor', () => {
  it('returns no attribute for the default extruder (state ≤ 1)', () => {
    expect(encodePaintColor(0)).toBe('');
    expect(encodePaintColor(1)).toBe('');
    expect(encodePaintColor(-3)).toBe('');
  });

  it('encodes state 2 as a single nibble', () => {
    // leaf: split 00, state-bits 10 → nibble 0x8
    expect(encodePaintColor(2)).toBe('8');
  });

  it('escapes states ≥ 3 with the 0xC nibble + (state-3)', () => {
    expect(encodePaintColor(3)).toBe('C0');
    expect(encodePaintColor(4)).toBe('C1');
    expect(encodePaintColor(5)).toBe('C2');
    expect(encodePaintColor(10)).toBe('C7');
    // state 16 (16th filament, Bambu's max) → (16-3)=13 → 0xD
    expect(encodePaintColor(16)).toBe('CD');
  });

  it('throws past Bambu\'s 16-filament limit instead of silently wrapping', () => {
    // Before the guard, (state-3) & 0xf made state 19 collide with state 3.
    expect(() => encodePaintColor(17)).toThrow(/at most 16 filaments/);
    expect(() => encodePaintColor(19)).toThrow(/at most 16 filaments/);
  });

  it('ignores non-integer input', () => {
    expect(encodePaintColor(2.5)).toBe('');
    expect(encodePaintColor(NaN)).toBe('');
  });
});

describe('paintColorForMaterial', () => {
  it('leaves the base/default slot (0) unpainted', () => {
    expect(paintColorForMaterial(0)).toBe('');
    expect(paintColorForMaterial(-1)).toBe('');
  });

  it('maps painted slot m to extruder (m+1)', () => {
    // slot 1 → extruder 2 → "8"
    expect(paintColorForMaterial(1)).toBe('8');
    // slot 2 → extruder 3 → "C0"
    expect(paintColorForMaterial(2)).toBe('C0');
    // slot 3 → extruder 4 → "C1"
    expect(paintColorForMaterial(3)).toBe('C1');
  });
});
