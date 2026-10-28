import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isSesGlueModule, rewriteOverrideMistakes } from '../../src/geometry/sesGlueFix';

// #1127: the engine Worker freezes the shared intrinsics (SES lockdown) before
// the Emscripten glue initialises, and the glue's override-mistake assignments
// are rewritten at build time (sesGlueFix.ts, vite.config.ts). These counts pin
// the rewrite against the INSTALLED glue: a manifold-3d / replicad-opencascadejs
// bump that adds, drops or reshapes one of those assignments fails here, in CI,
// instead of as "Cannot assign to read only property 'constructor'" when
// manifold-3d or OpenCASCADE initialises in the browser. When it fails, look at
// the new glue's `X.prototype.constructor|toString = …` / `this.message = …`
// assignments, check the rewrite still covers each one, update the count, and
// run the BREP + engine-lockdown e2e specs.
const GLUE: Record<string, number> = {
  'manifold-3d/manifold.js': 5,
  'replicad-opencascadejs/src/replicad_single.js': 7,
  'replicad-opencascadejs/src/replicad_with_exceptions.js': 7,
};

const nodeModules = resolve(__dirname, '../../node_modules');

describe('SES glue fix (override mistake)', () => {
  for (const [file, count] of Object.entries(GLUE)) {
    it(`rewrites exactly ${count} assignments in ${file}`, () => {
      const path = resolve(nodeModules, file);
      expect(isSesGlueModule(path)).toBe(true);
      const out = rewriteOverrideMistakes(readFileSync(path, 'utf8'));
      expect(out.count).toBe(count);
      // Still parses as the module it was.
      expect(out.code).toMatch(/^function __sesOvr\(o,k\)/);
    });
  }

  it('scopes to the two glue packages (incl. Vite pre-bundles), nothing else', () => {
    expect(isSesGlueModule('/app/node_modules/manifold-3d/manifold.js?v=1')).toBe(true);
    expect(isSesGlueModule('/app/node_modules/.vite/deps/replicad-opencascadejs_src_replicad_single__js.js?v=ab')).toBe(true);
    expect(isSesGlueModule('/tmp/cache/deps_temp_1/manifold-3d.js')).toBe(true);
    expect(isSesGlueModule('/app/node_modules/manifold-3d/manifold.wasm')).toBe(false);
    expect(isSesGlueModule('/app/node_modules/openscad-wasm-prebuilt/dist/openscad.js')).toBe(false);
    expect(isSesGlueModule('/app/src/geometry/engines/manifoldJs.ts')).toBe(false);
    expect(isSesGlueModule('/app/node_modules/replicad/dist/replicad.js')).toBe(false);
  });

  it('leaves comparisons alone and code without hits untouched', () => {
    const src = 'if (this.message == x) {} if (A.prototype.constructor === B) {}';
    expect(rewriteOverrideMistakes(src)).toEqual({ code: src, count: 0 });
  });

  it('works where the plain assignment hits the override mistake, with the same result', () => {
    // A frozen prototype whose `constructor`/`toString`/`message` are
    // non-writable — what every Error subclass sees after lockdown().
    const base = Object.freeze({ constructor: 0, toString: () => 'base', message: 'base' });
    const src = `
      "use strict";
      function E(m) { this.message = m; }
      E.prototype = Object.create(base);
      E.prototype.constructor = E;
      E.prototype.toString = function () { return 'E:' + this.message; };
      const e = new E('boom');
      e.message = 'again';
      return { e, E };`;
    expect(() => new Function('base', src)(base)).toThrow(TypeError);
    const fixed = rewriteOverrideMistakes(src);
    expect(fixed.count).toBe(3);
    const { e, E } = new Function('base', fixed.code)(base) as { e: { message: string; toString(): string }; E: { prototype: object } };
    expect(String(e)).toBe('E:again');
    expect(Object.getOwnPropertyDescriptor(E.prototype, 'constructor')).toMatchObject({ value: E, writable: true, enumerable: true, configurable: true });
    expect(Object.getOwnPropertyDescriptor(e, 'message')).toMatchObject({ value: 'again', writable: true, enumerable: true, configurable: true });
  });
});
