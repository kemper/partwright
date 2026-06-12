import { describe, it, expect } from 'vitest';
import { VoxelGrid } from '../../src/geometry/voxel/grid';

describe('VoxelGrid.solidifyDiagonals', () => {
  it('a 2-voxel XY-plane diagonal becomes face-connected after solidifyDiagonals', () => {
    // (0,0,0) and (1,1,0): diagonal in XY-plane — 2 separate pieces before.
    const v = new VoxelGrid().set(0, 0, 0, '#f00').set(1, 1, 0, '#f00');
    expect(v.faceComponentCount()).toBe(2); // precondition
    v.solidifyDiagonals();
    // After bridging, must be a single face-connected piece.
    expect(v.faceComponentCount()).toBe(1);
    // At least one bridge voxel must have been added at a valid bridging position.
    // (The algorithm may add up to two bridges, one from each end of the diagonal —
    // that is still correct: both are needed to keep the grid stable in more
    // complex shapes, and they merge into a single face-connected island here.)
    const bridgedAt100 = v.has(1, 0, 0);
    const bridgedAt010 = v.has(0, 1, 0);
    expect(bridgedAt100 || bridgedAt010).toBe(true);
    // Size must have grown by at least 1 bridge.
    expect(v.size).toBeGreaterThanOrEqual(3);
  });

  it('a 2-voxel XZ-plane diagonal becomes face-connected after solidifyDiagonals', () => {
    const v = new VoxelGrid().set(0, 0, 0, '#0f0').set(1, 0, 1, '#0f0');
    expect(v.faceComponentCount()).toBe(2);
    v.solidifyDiagonals();
    expect(v.faceComponentCount()).toBe(1);
  });

  it('a 2-voxel YZ-plane diagonal becomes face-connected after solidifyDiagonals', () => {
    const v = new VoxelGrid().set(0, 0, 0, '#00f').set(0, 1, 1, '#00f');
    expect(v.faceComponentCount()).toBe(2);
    v.solidifyDiagonals();
    expect(v.faceComponentCount()).toBe(1);
  });

  it('an already face-adjacent pair is unchanged by solidifyDiagonals', () => {
    const v = new VoxelGrid().set(0, 0, 0, '#fff').set(1, 0, 0, '#fff');
    const sizeBefore = v.size;
    expect(v.faceComponentCount()).toBe(1);
    v.solidifyDiagonals();
    expect(v.faceComponentCount()).toBe(1);
    expect(v.size).toBe(sizeBefore);
  });

  it('returns this (chainable)', () => {
    const v = new VoxelGrid().set(0, 0, 0, '#ccc');
    expect(v.solidifyDiagonals()).toBe(v);
  });
});

describe('VoxelGrid.weld', () => {
  it('copies voxels from other into empty grid', () => {
    const a = new VoxelGrid();
    const b = new VoxelGrid().set(1, 2, 3, '#f00').set(4, 5, 6, '#0f0');
    a.weld(b);
    expect(a.has(1, 2, 3)).toBe(true);
    expect(a.has(4, 5, 6)).toBe(true);
    expect(a.size).toBe(2);
  });

  it('does not overwrite existing voxels', () => {
    const a = new VoxelGrid().set(0, 0, 0, 0xff0000); // red
    const b = new VoxelGrid().set(0, 0, 0, 0x0000ff); // blue — should not overwrite
    a.weld(b);
    expect(a.get(0, 0, 0)).toBe(0xff0000); // stays red
  });

  it('fills in new voxels from other', () => {
    const a = new VoxelGrid().set(0, 0, 0, 0xff0000);
    const b = new VoxelGrid().set(0, 0, 0, 0x0000ff).set(1, 0, 0, 0x00ff00);
    a.weld(b);
    expect(a.get(0, 0, 0)).toBe(0xff0000); // unchanged
    expect(a.get(1, 0, 0)).toBe(0x00ff00); // filled from b
    expect(a.size).toBe(2);
  });

  it('returns this (chainable)', () => {
    const a = new VoxelGrid();
    const b = new VoxelGrid();
    expect(a.weld(b)).toBe(a);
  });

  it('weld with empty other does nothing', () => {
    const a = new VoxelGrid().set(5, 5, 5, '#abc');
    a.weld(new VoxelGrid());
    expect(a.size).toBe(1);
  });
});

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
