#!/usr/bin/env node
/* eslint-disable */
// Reads a catalog entry's stored colorRegions and emits a paint-file body
// (for scripts/single-catalog-entry.cjs) that re-creates them with the
// matching window.partwright paint verb. Coordinate-based (cylinder/slab/box)
// and byLabel regions reconstruct exactly; triangle-id regions can't survive
// re-tessellation, so they're emitted as a clearly-marked TODO with the
// region's color/name so the author can hand-write a coordinate approximation.
//
//   node scripts/gen-paint-from-regions.cjs public/catalog/<file>.partwright.json
//
// Prints the paint body to stdout.

const fs = require('fs');

function arr(a) { return '[' + a.join(', ') + ']'; }

function emit(r) {
  const d = r.descriptor || {};
  const color = arr(r.color);
  const name = JSON.stringify(r.name);
  const tail = (extra) => `, color: ${color}, name: ${name}${extra || ''} });`;
  switch (d.kind) {
    case 'cylinder': {
      const cov = d.coverageMode ? `, coverageMode: ${JSON.stringify(d.coverageMode)}` : '';
      const sm = d.smooth !== undefined ? `, smooth: ${d.smooth}` : '';
      const me = d.maxEdge !== undefined ? `, maxEdge: ${d.maxEdge}` : '';
      return `await partwright.paintInCylinder({ center: ${arr(d.center || [0, 0])}, rMin: ${d.rMin}, rMax: ${d.rMax}, zMin: ${d.zMin}, zMax: ${d.zMax}${cov}${sm}${me}${tail()}`;
    }
    case 'slab': {
      const sm = d.smooth !== undefined ? `, smooth: ${d.smooth}` : '';
      const me = d.maxEdge !== undefined ? `, maxEdge: ${d.maxEdge}` : '';
      const axisOrNormal = d.normal ? `normal: ${arr(d.normal)}` : `axis: ${JSON.stringify(d.axis)}`;
      return `await partwright.paintSlab({ ${axisOrNormal}, offset: ${d.offset}, thickness: ${d.thickness}${sm}${me}${tail()}`;
    }
    case 'box':
      return `await partwright.paintInBox({ box: { min: ${arr(d.box.min)}, max: ${arr(d.box.max)} }${tail()}`;
    case 'byLabel':
      return `await partwright.paintByLabel({ label: ${JSON.stringify(d.label)}${tail()}`;
    case 'triangles':
      return `// TODO triangle-id region ${name} color ${color} (${(d.ids || []).length} tris) — approximate with a coordinate paint (paintInBox / paintInCylinder / paintNear / paintConnected).`;
    default:
      return `// UNKNOWN descriptor kind ${d.kind} for ${name}`;
  }
}

function main() {
  const file = process.argv[2];
  if (!file) { console.error('Usage: node scripts/gen-paint-from-regions.cjs <file.partwright.json>'); process.exit(2); }
  const d = JSON.parse(fs.readFileSync(file, 'utf8'));
  const regions = d.versions[d.versions.length - 1].colorRegions || [];
  // Preserve paint order so later regions layer over earlier ones, matching
  // how the original was painted.
  regions.sort((a, b) => (a.order || 0) - (b.order || 0));
  console.log(`// Paint reconstructed from ${file}`);
  for (const r of regions) console.log(emit(r));
}

main();
