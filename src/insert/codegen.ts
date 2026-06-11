// Code generation for the click-to-insert shape & operation palette.
//
// Pure, dependency-free string builders so they can be unit-tested in Node
// (see tests/insert-codegen.spec.ts) the same way src/ai/patch.ts is. Nothing
// here touches the DOM, the editor, or the engine — callers wire the output
// into the editor via the insert controller.
//
// Two target languages share one spec shape:
//   - manifold-js: each primitive is a `const <name> = Manifold...;` so later
//     operations can reference it by name and a final `return` can be managed.
//   - OpenSCAD: each primitive is a statement (optionally wrapped in
//     `translate(...)`), tagged with a `// part: <name>` comment so the
//     operand scanner can list it (SCAD has no geometry variables).

export type InsertLanguage = 'manifold-js' | 'scad' | 'replicad' | 'voxel';
export type PrimitiveKind =
  | 'cube'
  | 'sphere'
  | 'cylinder'
  | 'cone'
  | 'torus'
  | 'tube'
  | 'wedge'
  | 'pyramid'
  | 'polygon'
  | 'hemisphere'
  | 'tetrahedron'
  | 'star';
export type BooleanOpKind = 'union' | 'subtract' | 'intersect';
export type MirrorAxis = 'x' | 'y' | 'z';

export type Vec3 = [number, number, number];

interface Common {
  /** Identifier (JS variable / SCAD comment tag). Sanitized by the caller. */
  name: string;
  /** World translation applied after construction. Omitted/zero → none. */
  position?: Vec3;
}

export type PrimitiveSpec =
  | (Common & { kind: 'cube'; size: Vec3; center: boolean })
  | (Common & { kind: 'sphere'; radius: number })
  | (Common & { kind: 'cylinder'; height: number; radius: number; center: boolean })
  | (Common & {
      kind: 'cone';
      height: number;
      radiusBottom: number;
      radiusTop: number;
      center: boolean;
    })
  | (Common & {
      kind: 'torus';
      majorRadius: number;
      tubeRadius: number;
      segments: number;
    })
  | (Common & {
      kind: 'tube';
      height: number;
      outerRadius: number;
      innerRadius: number;
      center: boolean;
    })
  | (Common & { kind: 'wedge'; size: Vec3; center: boolean })
  | (Common & {
      kind: 'pyramid';
      baseSize: number;
      height: number;
      center: boolean;
    })
  | (Common & {
      kind: 'polygon';
      sides: number;
      radius: number;
      height: number;
      center: boolean;
    })
  | (Common & { kind: 'hemisphere'; radius: number; center: boolean })
  | (Common & { kind: 'tetrahedron'; size: number })
  | (Common & {
      kind: 'star';
      points: number;
      outerRadius: number;
      innerRadius: number;
      height: number;
      center: boolean;
    });

/** A shape the operand picker can reference, recovered by scanning the code. */
export interface PartRef {
  /** JS variable name, or SCAD comment tag / synthesized label. */
  name: string;
  /** SCAD only — the full statement text so it can be moved into an op block. */
  statement?: string;
  /** SCAD only — character range of the statement in the source. */
  range?: { from: number; to: number };
}

const OP_METHOD: Record<BooleanOpKind, string> = {
  union: 'add',
  subtract: 'subtract',
  intersect: 'intersect',
};

const OP_SCAD: Record<BooleanOpKind, string> = {
  union: 'union',
  subtract: 'difference',
  intersect: 'intersection',
};

/** Format a number for source: trim to 4 decimals, drop trailing zeros, and
 *  normalize -0 → 0 so generated code stays clean. */
export function fmt(n: number): string {
  if (!Number.isFinite(n)) return '0';
  const rounded = Math.round(n * 1e4) / 1e4;
  const normalized = Object.is(rounded, -0) ? 0 : rounded;
  return String(normalized);
}

function vec(v: Vec3): string {
  return `[${fmt(v[0])}, ${fmt(v[1])}, ${fmt(v[2])}]`;
}

function isZero(v?: Vec3): boolean {
  return !v || (v[0] === 0 && v[1] === 0 && v[2] === 0);
}

// ---------------------------------------------------------------------------
// Naming
// ---------------------------------------------------------------------------

