import { describe, it, expect } from 'vitest';
import { makeRng, mulberry32 } from '../../src/scene/prng';
import { sampleParams } from '../../src/scene/sampling';
import {
  generateSceneGraph,
  pointInPolygon,
  discsOverlap,
  polylineResample,
} from '../../src/scene/layout';
import { generateSceneCode, paramLiteral } from '../../src/scene/codegen';
import { buildScene, critiqueMetrics, type ComponentBound } from '../../src/scene/scene';
import type { AssetSpec, SceneSpec } from '../../src/scene/types';
import type { ParamSpec } from '../../src/geometry/params';

const TRUNK_PARAMS: ParamSpec[] = [
  { key: 'height', type: 'number', default: 10, min: 6, max: 16, label: 'height' },
  { key: 'radius', type: 'number', default: 2, min: 1, max: 3, label: 'radius' },
  { key: 'leafy', type: 'boolean', default: true, label: 'leafy' },
];

function treeAsset(): AssetSpec {
  return {
    id: 'tree',
    body: 'return Manifold.cylinder(p.height, p.radius, p.radius, 16);',
    params: TRUNK_PARAMS,
    footprintRadius: 3,
    baseHeight: 0,
  };
}

function gridSpec(overrides: Partial<SceneSpec> = {}): SceneSpec {
  return {
    seed: 42,
    assets: [treeAsset()],
    layout: {
      kind: 'grid',
      bounds: { min: [0, 0], max: [40, 40] },
      density: 0.01,
      spacing: 10,
      scaleRange: [0.8, 1.2],
      rotationJitter: 30,
      minClearance: 0,
    },
    ...overrides,
  };
}

