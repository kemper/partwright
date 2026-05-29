import { describe, it, expect } from 'vitest';
import { encodeVox } from '../../src/export/vox';
import { parseVox } from '../../src/import/parsers/vox';
import { VoxelGrid } from '../../src/geometry/voxel/grid';

// The exporter is the inverse of the importer, so the strongest test is a real
// round-trip: encode a grid to .vox bytes, parse them back with the production
// parser, and compare. parseVox re-centers the model (cx/cy) and sits it on
// z=0, so absolute coordinates shift — we compare *normalized* shape (occupancy
// + color relative to each grid's min corner), which is what must survive.

/** Map of "dx,dy,dz" (relative to the grid's min corner) → color. */
function normalize(grid: VoxelGrid): Map<string, number> {
  const b = grid.bounds();
  const out = new Map<string, number>();
  if (!b) return out;
  grid.forEach((x, y, z, c) => {
    out.set(`${x - b.min[0]},${y - b.min[1]},${z - b.min[2]}`, c);
  });
  return out;
}

describe('encodeVox', () => {
  it('round-trips occupancy + colors through parseVox', () => {
    const grid = new VoxelGrid();
    grid.set(0, 0, 0, '#ff0000');
    grid.set(1, 0, 0, '#00ff00');
    grid.set(0, 1, 0, '#0000ff');
    grid.set(0, 0, 3, '#abcdef'); // a gap in z to exercise the bounding box
    grid.set(-2, -2, 0, '#123456'); // negative coords → exercises min-corner offset

    const bytes = encodeVox(grid);
    // Well-formed MagicaVoxel file: "VOX " magic + version.
    expect(String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3])).toBe('VOX ');

    const back = parseVox(bytes);
    expect(back.size).toBe(grid.size);
    expect(normalize(back)).toEqual(normalize(grid));
  });

  it('preserves the bounding-box dimensions (SIZE chunk)', () => {
    const grid = new VoxelGrid();
    grid.fillBox([0, 0, 0], [9, 4, 2], '#888888'); // 10 × 5 × 3
    const back = parseVox(encodeVox(grid));
    const b = back.bounds()!;
    expect([b.max[0] - b.min[0] + 1, b.max[1] - b.min[1] + 1, b.max[2] - b.min[2] + 1])
      .toEqual([10, 5, 3]);
  });

  it('keeps a single voxel and its exact color', () => {
    const grid = new VoxelGrid();
    grid.set(5, -3, 7, '#3399ff');
    const back = parseVox(encodeVox(grid));
    expect(back.size).toBe(1);
    expect([...normalize(back).values()]).toEqual([0x3399ff]);
  });

  it('reduces >255 distinct colors without dropping any voxel', () => {
    const grid = new VoxelGrid();
    // 300 voxels, each a distinct color, packed into a 16-wide slab.
    for (let i = 0; i < 300; i++) {
      grid.set(i % 16, Math.floor(i / 16), 0, i * 1000 + 1); // distinct 0xRRGGBB
    }
    expect(grid.size).toBe(300);

    const back = parseVox(encodeVox(grid));
    // Every voxel survives — palette reduction snaps colors, never drops cells.
    expect(back.size).toBe(300);
    // The palette is capped at 255 entries, so the result has ≤255 colors.
    const colors = new Set<number>();
    back.forEach((_x, _y, _z, c) => colors.add(c));
    expect(colors.size).toBeLessThanOrEqual(255);
  });

  it('exports exactly 255 distinct colors losslessly', () => {
    const grid = new VoxelGrid();
    for (let i = 0; i < 255; i++) {
      grid.set(i % 16, Math.floor(i / 16), 0, i * 257 + 1);
    }
    const back = parseVox(encodeVox(grid));
    expect(normalize(back)).toEqual(normalize(grid));
  });

  it('throws a clear error on an empty grid', () => {
    expect(() => encodeVox(new VoxelGrid())).toThrow(/empty/i);
  });

  it('throws when a model exceeds 256 voxels on an axis', () => {
    const grid = new VoxelGrid();
    grid.set(0, 0, 0, '#fff');
    grid.set(256, 0, 0, '#fff'); // span of 257 along x
    expect(() => encodeVox(grid)).toThrow(/256 per axis/);
  });

  it('accepts a model exactly 256 voxels wide', () => {
    const grid = new VoxelGrid();
    grid.set(0, 0, 0, '#fff');
    grid.set(255, 0, 0, '#fff'); // span of 256 — the limit
    expect(() => encodeVox(grid)).not.toThrow();
    expect(parseVox(encodeVox(grid)).size).toBe(2);
  });
});