const BASE_NAME: Record<PrimitiveKind, string> = {
  cube: 'box',
  sphere: 'ball',
  cylinder: 'cyl',
  cone: 'cone',
  torus: 'torus',
  tube: 'tube',
  wedge: 'wedge',
  pyramid: 'pyramid',
  polygon: 'prism',
  hemisphere: 'dome',
  tetrahedron: 'tet',
  star: 'star',
};

/** Vertices of a regular n-gon inscribed in a circle of given radius,
 *  starting at angle 0 and going counter-clockwise. */
export function ringPoints(sides: number, radius: number): [number, number][] {
  const n = Math.max(3, Math.floor(sides));
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    out.push([radius * Math.cos(a), radius * Math.sin(a)]);
  }
  return out;
}

/** 2n vertices alternating outer/inner radius for an n-pointed star. */
export function starPoints(points: number, outer: number, inner: number): [number, number][] {
  const n = Math.max(3, Math.floor(points));
  const out: [number, number][] = [];
  for (let i = 0; i < n * 2; i++) {
    const a = (i / (n * 2)) * Math.PI * 2;
    const r = i % 2 === 0 ? outer : inner;
    out.push([r * Math.cos(a), r * Math.sin(a)]);
  }
  return out;
}

function vec2List(pts: readonly [number, number][]): string {
  return pts.map(p => `[${fmt(p[0])}, ${fmt(p[1])}]`).join(', ');
}

export function baseNameFor(kind: PrimitiveKind): string {
  return BASE_NAME[kind];
}

const ALL_KINDS: PrimitiveKind[] = [
  'cube', 'sphere', 'cylinder', 'cone', 'torus', 'tube', 'wedge',
  'pyramid', 'polygon', 'hemisphere', 'tetrahedron', 'star',
];

/** Which primitive kinds each engine can emit *natively*. The mesh engines
 *  (manifold-js, scad) do everything; the BREP kernel only has the four
 *  rotational/box solids as built-ins (others would need sketches); the voxel
 *  grid has direct box/sphere/cylinder fills plus an SDF torus. Shapes a
 *  language can't do are simply hidden from its palette (per the "omit the
 *  hard ones" rule) rather than emitted as a different engine's code. */
export const SHAPE_SUPPORT: Record<InsertLanguage, ReadonlySet<PrimitiveKind>> = {
  'manifold-js': new Set(ALL_KINDS),
  'scad': new Set(ALL_KINDS),
  'replicad': new Set<PrimitiveKind>(['cube', 'sphere', 'cylinder', 'cone', 'torus']),
  'voxel': new Set<PrimitiveKind>(['cube', 'sphere', 'cylinder', 'torus']),
};

/** The primitive kinds to show in the palette for `lang`. */
export function shapesFor(lang: InsertLanguage): PrimitiveKind[] {
  const set = SHAPE_SUPPORT[lang];
  return ALL_KINDS.filter(k => set.has(k));
}

/** Whether `lang` supports explicit boolean operations in the palette. Voxel
 *  grids union implicitly (every fill accumulates into one grid) and can't
 *  subtract/intersect a whole solid, so the Operations row is hidden there. */
export function supportsBooleanOps(lang: InsertLanguage): boolean {
  return lang !== 'voxel';
}

/** Default fill colour for voxel inserts — every VoxelGrid method requires a
 *  colour. Neutral zinc so inserted shapes read as "unpainted"; the user
 *  recolours via the voxel paint tools or by editing the literal. */
export const VOXEL_DEFAULT_COLOR = '#9ca3af';

/** Round to the nearest integer voxel coordinate (the grid is integer-indexed;
 *  1 model unit = 1 voxel). */
function vox(n: number): number {
  return Math.round(n);
}

/** Turn an arbitrary user string into a safe JS identifier (also fine as a
 *  SCAD tag). Falls back to `part` when nothing usable remains. */
export function sanitizeName(raw: string): string {
  let s = (raw || '').trim().replace(/[^A-Za-z0-9_]/g, '_');
  if (s && /^[0-9]/.test(s)) s = `_${s}`;
  return s || 'part';
}

/** Pick `base`, `base2`, `base3`, … avoiding everything in `taken`. */
export function uniqueName(base: string, taken: Iterable<string>): string {
  const set = new Set(taken);
  if (!set.has(base)) return base;
  let i = 2;
  while (set.has(`${base}${i}`)) i++;
  return `${base}${i}`;
}

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/** Build the manifold-js construction expression (no trailing `;`), including
 *  any centering/position translate. Assumes `Manifold` is in scope — the
 *  controller guarantees the destructure line exists. */