describe('prng', () => {
  it('mulberry32 is deterministic and bounded in [0,1)', () => {
    const a = mulberry32(123);
    const b = mulberry32(123);
    for (let i = 0; i < 100; i++) {
      const x = a();
      expect(x).toBe(b());
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });

  it('different seeds diverge', () => {
    const a = mulberry32(1)();
    const b = mulberry32(2)();
    expect(a).not.toBe(b);
  });

  it('makeRng helpers respect bounds', () => {
    const rng = makeRng(7);
    for (let i = 0; i < 200; i++) {
      const r = rng.range(5, 9);
      expect(r).toBeGreaterThanOrEqual(5);
      expect(r).toBeLessThan(9);
      const n = rng.int(2, 4);
      expect(n).toBeGreaterThanOrEqual(2);
      expect(n).toBeLessThanOrEqual(4);
      expect(Number.isInteger(n)).toBe(true);
    }
  });

  it('weighted pick favors heavy weights and is deterministic', () => {
    const counts = { a: 0, b: 0 };
    const rng = makeRng(99);
    for (let i = 0; i < 1000; i++) {
      const v = rng.pick(['a', 'b'] as const, [9, 1]);
      counts[v]++;
    }
    expect(counts.a).toBeGreaterThan(counts.b * 3);
  });
});

describe('sampleParams', () => {
  it('produces valid in-range values and is deterministic for a seed', () => {
    const rng1 = makeRng(5);
    const rng2 = makeRng(5);
    const a = sampleParams(treeAsset(), rng1);
    const b = sampleParams(treeAsset(), rng2);
    expect(a).toEqual(b);
    expect(a.height).toBeGreaterThanOrEqual(6);
    expect(a.height).toBeLessThanOrEqual(16);
    expect(typeof a.leafy).toBe('boolean');
  });
});

describe('pointInPolygon', () => {
  const square: [number, number][] = [[0, 0], [10, 0], [10, 10], [0, 10]];
  it('truth table', () => {
    expect(pointInPolygon([5, 5], square)).toBe(true);
    expect(pointInPolygon([-1, 5], square)).toBe(false);
    expect(pointInPolygon([15, 5], square)).toBe(false);
    expect(pointInPolygon([5, 15], square)).toBe(false);
  });
});

describe('discsOverlap', () => {
  it('detects overlap and separation', () => {
    expect(discsOverlap([0, 0], 1, [1, 0], 1)).toBe(true);
    expect(discsOverlap([0, 0], 1, [3, 0], 1)).toBe(false);
    expect(discsOverlap([0, 0], 1, [2, 0], 1)).toBe(false); // exactly touching
  });
});

describe('polylineResample', () => {
  it('spaces samples along arc length', () => {
    const pts = polylineResample([[0, 0], [10, 0]], 2.5);
    expect(pts[0]).toEqual([0, 0]);
    // Consecutive samples ~2.5 apart.
    for (let i = 1; i < pts.length; i++) {
      const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      expect(d).toBeCloseTo(2.5, 5);
    }
  });
});

describe('generateSceneGraph', () => {
  it('is deterministic for the same spec and differs on seed change', () => {
    const g1 = generateSceneGraph(gridSpec());
    const g2 = generateSceneGraph(gridSpec());
    expect(g1).toEqual(g2);
    const g3 = generateSceneGraph(gridSpec({ seed: 43 }));
    expect(g3.instances).not.toEqual(g1.instances);
  });

  it('no placed pair overlaps by scaled footprint, for every layout kind', () => {
    const bounds = { min: [0, 0] as [number, number], max: [60, 60] as [number, number] };
    const kinds = [
      { kind: 'grid' as const, spacing: 9 },
      { kind: 'jittered-grid' as const, spacing: 9, jitter: 0.3 },
      { kind: 'poisson-disk' as const },
      { kind: 'clustered' as const, clusters: 3, clusterSpread: 8 },
      { kind: 'along-path' as const, path: [[5, 5], [55, 55]] as [number, number][], pathSpacing: 9 },
    ];
    for (const k of kinds) {
      const g = generateSceneGraph(gridSpec({
        layout: { bounds, density: 0.05, scaleRange: [1, 1], minClearance: 0, ...k },
      }));
      for (let i = 0; i < g.instances.length; i++) {
        for (let j = i + 1; j < g.instances.length; j++) {
          const a = g.instances[i];
          const b = g.instances[j];
          const ra = a.footprintRadius * a.scale;
          const rb = b.footprintRadius * b.scale;
          expect(discsOverlap(a.position, ra, b.position, rb)).toBe(false);
        }
      }
    }
  });

  it('caps candidate generation so a pathological density cannot hang', () => {
    // Tiny spacing over huge bounds would be ~1e12 grid cells without the cap.
    const start = Date.now();
    const g = generateSceneGraph(gridSpec({
      maxInstances: 50,
      layout: { kind: 'grid', bounds: { min: [0, 0], max: [1_000_000, 1_000_000] }, density: 1000, scaleRange: [1, 1], minClearance: 0 },
    }));
    expect(Date.now() - start).toBeLessThan(2000);
    expect(g.stats.requested).toBeLessThanOrEqual(50_000);
    expect(g.instances.length).toBeLessThanOrEqual(50);
  });

  it('caps a tiny-radius poisson grid over huge bounds', () => {
    const start = Date.now();
    const g = generateSceneGraph(gridSpec({
      assets: [{ ...treeAsset(), footprintRadius: 0.001 }],
      maxInstances: 50,
      layout: { kind: 'poisson-disk', bounds: { min: [0, 0], max: [100_000, 100_000] }, density: 1, scaleRange: [1, 1], minClearance: 0 },
    }));
    expect(Date.now() - start).toBeLessThan(2000);
    expect(g.instances.length).toBeLessThanOrEqual(50);
  });

  it('hard-caps placed instances regardless of requested maxInstances', () => {
    // Small footprint + spacing 1 => candidates don't overlap, so placement is
    // bounded only by the hard cap, not by overlap rejection.
    const g = generateSceneGraph(gridSpec({
      assets: [{ ...treeAsset(), footprintRadius: 0.1 }],
      maxInstances: 100000,
      layout: { kind: 'grid', bounds: { min: [0, 0], max: [10000, 10000] }, density: 0.01, spacing: 1, scaleRange: [1, 1], minClearance: 0 },
    }));
    expect(g.instances.length).toBe(5000);
  });

  it('grid count matches a regular lattice', () => {
    const g = generateSceneGraph(gridSpec());
    // 40x40 bounds, spacing 10 => 4x4 = 16 candidate cells. Footprint 3 with
    // spacing 10 leaves no overlap, so all should place.
    expect(g.stats.requested).toBe(16);
    expect(g.stats.placed).toBe(16);
  });

  it('poisson respects the minimum radius', () => {
    const spec = gridSpec({
      layout: { kind: 'poisson-disk', bounds: { min: [0, 0], max: [80, 80] }, density: 0.1, scaleRange: [1, 1], minClearance: 0 },
    });
    const g = generateSceneGraph(spec);
    const radius = 2 * treeAsset().footprintRadius; // 6
    for (let i = 0; i < g.instances.length; i++) {
      for (let j = i + 1; j < g.instances.length; j++) {
        const d = Math.hypot(
          g.instances[i].position[0] - g.instances[j].position[0],
          g.instances[i].position[1] - g.instances[j].position[1],
        );
        // Poisson guarantees >= sampling radius; overlap rejection only tightens.
        expect(d).toBeGreaterThanOrEqual(radius - 1e-6);
      }
    }
  });

  it('clustered points concentrate near cluster centers', () => {
    const spec = gridSpec({
      layout: { kind: 'clustered', bounds: { min: [0, 0], max: [100, 100] }, density: 0.02, clusters: 2, clusterSpread: 3, scaleRange: [1, 1], minClearance: 0 },
    });
    const g = generateSceneGraph(spec);
    expect(g.instances.length).toBeGreaterThan(1);
    // Tight spread => instances cluster; the mean pairwise spread should be
    // much smaller than the bounds diagonal.
    const diag = Math.hypot(100, 100);
    // At least one pair is far closer than the diagonal (same cluster).
    let minD = Infinity;
    for (let i = 0; i < g.instances.length; i++) {
      for (let j = i + 1; j < g.instances.length; j++) {
        minD = Math.min(minD, Math.hypot(
          g.instances[i].position[0] - g.instances[j].position[0],
          g.instances[i].position[1] - g.instances[j].position[1],
        ));
      }
    }
    expect(minD).toBeLessThan(diag / 2);
  });

  it('along-path instances stay near the path', () => {
    const spec = gridSpec({
      assets: [{ ...treeAsset(), footprintRadius: 0.5 }],
      layout: { kind: 'along-path', bounds: { min: [0, 0], max: [50, 10] }, density: 0.01, path: [[0, 5], [50, 5]], pathSpacing: 5, scaleRange: [1, 1], minClearance: 0 },
    });
    const g = generateSceneGraph(spec);
    expect(g.instances.length).toBeGreaterThan(1);
    for (const inst of g.instances) {
      expect(inst.position[1]).toBeCloseTo(5, 5);
    }
  });

  it('zone polygon clips placement', () => {
    const spec = gridSpec({
      layout: {
        kind: 'grid',
        bounds: { min: [0, 0], max: [40, 40] },
        density: 0.01,
        spacing: 5,
        scaleRange: [1, 1],
        minClearance: 0,
        zones: [{ polygon: [[0, 0], [20, 0], [20, 20], [0, 20]] }],
      },
    });
    const g = generateSceneGraph(spec);
    expect(g.instances.length).toBeGreaterThan(0);
    for (const inst of g.instances) {
      expect(inst.position[0]).toBeLessThanOrEqual(20);
      expect(inst.position[1]).toBeLessThanOrEqual(20);
    }
  });

  it('honors maxInstances cap', () => {
    const spec = gridSpec({
      maxInstances: 5,
      layout: { kind: 'grid', bounds: { min: [0, 0], max: [100, 100] }, density: 0.01, spacing: 5, scaleRange: [1, 1], minClearance: 0 },
    });
    const g = generateSceneGraph(spec);
    expect(g.instances.length).toBe(5);
  });
});

describe('generateSceneCode', () => {
  it('emits one builder per asset, identifier-safe', () => {
    const spec = gridSpec();
    const { graph, code } = buildScene(spec);
    expect((code.match(/function buildAsset_tree\(p\)/g) || []).length).toBe(1);
    expect(code).toContain('const { Manifold } = api;');
    void graph;
  });

  it('throws on a hostile asset id', () => {
    const spec = gridSpec({ assets: [{ ...treeAsset(), id: 'tree); evil()' }] });
    expect(() => buildScene(spec)).toThrow(/identifier-safe/);
  });

  it('bake cache emits one baked_* per unique (asset,params) combo', () => {
    // Force a single param combo by using booleans/ints with no range variation.
    const fixed: AssetSpec = {
      id: 'rock',
      body: 'return Manifold.sphere(p.r, 12);',
      params: [{ key: 'r', type: 'number', default: 2, min: 2, max: 2, label: 'r' }],
      footprintRadius: 1,
    };
    const spec = gridSpec({ assets: [fixed], layout: { kind: 'grid', bounds: { min: [0, 0], max: [30, 30] }, density: 0.01, spacing: 10, scaleRange: [1, 1], minClearance: 0 } });
    const { code } = buildScene(spec);
    const bakes = (code.match(/const baked_\d+ =/g) || []).length;
    expect(bakes).toBe(1);
  });

  it('final line is a compose and rotation is in degrees', () => {
    const { code } = buildScene(gridSpec());
    const lines = code.trim().split('\n');
    expect(lines[lines.length - 1]).toMatch(/^return Manifold\.compose\(\[/);
    // rotationJitter 30 => some .rotate([0, 0, <deg in -30..30>])
    const m = code.match(/\.rotate\(\[0, 0, (-?[\d.]+)\]\)/);
    if (m) {
      const deg = Number(m[1]);
      expect(Math.abs(deg)).toBeLessThanOrEqual(30 + 1e-6);
    }
  });

  it('ground only emitted when enabled', () => {
    const without = buildScene(gridSpec()).code;
    expect(without).not.toContain('const ground =');
    const withGround = buildScene(gridSpec({ ground: { enabled: true, thickness: 2, margin: 5 } })).code;
    expect(withGround).toContain('const ground =');
    expect(withGround).toMatch(/Manifold\.compose\(\[.*ground\]\)/s);
  });

  it('contains no NaN/Infinity', () => {
    const { code } = buildScene(gridSpec({ ground: { enabled: true } }));
    expect(code).not.toMatch(/NaN|Infinity/);
  });

  it('paramLiteral serializes types correctly', () => {
    expect(paramLiteral(3.14159265)).toBe('3.14159');
    expect(paramLiteral(true)).toBe('true');
    expect(paramLiteral('flat')).toBe('"flat"');
    expect(() => paramLiteral(Infinity)).toThrow();
  });

  it('small-scene snapshot is stable', () => {
    const spec: SceneSpec = {
      seed: 1,
      assets: [{ id: 'box', body: 'return Manifold.cube([p.s, p.s, p.s], true);', params: [{ key: 's', type: 'number', default: 2, min: 2, max: 2, label: 's' }], footprintRadius: 1.5 }],
      layout: { kind: 'grid', bounds: { min: [0, 0], max: [10, 10] }, density: 0.01, spacing: 5, scaleRange: [1, 1], minClearance: 0 },
    };
    const { code } = buildScene(spec);
    expect(code).toMatchSnapshot();
  });
});

describe('critiqueMetrics', () => {
  it('hand-computed metrics', () => {
    const graph = {
      seed: 1,
      instances: [
        { assetId: 'a', paramValues: {}, position: [0, 0] as [number, number], rotationZ: 0, scale: 1, footprintRadius: 2 },
        { assetId: 'a', paramValues: {}, position: [1, 0] as [number, number], rotationZ: 0, scale: 1, footprintRadius: 2 },
        { assetId: 'a', paramValues: {}, position: [10, 10] as [number, number], rotationZ: 0, scale: 2, footprintRadius: 2 },
      ],
      stats: { requested: 3, placed: 3, rejectedOverlap: 0, bounds: { min: [0, 0] as [number, number], max: [10, 10] as [number, number] } },
    };
    const components: ComponentBound[] = [
      { index: 0, volume: 1, bbox: { min: [0, 0, 0], max: [1, 1, 5], size: [1, 1, 5], center: [0.5, 0.5, 2.5] } },
      { index: 1, volume: 1, bbox: { min: [0, 0, 2], max: [1, 1, 4], size: [1, 1, 2], center: [0.5, 0.5, 3] } }, // floating
      { index: 2, volume: 1, bbox: { min: [0, 0, -1], max: [1, 1, 3], size: [1, 1, 4], center: [0.5, 0.5, 1] } }, // clipping
    ];
    const m = critiqueMetrics({ graph, geometry: { componentCount: 3 }, components });
    expect(m.instanceCount).toBe(3);
    expect(m.componentCount).toBe(3);
    // Footprint radii = footprintRadius*scale = [2, 2, 4]. Discs at (0,0) r2 and
    // (1,0) r2 overlap (dist 1 < 4); (10,10) r4 is isolated (dist ~14 > 6).
    expect(m.overlapCount).toBe(1);
    expect(m.floatingCount).toBe(1);
    expect(m.clippingCount).toBe(1);
    // scales [1,1,2]: mean 4/3, variance = ((1-4/3)^2*2 + (2-4/3)^2)/3
    expect(m.scaleVariance).toBeCloseTo(((1 / 3) ** 2 * 2 + (2 / 3) ** 2) / 3, 6);
    // Coverage = sum(pi*r^2) / boundsArea = pi*(4+4+16)/100 = 24pi/100.
    expect(m.footprintCoverage).toBeCloseTo((24 * Math.PI) / 100, 6);
  });

  it('handles null components gracefully', () => {
    const graph = generateSceneGraph(gridSpec());
    const m = critiqueMetrics({ graph, geometry: null, components: null });
    expect(m.instanceCount).toBe(graph.instances.length);
    expect(m.floatingCount).toBe(0);
    expect(m.clippingCount).toBe(0);
  });
});
