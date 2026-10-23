#!/usr/bin/env node
// capture-hair — capture a hairdo from a mesh into a preset for the figure
// library's 'captured' hair style (`F.hair(rig, { style: 'captured', preset })`).
//
//   node scripts/capture-hair.mjs <model.partwright.json | hair.stl> --out src/geometry/hairCapture/presets/<name>.ts [options]
//
// INPUT
//   *.partwright.json — a session export whose (last) version carries an
//     imported mesh with accepted PART LABELS (Part Detection → Accept). The
//     `--hair` / `--skin` / `--eyes` parts (default hair / skin / eyes) give the
//     hair triangles and the head landmarks automatically.
//   *.stl — a mesh of the HAIR ONLY (e.g. exported from a segmented session).
//     There is no skin to measure, so pass the landmarks yourself:
//     --origin x,y,z (face front at eye height, on the midline) --width W
//     (face half-width at eye height) --chin H (eye-line-to-chin drop).
//
// OPTIONS
//   --name <id>          preset name (default: the --out basename)
//   --forward +X|-Y|…    the source head's facing axis (default +X)
//   --up +Z|…            its up axis (default +Z)
//   --grid 128x64        az × el resolution (default 128x64 ≈ 22 KB of source)
//   --json               also print the landmarks + grid stats
//
// Then register the preset in src/geometry/hairCapture/presets/index.ts.
// The capture math lives in src/geometry/hairCapture/capture.ts (unit-tested);
// this script only parses files and writes the data module.
import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { createServer } from 'vite';

function parseArgs(argv) {
  const a = { input: null, out: null, name: null, forward: '+X', up: '+Z', grid: '128x64', hair: 'hair', skin: 'skin', eyes: 'eyes', origin: null, width: null, chin: null, json: false };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    const next = () => argv[++i];
    if (t === '--out') a.out = next();
    else if (t === '--name') a.name = next();
    else if (t === '--forward') a.forward = next();
    else if (t === '--up') a.up = next();
    else if (t === '--grid') a.grid = next();
    else if (t === '--hair') a.hair = next();
    else if (t === '--skin') a.skin = next();
    else if (t === '--eyes') a.eyes = next();
    else if (t === '--origin') a.origin = next().split(',').map(Number);
    else if (t === '--width') a.width = Number(next());
    else if (t === '--chin') a.chin = Number(next());
    else if (t === '--json') a.json = true;
    else if (!t.startsWith('--') && !a.input) a.input = t;
    else throw new Error(`unknown argument ${t}`);
  }
  if (!a.input || !a.out) throw new Error('usage: capture-hair.mjs <model.partwright.json | hair.stl> --out <preset.ts> [--name id] [--forward +X] [--up +Z]');
  return a;
}

function axis(s) {
  const m = /^([+-])([XYZ])$/i.exec(s);
  if (!m) throw new Error(`bad axis ${s} (want e.g. +X, -Y)`);
  const v = [0, 0, 0];
  v['XYZ'.indexOf(m[2].toUpperCase())] = m[1] === '-' ? -1 : 1;
  return v;
}

