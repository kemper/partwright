// Tests for the click-to-insert codegen. The modules under test are pure logic
// (no browser), but this is a Playwright spec that runs in the e2e tier —
// Playwright's Node runner imports them directly and asserts on their string
// output. (It does not live in the vitest unit tier despite being pure-logic.)

import { test, expect } from 'playwright/test';
import {
  emitPrimitive,
  emitPrimitiveJs,
  emitPrimitiveScad,
  emitPrimitiveBrep,
  emitPrimitiveVoxel,
  emitOperationJs,
  emitOperationScad,
  emitOperationBrep,
  emitEnclosure,
  scanPartsJs,
  scanPartsScad,
  scanPartsVoxel,
  splitTopLevelScad,
  shapesFor,
  supportsBooleanOps,
  uniqueName,
  sanitizeName,
  fmt,
  ringPoints,
  starPoints,
  type PrimitiveSpec,
} from '../src/insert/codegen';
import {
  addManagedDeclaration,
  ensureManifoldDestructure,
  ensureCrossSectionDestructure,
  ensureBrepDestructure,
  ensureVoxelScaffold,
  appendVoxelStatement,
  replaceVoxelStatement,
  splitTopLevelCommas,
  appendScadStatement,
  replaceScadRanges,
  setPartTranslateDeltaJs,
  setPartTranslateDeltaScad,
  setPartScaleJs,
  setPartScaleScad,
  mirrorPartJs,
  mirrorPartScad,
  duplicatePartJs,
  duplicatePartScad,
  removeJsDeclaration,
  removeManagedPart,
  removeScadStatement,
} from '../src/insert/controller';
import { primitiveEntry, unionBoxes, pickPart, translateEntry, type RegistryEntry } from '../src/insert/spatial';
import { STARTERS } from '../src/editor/starters';
import { alignDeltas } from '../src/insert/arrangeMath';
import {
  initUndoStack,
  recordOperation,
  undo,
  redo,
  canUndo,
  canRedo,
  peekUndoLabel,
  peekRedoLabel,
  clearUndoHistory,
  __testGetHistoryLength,
  __testGetCursor,
} from '../src/insert/undoStack';

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

