#!/usr/bin/env node
/* Build the `api.human` asset from MakeHuman's CC0 data.
 *
 * MakeHuman's ASSETS (base mesh hm08, morph targets, the default skeleton and
 * its skin weights) are CC0 — see LICENSE.md §C in
 * github.com/makehumancommunity/makehuman. Its CODE is AGPL, so nothing here is
 * ported from it: we only read the data files and re-pack them.
 *
 * Output (committed, lazy-loaded at runtime only by models that call api.human):
 *   public/human/hm08.json         — counts, offsets, joint/bone/target/modifier tables
 *   public/human/hm08.bin          — CORE pack: mesh, skin weights, adult macro targets
 *   public/human/hm08-morphs.bin   — MORPHS pack: every MakeHuman modelling slider target
 *   public/human/hm08-young.bin    — YOUNG pack: baby / child macro targets
 *
 * What gets packed:
 *   - vertices: every base-mesh vertex used by the body, the eyeballs and the
 *     clothing helpers (skirt, tights, hair cap — MakeHuman's own proxy
 *     surfaces, which morph and skin with the body), plus the joint-helper cube
 *     vertices (not drawn — joints are their centroids, so the skeleton follows
 *     every morph). Converted to Partwright's frame: Z up, front −Y, figure's
 *     left +X, in MakeHuman's decimetres.
 *   - triangles: body 0, eyeballs 1, skirt 2, tights 3, hair 4 (quads split).
 *   - skin weights: the default rig's weights, top-4 per vertex.
 *   - morph targets: sparse deltas, u16 vertex index + i8×3 (or i16×3 for the
 *     big whole-body targets) with a per-target quantum, so the rounding error
 *     stays under 0.5 mm at life size.
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

const cacheFile = (rel) => path.join(CACHE, rel.replace(/\//g, '__'));

async function fetchCached(rel, { optional = false } = {}) {
  const file = cacheFile(rel);
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
const GROUP_LABEL = {
  'body': 0, 'helper-l-eye': 1, 'helper-r-eye': 1,
  'helper-skirt': 2, 'helper-tights': 3, 'helper-hair': 4,
};
const obj = await fetchCached('3dobjs/base.obj');
const V = [];
const faces = [];          // [label, [v…]]
let group = null;
for (const line of obj.split('\n')) {
  if (line.startsWith('v ')) {
    const [, x, y, z] = line.trim().split(/\s+/).map(Number);
    V.push(conv(x, y, z));
  } else if (line.startsWith('g ')) {
    group = line.slice(2).trim();
  } else if (line.startsWith('f ')) {
    const label = GROUP_LABEL[group];
    if (label === undefined) continue;
    faces.push([label, line.trim().split(/\s+/).slice(1).map((t) => parseInt(t, 10) - 1)]);
  }
}

const skel = JSON.parse(await fetchCached('rigs/default.mhskel'));
const weightsFile = JSON.parse(await fetchCached('rigs/default_weights.mhw'));

// Vertex set: drawn vertices + joint helpers.
const used = new Set();
for (const [, f] of faces) for (const v of f) used.add(v);
for (const verts of Object.values(skel.joints)) for (const v of verts) used.add(v);
const order = [...used].sort((a, b) => a - b);
if (order.length > 65535) throw new Error('vertex count exceeds u16 indices');
const remap = new Map(order.map((v, i) => [v, i]));
const nV = order.length;

const positions = new Float32Array(nV * 3);
order.forEach((v, i) => positions.set(V[v], i * 3));

const tris = [];
const triLabel = [];
for (const [label, f] of faces) {
  const r = f.map((v) => remap.get(v));
  // conv() — (x,y,z)→(x,−z,y) — is a proper rotation (det +1), so the face
  // winding is preserved and faces stay outward.
  for (let k = 1; k + 1 < r.length; k++) { tris.push(r[0], r[k], r[k + 1]); triLabel.push(label); }
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
const LEVELS = ['min', 'average', 'max'];
const ETHNIC = ['african', 'asian', 'caucasian'];
const macroFiles = (ages) => {
  const out = [];
  for (const g of ['female', 'male']) for (const a of ages) {
    for (const e of ETHNIC) out.push(`macrodetails/${e}-${g}-${a}`);
    for (const m of LEVELS) for (const w of LEVELS) out.push(`macrodetails/universal-${g}-${a}-${m}muscle-${w}weight`);
    // Height targets exist per muscle × weight corner too, but they are
    // whole-body (8 MB for all of them); the average-build pair carries the
    // stature change, so only that ships.
    for (const h of ['min', 'max']) out.push(`macrodetails/height/${g}-${a}-averagemuscle-averageweight-${h}height`);
  }
  return out;
};

// Every modelling slider MakeHuman ships (its modeling_modifiers.json), as
// API keys: one key per slider, −1…1 between its two target files (or 0…1 for
// a one-sided slider). A slider whose target name repeats within its group
// (e.g. nose-trans: down|up, backward|forward, in|out) is keyed by its max
// direction so every key is unique: `nose-trans-up`, `nose-trans-forward`, …
const modifierSpec = JSON.parse(await fetchCached('modifiers/modeling_modifiers.json'));
const modifiers = [];
const morphFiles = [];
for (const g of modifierSpec) {
  if (g.group.startsWith('macrodetails')) continue;
  const counts = {};
  for (const m of g.modifiers) if (m.target) counts[m.target] = (counts[m.target] ?? 0) + 1;
  for (const m of g.modifiers) {
    if (!m.target) continue;
    if (m.min) {
      const key = counts[m.target] > 1 ? `${m.target}-${m.max}` : m.target;
      const lo = `${g.group}/${m.target}-${m.min}`, hi = `${g.group}/${m.target}-${m.max}`;
      modifiers.push({ key, group: g.group, min: m.min, max: m.max, lo, hi });
      morphFiles.push(lo, hi);
    } else {
      const file = `${g.group}/${m.target}`;
      modifiers.push({ key: m.target, group: g.group, one: file });
      morphFiles.push(file);
    }
  }
}
const keys = new Set();
for (const m of modifiers) { if (keys.has(m.key)) throw new Error(`duplicate modifier key ${m.key}`); keys.add(m.key); }

const PACKS = {
  core: [...macroFiles(['young', 'old']), 'breast/female-young-averagemuscle-averageweight-maxcup-averagefirmness'],
  morphs: [...new Set(morphFiles)],
  young: macroFiles(['baby', 'child']),
};
const PACK_FILE = { core: 'hm08.bin', morphs: 'hm08-morphs.bin', young: 'hm08-young.bin' };

/** Largest allowed i8 quantization step, in decimetres (0.5 mm at life size; ~0.02 mm on a 60 mm print). */
const MAX_I8_STEP = 0.005;

