// Planar mesh slicing + 2D contour analysis for the inverse-CAD loop.
//
// sliceMesh cuts a triangle soup with an axis-aligned plane and chains the
// intersection segments into closed 2D contours. The 2D fitting helpers
// (circle, rounded-rect) and polygon simplifiers (Douglas-Peucker,
// short-edge cleanup) turn those contours into the numbers and point lists
// an agent needs to write parametric code without eyeballing renders.
//
// Plane→2D coordinate mapping (u, v):
//   axis 'z' → (x, y)     axis 'x' → (y, z)     axis 'y' → (x, z)

const AXIS_UV = {
  x: [1, 2], // (y, z)
  y: [0, 2], // (x, z)
  z: [0, 1], // (x, y)
};
const AXIS_IDX = { x: 0, y: 1, z: 2 };

// Slice a { triangles: Float32Array } soup at axis=value. Returns an array
// of closed contours: { points: Float64Array [u0,v0,u1,v1,...], area,
// signedArea, isHole, open }. `open` marks chains that failed to close
// (non-watertight input); they're returned for diagnostics but excluded
// from hole classification.
export function sliceMesh(mesh, axis, value) {
  const { triangles } = mesh;
  const ai = AXIS_IDX[axis];
  const [ui, vi] = AXIS_UV[axis];
  if (ai === undefined) throw new Error('sliceMesh: bad axis ' + axis);
  const nTri = triangles.length / 9;

  // Collect intersection segments. Vertices exactly on the plane get nudged
  // to the positive side (consistent tie-break → every crossing triangle
  // yields exactly one segment, no degenerate point-touches).
  const segs = []; // [u0, v0, u1, v1]
  const s = new Float64Array(3);
  const P = new Float64Array(9);
  for (let t = 0; t < nTri; t++) {
    const o = t * 9;
    for (let k = 0; k < 3; k++) {
      P[k * 3] = triangles[o + k * 3];
      P[k * 3 + 1] = triangles[o + k * 3 + 1];
      P[k * 3 + 2] = triangles[o + k * 3 + 2];
      const d = P[k * 3 + ai] - value;
      s[k] = d === 0 ? 1e-12 : d;
    }
    const pts = [];
    for (let k = 0; k < 3; k++) {
      const k2 = (k + 1) % 3;
      if ((s[k] > 0) !== (s[k2] > 0)) {
        const f = s[k] / (s[k] - s[k2]);
        const u = P[k * 3 + ui] + f * (P[k2 * 3 + ui] - P[k * 3 + ui]);
        const v = P[k * 3 + vi] + f * (P[k2 * 3 + vi] - P[k * 3 + vi]);
        pts.push(u, v);
      }
    }
    if (pts.length === 4) segs.push(pts[0], pts[1], pts[2], pts[3]);
  }
  if (segs.length === 0) return [];

  // Chain segments into loops by welding endpoints on a quantized grid.
  let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
  for (let i = 0; i < segs.length; i += 2) {
    const u = segs[i], v = segs[i + 1];
    if (u < minU) minU = u; if (u > maxU) maxU = u;
    if (v < minV) minV = v; if (v > maxV) maxV = v;
  }
  const diag = Math.hypot(maxU - minU, maxV - minV) || 1;
  const tol = 1e-5 * diag;
  const inv = 1 / tol;
  const key = (u, v) => Math.round(u * inv) + ',' + Math.round(v * inv);

  const nSeg = segs.length / 4;
  const endsAt = new Map(); // key -> array of [segIdx, whichEnd]
  for (let i = 0; i < nSeg; i++) {
    for (const e of [0, 1]) {
      const k = key(segs[i * 4 + e * 2], segs[i * 4 + e * 2 + 1]);
      let arr = endsAt.get(k);
      if (!arr) endsAt.set(k, (arr = []));
      arr.push([i, e]);
    }
  }

  const used = new Uint8Array(nSeg);
  const contours = [];
  for (let start = 0; start < nSeg; start++) {
    if (used[start]) continue;
    used[start] = 1;
    const pts = [segs[start * 4], segs[start * 4 + 1]];
    let curU = segs[start * 4 + 2], curV = segs[start * 4 + 3];
    const startKey = key(pts[0], pts[1]);
    let closed = false;
    for (;;) {
      const k = key(curU, curV);
      if (k === startKey) { closed = true; break; }
      pts.push(curU, curV);
      const cands = endsAt.get(k);
      let next = null;
      if (cands) {
        for (const [si, e] of cands) {
          if (!used[si]) { next = [si, e]; break; }
        }
      }
      if (!next) break; // open chain (non-watertight or tolerance miss)
      const [si, e] = next;
      used[si] = 1;
      const oe = 1 - e; // walk out the other end
      curU = segs[si * 4 + oe * 2];
      curV = segs[si * 4 + oe * 2 + 1];
    }
    if (pts.length < 6) continue; // degenerate sliver
    const points = Float64Array.from(pts);
    const signedArea = polygonSignedArea(points);
    contours.push({ points, signedArea, area: Math.abs(signedArea), open: !closed });
  }

  // Hole classification by containment depth (even-odd on other contours).
  const closedContours = contours.filter((c) => !c.open);
  for (const c of contours) {
    if (c.open) { c.isHole = false; continue; }
    let depth = 0;
    for (const other of closedContours) {
      if (other === c) continue;
      if (pointInPolygon(c.points[0], c.points[1], other.points)) depth++;
    }
    c.isHole = depth % 2 === 1;
  }
  contours.sort((a, b) => b.area - a.area);
  return contours;
}

