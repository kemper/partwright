import { describe, it, expect } from 'vitest';
import { VoxelGrid } from '../../src/geometry/voxel/grid';
import { meshGrid } from '../../src/geometry/voxel/mesher';
import type { MeshData } from '../../src/geometry/types';

/** A solid voxel box from voxel (0,0,0) to (s-1,s-1,s-1), sitting on z=0. */
function box(s = 5): VoxelGrid {
  return new VoxelGrid().fillBox([0, 0, 0], [s - 1, s - 1, s - 1], '#888');
}

function zValues(m: MeshData): number[] {
  const out: number[] = [];
  for (let v = 0; v < m.numVert; v++) out.push(m.vertProperties[v * 3 + 2]);
  return out;
}

function minZ(m: MeshData): number {
  return Math.min(...zValues(m));
}

describe('voxel smooth — base pinning', () => {
  it('plain smooth pulls the bottom off the build plate (it rocks)', () => {
    // Baseline: without pinning, Taubin moves the bottom plane off z=0 (the
    // anti-shrink μ pass even bulges it below), so the model no longer sits flat.
    const m = meshGrid(box(5).smooth({ algorithm: 'taubin', iterations: 3 }));
    expect(Math.abs(minZ(m))).toBeGreaterThan(0.05);
  });

  it('flatBottom keeps the bottom plane flat at z=0 while still rounding above', () => {
    const grid = box(5);
    const blocky = meshGrid(grid.clone()); // default surfacing
    const m = meshGrid(grid.smooth({ algorithm: 'taubin', iterations: 3, flatBottom: true }));

    // Same topology / vertex order (same occupancy → same gridToMeshData).
    expect(m.numVert).toBe(blocky.numVert);

    // No vertex drops below or rises off the z=0 plane: the floor stays flat.
    expect(minZ(m)).toBeCloseTo(0, 5);

    let pinnedZ = 0, movedXY = 0, movedAbove = 0;
    for (let v = 0; v < m.numVert; v++) {
      const bz = blocky.vertProperties[v * 3 + 2];
      const z = m.vertProperties[v * 3 + 2];
      if (bz === 0) {
        // Bottom-plane vertices keep z exactly; x/y may relax inward.
        expect(z).toBeCloseTo(0, 6);
        pinnedZ++;
        if (m.vertProperties[v * 3] !== blocky.vertProperties[v * 3]
          || m.vertProperties[v * 3 + 1] !== blocky.vertProperties[v * 3 + 1]) movedXY++;
      } else if (z !== bz) {
        movedAbove++;
      }
    }
    expect(pinnedZ).toBeGreaterThan(0);
    expect(movedXY).toBeGreaterThan(0);   // sides still round (x/y free)
    expect(movedAbove).toBeGreaterThan(0); // body above still smooths
  });

  it('baseLayers keeps the bottom N layers fully blocky (sharp pedestal)', () => {
    const grid = box(6);
    const blocky = meshGrid(grid.clone());
    const m = meshGrid(grid.smooth({ algorithm: 'taubin', iterations: 4, baseLayers: 2 }));

    let pinned = 0, moved = 0;
    for (let v = 0; v < m.numVert; v++) {
      const bx = blocky.vertProperties[v * 3];
      const by = blocky.vertProperties[v * 3 + 1];
      const bz = blocky.vertProperties[v * 3 + 2];
      const z = m.vertProperties[v * 3 + 2];
      if (bz <= 2 + 1e-6) {
        // Fully pinned: identical position on all axes.
        expect(m.vertProperties[v * 3]).toBe(bx);
        expect(m.vertProperties[v * 3 + 1]).toBe(by);
        expect(z).toBe(bz);
        pinned++;
      } else if (z !== bz) {
        moved++;
      }
    }
    expect(pinned).toBeGreaterThan(0);
    expect(moved).toBeGreaterThan(0);
  });

  it('lockBox keeps the voxels in the box blocky', () => {
    const grid = box(6);
    const blocky = meshGrid(grid.clone());
    // Lock the bottom layer of voxels (z=0) → corners span z in [0,1].
    const m = meshGrid(grid.smooth({ algorithm: 'taubin', iterations: 4, lockBox: [[0, 0, 0], [5, 5, 0]] }));

    let pinned = 0;
    for (let v = 0; v < m.numVert; v++) {
      const bz = blocky.vertProperties[v * 3 + 2];
      if (bz <= 1 + 1e-6) {
        expect(m.vertProperties[v * 3]).toBe(blocky.vertProperties[v * 3]);
        expect(m.vertProperties[v * 3 + 1]).toBe(blocky.vertProperties[v * 3 + 1]);
        expect(m.vertProperties[v * 3 + 2]).toBe(bz);
        pinned++;
      }
    }
    expect(pinned).toBeGreaterThan(0);
  });

  it('flatBottom composes with detail without dropping below the plane', () => {
    const m = meshGrid(box(5).smooth({ algorithm: 'taubin', iterations: 2, detail: 2, flatBottom: true }));
    expect(minZ(m)).toBeCloseTo(0, 5);
  });

  it('rejects unknown smooth keys, bad lockBox shapes, and bad algorithm', () => {
    expect(() => new VoxelGrid().smooth({ flatBotom: true } as never)).toThrow();
    expect(() => new VoxelGrid().smooth({ lockBox: [[0, 0, 0]] } as never)).toThrow();
    expect(() => new VoxelGrid().smooth({ lockBox: [[0, 0, 0], [1, 1, 1.5]] } as never)).toThrow();
    expect(() => new VoxelGrid().smooth({ baseLayers: 0 } as never)).toThrow();
    expect(() => new VoxelGrid().smooth({ algorithm: 'laplacian' } as never)).toThrow();
  });
});

