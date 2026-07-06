#!/usr/bin/env node
// probe.mjs — interactive target-mesh interrogation for the inverse-CAD loop.
//
// "Measure, never estimate": every question an agent would otherwise answer
// by squinting at a render becomes one probe call with a numeric answer.
//
//   node scripts/inverse-cad/probe.mjs <target.stl> bbox
//   node scripts/inverse-cad/probe.mjs <target.stl> section --axis z --at 3.1 [--fit] [--code]
//   node scripts/inverse-cad/probe.mjs <target.stl> bands [--axis z] [--step 0.25]
//   node scripts/inverse-cad/probe.mjs <target.stl> fit --near x,y,z --r 3
//   node scripts/inverse-cad/probe.mjs <target.stl> ray --from x,y,z --dir 0,0,-1 [--all]
//   node scripts/inverse-cad/probe.mjs <target.stl> profile [--axis z] [--step 0.5] [--thetas 24]
//
// All output is JSON on stdout (numbers rounded for readability).

import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { parseStl, meshBBox } from './stl.mjs';
import { weldVertices, connectedComponents } from './mesh.mjs';
import { meshInvariants } from './invariants.mjs';
import { makeRng, triAreas } from './sampleMesh.mjs';
import { sliceMesh, contourStats, fitCircle2D, fitRoundedRect2D } from './slice.mjs';
import { contoursToCode } from './trace2code.mjs';

const AXIS_IDX = { x: 0, y: 1, z: 2 };

// ---------- shared helpers ----------

function loadMesh(path) {
  const buf = readFileSync(path);
  return parseStl(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
}

function round(v, d = 4) {
  if (typeof v === 'number') return Number.isFinite(v) ? +v.toFixed(d) : v;
  if (Array.isArray(v)) return v.map((x) => round(x, d));
  if (ArrayBuffer.isView(v)) return Array.from(v, (x) => round(x, d));
  if (v && typeof v === 'object') {
    const o = {};
    for (const k of Object.keys(v)) o[k] = round(v[k], d);
    return o;
  }
  return v;
}

function emit(obj) {
  process.stdout.write(JSON.stringify(round(obj), null, 2) + '\n');
}

function meshVolume(mesh) {
  // Divergence theorem: V = Σ dot(v0, cross(v1, v2)) / 6.
  const t = mesh.triangles;
  let vol = 0;
  for (let i = 0; i < t.length; i += 9) {
    const ax = t[i], ay = t[i + 1], az = t[i + 2];
    const bx = t[i + 3], by = t[i + 4], bz = t[i + 5];
    const cx = t[i + 6], cy = t[i + 7], cz = t[i + 8];
    vol += ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx);
  }
  return vol / 6;
}

function meshTopology(mesh) {
  const welded = weldVertices(mesh);
  const V = welded.vertices.length / 3;
  const F = welded.triangles.length / 3;
  const edges = new Set();
  for (let i = 0; i < welded.triangles.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const a = welded.triangles[i + k];
      const b = welded.triangles[i + ((k + 1) % 3)];
      edges.add(a < b ? a * 1e7 + b : b * 1e7 + a);
    }
  }
  const E = edges.size;
  const chi = V - E + F;
  const comps = connectedComponents(mesh).length;
  // Per closed surface component: χ = 2 − 2g. Summed: genusTotal = comps − χ/2.
  const genus = comps - chi / 2;
  return { vertices: V, edges: E, faces: F, eulerCharacteristic: chi, components: comps, genus };
}

// ---------- subcommands ----------

function cmdBbox(mesh, path) {
  const bbox = meshBBox(mesh);
  const inv = meshInvariants(mesh, { samples: 4000 });
  const areas = triAreas(mesh.triangles);
  return {
    file: basename(path),
    triangles: mesh.triangles.length / 9,
    bbox: {
      min: bbox.min,
      max: bbox.max,
      size: [bbox.max[0] - bbox.min[0], bbox.max[1] - bbox.min[1], bbox.max[2] - bbox.min[2]],
      center: [
        (bbox.min[0] + bbox.max[0]) / 2,
        (bbox.min[1] + bbox.max[1]) / 2,
        (bbox.min[2] + bbox.max[2]) / 2,
      ],
    },
    volume_mm3: meshVolume(mesh),
    surfaceArea_mm2: areas.total,
    pca: inv.pca,
    symmetry: inv.symmetry,
    topology: meshTopology(mesh),
  };
}