export function polygonSignedArea(points) {
  const n = points.length / 2;
  let a = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    a += points[i * 2] * points[j * 2 + 1] - points[j * 2] * points[i * 2 + 1];
  }
  return a / 2;
}

export function pointInPolygon(u, v, points) {
  const n = points.length / 2;
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const ui = points[i * 2], vi2 = points[i * 2 + 1];
    const uj = points[j * 2], vj = points[j * 2 + 1];
    if (vi2 > v !== vj > v && u < ((uj - ui) * (v - vi2)) / (vj - vi2) + ui) inside = !inside;
  }
  return inside;
}

export function contourStats(contour) {
  const { points } = contour;
  const n = points.length / 2;
  let perimeter = 0, cu = 0, cv = 0;
  let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    perimeter += Math.hypot(points[j * 2] - points[i * 2], points[j * 2 + 1] - points[i * 2 + 1]);
    cu += points[i * 2];
    cv += points[i * 2 + 1];
    if (points[i * 2] < minU) minU = points[i * 2];
    if (points[i * 2] > maxU) maxU = points[i * 2];
    if (points[i * 2 + 1] < minV) minV = points[i * 2 + 1];
    if (points[i * 2 + 1] > maxV) maxV = points[i * 2 + 1];
  }
  return {
    area: contour.area ?? Math.abs(polygonSignedArea(points)),
    perimeter,
    centroid: [cu / n, cv / n],
    bboxMin: [minU, minV],
    bboxMax: [maxU, maxV],
  };
}

// Kåsa algebraic circle fit: minimizes Σ(x²+y² − 2ax − 2by − c)².
export function fitCircle2D(points) {
  const n = points.length / 2;
  let Suu = 0, Suv = 0, Svv = 0, Su = 0, Sv = 0;
  let Suq = 0, Svq = 0, Sq = 0;
  for (let i = 0; i < n; i++) {
    const u = points[i * 2], v = points[i * 2 + 1];
    const q = u * u + v * v;
    Suu += u * u; Suv += u * v; Svv += v * v;
    Su += u; Sv += v;
    Suq += u * q; Svq += v * q; Sq += q;
  }
  // Solve [ [Suu Suv Su] [Suv Svv Sv] [Su Sv n] ] * [2a 2b c]ᵀ = [Suq Svq Sq]ᵀ
  const A = [
    [Suu, Suv, Su],
    [Suv, Svv, Sv],
    [Su, Sv, n],
  ];
  const b = [Suq, Svq, Sq];
  const x = solve3(A, b);
  if (!x) return { cx: 0, cy: 0, r: 0, rmsResidual: Infinity };
  const cx = x[0] / 2, cy = x[1] / 2;
  const r = Math.sqrt(Math.max(0, x[2] + cx * cx + cy * cy));
  let ss = 0;
  for (let i = 0; i < n; i++) {
    const d = Math.hypot(points[i * 2] - cx, points[i * 2 + 1] - cy) - r;
    ss += d * d;
  }
  return { cx, cy, r, rmsResidual: Math.sqrt(ss / n) };
}

