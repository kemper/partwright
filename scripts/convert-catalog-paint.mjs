#!/usr/bin/env node
// One-shot migration: rewrite catalog session payloads so that paint declared
// by the *convertible* descriptor kinds (byLabel / plain slab / plain cylinder /
// axis-aligned box) lives in the model CODE as api.paint.* calls instead of in
// the saved colorRegions sidecar. The code becomes the source of truth.
//
// Safety rules (each guarantees the render is pixel-identical after migration):
//  - Only "plain" descriptors convert. A slab/cylinder with `smooth` is a
//    refining region that subdivides the mesh; model-underlay regions don't
//    subdivide, so converting it would coarsen the painted edge. Such regions —
//    plus non-centroid coverage, normal cones, oriented boxes, and all Tier-B
//    kinds (triangles/brushStroke/coplanar/colorFlood/connected/imagePaint) —
//    are LEFT in the sidecar untouched.
//  - Converted regions move from the user overlay to the model underlay, which
//    always renders *below* the overlay. To preserve stacking we only convert
//    the lowest-order PREFIX of convertible regions: we sort by `order` and stop
//    at the first region that must stay. That way no retained (overlay) region
//    can jump above a converted (underlay) one.
//  - The original code is wrapped in an IIFE and the api.paint.* calls appended
//    after it, so any return shape (multi-line, chained, helper-defining) keeps
//    working. Output is re-parsed to catch breakage.
//
// Usage: node scripts/convert-catalog-paint.mjs [--write] [--only <substr>]
// Without --write it's a dry run (report only).

