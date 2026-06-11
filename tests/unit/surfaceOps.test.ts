import { describe, it, expect, beforeEach } from 'vitest';
import type { MeshData } from '../../src/geometry/types';
import { SURFACE_OP_FIELDS, SURFACE_OP_IDS, isSurfaceOpId, parseSurfaceOpts } from '../../src/surface/surfaceOpSpec';
import { surfaceCacheStatus, computeChain, surfaceChainKey, seedSurfaceCache, meshContentKey, __clearSurfaceCache, type SurfaceOp } from '../../src/surface/surfaceOps';

/** Axis-aligned cube from [0,s]^3 as an 8-vertex / 12-triangle MeshData. */
function cube(s = 10): MeshData {
  const vertProperties = new Float32Array([
    0, 0, 0, s, 0, 0, s, s, 0, 0, s, 0,
    0, 0, s, s, 0, s, s, s, s, 0, s, s,
  ]);
  const triVerts = new Uint32Array([
    0, 2, 1, 0, 3, 2,
    4, 5, 6, 4, 6, 7,
    0, 1, 5, 0, 5, 4,
    2, 3, 7, 2, 7, 6,
    1, 2, 6, 1, 6, 5,
    0, 4, 7, 0, 7, 3,
  ]);
  return { vertProperties, triVerts, numVert: 8, numTri: 12, numProp: 3 };
}

describe('surfaceOpSpec', () => {
  it('every op id has a non-empty field allow-list', () => {
    for (const id of SURFACE_OP_IDS) {
      expect(SURFACE_OP_FIELDS[id].length).toBeGreaterThan(0);
    }
  });

  it('isSurfaceOpId accepts known ids and rejects others', () => {
    expect(isSurfaceOpId('knit')).toBe(true);
    expect(isSurfaceOpId('smooth')).toBe(true);
    expect(isSurfaceOpId('voxelize')).toBe(false); // engine-changing → not a code op
    expect(isSurfaceOpId('nope')).toBe(false);
    expect(isSurfaceOpId(42)).toBe(false);
  });
});

describe('parseSurfaceOpts (shared scalar + scope validator)', () => {
  it('splits scalar params from a label scope', () => {
    const out = parseSurfaceOpts('knurl', { pitch: 2, label: 'grip' });
    expect(out.params).toEqual({ pitch: 2 });
    expect(out.scope).toEqual({ kind: 'label', label: 'grip' });
  });

  it('parses a region scope into a normalized point + radius', () => {
    const out = parseSurfaceOpts('fuzzy', { amplitude: 1, region: { point: [1, 2, 3], radius: 5 } });
    expect(out.params).toEqual({ amplitude: 1 });
    expect(out.scope).toEqual({ kind: 'point', point: [1, 2, 3], radius: 5 });
  });

  it('returns no scope for plain params', () => {
    expect(parseSurfaceOpts('smooth', { iterations: 3 }).scope).toBeUndefined();
  });

  it('rejects passing both label and region', () => {
    expect(() => parseSurfaceOpts('fuzzy', { label: 'a', region: { point: [0, 0, 0], radius: 1 } })).toThrow(/not both/);
  });

  it('rejects an unknown option (mentioning the scope keys)', () => {
    expect(() => parseSurfaceOpts('fuzzy', { nope: 1 })).toThrow(/nope/);
    expect(() => parseSurfaceOpts('fuzzy', { nope: 1 })).toThrow(/label, region/);
  });

  it('rejects a malformed region (bad point, bad radius, unknown key)', () => {
    expect(() => parseSurfaceOpts('fuzzy', { region: { point: [0, 0], radius: 5 } })).toThrow(/point/);
    expect(() => parseSurfaceOpts('fuzzy', { region: { point: [0, 0, 0], radius: -1 } })).toThrow(/radius/);
    expect(() => parseSurfaceOpts('fuzzy', { region: { point: [0, 0, 0], radius: 5, nope: 1 } })).toThrow(/nope/);
  });

  it('rejects an empty label', () => {
    expect(() => parseSurfaceOpts('fuzzy', { label: '' })).toThrow(/non-empty string/);
  });
});

