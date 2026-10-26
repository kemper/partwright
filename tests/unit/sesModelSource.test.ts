import { describe, it, expect } from 'vitest';
import {
  SES_LOCKDOWN_OPTIONS,
  explainSesRejection,
  neutralizeSesRejections,
  preludeNames,
  undeclaredHint,
  undeclaredNames,
  wrapModelSource,
} from '../../src/geometry/sesModelSource';
import { parseSesFlagValue, resolveSesFlag } from '../../src/geometry/sesSandboxFlag';
import { compileModelCode, modelCompilerName, hardenModelShared } from '../../src/geometry/modelEval';
import { javaScriptSyntaxDiagnostics } from '../../src/geometry/sourceDiagnostics';

// Pure pieces of the SES model-code sandbox (#1127). The real lockdown +
// Compartment path runs in the engine Worker and is covered by
// tests/engine-lockdown.spec.ts.

// SES's own rejection patterns (ses/src/transforms.js) — what must NOT match
// after neutralizing, for source that should run.
const SES_IMPORT = /(^|[^.]|\.\.\.)\bimport(\s*(?:\(|\/[/*]))/;
const SES_EVAL = /(^|[^.])\beval(\s*\()/;
const SES_HTML = /<!--|-->/;
const rejected = (src: string) => SES_IMPORT.test(src) || SES_EVAL.test(src) || SES_HTML.test(src);

/** Evaluate wrapped model code outside SES, to check meaning is preserved. */
function runWrapped(code: string, api: unknown = {}): unknown {
  const fn = (0, eval)(wrapModelSource(neutralizeSesRejections(code), [])) as (a: unknown) => unknown;
  return fn(api);
}

describe('SES lockdown preset', () => {
  it('keeps the two load-bearing options', () => {
    // 'safe-eval' made SDF figures 4.3x slower; 'moderate'/'severe' made BOSL2 ~2x slower.
    expect(SES_LOCKDOWN_OPTIONS.evalTaming).toBe('unsafe-eval');
    expect(SES_LOCKDOWN_OPTIONS.overrideTaming).toBe('min');
    expect(Object.isFrozen(SES_LOCKDOWN_OPTIONS)).toBe(true);
  });
});

describe('wrapModelSource / preludeNames', () => {
  it('binds identifier globals except eval/undefined/NaN/Infinity/globalThis', () => {
    expect(preludeNames(['Math', 'eval', 'undefined', 'NaN', 'Infinity', 'globalThis', 'Date', 'Math', '@@x', 'a-b']))
      .toEqual(['Date', 'Math']);
  });

  it('keeps user line N on line N, and hands api through', () => {
    const src = wrapModelSource('const a = 1;\nreturn api + a;', ['Math']);
    const lines = src.split('\n');
    expect(lines[0]).toMatch(/const \{Math\} = globalThis; return \(function \(api\) \{ "use strict";const a = 1;$/);
    expect(lines[1]).toBe('return api + a;');
    const fn = (0, eval)(src) as (a: unknown) => unknown;
    expect(fn(41)).toBe(42);
  });

  it('a trailing line comment cannot swallow the wrapper tail', () => {
    expect(runWrapped('return 7; // done')).toBe(7);
  });

  it('runs the user code in strict mode with legacy `this`/`arguments`', () => {
    expect(runWrapped('return [typeof this, arguments.length, arguments[0]];', 'A')).toEqual(['undefined', 1, 'A']);
    expect(() => runWrapped('undeclared = 1; return 0;')).toThrow(ReferenceError);
  });
});

describe('neutralizeSesRejections', () => {
  it('returns the input unchanged when nothing matches', () => {
    const src = 'const { Manifold } = api;\nreturn Manifold.cube([1, 1, 1]);';
    expect(neutralizeSesRejections(src)).toBe(src);
  });

  it('defuses import( / eval( / <!-- / --> in comments, keeping columns', () => {
    const src = "// see import('x') and eval(y)\n/* <!-- a --> b, import /* */\nreturn 1;";
    const out = neutralizeSesRejections(src);
    expect(rejected(out)).toBe(false);
    expect(out.split('\n').map((l) => l.length)).toEqual(src.split('\n').map((l) => l.length));
    expect(runWrapped(src)).toBe(1);
  });

  it('defuses them in string and template literals without changing their values', () => {
    const src = String.raw`const a = "eval(x) <!-- --> import(y)";
const b = 'import (z)';
const c = ${'`'}t import( ${'${'} "eval(" ${'}'} -->${'`'};
return [a, b, c];`;
    expect(rejected(src)).toBe(true);
    const out = neutralizeSesRejections(src);
    expect(rejected(out)).toBe(false);
    expect(runWrapped(src)).toEqual(['eval(x) <!-- --> import(y)', 'import (z)', 't import( eval( -->']);
  });

  it('spaces a mid-line --> in code (decrement, then compare) — same meaning', () => {
    const src = 'let i = 3, n = 0;\nwhile (i --> 0) n++;\nreturn n;';
    const out = neutralizeSesRejections(src);
    expect(out).toContain('i -- > 0');
    expect(rejected(out)).toBe(false);
    expect(runWrapped(src)).toBe(3);
  });

  it('leaves real code for SES to reject: import(), eval(), <!--, a line-leading -->', () => {
    for (const src of [
      "const m = import('/src/x.ts');",
      'const m = import (\n"x");',
      'const v = eval("1");',
      'const a = 1 <!--b\n;',
      'const a = 1;\n  --> not code',
      'const r = /import(/;',
    ]) {
      expect(rejected(neutralizeSesRejections(src)), src).toBe(true);
    }
  });

  it('a defused literal can never become working code', () => {
    // The escapes it inserts are a syntax error outside a string.
    expect(() => new Function('return import\\x28"x")')).toThrow(SyntaxError);
  });
});

describe('explainSesRejection', () => {
  it('maps SES messages to the user line with a hint', () => {
    expect(explainSesRejection('Possible import expression rejected at <unknown>:3. (SES_IMPORT_REJECTED)')).toEqual({
      line: 3,
      message: expect.stringMatching(/^Possible import expression rejected on line 3 \(SES_IMPORT_REJECTED\)\.\nHint: dynamic `import\(\)`/),
    });
    expect(explainSesRejection('Possible direct eval expression rejected at <unknown>:1. (SES_EVAL_REJECTED)')?.message).toMatch(/eval/);
    expect(explainSesRejection('Possible HTML comment rejected at <unknown>:12. (SES_HTML_COMMENT_REJECTED)')?.line).toBe(12);
    expect(explainSesRejection('Unexpected token ;')).toBeNull();
  });

  it('the mapped line drives the editor diagnostic (modelLineNumber, no -1 offset)', () => {
    const src = 'const a = 1;\nconst b = 2;\nconst m = import("x");';
    const err = new SyntaxError('x') as SyntaxError & { modelLineNumber: number };
    err.modelLineNumber = 3;
    const [d] = javaScriptSyntaxDiagnostics(src, 'x', err);
    expect(d.line).toBe(3);
    // The legacy Firefox lineNumber is still offset by the new Function header.
    const legacy = new SyntaxError('x') as SyntaxError & { lineNumber: number };
    legacy.lineNumber = 3;
    expect(javaScriptSyntaxDiagnostics(src, 'x', legacy)[0].line).toBe(2);
  });
});

describe('undeclared-name hint', () => {
  const known = new Set(['Math', 'api', 'Array']);
  it('names identifiers used but never declared', () => {
    expect(undeclaredNames('const { Manifold } = api;\nreturn Manfold.cube([Math.PI]);', known)).toEqual(['Manfold']);
    expect(undeclaredNames('function f(x) { return x; }\nconst [a, b] = [1, 2];\nreturn cubee(f(a + b));', known)).toEqual(['cubee']);
    expect(undeclaredNames('const { Manifold: M } = api; return M.cube(1);', known)).toEqual([]);
    expect(undeclaredNames('return navigator.hardwareConcurrency + self.x + setTimeout;', known)).toEqual(['navigator', 'self', 'setTimeout']);
  });
  it('formats one or several names, or nothing', () => {
    expect(undeclaredHint(['Manfold'])).toMatch(/^\nHint: `Manfold` is not defined/);
    expect(undeclaredHint(['a', 'b'])).toMatch(/`a`, `b` are not defined/);
    expect(undeclaredHint([])).toBe('');
  });
});

describe('SES kill switch flag', () => {
  it('parses on/off spellings; unknown values have no opinion', () => {
    for (const v of ['off', 'OFF', '0', 'false', 'no', ' off ']) expect(parseSesFlagValue(v, false)).toBe('off');
    for (const v of ['on', '1', 'true', 'yes']) expect(parseSesFlagValue(v, false)).toBe('on');
    for (const v of ['', 'maybe', null, undefined, 0, {}]) expect(parseSesFlagValue(v, false)).toBeNull();
    expect(parseSesFlagValue('test-fail', false)).toBeNull();
    expect(parseSesFlagValue('test-fail', true)).toBe('test-fail');
  });
  it('defaults ON; localStorage overrides the env default', () => {
    expect(resolveSesFlag(null, undefined, false)).toBe('on');
    expect(resolveSesFlag(null, '0', false)).toBe('off');
    expect(resolveSesFlag('on', '0', false)).toBe('on');
    expect(resolveSesFlag('off', undefined, false)).toBe('off');
    expect(resolveSesFlag('garbage', 'off', false)).toBe('off');
    // test-fail is never honoured from the env, nor outside dev builds.
    expect(resolveSesFlag(null, 'test-fail', true)).toBe('on');
    expect(resolveSesFlag('test-fail', undefined, false)).toBe('on');
  });
});

describe('modelEval without SES (Node / kill switch)', () => {
  it('is the legacy new Function compiler and harden is the identity', () => {
    expect(modelCompilerName()).toBe('function');
    expect(compileModelCode('return api * 2;')(21)).toBe(42);
    expect(() => compileModelCode('return ;;)')).toThrow(SyntaxError);
    const o = { a: 1 };
    expect(hardenModelShared(o)).toBe(o);
    expect(Object.isFrozen(o)).toBe(false);
  });
});
