import { describe, it, expect } from 'vitest';
import {
  normalizeParamSchema,
  resolveParamValues,
  coerceParamValue,
  mergeParamSchemas,
  pruneParamValues,
  protectParamValues,
  normalizeHexColor,
  type ParamSpec,
} from '../../src/geometry/params';

describe('normalizeParamSchema', () => {
  it('normalizes a mixed schema in declaration order with label fallback', () => {
    const schema = normalizeParamSchema({
      width: { type: 'number', default: 30, min: 10, max: 120, step: 1, unit: 'mm' },
      rows: { type: 'int', default: 2, min: 1, max: 6 },
      rounded: { type: 'boolean', default: true, label: 'Rounded corners' },
      style: { type: 'select', default: 'flat', options: ['flat', 'beveled'] },
      title: { type: 'text', default: 'PARTS', maxLength: 12 },
      accent: { type: 'color', default: '#3b82f6' },
    });
    expect(schema.map(s => s.key)).toEqual(['width', 'rows', 'rounded', 'style', 'title', 'accent']);
    expect(schema[0]).toMatchObject({ type: 'number', default: 30, min: 10, max: 120, step: 1, unit: 'mm', label: 'width' });
    expect(schema[2]).toMatchObject({ label: 'Rounded corners', default: true });
    expect(schema[3].options).toEqual([{ value: 'flat', label: 'flat' }, { value: 'beveled', label: 'beveled' }]);
  });

  it('clamps and rounds an out-of-range / non-integer default instead of throwing', () => {
    const schema = normalizeParamSchema({
      n: { type: 'number', default: 999, min: 0, max: 50 },
      i: { type: 'int', default: 2.7, min: 0, max: 10 },
    });
    expect(schema[0].default).toBe(50);
    expect(schema[1].default).toBe(3);
  });

  it('accepts {value,label} options and expands 3-digit hex defaults', () => {
    const schema = normalizeParamSchema({
      mode: { type: 'select', default: 'a', options: [{ value: 'a', label: 'Alpha' }, { value: 'b' }] },
      c: { type: 'color', default: '#abc' },
    });
    expect(schema[0].options).toEqual([{ value: 'a', label: 'Alpha' }, { value: 'b', label: 'b' }]);
    expect(schema[1].default).toBe('#aabbcc');
  });

  it.each([
    [{ w: { type: 'banana', default: 1 } }, /type/],
    [{ w: { type: 'number' } }, /missing "default"/],
    [{ w: { type: 'number', default: 'x' } }, /finite number/],
    [{ w: { type: 'number', default: 1, min: 10, max: 5 } }, /min .* max/],
    [{ w: { type: 'number', default: 1, mn: 0 } }, /unknown field "mn"/],
    [{ w: { type: 'select', default: 'z', options: ['a', 'b'] } }, /must be one of/],
    [{ w: { type: 'select', default: 'a', options: [] } }, /non-empty/],
    [{ w: { type: 'boolean', default: 'yes' } }, /true or false/],
    [{ w: { type: 'color', default: 'red' } }, /hex color/],
    ['not an object', /expected an object/],
  ])('throws on malformed schema %#', (input, re) => {
    expect(() => normalizeParamSchema(input)).toThrow(re as RegExp);
  });
});

describe('resolveParamValues', () => {
  const schema = normalizeParamSchema({
    width: { type: 'number', default: 30, min: 10, max: 120 },
    rows: { type: 'int', default: 2, min: 1, max: 6 },
    rounded: { type: 'boolean', default: true },
    style: { type: 'select', default: 'flat', options: ['flat', 'beveled'] },
    title: { type: 'text', default: 'PARTS', maxLength: 4 },
    accent: { type: 'color', default: '#3b82f6' },
  });

  it('returns defaults when there are no overrides', () => {
    expect(resolveParamValues(schema)).toEqual({
      width: 30, rows: 2, rounded: true, style: 'flat', title: 'PART', accent: '#3b82f6',
    });
  });

  it('applies valid overrides and clamps/rounds/truncates as needed', () => {
    expect(resolveParamValues(schema, {
      width: 999, rows: 3.6, rounded: false, style: 'beveled', title: 'ABCDEFG', accent: '#ABCDEF',
    })).toEqual({
      width: 120, rows: 4, rounded: false, style: 'beveled', title: 'ABCD', accent: '#abcdef',
    });
  });

  it('falls back to the default for invalid overrides and ignores unknown keys', () => {
    expect(resolveParamValues(schema, {
      width: 'nope', style: 'nonexistent', rounded: 'true', accent: 'blue', bogus: 1,
    })).toEqual({
      width: 30, rows: 2, rounded: true, style: 'flat', title: 'PART', accent: '#3b82f6',
    });
  });

  it('coerces numeric strings (slider/text inputs emit strings)', () => {
    const spec = schema[0];
    expect(coerceParamValue(spec, '45')).toBe(45);
  });
});

describe('mergeParamSchemas', () => {
  it('dedupes by key (last wins) preserving first-seen order', () => {
    const a = normalizeParamSchema({ x: { type: 'number', default: 1 }, y: { type: 'number', default: 2 } });
    const b = normalizeParamSchema({ y: { type: 'number', default: 9 }, z: { type: 'number', default: 3 } });
    const merged = mergeParamSchemas([a, b]);
    expect(merged.map(s => s.key)).toEqual(['x', 'y', 'z']);
    expect(merged.find(s => s.key === 'y')!.default).toBe(9);
  });
});

describe('pruneParamValues', () => {
  const schema: ParamSpec[] = normalizeParamSchema({
    w: { type: 'number', default: 10, min: 0, max: 100 },
    on: { type: 'boolean', default: false },
  });

  it('keeps only in-schema, non-default values and drops stale keys', () => {
    expect(pruneParamValues(schema, { w: 25, on: false, gone: 7 })).toEqual({ w: 25 });
  });

  it('returns empty when nothing differs from defaults', () => {
    expect(pruneParamValues(schema, { w: 10, on: false })).toEqual({});
  });
});

describe('protectParamValues', () => {
  const p = protectParamValues({ width: 30, rounded: true });

  it('returns declared values normally', () => {
    expect(p.width).toBe(30);
    expect(p.rounded).toBe(true);
  });

  it('throws a helpful error on an undeclared (typo) key', () => {
    expect(() => (p as Record<string, unknown>).widht).toThrow(/no parameter "widht".*Declared: width, rounded/s);
  });

  it('still supports destructuring, spread, JSON.stringify, and `in`', () => {
    const { width } = p;
    expect(width).toBe(30);
    expect({ ...p }).toEqual({ width: 30, rounded: true });
    expect(JSON.stringify(p)).toBe('{"width":30,"rounded":true}');
    expect('rounded' in p).toBe(true);
    expect('nope' in p).toBe(false);
  });
});

describe('normalizeHexColor', () => {
  it('passes #rrggbb, expands #rgb, rejects junk', () => {
    expect(normalizeHexColor('#3B82F6')).toBe('#3b82f6');
    expect(normalizeHexColor('#abc')).toBe('#aabbcc');
    expect(normalizeHexColor('red')).toBeNull();
    expect(normalizeHexColor(123)).toBeNull();
  });
});