function fitContour(contour) {
  const st = contourStats(contour);
  const circle = fitCircle2D(contour.points);
  const rrect = fitRoundedRect2D(contour.points);
  let bestFit = 'freeform';
  if (circle.rmsResidual < 0.05 && circle.rmsResidual <= rrect.rmsResidual) bestFit = 'circle';
  else if (rrect.rmsResidual < 0.05) bestFit = 'rounded-rect';
  return { ...st, circle, roundedRect: rrect, bestFit };
}

function cmdSection(mesh, args) {
  const contours = sliceMesh(mesh, args.axis, args.at);
  return {
    axis: args.axis,
    at: args.at,
    contourCount: contours.length,
    contours: contours.map((c) => ({
      points: c.points.length / 2,
      area: c.area,
      isHole: !!c.isHole,
      open: !!c.open,
      ...(args.fit ? fitContour(c) : contourStats(c)),
    })),
  };
}

function contourSignature(contours) {
  // Cheap similarity signature for banding: outer count, hole count, total
  // area, total perimeter, area centroid.
  let area = 0, perim = 0, cu = 0, cv = 0, holes = 0;
  for (const c of contours) {
    const st = contourStats(c);
    if (c.isHole) { holes++; area -= st.area; } else { area += st.area; }
    perim += st.perimeter;
    cu += st.centroid[0] * st.area * (c.isHole ? -1 : 1);
    cv += st.centroid[1] * st.area * (c.isHole ? -1 : 1);
  }
  const a = Math.max(Math.abs(area), 1e-9);
  return { count: contours.length, holes, area, perim, cu: cu / a, cv: cv / a };
}

function similar(s1, s2, scale) {
  if (s1.count !== s2.count || s1.holes !== s2.holes) return false;
  const aRef = Math.max(Math.abs(s1.area), Math.abs(s2.area), 1e-9);
  if (Math.abs(s1.area - s2.area) / aRef > 0.02) return false;
  if (Math.abs(s1.perim - s2.perim) / Math.max(s1.perim, s2.perim, 1e-9) > 0.03) return false;
  if (Math.hypot(s1.cu - s2.cu, s1.cv - s2.cv) > 0.02 * scale) return false;
  return true;
}

function cmdBands(mesh, args) {
  const bbox = meshBBox(mesh);
  const ai = AXIS_IDX[args.axis];
  const lo = bbox.min[ai], hi = bbox.max[ai];
  const extent = hi - lo;
  const step = args.step ?? Math.max(0.25, extent / 128);
  const scale = Math.hypot(
    bbox.max[0] - bbox.min[0],
    bbox.max[1] - bbox.min[1],
    bbox.max[2] - bbox.min[2],
  );
  const levels = [];
  for (let v = lo + step / 2; v < hi; v += step) {
    const contours = sliceMesh(mesh, args.axis, v);
    levels.push({ at: v, contours, sig: contourSignature(contours) });
  }
  // Merge adjacent similar levels into bands.
  const bands = [];
  for (const lvl of levels) {
    const last = bands[bands.length - 1];
    if (last && similar(last.sig, lvl.sig, scale)) {
      last.to = lvl.at + step / 2;
      last.levels.push(lvl);
    } else {
      bands.push({ from: lvl.at - step / 2, to: lvl.at + step / 2, sig: lvl.sig, levels: [lvl] });
    }
  }
  let stableExtent = 0;
  const out = bands.map((b) => {
    const mid = b.levels[Math.floor(b.levels.length / 2)];
    const stable = b.levels.length >= 2;
    if (stable) stableExtent += b.to - b.from;
    const outers = mid.contours.filter((c) => !c.isHole);
    const fit = outers.length === 1 ? fitContour(outers[0]) : null;
    return {
      [args.axis + 'From']: b.from,
      [args.axis + 'To']: b.to,
      thickness: b.to - b.from,
      contourCount: mid.sig.count,
      holeCount: mid.sig.holes,
      medianArea: mid.sig.area,
      stable,
      bestFit: fit ? fit.bestFit : 'multi',
      ...(fit && fit.bestFit === 'circle' ? { circle: fit.circle } : {}),
      ...(fit && fit.bestFit === 'rounded-rect' ? { roundedRect: fit.roundedRect } : {}),
    };
  });
  return {
    axis: args.axis,
    step,
    similarity: 'signature (contour/hole count, area ±2%, perimeter ±3%, centroid shift ≤2% of diag)',
    extent,
    bands: out,
    prismaticScore: extent > 0 ? stableExtent / extent : 0,
  };
}

