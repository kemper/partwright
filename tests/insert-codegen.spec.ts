// Unit tests for the click-to-insert codegen. Pure module, runs in Node
// (no browser) like tests/patch.spec.ts.

import { test, expect } from 'playwright/test';
import {
  emitPrimitive,
  emitPrimitiveJs,
  emitPrimitiveScad,
  emitOperationJs,
  emitOperationScad,
  scanPartsJs,
  scanPartsScad,
  splitTopLevelScad,
  uniqueName,
  sanitizeName,
  fmt,
  ringPoints,
  starPoints,
  type PrimitiveSpec,
} from '../src/insert/codegen';
import {
  addJsDeclaration,
  ensureManifoldDestructure,
  ensureCrossSectionDestructure,
  isSimpleReturnExpr,
  isAdditiveReturnExpr,
  appendScadStatement,
  replaceScadRanges,
  setPartTranslateDeltaJs,
  setPartTranslateDeltaScad,
  mirrorPartJs,
  mirrorPartScad,
  duplicatePartJs,
  duplicatePartScad,
  removeJsDeclaration,
  removeScadStatement,
} from '../src/insert/controller';
import { primitiveEntry, unionBoxes, pickPart, translateEntry, type RegistryEntry } from '../src/insert/spatial';

test.describe('fmt', () => {
  test('trims trailing zeros and normalizes -0', () => {
    expect(fmt(10)).toBe('10');
    expect(fmt(2.5)).toBe('2.5');
    expect(fmt(-0)).toBe('0');
    expect(fmt(1 / 3)).toBe('0.3333');
  });
});

test.describe('emitPrimitive — manifold-js', () => {
  test('cube with center', () => {
    const spec: PrimitiveSpec = { kind: 'cube', name: 'box1', size: [10, 10, 10], center: true };
    expect(emitPrimitiveJs(spec)).toBe('const box1 = Manifold.cube([10, 10, 10], true);');
  });

  test('sphere', () => {
    const spec: PrimitiveSpec = { kind: 'sphere', name: 'ball1', radius: 6 };
    expect(emitPrimitiveJs(spec)).toBe('const ball1 = Manifold.sphere(6);');
  });

  test('uniform cylinder uses two-arg form', () => {
    const spec: PrimitiveSpec = { kind: 'cylinder', name: 'cyl1', height: 20, radius: 4, center: false };
    expect(emitPrimitiveJs(spec)).toBe('const cyl1 = Manifold.cylinder(20, 4);');
  });

  test('centered cylinder shifts down by half height', () => {
    const spec: PrimitiveSpec = { kind: 'cylinder', name: 'cyl1', height: 20, radius: 4, center: true };
    expect(emitPrimitiveJs(spec)).toBe('const cyl1 = Manifold.cylinder(20, 4).translate([0, 0, -10]);');
  });

  test('cone passes both radii', () => {
    const spec: PrimitiveSpec = { kind: 'cone', name: 'cone1', height: 12, radiusBottom: 5, radiusTop: 0, center: false };
    expect(emitPrimitiveJs(spec)).toBe('const cone1 = Manifold.cylinder(12, 5, 0);');
  });

  test('position adds a translate; center+position combine', () => {
    const spec: PrimitiveSpec = { kind: 'cube', name: 'box1', size: [2, 2, 2], center: false, position: [5, 0, -3] };
    expect(emitPrimitiveJs(spec)).toBe('const box1 = Manifold.cube([2, 2, 2], false).translate([5, 0, -3]);');
  });

  test('lang dispatch routes to JS', () => {
    const spec: PrimitiveSpec = { kind: 'sphere', name: 's', radius: 1 };
    expect(emitPrimitive(spec, 'manifold-js')).toBe('const s = Manifold.sphere(1);');
  });
});

test.describe('emitPrimitive — OpenSCAD', () => {
  test('cube tagged with part comment', () => {
    const spec: PrimitiveSpec = { kind: 'cube', name: 'box1', size: [10, 10, 10], center: true };
    expect(emitPrimitiveScad(spec)).toBe('cube([10, 10, 10], center=true); // part: box1');
  });

  test('cylinder uses native center', () => {
    const spec: PrimitiveSpec = { kind: 'cylinder', name: 'cyl1', height: 20, radius: 4, center: true };
    expect(emitPrimitiveScad(spec)).toBe('cylinder(h=20, r=4, center=true); // part: cyl1');
  });

  test('cone uses r1/r2', () => {
    const spec: PrimitiveSpec = { kind: 'cone', name: 'c1', height: 12, radiusBottom: 5, radiusTop: 0, center: false };
    expect(emitPrimitiveScad(spec)).toBe('cylinder(h=12, r1=5, r2=0, center=false); // part: c1');
  });

  test('position wraps in translate', () => {
    const spec: PrimitiveSpec = { kind: 'sphere', name: 's1', radius: 3, position: [0, 0, 5] };
    expect(emitPrimitiveScad(spec)).toBe('translate([0, 0, 5]) sphere(r=3); // part: s1');
  });
});

