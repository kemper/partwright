import { describe, expect, it } from 'vitest';
import { packStoredArrays, unpackStoredArrays } from '../../src/storage/storedArrays';

function sampleVersion() {
  const vertProperties = new Float32Array(3000).map((_, i) => i * 0.5);
  const triVerts = new Uint32Array(3000).map((_, i) => i);
  const triPart = new Int32Array(1000).map((_, i) => (i % 3) - 1);
  return {
    id: 'v1',
    code: 'return x;',
    thumbnail: new Blob(['png']),
    geometryData: { volume: 1, colorRegions: [{ triangles: [1, 2, 3] }] },
    importedMeshes: [{
      id: 'm', filename: 'a.stl', format: 'stl',
      vertProperties, triVerts, numVert: 1000, numTri: 1000, numProp: 3,
      parts: { names: ['a', 'b'], colors: [null, '#ff0000'], triPart },
    }],
    small: new Uint8Array([1, 2, 3]),
  };
}

describe('storedArrays', () => {
  it('replaces big typed arrays with Blobs and restores them exactly', async () => {
    const v = sampleVersion();
    const packed = packStoredArrays(v, 1024);
    const m = packed.importedMeshes[0] as unknown as Record<string, unknown>;
    expect(m.vertProperties).not.toBeInstanceOf(Float32Array);
    expect((m.vertProperties as { blob: Blob }).blob).toBeInstanceOf(Blob);
    expect((m.parts as Record<string, unknown>).triPart).not.toBeInstanceOf(Int32Array);
    // Below the threshold, other values and the existing Blob are untouched.
    expect(packed.small).toBe(v.small);
    expect(packed.thumbnail).toBe(v.thumbnail);
    expect(packed.geometryData).toBe(v.geometryData);

    const restored = await unpackStoredArrays(packed);
    const r = restored.importedMeshes[0];
    expect(r.vertProperties).toBeInstanceOf(Float32Array);
    expect(Array.from(r.vertProperties)).toEqual(Array.from(v.importedMeshes[0].vertProperties));
    expect(r.triVerts).toBeInstanceOf(Uint32Array);
    expect(Array.from(r.triVerts)).toEqual(Array.from(v.importedMeshes[0].triVerts));
    expect(r.parts.triPart).toBeInstanceOf(Int32Array);
    expect(Array.from(r.parts.triPart)).toEqual(Array.from(v.importedMeshes[0].parts.triPart));
    expect(r.parts.colors).toEqual([null, '#ff0000']);
  });

  it("never modifies the caller's objects", () => {
    const v = sampleVersion();
    const mesh = v.importedMeshes[0];
    const packed = packStoredArrays(v, 1024);
    expect(packed).not.toBe(v);
    expect(packed.importedMeshes).not.toBe(v.importedMeshes);
    expect(v.importedMeshes[0]).toBe(mesh);
    expect(mesh.vertProperties).toBeInstanceOf(Float32Array);
    expect(mesh.parts.triPart).toBeInstanceOf(Int32Array);
  });

  it('returns the same object when nothing is big enough', () => {
    const v = sampleVersion();
    expect(packStoredArrays(v, 1 << 20)).toBe(v);
  });

  it('stores only the bytes of a view into a larger buffer', async () => {
    const buf = new Float32Array(4096).map((_, i) => i);
    const view = buf.subarray(1000, 2000);
    const restored = await unpackStoredArrays(packStoredArrays({ a: view }, 16));
    expect(restored.a).toBeInstanceOf(Float32Array);
    expect(restored.a.length).toBe(1000);
    expect(restored.a[0]).toBe(1000);
    expect(restored.a[999]).toBe(1999);
  });

  it('reads records written before packing existed unchanged', async () => {
    const v = sampleVersion();
    const restored = await unpackStoredArrays(v);
    expect(restored).toBe(v);
    expect(restored.importedMeshes[0].vertProperties).toBe(v.importedMeshes[0].vertProperties);
  });
});
