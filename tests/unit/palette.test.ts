import { describe, it, expect } from 'vitest';
import {
  clampMaxSimultaneous,
  makeFilamentColor,
  dedupeColors,
  mergeWithDefaults,
  parseFilamentColors,
  buildPaletteDirective,
  rgbToHex,
  hexToRgb,
  nearestPaletteColor,
  DEFAULT_PAINT_PRESETS,
  MIN_MAX_SIMULTANEOUS,
  MAX_MAX_SIMULTANEOUS,
  type ColorPaletteSettings,
  type FilamentColor,
} from '../../src/color/palette';

const fc = (hex: string, name = ''): FilamentColor => {
  const c = makeFilamentColor(name, hex);
  if (!c) throw new Error(`bad fixture hex ${hex}`);
  return c;
};

describe('clampMaxSimultaneous', () => {
  it('rounds and clamps into range', () => {
    expect(clampMaxSimultaneous(4)).toBe(4);
    expect(clampMaxSimultaneous(3.6)).toBe(4);
    expect(clampMaxSimultaneous(0)).toBe(MIN_MAX_SIMULTANEOUS);
    expect(clampMaxSimultaneous(-5)).toBe(MIN_MAX_SIMULTANEOUS);
    expect(clampMaxSimultaneous(9999)).toBe(MAX_MAX_SIMULTANEOUS);
  });
  it('falls back to the default (4) for non-numbers', () => {
    expect(clampMaxSimultaneous('8' as unknown)).toBe(4);
    expect(clampMaxSimultaneous(NaN)).toBe(4);
    expect(clampMaxSimultaneous(undefined)).toBe(4);
  });
});

describe('makeFilamentColor', () => {
  it('normalizes 3- and 6-digit hex to lowercase #rrggbb', () => {
    expect(makeFilamentColor('White', '#FFF')?.hex).toBe('#ffffff');
    expect(makeFilamentColor('Red', '#FF0000')?.hex).toBe('#ff0000');
  });
  it('returns null for an invalid hex', () => {
    expect(makeFilamentColor('x', 'not-a-color')).toBeNull();
    expect(makeFilamentColor('x', '#12')).toBeNull();
    expect(makeFilamentColor('x', 42)).toBeNull();
  });
  it('trims and caps the name', () => {
    expect(makeFilamentColor('  Matte Black  ', '#000')?.name).toBe('Matte Black');
    expect(makeFilamentColor('a'.repeat(200), '#000')?.name.length).toBe(80);
  });
});

describe('dedupeColors', () => {
  it('keeps the first occurrence of each hex', () => {
    const out = dedupeColors([fc('#ff0000', 'red'), fc('#ff0000', 'crimson'), fc('#00ff00', 'green')]);
    expect(out.map(c => c.hex)).toEqual(['#ff0000', '#00ff00']);
    expect(out[0].name).toBe('red');
  });
});

describe('mergeWithDefaults', () => {
  it('returns the default 16-color palette for null / undefined input', () => {
    const a = mergeWithDefaults(null);
    expect(a.colors).toHaveLength(16);
    expect(a.maxSimultaneous).toBe(4);
    expect(a.enforce).toBe(false);
    expect(mergeWithDefaults(undefined).colors).toHaveLength(16);
  });
  it('sanitizes colors, clamps max, and coerces enforce', () => {
    const merged = mergeWithDefaults({
      colors: [
        { id: 'keep', name: 'Black', hex: '#000000' },
        { name: 'Bad', hex: 'nope' } as unknown as FilamentColor,
        { name: 'White', hex: '#FFF' } as unknown as FilamentColor,
      ],
      maxSimultaneous: 1000,
      enforce: 'yes' as unknown as boolean,
    });
    expect(merged.colors.map(c => c.hex)).toEqual(['#000000', '#ffffff']);
    expect(merged.colors[0].id).toBe('keep'); // existing ids preserved
    expect(merged.maxSimultaneous).toBe(MAX_MAX_SIMULTANEOUS);
    expect(merged.enforce).toBe(false); // only literal true enables it
  });
  it('treats enforce:true literally', () => {
    expect(mergeWithDefaults({ enforce: true }).enforce).toBe(true);
  });
  it('preserves duplicate hexes (the manual list is not deduped on save)', () => {
    // Regression: deduping here silently dropped a freshly-added row still on
    // its default color, diverging the UI from what the AI / a reload saw.
    const merged = mergeWithDefaults({ colors: [fc('#ff0000', 'a'), fc('#ff0000', 'b')] });
    expect(merged.colors).toHaveLength(2);
  });
});