// RANSAC fits of the local surface patch near a point.
function cmdFit(mesh, args) {
  const t = mesh.triangles;
  const [px, py, pz] = args.near;
  const r2 = args.r * args.r;
  // Collect vertices + face normals of triangles whose centroid is near.
  const pts = [];
  const nrms = [];
  for (let i = 0; i < t.length; i += 9) {
    const cx = (t[i] + t[i + 3] + t[i + 6]) / 3;
    const cy = (t[i + 1] + t[i + 4] + t[i + 7]) / 3;
    const cz = (t[i + 2] + t[i + 5] + t[i + 8]) / 3;
    const d2 = (cx - px) ** 2 + (cy - py) ** 2 + (cz - pz) ** 2;
    if (d2 > r2) continue;
    const ux = t[i + 3] - t[i], uy = t[i + 4] - t[i + 1], uz = t[i + 5] - t[i + 2];
    const vx = t[i + 6] - t[i], vy = t[i + 7] - t[i + 1], vz = t[i + 8] - t[i + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const nl = Math.hypot(nx, ny, nz) || 1;
    nx /= nl; ny /= nl; nz /= nl;
    for (let k = 0; k < 3; k++) {
      pts.push([t[i + k * 3], t[i + k * 3 + 1], t[i + k * 3 + 2]]);
      nrms.push([nx, ny, nz]);
    }
  }
  if (pts.length < 12) return { error: `only ${pts.length / 3} triangles near [${args.near}] within r=${args.r}` };

  const fits = [];

  // Plane: centroid + smallest-eigen direction via power iteration on the
  // inverse... simpler: normal = average face normal (they're near-parallel
  // for a plane), refined by least squares.
  {
    let cx = 0, cy = 0, cz = 0;
    for (const p of pts) { cx += p[0]; cy += p[1]; cz += p[2]; }
    cx /= pts.length; cy /= pts.length; cz /= pts.length;
    let nx = 0, ny = 0, nz = 0;
    for (const n of nrms) { nx += n[0]; ny += n[1]; nz += n[2]; }
    const nl = Math.hypot(nx, ny, nz) || 1;
    nx /= nl; ny /= nl; nz /= nl;
    let ss = 0, inliers = 0;
    for (const p of pts) {
      const d = (p[0] - cx) * nx + (p[1] - cy) * ny + (p[2] - cz) * nz;
      ss += d * d;
      if (Math.abs(d) < 0.1) inliers++;
    }
    fits.push({ type: 'plane', point: [cx, cy, cz], normal: [nx, ny, nz], rms: Math.sqrt(ss / pts.length), inlierFrac: inliers / pts.length });
  }

  // Sphere: Kåsa 3D algebraic fit.
  {
    let Sxx = 0, Sxy = 0, Sxz = 0, Syy = 0, Syz = 0, Szz = 0, Sx = 0, Sy = 0, Sz = 0;
    let Sxq = 0, Syq = 0, Szq = 0, Sq = 0;
    const n = pts.length;
    for (const p of pts) {
      const q = p[0] * p[0] + p[1] * p[1] + p[2] * p[2];
      Sxx += p[0] * p[0]; Sxy += p[0] * p[1]; Sxz += p[0] * p[2];
      Syy += p[1] * p[1]; Syz += p[1] * p[2]; Szz += p[2] * p[2];
      Sx += p[0]; Sy += p[1]; Sz += p[2];
      Sxq += p[0] * q; Syq += p[1] * q; Szq += p[2] * q; Sq += q;
    }
    const sol = solve4(
      [
        [Sxx, Sxy, Sxz, Sx],
        [Sxy, Syy, Syz, Sy],
        [Sxz, Syz, Szz, Sz],
        [Sx, Sy, Sz, n],
      ],
      [Sxq, Syq, Szq, Sq],
    );
    if (sol) {
      const scx = sol[0] / 2, scy = sol[1] / 2, scz = sol[2] / 2;
      const sr = Math.sqrt(Math.max(0, sol[3] + scx * scx + scy * scy + scz * scz));
      let ss = 0, inliers = 0;
      for (const p of pts) {
        const d = Math.hypot(p[0] - scx, p[1] - scy, p[2] - scz) - sr;
        ss += d * d;
        if (Math.abs(d) < 0.1) inliers++;
      }
      fits.push({ type: 'sphere', center: [scx, scy, scz], r: sr, rms: Math.sqrt(ss / pts.length), inlierFrac: inliers / pts.length });
    }
  }

  // Cylinder RANSAC: axis from cross(n1, n2) of two random surface normals.
  {
    const rng = makeRng(7);
    let best = null;
    for (let trial = 0; trial < 400; trial++) {
      const i1 = Math.floor(rng() * pts.length);
      const i2 = Math.floor(rng() * pts.length);
      const n1 = nrms[i1], n2 = nrms[i2];
      let ax = n1[1] * n2[2] - n1[2] * n2[1];
      let ay = n1[2] * n2[0] - n1[0] * n2[2];
      let az = n1[0] * n2[1] - n1[1] * n2[0];
      const al = Math.hypot(ax, ay, az);
      if (al < 0.05) continue; // near-parallel normals — degenerate
      ax /= al; ay /= al; az /= al;
      // Project the sample point onto the plane ⊥ axis: radial dir = its
      // normal (points away from axis for a convex cylinder). Axis point =
      // point − r * normal, with r from the second sample consistency.
      const p1 = pts[i1];
      // Estimate r by testing a range... simpler: for each candidate axis,
      // project ALL points to the ⊥ plane and circle-fit.
      const [bu, bv] = perpBasis(ax, ay, az);
      const proj = new Float64Array(pts.length * 2);
      for (let i = 0; i < pts.length; i++) {
        const dx = pts[i][0] - p1[0], dy = pts[i][1] - p1[1], dz = pts[i][2] - p1[2];
        proj[i * 2] = dx * bu[0] + dy * bu[1] + dz * bu[2];
        proj[i * 2 + 1] = dx * bv[0] + dy * bv[1] + dz * bv[2];
      }
      const cf = fitCircle2D(proj);
      if (!Number.isFinite(cf.rmsResidual)) continue;
      let inliers = 0;
      for (let i = 0; i < pts.length; i++) {
        if (Math.abs(Math.hypot(proj[i * 2] - cf.cx, proj[i * 2 + 1] - cf.cy) - cf.r) < 0.08) inliers++;
      }
      if (!best || inliers > best.inliers) {
        best = { inliers, axisDir: [ax, ay, az], anchor: p1, cf, proj };
      }
    }
    if (best) {
      const { axisDir, anchor, cf } = best;
      const [bu, bv] = perpBasis(axisDir[0], axisDir[1], axisDir[2]);
      const axisPoint = [
        anchor[0] + cf.cx * bu[0] + cf.cy * bv[0],
        anchor[1] + cf.cx * bu[1] + cf.cy * bv[1],
        anchor[2] + cf.cx * bu[2] + cf.cy * bv[2],
      ];
      let ss = 0;
      for (let i = 0; i < pts.length; i++) {
        const dx = pts[i][0] - axisPoint[0], dy = pts[i][1] - axisPoint[1], dz = pts[i][2] - axisPoint[2];
        const along = dx * axisDir[0] + dy * axisDir[1] + dz * axisDir[2];
        const rx = dx - along * axisDir[0], ry = dy - along * axisDir[1], rz = dz - along * axisDir[2];
        const d = Math.hypot(rx, ry, rz) - cf.r;
        ss += d * d;
      }
      fits.push({
        type: 'cylinder',
        axisPoint,
        axisDir,
        r: cf.r,
        rms: Math.sqrt(ss / pts.length),
        inlierFrac: best.inliers / pts.length,
      });
    }
  }

  fits.sort((a, b) => a.rms - b.rms);
  return { near: args.near, r: args.r, points: pts.length, fits, best: fits[0]?.type };
}

function perpBasis(ax, ay, az) {
  const ref = Math.abs(ax) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  let ux = ay * ref[2] - az * ref[1];
  let uy = az * ref[0] - ax * ref[2];
  let uz = ax * ref[1] - ay * ref[0];
  const ul = Math.hypot(ux, uy, uz) || 1;
  ux /= ul; uy /= ul; uz /= ul;
  return [
    [ux, uy, uz],
    [ay * uz - az * uy, az * ux - ax * uz, ax * uy - ay * ux],
  ];
}

function solve4(A, b) {
  const m = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < 4; col++) {
    let piv = col;
    for (let r = col + 1; r < 4; r++) if (Math.abs(m[r][col]) > Math.abs(m[piv][col])) piv = r;
    if (Math.abs(m[piv][col]) < 1e-12) return null;
    [m[col], m[piv]] = [m[piv], m[col]];
    for (let r = 0; r < 4; r++) {
      if (r === col) continue;
      const f = m[r][col] / m[col][col];
      for (let c = col; c < 5; c++) m[r][c] -= f * m[col][c];
    }
  }
  return [m[0][4] / m[0][0], m[1][4] / m[1][1], m[2][4] / m[2][2], m[3][4] / m[3][3]];
}

