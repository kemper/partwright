import { describe, it, expect } from 'vitest';
import {
  VoxelGrid,
  normalizeColor,
  colorComponents,
  encodeGrid,
  decodeGrid,
  COORD_MAX,
} from '../../src/geometry/voxel/grid';
import { gridToMeshData } from '../../src/geometry/voxel/mesher';
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