function jsPrimitiveExpr(spec: PrimitiveSpec): string {
  let expr: string;
  let centerShift: Vec3 = [0, 0, 0];

  switch (spec.kind) {
    case 'cube':
      expr = `Manifold.cube(${vec(spec.size)}, ${spec.center})`;
      break;
    case 'sphere':
      expr = `Manifold.sphere(${fmt(spec.radius)})`;
      break;
    case 'cylinder':
      expr = `Manifold.cylinder(${fmt(spec.height)}, ${fmt(spec.radius)})`;
      // manifold cylinders sit base-on-origin (z: 0→h); emulate `center`.
      if (spec.center) centerShift = [0, 0, -spec.height / 2];
      break;
    case 'cone':
      expr = `Manifold.cylinder(${fmt(spec.height)}, ${fmt(spec.radiusBottom)}, ${fmt(spec.radiusTop)})`;
      if (spec.center) centerShift = [0, 0, -spec.height / 2];
      break;
    case 'torus':
      // A circle at (X=R, Y=0) revolved around the profile's Y axis (which
      // becomes Z after revolve) produces a torus of major radius R, tube r.
      // Revolved geometry is naturally centered on Z=0.
      expr = `CrossSection.circle(${fmt(spec.tubeRadius)}).translate([${fmt(spec.majorRadius)}, 0]).revolve(${Math.max(3, Math.floor(spec.segments))})`;
      break;
    case 'tube':
      // Outer cylinder minus an over-tall inner — overshooting both ends by 0.1
      // keeps the boolean's caps non-coplanar so the result stays a clean
      // manifold (the SCAD path uses the same 0.1 overshoot).
      expr =
        `Manifold.cylinder(${fmt(spec.height)}, ${fmt(spec.outerRadius)})` +
        `.subtract(Manifold.cylinder(${fmt(spec.height + 0.2)}, ${fmt(spec.innerRadius)})` +
        `.translate([0, 0, -0.1]))`;
      if (spec.center) centerShift = [0, 0, -spec.height / 2];
      break;
    case 'wedge': {
      // Right-triangle prism with the right angle at (0, 0) in XY.
      const tri = `[[${fmt(0)}, ${fmt(0)}], [${fmt(spec.size[0])}, ${fmt(0)}], [${fmt(0)}, ${fmt(spec.size[1])}]]`;
      expr = `CrossSection.ofPolygons([${tri}]).extrude(${fmt(spec.size[2])})`;
      if (spec.center) centerShift = [-spec.size[0] / 2, -spec.size[1] / 2, -spec.size[2] / 2];
      break;
    }
    case 'pyramid': {
      // Square base extruded to a point via scaleTop=[0,0]. extrude `center`
      // (last arg) centers along Z; the square is already centered in XY.
      const c = spec.center;
      expr = `CrossSection.square([${fmt(spec.baseSize)}, ${fmt(spec.baseSize)}], true).extrude(${fmt(spec.height)}, 1, 0, [0, 0], ${c})`;
      break;
    }
    case 'polygon': {
      const pts = ringPoints(spec.sides, spec.radius);
      expr = `CrossSection.ofPolygons([[${vec2List(pts)}]]).extrude(${fmt(spec.height)})`;
      if (spec.center) centerShift = [0, 0, -spec.height / 2];
      break;
    }
    case 'hemisphere': {
      // Sphere ∩ cube halfspace; cube spans Z=0..2R so the dome covers Z=0..R.
      const R = spec.radius;
      expr = `Manifold.sphere(${fmt(R)}).intersect(Manifold.cube([${fmt(2 * R)}, ${fmt(2 * R)}, ${fmt(2 * R)}], true).translate([0, 0, ${fmt(R)}]))`;
      if (spec.center) centerShift = [0, 0, -R / 2];
      break;
    }
    case 'tetrahedron': {
      // Manifold.tetrahedron() produces a tetrahedron whose vertices are 4
      // alternating corners of the cube [-1,1]^3 (bounding box 2 units edge).
      // Scale by size/2 so `size` matches the bounding-box edge length.
      const s = spec.size / 2;
      expr = `Manifold.tetrahedron()`;
      if (s !== 1) expr += `.scale(${fmt(s)})`;
      break;
    }
    case 'star': {
      const pts = starPoints(spec.points, spec.outerRadius, spec.innerRadius);
      expr = `CrossSection.ofPolygons([[${vec2List(pts)}]]).extrude(${fmt(spec.height)})`;
      if (spec.center) centerShift = [0, 0, -spec.height / 2];
      break;
    }
  }

  const shift: Vec3 = [
    (spec.position?.[0] ?? 0) + centerShift[0],
    (spec.position?.[1] ?? 0) + centerShift[1],
    (spec.position?.[2] ?? 0) + centerShift[2],
  ];
  if (!isZero(shift)) expr += `.translate(${vec(shift)})`;
  return expr;
}

