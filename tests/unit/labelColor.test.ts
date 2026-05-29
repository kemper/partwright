import { describe, it, expect } from 'vitest';
import { parseLabelColor } from '../../src/color/labelColor';

describe('parseLabelColor', () => {
  it('parses 6-digit hex to RGB 0..1', () => {
    expect(parseLabelColor('#ff0000')).toEqual([1, 0, 0]);
    expect(parseLabelColor('#00ff00')).toEqual([0, 1, 0]);
    expect(parseLabelColor('#0000ff')).toEqual([0, 0, 1]);
    const white = parseLabelColor('#ffffff')!;
    expect(white.every((c) => c === 1)).toBe(true);
  });

  it('expands 3-digit hex (and is case-insensitive)', () => {
    expect(parseLabelColor('#F00')).toEqual([1, 0, 0]);
    expect(parseLabelColor('#FFF')).toEqual([1, 1, 1]);
  });

  it('parses a mid-tone hex to the right fractions', () => {
    const [r, g, b] = parseLabelColor('#3b82f6')!; // tailwind blue-500
    expect(r).toBeCloseTo(0x3b / 255, 5);
    expect(g).toBeCloseTo(0x82 / 255, 5);
    expect(b).toBeCloseTo(0xf6 / 255, 5);
  });

  it('accepts an [r,g,b] array in 0..1 and clamps out-of-range', () => {
    expect(parseLabelColor([0.2, 0.4, 0.6])).toEqual([0.2, 0.4, 0.6]);
    expect(parseLabelColor([1.5, -0.5, 0.5])).toEqual([1, 0, 0.5]);
  });

  it('rejects malformed input', () => {
    expect(parseLabelColor('red')).toBeNull();
    expect(parseLabelColor('#12')).toBeNull();
    expect(parseLabelColor('#1234')).toBeNull();
    expect(parseLabelColor([1, 2])).toBeNull(); // wrong length
    expect(parseLabelColor([1, 2, 'x'])).toBeNull(); // non-numeric
    expect(parseLabelColor([1, 2, NaN])).toBeNull(); // non-finite
    expect(parseLabelColor(null)).toBeNull();
    expect(parseLabelColor(undefined)).toBeNull();
    expect(parseLabelColor(0xff0000)).toBeNull(); // number, not hex string
    expect(parseLabelColor({ r: 1, g: 0, b: 0 })).toBeNull();
  });
});
