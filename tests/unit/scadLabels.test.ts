import { describe, it, expect } from 'vitest';
import { scanScadLabels } from '../../src/geometry/engines/scadLabels';

describe('scanScadLabels — hasAnyLabelCalls', () => {
  it('reports no labels for source with none', () => {
    const r = scanScadLabels('cube([10,10,10]); sphere(r=5);');
    expect(r.hasAnyLabelCalls).toBe(false);
    expect(r.hasNestedLabels).toBe(false);
  });

  it('detects a top-level label() call', () => {
    const r = scanScadLabels('label("body") cube([10,10,10]);');
    expect(r.hasAnyLabelCalls).toBe(true);
    expect(r.hasNestedLabels).toBe(false);
  });

  it('ignores tokens that just happen to contain "label" (relabel, slabel, label_)', () => {
    const r = scanScadLabels('relabel(); slabel("x"); label_("x");');
    expect(r.hasAnyLabelCalls).toBe(false);
  });

  it('ignores label() inside line comments', () => {
    const r = scanScadLabels('// label("commented")\ncube(10);');
    expect(r.hasAnyLabelCalls).toBe(false);
  });

  it('ignores label( inside string literals', () => {
    const r = scanScadLabels('echo("label(x)"); cube(10);');
    expect(r.hasAnyLabelCalls).toBe(false);
  });

  it('ignores label( inside block comments', () => {
    const r = scanScadLabels('/* label("x") cube(10); */ sphere(5);');
    expect(r.hasAnyLabelCalls).toBe(false);
  });
});

describe('scanScadLabels — top-level statement extraction', () => {
  it('records one statement per top-level cube()', () => {
    const r = scanScadLabels('cube([1,1,1]); cube([2,2,2]); cube([3,3,3]);');
    expect(r.topLevelStatements).toHaveLength(3);
    expect(r.topLevelStatements.every(s => s.labelName === null)).toBe(true);
  });

  it('captures literal label names in source order', () => {
    const r = scanScadLabels(`
      label("body") cube([10,10,10]);
      translate([20,0,0]) cube([5,5,5]);
      label("post") cylinder(r=2, h=8);
    `);
    expect(r.topLevelStatements).toHaveLength(3);
    expect(r.topLevelStatements[0].labelName).toBe('body');
    expect(r.topLevelStatements[1].labelName).toBe(null);
    expect(r.topLevelStatements[2].labelName).toBe('post');
  });

  it('finds the label inside a transformation chain', () => {
    const r = scanScadLabels('translate([5,0,0]) label("x") cube(2);');
    expect(r.topLevelStatements).toHaveLength(1);
    expect(r.topLevelStatements[0].labelName).toBe('x');
  });

  it('skips module/function/use/include and bare assignments', () => {
    const r = scanScadLabels(`
      use <bosl2/std.scad>
      include <other.scad>
      module shape() { cube(10); }
      function double(x) = x * 2;
      x = 5;
      vec = [1, 2, 3];
      cube([10,10,10]);
    `);
    expect(r.topLevelStatements).toHaveLength(1);
    expect(r.topLevelStatements[0].labelName).toBe(null);
  });

  it('treats label() inside a {} block as nested, not top-level', () => {
    const r = scanScadLabels(`
      label("outside") cube(10);
      difference() {
        label("body") cube(20);
        label("hole") cylinder(r=2, h=30);
      }
    `);
    expect(r.hasAnyLabelCalls).toBe(true);
    expect(r.hasNestedLabels).toBe(true);
    // The difference() is one top-level block statement that carries no
    // label at its own root; the labels INSIDE are nested.
    expect(r.topLevelStatements).toHaveLength(2);
    expect(r.topLevelStatements[0].labelName).toBe('outside');
    expect(r.topLevelStatements[1].labelName).toBe(null);
  });

  it('does not capture a non-literal label argument', () => {
    const r = scanScadLabels('label(str("c", i)) cube(1);');
    expect(r.hasAnyLabelCalls).toBe(true);
    expect(r.topLevelStatements).toHaveLength(1);
    // Runtime-computed name — we deliberately don't try to evaluate it.
    expect(r.topLevelStatements[0].labelName).toBe(null);
  });

  it('captures a label name even when label() is followed by another call chain', () => {
    const r = scanScadLabels('color([1,0,0]) label("x") translate([0,1,0]) cube(2);');
    expect(r.topLevelStatements[0].labelName).toBe('x');
  });

  it('treats a label call appearing only inside a nested block as nested', () => {
    const r = scanScadLabels(`
      union() {
        label("a") cube(5);
        cube(10);
      }
    `);
    expect(r.hasAnyLabelCalls).toBe(true);
    expect(r.hasNestedLabels).toBe(true);
    // The union() is one top-level block, no label at its root.
    expect(r.topLevelStatements).toHaveLength(1);
    expect(r.topLevelStatements[0].labelName).toBe(null);
  });

  it('does not count `else <expr>;` as a second top-level statement', () => {
    // `if (cond) cube(); else sphere();` splits at the first `;`, but
    // lazy-union still emits exactly ONE object (the taken branch). If we
    // counted the orphan `else …` chunk, the count would mismatch and
    // labels would silently fall back to auto-naming.
    const r = scanScadLabels(`
      label("primary") cube(10);
      if (true) cube(5); else sphere(3);
      label("trailing") cylinder(r=2, h=4);
    `);
    expect(r.topLevelStatements).toHaveLength(3);
    expect(r.topLevelStatements[0].labelName).toBe('primary');
    expect(r.topLevelStatements[1].labelName).toBe(null);
    expect(r.topLevelStatements[2].labelName).toBe('trailing');
  });
});

