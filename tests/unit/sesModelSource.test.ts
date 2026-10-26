import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  SES_LOCKDOWN_OPTIONS,
  analyzeFreeGlobals,
  rewriteFreeTypeof,
  explainSesRejection,
  neutralizeSesRejections,
  preludeNames,
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
// SES's HTML-like-comment markers, as plain substrings (see sesModelSource.ts).
const hasHtmlMarker = (src: string) => src.includes('<' + '!--') || src.includes('--' + '>');
const rejected = (src: string) => SES_IMPORT.test(src) || SES_EVAL.test(src) || hasHtmlMarker(src);

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

  it('leaves a line-leading --> after a block comment (an HTML close comment) for SES', () => {
    const src = 'const x = 1;\n/* note */ --> x = 2\nreturn x;';
    expect(rejected(neutralizeSesRejections(src))).toBe(true);
    expect(neutralizeSesRejections(src)).toBe(src);
    const multi = 'const x = 1; /* a\n b */ --> c\nreturn x;';
    expect(neutralizeSesRejections(multi)).toBe(multi);
  });

  it('leaves tagged templates alone (the tag sees the raw text)', () => {
    const src = 'const s = String.raw`eval(x)`;\nreturn s;';
    expect(neutralizeSesRejections(src)).toBe(src);
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

describe('analyzeFreeGlobals (strict-JS ReferenceError for undeclared names)', () => {
  const known = new Set(['Math', 'Array', 'Object', 'JSON', 'console', 'undefined', 'api', 'arguments', 'globalThis']);
  const free = (code: string) => analyzeFreeGlobals(code, known).names;

  it('reports a name nothing declares, with its first line', () => {
    const r = analyzeFreeGlobals('const a = 1;\n\nreturn a + zzznotdefined123;', known);
    expect(r.names).toEqual(['zzznotdefined123']);
    expect(r.firstLine.get('zzznotdefined123')).toBe(3);
    expect(free('const s = siz || 10; return s;')).toEqual(['siz']);
  });

  it('never reports a name declared anywhere, in any scope', () => {
    // var / let / const / function / class / params / catch / destructuring.
    expect(free(String.raw`
      const { Manifold, CrossSection: CS, ...rest } = api;
      const [x, , [y = 2], ...tail] = [1, 2, [3]];
      let { a: { b }, c = b, d: dd = c } = {};
      var v; let l; const k = 1;
      function hoisted(p, { q }, [r], s = p + q + r, ...more) { return later + s + more.length; }
      function later() { return 1; }
      class K extends Object { m(z) { return z + this.f; } static st = 1; f = k; }
      const C = class Named { n() { return Named; } };
      const fn = function self2(n) { return n ? self2(n - 1) : 0; };
      const arrow = (u) => u, arrow2 = w => w;
      try { hoisted(1, {}, [2]); } catch (err) { console.log(err); }
      for (const it of [1]) {} for (let i = 0; i < 1; i++) {} for (const key in {}) {}
      return [Manifold, CS, rest, x, y, tail, a, b, c, dd, v, l, K, C, fn, arrow, arrow2, it, i, key, hoisted, inner];
      function inner() { return 1; }
    `)).toEqual([]);
  });

  it('skips property names, object keys, labels, member accesses and optional chains', () => {
    expect(free(String.raw`
      const o = { aKey: 1, 'str': 2, [Math.PI]: 3, method() { return this.aKey; }, get g() { return 1; } };
      outer: for (const i of [1]) { for (const j of [2]) { if (j) continue outer; break outer; } }
      return o.aKey + o?.notAName?.deeper + api.Manifold?.cube + Array.prototype.map.length;
    `)).toEqual([]);
  });

  it('a shorthand { a } in an object literal is a read; in a pattern it is a declaration', () => {
    expect(free('return { shorthandRead };')).toEqual(['shorthandRead']);
    expect(free('const { declaredHere } = api; return { declaredHere };')).toEqual([]);
  });

  it('sees reads in template literals, closures, default params and class bodies', () => {
    expect(free('return `x ${inTemplate} y`;')).toEqual(['inTemplate']);
    expect(free('const f = () => () => inClosure; return f;')).toEqual(['inClosure']);
    expect(free('function f(a = inDefault) { return a; } return f;')).toEqual(['inDefault']);
    expect(free('class K { m() { return inMethod; } static s = inStatic; } return K;')).toEqual(['inMethod', 'inStatic']);
    expect(free('return a?.[inOptionalIndex];')).toEqual(['a', 'inOptionalIndex']);
  });

  it('collects typeof operands (bare or parenthesized) so they keep answering "undefined"', () => {
    const src = 'const n = typeof navigator !== "undefined" ? navigator.x : (typeof ((self)));\nreturn typeof navigator.y;';
    const r = analyzeFreeGlobals(src, known);
    expect(r.names).toEqual(['navigator', 'self']);
    // `typeof navigator.y` reads navigator, so it is not rewritten.
    const out = rewriteFreeTypeof(src, r.typeofOperands, (n) => `T(${JSON.stringify(n)})`);
    expect(out).toBe('const n = typeof T("navigator") !== "undefined" ? navigator.x : (typeof ((T("self"))));\nreturn typeof navigator.y;');
    expect(out.split('\n').length).toBe(src.split('\n').length);
  });

  it('leaves names the code puts on globalThis itself alone', () => {
    expect(free('globalThis.made = 1; globalThis["alsoMade"] = 2; return made + alsoMade;')).toEqual([]);
  });

  it('finds no free names in any catalog entry or example (no false positives)', () => {
    // The real compartment's globals (SES 2.3, see sesSandbox.ts) + endowments.
    const compartment = new Set([
      'Infinity', 'NaN', 'undefined', 'isFinite', 'isNaN', 'parseFloat', 'parseInt', 'decodeURI', 'decodeURIComponent',
      'encodeURI', 'encodeURIComponent', 'Array', 'ArrayBuffer', 'BigInt', 'BigInt64Array', 'BigUint64Array', 'Boolean',
      'DataView', 'EvalError', 'Int8Array', 'Int16Array', 'Int32Array', 'Map', 'Number', 'Object', 'Promise', 'Proxy',
      'RangeError', 'ReferenceError', 'Set', 'String', 'SyntaxError', 'TypeError', 'Uint8Array', 'Uint8ClampedArray',
      'Uint16Array', 'Uint32Array', 'URIError', 'WeakMap', 'WeakSet', 'Iterator', 'AggregateError', 'JSON', 'Reflect',
      'TextEncoder', 'TextDecoder', 'escape', 'unescape', 'lockdown', 'harden', 'Date', 'Error', 'RegExp', 'Symbol',
      'Math', 'globalThis', 'Compartment', 'eval', 'Function', 'Float16Array', 'Float32Array', 'Float64Array', 'console',
      'performance', 'api', 'arguments',
    ]);
    const root = resolve(__dirname, '../..');
    const sources: Array<[string, string]> = [];
    for (const f of readdirSync(resolve(root, 'public/catalog')).filter((n) => n.endsWith('.partwright.json'))) {
      const j = JSON.parse(readFileSync(resolve(root, 'public/catalog', f), 'utf8')) as { session?: { language?: string }; versions?: Array<{ code?: unknown; language?: string; index?: number }> };
      for (const v of j.versions ?? []) {
        const lang = v.language ?? j.session?.language ?? 'manifold-js';
        if (lang !== 'scad' && typeof v.code === 'string') sources.push([`${f}@${v.index}`, v.code]);
      }
    }
    for (const f of readdirSync(resolve(root, 'examples')).filter((n) => n.endsWith('.js'))) {
      sources.push([f, readFileSync(resolve(root, 'examples', f), 'utf8')]);
    }
    expect(sources.length).toBeGreaterThan(300);
    const hits = sources.map(([name, code]) => [name, analyzeFreeGlobals(code, compartment).names] as const).filter(([, n]) => n.length > 0);
    expect(hits).toEqual([]);
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