// Möller–Trumbore over all triangles (brute force — fine at ≤50k tris).
function cmdRay(mesh, args) {
  const t = mesh.triangles;
  const [ox, oy, oz] = args.from;
  let [dx, dy, dz] = args.dir;
  const dl = Math.hypot(dx, dy, dz) || 1;
  dx /= dl; dy /= dl; dz /= dl;
  const hits = [];
  for (let i = 0; i < t.length; i += 9) {
    const e1x = t[i + 3] - t[i], e1y = t[i + 4] - t[i + 1], e1z = t[i + 5] - t[i + 2];
    const e2x = t[i + 6] - t[i], e2y = t[i + 7] - t[i + 1], e2z = t[i + 8] - t[i + 2];
    const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
    const det = e1x * px + e1y * py + e1z * pz;
    if (Math.abs(det) < 1e-12) continue;
    const inv = 1 / det;
    const tx = ox - t[i], ty = oy - t[i + 1], tz = oz - t[i + 2];
    const u = (tx * px + ty * py + tz * pz) * inv;
    if (u < -1e-9 || u > 1 + 1e-9) continue;
    const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
    const v = (dx * qx + dy * qy + dz * qz) * inv;
    if (v < -1e-9 || u + v > 1 + 1e-9) continue;
    const dist = (e2x * qx + e2y * qy + e2z * qz) * inv;
    if (dist < 1e-9) continue;
    // Face normal · dir < 0 → the ray is entering the solid here.
    const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
    hits.push({
      dist,
      point: [ox + dx * dist, oy + dy * dist, oz + dz * dist],
      entering: nx * dx + ny * dy + nz * dz < 0,
    });
  }
  hits.sort((a, b) => a.dist - b.dist);
  // Dedupe coincident hits: a ray through an edge/diagonal shared by two
  // triangles registers in both; keep one (agents probe symmetric centers
  // constantly, so this happens in practice, not just in tests).
  const deduped = [];
  for (const h of hits) {
    if (deduped.length && Math.abs(h.dist - deduped[deduped.length - 1].dist) < 1e-7) continue;
    deduped.push(h);
  }
  return {
    from: args.from,
    dir: [dx, dy, dz],
    hitCount: deduped.length,
    hits: args.all ? deduped : deduped.slice(0, 1),
  };
}

