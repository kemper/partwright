/**
 * Curves — smooth-shape helpers exposed to the manifold-js sandbox as `api.Curves`.
 *
 * The base manifold-3d library covers primitives + booleans + extrude/revolve, but
 * leaves common smooth-shape verbs (loft between profiles, sweep along a path,
 * bezier sampling, arbitrary-axis revolve, polyline-with-fillet, NACA airfoils)
 * to be hand-rolled. AI agents are unreliable at writing the vertex-sampling math
 * from scratch, so we ship deterministic helpers and document them.
 *
 * Convention: helpers that return point arrays use Vec2 ([x,y]) or Vec3 ([x,y,z]).
 * Helpers that build geometry return a CrossSection or Manifold ready to use.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

type Vec2 = [number, number];
type Vec3 = [number, number, number];

type CurvesAPI = {
  // 2D point/profile builders
  arc: (opts: ArcOptions) => Vec2[];
  bezier: (controls: Vec2[], segments?: number) => Vec2[];
  naca4: (code: string, opts?: NACAOptions) => Vec2[];
  polyline: (points: Vec2[], opts?: PolylineOptions) => any;

  // 3D constructors
  loft: (profiles: any[], heights: number[], opts?: LoftOptions) => any;
  sweep: (profile: any, path: Vec3[], opts?: SweepOptions) => any;
  revolveAxis: (profile: any, axis: Vec3, opts?: RevolveOptions) => any;

  // Mesh smoothing wrappers
  fillet: (manifold: any, opts?: FilletOptions) => any;
  chamfer: (manifold: any, angle?: number) => any;

  // Pattern arrays
  ringCopy: (manifold: any, count: number, opts?: RingCopyOptions) => any;
  linearCopy: (manifold: any, count: number, step: Vec3) => any;
  mirrorCopy: (manifold: any, normal: Vec3) => any;
};

interface ArcOptions {
  from: Vec2;
  to: Vec2;
  radius: number;
  segments?: number;
  cw?: boolean;
}

interface NACAOptions {
  chord?: number;
  samples?: number;
  closeTrailingEdge?: boolean;
}

interface PolylineOptions {
  closed?: boolean;
  fillet?: number;
}

interface LoftOptions {
  resolution?: number;
  smooth?: boolean;
  refine?: number;
}

interface SweepOptions {
  closed?: boolean;
  refine?: number;
}

interface RevolveOptions {
  angle?: number;
  segments?: number;
}

interface FilletOptions {
  angle?: number;
  refine?: number;
}

interface RingCopyOptions {
  axis?: 'x' | 'y' | 'z';
  radius?: number;
  angle?: number;
}

// ---------------------------------------------------------------------------

function need(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`Curves: ${msg}`);
}

function isFiniteNum(v: any): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function isVec2(v: any): v is Vec2 {
  return Array.isArray(v) && v.length === 2 && isFiniteNum(v[0]) && isFiniteNum(v[1]);
}

function isVec3(v: any): v is Vec3 {
  return Array.isArray(v) && v.length === 3 && isFiniteNum(v[0]) && isFiniteNum(v[1]) && isFiniteNum(v[2]);
}

function dist2(a: Vec2, b: Vec2): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  return Math.sqrt(dx * dx + dy * dy);
}

function norm3(v: Vec3): Vec3 {
  const m = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / m, v[1] / m, v[2] / m];
}

function cross3(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function dot3(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

// ---------------------------------------------------------------------------
// Arc through two endpoints with given radius.
// Center sits perpendicular to the chord midpoint at distance sqrt(r^2 - (chord/2)^2).
// `cw=true` flips to the other side.
// ---------------------------------------------------------------------------

function arc(opts: ArcOptions): Vec2[] {
  need(opts && typeof opts === 'object', 'arc requires an options object');
  need(isVec2(opts.from), 'arc.from must be a [x,y] point');
  need(isVec2(opts.to), 'arc.to must be a [x,y] point');
  need(isFiniteNum(opts.radius) && opts.radius > 0, 'arc.radius must be a positive number');
  const segments = opts.segments ?? 32;
  need(Number.isInteger(segments) && segments >= 2, 'arc.segments must be an integer >= 2');

  const { from, to, radius, cw = false } = opts;
  const chord = dist2(from, to);
  need(chord <= 2 * radius + 1e-9, `arc: chord length ${chord.toFixed(3)} exceeds 2 * radius (${(2 * radius).toFixed(3)})`);

  const mx = (from[0] + to[0]) / 2;
  const my = (from[1] + to[1]) / 2;
  const dx = (to[0] - from[0]) / chord;
  const dy = (to[1] - from[1]) / chord;
  // Default (cw=false): arc bulges to the LEFT of the chord direction (matches
  // CCW polygon convention). To bulge left, the center sits on the RIGHT of
  // the chord. cw=true mirrors both.
  const sign = cw ? -1 : 1;
  const rx = dy * sign;
  const ry = -dx * sign;
  const h = Math.sqrt(Math.max(0, radius * radius - (chord / 2) * (chord / 2)));
  const cx = mx + h * rx;
  const cy = my + h * ry;

  const a0 = Math.atan2(from[1] - cy, from[0] - cx);
  const a1 = Math.atan2(to[1] - cy, to[0] - cx);
  // Always take the shorter (<= 180°) arc between the two endpoints. Larger
  // sweeps would require more than one arc segment.
  let sweep = a1 - a0;
  while (sweep > Math.PI) sweep -= 2 * Math.PI;
  while (sweep < -Math.PI) sweep += 2 * Math.PI;

  const out: Vec2[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const a = a0 + sweep * t;
    out.push([cx + radius * Math.cos(a), cy + radius * Math.sin(a)]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Bezier curve via de Casteljau's algorithm. Works for any degree (n control
// points = degree n-1).
// ---------------------------------------------------------------------------

function bezier(controls: Vec2[], segments?: number): Vec2[] {
  need(Array.isArray(controls) && controls.length >= 2, 'bezier requires at least 2 control points');
  for (let i = 0; i < controls.length; i++) {
    need(isVec2(controls[i]), `bezier.controls[${i}] must be a [x,y] point`);
  }
  const segs = segments ?? 32;
  need(Number.isInteger(segs) && segs >= 1, 'bezier.segments must be an integer >= 1');

  const out: Vec2[] = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    // De Casteljau
    const pts = controls.map(p => [p[0], p[1]] as Vec2);
    for (let r = pts.length - 1; r > 0; r--) {
      for (let j = 0; j < r; j++) {
        pts[j] = [
          pts[j][0] * (1 - t) + pts[j + 1][0] * t,
          pts[j][1] * (1 - t) + pts[j + 1][1] * t,
        ];
      }
    }
    out.push(pts[0]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// NACA 4-digit airfoil profile. `code` is the 4-digit string, e.g. "2412" =
// 2% camber at 40% chord, 12% thickness. Returns a CCW closed loop suitable
// for CrossSection.ofPolygons or Curves.polyline.
//
// References: NACA Report 824 (Jacobs et al.), https://en.wikipedia.org/wiki/NACA_airfoil
// ---------------------------------------------------------------------------

function naca4(code: string, opts: NACAOptions = {}): Vec2[] {
  need(typeof code === 'string' && /^\d{4}$/.test(code), `naca4: code must be a 4-digit string, got "${code}"`);
  const chord = opts.chord ?? 100;
  const samples = opts.samples ?? 80;
  const closeTE = opts.closeTrailingEdge ?? true;
  need(isFiniteNum(chord) && chord > 0, 'naca4.chord must be a positive number');
  need(Number.isInteger(samples) && samples >= 10, 'naca4.samples must be an integer >= 10');

  const m = parseInt(code[0], 10) / 100;           // max camber as fraction
  const p = parseInt(code[1], 10) / 10;             // location of max camber
  const t = parseInt(code.slice(2, 4), 10) / 100;   // max thickness

  // Coefficients: open trailing edge keeps the standard last-term; closing it nudges to -0.1036
  const a4 = closeTE ? -0.1036 : -0.1015;

  const upper: Vec2[] = [];
  const lower: Vec2[] = [];

  // Cosine spacing so points cluster near LE/TE where curvature is highest.
  for (let i = 0; i <= samples; i++) {
    const beta = (i / samples) * Math.PI;
    const x = (1 - Math.cos(beta)) / 2; // 0..1 in chord units
    const sqx = Math.sqrt(x);
    const yt = 5 * t * (0.2969 * sqx - 0.1260 * x - 0.3516 * x * x + 0.2843 * x * x * x + a4 * x * x * x * x);

    let yc = 0, dyc = 0;
    if (p === 0 || m === 0) {
      yc = 0;
      dyc = 0;
    } else if (x < p) {
      yc = (m / (p * p)) * (2 * p * x - x * x);
      dyc = (2 * m / (p * p)) * (p - x);
    } else {
      yc = (m / ((1 - p) * (1 - p))) * ((1 - 2 * p) + 2 * p * x - x * x);
      dyc = (2 * m / ((1 - p) * (1 - p))) * (p - x);
    }
    const theta = Math.atan(dyc);
    const xu = x - yt * Math.sin(theta);
    const yu = yc + yt * Math.cos(theta);
    const xl = x + yt * Math.sin(theta);
    const yl = yc - yt * Math.cos(theta);
    upper.push([xu * chord, yu * chord]);
    lower.push([xl * chord, yl * chord]);
  }

  // CCW closed loop: lower from LE to TE, then upper from TE back to LE.
  // (We skip the duplicate leading-edge point.)
  const profile: Vec2[] = [];
  for (let i = 0; i < lower.length; i++) profile.push(lower[i]);
  for (let i = upper.length - 2; i > 0; i--) profile.push(upper[i]);
  return profile;
}

// ---------------------------------------------------------------------------
// Build a CrossSection from a polyline. With `fillet: r`, every corner is
// rounded by an offset-shrink-then-expand pass (Clipper2 round joins).
// ---------------------------------------------------------------------------

function makePolyline(CrossSection: any) {
  return function polyline(points: Vec2[], opts: PolylineOptions = {}): any {
    need(Array.isArray(points) && points.length >= 3, 'polyline requires at least 3 points');
    for (let i = 0; i < points.length; i++) {
      need(isVec2(points[i]), `polyline.points[${i}] must be a [x,y] point`);
    }
    const closed = opts.closed ?? true;
    const fillet = opts.fillet;
    need(closed === true, 'polyline: open polylines are not supported yet; pass a closed loop');

    let cs = CrossSection.ofPolygons([points]);
    if (fillet !== undefined) {
      need(isFiniteNum(fillet) && fillet > 0, 'polyline.fillet must be a positive number');
      // Shrink with rounded joins then expand back — corners become arcs of radius `fillet`.
      cs = cs.offset(-fillet, 'Round').offset(fillet, 'Round');
    }
    return cs;
  };
}

// ---------------------------------------------------------------------------
// Internal: extract the outer contour of a profile as Vec2[].
// Accepts a CrossSection, a Polygons (Vec2[][]), or a SimplePolygon (Vec2[]).
// ---------------------------------------------------------------------------

function profileToPoints(profile: any): Vec2[] {
  if (profile && typeof profile.toPolygons === 'function') {
    const contours = profile.toPolygons();
    need(contours.length > 0, 'profile is an empty CrossSection');
    // Use the largest contour by point count (outer).
    let best = contours[0];
    for (const c of contours) if (c.length > best.length) best = c;
    return best.map((p: any) => [p[0], p[1]] as Vec2);
  }
  if (Array.isArray(profile) && profile.length > 0 && isVec2(profile[0])) {
    return profile.map((p: Vec2) => [p[0], p[1]] as Vec2);
  }
  if (Array.isArray(profile) && profile.length > 0 && Array.isArray(profile[0]) && isVec2(profile[0][0])) {
    return profile[0].map((p: Vec2) => [p[0], p[1]] as Vec2);
  }
  throw new Error('profile must be a CrossSection, Polygons, or Vec2[]');
}

// Resample a closed polygon uniformly by arc length so paired profiles have
// matching topology for loft side strips.
function resampleByArcLength(points: Vec2[], n: number): Vec2[] {
  const lens = [0];
  for (let i = 0; i < points.length; i++) {
    const nxt = (i + 1) % points.length;
    lens.push(lens[i] + dist2(points[i], points[nxt]));
  }
  const total = lens[lens.length - 1];
  if (total === 0) throw new Error('Curves: degenerate profile (zero perimeter)');

  const out: Vec2[] = [];
  let seg = 0;
  for (let i = 0; i < n; i++) {
    const target = (i / n) * total;
    while (seg < lens.length - 1 && lens[seg + 1] < target) seg++;
    const segLen = lens[seg + 1] - lens[seg];
    const t = segLen === 0 ? 0 : (target - lens[seg]) / segLen;
    const a = points[seg];
    const b = points[(seg + 1) % points.length];
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
  }
  return out;
}

// Align profile B so its starting vertex is closest to profile A's start. Avoids
// twisted side strips when the two profiles' point orders are offset.
function alignToStart(refStart: Vec2, ring: Vec2[]): Vec2[] {
  let bestI = 0, bestD = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const d = dist2(refStart, ring[i]);
    if (d < bestD) { bestD = d; bestI = i; }
  }
  return ring.slice(bestI).concat(ring.slice(0, bestI));
}

// ---------------------------------------------------------------------------
// Loft N profiles at given Z heights. Profiles are resampled to a shared point
// count, then a polyhedron mesh is built with side strips between adjacent
// profiles and triangulated caps on top + bottom.
// ---------------------------------------------------------------------------

function makeLoft(module: any) {
  const { Manifold, Mesh, triangulate } = module;
  return function loft(profiles: any[], heights: number[], opts: LoftOptions = {}): any {
    need(Array.isArray(profiles) && profiles.length >= 2, 'loft requires at least 2 profiles');
    need(Array.isArray(heights) && heights.length === profiles.length, 'loft: heights[] length must match profiles[] length');
    for (let i = 0; i < heights.length; i++) {
      need(isFiniteNum(heights[i]), `loft.heights[${i}] must be a finite number`);
      if (i > 0) need(heights[i] > heights[i - 1], `loft.heights must be strictly increasing (heights[${i}]=${heights[i]} <= heights[${i-1}]=${heights[i-1]})`);
    }
    const N = opts.resolution ?? 64;
    need(Number.isInteger(N) && N >= 6, 'loft.resolution must be an integer >= 6');

    const rings = profiles.map(profileToPoints).map(p => resampleByArcLength(p, N));
    // Align each ring to the previous ring's first vertex.
    for (let i = 1; i < rings.length; i++) {
      rings[i] = alignToStart(rings[i - 1][0], rings[i]);
    }

    // Build vertex array — every ring contributes N verts at its Z height.
    const verts = new Float32Array(rings.length * N * 3);
    for (let i = 0; i < rings.length; i++) {
      const z = heights[i];
      for (let j = 0; j < N; j++) {
        const o = (i * N + j) * 3;
        verts[o] = rings[i][j][0];
        verts[o + 1] = rings[i][j][1];
        verts[o + 2] = z;
      }
    }

    // Side strips: each adjacent ring pair forms a quad ring, two tris per quad.
    // Rings are CCW in XY; outward normal at edge (j,j+1) is the right of the
    // edge direction. For a quad (BL=a+j, BR=a+j1, TR=b+j1, TL=b+j) the CCW
    // outside winding is BL->BR->TR and BL->TR->TL.
    const tris: number[] = [];
    for (let i = 0; i < rings.length - 1; i++) {
      const a0 = i * N;
      const b0 = (i + 1) * N;
      for (let j = 0; j < N; j++) {
        const j1 = (j + 1) % N;
        tris.push(a0 + j, a0 + j1, b0 + j1);
        tris.push(a0 + j, b0 + j1, b0 + j);
      }
    }

    // Bottom cap (winding reversed so the normal faces -Z).
    const bottomTris: any = triangulate([rings[0]] as any);
    for (const tri of bottomTris) {
      tris.push(tri[0], tri[2], tri[1]);
    }
    // Top cap.
    const topRing = rings[rings.length - 1];
    const topBase = (rings.length - 1) * N;
    const topTris: any = triangulate([topRing] as any);
    for (const tri of topTris) {
      tris.push(topBase + tri[0], topBase + tri[1], topBase + tri[2]);
    }

    const mesh = new Mesh({
      numProp: 3,
      vertProperties: verts,
      triVerts: new Uint32Array(tris),
    });

    let m = Manifold.ofMesh(mesh);
    if (opts.smooth) m = m.smoothOut(60);
    if (opts.refine && opts.refine > 1) m = m.refine(opts.refine);
    return m;
  };
}

// ---------------------------------------------------------------------------
// Sweep a 2D profile along a 3D polyline path. Uses parallel transport to
// orient the profile frame consistently, avoiding twist artifacts when the
// path bends through multiple planes.
// ---------------------------------------------------------------------------

function makeSweep(module: any) {
  const { Manifold, Mesh, triangulate } = module;
  return function sweep(profile: any, path: Vec3[], opts: SweepOptions = {}): any {
    need(Array.isArray(path) && path.length >= 2, 'sweep requires a path with at least 2 points');
    for (let i = 0; i < path.length; i++) {
      need(isVec3(path[i]), `sweep.path[${i}] must be a [x,y,z] point`);
    }
    const closed = opts.closed ?? false;

    const profilePts = profileToPoints(profile);
    const N = profilePts.length;
    need(N >= 3, 'sweep: profile must have at least 3 points');

    // Compute tangents at each path point.
    const M = path.length;
    const tangents: Vec3[] = [];
    for (let i = 0; i < M; i++) {
      let t: Vec3;
      if (closed) {
        const prev = path[(i - 1 + M) % M];
        const next = path[(i + 1) % M];
        t = [next[0] - prev[0], next[1] - prev[1], next[2] - prev[2]];
      } else if (i === 0) {
        t = [path[1][0] - path[0][0], path[1][1] - path[0][1], path[1][2] - path[0][2]];
      } else if (i === M - 1) {
        t = [path[M - 1][0] - path[M - 2][0], path[M - 1][1] - path[M - 2][1], path[M - 1][2] - path[M - 2][2]];
      } else {
        const prev = path[i - 1];
        const next = path[i + 1];
        t = [next[0] - prev[0], next[1] - prev[1], next[2] - prev[2]];
      }
      tangents.push(norm3(t));
    }

    // Initial frame at path[0]: pick a reference vector not parallel to t0.
    const t0 = tangents[0];
    let ref: Vec3 = Math.abs(t0[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
    let normal = norm3(cross3(ref, t0));
    let binormal = norm3(cross3(t0, normal));
    const frames: { n: Vec3; b: Vec3 }[] = [{ n: normal, b: binormal }];

    // Parallel transport: rotate the previous frame so its tangent matches the new tangent.
    for (let i = 1; i < M; i++) {
      const tPrev = tangents[i - 1];
      const tCur = tangents[i];
      const axis = cross3(tPrev, tCur);
      const axisMag = Math.hypot(axis[0], axis[1], axis[2]);
      if (axisMag < 1e-9) {
        // Tangents are parallel — frame unchanged.
        frames.push({ n: frames[i - 1].n, b: frames[i - 1].b });
        continue;
      }
      const cosA = Math.max(-1, Math.min(1, dot3(tPrev, tCur)));
      const angle = Math.acos(cosA);
      const k = norm3(axis);
      const rot = (v: Vec3): Vec3 => {
        // Rodrigues' rotation
        const cosT = Math.cos(angle), sinT = Math.sin(angle);
        const kxv = cross3(k, v);
        const kdv = dot3(k, v);
        return [
          v[0] * cosT + kxv[0] * sinT + k[0] * kdv * (1 - cosT),
          v[1] * cosT + kxv[1] * sinT + k[1] * kdv * (1 - cosT),
          v[2] * cosT + kxv[2] * sinT + k[2] * kdv * (1 - cosT),
        ];
      };
      const n = norm3(rot(frames[i - 1].n));
      const b = norm3(cross3(tangents[i], n));
      frames.push({ n, b });
    }

    // Place profile points at each frame: world = path[i] + u*normal + v*binormal,
    // where (u, v) are the 2D profile coordinates.
    const totalVerts = M * N;
    const verts = new Float32Array(totalVerts * 3);
    for (let i = 0; i < M; i++) {
      const p = path[i];
      const { n, b } = frames[i];
      for (let j = 0; j < N; j++) {
        const u = profilePts[j][0];
        const v = profilePts[j][1];
        const o = (i * N + j) * 3;
        verts[o] = p[0] + u * n[0] + v * b[0];
        verts[o + 1] = p[1] + u * n[1] + v * b[1];
        verts[o + 2] = p[2] + u * n[2] + v * b[2];
      }
    }

    // Side strips between adjacent path frames. Same winding rule as loft.
    const tris: number[] = [];
    const stripCount = closed ? M : M - 1;
    for (let i = 0; i < stripCount; i++) {
      const a0 = i * N;
      const b0 = ((i + 1) % M) * N;
      for (let j = 0; j < N; j++) {
        const j1 = (j + 1) % N;
        tris.push(a0 + j, a0 + j1, b0 + j1);
        tris.push(a0 + j, b0 + j1, b0 + j);
      }
    }

    // Open-path end caps.
    if (!closed) {
      const startTris: any = triangulate([profilePts] as any);
      for (const tri of startTris) {
        // Start cap normal faces -tangent; reverse winding.
        tris.push(tri[0], tri[2], tri[1]);
      }
      const endBase = (M - 1) * N;
      const endTris: any = triangulate([profilePts] as any);
      for (const tri of endTris) {
        tris.push(endBase + tri[0], endBase + tri[1], endBase + tri[2]);
      }
    }

    const mesh = new Mesh({
      numProp: 3,
      vertProperties: verts,
      triVerts: new Uint32Array(tris),
    });

    let m = Manifold.ofMesh(mesh);
    if (opts.refine && opts.refine > 1) m = m.refine(opts.refine);
    return m;
  };
}

// ---------------------------------------------------------------------------
// Revolve a profile around an arbitrary 3D axis (not just Y).
// Internally: rotate so the axis aligns with Y, revolve, then rotate back.
// ---------------------------------------------------------------------------

function makeRevolveAxis(module: any) {
  const { Manifold } = module;
  return function revolveAxis(profile: any, axis: Vec3, opts: RevolveOptions = {}): any {
    need(isVec3(axis), 'revolveAxis.axis must be a [x,y,z] vector');
    const angle = opts.angle ?? 360;
    const segments = opts.segments ?? 32;
    need(isFiniteNum(angle), 'revolveAxis.angle must be a number');
    need(Number.isInteger(segments) && segments >= 3, 'revolveAxis.segments must be an integer >= 3');

    // Manifold.revolve takes a CrossSection in XY (X=radius, Y=height) and
    // produces a Z-up solid (revolved around Y internally then Y->Z remap).
    // To revolve around an arbitrary axis we rotate the resulting solid so
    // its natural +Z aligns with the requested axis direction.
    const revolved = Manifold.revolve(profile, segments, angle);

    const axisN = norm3(axis);
    const z: Vec3 = [0, 0, 1];
    const dotVal = dot3(z, axisN);
    if (Math.abs(dotVal - 1) < 1e-9) return revolved;
    if (Math.abs(dotVal + 1) < 1e-9) return revolved.rotate([180, 0, 0]);

    // Rodrigues rotation matrix that takes +Z to axisN.
    const k = norm3(cross3(z, axisN));
    const theta = Math.acos(Math.max(-1, Math.min(1, dotVal)));
    const c = Math.cos(theta), s = Math.sin(theta), C = 1 - c;
    const [kx, ky, kz] = k;
    // Build mat4 in column-major order for Manifold.transform (16 floats).
    const mat = [
      c + kx * kx * C,       ky * kx * C + kz * s,  kz * kx * C - ky * s,  0,
      kx * ky * C - kz * s,  c + ky * ky * C,       kz * ky * C + kx * s,  0,
      kx * kz * C + ky * s,  ky * kz * C - kx * s,  c + kz * kz * C,       0,
      0, 0, 0, 1,
    ];
    return revolved.transform(mat);
  };
}

// ---------------------------------------------------------------------------
// Mesh-smoothing convenience: fillet rounds sharp edges, chamfer keeps them
// crisp at the given angle threshold.
// ---------------------------------------------------------------------------

function fillet(manifold: any, opts: FilletOptions = {}): any {
  need(manifold && typeof manifold.smoothOut === 'function', 'fillet: first argument must be a Manifold');
  const angle = opts.angle ?? 60;
  const refineN = opts.refine ?? 3;
  need(isFiniteNum(angle) && angle >= 0 && angle <= 180, 'fillet.angle must be a number in [0, 180]');
  need(Number.isInteger(refineN) && refineN >= 1, 'fillet.refine must be a positive integer');
  let m = manifold.smoothOut(angle);
  if (refineN > 1) m = m.refine(refineN);
  return m;
}

function chamfer(manifold: any, angle: number = 60): any {
  need(manifold && typeof manifold.smoothOut === 'function', 'chamfer: first argument must be a Manifold');
  need(isFiniteNum(angle) && angle >= 0 && angle <= 180, 'chamfer.angle must be a number in [0, 180]');
  // smoothOut without refine produces a single smoothed pass — the sharp edges
  // become a tiny bevel rather than a smooth fillet.
  return manifold.smoothOut(angle);
}

// ---------------------------------------------------------------------------
// Pattern arrays.
// ---------------------------------------------------------------------------

function makePatterns(module: any) {
  const { Manifold } = module;

  function ringCopy(manifold: any, count: number, opts: RingCopyOptions = {}): any {
    need(manifold && typeof manifold.translate === 'function', 'ringCopy: first argument must be a Manifold');
    need(Number.isInteger(count) && count >= 1, 'ringCopy.count must be a positive integer');
    const axis = opts.axis ?? 'z';
    need(axis === 'x' || axis === 'y' || axis === 'z', 'ringCopy.axis must be "x", "y", or "z"');
    const radius = opts.radius ?? 0;
    const totalAngle = opts.angle ?? 360;
    need(isFiniteNum(radius), 'ringCopy.radius must be a number');
    need(isFiniteNum(totalAngle), 'ringCopy.angle must be a number');

    const parts: any[] = [];
    const denom = totalAngle === 360 ? count : Math.max(1, count - 1);
    for (let i = 0; i < count; i++) {
      const deg = (i / denom) * totalAngle;
      let placed = manifold;
      if (radius !== 0) {
        const t: Vec3 = axis === 'x' ? [0, radius, 0]
                       : axis === 'y' ? [radius, 0, 0]
                       :                [radius, 0, 0];
        placed = placed.translate(t);
      }
      const rot: Vec3 = axis === 'x' ? [deg, 0, 0]
                     : axis === 'y' ? [0, deg, 0]
                     :                [0, 0, deg];
      parts.push(placed.rotate(rot));
    }
    return Manifold.union(parts);
  }

  function linearCopy(manifold: any, count: number, step: Vec3): any {
    need(manifold && typeof manifold.translate === 'function', 'linearCopy: first argument must be a Manifold');
    need(Number.isInteger(count) && count >= 1, 'linearCopy.count must be a positive integer');
    need(isVec3(step), 'linearCopy.step must be a [x,y,z] vector');
    const parts: any[] = [];
    for (let i = 0; i < count; i++) {
      parts.push(manifold.translate([step[0] * i, step[1] * i, step[2] * i]));
    }
    return Manifold.union(parts);
  }

  function mirrorCopy(manifold: any, normal: Vec3): any {
    need(manifold && typeof manifold.mirror === 'function', 'mirrorCopy: first argument must be a Manifold');
    need(isVec3(normal), 'mirrorCopy.normal must be a [x,y,z] vector');
    return Manifold.union([manifold, manifold.mirror(normal)]);
  }

  return { ringCopy, linearCopy, mirrorCopy };
}

// ---------------------------------------------------------------------------
// Factory — builds the Curves namespace given a manifold-3d module instance.
// ---------------------------------------------------------------------------

export function createCurvesNamespace(module: any): CurvesAPI {
  const { CrossSection } = module;
  const patterns = makePatterns(module);
  return {
    arc,
    bezier,
    naca4,
    polyline: makePolyline(CrossSection),
    loft: makeLoft(module),
    sweep: makeSweep(module),
    revolveAxis: makeRevolveAxis(module),
    fillet,
    chamfer,
    ringCopy: patterns.ringCopy,
    linearCopy: patterns.linearCopy,
    mirrorCopy: patterns.mirrorCopy,
  };
}
