// Best-effort statement → PrimitiveSpec inverter. Lets arrange mode pick up
// hand-written parts (typed straight into the editor) instead of only the
// palette-inserted ones whose specs we kept in memory.
//
// Pure, dependency-free, regex-based. Each parser is the rough inverse of the
// matching `emitPrimitive*` in codegen.ts and handles only the common patterns
// that emit produces — anything fancier (rotations, chained transforms, JS
// expressions with computed args) falls through as `null` and the part stays
// unregistered. Callers treat null as "not arrangeable; skip silently."
//
// Scope per language:
//   - voxel: `v.fillBox`, `v.sphere`, `v.cylinder`, `v.sdf(api.sdf.torus(...))`
//   - scad:  optional leading `translate([…])` then `cube([…], center=…)` /
//            `sphere(r=…)` / `cylinder(h=…, r=…, center=…)`
//   - JS:    optional `const x = Manifold.cube({…} or [...])` / sphere / cylinder /
//            cone with optional trailing `.translate([…])`
//
// Exercised by tests/insert-codegen.spec.ts.

import type { PrimitiveSpec, Vec3, InsertLanguage } from './codegen';

/** Parse a single statement (one line of voxel/scad, or one JS declaration RHS
 *  expression) back into a PrimitiveSpec. Returns null for any shape we don't
 *  recognize — callers degrade gracefully (the part stays out of arrange mode's
 *  registry, but isn't a hard error). */
export function parseStatement(statement: string, lang: InsertLanguage, name: string): PrimitiveSpec | null {
  if (!statement) return null;
  switch (lang) {
    case 'voxel': return parseVoxelStatement(statement, name);
    case 'scad': return parseScadStatement(statement, name);
    case 'manifold-js':
    case 'replicad': return parseJsStatement(statement, name);
  }
}

// ---------------------------------------------------------------------------
// Voxel: statement forms emitted by emitPrimitiveVoxel
// ---------------------------------------------------------------------------

const NUM = String.raw`-?\d+(?:\.\d+)?`;
const VEC3 = String.raw`\[\s*(${NUM})\s*,\s*(${NUM})\s*,\s*(${NUM})\s*\]`;

