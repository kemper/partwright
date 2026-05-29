import { describe, it, expect } from 'vitest';
import { runVoxelForPaint } from '../../src/geometry/engines/voxel';
import { gridToMeshWithProvenance } from '../../src/geometry/voxel/mesher';
import { VoxelGrid } from '../../src/geometry/voxel/grid';

// Direct exercise of the pieces voxel paint composes — the DOM pointer +
// raycast glue lives behind src/color/voxelPaint.ts (covered by the e2e
// suite). These tests pin down the contract paint relies on: re-running
// code returns a usable grid + provenance, and the provenance maps each
// triangle to a voxel cell we can mutate.

describe('runVoxelForPaint', () => {
  it('returns a grid + provenance for valid voxel code', () => {
    const r = runVoxelForPaint(`
      const v = api.voxels();
      v.set(0, 0, 0, '#ff0000');
      v.set(1, 0, 0, '#00ff00');
      return v;
    `);
    if (!r.ok) throw new Error(r.error);
    expect(r.data.grid.size).toBe(2);
    expect(r.data.mesh.numTri).toBe(20); // 12 + 12 − 4 culled shared faces
    expect(r.data.triVoxel.length).toBe(r.data.mesh.numTri * 3);
  });

  it('reports a clear error for syntax + return-type failures', () => {
    const bad = runVoxelForPaint('this is not js');
    expect(bad.ok).toBe(false);
    if (bad.ok) throw new Error('expected failure');
    expect(bad.error).toBeTruthy();

    const wrongReturn = runVoxelForPaint('return 42;');
    expect(wrongReturn.ok).toBe(false);

    const empty = runVoxelForPaint('return api.voxels();');
    expect(empty.ok).toBe(false);
  });
});

describe('gridToMeshWithProvenance', () => {
  it('maps every emitted triangle back to a voxel that exists in the grid', () => {
    const grid = new VoxelGrid();
    grid.set(0, 0, 0, '#fff');
    grid.set(1, 0, 0, '#fff');
    grid.set(0, 1, 0, '#fff');
    const { mesh, triVoxel } = gridToMeshWithProvenance(grid);
    expect(triVoxel.length).toBe(mesh.numTri * 3);
    for (let t = 0; t < mesh.numTri; t++) {
      const x = triVoxel[t * 3], y = triVoxel[t * 3 + 1], z = triVoxel[t * 3 + 2];
      expect(grid.has(x, y, z), `triangle ${t} → (${x},${y},${z}) must be occupied`).toBe(true);
    }
  });

  it('two triangles of the same face point to the same voxel', () => {
    const grid = new VoxelGrid();
    grid.set(0, 0, 0, '#fff');
    const { mesh, triVoxel } = gridToMeshWithProvenance(grid);
    // 6 faces × 2 triangles = 12; every pair (2t, 2t+1) belongs to one face,
    // and every face of a single voxel maps back to that same voxel.
    expect(mesh.numTri).toBe(12);
    for (let t = 0; t < mesh.numTri; t++) {
      expect([triVoxel[t * 3], triVoxel[t * 3 + 1], triVoxel[t * 3 + 2]]).toEqual([0, 0, 0]);
    }
  });

  it('mutating the grid + re-meshing reflects paint and erase', () => {
    // Simulate a paint click: pick a triangle from the initial mesh, change
    // that voxel's color (or remove it), re-mesh, confirm the effect.
    const grid = new VoxelGrid();
    grid.fillBox([0, 0, 0], [1, 1, 1], '#ffffff');
    const first = gridToMeshWithProvenance(grid);
    // Pick triangle 0 → its voxel.
    const t = 0;
    const [x, y, z] = [first.triVoxel[t * 3], first.triVoxel[t * 3 + 1], first.triVoxel[t * 3 + 2]];
    grid.set(x, y, z, '#ff0000');
    const after = gridToMeshWithProvenance(grid);
    // Same topology, but triColors changed where the painted voxel exposed
    // faces. At least one triangle in `after` must carry the new color.
    let foundRed = false;
    for (let i = 0; i < after.mesh.numTri; i++) {
      if (after.mesh.triColors![i * 3] === 0xff
        && after.mesh.triColors![i * 3 + 1] === 0
        && after.mesh.triColors![i * 3 + 2] === 0) { foundRed = true; break; }
    }
    expect(foundRed).toBe(true);

    // Erase the same voxel → no triangle should reference that cell anymore.
    // (Triangle count alone is unreliable: removing a corner voxel hides
    // 3 outer faces but exposes 3 inner faces — net zero on a 2×2×2.)
    grid.remove(x, y, z);
    const erased = gridToMeshWithProvenance(grid);
    expect(grid.has(x, y, z)).toBe(false);
    for (let i = 0; i < erased.mesh.numTri; i++) {
      const match = erased.triVoxel[i * 3] === x
        && erased.triVoxel[i * 3 + 1] === y
        && erased.triVoxel[i * 3 + 2] === z;
      expect(match, `triangle ${i} still points to erased voxel`).toBe(false);
    }
  });
});
