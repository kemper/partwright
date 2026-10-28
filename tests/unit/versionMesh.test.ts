import { describe, it, expect } from 'vitest';
import { isMeshBackedVersion, parseSavedMesh, toSavedMesh } from '../../src/storage/versionMesh';

const mesh = () => ({
  vertProperties: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
  triVerts: new Uint32Array([0, 1, 2]),
  numVert: 3,
  numTri: 1,
  numProp: 3,
});

describe('isMeshBackedVersion', () => {
  it('is false for a plain code-built model', () => {
    expect(isMeshBackedVersion({ code: 'return api.Manifold.cube(1);', language: 'manifold-js' })).toBe(false);
  });

  it('is true when the version carries imported (or baked) meshes', () => {
    expect(isMeshBackedVersion({ code: 'return Manifold.ofMesh(api.imports[0]);', importedMeshes: [{}] })).toBe(true);
    expect(isMeshBackedVersion({ code: 'x', importedMeshes: [] })).toBe(false);
  });

  it('is true when an in-code surface texture holds the finished mesh', () => {
    expect(isMeshBackedVersion({ code: 'x', surfaceTexture: { key: 'k', mesh: mesh() } })).toBe(true);
  });

  it('is true for a baked voxel grid, but not for procedural voxel code', () => {
    expect(isMeshBackedVersion({ code: 'return voxels.decode("abc");', language: 'voxel' })).toBe(true);
    expect(isMeshBackedVersion({ code: 'const v = api.voxels(); v.sphere([0,0,0], 4); return v;', language: 'voxel' })).toBe(false);
  });
});

describe('parseSavedMesh / toSavedMesh', () => {
  it('keeps the mesh fields and drops engine-only ones', () => {
    const withExtras = { ...mesh(), runIndex: new Uint32Array([0, 3]), triColors: new Uint8Array([255, 0, 0]) };
    const saved = toSavedMesh(withExtras);
    expect(Object.keys(saved).sort()).toEqual(['numProp', 'numTri', 'numVert', 'triColors', 'triVerts', 'vertProperties']);
    expect(parseSavedMesh(saved)).toEqual(saved);
  });

  it('rejects malformed meshes', () => {
    expect(parseSavedMesh(null)).toBeNull();
    expect(parseSavedMesh({ ...mesh(), vertProperties: [0, 0, 0] })).toBeNull();
    expect(parseSavedMesh({ ...mesh(), numTri: 5 })).toBeNull();
    expect(parseSavedMesh({ ...mesh(), numProp: 2 })).toBeNull();
  });

  it('rejects triangles that reference missing vertices', () => {
    expect(parseSavedMesh({ ...mesh(), triVerts: new Uint32Array([0, 1, 3]) })).toBeNull();
  });

  it('compacts extra vertex properties to x, y, z', () => {
    const wide = { ...mesh(), numProp: 4, vertProperties: new Float32Array([0, 0, 0, 9, 1, 0, 0, 9, 0, 1, 0, 9]) };
    const saved = toSavedMesh(wide);
    expect(saved.numProp).toBe(3);
    expect(Array.from(saved.vertProperties)).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  });

  it('drops a colour buffer that is too short', () => {
    expect(parseSavedMesh({ ...mesh(), triColors: new Uint8Array(1) })).not.toHaveProperty('triColors');
  });
});
