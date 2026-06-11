#!/usr/bin/env node
/* eslint-disable */
// Regenerate public/catalog/palettes/*.json — the committed, durable home for
// catalog paint palettes — from the baked entries' byLabel colorRegions.
//
// Why: bake palettes used to live only in gitignored .plans/, so every fresh
// container had to reconstruct them by hand from the baked entries. This
// script IS that reconstruction, run for the whole catalog and committed.
//
//   node scripts/extract-catalog-palettes.cjs            # regenerate all
//   node scripts/extract-catalog-palettes.cjs karate ... # only these entries
//
// Idempotent: palette files whose entry no longer exists (or no longer has
// byLabel regions) are deleted. Entries without byLabel regions (manifold-js
// models with colors baked via api.label({color})) get no palette file.
//
// To re-bake an entry with its committed palette:
//   node scripts/build-catalog-entry.cjs ... --palette-file public/catalog/palettes/<id>.json

const fs = require('fs');
const path = require('path');
const { paletteFromEntry } = require('./lib/catalog-palette.cjs');

const CATALOG_DIR = path.join(__dirname, '..', 'public', 'catalog');
const PALETTE_DIR = path.join(CATALOG_DIR, 'palettes');
const only = process.argv.slice(2); // entry basenames without .partwright.json

fs.mkdirSync(PALETTE_DIR, { recursive: true });

const entries = fs.readdirSync(CATALOG_DIR).filter((f) => f.endsWith('.partwright.json'));
const written = new Set();
let extracted = 0, skipped = 0;

for (const file of entries) {
  const base = file.replace(/\.partwright\.json$/, '');
  if (only.length && !only.includes(base)) continue;
  let palette;
  try {
    palette = paletteFromEntry(JSON.parse(fs.readFileSync(path.join(CATALOG_DIR, file), 'utf8')));
  } catch (e) {
    console.error(`ERROR reading ${file}: ${e}`);
    process.exitCode = 1;
    continue;
  }
  if (!palette) { skipped++; continue; }
  const out = path.join(PALETTE_DIR, base + '.json');
  fs.writeFileSync(out, JSON.stringify(palette, null, 2) + '\n');
  written.add(base + '.json');
  extracted++;
  console.log(`  ${base}.json  (${Object.keys(palette).length} labels)`);
}

// Full regeneration prunes palettes whose entry is gone or lost its regions.
if (!only.length) {
  for (const f of fs.readdirSync(PALETTE_DIR)) {
    if (f.endsWith('.json') && !written.has(f)) {
      fs.unlinkSync(path.join(PALETTE_DIR, f));
      console.log(`  pruned stale ${f}`);
    }
  }
}

console.log(`Done: ${extracted} palette(s) written, ${skipped} entr${skipped === 1 ? 'y' : 'ies'} without byLabel regions.`);
