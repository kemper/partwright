// Build the Character Creator's default figure ONCE in the rest (A) pose with
// the real SDF engine, then compute linear-blend skin weights against the
// rig's bones and write everything the viewer needs:
//
//   figure.bin   positions f32×3 · normals f32×3 · triVerts u32×3 · triColors u8×3
//                · skinIndex u8×4 · skinWeight f32×4
//   figure.json  counts + byte offsets, bone names, rest frames
//
// Usage: node prototypes/skinned-figure/export.mjs
import { createServer } from 'vite';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BODY, REST_POSE, BONES } from './rigCommon.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const server = await createServer({ root: join(HERE, '../..'), configFile: false, server: { middlewareMode: true, watch: null }, appType: 'custom', logLevel: 'silent', optimizeDeps: { noDiscovery: true } });
const S = await server.ssrLoadModule('/src/figure/characterSpec.ts');
const C = await server.ssrLoadModule('/src/figure/characterCodegen.ts');
const P = await server.ssrLoadModule('/src/tools/previewModel.ts');
const Fig = await server.ssrLoadModule('/src/geometry/sdfFigure.ts');

const spec = S.cloneSpec(S.DEFAULT_SPEC);
spec.base = false; spec.place = false;
Object.assign(spec.pose.armL, { raiseSide: REST_POSE.armL.raiseSide, bend: REST_POSE.armL.bend });
Object.assign(spec.pose.armR, { raiseSide: REST_POSE.armR.raiseSide, bend: REST_POSE.armR.bend });
const code = C.specToCode(spec);

let t0 = performance.now();
const res = await P.previewModel(code);
if (!res.ok) throw new Error(res.error);
console.log(`meshed rest pose in ${((performance.now() - t0) / 1000).toFixed(1)}s:`, res.stats.triangleCount, 'tris, manifold', res.stats.isManifold);
const { positions, triVerts, triColors } = res.render;
const nV = positions.length / 3, nT = triVerts.length / 3;

const rig = Fig.createFigureNamespace({}).rig({ ...BODY, pose: REST_POSE });

// --- Vertex normals (area-weighted) ---------------------------------------
const normals = new Float32Array(nV * 3);
for (let t = 0; t < nT; t++) {
  const a = triVerts[t * 3], b = triVerts[t * 3 + 1], c = triVerts[t * 3 + 2];
  const ux = positions[b * 3] - positions[a * 3], uy = positions[b * 3 + 1] - positions[a * 3 + 1], uz = positions[b * 3 + 2] - positions[a * 3 + 2];
  const vx = positions[c * 3] - positions[a * 3], vy = positions[c * 3 + 1] - positions[a * 3 + 1], vz = positions[c * 3 + 2] - positions[a * 3 + 2];
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  for (const v of [a, b, c]) { normals[v * 3] += nx; normals[v * 3 + 1] += ny; normals[v * 3 + 2] += nz; }
}
for (let v = 0; v < nV; v++) {
  const l = Math.hypot(normals[v * 3], normals[v * 3 + 1], normals[v * 3 + 2]) || 1;
  normals[v * 3] /= l; normals[v * 3 + 1] /= l; normals[v * 3 + 2] /= l;
}