test.describe('emitOperation — manifold-js', () => {
  test('union chains add', () => {
    expect(emitOperationJs('union', ['box1', 'ball1'], 'u1')).toBe('const u1 = box1.add(ball1);');
  });

  test('subtract removes the rest from the first', () => {
    expect(emitOperationJs('subtract', ['box1', 'ball1', 'cyl1'], 'cut1'))
      .toBe('const cut1 = box1.subtract(ball1).subtract(cyl1);');
  });

  test('intersect chains intersect', () => {
    expect(emitOperationJs('intersect', ['a', 'b'], 'i1')).toBe('const i1 = a.intersect(b);');
  });

  test('throws with fewer than two operands', () => {
    expect(() => emitOperationJs('union', ['only'], 'r')).toThrow(/two operands/);
  });
});

test.describe('emitOperation — OpenSCAD', () => {
  test('difference wraps statements, stripping their part tags', () => {
    const out = emitOperationScad(
      'subtract',
      ['cube([10, 10, 10], center=true); // part: box1', 'sphere(r=6); // part: ball1'],
      'cut1',
    );
    expect(out).toBe('difference() { // part: cut1\n  cube([10, 10, 10], center=true);\n  sphere(r=6);\n}');
  });

  test('union block', () => {
    const out = emitOperationScad('union', ['cube([1,1,1]);', 'sphere(r=1);'], 'u1');
    expect(out).toBe('union() { // part: u1\n  cube([1,1,1]);\n  sphere(r=1);\n}');
  });
});

test.describe('scanPartsJs', () => {
  test('finds top-level const declarations, skips destructure of api members', () => {
    const code = [
      'const { Manifold } = api;',
      'const box1 = Manifold.cube([10,10,10], true);',
      'const ball1 = Manifold.sphere(6);',
      'return box1.subtract(ball1);',
    ].join('\n');
    const names = scanPartsJs(code).map(p => p.name);
    // The destructure binds `Manifold` (inside braces) — our line regex sees
    // the `const {` and does NOT capture a name from it.
    expect(names).toContain('box1');
    expect(names).toContain('ball1');
    expect(names).not.toContain('Manifold');
  });

  test('dedupes repeated names', () => {
    const code = 'const a = 1;\nconst a = 2;';
    expect(scanPartsJs(code).map(p => p.name)).toEqual(['a']);
  });
});

test.describe('splitTopLevelScad / scanPartsScad', () => {
  test('splits simple statements', () => {
    const code = 'cube([1,1,1]);\nsphere(r=2);';
    const stmts = splitTopLevelScad(code).map(s => s.text);
    expect(stmts).toEqual(['cube([1,1,1]);', 'sphere(r=2);']);
  });

  test('keeps a brace block as one statement', () => {
    const code = 'difference() {\n  cube([2,2,2]);\n  sphere(r=1);\n}\ncube([1,1,1]);';
    const stmts = splitTopLevelScad(code).map(s => s.text);
    expect(stmts.length).toBe(2);
    expect(stmts[0].startsWith('difference()')).toBe(true);
    expect(stmts[1]).toBe('cube([1,1,1]);');
  });

  test('ignores semicolons inside strings and comments', () => {
    const code = 'echo("a;b"); // c;d\ncube([1,1,1]);';
    const stmts = splitTopLevelScad(code).map(s => s.text);
    expect(stmts.length).toBe(2);
  });

  test('part tags become names; untagged statements summarize', () => {
    const code = 'cube([10,10,10]); // part: box1\nsphere(r=3);';
    const parts = scanPartsScad(code);
    expect(parts[0].name).toBe('box1');
    expect(parts[1].name).toBe('sphere(r=3);');
  });
});

test.describe('naming helpers', () => {
  test('uniqueName increments past collisions', () => {
    expect(uniqueName('box', [])).toBe('box');
    expect(uniqueName('box', ['box'])).toBe('box2');
    expect(uniqueName('box', ['box', 'box2', 'box3'])).toBe('box4');
  });

  test('sanitizeName strips unsafe chars and leading digits', () => {
    expect(sanitizeName('my shape!')).toBe('my_shape_');
    expect(sanitizeName('3dthing')).toBe('_3dthing');
    expect(sanitizeName('')).toBe('part');
  });
});

