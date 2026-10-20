import { describe, it, expect } from 'vitest';
import { clampEntry, entryTitle, formatEntry, stepDecimals } from '../../src/ui/sliderEntry';

describe('sliderEntry pure helpers', () => {
  it('clampEntry clamps to the hard bounds, which may be open-ended', () => {
    expect(clampEntry(30, { hardMin: 1, hardMax: 100 })).toBe(30);
    expect(clampEntry(500, { hardMin: 1, hardMax: 100 })).toBe(100);
    expect(clampEntry(-3, { hardMin: 0, hardMax: Infinity })).toBe(0);
    expect(clampEntry(1e9, { hardMin: 0, hardMax: Infinity })).toBe(1e9);
    expect(clampEntry(-1e9, {})).toBe(-1e9);
  });

  it('clampEntry rounds only when integer', () => {
    expect(clampEntry(70.5, { hardMax: Infinity })).toBe(70.5);
    expect(clampEntry(70.4, { hardMax: Infinity, integer: true })).toBe(70);
    // Rounds after clamping, so a fractional hard bound still yields an integer.
    expect(clampEntry(9, { hardMax: 7.6, integer: true })).toBe(8);
  });

  it('stepDecimals counts every digit of the step', () => {
    expect(stepDecimals(1)).toBe(0);
    expect(stepDecimals(5)).toBe(0);
    expect(stepDecimals(0.5)).toBe(1);
    expect(stepDecimals(0.05)).toBe(2);
    expect(stepDecimals(0.185)).toBe(3);   // span-scaled step (span 37 × 0.005)
    expect(stepDecimals(37 * 0.005)).toBe(3); // float noise in the product is ignored
    expect(stepDecimals(0.0005)).toBe(4);
  });

  it('formatEntry fixes to decimals without trailing zeros, or stays precision-safe', () => {
    expect(formatEntry(0.555, 3)).toBe('0.555');
    expect(formatEntry(2.5, 3)).toBe('2.5');
    expect(formatEntry(12.0001, 2)).toBe('12');
    expect(formatEntry(0.1 + 0.2)).toBe('0.3');
    expect(formatEntry(98.39999999999999)).toBe('98.4');
    expect(formatEntry(0.123456789)).toBe('0.123456789');
  });

  it('entryTitle says how far past the slider a typed value may go', () => {
    expect(entryTitle(12, 12)).toBe('Type an exact value');
    expect(entryTitle(12, 100)).toBe('Type a value up to 100 to go past the slider');
    expect(entryTitle(12, Infinity)).toBe('Type any value to go past the slider');
  });
});
