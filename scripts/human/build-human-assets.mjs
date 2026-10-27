#!/usr/bin/env node
/* Build the `api.human` asset from MakeHuman's CC0 data.
 *
 * MakeHuman's ASSETS (base mesh hm08, morph targets, the default skeleton and
 * its skin weights) are CC0 — see LICENSE.md §C in
 * github.com/makehumancommunity/makehuman. Its CODE is AGPL, so nothing here is
 * ported from it: we only read the data files and re-pack them.
 *
 * Output (committed, lazy-loaded at runtime only by models that call api.human):
 *   public/human/hm08.json  — counts, byte offsets, joint/bone/target tables
 *   public/human/hm08.bin   — packed typed arrays (layout in the JSON)
 *
 * What gets packed:
 *   - vertices: every base-mesh vertex used by the body + eyeball faces, plus the
 *     joint-helper cube vertices (not drawn — joints are their centroids, so the
 *     skeleton follows every morph). Converted to Partwright's frame: Z up,
 *     front −Y, figure's left +X, in MakeHuman's decimetres.
 *   - triangles: body (label 0) and eyeballs (label 1), quads split in two.
 *   - skin weights: the default rig's weights, top-4 per vertex.
 *   - morph targets: sparse deltas (u16 vertex index + i16×3, per-target quantum).
 *
 * Run:  node scripts/human/build-human-assets.mjs     (caches downloads in .plans/mh/)
 */
import fs from 'node:fs';
import path from 'node:path';

const RAW = 'https://raw.githubusercontent.com/makehumancommunity/makehuman/master/makehuman/data';
const CACHE = '.plans/mh/cache';
const OUT = 'public/human';
fs.mkdirSync(CACHE, { recursive: true });
fs.mkdirSync(OUT, { recursive: true });