test.describe('controller — JS return management', () => {
  test('isSimpleReturnExpr', () => {
    expect(isSimpleReturnExpr('box1')).toBe(true);
    expect(isSimpleReturnExpr('Manifold.cube([10,10,10], true)')).toBe(true);
    expect(isSimpleReturnExpr('a.subtract(b).union(c).warp(f).hull()')).toBe(false);
  });

  test('ensureManifoldDestructure adds the line only when missing', () => {
    expect(ensureManifoldDestructure('return Manifold.sphere(1);'))
      .toBe('const { Manifold } = api;\nreturn Manifold.sphere(1);');
    const already = 'const { Manifold, CrossSection } = api;\nreturn Manifold.sphere(1);';
    expect(ensureManifoldDestructure(already)).toBe(already);
    const direct = 'return api.Manifold.sphere(1);';
    expect(ensureManifoldDestructure(direct)).toBe(direct);
  });

  test('inserting into the default program repoints the return', () => {
    const code = 'const { Manifold } = api;\nreturn Manifold.cube([10, 10, 10], true);';
    const out = addJsDeclaration(code, 'const ball1 = Manifold.sphere(6);', 'ball1', 'ifSimple');
    expect(out.returnSet).toBe(true);
    expect(out.code).toBe(
      'const { Manifold } = api;\nconst ball1 = Manifold.sphere(6);\nreturn ball1;',
    );
  });

  test('appends a return when none exists', () => {
    const out = addJsDeclaration('const { Manifold } = api;\n', 'const box1 = Manifold.cube([1,1,1], true);', 'box1', 'force');
    expect(out.returnSet).toBe(true);
    expect(out.code).toContain('const box1 = Manifold.cube([1,1,1], true);');
    expect(out.code.trimEnd().endsWith('return box1;')).toBe(true);
  });

  test('ifSimple preserves a complex hand-written return', () => {
    const code = 'const { Manifold } = api;\nconst a = Manifold.cube([1,1,1]);\nreturn a.subtract(foo()).warp(fn).refine(3);';
    const out = addJsDeclaration(code, 'const ball1 = Manifold.sphere(2);', 'ball1', 'ifSimple');
    expect(out.returnSet).toBe(false);
    expect(out.code).toContain('const ball1 = Manifold.sphere(2);');
    expect(out.code).toContain('return a.subtract(foo()).warp(fn).refine(3);');
  });

  test('ignores the word "return" inside comments (default example regression)', () => {
    // The default "Basic shapes demo" has this exact comment, which previously
    // caused the real `return` to be merged into the comment and lost.
    const code = [
      'const { Manifold } = api;',
      'const box = Manifold.cube([10, 10, 10], true);',
      'const result = box.subtract(box);',
      '',
      '// Always return the final Manifold object',
      'return result;',
    ].join('\n');
    const out = addJsDeclaration(code, 'const cut = box.subtract(ball);', 'cut', 'force');
    expect(out.returnSet).toBe(true);
    expect(out.code).toContain('// Always return the final Manifold object');
    expect(out.code).toMatch(/^return cut;$/m);
    expect(out.code).toContain('const cut = box.subtract(ball);');
  });

  test('force overrides even a complex return (used by operations)', () => {
    const code = 'const { Manifold } = api;\nreturn a.subtract(foo()).warp(fn);';
    const out = addJsDeclaration(code, 'const cut1 = box1.subtract(ball1);', 'cut1', 'force');
    expect(out.returnSet).toBe(true);
    expect(out.code).toContain('return cut1;');
    expect(out.code).not.toContain('warp(fn)');
  });
});

test.describe('spatial — 3D pick math', () => {
  test('primitiveEntry for a centered cube is symmetric about the origin', () => {
    const e = primitiveEntry({ kind: 'cube', name: 'b', size: [10, 10, 10], center: true });
    expect(e.box.min).toEqual([-5, -5, -5]);
    expect(e.box.max).toEqual([5, 5, 5]);
    expect(e.center).toEqual([0, 0, 0]);
  });

  test('primitiveEntry for an uncentered cube spans origin→size, shifted by position', () => {
    const e = primitiveEntry({ kind: 'cube', name: 'b', size: [4, 4, 4], center: false, position: [10, 0, 0] });
    expect(e.box.min).toEqual([10, 0, 0]);
    expect(e.box.max).toEqual([14, 4, 4]);
    expect(e.center).toEqual([12, 2, 2]);
  });

  test('primitiveEntry for a centered cylinder spans -h/2..h/2', () => {
    const e = primitiveEntry({ kind: 'cylinder', name: 'c', height: 20, radius: 3, center: true });
    expect(e.box.min).toEqual([-3, -3, -10]);
    expect(e.box.max).toEqual([3, 3, 10]);
  });

  test('pickPart prefers the box that contains the point', () => {
    const reg = new Map<string, RegistryEntry>([
      ['box', primitiveEntry({ kind: 'cube', name: 'box', size: [4, 4, 4], center: false, position: [10, 0, 0] })],
      ['ball', primitiveEntry({ kind: 'sphere', name: 'ball', radius: 3, position: [-10, 0, 0] })],
    ]);
    const valid = new Set(['box', 'ball']);
    expect(pickPart([12, 2, 2], reg, valid)).toBe('box');
    expect(pickPart([-10, 0, 0], reg, valid)).toBe('ball');
  });

  test('pickPart ignores names absent from the live code', () => {
    const reg = new Map<string, RegistryEntry>([
      ['ball', primitiveEntry({ kind: 'sphere', name: 'ball', radius: 3, position: [-10, 0, 0] })],
    ]);
    expect(pickPart([-10, 0, 0], reg, new Set())).toBeNull();
  });

  test('unionBoxes wraps all operands', () => {
    const a = primitiveEntry({ kind: 'cube', name: 'a', size: [2, 2, 2], center: true });
    const b = primitiveEntry({ kind: 'cube', name: 'b', size: [2, 2, 2], center: false, position: [10, 10, 10] });
    const u = unionBoxes([a, b]);
    expect(u?.box.min).toEqual([-1, -1, -1]);
    expect(u?.box.max).toEqual([12, 12, 12]);
  });
});

