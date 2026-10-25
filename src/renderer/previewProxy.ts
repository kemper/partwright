// A lighter stand-in for a huge mesh in small offscreen renders (version
// thumbnails, renderViews). Drawing 3.7M triangles into a 256–1024 px image
// means uploading ~100 MB to a second WebGL context and rasterizing millions of
// sub-pixel triangles — seconds of main-thread stall on a modest GPU — for
// detail no pixel can show. Vertex clustering on a grid sized from the mesh's
// surface area brings it down to roughly the budget in one linear pass.

import type { MeshData } from '../geometry/types';
import { weldPositions } from '../geometry/weldPositions';

const cache = new WeakMap<MeshData, { budget: number; proxy: MeshData }>();

/** `mesh` itself when it has at most `maxTriangles`, else a vertex-clustered
 *  approximation of about that many triangles (cached per mesh). Per-triangle
 *  colours (and their painted mask) follow the triangles that survive. */
export function previewProxy(mesh: MeshData, maxTriangles: number): MeshData {
  if (maxTriangles <= 0 || mesh.numTri <= maxTriangles) return mesh;
  const hit = cache.get(mesh);
  if (hit && hit.budget === maxTriangles) return hit.proxy;

  const { vertProperties: vp, triVerts, numTri, numVert, numProp: np } = mesh;
  // A cell of side s turns a surface of area A into ~2·A/s² triangles.
  let area = 0;
  for (let t = 0; t < numTri; t++) {
    const a = triVerts[t * 3] * np, b = triVerts[t * 3 + 1] * np, c = triVerts[t * 3 + 2] * np;
    const ux = vp[b] - vp[a], uy = vp[b + 1] - vp[a + 1], uz = vp[b + 2] - vp[a + 2];
    const wx = vp[c] - vp[a], wy = vp[c + 1] - vp[a + 1], wz = vp[c + 2] - vp[a + 2];
    area += Math.hypot(uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx) / 2;
  }
  const cell = Math.sqrt((2 * area) / maxTriangles);
  if (!(cell > 0) || !Number.isFinite(cell)) return mesh;

  const { positions, remap, numVert: outVert } = weldPositions(vp, numVert, cell, np);
  const tris = new Uint32Array(numTri * 3);
  const painted = (mesh.triColors as (Uint8Array & { _painted?: Uint8Array }) | undefined)?._painted;
  const colors = mesh.triColors ? new Uint8Array(numTri * 3) : null;
  const paintedOut = painted ? new Uint8Array(numTri) : null;
  let n = 0;
  for (let t = 0; t < numTri; t++) {
    const a = remap[triVerts[t * 3]], b = remap[triVerts[t * 3 + 1]], c = remap[triVerts[t * 3 + 2]];
    if (a === b || b === c || a === c) continue;
    if (colors) colors.set(mesh.triColors!.subarray(t * 3, t * 3 + 3), n * 3);
    if (paintedOut) paintedOut[n] = painted![t];
    tris[n * 3] = a; tris[n * 3 + 1] = b; tris[n * 3 + 2] = c;
    n++;
  }
  if (n === 0) return mesh;
  const proxy: MeshData = {
    vertProperties: positions,
    triVerts: tris.slice(0, n * 3),
    numVert: outVert,
    numTri: n,
    numProp: 3,
  };
  if (colors) {
    const out = colors.slice(0, n * 3) as Uint8Array & { _painted?: Uint8Array };
    if (paintedOut) out._painted = paintedOut.slice(0, n);
    proxy.triColors = out;
  }
  cache.set(mesh, { budget: maxTriangles, proxy });
  return proxy;
}