function cmdProfile(mesh, args) {
  const bbox = meshBBox(mesh);
  const ai = AXIS_IDX[args.axis];
  const [ui, vi] = { x: [1, 2], y: [0, 2], z: [0, 1] }[args.axis];
  const cu = args.center ? args.center[0] : (bbox.min[ui] + bbox.max[ui]) / 2;
  const cv = args.center ? args.center[1] : (bbox.min[vi] + bbox.max[vi]) / 2;
  const lo = bbox.min[ai], hi = bbox.max[ai];
  const step = args.step ?? Math.max(0.25, (hi - lo) / 64);
  const thetas = args.thetas ?? 24;
  const rows = [];
  let scoreAcc = 0, scoreN = 0;
  for (let h = lo + step / 2; h < hi; h += step) {
    const contours = sliceMesh(mesh, args.axis, h).filter((c) => !c.isHole && !c.open);
    if (contours.length === 0) { rows.push({ at: h, rMax: 0, rMean: 0, circularity: 0 }); continue; }
    // Max radial distance of contour points from the axis, overall and per theta.
    const byTheta = new Float64Array(thetas);
    let rMax = 0, rSum = 0, nPts = 0;
    for (const c of contours) {
      for (let i = 0; i < c.points.length; i += 2) {
        const du = c.points[i] - cu, dv = c.points[i + 1] - cv;
        const r = Math.hypot(du, dv);
        const bin = Math.floor(((Math.atan2(dv, du) + Math.PI) / (2 * Math.PI)) * thetas) % thetas;
        if (r > byTheta[bin]) byTheta[bin] = r;
        if (r > rMax) rMax = r;
        rSum += r; nPts++;
      }
    }
    const filled = Array.from(byTheta).filter((r) => r > 0);
    const mean = filled.reduce((a, b) => a + b, 0) / Math.max(filled.length, 1);
    const variance = filled.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(filled.length, 1);
    const circ = mean > 1e-9 ? Math.max(0, 1 - Math.sqrt(variance) / mean) : 0;
    if (filled.length >= thetas * 0.75) { scoreAcc += circ; scoreN++; }
    rows.push({ at: h, rMax, rMean: rSum / Math.max(nPts, 1), circularity: circ });
  }
  return {
    axis: args.axis,
    center: [cu, cv],
    step,
    profile: rows,
    revolveScore: scoreN ? scoreAcc / scoreN : 0,
  };
}

