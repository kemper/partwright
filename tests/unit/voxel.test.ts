import { describe, it, expect } from 'vitest';
import {
  VoxelGrid,
  normalizeColor,
  colorComponents,
  encodeGrid,
  decodeGrid,
  COORD_MAX,
} from '../../src/geometry/voxel/grid';
import { gridToMeshData, meshGrid } from '../../src/geometry/voxel/mesher';
import { taubinSmooth } from '../../src/geometry/voxel/smooth';
import {
  imageDataToVoxelGrid,
  generateVoxelImportCode,
  type ImageDataLike,
} from '../../src/import/imageToVoxel';

describe('normalizeColor', () => {
  it('parses 6- and 3-digit hex (with or without #)', () => {
    expect(normalizeColor('#ff8800')).toBe(0xff8800);
    expect(normalizeColor('ff8800')).toBe(0xff8800);
    expect(normalizeColor('#f80')).toBe(0xff8800);
  });
  it('parses [r,g,b] tuples and packed numbers', () => {
    expect(normalizeColor([255, 136, 0])).toBe(0xff8800);
    expect(normalizeColor(0x00ff00)).toBe(0x00ff00);
  });
  it('round-trips through colorComponents', () => {
    expect(colorComponents(0xff8800)).toEqual([255, 136, 0]);
  });
  it('rejects malformed colors', () => {
    expect(() => normalizeColor('not-a-color')).toThrow();
    expect(() => normalizeColor([300, 0, 0])).toThrow();
    expect(() => normalizeColor(0x1000000)).toThrow();
  });
});

describe('VoxelGrid', () => {
  it('set / has / get / remove / size', () => {
    const v = new VoxelGrid();
    expect(v.size).toBe(0);
    v.set(1, 2, 3, '#abcdef');
    expect(v.size).toBe(1);
    expect(v.has(1, 2, 3)).toBe(true);
    expect(v.get(1, 2, 3)).toBe(0xabcdef);
    expect(v.has(0, 0, 0)).toBe(false);
    v.remove(1, 2, 3);
    expect(v.size).toBe(0);
  });

  it('supports negative coordinates and black voxels', () => {
    const v = new VoxelGrid();
    v.set(-5, -10, -2, 0x000000);
    expect(v.has(-5, -10, -2)).toBe(true);
    expect(v.get(-5, -10, -2)).toBe(0);
  });

  it('fillBox fills an inclusive box regardless of corner order', () => {
    const v = new VoxelGrid();
    v.fillBox([2, 2, 2], [0, 0, 0], '#fff');
    expect(v.size).toBe(27); // 3 * 3 * 3
    expect(v.has(0, 0, 0)).toBe(true);
    expect(v.has(2, 2, 2)).toBe(true);
  });

  it('sphere fills a rounded blob and bounds() reports extents', () => {
    const v = new VoxelGrid();
    v.sphere([0, 0, 0], 2, '#f00');
    expect(v.size).toBeGreaterThan(0);
    const b = v.bounds()!;
    expect(b.min).toEqual([-2, -2, -2]);
    expect(b.max).toEqual([2, 2, 2]);
    // Corner of the bounding cube is outside radius 2, so it must be empty.
    expect(v.has(2, 2, 2)).toBe(false);
  });

  it('line connects two points with no gaps', () => {
    const v = new VoxelGrid();
    v.line([0, 0, 0], [5, 0, 0], '#0f0');
    for (let x = 0; x <= 5; x++) expect(v.has(x, 0, 0)).toBe(true);
  });

  it('rejects out-of-range coordinates', () => {
    const v = new VoxelGrid();
    expect(() => v.set(COORD_MAX + 1, 0, 0, '#fff')).toThrow();
  });
});

describe('encodeGrid / decodeGrid', () => {
  it('round-trips voxels and colors (incl. negative coords)', () => {
    const v = new VoxelGrid();
    v.set(-3, 5, 2, '#123456');
    v.set(10, -2, 0, [1, 2, 3]);
    v.fillBox([0, 0, 0], [2, 2, 2], '#abcdef');
    const restored = decodeGrid(encodeGrid(v));
    expect(restored.size).toBe(v.size);
    expect(restored.get(-3, 5, 2)).toBe(0x123456);
    expect(restored.get(10, -2, 0)).toBe(0x010203);
    expect(restored.get(1, 1, 1)).toBe(0xabcdef);
  });

  it('round-trips an empty grid', () => {
    const restored = decodeGrid(encodeGrid(new VoxelGrid()));
    expect(restored.size).toBe(0);
  });

  it('rejects garbage input', () => {
    expect(() => decodeGrid('bm90LXZveGVscw==')).toThrow();
  });
});

