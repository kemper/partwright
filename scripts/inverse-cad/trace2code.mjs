#!/usr/bin/env node
// trace2code.mjs — turn slice contours into a paste-ready manifold-js
// snippet: outer contours unioned, holes subtracted, extruded prismatically.
//
// Library: contoursToCode(contours, opts)
// CLI:     node scripts/inverse-cad/trace2code.mjs <target.stl> --axis z --at 3.1
//            [--depth D] [--z-base Z] [--dp 0.05] [--min-edge 0.15]
//
// The emitted extrude always uses the [1, 1] scaleTop form — a scalar 1
// silently produces a pyramid (see PLAYBOOK trap list).

import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { parseStl, meshBBox } from './stl.mjs';
import { sliceMesh, douglasPeucker, cleanShortEdges, contourStats, polygonSignedArea } from './slice.mjs';

function fmtPts(points, decimals) {
  const parts = [];
  for (let i = 0; i < points.length; i += 2) {
    parts.push(`[${points[i].toFixed(decimals)},${points[i + 1].toFixed(decimals)}]`);
  }
  return '[' + parts.join(',') + ']';
}

// Ensure CCW winding (positive signed area) — geom.fromPoints treats the
// point list as the outline; holes are separate shapes subtracted after.
function ccw(points) {
  if (polygonSignedArea(points) >= 0) return points;
  const n = points.length / 2;
  const out = new Float64Array(points.length);
  for (let i = 0; i < n; i++) {
    out[i * 2] = points[(n - 1 - i) * 2];
    out[i * 2 + 1] = points[(n - 1 - i) * 2 + 1];
  }
  return out;
}

export function contoursToCode(contours, opts = {}) {
  const { depth, zBase = 0, name = 'traced', dpTol = 0.05, minEdge = 0.15, decimals = 2, header = '' } = opts;
  if (!Number.isFinite(depth)) throw new Error('contoursToCode: opts.depth required');
  const closed = contours.filter((c) => !c.open);
  const outers = closed.filter((c) => !c.isHole);
  const holes = closed.filter((c) => c.isHole);
  if (outers.length === 0) throw new Error('contoursToCode: no outer contour');

  const simplify = (c) => ccw(cleanShortEdges(douglasPeucker(c.points, dpTol), minEdge));

  const lines = [];
  if (header) lines.push(header.trimEnd());
  lines.push(`// ${name}: prismatic extrusion of a traced slice profile.`);
  lines.push(`// dpTol=${dpTol} minEdge=${minEdge} depth=${depth} zBase=${zBase}`);
  lines.push('const { geom } = api;');
  lines.push('');
  outers.forEach((c, i) => {
    const pts = simplify(c);
    const st = contourStats({ points: pts });
    lines.push(`// outer ${i}: ${pts.length / 2} pts, area≈${st.area.toFixed(2)}`);
    lines.push(`const outer${i} = geom.fromPoints(${fmtPts(pts, decimals)});`);
  });
  holes.forEach((c, i) => {
    const pts = simplify(c);
    const st = contourStats({ points: pts });
    lines.push(`// hole ${i}: ${pts.length / 2} pts, area≈${st.area.toFixed(2)}`);
    lines.push(`const hole${i} = geom.fromPoints(${fmtPts(pts, decimals)});`);
  });
  lines.push('');
  let expr = 'outer0';
  for (let i = 1; i < outers.length; i++) expr += `.add(outer${i})`;
  for (let i = 0; i < holes.length; i++) expr += `.subtract(hole${i})`;
  lines.push(`const profile = ${expr};`);
  const translate = zBase !== 0 ? `.translate([0, 0, ${zBase}])` : '';
  lines.push(`return profile.extrude(${depth}, 0, 0, [1, 1])${translate};`);
  return lines.join('\n') + '\n';
}

function parseArgs(argv) {
  const args = { target: null, axis: 'z', at: null, depth: null, zBase: null, dp: 0.05, minEdge: 0.15 };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--axis') args.axis = argv[++i];
    else if (a === '--at') args.at = parseFloat(argv[++i]);
    else if (a === '--depth') args.depth = parseFloat(argv[++i]);
    else if (a === '--z-base') args.zBase = parseFloat(argv[++i]);
    else if (a === '--dp') args.dp = parseFloat(argv[++i]);
    else if (a === '--min-edge') args.minEdge = parseFloat(argv[++i]);
    else if (!args.target) args.target = a;
    else throw new Error('trace2code: unexpected argument ' + a);
  }
  if (!args.target || args.at === null) {
    console.error('Usage: node scripts/inverse-cad/trace2code.mjs <target.stl> --axis z --at Z [--depth D] [--z-base Z] [--dp tol] [--min-edge len]');
    process.exit(2);
  }
  return args;
}

const isMain = process.argv[1] && import.meta.url.endsWith(basename(process.argv[1]));
if (isMain) {
  const args = parseArgs(process.argv);
  const buf = readFileSync(args.target);
  const mesh = parseStl(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
  const bbox = meshBBox(mesh);
  const axisIdx = { x: 0, y: 1, z: 2 }[args.axis];
  const depth = args.depth ?? bbox.max[axisIdx] - bbox.min[axisIdx];
  const zBase = args.zBase ?? bbox.min[axisIdx];
  const contours = sliceMesh(mesh, args.axis, args.at);
  if (contours.length === 0) {
    console.error(`no contours at ${args.axis}=${args.at} (bbox ${args.axis}: ${bbox.min[axisIdx]}..${bbox.max[axisIdx]})`);
    process.exit(1);
  }
  const header =
    `// traced from ${basename(args.target)} — slice ${args.axis}=${args.at}\n` +
    `// contours: ${contours.length} (${contours.filter((c) => c.isHole).length} holes)` +
    `${args.axis === 'z' ? '' : ` — NOTE: profile is in the ${args.axis}-plane's 2D coords; extrusion is along ${args.axis}, adjust orientation`}`;
  process.stdout.write(
    contoursToCode(contours, {
      depth,
      zBase,
      name: basename(args.target, '.stl'),
      dpTol: args.dp,
      minEdge: args.minEdge,
      header,
    }),
  );
}