describe('voxel smooth — algorithm selection (Surface Nets default)', () => {
  it('bare .smooth() selects Surface Nets', () => {
    expect(box(4).smooth().surfacing().algorithm).toBe('surfaceNets');
    expect(box(4).smooth({ algorithm: 'taubin' }).surfacing().algorithm).toBe('taubin');
  });

  it('Surface Nets produces a non-empty, finite mesh with per-triangle colors', () => {
    const sn = meshGrid(box(6).smooth()); // default → surfaceNets
    expect(sn.numTri).toBeGreaterThan(0);
    expect(sn.numVert).toBeGreaterThan(0);
    expect(Array.from(sn.vertProperties).every(Number.isFinite)).toBe(true);
    // Per-triangle colors: 3 bytes per triangle.
    expect(sn.triColors!.length).toBe(sn.numTri * 3);
    // Rounded inward of the blocky [0..6] box, but still substantial extent.
    const xs: number[] = [];
    for (let v = 0; v < sn.numVert; v++) xs.push(sn.vertProperties[v * 3]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(3);
  });

  it('Surface Nets honors flatBottom (bottom plane stays flat, does not rock)', () => {
    const m = meshGrid(box(6).smooth({ algorithm: 'surfaceNets', flatBottom: true }));
    // All vertices at or above the floor; the floor itself is a single flat plane.
    const zMin = minZ(m);
    let onFloor = 0;
    for (let v = 0; v < m.numVert; v++) {
      const z = m.vertProperties[v * 3 + 2];
      expect(z).toBeGreaterThanOrEqual(zMin - 1e-4);
      if (Math.abs(z - zMin) < 1e-4) onFloor++;
    }
    expect(onFloor).toBeGreaterThan(0);
  });

  it('Surface Nets on an empty grid yields an empty mesh', () => {
    const m = meshGrid(new VoxelGrid().smooth());
    expect(m.numTri).toBe(0);
    expect(m.numVert).toBe(0);
  });
});

describe('voxel smooth — rounding amount (strength)', () => {
  function totalDelta(a: MeshData, b: MeshData): number {
    let d = 0;
    for (let i = 0; i < a.vertProperties.length; i++) d += Math.abs(a.vertProperties[i] - b.vertProperties[i]);
    return d;
  }

  it('stores strength (default 1) and rejects out-of-range', () => {
    expect(new VoxelGrid().smooth().surfacing().strength).toBe(1);
    expect(new VoxelGrid().smooth({ strength: 0.3 }).surfacing().strength).toBe(0.3);
    expect(() => new VoxelGrid().smooth({ strength: 1.5 } as never)).toThrow();
    expect(() => new VoxelGrid().smooth({ strength: -0.1 } as never)).toThrow();
  });

  it('taubin strength 0 leaves the block mesh un-rounded; 1 rounds fully', () => {
    const block = meshGrid(box(5)); // blocky
    const s0 = meshGrid(box(5).smooth({ algorithm: 'taubin', strength: 0 }));
    const s1 = meshGrid(box(5).smooth({ algorithm: 'taubin', strength: 1 }));
    expect(totalDelta(s0, block)).toBeCloseTo(0, 4); // strength 0 = no movement
    expect(totalDelta(s1, block)).toBeGreaterThan(1); // strength 1 = clearly rounded
  });

  it('higher strength rounds more (monotonic displacement from blocky)', () => {
    const block = meshGrid(box(6));
    const lo = meshGrid(box(6).smooth({ algorithm: 'taubin', strength: 0.25 }));
    const hi = meshGrid(box(6).smooth({ algorithm: 'taubin', strength: 1 }));
    expect(totalDelta(lo, block)).toBeGreaterThan(0);
    expect(totalDelta(hi, block)).toBeGreaterThan(totalDelta(lo, block));
  });

  it('strength tunes Surface Nets post-relaxation (same topology, different positions)', () => {
    const sn0 = meshGrid(box(6).smooth({ strength: 0 }));
    const sn1 = meshGrid(box(6).smooth({ strength: 1 }));
    expect(sn0.numVert).toBe(sn1.numVert); // same SN base topology
    expect(totalDelta(sn0, sn1)).toBeGreaterThan(0); // relaxation amount differs
  });
});