function solve3(A, b) {
  const m = [
    [A[0][0], A[0][1], A[0][2], b[0]],
    [A[1][0], A[1][1], A[1][2], b[1]],
    [A[2][0], A[2][1], A[2][2], b[2]],
  ];
  for (let col = 0; col < 3; col++) {
    let piv = col;
    for (let r = col + 1; r < 3; r++) if (Math.abs(m[r][col]) > Math.abs(m[piv][col])) piv = r;
    if (Math.abs(m[piv][col]) < 1e-12) return null;
    [m[col], m[piv]] = [m[piv], m[col]];
    for (let r = 0; r < 3; r++) {
      if (r === col) continue;
      const f = m[r][col] / m[col][col];
      for (let c = col; c < 4; c++) m[r][c] -= f * m[col][c];
    }
  }
  return [m[0][3] / m[0][0], m[1][3] / m[1][1], m[2][3] / m[2][2]];
}

// Signed distance from a point to a rounded-rect outline centered at origin,
// half-extents (hw, hh), corner radius r (the standard 2D SDF).
function roundedRectSdf(u, v, hw, hh, r) {
  const qx = Math.abs(u) - (hw - r);
  const qy = Math.abs(v) - (hh - r);
  const ox = Math.max(qx, 0), oy = Math.max(qy, 0);
  return Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - r;
}

// Approximate rounded-rect fit: tries angle 0 and the PCA angle of the
// points; extents from the rotated bbox; corner radius by 1D scan minimizing
// RMS |sdf|. Approximate by design — the residual is the honesty signal.
export function fitRoundedRect2D(points) {
  const n = points.length / 2;
  let cu = 0, cv = 0;
  for (let i = 0; i < n; i++) { cu += points[i * 2]; cv += points[i * 2 + 1]; }
  cu /= n; cv /= n;
  let sxx = 0, sxy = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    const du = points[i * 2] - cu, dv = points[i * 2 + 1] - cv;
    sxx += du * du; sxy += du * dv; syy += dv * dv;
  }
  const pcaAngle = 0.5 * Math.atan2(2 * sxy, sxx - syy);

  let best = null;
  for (const angle of [0, pcaAngle]) {
    const ca = Math.cos(-angle), sa = Math.sin(-angle);
    const rot = new Float64Array(n * 2);
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    for (let i = 0; i < n; i++) {
      const du = points[i * 2] - cu, dv = points[i * 2 + 1] - cv;
      const u = du * ca - dv * sa, v = du * sa + dv * ca;
      rot[i * 2] = u; rot[i * 2 + 1] = v;
      if (u < minU) minU = u; if (u > maxU) maxU = u;
      if (v < minV) minV = v; if (v > maxV) maxV = v;
    }
    const hw = (maxU - minU) / 2, hh = (maxV - minV) / 2;
    const ou = (maxU + minU) / 2, ov = (maxV + minV) / 2;
    const rMax = Math.min(hw, hh);
    let bestR = 0, bestRms = Infinity;
    for (let step = 0; step <= 24; step++) {
      const r = (rMax * step) / 24;
      let ss = 0;
      for (let i = 0; i < n; i++) {
        const d = roundedRectSdf(rot[i * 2] - ou, rot[i * 2 + 1] - ov, hw, hh, r);
        ss += d * d;
      }
      const rms = Math.sqrt(ss / n);
      if (rms < bestRms) { bestRms = rms; bestR = r; }
    }
    if (!best || bestRms < best.rmsResidual) {
      best = {
        cx: cu + ou * Math.cos(angle) - ov * Math.sin(angle),
        cy: cv + ou * Math.sin(angle) + ov * Math.cos(angle),
        w: hw * 2,
        h: hh * 2,
        angleDeg: (angle * 180) / Math.PI,
        cornerR: bestR,
        rmsResidual: bestRms,
      };
    }
  }
  return best;
}