test.describe('controller — move part (translate delta)', () => {
  test('JS: bumps an existing trailing translate', () => {
    const code = 'const { Manifold } = api;\nconst box = Manifold.cube([10, 10, 10], true).translate([5, 0, 0]);\nreturn box;';
    const out = setPartTranslateDeltaJs(code, 'box', [1, 2, 3]);
    expect(out).toContain('.translate([6, 2, 3])');
  });

  test('JS: appends a translate when the part has none', () => {
    const code = 'const { Manifold } = api;\nconst ball = Manifold.sphere(6);\nreturn ball;';
    const out = setPartTranslateDeltaJs(code, 'ball', [1, 0, -2]);
    expect(out).toContain('const ball = Manifold.sphere(6).translate([1, 0, -2]);');
  });

  test('JS: can move an operation result', () => {
    const code = 'const cut = box.subtract(ball);\nreturn cut;';
    const out = setPartTranslateDeltaJs(code, 'cut', [0, 0, 5]);
    expect(out).toContain('const cut = box.subtract(ball).translate([0, 0, 5]);');
  });

  test('JS: unknown part name is a no-op', () => {
    const code = 'const a = Manifold.sphere(1);\nreturn a;';
    expect(setPartTranslateDeltaJs(code, 'zzz', [1, 1, 1])).toBe(code);
  });

  test('SCAD: bumps a leading translate', () => {
    const code = 'translate([5, 0, 0]) cube([1,1,1]); // part: box1';
    const range = { from: 0, to: code.length };
    const out = setPartTranslateDeltaScad(code, range, [0, 0, 2]);
    expect(out).toBe('translate([5, 0, 2]) cube([1,1,1]); // part: box1');
  });

  test('SCAD: prepends a translate when the statement has none', () => {
    const code = 'cube([1,1,1]); // part: box1';
    const range = { from: 0, to: code.length };
    const out = setPartTranslateDeltaScad(code, range, [1, 0, 0]);
    expect(out).toBe('translate([1, 0, 0]) cube([1,1,1]); // part: box1');
  });
});

test.describe('spatial — translateEntry', () => {
  test('shifts center and bbox by the delta', () => {
    const e = primitiveEntry({ kind: 'cube', name: 'b', size: [2, 2, 2], center: true });
    const moved = translateEntry(e, [10, 0, -5]);
    expect(moved.center).toEqual([10, 0, -5]);
    expect(moved.box.min).toEqual([9, -1, -6]);
    expect(moved.box.max).toEqual([11, 1, -4]);
  });
});

test.describe('controller — SCAD splicing', () => {
  test('appendScadStatement adds a trailing newline-separated statement', () => {
    expect(appendScadStatement('cube([1,1,1]);', 'sphere(r=2);'))
      .toBe('cube([1,1,1]);\nsphere(r=2);\n');
  });

  test('replaceScadRanges collapses two statements into a block', () => {
    const code = 'cube([10,10,10], center=true); // part: box1\nsphere(r=6); // part: ball1\n';
    const box = { from: 0, to: code.indexOf('\n') };
    const ballStart = code.indexOf('sphere');
    const ball = { from: ballStart, to: code.indexOf('\n', ballStart) };
    const block = 'difference() { // part: cut1\n  cube([10,10,10], center=true);\n  sphere(r=6);\n}';
    const out = replaceScadRanges(code, [box, ball], block);
    expect(out).toContain('difference() { // part: cut1');
    expect(out).not.toContain('// part: box1');
    expect(out.indexOf('difference()')).toBe(0);
  });
});

// ===========================================================================
// Extended shape catalog (Stage A: torus / tube / wedge / pyramid / polygon /
// hemisphere / tetrahedron / star)
// ===========================================================================