describe('parseFilamentColors', () => {
  it('parses the canonical {filaments:[...]} shape', () => {
    const out = parseFilamentColors('{"filaments":[{"name":"Black","hex":"#000000"},{"name":"Red","hex":"#ff0000"}]}');
    expect(out.map(c => [c.name, c.hex])).toEqual([['Black', '#000000'], ['Red', '#ff0000']]);
  });
  it('strips markdown fences', () => {
    const out = parseFilamentColors('```json\n{"filaments":[{"name":"W","hex":"#fff"}]}\n```');
    expect(out).toHaveLength(1);
    expect(out[0].hex).toBe('#ffffff');
  });
  it('accepts {palette}, {colors}, and bare-array shapes', () => {
    expect(parseFilamentColors('{"palette":[{"name":"a","hex":"#111"}]}')).toHaveLength(1);
    expect(parseFilamentColors('{"colors":[{"name":"a","hex":"#222"}]}')).toHaveLength(1);
    expect(parseFilamentColors('[{"name":"a","hex":"#333"}]')).toHaveLength(1);
  });
  it('tolerates bare hex strings in an array', () => {
    const out = parseFilamentColors('["#ff0000", "#00ff00"]');
    expect(out.map(c => c.hex)).toEqual(['#ff0000', '#00ff00']);
  });
  it('drops invalid hex entries and de-dupes', () => {
    const out = parseFilamentColors('{"filaments":[{"name":"a","hex":"#ff0000"},{"name":"b","hex":"bad"},{"name":"c","hex":"#FF0000"}]}');
    expect(out).toHaveLength(1);
  });
  it('returns [] for non-JSON or wrong-shaped input', () => {
    expect(parseFilamentColors('the colors are red and blue')).toEqual([]);
    expect(parseFilamentColors('{"unexpected":true}')).toEqual([]);
    expect(parseFilamentColors('')).toEqual([]);
  });
});

describe('buildPaletteDirective', () => {
  const enforced = (colors: FilamentColor[], maxSimultaneous = 4): ColorPaletteSettings =>
    ({ colors, maxSimultaneous, enforce: true });

  it('returns null when enforcement is off', () => {
    expect(buildPaletteDirective({ colors: [fc('#000')], maxSimultaneous: 4, enforce: false })).toBeNull();
  });
  it('returns null when enforced but the palette is empty', () => {
    expect(buildPaletteDirective(enforced([]))).toBeNull();
  });
  it('lists colors, names, and the max-simultaneous limit when enforced', () => {
    const out = buildPaletteDirective(enforced([fc('#000000', 'Black'), fc('#ffffff', 'White')], 2))!;
    expect(out).toContain('ENFORCED');
    expect(out).toContain('"Black" #000000');
    expect(out).toContain('"White" #ffffff');
    expect(out).toContain('at most 2 distinct colors');
    expect(out).toContain('getColorPalette()');
  });
  it('uses singular phrasing for a 1-color limit', () => {
    const out = buildPaletteDirective(enforced([fc('#000000', 'Black')], 1))!;
    expect(out).toContain('at most 1 distinct color ');
    expect(out).toContain('1 color)');
  });
});

describe('hex conversion', () => {
  it('rgbToHex clamps and formats', () => {
    expect(rgbToHex([1, 0, 0])).toBe('#ff0000');
    expect(rgbToHex([0, 0, 0])).toBe('#000000');
    expect(rgbToHex([2, -1, 0.5])).toBe('#ff0080'); // clamps out-of-range
  });
  it('hexToRgb round-trips and rejects bad input', () => {
    expect(hexToRgb('#ff0000')).toEqual([1, 0, 0]);
    expect(hexToRgb('#fff')).toEqual([1, 1, 1]);
    expect(hexToRgb('nope')).toBeNull();
    expect(hexToRgb(42)).toBeNull();
  });
});

describe('DEFAULT_PAINT_PRESETS', () => {
  it('is the 16 named paint-picker colors', () => {
    expect(DEFAULT_PAINT_PRESETS).toHaveLength(16);
    expect(DEFAULT_PAINT_PRESETS[0]).toMatchObject({ name: 'Red' });
    expect(DEFAULT_PAINT_PRESETS[15]).toMatchObject({ name: 'Black' });
    // The first-run / reset palette is built from exactly these.
    expect(rgbToHex(DEFAULT_PAINT_PRESETS[15].rgb)).toBe('#000000');
  });
});

describe('nearestPaletteColor', () => {
  const palette = [fc('#000000', 'Black'), fc('#ffffff', 'White'), fc('#ff0000', 'Red')];
  it('snaps an rgb to the closest palette entry', () => {
    expect(nearestPaletteColor([0.05, 0.05, 0.05], palette)?.name).toBe('Black');
    expect(nearestPaletteColor([0.9, 0.95, 0.92], palette)?.name).toBe('White');
    expect(nearestPaletteColor([0.8, 0.1, 0.1], palette)?.name).toBe('Red');
  });
  it('returns null for an empty palette', () => {
    expect(nearestPaletteColor([0.5, 0.5, 0.5], [])).toBeNull();
  });
});
