import { describe, it, expect } from 'vitest';
import { formatSurfaceParams, upsertSurfaceCall } from '../../src/surface/surfaceCodegen';

describe('formatSurfaceParams', () => {
  it('renders a flat object literal with quoted strings and clean numbers', () => {
    expect(formatSurfaceParams({ amplitude: 0.05500000000000001, algorithm: 'lscm', raised: false }))
      .toBe("{ amplitude: 0.055, algorithm: 'lscm', raised: false }");
  });

  it('renders {} for no params', () => {
    expect(formatSurfaceParams({})).toBe('{}');
  });

  it('escapes quotes in string values', () => {
    expect(formatSurfaceParams({ algorithm: "a'b" })).toBe("{ algorithm: 'a\\'b' }");
  });
});

describe('upsertSurfaceCall', () => {
  const base = [
    'const { Manifold } = api;',
    'const body = Manifold.sphere(10, 48);',
    'return body;',
  ].join('\n');

  it('inserts a new call just before the final return', () => {
    const r = upsertSurfaceCall(base, 'knit', { stitchWidth: 1.2 });
    expect(r).not.toBeNull();
    expect(r!.replaced).toBe(false);
    expect(r!.code).toBe([
      'const { Manifold } = api;',
      'const body = Manifold.sphere(10, 48);',
      'api.surface.knit({ stitchWidth: 1.2 });',
      'return body;',
    ].join('\n'));
  });

  it('keeps the return line\'s indentation on the inserted call', () => {
    const code = 'const { Manifold } = api;\n  return Manifold.sphere(5);\n';
    const r = upsertSurfaceCall(code, 'smooth', {});
    expect(r!.code).toContain('api.surface.smooth({});\n  return Manifold.sphere(5);');
  });

  it('pins the insert to the LAST return when an inner function returns earlier', () => {
    const code = [
      'const f = () => { return 2; };',
      'const { Manifold } = api;',
      'return Manifold.cube([f(), 5, 5]);',
    ].join('\n');
    const r = upsertSurfaceCall(code, 'fuzzy', {});
    expect(r!.code).toContain('api.surface.fuzzy({});\nreturn Manifold.cube([f(), 5, 5]);');
  });

  it('updates an existing call for the same op in place (no duplicate)', () => {
    const withCall = upsertSurfaceCall(base, 'knit', { stitchWidth: 1.2 })!.code;
    const r = upsertSurfaceCall(withCall, 'knit', { stitchWidth: 2, amplitude: 0.5 });
    expect(r!.replaced).toBe(true);
    expect(r!.code.match(/api\.surface\.knit\(/g)?.length).toBe(1);
    expect(r!.code).toContain('api.surface.knit({ stitchWidth: 2, amplitude: 0.5 });');
  });

  it('updates the generic apply(\'<id>\', …) form, normalizing to the direct form', () => {
    const code = [
      'const { Manifold } = api;',
      "api.surface.apply('cable', { cableWidth: 1 });",
      'return Manifold.sphere(10);',
    ].join('\n');
    const r = upsertSurfaceCall(code, 'cable', { cableWidth: 3 });
    expect(r!.replaced).toBe(true);
    expect(r!.code).toContain('api.surface.cable({ cableWidth: 3 });');
    expect(r!.code).not.toContain('api.surface.apply');
  });

  it('leaves other ops\' calls untouched, so chains build up', () => {
    const one = upsertSurfaceCall(base, 'knit', { stitchWidth: 1 })!.code;
    const two = upsertSurfaceCall(one, 'fuzzy', { amplitude: 0.3 })!;
    expect(two.replaced).toBe(false);
    expect(two.code).toContain('api.surface.knit({ stitchWidth: 1 });');
    expect(two.code).toContain('api.surface.fuzzy({ amplitude: 0.3 });');
    // fuzzy lands after knit (insert point is just before the return)
    expect(two.code.indexOf('knit')).toBeLessThan(two.code.indexOf('fuzzy'));
  });

  it('updates the LAST occurrence when the same op appears twice', () => {
    const code = [
      'api.surface.smooth({ iterations: 1 });',
      'api.surface.smooth({ iterations: 2 });',
      'return api.Manifold.cube([5,5,5]);',
    ].join('\n');
    const r = upsertSurfaceCall(code, 'smooth', { iterations: 9 })!;
    expect(r.code).toContain('api.surface.smooth({ iterations: 1 });');
    expect(r.code).toContain('api.surface.smooth({ iterations: 9 });');
    expect(r.code).not.toContain('iterations: 2');
  });

  it('returns null when the code has no return to hook onto', () => {
    expect(upsertSurfaceCall('const x = 1;', 'knit', {})).toBeNull();
  });

  // --- lexical awareness: strings and comments are never edited ---

  it('ignores a call mentioned inside a string and does not corrupt it', () => {
    const code = [
      'const note = `call api.surface.knit({x:1}) to texture`;',
      "const s = 'api.surface.knit({ amplitude: 1 });';",
      'return api.Manifold.cube([5,5,5]);',
    ].join('\n');
    const r = upsertSurfaceCall(code, 'knit', { amplitude: 2 })!;
    expect(r.replaced).toBe(false); // the string mentions are NOT existing calls
    // Both literals survive byte-for-byte; the real call lands before the return.
    expect(r.code).toContain('`call api.surface.knit({x:1}) to texture`');
    expect(r.code).toContain("'api.surface.knit({ amplitude: 1 });'");
    expect(r.code).toContain('api.surface.knit({ amplitude: 2 });\nreturn');
  });

  it('ignores a commented-out call and inserts a live one', () => {
    const code = [
      '// old: api.surface.knit({ amplitude: 1 });',
      '/* also old: api.surface.knit({}); */',
      'return api.Manifold.cube([5,5,5]);',
    ].join('\n');
    const r = upsertSurfaceCall(code, 'knit', { amplitude: 2 })!;
    expect(r.replaced).toBe(false);
    expect(r.code).toContain('// old: api.surface.knit({ amplitude: 1 });');
    expect(r.code).toContain('/* also old: api.surface.knit({}); */');
    expect(r.code).toContain('api.surface.knit({ amplitude: 2 });\nreturn');
  });

  it('recognizes an existing call whose string param contains a brace', () => {
    const code = [
      "api.surface.knit({ algorithm: '}' });",
      'return api.Manifold.cube([5,5,5]);',
    ].join('\n');
    const r = upsertSurfaceCall(code, 'knit', { algorithm: 'lscm' })!;
    expect(r.replaced).toBe(true);
    expect((r.code.match(/api\.surface\.knit\(/g) ?? []).length).toBe(1);
  });

  it("a quote inside a comment doesn't derail the scan", () => {
    const code = [
      "// don't texture twice",
      'api.surface.fuzzy({ amplitude: 1 });',
      'return api.Manifold.sphere(5);',
    ].join('\n');
    const r = upsertSurfaceCall(code, 'fuzzy', { amplitude: 3 })!;
    expect(r.replaced).toBe(true);
    expect(r.code).toContain('api.surface.fuzzy({ amplitude: 3 });');
  });

  // --- top-level return selection ---

  it('inserts before the top-level return even with a helper declared after it', () => {
    const code = [
      'return build();',
      'function build() { return api.Manifold.cube([5,5,5]); }',
    ].join('\n');
    const r = upsertSurfaceCall(code, 'fuzzy', {})!;
    expect(r.code).toContain('api.surface.fuzzy({});\nreturn build();');
    expect(r.code).toContain('function build() { return api.Manifold.cube([5,5,5]); }');
  });

  it('handles a return with no trailing semicolon', () => {
    const code = 'const { Manifold } = api;\nreturn Manifold.sphere(5)';
    const r = upsertSurfaceCall(code, 'smooth', {});
    expect(r).not.toBeNull();
    expect(r!.code).toContain('api.surface.smooth({});\nreturn Manifold.sphere(5)');
  });

  it('falls back to a nested return when no top-level return exists', () => {
    const code = [
      'if (api.params({ big: { type: "bool", default: false } }).big) {',
      '  return api.Manifold.cube([9,9,9]);',
      '} else {',
      '  return api.Manifold.cube([5,5,5]);',
      '}',
    ].join('\n');
    const r = upsertSurfaceCall(code, 'fuzzy', {})!;
    // Lands before the LAST return (inside the else block), preserving indentation.
    expect(r.code).toContain('  api.surface.fuzzy({});\n  return api.Manifold.cube([5,5,5]);');
  });
});