test.describe('emitPrimitive — extended shapes (manifold-js)', () => {
  test('torus revolves a circle offset along X', () => {
    const spec: PrimitiveSpec = { kind: 'torus', name: 't1', majorRadius: 10, tubeRadius: 2, segments: 48 };
    expect(emitPrimitiveJs(spec)).toBe('const t1 = CrossSection.circle(2).translate([10, 0]).revolve(48);');
  });

  test('tube subtracts an over-tall inner cylinder to avoid coplanar caps; respects center', () => {
    const spec: PrimitiveSpec = { kind: 'tube', name: 'pipe1', height: 20, outerRadius: 5, innerRadius: 3, center: true };
    expect(emitPrimitiveJs(spec)).toBe(
      'const pipe1 = Manifold.cylinder(20, 5).subtract(Manifold.cylinder(20.2, 3).translate([0, 0, -0.1])).translate([0, 0, -10]);',
    );
  });

  test('wedge extrudes a right-triangle CrossSection', () => {
    const spec: PrimitiveSpec = { kind: 'wedge', name: 'w1', size: [10, 6, 4], center: false };
    expect(emitPrimitiveJs(spec)).toBe('const w1 = CrossSection.ofPolygons([[[0, 0], [10, 0], [0, 6]]]).extrude(4);');
  });

  test('wedge with center shifts the bbox to origin', () => {
    const spec: PrimitiveSpec = { kind: 'wedge', name: 'w1', size: [10, 6, 4], center: true };
    expect(emitPrimitiveJs(spec)).toBe(
      'const w1 = CrossSection.ofPolygons([[[0, 0], [10, 0], [0, 6]]]).extrude(4).translate([-5, -3, -2]);',
    );
  });

  test('pyramid extrudes a centered square with scaleTop=[0,0]', () => {
    const spec: PrimitiveSpec = { kind: 'pyramid', name: 'p1', baseSize: 10, height: 12, center: true };
    expect(emitPrimitiveJs(spec))
      .toBe('const p1 = CrossSection.square([10, 10], true).extrude(12, 1, 0, [0, 0], true);');
  });

  test('polygon prism emits a literal ring of vertices', () => {
    const spec: PrimitiveSpec = { kind: 'polygon', name: 'hex1', sides: 6, radius: 5, height: 4, center: false };
    const out = emitPrimitiveJs(spec);
    expect(out).toContain('CrossSection.ofPolygons([[');
    expect(out).toContain('.extrude(4)');
    // First vertex sits at (radius, 0).
    expect(out).toContain('[5, 0]');
  });

  test('hemisphere is sphere ∩ upper-cube halfspace', () => {
    const spec: PrimitiveSpec = { kind: 'hemisphere', name: 'd1', radius: 6, center: false };
    expect(emitPrimitiveJs(spec)).toBe(
      'const d1 = Manifold.sphere(6).intersect(Manifold.cube([12, 12, 12], true).translate([0, 0, 6]));',
    );
  });

  test('tetrahedron scales the unit Manifold.tetrahedron()', () => {
    const spec: PrimitiveSpec = { kind: 'tetrahedron', name: 'tet1', size: 10 };
    expect(emitPrimitiveJs(spec)).toBe('const tet1 = Manifold.tetrahedron().scale(5);');
  });

  test('tetrahedron at the unit reference omits the scale call', () => {
    const spec: PrimitiveSpec = { kind: 'tetrahedron', name: 'tet1', size: 2 };
    expect(emitPrimitiveJs(spec)).toBe('const tet1 = Manifold.tetrahedron();');
  });

  test('star extrudes 2n alternating outer/inner vertices', () => {
    const spec: PrimitiveSpec = { kind: 'star', name: 's1', points: 5, outerRadius: 5, innerRadius: 2, height: 3, center: false };
    const out = emitPrimitiveJs(spec);
    expect(out).toContain('CrossSection.ofPolygons([[');
    expect(out).toContain('.extrude(3)');
    // First vertex is at +X, outer radius.
    expect(out).toContain('[5, 0]');
  });
});