describe('surfaceOps memoization', () => {
  beforeEach(() => __clearSurfaceCache());

  const smooth: SurfaceOp = { id: 'smooth', params: { iterations: 1, subdivide: false } };

  it('an empty chain is trivially cached with no mesh', () => {
    const s = surfaceCacheStatus('k', []);
    expect(s.cached).toBe(true);
    expect(s.mesh).toBeNull();
  });

  it('misses before compute, hits the exact result after computeChain', async () => {
    expect(surfaceCacheStatus('base1', [smooth]).cached).toBe(false);

    const out = await computeChain(cube(), 'base1', [smooth]);
    expect(out.numTri).toBeGreaterThan(0);

    const after = surfaceCacheStatus('base1', [smooth]);
    expect(after.cached).toBe(true);
    expect(after.mesh).toBe(out); // same reference — served from cache, not recomputed
  });

  it('a different base identity (code/params change) re-stales the chain', async () => {
    await computeChain(cube(), 'base1', [smooth]);
    expect(surfaceCacheStatus('base1', [smooth]).cached).toBe(true);
    // Same ops, different baseKey → cache miss (geometry it sits on changed).
    expect(surfaceCacheStatus('base2', [smooth]).cached).toBe(false);
  });

  it('changing a later op param invalidates the full chain but reuses the prefix', async () => {
    const a: SurfaceOp = { id: 'smooth', params: { iterations: 1, subdivide: false } };
    const b1: SurfaceOp = { id: 'smooth', params: { iterations: 2, subdivide: false } };
    const b2: SurfaceOp = { id: 'smooth', params: { iterations: 3, subdivide: false } };

    await computeChain(cube(), 'k', [a, b1]);
    // Editing the second op leaves the prefix [a] cached but the full chain stale.
    expect(surfaceCacheStatus('k', [a, b2]).cached).toBe(false);
    expect(surfaceCacheStatus('k', [a]).cached).toBe(true); // prefix preserved

    // Recomputing the edited chain succeeds and becomes a hit.
    await computeChain(cube(), 'k', [a, b2]);
    expect(surfaceCacheStatus('k', [a, b2]).cached).toBe(true);
  });

  it('reports progress across the uncached tail', async () => {
    const fractions: number[] = [];
    await computeChain(cube(), 'k', [smooth, { id: 'smooth', params: { iterations: 2, subdivide: false } }], f => fractions.push(f));
    expect(fractions.length).toBe(2);
    expect(fractions[fractions.length - 1]).toBe(1);
  });
});

// Phase 3 — persisting computed textures on saved versions. A version stores
// `{ key: surfaceChainKey(...), mesh }`; loading it seeds the memo cache so
// the load's force-apply hits instead of recomputing.
describe('surface texture persistence (seed + chain key)', () => {
  beforeEach(() => __clearSurfaceCache());

  const smooth: SurfaceOp = { id: 'smooth', params: { iterations: 1, subdivide: false } };

  it('surfaceChainKey is the full-chain memo key computeChain caches under', async () => {
    const out = await computeChain(cube(), 'base', [smooth]);
    __clearSurfaceCache();

    // Seeding a fresh (e.g. post-reload) cache under the persisted key makes
    // the exact same base + chain a hit — served by reference, no recompute.
    seedSurfaceCache(surfaceChainKey('base', [smooth])!, out);
    const status = surfaceCacheStatus('base', [smooth]);
    expect(status.cached).toBe(true);
    expect(status.mesh).toBe(out);
  });

  it('computeChain resumes from a seeded full chain without re-applying', async () => {
    const persisted = cube(7); // stand-in "textured" mesh persisted on a version
    seedSurfaceCache(surfaceChainKey('base', [smooth])!, persisted);
    // The deepest cached prefix is the whole chain, so computeChain returns the
    // seeded mesh itself — this is the "pinned at save time" property: the
    // saved result is reused even if the modifier math has since changed.
    const out = await computeChain(cube(), 'base', [smooth]);
    expect(out).toBe(persisted);
  });

  it('a stale key (changed code/params/imports) is simply never read', async () => {
    seedSurfaceCache(surfaceChainKey('saved-base', [smooth])!, cube(7));
    expect(surfaceCacheStatus('current-base', [smooth]).cached).toBe(false);
  });

  it('surfaceChainKey is null for an empty chain', () => {
    expect(surfaceChainKey('base', [])).toBeNull();
  });
});

