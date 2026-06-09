import { describe, it, expect } from 'vitest';
import { VoxelGrid, colorComponents } from '../../src/geometry/voxel/grid';
import { createSdfNamespace } from '../../src/geometry/sdf';

// A voxel session's `api.sdf` never lowers to Manifold (v.sdf samples the field
// directly), so a stub engine binding is fine here — we never call .build().
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sdf = createSdfNamespace({} as any, (s) => s);

describe('VoxelGrid.sdf — SDF → voxel bridge', () => {
  it('rasterizes a sphere onto the integer lattice (inside ≤ surface)', () => {
    const v = new VoxelGrid().sdf(sdf.sphere(5));
    expect(v.size).toBeGreaterThan(0);
    expect(v.has(0, 0, 0)).toBe(true);   // deep inside
    expect(v.has(5, 0, 0)).toBe(true);   // exactly on the surface (f = 0 ≤ 0)
    expect(v.has(6, 0, 0)).toBe(false);  // outside
  });

  it('fills a solid box and respects the default color', () => {
    const v = new VoxelGrid().sdf(sdf.box([4, 4, 4]));
    // half-extent 2 → coords -2..2 inclusive on each axis = 5³ cells
    expect(v.size).toBe(125);
    expect(v.has(2, 2, 2)).toBe(true);
    expect(v.has(3, 0, 0)).toBe(false);
    expect(colorComponents(v.get(0, 0, 0)!)).toEqual([0xcc, 0xcc, 0xcc]);
  });

  it('honors a custom color', () => {
    const v = new VoxelGrid().sdf(sdf.sphere(3), { color: '#ff8800' });
    expect(v.get(0, 0, 0)).toBe(0xff8800);
  });

  it('scales the lattice with res (world = i·res)', () => {
    const v = new VoxelGrid().sdf(sdf.sphere(10), { res: 2 });
    // radius 10 / res 2 → voxel surface at coord 5 (world 10)
    expect(v.has(5, 0, 0)).toBe(true);
    expect(v.has(6, 0, 0)).toBe(false);
  });

  it('dilates with a positive level and erodes with a negative one', () => {
    const base = new VoxelGrid().sdf(sdf.sphere(4)).size;
    const grown = new VoxelGrid().sdf(sdf.sphere(4), { level: 1 }).size;
    const shrunk = new VoxelGrid().sdf(sdf.sphere(4), { level: -1 }).size;
    expect(grown).toBeGreaterThan(base);
    expect(shrunk).toBeLessThan(base);
  });

  it('colors per-label region by the deepest-inside rule', () => {
    const left = sdf.sphere(4).translate(-4, 0, 0).label('a');
    const right = sdf.sphere(4).translate(4, 0, 0).label('b');
    const v = new VoxelGrid().sdf(sdf.union(left, right), {
      colors: { a: '#ff0000', b: '#0000ff' },
    });
    expect(v.get(-4, 0, 0)).toBe(0xff0000); // center of region a
    expect(v.get(4, 0, 0)).toBe(0x0000ff);  // center of region b
  });

  it('falls back to the default color for unmapped / unlabelled regions', () => {
    const v = new VoxelGrid().sdf(sdf.sphere(3), { colors: { other: '#00ff00' }, color: '#123456' });
    expect(v.get(0, 0, 0)).toBe(0x123456);
  });

  it('rejects an infinite SDF without explicit bounds', () => {
    expect(() => new VoxelGrid().sdf(sdf.gyroid(8, 1.5))).toThrow(/infinite/i);
  });

  it('rasterizes an infinite TPMS when given bounds', () => {
    const v = new VoxelGrid().sdf(sdf.gyroid(8, 1.5), {
      bounds: { min: [-8, -8, -8], max: [8, 8, 8] },
    });
    expect(v.size).toBeGreaterThan(0);
  });

  it('refuses a sample budget blowout instead of freezing', () => {
    expect(() => new VoxelGrid().sdf(sdf.sphere(3), {
      bounds: { min: [-100, -100, -100], max: [100, 100, 100] },
      res: 0.01,
    })).toThrow(/budget/i);
  });

  it('rejects unknown option keys and non-SDF nodes', () => {
    // @ts-expect-error — unknown key
    expect(() => new VoxelGrid().sdf(sdf.sphere(2), { resolution: 1 })).toThrow();
    // @ts-expect-error — not an SDF node
    expect(() => new VoxelGrid().sdf({ evaluate: () => -1 })).toThrow(/api\.sdf/);
  });

  it('unions additively into existing voxels and chains', () => {
    const v = new VoxelGrid().fillBox([20, 20, 0], [22, 22, 2], '#888').sdf(sdf.sphere(3));
    expect(v.has(21, 21, 1)).toBe(true); // the fillBox cube survives
    expect(v.has(0, 0, 0)).toBe(true);   // the sphere was added
  });
});

describe('VoxelGrid.keepLargest', () => {
  it('removes smaller face-connected islands, keeping the biggest', () => {
    const v = new VoxelGrid();
    v.fillBox([0, 0, 0], [4, 4, 4], '#fff');     // 125-voxel blob
    v.fillBox([20, 0, 0], [21, 0, 0], '#f00');   // 2-voxel speck, disjoint
    v.set(-10, -10, -10, '#0f0');                // 1-voxel speck
    expect(v.size).toBe(128);
    v.keepLargest();
    expect(v.size).toBe(125);
    expect(v.has(2, 2, 2)).toBe(true);
    expect(v.has(20, 0, 0)).toBe(false);
    expect(v.has(-10, -10, -10)).toBe(false);
  });

  it('keepLargest(n) keeps the n biggest components', () => {
    const v = new VoxelGrid();
    v.fillBox([0, 0, 0], [3, 3, 3], '#fff');     // 64
    v.fillBox([20, 0, 0], [22, 0, 0], '#f00');   // 3
    v.set(-10, -10, -10, '#0f0');                // 1
    v.keepLargest(2);
    expect(v.has(1, 1, 1)).toBe(true);
    expect(v.has(21, 0, 0)).toBe(true);          // 2nd-largest kept
    expect(v.has(-10, -10, -10)).toBe(false);    // smallest dropped
  });

  it('leaves a single connected component untouched and treats diagonal touch as separate', () => {
    const solid = new VoxelGrid().fillBox([0, 0, 0], [3, 3, 3], '#fff');
    const before = solid.size;
    solid.keepLargest();
    expect(solid.size).toBe(before);
    // Two voxels touching only at a corner are NOT face-connected → 2 components.
    const diag = new VoxelGrid().set(0, 0, 0, '#fff').set(1, 1, 1, '#fff');
    diag.keepLargest();
    expect(diag.size).toBe(1);
  });

  it('welds a fragmented SDF gyroid lattice into one printable component', () => {
    const v = new VoxelGrid().sdf(sdf.gyroid(7, 0.4).intersect(sdf.sphere(12)), {
      bounds: { min: [-12, -12, -12], max: [12, 12, 12] },
    });
    expect(v.size).toBeGreaterThan(0);
    v.keepLargest();           // should not throw and should leave a non-empty grid
    expect(v.size).toBeGreaterThan(0);
  });
});