async function fetchCached(rel, { optional = false } = {}) {
  const file = path.join(CACHE, rel.replace(/\//g, '__'));
  if (fs.existsSync(file)) {
    const t = fs.readFileSync(file, 'utf8');
    return t === '\0missing' ? null : t;
  }
  const res = await fetch(`${RAW}/${rel}`);
  if (!res.ok) {
    if (optional && res.status === 404) { fs.writeFileSync(file, '\0missing'); return null; }
    throw new Error(`${rel}: HTTP ${res.status}`);
  }
  const txt = await res.text();
  fs.writeFileSync(file, txt);
  return txt;
}

// MakeHuman is Y-up, front +Z, figure's left +X. Partwright is Z-up, front −Y.
const conv = (x, y, z) => [x, -z, y];

// --- Base mesh --------------------------------------------------------------
const obj = await fetchCached('3dobjs/base.obj');
const V = [];
const faces = { body: [], eye: [] };
let group = null;
for (const line of obj.split('\n')) {
  if (line.startsWith('v ')) {
    const [, x, y, z] = line.trim().split(/\s+/).map(Number);
    V.push(conv(x, y, z));
  } else if (line.startsWith('g ')) {
    group = line.slice(2).trim();
  } else if (line.startsWith('f ')) {
    const idx = line.trim().split(/\s+/).slice(1).map((t) => parseInt(t, 10) - 1);
    const dst = group === 'body' ? faces.body : (group === 'helper-l-eye' || group === 'helper-r-eye') ? faces.eye : null;
    if (dst) dst.push(idx);
  }
}

const skel = JSON.parse(await fetchCached('rigs/default.mhskel'));
const weightsFile = JSON.parse(await fetchCached('rigs/default_weights.mhw'));

// Vertex set: drawn vertices + joint helpers.
const used = new Set();
for (const f of [...faces.body, ...faces.eye]) for (const v of f) used.add(v);
for (const verts of Object.values(skel.joints)) for (const v of verts) used.add(v);
const order = [...used].sort((a, b) => a - b);
if (order.length > 65535) throw new Error('vertex count exceeds u16 indices');
const remap = new Map(order.map((v, i) => [v, i]));
const nV = order.length;

const positions = new Float32Array(nV * 3);
order.forEach((v, i) => positions.set(V[v], i * 3));

const tris = [];
const triLabel = [];
for (const [label, list] of [[0, faces.body], [1, faces.eye]]) {
  for (const f of list) {
    const r = f.map((v) => remap.get(v));
    // conv() mirrors handedness (y,z swap + negate), which preserves winding:
    // (x,y,z)→(x,−z,y) is a proper rotation (det +1), so faces stay outward.
    for (let k = 1; k + 1 < r.length; k++) { tris.push(r[0], r[k], r[k + 1]); triLabel.push(label); }
  }
}
const triVerts = new Uint16Array(tris);

// --- Skeleton ---------------------------------------------------------------
const jointNames = Object.keys(skel.joints);
const jointIndex = new Map(jointNames.map((n, i) => [n, i]));
const jointVerts = jointNames.map((n) => skel.joints[n].map((v) => remap.get(v)));
// Parents before children so a single forward pass can solve FK.
const boneNames = [];
const visit = (name) => {
  if (boneNames.includes(name)) return;
  const p = skel.bones[name].parent;
  if (p) visit(p);
  boneNames.push(name);
};
Object.keys(skel.bones).forEach(visit);
const bones = boneNames.map((name) => {
  const b = skel.bones[name];
  return { name, parent: b.parent ? boneNames.indexOf(b.parent) : -1, head: jointIndex.get(b.head), tail: jointIndex.get(b.tail) };
});

// --- Skin weights (top 4) -----------------------------------------------------
const perVert = Array.from({ length: nV }, () => []);
for (const [bone, list] of Object.entries(weightsFile.weights)) {
  const bi = boneNames.indexOf(bone);
  if (bi < 0) continue;
  for (const [v, w] of list) {
    const i = remap.get(v);
    if (i !== undefined) perVert[i].push([bi, w]);
  }
}
const skinIndex = new Uint8Array(nV * 4);
const skinWeight = new Float32Array(nV * 4);
let unweighted = 0;
perVert.forEach((list, i) => {
  list.sort((a, b) => b[1] - a[1]);
  const top = list.slice(0, 4);
  const s = top.reduce((acc, [, w]) => acc + w, 0);
  if (!s) { unweighted++; return; }
  top.forEach(([b, w], k) => { skinIndex[i * 4 + k] = b; skinWeight[i * 4 + k] = w / s; });
});

// --- Morph targets ------------------------------------------------------------
const GENDERS = ['female', 'male'];
const AGES = ['young', 'old'];
const LEVELS = ['min', 'average', 'max'];
const ETHNIC = ['african', 'asian', 'caucasian'];
const targetFiles = [];
for (const g of GENDERS) for (const a of AGES) {
  for (const e of ETHNIC) targetFiles.push(`macrodetails/${e}-${g}-${a}`);
  for (const m of LEVELS) for (const w of LEVELS) targetFiles.push(`macrodetails/universal-${g}-${a}-${m}muscle-${w}weight`);
  // Height targets exist per muscle × weight corner too, but they are
  // whole-body (8 MB for all 72); the average-build pair carries the stature
  // change, so the spike ships only that.
  for (const h of ['min', 'max']) targetFiles.push(`macrodetails/height/${g}-${a}-averagemuscle-averageweight-${h}height`);
}
targetFiles.push('breast/female-young-averagemuscle-averageweight-maxcup-averagefirmness');
const DETAIL = [
  'chin/chin-width', 'chin/chin-prominent',
  'cheek/l-cheek-bones', 'cheek/r-cheek-bones',
  'nose/nose-scale-horiz', 'nose/nose-scale-vert',
  'mouth/mouth-scale-horiz',
  'eyes/l-eye-scale', 'eyes/r-eye-scale',
  'torso/torso-vshape', 'stomach/stomach-pregnant',
];
for (const d of DETAIL) for (const s of ['decr', 'incr']) targetFiles.push(`${d}-${s}`);
targetFiles.push('head/head-square');

const targets = [];
const chunks = [];
for (const name of targetFiles) {
  const txt = await fetchCached(`targets/${name}.target`, { optional: true });
  const rows = [];
  if (txt) {
    for (const line of txt.split('\n')) {
      if (!line || line.startsWith('#')) continue;
      const [v, x, y, z] = line.trim().split(/\s+/).map(Number);
      const i = remap.get(v);
      if (i === undefined) continue;
      const d = conv(x, y, z);
      rows.push([i, d]);
    }
  }
  // Per-target i16 quantum: the largest component maps to ±32767.
  let maxAbs = 0;
  for (const [, d] of rows) maxAbs = Math.max(maxAbs, Math.abs(d[0]), Math.abs(d[1]), Math.abs(d[2]));
  const q = maxAbs > 0 ? maxAbs / 32767 : 1;
  const idx = new Uint16Array(rows.length);
  const delta = new Int16Array(rows.length * 3);
  rows.forEach(([i, d], k) => { idx[k] = i; delta.set(d.map((c) => Math.round(c / q)), k * 3); });
  targets.push({ name, count: rows.length, quantum: q, missing: !txt });
  chunks.push(idx, delta);
}

// --- Pack ---------------------------------------------------------------------
const parts = [positions, triVerts, new Uint8Array(triLabel), skinIndex, skinWeight, ...chunks];
const offsets = [];
let off = 0;
for (const p of parts) { off = Math.ceil(off / 4) * 4; offsets.push(off); off += p.byteLength; }
const buf = Buffer.alloc(off);
parts.forEach((p, i) => Buffer.from(p.buffer, p.byteOffset, p.byteLength).copy(buf, offsets[i]));
fs.writeFileSync(path.join(OUT, 'hm08.bin'), buf);

const meta = {
  source: 'MakeHuman hm08 base mesh, default skeleton + weights, and modelling targets — CC0 1.0 (github.com/makehumancommunity/makehuman, LICENSE.md §C)',
  units: 'decimetres; Z up, front −Y, figure left +X',
  nV, nT: triVerts.length / 3,
  offsets: { positions: offsets[0], triVerts: offsets[1], triLabel: offsets[2], skinIndex: offsets[3], skinWeight: offsets[4] },
  joints: jointNames.map((name, i) => ({ name, verts: jointVerts[i] })),
  bones,
  targets: targets.map((t, i) => ({ ...t, idx: offsets[5 + i * 2], delta: offsets[6 + i * 2] })),
};
fs.writeFileSync(path.join(OUT, 'hm08.json'), JSON.stringify(meta));

const zs = []; for (let i = 0; i < nV; i++) zs.push(positions[i * 3 + 2]);
console.log(`hm08: ${nV} verts, ${meta.nT} tris (${faces.eye.length} eye quads), ${bones.length} bones, ${targets.length} targets (${targets.filter((t) => t.missing).length} empty/missing), ${unweighted} unweighted verts`);
console.log(`height ${(Math.max(...zs) - Math.min(...zs)).toFixed(2)} dm · ${(off / 1e6).toFixed(2)} MB bin · ${(fs.statSync(path.join(OUT, 'hm08.json')).size / 1e3).toFixed(0)} KB json`);