// Douglas-Peucker for a CLOSED polygon: split at the two mutually farthest
// points, simplify each open half, rejoin.
export function douglasPeucker(points, tol) {
  const n = points.length / 2;
  if (n <= 4) return Float64Array.from(points);
  // Anchor 0 and the point farthest from it.
  let far = 1, farD = -1;
  for (let i = 1; i < n; i++) {
    const d = (points[i * 2] - points[0]) ** 2 + (points[i * 2 + 1] - points[1]) ** 2;
    if (d > farD) { farD = d; far = i; }
  }
  const idx = (i) => [points[i * 2], points[i * 2 + 1]];
  const half1 = [];
  for (let i = 0; i <= far; i++) half1.push(idx(i));
  const half2 = [];
  for (let i = far; i < n; i++) half2.push(idx(i));
  half2.push(idx(0));
  const s1 = dpOpen(half1, tol);
  const s2 = dpOpen(half2, tol);
  const out = [...s1.slice(0, -1), ...s2.slice(0, -1)];
  const flat = new Float64Array(out.length * 2);
  out.forEach(([u, v], i) => { flat[i * 2] = u; flat[i * 2 + 1] = v; });
  return flat;
}

function dpOpen(pts, tol) {
  if (pts.length <= 2) return pts;
  const [au, av] = pts[0];
  const [bu, bv] = pts[pts.length - 1];
  const dx = bu - au, dy = bv - av;
  const len = Math.hypot(dx, dy) || 1e-12;
  let maxD = -1, maxI = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = Math.abs((pts[i][0] - au) * dy - (pts[i][1] - av) * dx) / len;
    if (d > maxD) { maxD = d; maxI = i; }
  }
  if (maxD <= tol) return [pts[0], pts[pts.length - 1]];
  const left = dpOpen(pts.slice(0, maxI + 1), tol);
  const right = dpOpen(pts.slice(maxI), tol);
  return [...left.slice(0, -1), ...right];
}

// Greedily merge edges shorter than minLen by dropping whichever endpoint's
// removal changes the polygon area least. Sub-extrusion-width edges trip
// manifold's warnings; this clears them with minimal silhouette change.
export function cleanShortEdges(points, minLen) {
  let pts = [];
  for (let i = 0; i < points.length; i += 2) pts.push([points[i], points[i + 1]]);
  const areaChange = (arr, i) => {
    const n = arr.length;
    const a = arr[(i - 1 + n) % n], b = arr[i], c = arr[(i + 1) % n];
    return Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2;
  };
  for (;;) {
    if (pts.length <= 4) break;
    let shortest = -1, shortestLen = Infinity;
    for (let i = 0; i < pts.length; i++) {
      const j = (i + 1) % pts.length;
      const len = Math.hypot(pts[j][0] - pts[i][0], pts[j][1] - pts[i][1]);
      if (len < shortestLen) { shortestLen = len; shortest = i; }
    }
    if (shortestLen >= minLen) break;
    const j = (shortest + 1) % pts.length;
    const drop = areaChange(pts, shortest) <= areaChange(pts, j) ? shortest : j;
    pts.splice(drop, 1);
  }
  const flat = new Float64Array(pts.length * 2);
  pts.forEach(([u, v], i) => { flat[i * 2] = u; flat[i * 2 + 1] = v; });
  return flat;
}
