import { describe, it, expect } from 'vitest';
import { surfaceOptsLiteral, appendSurfaceCall } from '../../src/surface/surfaceCodegen';

describe('surfaceOptsLiteral', () => {
  it('keeps only keys valid for the op and serializes scalars', () => {
    const lit = surfaceOptsLiteral('knit', {
      stitchWidth: 1.23456, amplitude: 0.5, algorithm: 'bfs', subdivide: true,
      selectedTriangles: new Set([1, 2]), // not a knit field → dropped
      bogus: 99,                          // not a knit field → dropped
    });
    expect(lit).toContain('stitchWidth: 1.2346'); // rounded to 4 dp
    expect(lit).toContain('amplitude: 0.5');
    expect(lit).toContain('algorithm: "bfs"');
    expect(lit).toContain('subdivide: true');
    expect(lit).not.toContain('selectedTriangles');
    expect(lit).not.toContain('bogus');
  });

  it('drops non-finite numbers and returns empty literal when nothing valid', () => {
    expect(surfaceOptsLiteral('smooth', { iterations: NaN })).toBe('');
    expect(surfaceOptsLiteral('fuzzy', {})).toBe('');
  });
});

describe('appendSurfaceCall', () => {
  it('IIFE-wraps plain code and appends the call before the return', () => {
    const out = appendSurfaceCall('const { Manifold } = api;\nreturn Manifold.sphere(10);', 'knit', { stitchWidth: 1.4 });
    expect(out).toContain('const __pwModel = (() => {');
    expect(out).toContain('return Manifold.sphere(10);');
    expect(out).toContain('api.surface.knit({ stitchWidth: 1.4 });');
    expect(out.trim().endsWith('return __pwModel;')).toBe(true);
    // The texture call sits before the wrapper return.
    expect(out.indexOf('api.surface.knit')).toBeLessThan(out.lastIndexOf('return __pwModel;'));
  });

  it('composes: a second apply inserts before the existing wrapper return, no nesting', () => {
    const once = appendSurfaceCall('return api.Manifold.cube([1,1,1]);', 'fuzzy', { amplitude: 0.2 });
    const twice = appendSurfaceCall(once, 'smooth', { iterations: 3 });
    // Only one IIFE wrapper.
    expect(twice.match(/const __pwModel = \(\(\) => \{/g)?.length).toBe(1);
    // Both calls present, fuzzy before smooth, both before the single return.
    expect(twice.indexOf('api.surface.fuzzy')).toBeLessThan(twice.indexOf('api.surface.smooth'));
    expect(twice.indexOf('api.surface.smooth')).toBeLessThan(twice.lastIndexOf('return __pwModel;'));
    expect(twice.match(/return __pwModel;/g)?.length).toBe(1);
  });

  it('emits an empty-arg call when no options are supplied', () => {
    const out = appendSurfaceCall('return api.Manifold.sphere(5);', 'fuzzy', {});
    expect(out).toContain('api.surface.fuzzy();');
  });
});