/** manifold-js: `const <name> = <expr>;` */
export function emitPrimitiveJs(spec: PrimitiveSpec): string {
  return `const ${spec.name} = ${jsPrimitiveExpr(spec)};`;
}

function scadVec2List(pts: readonly [number, number][]): string {
  return pts.map(p => `[${fmt(p[0])}, ${fmt(p[1])}]`).join(', ');
}

/** OpenSCAD construction call (no translate, no trailing `;`). Most kinds emit
 *  a single call; compound shapes (tube, hemisphere, tetrahedron) emit a
 *  brace-delimited block — the SCAD scanner already understands those. */
function scadPrimitiveCall(spec: PrimitiveSpec): string {
  switch (spec.kind) {
    case 'cube':
      return `cube(${vec(spec.size)}, center=${spec.center})`;
    case 'sphere':
      return `sphere(r=${fmt(spec.radius)})`;
    case 'cylinder':
      return `cylinder(h=${fmt(spec.height)}, r=${fmt(spec.radius)}, center=${spec.center})`;
    case 'cone':
      return `cylinder(h=${fmt(spec.height)}, r1=${fmt(spec.radiusBottom)}, r2=${fmt(spec.radiusTop)}, center=${spec.center})`;
    case 'torus': {
      const seg = Math.max(3, Math.floor(spec.segments));
      return `rotate_extrude($fn=${seg}) translate([${fmt(spec.majorRadius)}, 0, 0]) circle(r=${fmt(spec.tubeRadius)})`;
    }
    case 'tube': {
      const inner = `cylinder(h=${fmt(spec.height + 0.2)}, r=${fmt(spec.innerRadius)}, center=${spec.center})`;
      const innerShift = spec.center ? inner : `translate([0, 0, -0.1]) ${inner}`;
      return `difference() { cylinder(h=${fmt(spec.height)}, r=${fmt(spec.outerRadius)}, center=${spec.center}); ${innerShift}; }`;
    }
    case 'wedge': {
      const tri = `[[0, 0], [${fmt(spec.size[0])}, 0], [0, ${fmt(spec.size[1])}]]`;
      const body = `linear_extrude(${fmt(spec.size[2])}) polygon(${tri})`;
      return spec.center
        ? `translate([${fmt(-spec.size[0] / 2)}, ${fmt(-spec.size[1] / 2)}, ${fmt(-spec.size[2] / 2)}]) ${body}`
        : body;
    }
    case 'pyramid':
      return `linear_extrude(${fmt(spec.height)}, scale=0, center=${spec.center}) square([${fmt(spec.baseSize)}, ${fmt(spec.baseSize)}], center=true)`;
    case 'polygon':
      // SCAD cylinder with $fn is a regular polygon prism (the cheapest path).
      return `cylinder(h=${fmt(spec.height)}, r=${fmt(spec.radius)}, center=${spec.center}, $fn=${Math.max(3, Math.floor(spec.sides))})`;
    case 'hemisphere': {
      const R = spec.radius;
      const cutter = `translate([${fmt(-R)}, ${fmt(-R)}, 0]) cube([${fmt(2 * R)}, ${fmt(2 * R)}, ${fmt(R)}])`;
      const inside = `intersection() { sphere(r=${fmt(R)}); ${cutter}; }`;
      return spec.center ? `translate([0, 0, ${fmt(-R / 2)}]) ${inside}` : inside;
    }
    case 'tetrahedron': {
      // 4 corners of the cube [-s,s]^3 (alternating) form a regular tetrahedron
      // with bounding-box edge 2s, edge length 2s·√2.
      const s = spec.size / 2;
      const pts = `[[${fmt(s)}, ${fmt(s)}, ${fmt(s)}], [${fmt(-s)}, ${fmt(-s)}, ${fmt(s)}], [${fmt(-s)}, ${fmt(s)}, ${fmt(-s)}], [${fmt(s)}, ${fmt(-s)}, ${fmt(-s)}]]`;
      const faces = `[[0, 2, 1], [0, 1, 3], [0, 3, 2], [1, 2, 3]]`;
      return `polyhedron(points=${pts}, faces=${faces})`;
    }
    case 'star': {
      const pts = starPoints(spec.points, spec.outerRadius, spec.innerRadius);
      return `linear_extrude(${fmt(spec.height)}, center=${spec.center}) polygon([${scadVec2List(pts)}])`;
    }
  }
}

