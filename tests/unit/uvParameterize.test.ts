import { describe, it, expect } from 'vitest';
import { unwrapMesh, lscmUnwrapMesh, harmonicUnwrapMesh } from '../../src/surface/uvParameterize';

/**
 * Build a flat N×N grid in the XY plane spanning [0,size]². Triangulated with
 * two triangles per cell. A planar mesh is the cleanest test bed: a conformal
 * map of a plane is a similarity, so LSCM should recover near-constant
 * UV/world edge ratios.
 */
function gridPlane(n: number, size = 10): { positions: Float32Array; triVerts: Uint32Array } {
  const positions = new Float32Array(n * n * 3);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const v = j * n + i;
      positions[v * 3]     = (i / (n - 1)) * size;
      positions[v * 3 + 1] = (j / (n - 1)) * size;
      positions[v * 3 + 2] = 0;
    }
  }
  const tris: number[] = [];
  for (let j = 0; j < n - 1; j++) {
    for (let i = 0; i < n - 1; i++) {
      const a = j * n + i, b = j * n + i + 1, c = (j + 1) * n + i, d = (j + 1) * n + i + 1;
      tris.push(a, b, d, a, d, c);
    }
  }
  return { positions, triVerts: new Uint32Array(tris) };
}

/** Closed octahedron — a tiny genus-0 closed surface for the closed-mesh paths. */
function octahedron(r = 5): { positions: Float32Array; triVerts: Uint32Array } {
  const positions = new Float32Array([
    r, 0, 0, -r, 0, 0, 0, r, 0, 0, -r, 0, 0, 0, r, 0, 0, -r,
  ]);
  const triVerts = new Uint32Array([
    0, 2, 4, 2, 1, 4, 1, 3, 4, 3, 0, 4,
    2, 0, 5, 1, 2, 5, 3, 1, 5, 0, 3, 5,
  ]);
  return { positions, triVerts };
}

function allFinite(a: Float32Array): boolean {
  for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i])) return false;
  return true;
}

describe('unwrapMesh dispatcher', () => {
  const { positions, triVerts } = gridPlane(5);

  it('returns 2 floats per vertex for every algorithm', () => {
    for (const algo of ['bfs', 'lscm', 'harmonic'] as const) {
      const { uvs } = unwrapMesh(positions, triVerts, algo);
      expect(uvs.length).toBe((positions.length / 3) * 2);
      expect(allFinite(uvs)).toBe(true);
    }
  });

  it('defaults to bfs', () => {
    const a = unwrapMesh(positions, triVerts);
    const b = unwrapMesh(positions, triVerts, 'bfs');
    expect(Array.from(a.uvs)).toEqual(Array.from(b.uvs));
  });

  it('produces different layouts for different algorithms', () => {
    const bfs = unwrapMesh(positions, triVerts, 'bfs').uvs;
    const lscm = unwrapMesh(positions, triVerts, 'lscm').uvs;
    expect(Array.from(bfs)).not.toEqual(Array.from(lscm));
  });
});

describe('lscmUnwrapMesh', () => {
  it('is near-isometric on a flat plane (low conformal distortion)', () => {
    const { positions, triVerts } = gridPlane(6);
    const { uvs } = lscmUnwrapMesh(positions, triVerts);

    // For each triangle edge, ratio of UV length to world length should be
    // roughly constant (a similarity transform). Measure relative spread.
    const ratios: number[] = [];
    for (let t = 0; t < triVerts.length / 3; t++) {
      for (let k = 0; k < 3; k++) {
        const a = triVerts[t * 3 + k], b = triVerts[t * 3 + (k + 1) % 3];
        const wl = Math.hypot(
          positions[a * 3] - positions[b * 3],
          positions[a * 3 + 1] - positions[b * 3 + 1],
          positions[a * 3 + 2] - positions[b * 3 + 2],
        );
        const ul = Math.hypot(uvs[a * 2] - uvs[b * 2], uvs[a * 2 + 1] - uvs[b * 2 + 1]);
        if (wl > 1e-6) ratios.push(ul / wl);
      }
    }
    const mean = ratios.reduce((s, x) => s + x, 0) / ratios.length;
    const variance = ratios.reduce((s, x) => s + (x - mean) ** 2, 0) / ratios.length;
    const cv = Math.sqrt(variance) / mean;   // coefficient of variation
    expect(cv).toBeLessThan(0.1);             // near-uniform scaling → conformal
  });

  it('is deterministic', () => {
    const { positions, triVerts } = gridPlane(5);
    const a = lscmUnwrapMesh(positions, triVerts).uvs;
    const b = lscmUnwrapMesh(positions, triVerts).uvs;
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it('handles a closed mesh without NaN', () => {
    const { positions, triVerts } = octahedron();
    const { uvs } = lscmUnwrapMesh(positions, triVerts);
    expect(allFinite(uvs)).toBe(true);
  });

  it('returns zeroed uvs for degenerate input', () => {
    const { uvs } = lscmUnwrapMesh(new Float32Array([0, 0, 0]), new Uint32Array([]));
    expect(uvs.length).toBe(2);
    expect(uvs[0]).toBe(0);
  });
});

describe('harmonicUnwrapMesh', () => {
  it('produces a monotonic latitude (V) field along the long axis', () => {
    // Plane stretched along X so the long axis = X; poles at x=0 and x=size.
    const { positions, triVerts } = gridPlane(6, 10);
    const { uvs } = harmonicUnwrapMesh(positions, triVerts);

    // Vertices near the low-x end should have smaller V than the high-x end.
    const n = positions.length / 3;
    let loV = 0, hiV = 0, loCount = 0, hiCount = 0;
    for (let i = 0; i < n; i++) {
      const x = positions[i * 3];
      if (x < 2) { loV += uvs[i * 2 + 1]; loCount++; }
      if (x > 8) { hiV += uvs[i * 2 + 1]; hiCount++; }
    }
    expect(loV / loCount).toBeLessThan(hiV / hiCount);
  });

  it('is deterministic and finite', () => {
    const { positions, triVerts } = gridPlane(5);
    const a = harmonicUnwrapMesh(positions, triVerts).uvs;
    const b = harmonicUnwrapMesh(positions, triVerts).uvs;
    expect(Array.from(a)).toEqual(Array.from(b));
    expect(allFinite(a)).toBe(true);
  });

  it('handles a closed mesh without NaN', () => {
    const { positions, triVerts } = octahedron();
    const { uvs } = harmonicUnwrapMesh(positions, triVerts);
    expect(allFinite(uvs)).toBe(true);
  });
});