const fromB64 = (s, Ctor) => { const b = Buffer.from(s, 'base64'); return new Ctor(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };

/** Triangle soups (9 floats/tri) per named part of a session export's imported mesh. */
function partsFromSession(file, wanted) {
  const j = JSON.parse(readFileSync(file, 'utf8'));
  const versions = j.versions ?? [];
  for (let v = versions.length - 1; v >= 0; v--) {
    for (const im of versions[v].importedMeshes ?? []) {
      if (!im.parts?.triPart) continue;
      const vp = fromB64(im.vertProperties, Float32Array), tv = fromB64(im.triVerts, Uint32Array);
      const tp = fromB64(im.parts.triPart, Int32Array), np = im.numProp ?? 3;
      const out = {};
      for (const name of wanted) {
        const pi = im.parts.names.indexOf(name);
        if (pi < 0) throw new Error(`part '${name}' not found (have: ${im.parts.names.join(', ')})`);
        const arr = [];
        for (let t = 0; t < tp.length; t++) if (tp[t] === pi) for (let k = 0; k < 3; k++) { const vi = tv[3 * t + k]; arr.push(vp[np * vi], vp[np * vi + 1], vp[np * vi + 2]); }
        out[name] = new Float32Array(arr);
      }
      return out;
    }
  }
  throw new Error('no imported mesh with accepted part labels in this session export');
}

/** Binary or ASCII STL → 9 floats/tri. */
function stlTris(file) {
  const buf = readFileSync(file);
  const n = buf.length >= 84 ? buf.readUInt32LE(80) : 0;
  if (n > 0 && 84 + n * 50 === buf.length) {
    const out = new Float32Array(n * 9);
    for (let t = 0; t < n; t++) for (let k = 0; k < 9; k++) out[t * 9 + k] = buf.readFloatLE(84 + t * 50 + 12 + k * 4);
    return out;
  }
  const nums = [...buf.toString('utf8').matchAll(/vertex\s+(\S+)\s+(\S+)\s+(\S+)/g)].flatMap((m) => [Number(m[1]), Number(m[2]), Number(m[3])]);
  return new Float32Array(nums);
}

const a = parseArgs(process.argv.slice(2));
const forward = axis(a.forward), up = axis(a.up);
const gm = /^(\d+)x(\d+)$/.exec(a.grid);
const [nAz, nEl] = gm ? [Number(gm[1]), Number(gm[2])] : [NaN, NaN];
if (!(nAz >= 2 && nEl >= 2 && nAz % 2 === 0 && nEl % 2 === 0)) {
  console.error(`[capture-hair] --grid must be <az>x<el> positive even integers (e.g. 128x64), got "${a.grid}"`);
  process.exit(2);
}
const name = a.name ?? basename(a.out).replace(/\.[^.]+$/, '');
const ident = toIdentifier(name);
const server = await createServer({ configFile: false, server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent', optimizeDeps: { noDiscovery: true } });
try {
  const cap = await server.ssrLoadModule('/src/geometry/hairCapture/capture.ts');
  let hair, lm;
  if (/\.stl$/i.test(a.input)) {
    if (!a.origin || !a.width || !a.chin) throw new Error('an STL input is hair-only: pass --origin x,y,z --width W --chin H');
    hair = stlTris(a.input);
    const left = [up[1] * forward[2] - up[2] * forward[1], up[2] * forward[0] - up[0] * forward[2], up[0] * forward[1] - up[1] * forward[0]];
    lm = { origin: a.origin, forward, left, up, W: a.width, H: a.chin };
  } else {
    const parts = partsFromSession(a.input, [a.hair, a.skin, a.eyes]);
    hair = parts[a.hair];
    lm = cap.landmarksFromParts(parts[a.skin], parts[a.eyes], forward, up);
  }
  const t0 = Date.now();
  const preset = cap.captureHair(hair, lm, { name, source: `${commentSafe(basename(a.input))} (${hair.length / 9} hair triangles), scripts/capture-hair.mjs`, nAz, nEl });
  const body = `// Captured hair preset '${commentSafe(name)}' — GENERATED by scripts/capture-hair.mjs; do not edit by hand.\n`
    + `// Source: ${commentSafe(preset.source)}.\n`
    + `// Source landmarks: W=${lm.W.toFixed(2)} H=${lm.H.toFixed(2)} origin=[${lm.origin.map((x) => x.toFixed(2)).join(', ')}].\n`
    + `import type { HairCapturePreset } from '../field';\n\n`
    + `export const ${ident}: HairCapturePreset = {\n`
    + `  name: ${JSON.stringify(preset.name)},\n  source: ${JSON.stringify(preset.source)},\n`
    + `  nAz: ${preset.nAz}, nEl: ${preset.nEl}, elMin: ${preset.elMin}, elMax: ${preset.elMax},\n`
    + `  centre: ${JSON.stringify(preset.centre)}, shape: ${JSON.stringify(preset.shape)},\n`
    + `  rMin: ${preset.rMin}, rMax: ${preset.rMax}, maskScale: ${preset.maskScale},\n`
    + `  radius:\n${chunk(preset.radius)},\n  mask:\n${chunk(preset.mask)},\n};\n`;
  writeFileSync(a.out, body);
  console.error(`[capture-hair] wrote ${a.out} (${(body.length / 1024).toFixed(1)} KB) in ${Date.now() - t0} ms — export '${ident}'`);
  if (a.json) console.log(JSON.stringify({ landmarks: lm, centre: preset.centre, shape: preset.shape, rMin: preset.rMin, rMax: preset.rMax, bytes: body.length }, null, 2));
} finally {
  await server.close();
}

/** A valid JS identifier for the preset's export (non-identifier chars → _,
 *  a leading digit gets a _ prefix). Register it in presets/index.ts under it. */
function toIdentifier(s) {
  const id = s.replace(/[^A-Za-z0-9_$]/g, '_');
  return /^[0-9]/.test(id) || id === '' ? `_${id}` : id;
}

/** Text safe inside a // line comment (no line breaks or other control chars). */
function commentSafe(s) {
  return String(s).replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, ' ');
}

/** Split a long base64 string into concatenated 100-char source lines. */
function chunk(s) {
  const lines = [];
  for (let i = 0; i < s.length; i += 100) lines.push(`'${s.slice(i, i + 100)}'`);
  return `    ${lines.join('\n    + ')}`;
}