// Build a directed-edge multiset for the mesh. For a closed, consistently-wound
// 2-manifold every directed edge (a→b) appears exactly once and its opposite
// (b→a) appears exactly once on the neighboring triangle.
function directedEdgeCounts(tris: Uint32Array): Map<string, number> {
  const counts = new Map<string, number>();
  for (let t = 0; t < tris.length; t += 3) {
    const a = tris[t], b = tris[t + 1], c = tris[t + 2];
    for (const [u, w] of [[a, b], [b, c], [c, a]] as const) {
      const k = `${u}->${w}`;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
  }
  return counts;
}

function assertClosedManifold(tris: Uint32Array): void {
  const counts = directedEdgeCounts(tris);
  for (const [edge, n] of counts) {
    expect(n, `directed edge ${edge} used ${n}×`).toBe(1);
    const [u, w] = edge.split('->');
    expect(counts.get(`${w}->${u}`), `missing opposite of ${edge}`).toBe(1);
  }
}

describe('gridToMeshData', () => {
  it('meshes a single voxel as a welded cube (8 verts, 12 tris)', () => {
    const v = new VoxelGrid();
    v.set(0, 0, 0, '#ff0000');
    const m = gridToMeshData(v);
    expect(m.numVert).toBe(8);   // welded cube corners
    expect(m.numTri).toBe(12);   // 6 faces × 2
    expect(m.numProp).toBe(3);
    expect(m.triColors).toBeDefined();
    expect(m.triColors!.length).toBe(12 * 3);
    // Color carried onto every triangle.
    expect([m.triColors![0], m.triColors![1], m.triColors![2]]).toEqual([255, 0, 0]);
    assertClosedManifold(m.triVerts);
  });

  it('culls the shared face between two adjacent voxels', () => {
    const v = new VoxelGrid();
    v.set(0, 0, 0, '#fff');
    v.set(1, 0, 0, '#fff');
    const m = gridToMeshData(v);
    // 12 outer faces (6 per cube minus the 2 touching faces) → 20 triangles.
    expect(m.numTri).toBe(20);
    assertClosedManifold(m.triVerts);
  });

  it('stays a closed manifold for a solid block', () => {
    const v = new VoxelGrid();
    v.fillBox([0, 0, 0], [3, 3, 3], '#3399ff');
    const m = gridToMeshData(v);
    // A solid 4×4×4 block: only the outer shell survives. 6 faces × 16 quads
    // × 2 tris = 192 triangles.
    expect(m.numTri).toBe(6 * 16 * 2);
    assertClosedManifold(m.triVerts);
  });

  it('marks every triangle painted so black voxels keep their color', () => {
    const v = new VoxelGrid();
    v.set(0, 0, 0, 0x000000); // pure black — the case the _painted mask guards
    const m = gridToMeshData(v);
    const painted = (m.triColors as Uint8Array & { _painted?: Uint8Array })._painted;
    expect(painted).toBeDefined();
    expect(painted!.length).toBe(m.numTri);
    expect(Array.from(painted!).every(x => x === 1)).toBe(true);
  });
});

describe('imageDataToVoxelGrid', () => {
  // 2×2 image: red, green / transparent, blue.
  function mk2x2(): ImageDataLike {
    const data = new Uint8ClampedArray([
      255, 0, 0, 255,   // (0,0) red, opaque
      0, 255, 0, 255,   // (1,0) green, opaque
      0, 0, 0, 0,       // (0,1) transparent
      0, 0, 255, 255,   // (1,1) blue, opaque
    ]);
    return { width: 2, height: 2, data };
  }

  it('drops transparent pixels and maps colors onto an upright billboard', () => {
    const grid = imageDataToVoxelGrid(mk2x2(), { depth: 1 });
    expect(grid.size).toBe(3);
    // offX = 1; row 0 → z = 1 (image top), row 1 → z = 0 (sits on ground).
    expect(grid.get(-1, 0, 1)).toBe(0xff0000); // red,  col 0 row 0
    expect(grid.get(0, 0, 1)).toBe(0x00ff00);  // green, col 1 row 0
    expect(grid.get(0, 0, 0)).toBe(0x0000ff);  // blue,  col 1 row 1
    expect(grid.has(-1, 0, 0)).toBe(false);    // transparent pixel skipped
  });

  it('extrudes along Y by depth', () => {
    const grid = imageDataToVoxelGrid(mk2x2(), { depth: 3 });
    expect(grid.size).toBe(3 * 3); // 3 opaque pixels × depth 3
    expect(grid.get(-1, 2, 1)).toBe(0xff0000);
  });

  it('downsamples so the longest side fits maxSize', () => {
    const w = 200, h = 100;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) { data[i * 4] = 200; data[i * 4 + 3] = 255; }
    const grid = imageDataToVoxelGrid({ width: w, height: h, data }, { maxSize: 64, depth: 1 });
    const b = grid.bounds()!;
    expect(b.max[0] - b.min[0] + 1).toBeLessThanOrEqual(64);
    expect(b.max[2] - b.min[2] + 1).toBeLessThanOrEqual(64);
  });

  it('generated import code round-trips through decodeGrid', () => {
    const grid = imageDataToVoxelGrid(mk2x2(), { depth: 1 });
    const code = generateVoxelImportCode(grid, 'logo.png');
    expect(code).toContain('voxels.decode(');
    // Extract the encoded string literal and confirm it reconstructs the grid.
    const m = /voxels\.decode\((".*?")\)/.exec(code);
    expect(m).not.toBeNull();
    const restored = decodeGrid(JSON.parse(m![1]));
    expect(restored.size).toBe(grid.size);
    expect(restored.get(-1, 0, 1)).toBe(0xff0000);
  });
});