import { readFileSync, writeFileSync } from 'node:fs';
import { globSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createServer } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// The canonical code/codeHash/colorRegions sync lives in ONE place
// (src/storage/versionRewrite.ts) shared with the app — loaded via vite SSR
// because it's TypeScript. Hand-rolling that sync is how this script's first
// pass missed `codeHash` (every migrated entry loaded flagged stale).
const viteServer = await createServer({ configFile: false, server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent', optimizeDeps: { noDiscovery: true } });
const { rewriteVersionCode } = await viteServer.ssrLoadModule('/src/storage/versionRewrite.ts');
const WRITE = process.argv.includes('--write');
const onlyIdx = process.argv.indexOf('--only');
const ONLY = onlyIdx >= 0 ? process.argv[onlyIdx + 1] : null;

const CONVERTIBLE = new Set(['byLabel', 'slab', 'cylinder', 'box']);
const EPS = 1e-9;

const num = (n) => {
  // Compact but lossless-enough numeric literal (JSON already round-trips these).
  const s = Number(n).toString();
  return s;
};
const vec = (a) => `[${a.map(num).join(', ')}]`;
const colorLit = (c) => vec(c);
const q = (s) => JSON.stringify(s);

function axisOf(normal) {
  const axes = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
  for (const [name, v] of Object.entries(axes)) {
    if (Math.abs(normal[0] - v[0]) < EPS && Math.abs(normal[1] - v[1]) < EPS && Math.abs(normal[2] - v[2]) < EPS) return name;
  }
  return null;
}

/** Is this region a "plain" convertible descriptor (exact equivalence)? */
function isPlainConvertible(r) {
  const d = r.descriptor || {};
  if (!CONVERTIBLE.has(d.kind)) return false;
  if (d.smooth) return false; // refining → would coarsen as an underlay region
  if (d.kind === 'cylinder') {
    if (d.normalCone) return false;
    if ((d.coverageMode ?? 'centroid') !== 'centroid') return false;
    if (d.maxTriangleArea != null) return false;
  }
  if (d.kind === 'box') {
    const qn = d.quaternion ?? [0, 0, 0, 1];
    if (!(Math.abs(qn[0]) < EPS && Math.abs(qn[1]) < EPS && Math.abs(qn[2]) < EPS && Math.abs(qn[3] - 1) < EPS)) return false;
    if (d.shape && d.shape !== 'box') return false;
  }
  return true;
}

/** Generate the api.paint.* statement for a convertible region. */
function paintLine(r) {
  const d = r.descriptor;
  const color = colorLit(r.color);
  switch (d.kind) {
    case 'byLabel':
      return `api.paint.label(${q(d.label)}, ${color});`;
    case 'slab': {
      const ax = axisOf(d.normal);
      const sel = ax ? `axis: ${q(ax)}` : `normal: ${vec(d.normal)}`;
      return `api.paint.slab({ ${sel}, offset: ${num(d.offset)}, thickness: ${num(d.thickness)}, color: ${color} });`;
    }
    case 'cylinder':
      return `api.paint.cylinder({ center: ${vec(d.center)}, rMin: ${num(d.rMin)}, rMax: ${num(d.rMax)}, zMin: ${num(d.zMin)}, zMax: ${num(d.zMax)}, color: ${color} });`;
    case 'box': {
      const c = d.center, s = d.size;
      const min = [c[0] - s[0] / 2, c[1] - s[1] / 2, c[2] - s[2] / 2];
      const max = [c[0] + s[0] / 2, c[1] + s[1] / 2, c[2] + s[2] / 2];
      return `api.paint.box({ min: ${vec(min)}, max: ${vec(max)}, color: ${color} });`;
    }
    default:
      throw new Error(`paintLine: unexpected kind ${d.kind}`);
  }
}

/** Wrap code in an IIFE and append the paint block. */
function rewriteCode(code, paintLines) {
  const body = code.replace(/\s+$/, '');
  return [
    '// Colors below were migrated from saved paint into code via api.paint.*',
    '// (the model is now self-colouring; see /ai/colors.md). Edit colours here.',
    'const __pwModel = (() => {',
    body,
    '})();',
    ...paintLines,
    'return __pwModel;',
    '',
  ].join('\n');
}

function parses(code) {
  try { new Function('api', `"use strict";\n${code}`); return true; }
  catch { return false; }
}

const files = globSync('public/catalog/*.partwright.json', { cwd: root })
  .filter((f) => !ONLY || f.includes(ONLY))
  .sort();

let totalConverted = 0, totalRetained = 0, versionsChanged = 0, filesChanged = 0, parseFails = 0;
const report = [];

for (const rel of files) {
  const abs = resolve(root, rel);
  const doc = JSON.parse(readFileSync(abs, 'utf8'));
  let fileChanged = false;
  const perFile = { file: rel.split('/').pop(), versions: [] };
  const sessionLang = doc.session?.language ?? null;

  for (const v of doc.versions ?? []) {
    // api.paint.* is a manifold-js sandbox API only. SCAD / replicad / voxel
    // entries are out of scope (SCAD would use a comment DSL; voxel colours are
    // already in code). Default (unset) language is manifold-js.
    const lang = v.language ?? sessionLang ?? 'manifold-js';
    if (lang !== 'manifold-js') continue;

    const src = Array.isArray(v.colorRegions) ? v.colorRegions
      : (v.geometryData && Array.isArray(v.geometryData.colorRegions) ? v.geometryData.colorRegions : null);
    if (!src || src.length === 0) continue;

    // Sort by render order; convert the lowest-order prefix of plain-convertible.
    const sorted = [...src].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    const converted = [];
    let i = 0;
    for (; i < sorted.length; i++) {
      if (isPlainConvertible(sorted[i])) converted.push(sorted[i]);
      else break; // first region that must stay ends the safe prefix
    }
    if (converted.length === 0) {
      perFile.versions.push({ index: v.index, converted: 0, retained: src.length, note: 'no convertible prefix' });
      continue;
    }
    const retained = sorted.slice(i);

    const paintLines = converted.map(paintLine);
    const newCode = rewriteCode(v.code, paintLines);
    if (!parses(newCode)) {
      parseFails++;
      perFile.versions.push({ index: v.index, converted: 0, retained: src.length, note: 'PARSE FAIL — skipped' });
      continue;
    }

    // Canonical sync: code + codeHash restamp (only if the stats were fresh
    // for the old code) + both colorRegions mirrors, in one call.
    rewriteVersionCode(v, newCode, { colorRegions: retained });

    totalConverted += converted.length;
    totalRetained += retained.length;
    versionsChanged++;
    fileChanged = true;
    perFile.versions.push({
      index: v.index,
      converted: converted.length,
      retained: retained.length,
      kinds: converted.reduce((m, r) => (m[r.descriptor.kind] = (m[r.descriptor.kind] || 0) + 1, m), {}),
      retainedKinds: retained.reduce((m, r) => (m[r.descriptor.kind] = (m[r.descriptor.kind] || 0) + 1, m), {}),
    });
  }

  if (fileChanged) {
    filesChanged++;
    if (WRITE) writeFileSync(abs, JSON.stringify(doc, null, 2) + '\n');
  }
  if (perFile.versions.some((x) => x.converted > 0 || x.note)) report.push(perFile);
}

console.log(JSON.stringify({
  mode: WRITE ? 'WRITE' : 'DRY-RUN',
  filesScanned: files.length,
  filesChanged, versionsChanged, totalConverted, totalRetained, parseFails,
}, null, 2));
console.log('\n--- per-file ---');
for (const f of report) {
  for (const v of f.versions) {
    console.log(`${f.file} v${v.index}: +${v.converted} code ${JSON.stringify(v.kinds || {})}  | kept ${v.retained} ${JSON.stringify(v.retainedKinds || {})} ${v.note || ''}`);
  }
}

await viteServer.close();