test.describe('controller — managed return (addManagedDeclaration)', () => {
  test('splitTopLevelCommas respects nested brackets', () => {
    expect(splitTopLevelCommas('a, b, c').map(s => s.trim())).toEqual(['a', 'b', 'c']);
    expect(splitTopLevelCommas('a, b.translate([1, 2, 3]), c').map(s => s.trim()))
      .toEqual(['a', 'b.translate([1, 2, 3])', 'c']);
  });

  test('ensureManifoldDestructure adds the line only when missing', () => {
    expect(ensureManifoldDestructure('return Manifold.sphere(1);'))
      .toBe('const { Manifold } = api;\nreturn Manifold.sphere(1);');
    const already = 'const { Manifold, CrossSection } = api;\nreturn Manifold.sphere(1);';
    expect(ensureManifoldDestructure(already)).toBe(already);
    const direct = 'return api.Manifold.sphere(1);';
    expect(ensureManifoldDestructure(direct)).toBe(direct);
  });

  test('ensureBrepDestructure adds / extends the api destructure', () => {
    expect(ensureBrepDestructure('return BREP.box([1,1,1]);'))
      .toBe('const { BREP } = api;\nreturn BREP.box([1,1,1]);');
    expect(ensureBrepDestructure('const { Manifold } = api;\nreturn x;'))
      .toBe('const { Manifold, BREP } = api;\nreturn x;');
    const already = 'const { BREP } = api;\nreturn x;';
    expect(ensureBrepDestructure(already)).toBe(already);
  });

  test('first insert replaces the throwaway default placeholder', () => {
    const code = 'const { Manifold } = api;\nreturn Manifold.cube([10, 10, 10], true);';
    const out = addManagedDeclaration(code, 'const ball1 = Manifold.sphere(6);', {
      lang: 'manifold-js', addNames: ['ball1'], combine: true,
    });
    expect(out.returnSet).toBe(true);
    expect(out.code).toBe('const { Manifold } = api;\nconst ball1 = Manifold.sphere(6);\nreturn ball1;');
  });

  test('second insert folds into a readable Manifold.union array', () => {
    const code = 'const { Manifold } = api;\nconst ball1 = Manifold.sphere(6);\nreturn ball1;';
    const out = addManagedDeclaration(code, 'const box2 = Manifold.cube([4,4,4], true);', {
      lang: 'manifold-js', addNames: ['box2'], combine: true,
    });
    expect(out.code).toContain('return Manifold.union([ball1, box2]);');
  });

  test('extends an existing managed union', () => {
    const code = 'const { Manifold } = api;\nconst a = Manifold.cube([1,1,1]);\nreturn Manifold.union([a, b]);';
    const out = addManagedDeclaration(code, 'const c = Manifold.sphere(2);', {
      lang: 'manifold-js', addNames: ['c'], combine: true,
    });
    expect(out.code).toContain('return Manifold.union([a, b, c]);');
  });

  test('NEVER drops existing geometry — folds a real return in (the reported bug)', () => {
    // User had real geometry returned; inserting a box must union with it, not
    // replace it. `widget` is a named part so this is not a placeholder.
    const code = 'const { Manifold } = api;\nconst widget = makeWidget();\nreturn widget;';
    const out = addManagedDeclaration(code, 'const box1 = Manifold.cube([4,4,4], true);', {
      lang: 'manifold-js', addNames: ['box1'], combine: true,
    });
    expect(out.returnSet).toBe(true);
    expect(out.code).toContain('const widget = makeWidget();');
    expect(out.code).toContain('return Manifold.union([widget, box1]);');
  });

  test('wraps a complex hand-written return rather than dropping it', () => {
    const code = 'const { Manifold } = api;\nconst a = Manifold.cube([1,1,1]);\nreturn a.subtract(foo()).warp(fn);';
    const out = addManagedDeclaration(code, 'const ball1 = Manifold.sphere(2);', {
      lang: 'manifold-js', addNames: ['ball1'], combine: true,
    });
    expect(out.code).toContain('return Manifold.union([(a.subtract(foo()).warp(fn)), ball1]);');
  });

  test('NEVER drops a hand-written single-expression return with no named const', () => {
    // The bug variant the old structural heuristic missed: a lone chained
    // constructor return (no intermediate const) is real user geometry, not a
    // throwaway starter — inserting must union with it, never replace it.
    const code = 'const { Manifold } = api;\nreturn Manifold.cube([30, 30, 5], true).translate([0, 0, 2.5]);';
    const out = addManagedDeclaration(code, 'const box1 = Manifold.cube([4,4,4], true);', {
      lang: 'manifold-js', addNames: ['box1'], combine: true,
    });
    expect(out.returnSet).toBe(true);
    expect(out.code).toContain('return Manifold.union([(Manifold.cube([30, 30, 5], true).translate([0, 0, 2.5])), box1]);');
  });

  test('NEVER drops a hand-written single-expression BREP return', () => {
    const code = 'const { BREP } = api;\nreturn BREP.box([30, 30, 5]).fillet(1).translate([0, 0, 2.5]);';
    const out = addManagedDeclaration(code, 'const box1 = BREP.box([4,4,4]);', {
      lang: 'replicad', addNames: ['box1'], combine: true,
    });
    expect(out.returnSet).toBe(true);
    expect(out.code).toContain('return BREP.fuseAll([(BREP.box([30, 30, 5]).fillet(1).translate([0, 0, 2.5])), box1]);');
  });

  test('first insert drops the real seeded starter consistently across engines', () => {
    // isStarterCode matches the actual seeded starters, so the throwaway default
    // is replaced — and js + brep now behave identically (previously brep
    // dropped its BREP.label starter while js kept its api.label one, because
    // the old regex matched one prefix but not the other).
    for (const lang of ['manifold-js', 'replicad'] as const) {
      const starter = STARTERS[lang][0].code;
      const decl = lang === 'replicad'
        ? 'const box1 = BREP.box([4,4,4]);'
        : 'const box1 = Manifold.cube([4,4,4], true);';
      const out = addManagedDeclaration(starter, decl, { lang, addNames: ['box1'], combine: true });
      // Dropped → single element → bare `return box1;` (no union/fuseAll wrapper).
      expect(out.code).toContain('return box1;');
      expect(out.code).not.toMatch(/Manifold\.union|BREP\.fuseAll/);
    }
  });

  test('auto-combine off inserts the const but leaves the return alone', () => {
    const code = 'const { Manifold } = api;\nconst a = Manifold.cube([1,1,1]);\nreturn a;';
    const out = addManagedDeclaration(code, 'const ball1 = Manifold.sphere(2);', {
      lang: 'manifold-js', addNames: ['ball1'], combine: false,
    });
    expect(out.returnSet).toBe(false);
    expect(out.code).toContain('const ball1 = Manifold.sphere(2);');
    expect(out.code).toContain('return a;');
    expect(out.code).not.toContain('union');
  });

  test('operation result replaces its operands in the union', () => {
    const code = 'const { Manifold } = api;\nconst a = Manifold.cube([1,1,1]);\nconst b = Manifold.sphere(1);\nconst c = Manifold.cube([2,2,2]);\nreturn Manifold.union([a, b, c]);';
    const out = addManagedDeclaration(code, 'const merged = a.add(b);', {
      lang: 'manifold-js', addNames: ['merged'], replaceNames: ['a', 'b'], combine: true,
    });
    expect(out.code).toContain('return Manifold.union([c, merged]);');
  });

  test('BREP folds into BREP.fuseAll', () => {
    const code = 'const { BREP } = api;\nconst a = BREP.box([1,1,1]);\nreturn a;';
    const out = addManagedDeclaration(code, 'const b = BREP.sphere(2);', {
      lang: 'replicad', addNames: ['b'], combine: true,
    });
    expect(out.code).toContain('return BREP.fuseAll([a, b]);');
  });

  test('ignores the word "return" inside comments (default example regression)', () => {
    const code = [
      'const { Manifold } = api;',
      'const box = Manifold.cube([10, 10, 10], true);',
      'const result = box.subtract(box);',
      '',
      '// Always return the final Manifold object',
      'return result;',
    ].join('\n');
    const out = addManagedDeclaration(code, 'const ball = Manifold.sphere(2);', {
      lang: 'manifold-js', addNames: ['ball'], combine: true,
    });
    expect(out.code).toContain('// Always return the final Manifold object');
    expect(out.code).toContain('return Manifold.union([result, ball]);');
  });
});

