import { describe, it, expect } from 'vitest';
import { parseScadParams, buildScadDefines } from '../../src/geometry/scadParams';

function byKey(src: string) {
  const map = new Map(parseScadParams(src).map(s => [s.key, s]));
  return map;
}

describe('parseScadParams — widget inference', () => {
  it('integer range slider from [min:max]', () => {
    const s = byKey('width = 30; // [10:100]').get('width')!;
    expect(s).toMatchObject({ key: 'width', type: 'int', default: 30, min: 10, max: 100 });
  });

  it('range with explicit step [min:step:max]', () => {
    const s = byKey('rows = 2; // [1:1:6]').get('rows')!;
    expect(s).toMatchObject({ type: 'int', default: 2, min: 1, max: 6, step: 1 });
  });

  it('float bounds/step yield a number (not int) widget', () => {
    const s = byKey('gap = 2.5; // [0:0.5:5]').get('gap')!;
    expect(s).toMatchObject({ type: 'number', default: 2.5, min: 0, max: 5, step: 0.5 });
  });

  it('plain number with no annotation → number widget, no bounds', () => {
    const s = byKey('h = 12;').get('h')!;
    expect(s.type).toBe('int');
    expect(s.default).toBe(12);
    expect(s.min).toBeUndefined();
    expect(s.max).toBeUndefined();
  });

  it('bare-number annotation on a number is a max', () => {
    const s = byKey('n = 3; // 10').get('n')!;
    expect(s).toMatchObject({ type: 'int', default: 3, max: 10 });
  });

  it('boolean literal → checkbox', () => {
    const s = byKey('solid = true;').get('solid')!;
    expect(s).toMatchObject({ type: 'boolean', default: true });
  });

  it('string literal → text', () => {
    const s = byKey('name = "PART";').get('name')!;
    expect(s).toMatchObject({ type: 'text', default: 'PART' });
  });

  it('string with bare-number annotation → text maxLength', () => {
    const s = byKey('tag = "ABC"; // 12').get('tag')!;
    expect(s).toMatchObject({ type: 'text', default: 'ABC', maxLength: 12 });
  });

  it('string list → select dropdown', () => {
    const s = byKey('style = "flat"; // [flat, beveled, round]').get('style')!;
    expect(s.type).toBe('select');
    expect(s.options?.map(o => o.value)).toEqual(['flat', 'beveled', 'round']);
  });

  it('numeric value:label list → select with labels', () => {
    const s = byKey('mode = 1; // [0:Off, 1:On]').get('mode')!;
    expect(s.type).toBe('select');
    expect(s.default).toBe('1');
    expect(s.options).toEqual([
      { value: '0', label: 'Off' },
      { value: '1', label: 'On' },
    ]);
  });

  it('preceding // comment becomes the help text', () => {
    const s = byKey('// Outer wall thickness\nwall = 2; // [1:5]').get('wall')!;
    expect(s.help).toBe('Outer wall thickness');
  });
});

describe('parseScadParams — what is excluded', () => {
  it('ignores variables inside a module (brace depth > 0)', () => {
    const src = 'w = 10; // [1:20]\nmodule foo() {\n  inner = 5; // [1:9]\n}\n';
    const keys = parseScadParams(src).map(s => s.key);
    expect(keys).toEqual(['w']);
  });

  it('suppresses a /* [Hidden] */ group', () => {
    const src = 'shown = 1; // [0:2]\n/* [Hidden] */\nsecret = 9; // [0:10]\n';
    const keys = parseScadParams(src).map(s => s.key);
    expect(keys).toEqual(['shown']);
  });

  it('a later non-Hidden group re-enables parsing', () => {
    const src = '/* [Hidden] */\na = 1;\n/* [Main] */\nb = 2; // [0:5]\n';
    expect(parseScadParams(src).map(s => s.key)).toEqual(['b']);
  });

  it('skips vector and expression defaults', () => {
    const src = 'v = [1,2,3];\ncalc = a * 2;\nok = 4; // [0:8]\n';
    expect(parseScadParams(src).map(s => s.key)).toEqual(['ok']);
  });

  it('ignores special $vars and assignments in block comments', () => {
    const src = '$fn = 64;\n/*\nnope = 5; // [0:9]\n*/\nreal = 7; // [0:9]\n';
    expect(parseScadParams(src).map(s => s.key)).toEqual(['real']);
  });

  it('does not mistake braces inside strings for a block', () => {
    const src = 'label = "a{b}c";\nsize = 3; // [1:9]\n';
    expect(parseScadParams(src).map(s => s.key)).toEqual(['label', 'size']);
  });
});

describe('buildScadDefines — override flags', () => {
  const SRC = [
    'width = 30; // [10:100]',
    'solid = true;',
    'name = "PART";',
    'mode = 1; // [0:Off, 1:On]',
  ].join('\n');

  it('emits -D flags with correct quoting per literal kind', () => {
    const args = buildScadDefines(SRC, { width: 47, solid: false, name: 'BOX', mode: '0' });
    expect(args).toEqual([
      '-D', 'width=47',
      '-D', 'solid=false',
      '-D', 'name="BOX"',
      '-D', 'mode=0', // numeric dropdown → unquoted, despite being a select
    ]);
  });

  it('skips overrides equal to the default and unknown keys', () => {
    const args = buildScadDefines(SRC, { width: 30, bogus: 5 });
    expect(args).toEqual([]);
  });

  it('clamps out-of-range numeric overrides before emitting', () => {
    expect(buildScadDefines(SRC, { width: 999 })).toEqual(['-D', 'width=100']);
  });

  it('escapes quotes/backslashes in string overrides', () => {
    expect(buildScadDefines(SRC, { name: 'a"b\\c' })).toEqual(['-D', 'name="a\\"b\\\\c"']);
  });

  it('returns nothing when there are no overrides', () => {
    expect(buildScadDefines(SRC, undefined)).toEqual([]);
    expect(buildScadDefines(SRC, {})).toEqual([]);
  });
});

describe('parseScadParams — robustness on malformed input', () => {
  // The parser runs on arbitrary user source on every SCAD run, so it must
  // degrade (skip the param) rather than throw on anything weird.
  const WEIRD = [
    '', '\n\n', '////', '/*', '*/', '/* [Hidden',
    'x = ;', '= 5;', 'x = "unterminated;',
    `${'a'.repeat(50_000)} = 5; // [0:9]`,
    `x = 5; // [${'a'.repeat(50_000)}]`,
    'x = 0x1F;', 'x = 1_000;', 'x = .5; // [0:1]', 'x = 5.; // [0:9]', 'x = +5; // [0:9]',
  ];

  it('never throws, for parse or define-building', () => {
    for (const c of WEIRD) {
      expect(() => parseScadParams(c)).not.toThrow();
      expect(() => buildScadDefines(c, { x: 3 })).not.toThrow();
    }
  });

  it('handles unusual but valid numeric literals; ignores non-OpenSCAD ones', () => {
    expect(byKey('x = .5; // [0:1]').get('x')).toMatchObject({ type: 'number', default: 0.5 });
    expect(byKey('x = +5; // [0:9]').get('x')).toMatchObject({ type: 'int', default: 5 });
    // OpenSCAD has no hex or underscore numeric literals — skip rather than misparse.
    expect(parseScadParams('x = 0x1F;')).toEqual([]);
    expect(parseScadParams('x = 1_000;')).toEqual([]);
  });
});