/** OpenSCAD: `translate([...]) <call>; // part: <name>` */
export function emitPrimitiveScad(spec: PrimitiveSpec): string {
  const call = scadPrimitiveCall(spec);
  const body = isZero(spec.position) ? `${call};` : `translate(${vec(spec.position!)}) ${call};`;
  return `${body} // part: ${spec.name}`;
}

// ---------------------------------------------------------------------------
// BREP (replicad) primitives
// ---------------------------------------------------------------------------

/** Build the `api.BREP.*` construction expression (no trailing `;`). Only the
 *  four kernel built-ins are supported — the palette hides the rest for BREP.
 *  `BREP.box`/`cylinder`/`cone` sit base-on-origin (z: 0→h) and are centred in
 *  X/Y; `BREP.sphere` is fully centred — so we emulate our spec's `center`
 *  flag with the same translate trick the JS path uses. */
function brepPrimitiveExpr(spec: PrimitiveSpec): string {
  let expr: string;
  let centerShift: Vec3 = [0, 0, 0];

  switch (spec.kind) {
    case 'cube':
      expr = `BREP.box(${vec(spec.size)})`;
      // BREP.box is centred in X/Y with base at z=0. center=true → centre in Z
      // too; center=false → shift so the corner sits at the origin (matching
      // Manifold.cube's uncentred convention).
      centerShift = spec.center
        ? [0, 0, -spec.size[2] / 2]
        : [spec.size[0] / 2, spec.size[1] / 2, 0];
      break;
    case 'sphere':
      expr = `BREP.sphere(${fmt(spec.radius)})`;
      break;
    case 'cylinder':
      expr = `BREP.cylinder(${fmt(spec.radius)}, ${fmt(spec.height)})`;
      if (spec.center) centerShift = [0, 0, -spec.height / 2];
      break;
    case 'cone':
      expr = `BREP.cone(${fmt(spec.radiusBottom)}, ${fmt(spec.radiusTop)}, ${fmt(spec.height)})`;
      if (spec.center) centerShift = [0, 0, -spec.height / 2];
      break;
    case 'torus':
      // BREP.torus(majorR, minorR) — donut centred on the origin, axis on Z;
      // matches our torus convention so only the position translate applies.
      expr = `BREP.torus(${fmt(spec.majorRadius)}, ${fmt(spec.tubeRadius)})`;
      break;
    default:
      throw new Error(`BREP insert does not support "${spec.kind}".`);
  }

  const shift: Vec3 = [
    (spec.position?.[0] ?? 0) + centerShift[0],
    (spec.position?.[1] ?? 0) + centerShift[1],
    (spec.position?.[2] ?? 0) + centerShift[2],
  ];
  if (!isZero(shift)) expr += `.translate(${vec(shift)})`;
  return expr;
}

/** replicad: `const <name> = <expr>;` (same shape as the JS path). */
export function emitPrimitiveBrep(spec: PrimitiveSpec): string {
  return `const ${spec.name} = ${brepPrimitiveExpr(spec)};`;
}

// ---------------------------------------------------------------------------
// Voxel primitives
// ---------------------------------------------------------------------------

/** Build the `v.<method>(…)` statement that fills `spec` into the grid `gridVar`
 *  (default `v`), tagged with `// part: <name>` so the operand scanner can find
 *  it. Coordinates round to integer voxels (1 unit = 1 voxel). Only the four
 *  voxel-friendly kinds are supported — the palette hides the rest. */
