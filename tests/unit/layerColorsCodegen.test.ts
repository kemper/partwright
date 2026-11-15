import { describe, it, expect } from 'vitest';
import { formatLayerColorsCall, removeLayerColorsCall, upsertLayerColorsCall } from '../../src/print/layerColorsCodegen';

const MODEL = `const { Manifold } = api;
const body = Manifold.cube([40, 30, 24], true);
return body;`;
const CHANGES = [{ z: 8, color: '#DC1E1E' }, { z: 0, color: 'f0f0f0' }];

describe('layer-colours codegen', () => {
  it('formats a sorted, normalised single-line call', () => {
    expect(formatLayerColorsCall(CHANGES)).toBe("api.print.layerColors([{ z: 0, color: '#f0f0f0' }, { z: 8, color: '#dc1e1e' }]);");
    expect(formatLayerColorsCall([{ z: 0.30000000000000004, color: '#ffffff' }], { layerHeight: 0.16, firstLayerHeight: 0.2 }))
      .toBe("api.print.layerColors([{ z: 0.3, color: '#ffffff' }], { layerHeight: 0.16, firstLayerHeight: 0.2 });");
    expect(formatLayerColorsCall([])).toBe('api.print.layerColors([]);');
  });

  it('inserts before the final top-level return, keeping its indentation', () => {
    const r = upsertLayerColorsCall(MODEL, CHANGES)!;
    expect(r.replaced).toBe(false);
    expect(r.code).toBe(`const { Manifold } = api;
const body = Manifold.cube([40, 30, 24], true);
${r.call}
return body;`);
    const indented = upsertLayerColorsCall('function f() {\n  return 1;\n}\n  return f();', CHANGES)!;
    expect(indented.code).toContain(`  ${indented.call}\n  return f();`);
  });

  it('rewrites an existing call in place, whatever its formatting', () => {
    const before = `const { Manifold } = api;
api.print.layerColors(
  [
    { z: 0, color: '#000000' }, // base
    { z: 3, color: '#ffffff' },
  ],
  { layerHeight: 0.12 }
);
return Manifold.cube([10, 10, 10]);`;
    const r = upsertLayerColorsCall(before, CHANGES)!;
    expect(r.replaced).toBe(true);
    expect(r.code).toBe(`const { Manifold } = api;\n${r.call}\nreturn Manifold.cube([10, 10, 10]);`);
    expect(r.code.match(/layerColors/g)).toHaveLength(1);
  });

  it('ignores a call that only appears in a comment or a string', () => {
    const code = `// api.print.layerColors([{ z: 1, color: '#ffffff' }]);
const note = "api.print.layerColors([])";
return api.Manifold.cube([1, 1, 1]);`;
    const r = upsertLayerColorsCall(code, CHANGES)!;
    expect(r.replaced).toBe(false);
    expect(r.code).toContain("// api.print.layerColors([{ z: 1, color: '#ffffff' }]);");
    expect(r.code).toContain('const note = "api.print.layerColors([])";');
    expect(removeLayerColorsCall(code)).toEqual({ code, call: '', replaced: false });
  });

  it('returns null when there is no return to anchor on', () => {
    expect(upsertLayerColorsCall('const x = 1;', CHANGES)).toBeNull();
  });

  it('removes the call and the line it occupied', () => {
    const withCall = upsertLayerColorsCall(MODEL, CHANGES)!.code;
    expect(removeLayerColorsCall(withCall)).toEqual({ code: MODEL, call: '', replaced: true });
    // Inline with other code: only the statement goes.
    expect(removeLayerColorsCall("const a = 1; api.print.layerColors([]); return a;").code).toBe('const a = 1;  return a;');
  });

  it('upsert then upsert again leaves exactly one call', () => {
    const once = upsertLayerColorsCall(MODEL, CHANGES)!.code;
    const twice = upsertLayerColorsCall(once, [{ z: 2, color: '#00ff00' }])!;
    expect(twice.replaced).toBe(true);
    expect(twice.code.match(/layerColors/g)).toHaveLength(1);
    expect(twice.code).toContain("{ z: 2, color: '#00ff00' }");
  });
});