test.describe('emitPrimitive — extended shapes (OpenSCAD)', () => {
  test('torus → rotate_extrude with $fn', () => {
    const spec: PrimitiveSpec = { kind: 'torus', name: 't1', majorRadius: 10, tubeRadius: 2, segments: 48 };
    expect(emitPrimitiveScad(spec))
      .toBe('rotate_extrude($fn=48) translate([10, 0, 0]) circle(r=2); // part: t1');
  });

  test('tube → difference of two cylinders, cutter overshoots ends when uncentered', () => {
    const spec: PrimitiveSpec = { kind: 'tube', name: 'pipe1', height: 20, outerRadius: 5, innerRadius: 3, center: false };
    expect(emitPrimitiveScad(spec)).toBe(
      'difference() { cylinder(h=20, r=5, center=false); translate([0, 0, -0.1]) cylinder(h=20.2, r=3, center=false); }; // part: pipe1',
    );
  });

  test('wedge → linear_extrude polygon; center wraps the lot in translate', () => {
    const spec: PrimitiveSpec = { kind: 'wedge', name: 'w1', size: [10, 6, 4], center: true };
    expect(emitPrimitiveScad(spec))
      .toBe('translate([-5, -3, -2]) linear_extrude(4) polygon([[0, 0], [10, 0], [0, 6]]); // part: w1');
  });

  test('pyramid → linear_extrude with scale=0', () => {
    const spec: PrimitiveSpec = { kind: 'pyramid', name: 'p1', baseSize: 8, height: 10, center: false };
    expect(emitPrimitiveScad(spec))
      .toBe('linear_extrude(10, scale=0, center=false) square([8, 8], center=true); // part: p1');
  });

  test('polygon prism → cylinder with $fn=sides', () => {
    const spec: PrimitiveSpec = { kind: 'polygon', name: 'hex1', sides: 6, radius: 5, height: 4, center: true };
    expect(emitPrimitiveScad(spec))
      .toBe('cylinder(h=4, r=5, center=true, $fn=6); // part: hex1');
  });

  test('hemisphere → intersection of sphere and lower cube halfspace', () => {
    const spec: PrimitiveSpec = { kind: 'hemisphere', name: 'd1', radius: 6, center: false };
    expect(emitPrimitiveScad(spec)).toBe(
      'intersection() { sphere(r=6); translate([-6, -6, 0]) cube([12, 12, 6]); }; // part: d1',
    );
  });

  test('tetrahedron → polyhedron with 4 cube-corner points', () => {
    const spec: PrimitiveSpec = { kind: 'tetrahedron', name: 'tet1', size: 4 };
    const out = emitPrimitiveScad(spec);
    expect(out).toContain('polyhedron(points=');
    expect(out).toContain('[2, 2, 2]');
    expect(out).toContain('// part: tet1');
  });

  test('star → linear_extrude polygon of star vertices', () => {
    const spec: PrimitiveSpec = { kind: 'star', name: 's1', points: 5, outerRadius: 5, innerRadius: 2, height: 3, center: false };
    const out = emitPrimitiveScad(spec);
    expect(out).toContain('linear_extrude(3, center=false) polygon([');
    expect(out).toContain('// part: s1');
  });
});

test.describe('ringPoints / starPoints', () => {
  test('ringPoints produces n vertices starting at (r, 0)', () => {
    const pts = ringPoints(4, 5);
    expect(pts).toHaveLength(4);
    expect(pts[0][0]).toBeCloseTo(5);
    expect(pts[0][1]).toBeCloseTo(0);
    // Second vertex at 90° → (0, 5).
    expect(pts[1][0]).toBeCloseTo(0);
    expect(pts[1][1]).toBeCloseTo(5);
  });

  test('starPoints alternates outer/inner radii', () => {
    const pts = starPoints(5, 5, 2);
    expect(pts).toHaveLength(10);
    // Even indices are outer (radius 5), odd are inner (radius 2).
    expect(Math.hypot(pts[0][0], pts[0][1])).toBeCloseTo(5);
    expect(Math.hypot(pts[1][0], pts[1][1])).toBeCloseTo(2);
    expect(Math.hypot(pts[2][0], pts[2][1])).toBeCloseTo(5);
  });
});

test.describe('spatial — bbox for extended shapes', () => {
  test('torus bbox spans 2(R+r) in XY and 2r in Z', () => {
    const e = primitiveEntry({ kind: 'torus', name: 't', majorRadius: 10, tubeRadius: 2, segments: 32 });
    expect(e.box.min).toEqual([-12, -12, -2]);
    expect(e.box.max).toEqual([12, 12, 2]);
    expect(e.center).toEqual([0, 0, 0]);
  });

  test('uncentered hemisphere sits Z=0..R', () => {
    const e = primitiveEntry({ kind: 'hemisphere', name: 'd', radius: 6, center: false });
    expect(e.box.min).toEqual([-6, -6, 0]);
    expect(e.box.max).toEqual([6, 6, 6]);
  });

  test('tetrahedron bbox matches the bounding-cube edge', () => {
    const e = primitiveEntry({ kind: 'tetrahedron', name: 'tet', size: 10 });
    expect(e.box.min).toEqual([-5, -5, -5]);
    expect(e.box.max).toEqual([5, 5, 5]);
  });

  test('polygon prism bbox uses the circumscribed radius and centered Z', () => {
    const e = primitiveEntry({ kind: 'polygon', name: 'hex', sides: 6, radius: 4, height: 10, center: true });
    expect(e.box.min).toEqual([-4, -4, -5]);
    expect(e.box.max).toEqual([4, 4, 5]);
  });
});

// ===========================================================================
// Stage B controller helpers (mirror / duplicate / delete + CrossSection
// destructure)
// ===========================================================================