export function emitPrimitiveVoxel(spec: PrimitiveSpec, gridVar = 'v', color = VOXEL_DEFAULT_COLOR): string {
  const px = spec.position?.[0] ?? 0;
  const py = spec.position?.[1] ?? 0;
  const pz = spec.position?.[2] ?? 0;
  const col = `'${color}'`;
  let call: string;

  switch (spec.kind) {
    case 'cube': {
      // Inclusive fillBox: `size` voxels per axis. Centre on the position when
      // `center`, else grow from it in +X/+Y/+Z (Manifold.cube convention).
      const ex = Math.max(1, vox(spec.size[0]));
      const ey = Math.max(1, vox(spec.size[1]));
      const ez = Math.max(1, vox(spec.size[2]));
      const x0 = vox(px - (spec.center ? spec.size[0] / 2 : 0));
      const y0 = vox(py - (spec.center ? spec.size[1] / 2 : 0));
      const z0 = vox(pz - (spec.center ? spec.size[2] / 2 : 0));
      call = `${gridVar}.fillBox([${x0}, ${y0}, ${z0}], [${x0 + ex - 1}, ${y0 + ey - 1}, ${z0 + ez - 1}], ${col})`;
      break;
    }
    case 'sphere':
      call = `${gridVar}.sphere([${vox(px)}, ${vox(py)}, ${vox(pz)}], ${vox(spec.radius)}, ${col})`;
      break;
    case 'cylinder': {
      const base = spec.center ? pz - spec.height / 2 : pz;
      call = `${gridVar}.cylinder([${vox(px)}, ${vox(py)}, ${vox(base)}], ${vox(spec.radius)}, ${Math.max(1, vox(spec.height))}, ${col}, 'z')`;
      break;
    }
    case 'torus': {
      // No direct grid primitive — rasterize an SDF torus (centred in XY) into
      // the grid. SDF sampling is continuous so radii/position stay unrounded.
      const node = `api.sdf.torus(${fmt(spec.majorRadius)}, ${fmt(spec.tubeRadius)})`;
      const placed = isZero(spec.position) ? node : `${node}.translate(${vec(spec.position!)})`;
      call = `${gridVar}.sdf(${placed}, { color: ${col} })`;
      break;
    }
    default:
      throw new Error(`Voxel insert does not support "${spec.kind}".`);
  }

  return `${call}; // part: ${spec.name}`;
}

export function emitPrimitive(spec: PrimitiveSpec, lang: InsertLanguage): string {
  switch (lang) {
    case 'scad': return emitPrimitiveScad(spec);
    case 'replicad': return emitPrimitiveBrep(spec);
    case 'voxel': return emitPrimitiveVoxel(spec);
    default: return emitPrimitiveJs(spec);
  }
}

// ---------------------------------------------------------------------------
// Enclosures (api.enclosure — the "container" inserts; manifold-js only)
// ---------------------------------------------------------------------------

export type EnclosureKind = 'box' | 'shell' | 'standoff';

export type EnclosureSpec =
  | { kind: 'box'; base: string; lid: string; size: Vec3; wall: number; radius: number; type: 'lip' | 'screw' }
  | { kind: 'shell'; name: string; size: Vec3; wall: number; radius: number; open: 'top' | 'none' }
  | { kind: 'standoff'; name: string; screwSize: string; height: number; bore: 'tap' | 'through' };

/** Default base identifiers for each enclosure insert. `box`'s parts mirror the
 *  builder's own `{ base, lid }` keys so the common case needs no rename. */
export const ENCLOSURE_BASE_NAME: Record<EnclosureKind, string> = {
  box: 'base',
  shell: 'shell',
  standoff: 'post',
};

/** Object-destructure binder: `key` when the bound name matches the property,
 *  else `key: name` (aliasing) so a renamed part still reads the right key. */
function bindKey(key: string, name: string): string {
  return name === key ? key : `${key}: ${name}`;
}

/** Emit the manifold-js declaration for an enclosure insert plus the part
 *  name(s) it introduces (so the palette can fold them into the managed union
 *  and register them). Uses `api.enclosure.*` directly — no destructure to
 *  thread — and `enclosure.box` binds the two returned parts so each is a
 *  pickable part on its own. */
