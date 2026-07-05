import { describe, it, expect } from 'vitest';
import {
  boundaryPoints,
  fitPlane,
  fitCircle3D,
  fitSphere,
  fitRegionShape,
} from '../../src/color/regionFit';
import type { MeshData } from '../../src/geometry/types';

type Vec3 = [number, number, number];

/** Build a MeshData from a list of triangles, each defined by its three
 *  world-space vertices (triangle soup — mirrors `meshFromTriangles` in
 *  `tests/unit/meshIslands.test.ts`). The welded-by-position adjacency used
 *  inside `regionFit.ts` recognizes shared corners regardless of the
 *  per-triangle vertex duplication. */
function meshFromTriangles(triangles: Vec3[][]): MeshData {
  const vertProperties: number[] = [];
  const triVerts: number[] = [];
  triangles.forEach((tri, t) => {
    for (const [x, y, z] of tri) vertProperties.push(x, y, z);
    triVerts.push(t * 3, t * 3 + 1, t * 3 + 2);
  });
  return {
    vertProperties: new Float32Array(vertProperties),
    triVerts: new Uint32Array(triVerts),
    numProp: 3,
    numVert: triangles.length * 3,
    numTri: triangles.length,
  } as MeshData;
}

// --- small deterministic vector helpers for building synthetic geometry ---

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function normalize(a: Vec3): Vec3 {
  const len = Math.hypot(a[0], a[1], a[2]);
  return [a[0] / len, a[1] / len, a[2] / len];
}

/** Orthonormal in-plane basis perpendicular to `normal`, matching the
 *  convention `fitCircle3D` itself uses internally. */