describe('VoxelGrid ops', () => {
  it('cylinder fills a disc-extruded solid along the chosen axis', () => {
    const v = new VoxelGrid();
    v.cylinder([0, 0, 0], 3, 5, '#ffffff'); // Z by default, height 5
    expect(v.has(0, 0, 0)).toBe(true);
    expect(v.has(0, 0, 4)).toBe(true);    // height 5 → z 0..4
    expect(v.has(0, 0, 5)).toBe(false);
    expect(v.has(3, 0, 2)).toBe(true);    // 3² ≤ 9 (on the rim)
    expect(v.has(3, 3, 2)).toBe(false);   // 18 > 9 (corner, outside)
    const b = v.bounds()!;
    expect([b.min[2], b.max[2]]).toEqual([0, 4]);

    const vx = new VoxelGrid();
    vx.cylinder([0, 0, 0], 2, 4, '#fff', 'x');
    expect(vx.has(3, 0, 0)).toBe(true);   // extends along +X
    expect(vx.has(0, 2, 0)).toBe(true);   // radius on the YZ disc
  });

  it('translate shifts every voxel and keeps colors', () => {
    const v = new VoxelGrid();
    v.set(0, 0, 0, '#ffffff').set(1, 0, 0, '#ff0000');
    v.translate([5, 2, -1]);
    expect(v.has(5, 2, -1)).toBe(true);
    expect(v.has(6, 2, -1)).toBe(true);
    expect(v.has(0, 0, 0)).toBe(false);
    expect(v.size).toBe(2);
    expect(v.get(5, 2, -1)).toBe(0xffffff);
  });

  it('mirror adds a reflected copy across the axis 0-plane', () => {
    const v = new VoxelGrid();
    v.set(2, 0, 0, '#abcdef');
    v.mirror('x');
    expect(v.has(2, 0, 0)).toBe(true);
    expect(v.has(-3, 0, 0)).toBe(true); // cell 2 -> cell -1-2
    expect(v.get(-3, 0, 0)).toBe(0xabcdef);
    expect(v.size).toBe(2);
  });

  it('hollow removes interior voxels, leaving a shell', () => {
    const v = new VoxelGrid();
    v.fillBox([0, 0, 0], [2, 2, 2], '#ffffff'); // solid 3×3×3 = 27
    expect(v.size).toBe(27);
    v.hollow(1);
    expect(v.has(1, 1, 1)).toBe(false); // the one interior voxel is gone
    expect(v.has(0, 0, 0)).toBe(true);  // shell kept
    expect(v.size).toBe(26);
  });

  it('supersample expands each voxel into a factor³ block', () => {
    const v = new VoxelGrid();
    v.set(0, 0, 0, '#aabbcc');
    const big = v.supersample(2);
    expect(big.size).toBe(8);
    expect(big.get(0, 0, 0)).toBe(0xaabbcc);
    expect(big.get(1, 1, 1)).toBe(0xaabbcc);
    expect(v.size).toBe(1); // original untouched
  });

  it('supersample throws when the result would exceed the coordinate range', () => {
    const v = new VoxelGrid();
    v.set(1000, 0, 0, '#fff'); // 1000*8 ≫ 1023
    expect(() => v.supersample(8)).toThrow();
  });

  it('surfacing defaults to blocks and smooth() toggles it', () => {
    const v = new VoxelGrid();
    expect(v.surfacing().mode).toBe('blocks');
    v.smooth();
    expect(v.surfacing()).toMatchObject({ mode: 'smooth', iterations: 2, detail: 1 });
    v.smooth(4);
    expect(v.surfacing().iterations).toBe(4);
    v.smooth({ iterations: 3, detail: 2 });
    expect(v.surfacing()).toMatchObject({ mode: 'smooth', iterations: 3, detail: 2 });
    v.blocky();
    expect(v.surfacing().mode).toBe('blocks');
    expect(() => v.smooth({ detail: 9 })).toThrow();
  });
});

