#!/usr/bin/env node
// One-shot: render each STL under a directory into a 4-view PNG so we can
// eyeball what the real target looks like before writing candidates.
//
// Usage: node scripts/inverse-cad/renderAllTargets.mjs <stlDir> --out <pngDir> [--size N]

import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import { parseStl, meshBBox } from './stl.mjs';
import { renderMeshGrid } from './render.mjs';

function parseArgs(argv) {
  const args = { dir: null, out: null, size: 320 };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') args.out = argv[++i];
    else if (a === '--size') args.size = parseInt(argv[++i], 10);
    else if (!args.dir) args.dir = a;
  }
  if (!args.dir || !args.out) { console.error('Usage: renderAllTargets.mjs <stlDir> --out <pngDir> [--size N]'); process.exit(2); }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  const stlDir = resolve(args.dir);
  const outDir = resolve(args.out);
  mkdirSync(outDir, { recursive: true });
  const files = readdirSync(stlDir).filter((f) => f.toLowerCase().endsWith('.stl')).sort();
  const index = [];
  for (const f of files) {
    const buf = readFileSync(join(stlDir, f));
    const mesh = parseStl(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
    const bbox = meshBBox(mesh);
    const png = await renderMeshGrid(mesh, { size: args.size });
    const outPath = join(outDir, basename(f, extname(f)) + '.png');
    writeFileSync(outPath, png);
    const entry = { file: f, tris: mesh.triangles.length / 9, size: bbox.size.map((n) => +n.toFixed(2)), center: bbox.center.map((n) => +n.toFixed(2)), png: outPath };
    index.push(entry);
    console.log(f, JSON.stringify(entry.size), '→', outPath);
  }
  writeFileSync(join(outDir, 'index.json'), JSON.stringify(index, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