export function emitEnclosure(spec: EnclosureSpec): { decl: string; names: string[] } {
  switch (spec.kind) {
    case 'box': {
      // enclosure.box returns `{ base, lid }`; bind those keys (aliasing when a
      // part was renamed) so each is a real, defined Manifold.
      const decl =
        `const { ${bindKey('base', spec.base)}, ${bindKey('lid', spec.lid)} } = api.enclosure.box(` +
        `{ size: ${vec(spec.size)}, wall: ${fmt(spec.wall)}, radius: ${fmt(spec.radius)}, type: '${spec.type}' });`;
      return { decl, names: [spec.base, spec.lid] };
    }
    case 'shell': {
      const decl =
        `const ${spec.name} = api.enclosure.shell(` +
        `{ size: ${vec(spec.size)}, wall: ${fmt(spec.wall)}, radius: ${fmt(spec.radius)}, open: '${spec.open}' });`;
      return { decl, names: [spec.name] };
    }
    case 'standoff': {
      const decl =
        `const ${spec.name} = api.enclosure.standoff(` +
        `{ size: '${spec.screwSize}', height: ${fmt(spec.height)}, bore: '${spec.bore}' });`;
      return { decl, names: [spec.name] };
    }
  }
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

/** manifold-js: `const <result> = a.<method>(b).<method>(c);`
 *  `subtract` removes every later operand from the first. */
export function emitOperationJs(op: BooleanOpKind, operands: string[], resultName: string): string {
  if (operands.length < 2) {
    throw new Error('emitOperationJs: need at least two operands');
  }
  const method = OP_METHOD[op];
  const chain = operands.slice(1).map(o => `.${method}(${o})`).join('');
  return `const ${resultName} = ${operands[0]}${chain};`;
}

const OP_BREP_METHOD: Record<BooleanOpKind, string> = {
  union: 'fuse',
  subtract: 'cut',
  intersect: 'intersect',
};

/** replicad/BREP: `const <result> = a.fuse(b).cut(c);` — replicad's boolean
 *  methods (`fuse`/`cut`/`intersect`) chain just like the manifold-js path. */
export function emitOperationBrep(op: BooleanOpKind, operands: string[], resultName: string): string {
  if (operands.length < 2) {
    throw new Error('emitOperationBrep: need at least two operands');
  }
  const method = OP_BREP_METHOD[op];
  const chain = operands.slice(1).map(o => `.${method}(${o})`).join('');
  return `const ${resultName} = ${operands[0]}${chain};`;
}

/** OpenSCAD: wrap operand *statements* in a `union(){}`/`difference(){}`/
 *  `intersection(){}` block. `operands` are statement strings (the geometry),
 *  not names. The `// part:` tag is moved onto the block so the result is
 *  itself selectable. */
export function emitOperationScad(op: BooleanOpKind, operands: string[], resultName: string): string {
  if (operands.length < 2) {
    throw new Error('emitOperationScad: need at least two operands');
  }
  const block = OP_SCAD[op];
  const children = operands
    .map(stmt => stmt.replace(/\s*\/\/ part:.*$/, '').trim())
    .map(stmt => `  ${stmt}`)
    .join('\n');
  return `${block}() { // part: ${resultName}\n${children}\n}`;
}

// ---------------------------------------------------------------------------
// Operand discovery (scanning existing code)
// ---------------------------------------------------------------------------

/** manifold-js: list top-level `const <id> = ...` declarations. Best-effort
 *  (regex, not a full parser) — enough to populate the operand picker, and it
 *  re-derives from the live code each call so renames/deletes self-correct. */
export function scanPartsJs(code: string): PartRef[] {
  const out: PartRef[] = [];
  const seen = new Set<string>();
  const push = (name: string) => {
    if (seen.has(name)) return;
    seen.add(name);
    out.push({ name });
  };
  // 1) Plain `const name =` / `let name =` at the start of a (possibly
  //    indented) line.
  const re = /^[ \t]*(?:const|let)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) push(m[1]);
  // 2) Object-destructure binders — `const { base, lid } = enclosure.box(…)`.
  //    Each bound name is a part. Skip `… = api` (that's the sandbox
  //    destructure: `const { Manifold, CrossSection } = api`), whose names are
  //    library handles, not geometry.
  const destr = /^[ \t]*(?:const|let)\s*\{\s*([^}]+?)\s*\}\s*=\s*([^\n;]+)/gm;
  while ((m = destr.exec(code)) !== null) {
    // Skip only the sandbox destructure `const { Manifold, … } = api;` (RHS is
    // exactly `api`). A `… = api.enclosure.box(…)` RHS is real geometry.
    if (/^api$/.test(m[2].trim())) continue;
    for (const raw of m[1].split(',')) {
      // Handle `a: b` aliasing — the *binding* name is after the colon.
      const part = raw.includes(':') ? raw.split(':')[1] : raw;
      const name = part.trim().replace(/^\.\.\./, '');
      if (/^[A-Za-z_$][\w$]*$/.test(name)) push(name);
    }
  }
  return out;
}

