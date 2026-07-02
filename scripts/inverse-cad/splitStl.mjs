#!/usr/bin/env node
// splitStl.mjs — split a multi-part STL into one file per connected component.
//
// Usage:
//   node scripts/inverse-cad/splitStl.mjs <file.stl>
//   node scripts/inverse-cad/splitStl.mjs <file.stl> --out <dir>
//   node scripts/inverse-cad/splitStl.mjs <file.stl> --report   # print, no write
//   node scripts/inverse-cad/splitStl.mjs <file.stl> --tol 1e-4 # weld tolerance
//
// Components are numbered by triangle count descending. Writes
// <basename>.00.stl, <basename>.01.stl, ... into --out (default: sibling dir).

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import { parseStl, writeBinaryStl, meshBBox } from './stl.mjs';
import { connectedComponents } from './mesh.mjs';

function parseArgs(argv) {
  const args = { input: null, out: null, report: false, tol: 1e-5 };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') args.out = argv[++i];
    else if (a === '--report') args.report = true;
    else if (a === '--tol') args.tol = parseFloat(argv[++i]);
    else if (a === '--help' || a === '-h') {
      console.log(readFileSync(new URL(import.meta.url).pathname, 'utf8').split('\n').slice(1, 12).join('\n'));
      process.exit(0);
    } else if (!args.input) args.input = a;
    else throw new Error('splitStl: unexpected argument ' + a);
  }
  if (!args.input) {
    console.error('splitStl: input file required');
    process.exit(2);
  }
  return args;
}

function fmt(n, d = 3) {
  return Number.isFinite(n) ? n.toFixed(d) : String(n);
}

function main(argv) {
  const args = parseArgs(argv);
  const buf = readFileSync(args.input);
  const mesh = parseStl(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
  const components = connectedComponents(mesh, { tol: args.tol });

  const totalTris = mesh.triangles.length / 9;
  console.log(`input: ${args.input}`);
  console.log(`  triangles: ${totalTris}`);
  console.log(`  components: ${components.length} (weld tol ${args.tol})`);
  components.forEach((c, i) => {
    const tris = c.triangles.length / 9;
    const bb = meshBBox(c);
    console.log(
      `  [${String(i).padStart(2, '0')}]  tris=${String(tris).padStart(6)}` +
      `  size=${fmt(bb.size[0])} x ${fmt(bb.size[1])} x ${fmt(bb.size[2])}` +
      `  center=${fmt(bb.center[0])},${fmt(bb.center[1])},${fmt(bb.center[2])}`,
    );
  });

  if (args.report) return;

  const outDir = args.out ?? dirname(args.input);
  mkdirSync(outDir, { recursive: true });
  const base = basename(args.input, extname(args.input));
  components.forEach((c, i) => {
    const name = `${base}.${String(i).padStart(2, '0')}.stl`;
    const path = join(outDir, name);
    writeFileSync(path, writeBinaryStl(c, { header: `${base} component ${i}` }));
    console.log(`  wrote ${path}`);
  });
}

// Only run when invoked directly, not on import.
if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv);
}