describe('voxel surfacing (Taubin smoothing)', () => {
  it('taubinSmooth moves vertices but preserves topology + colors', () => {
    const v = new VoxelGrid();
    v.fillBox([0, 0, 0], [3, 3, 3], '#3399ff');
    const block = gridToMeshData(v);
    const smoothed = taubinSmooth(block, 2);
    expect(smoothed.numVert).toBe(block.numVert);
    expect(smoothed.numTri).toBe(block.numTri);
    expect(smoothed.triColors).toBe(block.triColors); // colors carried (same ref)
    expect(Array.from(smoothed.vertProperties).every(Number.isFinite)).toBe(true);
    let moved = false;
    for (let i = 0; i < block.vertProperties.length; i++) {
      if (Math.abs(block.vertProperties[i] - smoothed.vertProperties[i]) > 1e-6) { moved = true; break; }
    }
    expect(moved).toBe(true);
  });

  it('taubinSmooth with 0 iterations is a no-op', () => {
    const v = new VoxelGrid();
    v.set(0, 0, 0, '#fff');
    const m = gridToMeshData(v);
    expect(taubinSmooth(m, 0)).toBe(m);
  });

  it('meshGrid applies smooth surfacing (detail 1 keeps topology, detail>1 densifies)', () => {
    const v = new VoxelGrid();
    v.fillBox([0, 0, 0], [3, 3, 3], '#3399ff').smooth();
    const m = meshGrid(v);
    expect(m.numTri).toBe(192); // detail 1 → same topology as the block mesh
    const block = gridToMeshData(new VoxelGrid().fillBox([0, 0, 0], [3, 3, 3], '#3399ff'));
    let moved = false;
    for (let i = 0; i < block.vertProperties.length; i++) {
      if (Math.abs(block.vertProperties[i] - m.vertProperties[i]) > 1e-6) { moved = true; break; }
    }
    expect(moved).toBe(true);

    const v2 = new VoxelGrid();
    v2.fillBox([0, 0, 0], [3, 3, 3], '#3399ff').smooth({ iterations: 2, detail: 2 });
    const m2 = meshGrid(v2);
    expect(m2.numTri).toBeGreaterThan(192); // supersampled → denser mesh
    expect(Array.from(m2.vertProperties).every(Number.isFinite)).toBe(true);
    // Scaled back to the original world size — the block spans ~0..4 units,
    // NOT the 0..8 of the 2× supersampled grid. (Taubin's anti-shrink pass can
    // nudge corner vertices slightly past 4, so allow a small margin.)
    let maxX = -Infinity;
    for (let i = 0; i < m2.vertProperties.length; i += 3) maxX = Math.max(maxX, m2.vertProperties[i]);
    expect(maxX).toBeGreaterThan(3);
    expect(maxX).toBeLessThan(5);
  });
});
