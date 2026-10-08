// STL parse/write + mesh weld/split coverage.

import { describe, it, expect } from 'vitest';
// @ts-expect-error — .mjs script consumed directly from the vitest node env
import { parseStl, writeBinaryStl, meshBBox } from '../../scripts/inverse-cad/stl.mjs';
// @ts-expect-error — .mjs script
import { weldVertices, connectedComponents } from '../../scripts/inverse-cad/mesh.mjs';

// A simple axis-aligned cube from (0,0,0) to (1,1,1) as 12 triangles.
function cube(offset: [number, number, number] = [0, 0, 0]): Float32Array {
  const [ox, oy, oz] = offset;
  const v = (i: number, j: number, k: number) => [ox + i, oy + j, oz + k] as const;
  const faces: readonly (readonly (readonly [number, number, number])[])[] = [
    [v(0,0,0), v(1,0,0), v(1,1,0), v(0,1,0)], // -Z
    [v(0,0,1), v(0,1,1), v(1,1,1), v(1,0,1)], // +Z
    [v(0,0,0), v(0,1,0), v(0,1,1), v(0,0,1)], // -X
    [v(1,0,0), v(1,0,1), v(1,1,1), v(1,1,0)], // +X
    [v(0,0,0), v(0,0,1), v(1,0,1), v(1,0,0)], // -Y
    [v(0,1,0), v(1,1,0), v(1,1,1), v(0,1,1)], // +Y
  ];
  const tris: number[] = [];
  for (const quad of faces) {
    const [a, b, c, d] = quad;
    tris.push(...a, ...b, ...c);
    tris.push(...a, ...c, ...d);
  }
  return Float32Array.from(tris);
}

describe('inverse-cad/stl.parseStl', () => {
  it('round-trips a binary cube through write→parse with identical vertices', () => {
    const mesh = { triangles: cube() };
    const bin = writeBinaryStl(mesh);
    const parsed = parseStl(bin);
    expect(parsed.triangles.length).toBe(mesh.triangles.length);
    for (let i = 0; i < mesh.triangles.length; i++) {
      expect(parsed.triangles[i]).toBeCloseTo(mesh.triangles[i], 5);
    }
  });

  it('parses ASCII STL that starts with `solid`', () => {
    const ascii = [
      'solid cube',
      '  facet normal 0 0 -1',
      '    outer loop',
      '      vertex 0 0 0',
      '      vertex 1 0 0',
      '      vertex 1 1 0',
      '    endloop',
      '  endfacet',
      'endsolid cube',
    ].join('\n');
    const buf = new TextEncoder().encode(ascii);
    const parsed = parseStl(buf);
    expect(parsed.triangles.length).toBe(9);
    expect(Array.from(parsed.triangles)).toEqual([0, 0, 0, 1, 0, 0, 1, 1, 0]);
  });

  it('meshBBox reports size, center, extent', () => {
    const mesh = { triangles: cube([2, -1, 5]) };
    const bb = meshBBox(mesh);
    expect(bb.min).toEqual([2, -1, 5]);
    expect(bb.max).toEqual([3, 0, 6]);
    expect(bb.size).toEqual([1, 1, 1]);
    expect(bb.center).toEqual([2.5, -0.5, 5.5]);
  });
});

describe('inverse-cad/mesh.weldVertices', () => {
  it('welds 36 duplicated cube corners into 8 unique vertices', () => {
    const welded = weldVertices({ triangles: cube() });
    expect(welded.vertices.length / 3).toBe(8);
    expect(welded.triangles.length).toBe(12 * 3);
  });
});

describe('inverse-cad/mesh.connectedComponents', () => {
  it('returns 1 component for a single cube', () => {
    const comps = connectedComponents({ triangles: cube() });
    expect(comps.length).toBe(1);
    expect(comps[0].triangles.length).toBe(12 * 9);
  });

  it('returns 2 components for two separated cubes', () => {
    const combined = Float32Array.from([...cube(), ...cube([10, 0, 0])]);
    const comps = connectedComponents({ triangles: combined });
    expect(comps.length).toBe(2);
    // sorted by triangle count desc; both have 12 tris, so either order fine
    expect(comps[0].triangles.length).toBe(12 * 9);
    expect(comps[1].triangles.length).toBe(12 * 9);
  });

  it('returns 3 components for three cubes, largest first', () => {
    // second cube is a "bigger" cube: 2x scale, 8x volume, but same tri count
    // so use a different-tri-count strategy: strip one triangle off the third
    const c3 = cube([0, 0, 20]);
    const trimmed = c3.slice(0, c3.length - 9);
    const combined = Float32Array.from([...cube(), ...cube([10, 0, 0]), ...trimmed]);
    const comps = connectedComponents({ triangles: combined });
    expect(comps.length).toBe(3);
    expect(comps[0].triangles.length / 9).toBeGreaterThanOrEqual(comps[2].triangles.length / 9);
    expect(comps[2].triangles.length / 9).toBe(11);
  });

  it('merges two cubes that share a face after welding', () => {
    // second cube touches first at x=1..2
    const combined = Float32Array.from([...cube(), ...cube([1, 0, 0])]);
    const comps = connectedComponents({ triangles: combined });
    expect(comps.length).toBe(1);
    expect(comps[0].triangles.length).toBe(24 * 9);
  });
});
