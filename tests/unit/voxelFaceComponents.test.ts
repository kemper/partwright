import { describe, it, expect } from 'vitest';
import { VoxelGrid } from '../../src/geometry/voxel/grid';

describe('VoxelGrid.faceComponentCount', () => {
  it('is 0 for an empty grid', () => {
    expect(new VoxelGrid().faceComponentCount()).toBe(0);
  });

  it('is 1 for a single voxel', () => {
    const v = new VoxelGrid().set(0, 0, 0, '#fff');
    expect(v.faceComponentCount()).toBe(1);
  });

  it('counts face-adjacent voxels as ONE piece', () => {
    const v = new VoxelGrid().set(0, 0, 0, '#fff').set(1, 0, 0, '#fff');
    expect(v.faceComponentCount()).toBe(1);
  });

  it('counts edge-only (diagonal) touches as SEPARATE pieces', () => {
    // (0,0,0) and (1,1,0) share only an edge, not a face → 2 pieces.
    const v = new VoxelGrid().set(0, 0, 0, '#fff').set(1, 1, 0, '#fff');
    expect(v.faceComponentCount()).toBe(2);
  });

  it('counts corner-only touches as SEPARATE pieces', () => {
    const v = new VoxelGrid().set(0, 0, 0, '#fff').set(1, 1, 1, '#fff');
    expect(v.faceComponentCount()).toBe(2);
  });

  it('reports ONE piece for a hollow shell with an enclosed cavity', () => {
    // This is the case the mesh componentCount over-reports (cavity surface =
    // a 2nd manifold component): the shell is fully face-connected → 1 piece.
    const v = new VoxelGrid();
    v.fillBox([0, 0, 0], [4, 4, 4], '#ccd');
    v.remove(2, 2, 2);
    expect(v.faceComponentCount()).toBe(1);
  });

  it('counts two disjoint blobs as two pieces', () => {
    const v = new VoxelGrid();
    v.fillBox([0, 0, 0], [2, 2, 2], '#f00');
    v.fillBox([10, 0, 0], [12, 2, 2], '#00f');
    expect(v.faceComponentCount()).toBe(2);
  });

  it('handles a face-connected L of voxels as one piece', () => {
    const v = new VoxelGrid()
      .set(0, 0, 0, '#fff').set(1, 0, 0, '#fff').set(2, 0, 0, '#fff')
      .set(2, 1, 0, '#fff').set(2, 2, 0, '#fff');
    expect(v.faceComponentCount()).toBe(1);
  });
});
