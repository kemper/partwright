import { describe, it, expect } from 'vitest';
import { VoxelGrid } from '../../src/geometry/voxel/grid';
import { gridToMeshWithProvenance } from '../../src/geometry/voxel/mesher';
import { bucketRecolor, clearBox, fillBoxRecolor, addTarget, addBlock, addBlockCells, extrudeBox, brushApply, levelRecolor, inBrush } from '../../src/geometry/voxel/edits';

// Pure-logic tests for the Voxel Studio multi-voxel edit operations + the
// provenance the "add" tool relies on. The DOM/raycast glue (voxelPaint.ts)
// is covered by the e2e suite via the partwright API.

describe('VoxelGrid.clone', () => {
  it('deep-copies cells + surfacing without aliasing', () => {
    const g = new VoxelGrid();
    g.fillBox([0, 0, 0], [2, 2, 2], '#abcdef');
    g.smooth({ algorithm: 'taubin', iterations: 3, detail: 2 });
    const c = g.clone();
    expect(c.size).toBe(g.size);
    expect(c.surfacing()).toEqual({ mode: 'smooth', algorithm: 'taubin', iterations: 3, detail: 2, flatBottom: undefined, baseLayers: undefined, lockBox: undefined });
    // Mutating the clone must not touch the original.
    c.remove(0, 0, 0);
    c.set(9, 9, 9, '#fff');
    expect(g.has(0, 0, 0)).toBe(true);
    expect(g.has(9, 9, 9)).toBe(false);
  });
});

describe('bucketRecolor', () => {
  it('recolors only the connected same-color region', () => {
    const g = new VoxelGrid();
    // Two separate red bars; recolor should only touch the one we click.
    g.fillBox([0, 0, 0], [3, 0, 0], '#ff0000');
    g.fillBox([0, 5, 0], [3, 5, 0], '#ff0000');
    const changed = bucketRecolor(g, [0, 0, 0], '#00ff00');
    expect(changed).toBe(4);
    expect(g.get(0, 0, 0)).toBe(0x00ff00);
    expect(g.get(3, 0, 0)).toBe(0x00ff00);
    // The disconnected bar is untouched.
    expect(g.get(0, 5, 0)).toBe(0xff0000);
  });

  it('does not bleed across a color boundary', () => {
    const g = new VoxelGrid();
    g.set(0, 0, 0, '#ff0000');
    g.set(1, 0, 0, '#0000ff'); // different color, face-adjacent
    expect(bucketRecolor(g, [0, 0, 0], '#00ff00')).toBe(1);
    expect(g.get(1, 0, 0)).toBe(0x0000ff);
  });

  it('is a no-op on an empty cell or same color', () => {
    const g = new VoxelGrid();
    g.set(0, 0, 0, '#ff0000');
    expect(bucketRecolor(g, [5, 5, 5], '#00ff00')).toBe(0); // empty start
    expect(bucketRecolor(g, [0, 0, 0], '#ff0000')).toBe(0); // already that color
  });
});

describe('fillBoxRecolor / clearBox', () => {
  it('fillBoxRecolor counts only cells it actually changes', () => {
    const g = new VoxelGrid();
    g.fillBox([0, 0, 0], [1, 1, 1], '#111111'); // 8 cells
    // Re-fill the same box with the same color → 0 changes.
    expect(fillBoxRecolor(g, [0, 0, 0], [1, 1, 1], '#111111')).toBe(0);
    // A bigger box: 27 cells, 8 already present (recolored) + 19 new = 27 changed.
    expect(fillBoxRecolor(g, [0, 0, 0], [2, 2, 2], '#222222')).toBe(27);
    expect(g.size).toBe(27);
  });

  it('clearBox removes everything inside the inclusive region', () => {
    const g = new VoxelGrid();
    g.fillBox([0, 0, 0], [4, 4, 4], '#fff'); // 125 cells
    const removed = clearBox(g, [1, 1, 1], [3, 3, 3]); // 27-cell core
    expect(removed).toBe(27);
    expect(g.size).toBe(98);
    expect(g.has(2, 2, 2)).toBe(false);
    expect(g.has(0, 0, 0)).toBe(true);
  });
});