test.describe('ensureCrossSectionDestructure', () => {
  test('adds a fresh destructure line when none exists', () => {
    expect(ensureCrossSectionDestructure('return 1;'))
      .toBe('const { CrossSection } = api;\nreturn 1;');
  });

  test('extends an existing api destructure rather than duplicating it', () => {
    const code = 'const { Manifold } = api;\nreturn Manifold.cube([1,1,1], true);';
    expect(ensureCrossSectionDestructure(code))
      .toBe('const { Manifold, CrossSection } = api;\nreturn Manifold.cube([1,1,1], true);');
  });

  test('no-op when CrossSection is already in scope', () => {
    const code = 'const { Manifold, CrossSection } = api;\nreturn 1;';
    expect(ensureCrossSectionDestructure(code)).toBe(code);
  });
});

test.describe('mirrorPartJs', () => {
  test('inserts .mirror before a trailing .translate so position is preserved', () => {
    const code = 'const { Manifold } = api;\nconst box1 = Manifold.cube([2,2,2], true).translate([5, 0, 0]);\nreturn box1;';
    const out = mirrorPartJs(code, 'box1', [1, 0, 0]);
    expect(out).toContain('Manifold.cube([2,2,2], true).mirror([1, 0, 0]).translate([5, 0, 0]);');
  });

  test('appends .mirror at the RHS end when no translate exists', () => {
    const code = 'const a = Manifold.sphere(1);\nreturn a;';
    const out = mirrorPartJs(code, 'a', [0, 1, 0]);
    expect(out).toContain('const a = Manifold.sphere(1).mirror([0, 1, 0]);');
  });

  test('leaves the code untouched when the name is missing', () => {
    const code = 'const a = Manifold.sphere(1);\nreturn a;';
    expect(mirrorPartJs(code, 'nope', [1, 0, 0])).toBe(code);
  });
});

test.describe('duplicatePartJs', () => {
  test('inserts a translated clone right after the original declaration', () => {
    const code = 'const { Manifold } = api;\nconst a = Manifold.sphere(1);\nreturn a;';
    const out = duplicatePartJs(code, 'a', 'a_copy', [3, 0, 0]);
    expect(out).toContain('const a_copy = a.translate([3, 0, 0]);');
    // Order preserved: declaration before clone before return.
    const idxA = out.indexOf('const a =');
    const idxCopy = out.indexOf('const a_copy');
    const idxRet = out.indexOf('return a;');
    expect(idxA).toBeLessThan(idxCopy);
    expect(idxCopy).toBeLessThan(idxRet);
  });

  test('omits the translate when the offset is zero', () => {
    const code = 'const a = Manifold.sphere(1);\nreturn a;';
    const out = duplicatePartJs(code, 'a', 'a_copy', [0, 0, 0]);
    expect(out).toContain('const a_copy = a;');
  });
});

test.describe('duplicatePartScad', () => {
  test('clones a SCAD statement under a new part tag and offset', () => {
    const code = 'cube([2,2,2], center=true); // part: box1\n';
    const range = { from: 0, to: code.indexOf('\n') };
    const out = duplicatePartScad(code, range, 'box2', [5, 0, 0]);
    expect(out).toContain('cube([2,2,2], center=true); // part: box1');
    expect(out).toContain('translate([5, 0, 0]) cube([2,2,2], center=true); // part: box2');
  });
});

test.describe('removeJsDeclaration', () => {
  test('removes the matching const and repoints a dangling return at the previous part', () => {
    const code = [
      'const { Manifold } = api;',
      'const a = Manifold.cube([1,1,1], true);',
      'const b = Manifold.sphere(1);',
      'return b;',
    ].join('\n');
    const out = removeJsDeclaration(code, 'b');
    expect(out).not.toContain('const b =');
    expect(out).toContain('return a;');
  });

  test('leaves other parts intact when the deleted one was not the return target', () => {
    const code = [
      'const a = Manifold.cube([1,1,1], true);',
      'const b = Manifold.sphere(1);',
      'return a;',
    ].join('\n');
    const out = removeJsDeclaration(code, 'b');
    expect(out).toContain('const a =');
    expect(out).toContain('return a;');
    expect(out).not.toContain('const b =');
  });

  test('no-op when the name is not declared', () => {
    const code = 'const a = Manifold.sphere(1);\nreturn a;';
    expect(removeJsDeclaration(code, 'b')).toBe(code);
  });
});

test.describe('removeScadStatement', () => {
  test('removes the statement at its character range', () => {
    const code = 'cube([2,2,2]); // part: a\nsphere(r=1); // part: b\n';
    const aRange = { from: 0, to: code.indexOf('\n') + 1 };
    const out = removeScadStatement(code, aRange);
    expect(out).not.toContain('// part: a');
    expect(out).toContain('// part: b');
  });
});