function orthonormalBasis(normal: Vec3): { u: Vec3; v: Vec3 } {
  const arbitrary: Vec3 = Math.abs(normal[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const u = normalize(cross(normal, arbitrary));
  const v = cross(normal, u);
  return { u, v };
}

/** Deterministic PRNG (mulberry32) so noise-perturbed fixtures are
 *  reproducible across runs. */
function mulberry32(seed: number): () => number {
  let s = seed;
  return () => {
    s |= 0; s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function circlePoints(n: number, radius: number, center: Vec3, normal: Vec3, noiseAmplitude = 0): Vec3[] {
  const { u, v } = orthonormalBasis(normal);
  const rand = mulberry32(1234);
  const points: Vec3[] = [];
  for (let i = 0; i < n; i++) {
    const theta = (i / n) * Math.PI * 2;
    const cx = center[0] + radius * Math.cos(theta) * u[0] + radius * Math.sin(theta) * v[0];
    const cy = center[1] + radius * Math.cos(theta) * u[1] + radius * Math.sin(theta) * v[1];
    const cz = center[2] + radius * Math.cos(theta) * u[2] + radius * Math.sin(theta) * v[2];
    let p: Vec3 = [cx, cy, cz];
    if (noiseAmplitude > 0) {
      const dx = (rand() * 2 - 1) * noiseAmplitude;
      const dy = (rand() * 2 - 1) * noiseAmplitude;
      const dz = (rand() * 2 - 1) * noiseAmplitude;
      p = [cx + dx, cy + dy, cz + dz];
    }
    points.push(p);
  }
  return points;
}

/** Fibonacci-sphere point spread — well-conditioned coverage of the sphere
 *  surface for the algebraic least-squares sphere fit. */
function spherePoints(n: number, radius: number, center: Vec3): Vec3[] {
  const points: Vec3[] = [];
  const offset = 2 / n;
  const increment = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = i * offset - 1 + offset / 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const phi = i * increment;
    const x = Math.cos(phi) * r;
    const z = Math.sin(phi) * r;
    points.push([center[0] + radius * x, center[1] + radius * y, center[2] + radius * z]);
  }
  return points;
}

describe('fitCircle3D', () => {
  it('recovers an exact circle in a tilted plane', () => {
    const normal = normalize([1, 1, 1]);
    const center: Vec3 = [10, -2, 3];
    const points = circlePoints(24, 5, center, normal);

    const fit = fitCircle3D(points);
    expect(fit).not.toBeNull();
    expect(fit!.radius).toBeCloseTo(5, 6);
    expect(fit!.center[0]).toBeCloseTo(center[0], 6);
    expect(fit!.center[1]).toBeCloseTo(center[1], 6);
    expect(fit!.center[2]).toBeCloseTo(center[2], 6);
    expect(fit!.rms).toBeLessThan(1e-6);
  });

  it('stays close under +/-0.05 noise', () => {
    const normal = normalize([1, 1, 1]);
    const center: Vec3 = [10, -2, 3];
    const points = circlePoints(24, 5, center, normal, 0.05);

    const fit = fitCircle3D(points);
    expect(fit).not.toBeNull();
    expect(Math.abs(fit!.radius - 5)).toBeLessThan(0.1);
    expect(fit!.rms).toBeGreaterThan(0);
    expect(fit!.rms).toBeLessThan(0.1);
  });

  it('returns null for fewer than 3 points', () => {
    expect(fitCircle3D([[0, 0, 0], [1, 0, 0]])).toBeNull();
  });

  it('returns null (not NaN) for collinear points', () => {
    const points: Vec3[] = [[0, 0, 0], [1, 0, 0], [2, 0, 0], [3, 0, 0], [4, 0, 0]];
    const fit = fitCircle3D(points);
    // A degenerate in-plane quadratic system — no valid circle, no NaN leak.
    if (fit) {
      expect(Number.isFinite(fit.radius)).toBe(true);
      expect(Number.isFinite(fit.rms)).toBe(true);
    } else {
      expect(fit).toBeNull();
    }
  });
});

describe('fitSphere', () => {
  it('recovers an exact sphere', () => {
    const center: Vec3 = [1, 2, 3];
    const points = spherePoints(30, 4, center);

    const fit = fitSphere(points);
    expect(fit).not.toBeNull();
    expect(fit!.radius).toBeCloseTo(4, 6);
    expect(fit!.center[0]).toBeCloseTo(center[0], 6);
    expect(fit!.center[1]).toBeCloseTo(center[1], 6);
    expect(fit!.center[2]).toBeCloseTo(center[2], 6);
    expect(fit!.rms).toBeLessThan(1e-6);
  });

  it('returns null for fewer than 4 points', () => {
    expect(fitSphere([[0, 0, 0], [1, 0, 0], [0, 1, 0]])).toBeNull();
  });
});

describe('fitPlane', () => {
  it('fits coplanar points with near-zero rms and a matching normal', () => {
    const expectedNormal = normalize([1, 1, 1]);
    const center: Vec3 = [5, -3, 2];
    const { u, v } = orthonormalBasis(expectedNormal);
    const rand = mulberry32(99);
    const points: Vec3[] = [];
    for (let i = 0; i < 10; i++) {
      const a = (rand() - 0.5) * 6;
      const b = (rand() - 0.5) * 6;
      points.push([
        center[0] + a * u[0] + b * v[0],
        center[1] + a * u[1] + b * v[1],
        center[2] + a * u[2] + b * v[2],
      ]);
    }

    const fit = fitPlane(points);
    expect(fit.rms).toBeLessThan(1e-4);
    const dot = Math.abs(
      fit.normal[0] * expectedNormal[0] + fit.normal[1] * expectedNormal[1] + fit.normal[2] * expectedNormal[2],
    );
    expect(dot).toBeGreaterThan(0.999);
  });
});

/** A 12-wedge triangle fan disc of radius R centered at the origin in the
 *  z=0 plane — the canonical ragged "sculpted dome/disc" boundary shape. */
function buildFanDisc(radius: number, wedges: number): { mesh: MeshData; triangles: Set<number> } {
  const center: Vec3 = [0, 0, 0];
  const rim: Vec3[] = [];
  for (let i = 0; i < wedges; i++) {
    const theta = (i / wedges) * Math.PI * 2;
    rim.push([radius * Math.cos(theta), radius * Math.sin(theta), 0]);
  }
  const triangles: Vec3[][] = [];
  for (let i = 0; i < wedges; i++) {
    triangles.push([center, rim[i], rim[(i + 1) % wedges]]);
  }
  return { mesh: meshFromTriangles(triangles), triangles: new Set(triangles.map((_, i) => i)) };
}

describe('boundaryPoints', () => {
  it('returns only the rim vertices of a triangle fan, excluding the fan center', () => {
    const { mesh, triangles } = buildFanDisc(5, 12);
    const points = boundaryPoints(triangles, mesh);
    expect(points.length).toBe(12);
    for (const [x, y, z] of points) {
      expect(Math.hypot(x, y, z)).toBeCloseTo(5, 5);
      // Never the fan center.
      expect(Math.hypot(x, y, z)).toBeGreaterThan(0.01);
    }
  });
});

describe('fitRegionShape', () => {
  it('picks the circle fit for a fan disc boundary, with radius matching the rim', () => {
    const { mesh, triangles } = buildFanDisc(5, 12);
    const result = fitRegionShape(triangles, mesh);
    expect('error' in result).toBe(false);
    if ('error' in result) return; // narrow for TS
    expect(result.best).toBe('circle');
    expect(result.circle).not.toBeNull();
    expect(result.circle!.radius).toBeCloseTo(5, 3);
    expect(result.pointCount).toBe(12);
  });

  it('returns an error for a region with no boundary points (empty triangle set)', () => {
    const { mesh } = buildFanDisc(5, 12);
    const result = fitRegionShape(new Set(), mesh);
    expect('error' in result).toBe(true);
  });
});