/** Voxel: each `v.<method>(…); // part: <name>` line is a part. Returns the
 *  full statement+tag range so a move can re-emit it and a delete can drop the
 *  whole line. */
export function scanPartsVoxel(code: string): PartRef[] {
  const out: PartRef[] = [];
  const re = /^([ \t]*)(\S.*?;)[ \t]*\/\/ part:\s*(.+)$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) {
    const from = m.index + m[1].length;
    const to = m.index + m[0].length;
    out.push({ name: m[3].trim(), statement: m[2], range: { from, to } });
  }
  return out;
}

/** OpenSCAD: split into top-level statements (respecting braces, strings, and
 *  comments) and surface each as a part. A trailing `// part: <name>` comment
 *  supplies the label; otherwise the statement text itself is the label. */
export function scanPartsScad(code: string): PartRef[] {
  const out: PartRef[] = [];
  for (const stmt of splitTopLevelScad(code)) {
    const tag = /\/\/ part:\s*([^\n]+)$/.exec(stmt.text.trim());
    const name = tag ? tag[1].trim() : summarizeStatement(stmt.text);
    out.push({ name, statement: stmt.text, range: { from: stmt.from, to: stmt.to } });
  }
  return out;
}

export function scanParts(code: string, lang: InsertLanguage): PartRef[] {
  switch (lang) {
    case 'scad': return scanPartsScad(code);
    case 'voxel': return scanPartsVoxel(code);
    // manifold-js and replicad share the same `const <name> = …;` syntax.
    default: return scanPartsJs(code);
  }
}

interface ScadStatement {
  text: string;
  from: number;
  to: number;
}

/** Walk SCAD source and split it into top-level statements. A statement ends
 *  at a top-level `;` or at the `}` that closes a top-level `{...}` block.
 *  Tracks string and comment state so punctuation inside them is ignored. */
export function splitTopLevelScad(code: string): ScadStatement[] {
  const out: ScadStatement[] = [];
  let depth = 0;
  let start = 0;
  let i = 0;
  const n = code.length;

  const pushStmt = (end: number) => {
    const raw = code.slice(start, end);
    if (raw.trim().length > 0) out.push({ text: raw.trim(), from: start, to: end });
    start = end;
  };

  while (i < n) {
    const c = code[i];
    const next = code[i + 1];

    // Line comment
    if (c === '/' && next === '/') {
      const nl = code.indexOf('\n', i);
      i = nl === -1 ? n : nl;
      continue;
    }
    // Block comment
    if (c === '/' && next === '*') {
      const close = code.indexOf('*/', i + 2);
      i = close === -1 ? n : close + 2;
      continue;
    }
    // String
    if (c === '"') {
      i++;
      while (i < n && code[i] !== '"') {
        if (code[i] === '\\') i++;
        i++;
      }
      i++;
      continue;
    }
    if (c === '{') {
      depth++;
      i++;
      continue;
    }
    if (c === '}') {
      depth = Math.max(0, depth - 1);
      i++;
      if (depth === 0) {
        // Include any trailing `// part:` comment on the same line.
        const restStart = i;
        const nl = code.indexOf('\n', restStart);
        const lineEnd = nl === -1 ? n : nl;
        const trailing = code.slice(restStart, lineEnd);
        if (/^\s*(\/\/[^\n]*)?$/.test(trailing)) i = lineEnd;
        pushStmt(i);
      }
      continue;
    }
    if (c === ';' && depth === 0) {
      i++;
      // Pull a trailing same-line comment into this statement.
      const restStart = i;
      const nl = code.indexOf('\n', restStart);
      const lineEnd = nl === -1 ? n : nl;
      const trailing = code.slice(restStart, lineEnd);
      if (/^\s*\/\/[^\n]*$/.test(trailing)) i = lineEnd;
      pushStmt(i);
      continue;
    }
    i++;
  }
  // Trailing non-terminated remainder (rare; ignore pure whitespace).
  if (start < n && code.slice(start).trim().length > 0) {
    out.push({ text: code.slice(start).trim(), from: start, to: n });
  }
  return out;
}

function summarizeStatement(text: string): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length > 40 ? `${oneLine.slice(0, 37)}…` : oneLine;
}