describe('scanScadLabels — string-escape handling', () => {
  it('does not walk past escaped quotes inside string literals', () => {
    // Regression: `echo("a\\\"b")` used to end string masking at the
    // escaped quote, then re-enter at the next real `"`, eventually
    // masking over a real `label("real") cube()`.
    const r = scanScadLabels('echo("a\\"b"); label("real") cube(10);');
    expect(r.hasAnyLabelCalls).toBe(true);
    expect(r.allLiteralLabelNames).toEqual(['real']);
    expect(r.topLevelStatements).toHaveLength(2);
    expect(r.topLevelStatements[1].labelName).toBe('real');
  });
});

describe('scanScadLabels — declaration body suppression', () => {
  it('ignores label() calls inside `module foo() { ... }` bodies', () => {
    // The module's body is dead code until invoked; including its labels
    // would falsely populate `lostLabels` for the caller.
    const r = scanScadLabels(`
      module unused() { label("ghost") cube(10); }
      label("real") cube(5);
    `);
    expect(r.allLiteralLabelNames).toEqual(['real']);
    expect(r.hasNestedLabels).toBe(false);
    expect(r.topLevelStatements).toHaveLength(1);
    expect(r.topLevelStatements[0].labelName).toBe('real');
  });

  it('still collects labels OUTSIDE the module after the body closes', () => {
    const r = scanScadLabels(`
      label("before") cube(1);
      module foo() { label("inside") cube(1); }
      label("after") cube(1);
    `);
    expect(r.allLiteralLabelNames).toEqual(['before', 'after']);
  });

  it('handles a module body containing a brace-nested boolean correctly', () => {
    const r = scanScadLabels(`
      module rig() {
        difference() {
          label("a") cube(10);
          label("b") cylinder(r=2, h=15);
        }
      }
      label("real") cube(5);
    `);
    // Nothing from rig()'s body should appear, even though the boolean
    // is at brace-depth >= 2 inside the suppression.
    expect(r.allLiteralLabelNames).toEqual(['real']);
    expect(r.hasNestedLabels).toBe(false);
  });
});

describe('scanScadLabels — allLiteralLabelNames', () => {
  it('returns names from top-level labels in source order', () => {
    const r = scanScadLabels(`
      label("body") cube(10);
      label("wheel") sphere(5);
    `);
    expect(r.allLiteralLabelNames).toEqual(['body', 'wheel']);
  });

  it('also captures names nested inside boolean blocks', () => {
    // These will be lost at compile time, but the engine wants to know
    // that the user wrote them so it can populate `lostLabels`.
    const r = scanScadLabels(`
      label("top") cube(10);
      difference() {
        label("body") cube(20);
        label("hole") cylinder(r=2, h=30);
      }
    `);
    expect(r.allLiteralLabelNames).toEqual(['top', 'body', 'hole']);
  });

  it('omits runtime-computed names', () => {
    const r = scanScadLabels(`
      label("static") cube(1);
      label(str("c", i)) cube(1);
    `);
    expect(r.allLiteralLabelNames).toEqual(['static']);
  });

  it('returns an empty array when the source has no labels', () => {
    const r = scanScadLabels('cube(10); sphere(5);');
    expect(r.allLiteralLabelNames).toEqual([]);
  });
});