test.describe('mirrorPartScad', () => {
  test('inserts mirror() between the leading translate and the construction', () => {
    const code = 'translate([5, 0, 0]) cube([1,1,1]); // part: a';
    const range = { from: 0, to: code.length };
    const out = mirrorPartScad(code, range, [1, 0, 0]);
    expect(out).toBe('translate([5, 0, 0]) mirror([1, 0, 0]) cube([1,1,1]); // part: a');
  });

  test('prepends mirror() when the statement has no translate', () => {
    const code = 'cube([1,1,1]); // part: a';
    const range = { from: 0, to: code.length };
    const out = mirrorPartScad(code, range, [0, 1, 0]);
    expect(out).toBe('mirror([0, 1, 0]) cube([1,1,1]); // part: a');
  });
});

test.describe('addJsDeclaration + CrossSection auto-destructure', () => {
  test('snippet that mentions CrossSection gets the destructure extended', () => {
    const code = 'const { Manifold } = api;\nreturn Manifold.cube([1,1,1], true);';
    const decl = 'const t1 = CrossSection.circle(2).translate([10, 0]).revolve(48);';
    const out = addJsDeclaration(code, decl, 't1', 'force');
    expect(out.code).toContain('const { Manifold, CrossSection } = api;');
    expect(out.code).toContain(decl);
    expect(out.returnSet).toBe(true);
  });

  test('snippet with only Manifold does not add CrossSection', () => {
    const code = 'const { Manifold } = api;\nreturn Manifold.cube([1,1,1], true);';
    const decl = 'const ball = Manifold.sphere(3);';
    const out = addJsDeclaration(code, decl, 'ball', 'force');
    expect(out.code).not.toContain('CrossSection');
  });
});

test.describe('isAdditiveReturnExpr', () => {
  test('matches a bare identifier', () => {
    expect(isAdditiveReturnExpr('box')).toBe(true);
    expect(isAdditiveReturnExpr('  ball ')).toBe(true);
  });
  test('matches a chain of .add(identifier) calls', () => {
    expect(isAdditiveReturnExpr('box.add(ball)')).toBe(true);
    expect(isAdditiveReturnExpr('a.add(b).add(c)')).toBe(true);
    expect(isAdditiveReturnExpr('a . add ( b )')).toBe(true);
  });
  test('rejects constructor calls and unrelated chains', () => {
    expect(isAdditiveReturnExpr('Manifold.cube([1,1,1], true)')).toBe(false);
    expect(isAdditiveReturnExpr('box.subtract(ball)')).toBe(false);
    expect(isAdditiveReturnExpr('a.add(b.translate([1,0,0]))')).toBe(false);
  });
});

test.describe('addJsDeclaration — addOrReplace (additive primitive insert)', () => {
  test('first insert replaces the constructor-call return', () => {
    const code = 'const { Manifold } = api;\nreturn Manifold.cube([10, 10, 10], true);';
    const out = addJsDeclaration(code, 'const wedge = Manifold.cube([1,1,1], true);', 'wedge', 'addOrReplace');
    expect(out.code).toMatch(/return\s+wedge;/);
    expect(out.code).not.toMatch(/Manifold\.cube\(\[10/);
    expect(out.returnSet).toBe(true);
  });

  test('second insert extends a bare-identifier return into a union chain', () => {
    const code = [
      'const { Manifold } = api;',
      'const wedge = Manifold.cube([2,2,2], true);',
      'return wedge;',
    ].join('\n');
    const out = addJsDeclaration(code, 'const cyl = Manifold.cylinder(5, 2);', 'cyl', 'addOrReplace');
    expect(out.code).toContain('const cyl = Manifold.cylinder(5, 2);');
    expect(out.code).toMatch(/return\s+wedge\.add\(cyl\);/);
    expect(out.returnSet).toBe(true);
  });

  test('third insert extends an existing union chain', () => {
    const code = [
      'const a = Manifold.cube([1,1,1], true);',
      'const b = Manifold.sphere(1);',
      'return a.add(b);',
    ].join('\n');
    const out = addJsDeclaration(code, 'const c = Manifold.cylinder(2, 1);', 'c', 'addOrReplace');
    expect(out.code).toMatch(/return\s+a\.add\(b\)\.add\(c\);/);
    expect(out.returnSet).toBe(true);
  });

  test('a custom return (subtract / hand-edited) is left untouched', () => {
    const code = [
      'const a = Manifold.cube([1,1,1], true);',
      'const b = Manifold.sphere(1);',
      'return a.subtract(b);',
    ].join('\n');
    const out = addJsDeclaration(code, 'const c = Manifold.cylinder(2, 1);', 'c', 'addOrReplace');
    expect(out.code).toContain('const c =');
    expect(out.code).toMatch(/return\s+a\.subtract\(b\);/);
    expect(out.returnSet).toBe(false);
  });
});