function packTargets(names) {
  const targets = [];
  const chunks = [];
  for (const name of names) {
    const file = cacheFile(`targets/${name}.target`);
    const txt = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
    const rows = [];
    if (txt && txt !== '\0missing') {
      for (const line of txt.split('\n')) {
        if (!line || line.startsWith('#')) continue;
        const [v, x, y, z] = line.trim().split(/\s+/).map(Number);
        const i = remap.get(v);
        if (i === undefined) continue;
        rows.push([i, conv(x, y, z)]);
      }
    }
    let maxAbs = 0;
    for (const [, d] of rows) maxAbs = Math.max(maxAbs, Math.abs(d[0]), Math.abs(d[1]), Math.abs(d[2]));
    // i8 while its step stays under MAX_I8_STEP; big whole-body targets
    // (baby / child) need i16 or the surface turns lumpy.
    const bits = maxAbs / 127 <= MAX_I8_STEP ? 8 : 16;
    const q = maxAbs > 0 ? maxAbs / (bits === 8 ? 127 : 32767) : 1;
    const idx = new Uint16Array(rows.length);
    const delta = bits === 8 ? new Int8Array(rows.length * 3) : new Int16Array(rows.length * 3);
    rows.forEach(([i, d], k) => { idx[k] = i; delta.set(d.map((c) => Math.round(c / q)), k * 3); });
    targets.push({ name, count: rows.length, quantum: q, bits });
    chunks.push(idx, delta);
  }
  return { targets, chunks };
}

function writePack(file, parts) {
  const offsets = [];
  let off = 0;
  for (const p of parts) { off = Math.ceil(off / 4) * 4; offsets.push(off); off += p.byteLength; }
  const buf = Buffer.alloc(off);
  parts.forEach((p, i) => Buffer.from(p.buffer, p.byteOffset, p.byteLength).copy(buf, offsets[i]));
  fs.writeFileSync(path.join(OUT, file), buf);
  return { offsets, bytes: off };
}

// Make sure every target is cached before packing.
for (const names of Object.values(PACKS)) {
  for (const name of names) await fetchCached(`targets/${name}.target`, { optional: true });
}

const meshParts = [positions, triVerts, new Uint8Array(triLabel), skinIndex, skinWeight];
let meshOffsets = null;
const allTargets = [];
let report = '';
for (const [pack, names] of Object.entries(PACKS)) {
  const { targets, chunks } = packTargets(names);
  const parts = pack === 'core' ? [...meshParts, ...chunks] : chunks;
  const base = pack === 'core' ? meshParts.length : 0;
  const { offsets, bytes } = writePack(PACK_FILE[pack], parts);
  if (pack === 'core') meshOffsets = { positions: offsets[0], triVerts: offsets[1], triLabel: offsets[2], skinIndex: offsets[3], skinWeight: offsets[4] };
  targets.forEach((t, i) => allTargets.push({ ...t, pack, idx: offsets[base + i * 2], delta: offsets[base + i * 2 + 1] }));
  report += ` ${pack}=${(bytes / 1e6).toFixed(2)}MB/${targets.length}`;
}

const meta = {
  source: 'MakeHuman hm08 base mesh, default skeleton + weights, and modelling targets — CC0 1.0 (github.com/makehumancommunity/makehuman, LICENSE.md §C)',
  units: 'decimetres; Z up, front −Y, figure left +X',
  nV, nT: triVerts.length / 3,
  packs: PACK_FILE,
  offsets: meshOffsets,
  joints: jointNames.map((name, i) => ({ name, verts: jointVerts[i] })),
  bones,
  targets: allTargets,
  modifiers,
};
fs.writeFileSync(path.join(OUT, 'hm08.json'), JSON.stringify(meta));

const zs = []; for (let i = 0; i < nV; i++) zs.push(positions[i * 3 + 2]);
const counts = [0, 0, 0, 0, 0]; for (const l of triLabel) counts[l]++;
console.log(`hm08: ${nV} verts, ${meta.nT} tris (body/eye/skirt/tights/hair ${counts.join('/')}), ${bones.length} bones, ${modifiers.length} sliders, ${unweighted} unweighted verts`);
console.log(`packs:${report} · json ${(fs.statSync(path.join(OUT, 'hm08.json')).size / 1e3).toFixed(0)} KB · height ${(Math.max(...zs) - Math.min(...zs)).toFixed(2)} dm`);