test.describe('controller — removeManagedPart', () => {
  test('prunes the name from the union and drops its const', () => {
    const code = 'const { Manifold } = api;\nconst a = Manifold.cube([1,1,1]);\nconst b = Manifold.sphere(1);\nreturn Manifold.union([a, b]);';
    const out = removeManagedPart(code, 'b', 'manifold-js');
    expect(out).not.toContain('const b =');
    expect(out).toContain('return a;'); // collapses to the lone survivor
  });

  test('keeps the union when 2+ parts remain', () => {
    const code = 'const { Manifold } = api;\nconst a = Manifold.cube([1,1,1]);\nconst b = Manifold.sphere(1);\nconst c = Manifold.cube([2,2,2]);\nreturn Manifold.union([a, b, c]);';
    const out = removeManagedPart(code, 'b', 'manifold-js');
    expect(out).toContain('return Manifold.union([a, c]);');
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

test.describe('addManagedDeclaration + CrossSection auto-destructure', () => {
  test('snippet that mentions CrossSection gets the destructure extended', () => {
    const code = 'const { Manifold } = api;\nreturn Manifold.cube([1,1,1], true);';
    const decl = 'const t1 = CrossSection.circle(2).translate([10, 0]).revolve(48);';
    const out = addManagedDeclaration(code, decl, { lang: 'manifold-js', addNames: ['t1'], combine: true });
    expect(out.code).toContain('const { Manifold, CrossSection } = api;');
    expect(out.code).toContain(decl);
    expect(out.returnSet).toBe(true);
  });

  test('snippet with only Manifold does not add CrossSection', () => {
    const code = 'const { Manifold } = api;\nreturn Manifold.cube([1,1,1], true);';
    const decl = 'const ball = Manifold.sphere(3);';
    const out = addManagedDeclaration(code, decl, { lang: 'manifold-js', addNames: ['ball'], combine: true });
    expect(out.code).not.toContain('CrossSection');
  });
});

test.describe('emitPrimitive — replicad (BREP)', () => {
  test('centered cube → BREP.box with Z recenter', () => {
    expect(emitPrimitiveBrep({ kind: 'cube', name: 'b', size: [10, 10, 10], center: true }))
      .toBe('const b = BREP.box([10, 10, 10]).translate([0, 0, -5]);');
  });
  test('uncentered cube shifts the corner to the origin', () => {
    expect(emitPrimitiveBrep({ kind: 'cube', name: 'b', size: [4, 6, 8], center: false }))
      .toBe('const b = BREP.box([4, 6, 8]).translate([2, 3, 0]);');
  });
  test('sphere is centred (no translate)', () => {
    expect(emitPrimitiveBrep({ kind: 'sphere', name: 's', radius: 6 }))
      .toBe('const s = BREP.sphere(6);');
  });
  test('cylinder uses (r, h) order and recenters when centered', () => {
    expect(emitPrimitiveBrep({ kind: 'cylinder', name: 'c', height: 20, radius: 5, center: true }))
      .toBe('const c = BREP.cylinder(5, 20).translate([0, 0, -10]);');
  });
  test('cone maps to BREP.cone(rBottom, rTop, h)', () => {
    expect(emitPrimitiveBrep({ kind: 'cone', name: 'cn', height: 12, radiusBottom: 6, radiusTop: 0, center: false }))
      .toBe('const cn = BREP.cone(6, 0, 12);');
  });
  test('torus maps to BREP.torus(major, tube)', () => {
    expect(emitPrimitiveBrep({ kind: 'torus', name: 't', majorRadius: 12, tubeRadius: 3, segments: 48 }))
      .toBe('const t = BREP.torus(12, 3);');
  });
  test('emitOperationBrep chains fuse/cut/intersect', () => {
    expect(emitOperationBrep('union', ['a', 'b'], 'm')).toBe('const m = a.fuse(b);');
    expect(emitOperationBrep('subtract', ['a', 'b', 'c'], 'm')).toBe('const m = a.cut(b).cut(c);');
    expect(emitOperationBrep('intersect', ['a', 'b'], 'm')).toBe('const m = a.intersect(b);');
  });
});

test.describe('emitPrimitive — voxel', () => {
  test('centered cube → inclusive fillBox of `size` voxels', () => {
    expect(emitPrimitiveVoxel({ kind: 'cube', name: 'b', size: [10, 10, 10], center: true }, 'v', '#abc'))
      .toBe("v.fillBox([-5, -5, -5], [4, 4, 4], '#abc'); // part: b");
  });
  test('uncentered cube grows from the position', () => {
    expect(emitPrimitiveVoxel({ kind: 'cube', name: 'b', size: [4, 4, 4], center: false, position: [10, 0, 0] }, 'v', '#abc'))
      .toBe("v.fillBox([10, 0, 0], [13, 3, 3], '#abc'); // part: b");
  });
  test('sphere → v.sphere(center, r)', () => {
    expect(emitPrimitiveVoxel({ kind: 'sphere', name: 's', radius: 6, position: [1, 2, 3] }, 'v', '#abc'))
      .toBe("v.sphere([1, 2, 3], 6, '#abc'); // part: s");
  });
  test('cylinder → v.cylinder(base, r, h) with center → base z down', () => {
    expect(emitPrimitiveVoxel({ kind: 'cylinder', name: 'c', height: 20, radius: 5, center: true }, 'v', '#abc'))
      .toBe("v.cylinder([0, 0, -10], 5, 20, '#abc', 'z'); // part: c");
  });
  test('torus → v.sdf(api.sdf.torus(...))', () => {
    expect(emitPrimitiveVoxel({ kind: 'torus', name: 't', majorRadius: 12, tubeRadius: 3, segments: 48 }, 'v', '#abc'))
      .toBe("v.sdf(api.sdf.torus(12, 3), { color: '#abc' }); // part: t");
  });
  test('scanPartsVoxel finds tagged fills with ranges', () => {
    const code = "const v = voxels();\nv.fillBox([0,0,0], [1,1,1], '#fff'); // part: a\nv.sphere([0,0,0], 2, '#eee'); // part: b\nreturn v;";
    const parts = scanPartsVoxel(code);
    expect(parts.map(p => p.name)).toEqual(['a', 'b']);
    // The range covers the statement+tag so a move can re-emit it.
    expect(code.slice(parts[0].range!.from, parts[0].range!.to)).toContain('// part: a');
  });
});

test.describe('enclosure inserts', () => {
  test('box binds both parts and reads them via api.enclosure', () => {
    const { decl, names } = emitEnclosure({ kind: 'box', base: 'base', lid: 'lid', size: [60, 40, 30], wall: 2, radius: 3, type: 'lip' });
    expect(names).toEqual(['base', 'lid']);
    expect(decl).toContain('const { base, lid } = api.enclosure.box(');
    expect(decl).toContain("type: 'lip'");
    // scanPartsJs must surface the destructured names (not skip them as `= api`).
    expect(scanPartsJs(decl).map(p => p.name)).toEqual(['base', 'lid']);
  });
  test('renamed box parts alias the real builder keys', () => {
    // A second box names its parts base2/lid2 — the destructure must still read
    // the `base`/`lid` keys (aliasing), not look up non-existent props.
    const { decl, names } = emitEnclosure({ kind: 'box', base: 'base2', lid: 'lid2', size: [40, 40, 20], wall: 2, radius: 2, type: 'screw' });
    expect(names).toEqual(['base2', 'lid2']);
    expect(decl).toContain('const { base: base2, lid: lid2 } = api.enclosure.box(');
    expect(scanPartsJs(decl).map(p => p.name)).toEqual(['base2', 'lid2']);
  });
  test('shell + standoff are single-part', () => {
    expect(emitEnclosure({ kind: 'shell', name: 'shell', size: [40, 40, 25], wall: 2, radius: 4, open: 'top' }).names).toEqual(['shell']);
    expect(emitEnclosure({ kind: 'standoff', name: 'post', screwSize: 'M3', height: 6, bore: 'tap' }).decl)
      .toContain("api.enclosure.standoff({ size: 'M3', height: 6, bore: 'tap' })");
  });
});

test.describe('per-engine capability map', () => {
  test('mesh engines do every shape; brep/voxel are subsets', () => {
    expect(shapesFor('manifold-js')).toContain('star');
    expect(shapesFor('scad')).toContain('wedge');
    expect(shapesFor('replicad')).toEqual(['cube', 'sphere', 'cylinder', 'cone', 'torus']);
    expect(shapesFor('voxel')).toEqual(['cube', 'sphere', 'cylinder', 'torus']);
  });
  test('voxel has no explicit boolean ops', () => {
    expect(supportsBooleanOps('voxel')).toBe(false);
    expect(supportsBooleanOps('manifold-js')).toBe(true);
    expect(supportsBooleanOps('replicad')).toBe(true);
  });
});

test.describe('voxel scaffold (controller)', () => {
  test('ensureVoxelScaffold adds grid + return; idempotent', () => {
    const { code, gridVar } = ensureVoxelScaffold('');
    expect(gridVar).toBe('v');
    expect(code).toContain('const v = api.voxels();');
    expect(code).toContain('return v;');
    expect(ensureVoxelScaffold(code).code).toBe(code);
  });
  test('ensureVoxelScaffold binds an inline returned grid (no double grid)', () => {
    const { code, gridVar } = ensureVoxelScaffold("return api.voxels().fillBox([0,0,0],[2,2,2], '#abc');");
    expect(gridVar).toBe('v');
    expect(code).toBe("const v = api.voxels().fillBox([0,0,0],[2,2,2], '#abc');\nreturn v;");
    // No second `voxels()` grid was introduced.
    expect(code.match(/voxels\(\)/g)?.length).toBe(1);
  });
  test('ensureVoxelScaffold reuses an existing destructured handle', () => {
    const src = "const { voxels } = api;\nconst v = voxels();\nv.sphere([0,0,0], 3, '#abc');\nreturn v;";
    expect(ensureVoxelScaffold(src)).toEqual({ code: src, gridVar: 'v' });
  });
  test('appendVoxelStatement inserts before the return', () => {
    const out = appendVoxelStatement('const v = voxels();\nreturn v;', "v.sphere([0,0,0], 3, '#abc'); // part: s");
    expect(out).toMatch(/v\.sphere[\s\S]*\nreturn v;/);
  });
  test('replaceVoxelStatement swaps a scanned range', () => {
    const code = "const v = voxels();\nv.sphere([0,0,0], 3, '#abc'); // part: s\nreturn v;";
    const part = scanPartsVoxel(code)[0];
    const out = replaceVoxelStatement(code, part.range!, "v.sphere([5,0,0], 3, '#abc'); // part: s");
    expect(out).toContain('v.sphere([5,0,0]');
    expect(out).not.toContain('v.sphere([0,0,0]');
  });
});

test.describe('Arrange — per-axis scale codegen (setPartScale*)', () => {
  test('JS: appends .scale before an existing .translate so position is preserved', () => {
    const code = 'const { Manifold } = api;\nconst box = Manifold.cube([10, 10, 10], true).translate([5, 0, 0]);\nreturn box;';
    const out = setPartScaleJs(code, 'box', [2, 1, 1]);
    // .scale comes BEFORE .translate — scale around origin, then translate.
    expect(out).toMatch(/Manifold\.cube\(\[10, 10, 10\], true\)\.scale\(\[2, 1, 1\]\)\.translate\(\[5, 0, 0\]\)/);
  });

  test('JS: with no existing translate appends .scale at the end', () => {
    const code = 'const { Manifold } = api;\nconst box = Manifold.cube([10, 10, 10], true);\nreturn box;';
    const out = setPartScaleJs(code, 'box', [3, 1, 1]);
    expect(out).toContain('Manifold.cube([10, 10, 10], true).scale([3, 1, 1])');
  });

  test('JS: a second resize compounds onto the existing scale triple (no stacked .scale calls)', () => {
    const code = 'const { Manifold } = api;\nconst box = Manifold.cube([10, 10, 10], true).scale([2, 1, 1]);\nreturn box;';
    const out = setPartScaleJs(code, 'box', [2, 3, 1]);
    // Compounds 2*2 / 1*3 / 1*1 = [4, 3, 1], no second .scale literal.
    expect(out).toContain('.scale([4, 3, 1])');
    expect(out.match(/\.scale\(/g)!.length).toBe(1);
  });

  test('JS: identity scale is a no-op', () => {
    const code = 'const { Manifold } = api;\nconst box = Manifold.cube([10, 10, 10], true);\nreturn box;';
    expect(setPartScaleJs(code, 'box', [1, 1, 1])).toBe(code);
  });

  test('JS: unknown part name returns code unchanged', () => {
    const code = 'const { Manifold } = api;\nconst box = Manifold.cube([10, 10, 10], true);\nreturn box;';
    expect(setPartScaleJs(code, 'missing', [2, 1, 1])).toBe(code);
  });

  test('SCAD: wraps the construction in scale() AFTER any leading translate', () => {
    const code = "translate([5, 0, 0]) cube([10, 10, 10], center = true); // part: box\n";
    const part = scanPartsScad(code)[0];
    const out = setPartScaleScad(code, part.range!, [2, 1, 1]);
    // Leading translate stays first; scale slips between it and the cube.
    expect(out).toContain('translate([5, 0, 0]) scale([2, 1, 1]) cube([10, 10, 10]');
  });

  test('SCAD: with no leading translate prepends scale()', () => {
    const code = 'cube([10, 10, 10], center = true); // part: box\n';
    const part = scanPartsScad(code)[0];
    const out = setPartScaleScad(code, part.range!, [3, 1, 1]);
    expect(out).toMatch(/^scale\(\[3, 1, 1\]\) cube\(/m);
  });

  test('SCAD: a second resize compounds into the existing scale call', () => {
    const code = 'scale([2, 1, 1]) cube([10, 10, 10], center = true); // part: box\n';
    const part = scanPartsScad(code)[0];
    const out = setPartScaleScad(code, part.range!, [2, 3, 1]);
    expect(out).toMatch(/scale\(\[4, 3, 1\]\) cube/);
    expect(out.match(/scale\(/g)!.length).toBe(1);
  });
});

test.describe('Insert palette — undo / redo stack', () => {
  // A fresh in-memory rig per test: a string holding the "code", live registry
  // / specByName / selection Maps the way the palette holds them, and a count
  // of how many engine re-runs were triggered (so we can assert restore() runs
  // the engine).
  function setupStack(initialCode = 'return undefined;'): {
    state: { code: string; runs: number; restores: number };
    insert: (name: string) => void;
  } {
    const state = { code: initialCode, runs: 0, restores: 0 };
    const registry = new Map<string, RegistryEntry>();
    const specByName = new Map<string, PrimitiveSpec>();
    const selection = new Set<string>();
    initUndoStack({
      getCode: () => state.code,
      setCode: (c) => { state.code = c; },
      registry,
      specByName,
      selection,
      run: () => { state.runs++; },
      onAfterRestore: () => { state.restores++; },
    });
    const insert = (name: string): void => {
      recordOperation(`Insert ${name}`, () => {
        state.code += `\nconst ${name} = Manifold.cube([10,10,10], true);`;
        const spec = { kind: 'cube', name, size: [10, 10, 10], center: true, position: [0, 0, 0] } as PrimitiveSpec;
        specByName.set(name, spec);
        registry.set(name, { box: { min: [-5, -5, -5], max: [5, 5, 5] }, center: [0, 0, 0] });
        selection.clear();
        selection.add(name);
      });
    };
    return { state, insert };
  }

  test('records one snapshot per recordOperation; canUndo/canRedo track the cursor', () => {
    const { state, insert } = setupStack();
    expect(canUndo()).toBe(false);
    expect(canRedo()).toBe(false);
    insert('box');
    insert('ball');
    insert('cyl');
    expect(__testGetHistoryLength()).toBe(3);
    expect(__testGetCursor()).toBe(2);
    expect(canUndo()).toBe(true);
    expect(canRedo()).toBe(false);
    expect(peekUndoLabel()).toBe('Insert cyl');
    expect(state.code).toContain('const cyl');
  });

  test('undo restores the previous code/state and triggers run()', () => {
    const { state, insert } = setupStack();
    insert('box');
    insert('ball');
    const runsBefore = state.runs;
    const restoresBefore = state.restores;
    const label = undo();
    expect(label).toBe('Insert ball');
    expect(state.code).not.toContain('const ball');
    expect(state.code).toContain('const box');
    expect(state.runs).toBe(runsBefore + 1);
    expect(state.restores).toBe(restoresBefore + 1);
    expect(canUndo()).toBe(true);
    expect(canRedo()).toBe(true);
    expect(peekRedoLabel()).toBe('Insert ball');
  });

  test('redo re-applies the undone operation; cursor walks back', () => {
    const { state, insert } = setupStack();
    insert('box');
    insert('ball');
    undo();
    const label = redo();
    expect(label).toBe('Insert ball');
    expect(state.code).toContain('const ball');
    expect(canRedo()).toBe(false);
  });

  test('a new operation after undo truncates the redo tail', () => {
    const { state, insert } = setupStack();
    insert('box');
    insert('ball');
    undo();
    expect(canRedo()).toBe(true);
    insert('newpart');
    // The "Insert ball" redo slot should be gone — it's clobbered by newpart.
    expect(canRedo()).toBe(false);
    expect(state.code).not.toContain('const ball');
    expect(state.code).toContain('const newpart');
  });

  test('no-op operation (code unchanged) pushes no snapshot', () => {
    const { state, insert } = setupStack();
    insert('box');
    const beforeLen = __testGetHistoryLength();
    recordOperation('noop', () => { /* don't touch state.code */ });
    expect(__testGetHistoryLength()).toBe(beforeLen);
  });

  test('clearUndoHistory drops everything (used on session-changed)', () => {
    const { insert } = setupStack();
    insert('a'); insert('b'); insert('c');
    clearUndoHistory();
    expect(__testGetHistoryLength()).toBe(0);
    expect(canUndo()).toBe(false);
    expect(canRedo()).toBe(false);
  });

  test('undo then undo restores two steps back; pure walking the stack', () => {
    const { state, insert } = setupStack();
    insert('a'); insert('b'); insert('c');
    undo(); undo();
    expect(state.code).toContain('const a');
    expect(state.code).not.toContain('const b');
    expect(state.code).not.toContain('const c');
    expect(canUndo()).toBe(true);
    expect(canRedo()).toBe(true);
  });
});

test.describe('Arrange — alignDeltas', () => {
  function entry(min: [number, number, number], max: [number, number, number]): RegistryEntry {
    return { box: { min, max }, center: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2] };
  }
  test('aligns to the min X surface (leftmost edge wins)', () => {
    const reg = new Map<string, RegistryEntry>([
      ['a', entry([-5, -5, 0], [5, 5, 10])],   // X range [-5, 5]
      ['b', entry([10, -5, 0], [20, 5, 10])],  // X range [10, 20]
    ]);
    const deltas = alignDeltas(['a', 'b'], reg, 'x', 'min');
    // b needs to move so its min.x reaches -5 → delta = -5 - 10 = -15.
    expect(deltas.get('a')).toBeUndefined(); // no-op for the reference part
    expect(deltas.get('b')).toEqual([-15, 0, 0]);
  });

  test('aligns to the max Z surface (top)', () => {
    const reg = new Map<string, RegistryEntry>([
      ['a', entry([-5, -5, 0], [5, 5, 10])],   // Z max = 10
      ['b', entry([-5, -5, 4], [5, 5, 6])],    // Z max = 6
    ]);
    const deltas = alignDeltas(['a', 'b'], reg, 'z', 'max');
    expect(deltas.get('b')).toEqual([0, 0, 4]); // bump up by 4 so its top hits 10
  });

  test('aligns to the center along Y', () => {
    const reg = new Map<string, RegistryEntry>([
      ['a', entry([-5, 0, 0], [5, 10, 10])],   // Y center = 5
      ['b', entry([-5, 20, 0], [5, 30, 10])],  // Y center = 25
    ]);
    const deltas = alignDeltas(['a', 'b'], reg, 'y', 'center');
    // Combined Y span: 0..30 → center = 15. a shifts +10, b shifts -10.
    expect(deltas.get('a')).toEqual([0, 10, 0]);
    expect(deltas.get('b')).toEqual([0, -10, 0]);
  });

  test('skips parts not in the registry', () => {
    const reg = new Map<string, RegistryEntry>([
      ['a', entry([-5, -5, 0], [5, 5, 10])],
    ]);
    const deltas = alignDeltas(['a', 'ghost'], reg, 'x', 'min');
    expect(deltas.size).toBe(0); // only one valid entry → nothing to align against
  });
});

