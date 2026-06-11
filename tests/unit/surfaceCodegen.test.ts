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
      '',
    ].join('\n'));
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
});
