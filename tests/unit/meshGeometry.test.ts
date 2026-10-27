import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { meshDataToGeometry, triColoredGeometry } from '../../src/renderer/meshGeometry';
import type { MeshData } from '../../src/geometry/types';

/** A small irregular closed mesh (a tetrahedron with a split face) plus an
 *  extra property channel, so stride handling is exercised. */
function mesh(): MeshData {
  const xyz = [0, 0, 0, 2, 0, 0, 0, 3, 0, 0, 0, 1.5, 1, 1, 0];
  const numVert = xyz.length / 3;
  const vertProperties = new Float32Array(numVert * 4);
  for (let i = 0; i < numVert; i++) {
    vertProperties.set(xyz.slice(i * 3, i * 3 + 3), i * 4);
    vertProperties[i * 4 + 3] = 9; // extra channel — must be ignored
  }
  const triVerts = new Uint32Array([0, 4, 1, 0, 2, 4, 4, 2, 1, 0, 1, 3, 1, 2, 3, 2, 0, 3]);
  return { vertProperties, triVerts, numVert, numTri: triVerts.length / 3, numProp: 4 };
}

function threeReference(m: MeshData, indexed: boolean): Float32Array {
  const g = new THREE.BufferGeometry();
  if (indexed) {
    const p = new Float32Array(m.numVert * 3);
    for (let i = 0; i < m.numVert; i++) for (let k = 0; k < 3; k++) p[i * 3 + k] = m.vertProperties[i * m.numProp + k];
    g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    g.setIndex(new THREE.BufferAttribute(m.triVerts, 1));
  } else {
    const p = new Float32Array(m.numTri * 9);
    for (let t = 0; t < m.numTri; t++) for (let c = 0; c < 3; c++) for (let k = 0; k < 3; k++) p[t * 9 + c * 3 + k] = m.vertProperties[m.triVerts[t * 3 + c] * m.numProp + k];
    g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  }
  g.computeVertexNormals();
  return g.getAttribute('normal').array as Float32Array;
}

describe('meshGeometry', () => {
  it('indexed normals match Three.computeVertexNormals', () => {
    const m = mesh();
    const got = meshDataToGeometry(m).getAttribute('normal').array as Float32Array;
    const want = threeReference(m, true);
    expect(got.length).toBe(want.length);
    for (let i = 0; i < want.length; i++) expect(got[i]).toBeCloseTo(want[i], 5);
  });

  it('shares positions/normals across geometries of the same mesh', () => {
    const m = mesh();
    const a = meshDataToGeometry(m);
    const b = meshDataToGeometry(m);
    expect(a.getAttribute('position').array).toBe(b.getAttribute('position').array);
    expect(a.getAttribute('normal').array).toBe(b.getAttribute('normal').array);
    expect(a.getIndex()!.array).toBe(m.triVerts);
    expect(Array.from(a.getAttribute('position').array.slice(12, 15))).toEqual([1, 1, 0]);
  });

  it('per-triangle colours: flat normals match Three, unpainted gets the fallback', () => {
    const m = mesh();
    const triColors = new Uint8Array(m.numTri * 3);
    triColors.set([255, 0, 0], 0); // triangle 0 red, the rest black = unpainted
    const g = triColoredGeometry({ ...m, triColors }, [0.5, 0.5, 0.5]);
    const got = g.getAttribute('normal').array as Float32Array;
    const want = threeReference(m, false);
    for (let i = 0; i < want.length; i++) expect(got[i]).toBeCloseTo(want[i], 5);
    const col = g.getAttribute('color').array as Float32Array;
    expect(Array.from(col.slice(0, 3))).toEqual([1, 0, 0]);
    expect(Array.from(col.slice(9, 12))).toEqual([0.5, 0.5, 0.5]);
  });
});