describe('addTarget + provenance triNormal', () => {
  it('offsets the voxel by the outward face normal', () => {
    expect(addTarget([0, 0, 0], [0, 0, 1])).toEqual([0, 0, 1]);
    expect(addTarget([5, 5, 5], [-1, 0, 0])).toEqual([4, 5, 5]);
  });

  it('returns null when the target leaves the coordinate range', () => {
    expect(addTarget([1023, 0, 0], [1, 0, 0])).toBeNull();
    expect(addTarget([-1024, 0, 0], [-1, 0, 0])).toBeNull();
  });

  it('every triangle normal points to an empty neighbor (the add side)', () => {
    const g = new VoxelGrid();
    g.fillBox([0, 0, 0], [1, 1, 1], '#fff');
    const { mesh, triVoxel, triNormal } = gridToMeshWithProvenance(g);
    expect(triNormal.length).toBe(mesh.numTri * 3);
    for (let t = 0; t < mesh.numTri; t++) {
      const i = t * 3;
      const target = addTarget(
        [triVoxel[i], triVoxel[i + 1], triVoxel[i + 2]],
        [triNormal[i], triNormal[i + 1], triNormal[i + 2]],
      );
      // The cube is 2×2×2 from (0,0,0)..(1,1,1); exposed faces all point
      // outward into empty space, so the add target is never an occupied cell.
      expect(target).not.toBeNull();
      expect(g.has(target![0], target![1], target![2])).toBe(false);
    }
  });
});

describe('addBlockCells (anchored block add)', () => {
  const key = (c: [number, number, number]) => c.join(',');
  const has = (cells: [number, number, number][], c: [number, number, number]) =>
    cells.some((x) => x[0] === c[0] && x[1] === c[1] && x[2] === c[2]);

  it('default size + depth reduces to a single voxel out from the face (addTarget)', () => {
    const cells = addBlockCells([0, 0, 0], [0, 0, 1], [1, 1, 1], 0);
    expect(cells).toEqual([[0, 0, 1]]);
    // Matches the legacy single-voxel add target.
    expect(cells[0]).toEqual(addTarget([0, 0, 0], [0, 0, 1]));
  });

  it('front-attaches a thick block: never pokes out the far side of a thin tile', () => {
    // Click the +Z face of a 1-thick tile voxel at z=0 with a 1×1×3 block.
    const cells = addBlockCells([0, 0, 0], [0, 0, 1], [1, 1, 3], 0);
    // All three layers sit ABOVE the surface (z = 1,2,3) — none at or below 0.
    expect(cells.map((c) => c[2]).sort((a, b) => a - b)).toEqual([1, 2, 3]);
    expect(cells.every((c) => c[2] >= 1)).toBe(true);
  });

  it('centers the block across the two tangent axes', () => {
    // 3×3 across X/Y on a +Z face at the origin → a 3×3 plate one above.
    const cells = addBlockCells([0, 0, 0], [0, 0, 1], [3, 3, 1], 0);
    expect(cells).toHaveLength(9);
    expect(has(cells, [-1, -1, 1])).toBe(true);
    expect(has(cells, [1, 1, 1])).toBe(true);
    expect(cells.every((c) => c[2] === 1)).toBe(true);
  });

  it('depth sinks the block into the surface along the normal', () => {
    // depth 1 → the near layer overwrites the clicked voxel (z=0), rest grow up.
    const cells = addBlockCells([0, 0, 0], [0, 0, 1], [1, 1, 3], 1).map((c) => c[2]).sort((a, b) => a - b);
    expect(cells).toEqual([0, 1, 2]);
    // depth === thickness → fully embedded, ending flush at the clicked voxel.
    const deep = addBlockCells([0, 0, 0], [0, 0, 1], [1, 1, 3], 3).map((c) => c[2]).sort((a, b) => a - b);
    expect(deep).toEqual([-2, -1, 0]);
  });

  it('respects the clicked face direction (negative normal grows the other way)', () => {
    const cells = addBlockCells([5, 5, 5], [-1, 0, 0], [3, 1, 1], 0).map((c) => c[0]).sort((a, b) => a - b);
    expect(cells).toEqual([2, 3, 4]); // x = 5-1, 5-2, 5-3
  });

  it('drops out-of-range cells at the coordinate extreme', () => {
    // At x=1023 a +X block would land at 1024+ which is out of range.
    expect(addBlockCells([1023, 0, 0], [1, 0, 0], [3, 1, 1], 0)).toEqual([]);
  });

  it('addBlock stamps the block into the grid and counts changes', () => {
    const g = new VoxelGrid();
    g.set(0, 0, 0, '#fff'); // a 1-voxel tile
    const changed = addBlock(g, [0, 0, 0], [0, 0, 1], [3, 3, 1], 0, '#00ff00');
    expect(changed).toBe(9);
    expect(g.get(0, 0, 1)).toBe(0x00ff00);
    expect(g.get(1, 1, 1)).toBe(0x00ff00);
    expect(g.has(0, 0, -1)).toBe(false); // nothing below the surface
    // The original tile is untouched (the block sits on top, depth 0).
    expect(g.get(0, 0, 0)).toBe(0xffffff);
    expect(new Set(addBlockCells([0, 0, 0], [0, 0, 1], [3, 3, 1], 0).map(key)).size).toBe(9);
  });
});

