import { describe, it, expect } from 'vitest';
import { VoxelGrid } from '../../src/geometry/voxel/grid';
import { gridToMeshWithProvenance } from '../../src/geometry/voxel/mesher';
import { bucketRecolor, clearBox, fillBoxRecolor, addTarget, brushApply, levelRecolor, inBrush } from '../../src/geometry/voxel/edits';

// Pure-logic tests for the Voxel Studio multi-voxel edit operations + the
// provenance the "add" tool relies on. The DOM/raycast glue (voxelPaint.ts)
// is covered by the e2e suite via the partwright API.

describe('VoxelGrid.clone', () => {
  it('deep-copies cells + surfacing without aliasing', () => {
    const g = new VoxelGrid();
    g.fillBox([0, 0, 0], [2, 2, 2], '#abcdef');
    g.smooth({ iterations: 3, detail: 2 });
    const c = g.clone();
    expect(c.size).toBe(g.size);
    expect(c.surfacing()).toEqual({ mode: 'smooth', iterations: 3, detail: 2 });
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