describe('surface op scoping', () => {
  beforeEach(() => __clearSurfaceCache());

  it('a scoped op keys apart from the same op unscoped', () => {
    const plain: SurfaceOp = { id: 'smooth', params: { iterations: 1 } };
    const scoped: SurfaceOp = { id: 'smooth', params: { iterations: 1 }, scope: { kind: 'label', label: 'grip' } };
    expect(surfaceChainKey('b', [plain])).not.toBe(surfaceChainKey('b', [scoped]));
    // Two different scopes also key apart.
    const otherLabel: SurfaceOp = { id: 'smooth', params: { iterations: 1 }, scope: { kind: 'label', label: 'body' } };
    expect(surfaceChainKey('b', [scoped])).not.toBe(surfaceChainKey('b', [otherLabel]));
  });

  it('a point-scoped op textures a different (smaller) region than unscoped', async () => {
    const fuzzy: SurfaceOp = { id: 'fuzzy', params: { amplitude: 0.6 } };
    const baseKey = meshContentKey(cube(10));

    const whole = await computeChain(cube(10), baseKey, [fuzzy]);
    __clearSurfaceCache();
    // Scope to one corner with a small radius — only nearby triangles texture.
    const scoped = await computeChain(
      cube(10), baseKey, [{ ...fuzzy, scope: { kind: 'point', point: [0, 0, 0], radius: 4 } }],
      undefined,
      [{ seeds: Float32Array.of(0, 0, 0), radius: 4 }],
    );

    // Both displaced the surface (output differs from a plain re-mesh), and the
    // scoped output is a different mesh than the whole-model one.
    expect(meshContentKey(scoped)).not.toBe(meshContentKey(whole));
    // The scoped patch subdivides only the selected region, so it stays smaller
    // than texturing the entire skin.
    expect(scoped.numTri).toBeLessThan(whole.numTri);
  });

  it('an unresolved scope (empty seeds) leaves the mesh untextured', async () => {
    const fuzzy: SurfaceOp = { id: 'fuzzy', params: { amplitude: 0.6 }, scope: { kind: 'label', label: 'missing' } };
    // Empty seeds (label not found) → the op selects nothing → mesh unchanged.
    const out = await computeChain(cube(10), 'b', [fuzzy], undefined, [{ seeds: new Float32Array(0), radius: 1 }]);
    expect(out.numTri).toBe(cube(10).numTri);
  });
});

// The memo base identity is the BASE MESH CONTENT — not the source text — so
// whitespace/comment/refactor edits that produce identical geometry keep every
// cached texture, and any real geometry change re-keys the chain.
describe('meshContentKey', () => {
  it('is identical for byte-identical meshes (separately allocated)', () => {
    expect(meshContentKey(cube(10))).toBe(meshContentKey(cube(10)));
  });

  it('changes when the geometry changes', () => {
    expect(meshContentKey(cube(10))).not.toBe(meshContentKey(cube(11)));
    const reindexed = cube(10);
    reindexed.triVerts = new Uint32Array(reindexed.triVerts); // copy…
    reindexed.triVerts[0] = 3; // …then flip one index
    expect(meshContentKey(cube(10))).not.toBe(meshContentKey(reindexed));
  });

  it('keys the memo cache: an identical re-run hits without recompute', async () => {
    __clearSurfaceCache();
    const smooth: SurfaceOp = { id: 'smooth', params: { iterations: 1, subdivide: false } };
    const out = await computeChain(cube(), meshContentKey(cube()), [smooth]);
    // A "different run" of byte-identical geometry (e.g. after a whitespace
    // edit re-ran the code) computes the same key and hits the cache.
    const again = surfaceCacheStatus(meshContentKey(cube()), [smooth]);
    expect(again.cached).toBe(true);
    expect(again.mesh).toBe(out);
  });
});