describe('extrudeBox (box-tool depth)', () => {
  it('depth 0 returns the corners unchanged (legacy box behavior)', () => {
    expect(extrudeBox([0, 0, 0], [4, 4, 0], [0, 0, 1], 0, false)).toEqual([[0, 0, 0], [4, 4, 0]]);
    expect(extrudeBox([0, 0, 0], [4, 4, 0], [0, 0, 1], 0, true)).toEqual([[0, 0, 0], [4, 4, 0]]);
  });

  it('box-fill grows a slab outward along the clicked normal', () => {
    // Flat 5×5 selection on a +Z face → fill extrudes UP into a 5×5×4 slab.
    const [a, b] = extrudeBox([0, 0, 0], [4, 4, 0], [0, 0, 1], 3, false);
    expect(a).toEqual([0, 0, 0]);
    expect(b).toEqual([4, 4, 3]);
  });

  it('box-subtract carves inward along the clicked normal', () => {
    // Click the +Z top face at z=5 → subtract digs DOWN, removing z 2..5.
    const [a, b] = extrudeBox([0, 0, 5], [4, 4, 5], [0, 0, 1], 3, true);
    expect(a).toEqual([0, 0, 2]);
    expect(b).toEqual([4, 4, 5]);
  });

  it('respects a negative face normal', () => {
    // -X face: a fill grows toward -X (outward from that face).
    const [a, b] = extrudeBox([0, 0, 0], [0, 4, 4], [-1, 0, 0], 2, false);
    expect(a).toEqual([-2, 0, 0]);
    expect(b).toEqual([0, 4, 4]);
  });

  it('preserves a non-coplanar box extent on the extrude axis', () => {
    // Corners already span z 0..2; extruding up by 2 → z 0..4, not lost to 2..4.
    const [a, b] = extrudeBox([0, 0, 0], [4, 4, 2], [0, 0, 1], 2, false);
    expect(Math.min(a[2], b[2])).toBe(0);
    expect(Math.max(a[2], b[2])).toBe(4);
  });

  it('drives a real fill/clear when fed through fillBoxRecolor/clearBox', () => {
    const g = new VoxelGrid();
    g.fillBox([0, 0, 0], [4, 4, 0], '#888'); // 5×5 tile at z=0
    const [fa, fb] = extrudeBox([0, 0, 0], [4, 4, 0], [0, 0, 1], 2, false);
    // 5×5×3 slab (z 0..2): recolors the 25 tile cells + 50 new = 75 changed.
    expect(fillBoxRecolor(g, fa, fb, '#0f0')).toBe(75);
    expect(g.size).toBe(75);
    expect(g.has(2, 2, 2)).toBe(true);
    expect(g.has(2, 2, -1)).toBe(false); // never pokes below the surface
  });
});