function parseVoxelStatement(stmt: string, name: string): PrimitiveSpec | null {
  // v.fillBox([x0,y0,z0], [x1,y1,z1], '#color')
  const box = new RegExp(`\\.\\s*fillBox\\s*\\(\\s*${VEC3}\\s*,\\s*${VEC3}`).exec(stmt);
  if (box) {
    const [x0, y0, z0, x1, y1, z1] = box.slice(1).map(Number);
    // fillBox is inclusive, so size = max - min + 1 voxels.
    return {
      kind: 'cube',
      name,
      size: [x1 - x0 + 1, y1 - y0 + 1, z1 - z0 + 1],
      // Position is the un-centered corner; treat as center=false so the
      // registry bbox reads back identically to what was emitted.
      position: [x0, y0, z0],
      center: false,
    };
  }
  // v.sphere([cx,cy,cz], r, '#color')
  const sph = new RegExp(`\\.\\s*sphere\\s*\\(\\s*${VEC3}\\s*,\\s*(${NUM})`).exec(stmt);
  if (sph) {
    const [cx, cy, cz, r] = sph.slice(1).map(Number);
    return { kind: 'sphere', name, radius: r, position: [cx, cy, cz] };
  }
  // v.cylinder([cx,cy,base_z], r, h, '#color', 'z')
  const cyl = new RegExp(`\\.\\s*cylinder\\s*\\(\\s*${VEC3}\\s*,\\s*(${NUM})\\s*,\\s*(${NUM})`).exec(stmt);
  if (cyl) {
    const [cx, cy, base, r, h] = cyl.slice(1).map(Number);
    return {
      kind: 'cylinder',
      name,
      radius: r,
      height: h,
      position: [cx, cy, base],
      center: false,
    };
  }
  // v.sdf(api.sdf.torus(major, minor)[.translate([x,y,z])], { color: '...' })
  const torus = /api\.sdf\.torus\s*\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)/.exec(stmt);
  if (torus) {
    const major = Number(torus[1]);
    const minor = Number(torus[2]);
    const pos = new RegExp(`\\.translate\\s*\\(\\s*${VEC3}\\s*\\)`).exec(stmt);
    return {
      kind: 'torus',
      name,
      majorRadius: major,
      tubeRadius: minor,
      segments: 64,
      position: pos ? [Number(pos[1]), Number(pos[2]), Number(pos[3])] : [0, 0, 0],
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// SCAD: statement forms emitted by emitPrimitiveScad
// ---------------------------------------------------------------------------

function parseScadStatement(stmt: string, name: string): PrimitiveSpec | null {
  // Strip the trailing `// part: …` comment + trailing `;` so the remainder
  // is just the construction call (optionally wrapped in translate).
  let body = stmt.replace(/\/\/.*$/, '').trim();
  body = body.replace(/;\s*$/, '');
  let position: Vec3 = [0, 0, 0];
  const tr = new RegExp(`^translate\\s*\\(\\s*${VEC3}\\s*\\)\\s*`).exec(body);
  if (tr) {
    position = [Number(tr[1]), Number(tr[2]), Number(tr[3])];
    body = body.slice(tr[0].length);
  }
  // cube([x,y,z], center=true|false)
  const cube = new RegExp(`^cube\\s*\\(\\s*${VEC3}(?:\\s*,\\s*center\\s*=\\s*(true|false))?\\s*\\)$`).exec(body);
  if (cube) {
    return {
      kind: 'cube',
      name,
      size: [Number(cube[1]), Number(cube[2]), Number(cube[3])],
      center: cube[4] === 'true',
      position,
    };
  }
  // sphere(r=…)
  const sph = new RegExp(`^sphere\\s*\\(\\s*r\\s*=\\s*(${NUM})\\s*\\)$`).exec(body);
  if (sph) return { kind: 'sphere', name, radius: Number(sph[1]), position };
  // cylinder(h=…, r=…, center=true|false)
  const cyl = new RegExp(
    `^cylinder\\s*\\(\\s*h\\s*=\\s*(${NUM})\\s*,\\s*r\\s*=\\s*(${NUM})(?:\\s*,\\s*center\\s*=\\s*(true|false))?\\s*\\)$`,
  ).exec(body);
  if (cyl) {
    return {
      kind: 'cylinder',
      name,
      height: Number(cyl[1]),
      radius: Number(cyl[2]),
      center: cyl[3] === 'true',
      position,
    };
  }
  // cylinder(h=…, r1=…, r2=…, center=…) — a cone in our spec
  const cone = new RegExp(
    `^cylinder\\s*\\(\\s*h\\s*=\\s*(${NUM})\\s*,\\s*r1\\s*=\\s*(${NUM})\\s*,\\s*r2\\s*=\\s*(${NUM})(?:\\s*,\\s*center\\s*=\\s*(true|false))?\\s*\\)$`,
  ).exec(body);
  if (cone) {
    return {
      kind: 'cone',
      name,
      height: Number(cone[1]),
      radiusBottom: Number(cone[2]),
      radiusTop: Number(cone[3]),
      center: cone[4] === 'true',
      position,
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// JS / BREP: RHS expression following `const <name> = …`
// ---------------------------------------------------------------------------

function parseJsStatement(stmt: string, name: string): PrimitiveSpec | null {
  // Statement looks like `const foo = Manifold.cube({...}).translate([...]);` —
  // or, for BREP, `const foo = BREP.cube([...]).translate([...]);`. We strip
  // the declaration head and trailing `;` to leave the expression chain.
  const decl = /^\s*(?:const|let)\s+[A-Za-z_$][A-Za-z0-9_$]*\s*=\s*(.+?);?\s*$/s.exec(stmt);
  const expr = decl ? decl[1].trim() : stmt.trim();
  // Pull out any trailing `.translate([x,y,z])` first; the construction call
  // is whatever's left. (We only support a single translate suffix — anything
  // more elaborate like .rotate() or compound transforms is out of scope here.)
  let position: Vec3 = [0, 0, 0];
  const trMatch = new RegExp(`\\.translate\\s*\\(\\s*${VEC3}\\s*\\)\\s*$`).exec(expr);
  let head = expr;
  if (trMatch) {
    position = [Number(trMatch[1]), Number(trMatch[2]), Number(trMatch[3])];
    head = expr.slice(0, trMatch.index);
  }
  head = head.trim();
  // Note: we deliberately don't strip *other* trailing `.method()` calls. If
  // the user chained `.rotate()` / `.color()` / `.simplify()`, the construction
  // call no longer matches our anchored regexes and the parse returns null —
  // arrange mode then skips the part instead of moving it under an incorrect
  // bounding box. Adding broader chain support belongs in a follow-up that can
  // also extend the per-engine codegen writers to honour those transforms.

  // Manifold.cube([x,y,z], centered?) / Manifold.cube({size: [...], center?})
  const cubeArr = new RegExp(`^(?:Manifold|BREP)\\.cube\\s*\\(\\s*${VEC3}(?:\\s*,\\s*(true|false))?\\s*\\)$`).exec(head);
  if (cubeArr) {
    return {
      kind: 'cube',
      name,
      size: [Number(cubeArr[1]), Number(cubeArr[2]), Number(cubeArr[3])],
      center: cubeArr[4] === 'true',
      position,
    };
  }
  const cubeObj = /^(?:Manifold|BREP)\.cube\s*\(\s*\{([^{}]+)\}\s*\)$/.exec(head);
  if (cubeObj) {
    const opts = cubeObj[1];
    const sz = new RegExp(`size\\s*:\\s*${VEC3}`).exec(opts);
    if (sz) {
      const cen = /center\s*:\s*(true|false)/.exec(opts);
      return {
        kind: 'cube',
        name,
        size: [Number(sz[1]), Number(sz[2]), Number(sz[3])],
        center: cen ? cen[1] === 'true' : false,
        position,
      };
    }
  }
  // Manifold.sphere(r) — and BREP.sphere(r)
  const sphArg = new RegExp(`^(?:Manifold|BREP)\\.sphere\\s*\\(\\s*(${NUM})\\s*\\)$`).exec(head);
  if (sphArg) return { kind: 'sphere', name, radius: Number(sphArg[1]), position };
  // Manifold.sphere({radius: r})
  const sphObj = /^Manifold\.sphere\s*\(\s*\{([^{}]+)\}\s*\)$/.exec(head);
  if (sphObj) {
    const r = new RegExp(`radius\\s*:\\s*(${NUM})`).exec(sphObj[1]);
    if (r) return { kind: 'sphere', name, radius: Number(r[1]), position };
  }
  // Manifold.cylinder(h, r) — Manifold-JS positional form
  const cylJs = new RegExp(`^Manifold\\.cylinder\\s*\\(\\s*(${NUM})\\s*,\\s*(${NUM})\\s*\\)$`).exec(head);
  if (cylJs) {
    return {
      kind: 'cylinder',
      name,
      height: Number(cylJs[1]),
      radius: Number(cylJs[2]),
      center: false,
      position,
    };
  }
  // BREP.cylinder(r, h) — note arg order is flipped vs Manifold
  const cylBrep = new RegExp(`^BREP\\.cylinder\\s*\\(\\s*(${NUM})\\s*,\\s*(${NUM})\\s*\\)$`).exec(head);
  if (cylBrep) {
    return {
      kind: 'cylinder',
      name,
      radius: Number(cylBrep[1]),
      height: Number(cylBrep[2]),
      center: false,
      position,
    };
  }
  // Manifold.cylinder({height: h, radius: r, center?})
  const cylObj = /^Manifold\.cylinder\s*\(\s*\{([^{}]+)\}\s*\)$/.exec(head);
  if (cylObj) {
    const opts = cylObj[1];
    const h = new RegExp(`height\\s*:\\s*(${NUM})`).exec(opts);
    const r = new RegExp(`radius\\s*:\\s*(${NUM})`).exec(opts);
    if (h && r) {
      const cen = /center\s*:\s*(true|false)/.exec(opts);
      return {
        kind: 'cylinder',
        name,
        height: Number(h[1]),
        radius: Number(r[1]),
        center: cen ? cen[1] === 'true' : false,
        position,
      };
    }
  }
  // BREP.cone(rBottom, rTop, h)
  const coneBrep = new RegExp(`^BREP\\.cone\\s*\\(\\s*(${NUM})\\s*,\\s*(${NUM})\\s*,\\s*(${NUM})\\s*\\)$`).exec(head);
  if (coneBrep) {
    return {
      kind: 'cone',
      name,
      radiusBottom: Number(coneBrep[1]),
      radiusTop: Number(coneBrep[2]),
      height: Number(coneBrep[3]),
      center: false,
      position,
    };
  }
  // (Manifold|BREP).torus(major, minor)
  const torus = new RegExp(`^(?:Manifold|BREP)\\.torus\\s*\\(\\s*(${NUM})\\s*,\\s*(${NUM})\\s*\\)$`).exec(head);
  if (torus) {
    return {
      kind: 'torus',
      name,
      majorRadius: Number(torus[1]),
      tubeRadius: Number(torus[2]),
      segments: 64,
      position,
    };
  }
  return null;
}