// ---------- CLI ----------

function parseVec(s, n) {
  const parts = s.split(',').map(Number);
  if (parts.length !== n || parts.some((x) => !Number.isFinite(x))) {
    throw new Error(`expected ${n} comma-separated numbers, got "${s}"`);
  }
  return parts;
}

function main() {
  const argv = process.argv;
  const path = argv[2];
  const cmd = argv[3];
  if (!path || !cmd) {
    console.error('Usage: node scripts/inverse-cad/probe.mjs <target.stl> <bbox|section|bands|fit|ray|profile> [flags]');
    process.exit(2);
  }
  const args = { axis: 'z', at: null, fit: false, code: false, all: false, step: null, near: null, r: 3, from: null, dir: null, center: null, thetas: null };
  for (let i = 4; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--axis') args.axis = argv[++i];
    else if (a === '--at') args.at = parseFloat(argv[++i]);
    else if (a === '--fit') args.fit = true;
    else if (a === '--code') args.code = true;
    else if (a === '--all') args.all = true;
    else if (a === '--step') args.step = parseFloat(argv[++i]);
    else if (a === '--near') args.near = parseVec(argv[++i], 3);
    else if (a === '--r') args.r = parseFloat(argv[++i]);
    else if (a === '--from') args.from = parseVec(argv[++i], 3);
    else if (a === '--dir') args.dir = parseVec(argv[++i], 3);
    else if (a === '--center') args.center = parseVec(argv[++i], 2);
    else if (a === '--thetas') args.thetas = parseInt(argv[++i], 10);
    else throw new Error('probe: unexpected argument ' + a);
  }
  const mesh = loadMesh(path);

  if (cmd === 'bbox') return emit(cmdBbox(mesh, path));
  if (cmd === 'section') {
    if (args.at === null) { console.error('section: --at required'); process.exit(2); }
    if (args.code) {
      const bbox = meshBBox(mesh);
      const ai = AXIS_IDX[args.axis];
      const contours = sliceMesh(mesh, args.axis, args.at);
      process.stdout.write(contoursToCode(contours, {
        depth: bbox.max[ai] - bbox.min[ai],
        zBase: bbox.min[ai],
        name: basename(path, '.stl'),
        header: `// traced from ${basename(path)} — slice ${args.axis}=${args.at}`,
      }));
      return;
    }
    return emit(cmdSection(mesh, args));
  }
  if (cmd === 'bands') return emit(cmdBands(mesh, args));
  if (cmd === 'fit') {
    if (!args.near) { console.error('fit: --near x,y,z required'); process.exit(2); }
    return emit(cmdFit(mesh, args));
  }
  if (cmd === 'ray') {
    if (!args.from || !args.dir) { console.error('ray: --from and --dir required'); process.exit(2); }
    return emit(cmdRay(mesh, args));
  }
  if (cmd === 'profile') return emit(cmdProfile(mesh, args));
  console.error('unknown subcommand: ' + cmd);
  process.exit(2);
}

const isMain = process.argv[1] && import.meta.url.endsWith(basename(process.argv[1]));
if (isMain) main();

export { cmdBbox, cmdSection, cmdBands, cmdFit, cmdRay, cmdProfile, meshVolume, meshTopology };
