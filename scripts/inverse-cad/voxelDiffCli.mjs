#!/usr/bin/env node
// voxelDiffCli.mjs — smoke-test CLI for voxelDiff.mjs.
//
// Usage:
//   node scripts/inverse-cad/voxelDiffCli.mjs <a.stl> <b.stl> [--res N] [--json out.json]
//
// <a.stl> is treated as the target, <b.stl> as the candidate. Prints the
// voxelDiff result as JSON (numbers rounded to 4 decimals) and, with
// --json, also writes it to a file.

import { readFileSync, writeFileSync } from 'node:fs';
import { parseStl } from './stl.mjs';
import { voxelDiff } from './voxelDiff.mjs';

function parseArgs(argv) {
  const args = { a: null, b: null, res: null, json: null };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--res') args.res = parseFloat(argv[++i]);
    else if (arg === '--json') args.json = argv[++i];
    else if (arg === '--help' || arg === '-h') {
      console.log(readFileSync(new URL(import.meta.url).pathname, 'utf8').split('\n').slice(1, 8).join('\n'));
      process.exit(0);
    } else if (!args.a) args.a = arg;
    else if (!args.b) args.b = arg;
    else throw new Error('voxelDiffCli: unexpected argument ' + arg);
  }
  if (!args.a || !args.b) {
    console.error('Usage: node scripts/inverse-cad/voxelDiffCli.mjs <a.stl> <b.stl> [--res N] [--json out.json]');
    process.exit(2);
  }
  return args;
}

function roundReplacer(_key, v) {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.round(v * 1e4) / 1e4;
  return v;
}

function main(argv) {
  const args = parseArgs(argv);
  const bufA = readFileSync(args.a);
  const bufB = readFileSync(args.b);
  const target = parseStl(new Uint8Array(bufA.buffer, bufA.byteOffset, bufA.byteLength));
  const candidate = parseStl(new Uint8Array(bufB.buffer, bufB.byteOffset, bufB.byteLength));

  const opts = {};
  if (args.res != null && Number.isFinite(args.res)) opts.res = args.res;

  const result = voxelDiff(target, candidate, opts);
  const text = JSON.stringify(result, roundReplacer, 2);
  console.log(text);
  if (args.json) writeFileSync(args.json, text);
}

// Only run when invoked directly, not on import.
if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv);
}