// --- Skin weights -----------------------------------------------------------
// Score each bone by distance to its segment, NORMALIZED by the bone's own
// radius (so a torso vertex near the armpit still belongs to the wide chest,
// not the thin upper-arm bone), then diffuse the scores along mesh edges so
// joints blend smoothly, then keep the top 4.
t0 = performance.now();
const nB = BONES.length;
const segs = BONES.map((b) => b.seg(rig));
const radii = BONES.map((b) => b.radius(rig));
let W = new Float32Array(nV * nB);
const SHARP = 6;
for (let v = 0; v < nV; v++) {
  const px = positions[v * 3], py = positions[v * 3 + 1], pz = positions[v * 3 + 2];
  let sum = 0;
  for (let b = 0; b < nB; b++) {
    const side = BONES[b].side;
    // A limb only claims vertices on its own side of the midline.
    if (side && px * side < -0.6) continue;
    const [A, B] = segs[b];
    const dx = B[0] - A[0], dy = B[1] - A[1], dz = B[2] - A[2];
    const L2 = dx * dx + dy * dy + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((px - A[0]) * dx + (py - A[1]) * dy + (pz - A[2]) * dz) / L2));
    const ex = px - (A[0] + dx * t), ey = py - (A[1] + dy * t), ez = pz - (A[2] + dz * t);
    const d = Math.hypot(ex, ey, ez) / radii[b];
    const w = 1 / Math.pow(Math.max(d, 0.05), SHARP);
    W[v * nB + b] = w; sum += w;
  }
  for (let b = 0; b < nB; b++) W[v * nB + b] /= sum || 1;
}

// Edge adjacency (CSR) for diffusion.
const deg = new Uint32Array(nV);
for (let t = 0; t < nT * 3; t++) deg[triVerts[t]] += 2;
const start = new Uint32Array(nV + 1);
for (let v = 0; v < nV; v++) start[v + 1] = start[v] + deg[v];
const fill = start.slice(0, nV);
const nbr = new Uint32Array(start[nV]);
for (let t = 0; t < nT; t++) {
  const a = triVerts[t * 3], b = triVerts[t * 3 + 1], c = triVerts[t * 3 + 2];
  nbr[fill[a]++] = b; nbr[fill[a]++] = c;
  nbr[fill[b]++] = a; nbr[fill[b]++] = c;
  nbr[fill[c]++] = a; nbr[fill[c]++] = b;
}
const ITER = 24;
let W2 = new Float32Array(W.length);
for (let it = 0; it < ITER; it++) {
  for (let v = 0; v < nV; v++) {
    const s0 = start[v], s1 = start[v + 1], n = s1 - s0;
    for (let b = 0; b < nB; b++) {
      let acc = 0;
      for (let k = s0; k < s1; k++) acc += W[nbr[k] * nB + b];
      W2[v * nB + b] = 0.5 * W[v * nB + b] + 0.5 * acc / (n || 1);
    }
  }
  [W, W2] = [W2, W];
}

const skinIndex = new Uint8Array(nV * 4);
const skinWeight = new Float32Array(nV * 4);
const order = new Array(nB);
for (let v = 0; v < nV; v++) {
  for (let b = 0; b < nB; b++) order[b] = b;
  order.sort((x, y) => W[v * nB + y] - W[v * nB + x]);
  let s = 0;
  for (let k = 0; k < 4; k++) s += W[v * nB + order[k]];
  for (let k = 0; k < 4; k++) {
    skinIndex[v * 4 + k] = order[k];
    skinWeight[v * 4 + k] = W[v * nB + order[k]] / (s || 1);
  }
}
console.log(`skin weights in ${((performance.now() - t0) / 1000).toFixed(1)}s for ${nV} verts × ${nB} bones`);

// --- Write -----------------------------------------------------------------
const parts = [positions, normals, triVerts, triColors ?? new Uint8Array(nT * 3).fill(170), skinIndex, skinWeight];
const offsets = [];
let off = 0;
for (const p of parts) { off = Math.ceil(off / 4) * 4; offsets.push(off); off += p.byteLength; }
const buf = Buffer.alloc(off);
parts.forEach((p, i) => Buffer.from(p.buffer, p.byteOffset, p.byteLength).copy(buf, offsets[i]));
writeFileSync(join(HERE, 'figure.bin'), buf);
writeFileSync(join(HERE, 'figure.json'), JSON.stringify({
  nV, nT,
  offsets: { positions: offsets[0], normals: offsets[1], triVerts: offsets[2], triColors: offsets[3], skinIndex: offsets[4], skinWeight: offsets[5] },
  bones: BONES.map((b) => b.name),
  restCode: code,
}, null, 1));
console.log(`wrote figure.bin (${(off / 1e6).toFixed(1)} MB)`);
await server.close();