describe('inBrush footprints', () => {
  it('radius 0 is a single cell', () => {
    expect(inBrush('sphere', 0, 0, 0, 0)).toBe(true);
    expect(inBrush('sphere', 1, 0, 0, 0)).toBe(false);
  });
  it('sphere excludes the corners a cube includes', () => {
    expect(inBrush('cube', 1, 1, 1, 1)).toBe(true);     // corner inside cube
    expect(inBrush('sphere', 1, 1, 1, 1)).toBe(false);  // corner outside sphere (dist²=3)
    expect(inBrush('diamond', 1, 1, 0, 1)).toBe(false); // L1=2 > 1
    expect(inBrush('diamond', 1, 0, 0, 1)).toBe(true);
  });
});

describe('brushApply', () => {
  it('add stamps a cube footprint of new voxels', () => {
    const g = new VoxelGrid();
    const changed = brushApply(g, [0, 0, 0], 1, 'cube', 'add', '#ff0000');
    expect(changed).toBe(27); // 3×3×3
    expect(g.size).toBe(27);
    expect(g.get(1, 1, 1)).toBe(0xff0000);
  });

  it('paint only recolors existing voxels inside the footprint', () => {
    const g = new VoxelGrid();
    g.fillBox([-2, 0, 0], [2, 0, 0], '#ffffff'); // a 5-long row on the X axis
    // A sphere radius 1 centered at origin covers (0,0,0) and its 6 neighbors,
    // but only (−1,0,0)/(0,0,0)/(1,0,0) are occupied in this row.
    const changed = brushApply(g, [0, 0, 0], 1, 'sphere', 'paint', '#00ff00');
    expect(changed).toBe(3);
    expect(g.size).toBe(5);              // paint never creates cells
    expect(g.get(0, 0, 0)).toBe(0x00ff00);
    expect(g.get(2, 0, 0)).toBe(0xffffff); // outside the radius
  });

  it('remove deletes occupied cells inside the footprint', () => {
    const g = new VoxelGrid();
    g.fillBox([-2, -2, -2], [2, 2, 2], '#fff'); // 125
    const removed = brushApply(g, [0, 0, 0], 1, 'cube', 'remove', '#000');
    expect(removed).toBe(27);
    expect(g.size).toBe(98);
  });

  it('spray density keeps roughly the requested fraction (deterministic rng)', () => {
    const g = new VoxelGrid();
    // rng alternating below/above 0.5 → keep ~half with density 0.5.
    let i = 0;
    const rng = () => (i++ % 2 === 0 ? 0.1 : 0.9);
    const changed = brushApply(g, [0, 0, 0], 2, 'cube', 'add', '#fff', 0.5, rng);
    // 5×5×5 = 125 candidates; alternating rng keeps every other one.
    expect(changed).toBeGreaterThan(0);
    expect(changed).toBeLessThan(125);
  });
});

describe('levelRecolor', () => {
  it('recolors only the voxels in the chosen axis layer', () => {
    const g = new VoxelGrid();
    g.fillBox([0, 0, 0], [2, 2, 2], '#ffffff'); // 27
    // Recolor the z=1 layer (9 voxels).
    const changed = levelRecolor(g, 2, 1, '#ff0000');
    expect(changed).toBe(9);
    expect(g.get(0, 0, 1)).toBe(0xff0000);
    expect(g.get(0, 0, 0)).toBe(0xffffff);
    expect(g.get(2, 2, 2)).toBe(0xffffff);
  });
});
