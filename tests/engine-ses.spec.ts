import { test, expect, type Page } from 'playwright/test';
import { markCode, checkCode, MANIFOLD_SEEDS, VOXEL_SEEDS, REPLICAD_SEEDS } from './helpers/sesSharedState';

// SES model-code sandbox (#1127; src/geometry/sesSandbox.ts). Model code runs in
// a fresh Hardened JavaScript Compartment per run, after `lockdown()` froze the
// shared intrinsics. These tests run hostile model code that reports what it
// found by throwing a JSON payload (surfaced as the run's `error`):
//   - isolation: nothing of the Worker global is nameable, the evaluator /
//     constructor chains are inert, built-ins are frozen, a reachability walk
//     from `api` (and from what api calls return) finds no way back;
//   - shared state: nothing one run writes is visible to the next run in the
//     same Worker (api, embind classes, namespaces, BREP, error classes);
//   - error UX: strict-JS ReferenceErrors for undeclared names (with the
//     line), SES source rejections mapped to the
//     user's line, comments/strings containing `import(` etc. still run;
//   - endowments: Math.random, Date.now, Float*Array, console, performance;
//   - kill switch: `partwright.sesSandbox = 'off'` restores the pre-#1127
//     `new Function` path.

type RunResult = { error?: string | null; triangleCount?: number; volume?: number };
type PW = {
  run: (code: string) => Promise<RunResult>;
  setActiveLanguage: (lang: string) => Promise<void>;
  createSession: (name: string) => Promise<unknown>;
};

async function boot(page: Page, ses: 'on' | 'off' = 'on'): Promise<void> {
  if (ses === 'off') {
    await page.addInitScript(() => {
      if (window !== window.top) return;
      try { localStorage.setItem('partwright.sesSandbox', 'off'); } catch { /* ignore */ }
    });
  }
  await page.goto('/editor');
  await page.waitForFunction(() => !!(window as unknown as { partwright?: { run?: unknown } }).partwright?.run, undefined, { timeout: 60_000 });
}

async function run(page: Page, code: string, lang?: string): Promise<RunResult> {
  return page.evaluate(async ({ code, lang }) => {
    const pw = (window as unknown as { partwright: PW }).partwright;
    if (lang) await pw.setActiveLanguage(lang);
    return pw.run(code);
  }, { code, lang });
}

function payload(error: string | null | undefined, tag: string): Record<string, unknown> {
  const m = new RegExp(`${tag}:(\\{.*\\})`, 's').exec(error ?? '');
  expect(m, `unexpected error: ${error}`).toBeTruthy();
  return JSON.parse(m![1]);
}

// Each probe records 'blocked' (good: threw, or returned undefined / the
// inert value) or 'OPEN:<detail>' (a hole).
const ISOLATION_PROBE = String.raw`
  const r = {};
  const blocked = (name, f, ok = (v) => v === undefined || v === 'undefined') => {
    try { const v = f(); r[name] = ok(v) ? 'blocked' : 'OPEN:' + String(v).slice(0, 80); }
    catch (e) { r[name] = 'blocked'; }
  };
  for (const n of ['self', 'postMessage', 'importScripts', 'onmessage', 'navigator', 'location', 'fetch',
    'XMLHttpRequest', 'WebSocket', 'indexedDB', 'caches', 'Worker', 'BroadcastChannel', 'WebAssembly',
    'SharedArrayBuffer', 'Atomics', 'setTimeout', 'setInterval', 'queueMicrotask', 'MessageEvent',
    'MessagePort', 'EventTarget', 'WorkerGlobalScope', 'crypto', 'structuredClone', 'URL', 'Blob']) {
    blocked('typeof ' + n, () => (0, eval)('typeof ' + n));
    blocked('globalThis.' + n, () => globalThis[n]);
  }
  blocked('globalThis is the compartment global', () => Object.prototype.toString.call(globalThis), (v) => v === '[object Object]');
  blocked('Function(return this)', () => Function('return this')());
  blocked('fn.constructor(return this)', () => (function () {}).constructor('return this')());
  blocked('async fn ctor', () => (async function () {}).constructor('return 1'));
  blocked('generator fn ctor', () => (function* () {}).constructor('yield 1'));
  blocked('api.Manifold.constructor', () => api.Manifold.constructor('return this')());
  blocked('api.Manifold.cube.constructor', () => api.Manifold.cube.constructor('return typeof postMessage')(), (v) => v === undefined || v === 'undefined');
  blocked('indirect eval', () => (0, eval)('typeof postMessage'));
  const patch = (name, f) => blocked('patch ' + name, () => { f(); return 'PATCHED'; });
  patch('Object.prototype', () => { Object.prototype.__x = 1; });
  patch('Array.prototype.map', () => { Array.prototype.map = Array.prototype.map; });
  patch('Object.keys', () => { Object.keys = Object.keys; });
  patch('JSON.stringify', () => { JSON.stringify = JSON.stringify; });
  patch('Function.prototype.call', () => { Function.prototype.call = Function.prototype.call; });
  patch('Promise.prototype.then', () => { Promise.prototype.then = Promise.prototype.then; });
  patch('String.prototype.startsWith', () => { String.prototype.startsWith = String.prototype.startsWith; });
  patch('Float32Array.prototype.set', () => { Float32Array.prototype.set = Float32Array.prototype.set; });
  patch('Math.sin', () => { Math.sin = Math.sin; });
  patch('console.log', () => { console.log = console.log; });
  // V8 structured stack traces are the classic way to reach outer-realm
  // receivers/functions (CallSite#getThis/getFunction). Try the compartment's
  // Error and the ORIGINAL Error behind an engine error class
  // (ValidationError extends the pre-lockdown Error).
  const hook = (E) => { const seen = []; E.prepareStackTrace = (e, cs) => { for (const c of cs) { try { seen.push(typeof c.getThis()); } catch (x) {} } return 'HOOKED'; }; return seen; };
  blocked('Error.prepareStackTrace (compartment)', () => { hook(Error); let s; try { api.Manifold.cube('bad'); } catch (e) { s = e.stack; } return s === 'HOOKED' ? 'HOOKED' : undefined; });
  let vErr = null; try { api.Manifold.sphere(); } catch (e) { vErr = e; }
  r.__gotValidationError = !!vErr;
  blocked('original Error via ValidationError', () => { const E = Object.getPrototypeOf(vErr.constructor); hook(E); let s; try { api.Manifold.cube('bad'); } catch (e) { s = e.stack; } return s === 'HOOKED' ? 'HOOKED' : undefined; });
  blocked('original Error.captureStackTrace swap', () => { const E = Object.getPrototypeOf(vErr.constructor); E.captureStackTrace = () => {}; return 'PATCHED'; });
  blocked('patch ValidationError.prototype', () => { Object.getPrototypeOf(vErr).toString = () => 'x'; return 'PATCHED'; });
  // What model code legitimately needs still works.
  r.__endowments = [typeof Math.random(), typeof Date.now(), String(new Date(0).getTime()), new Float32Array([1.5])[0],
    new Float64Array(1).length, typeof console.log, typeof performance.now(), typeof Uint8Array, typeof Map, typeof TextEncoder];
  throw new Error('PROBE:' + JSON.stringify(r));
`;

// Reachability walk over everything model code can reach from `api` and from
// what api calls return (data properties + [[Prototype]], no getters).
const WALK_PROBE = (seeds: string) => String.raw`
  const tag = (o) => { try { return Object.prototype.toString.call(o); } catch (e) { return ''; } }; // guard proxies throw on get
  const seen = new Set(); const q = []; let head = 0; const hits = []; let n = 0;
  for (const [label, v] of ${seeds}) q.push([v, label]);
  while (head < q.length && n < 50000) {
    const [o, path] = q[head++];
    if (o === null || (typeof o !== 'object' && typeof o !== 'function') || seen.has(o)) continue;
    seen.add(o); n++;
    if (/WorkerGlobalScope|Window/.test(tag(o))) hits.push('GLOBAL@' + path);
    for (const k of ['postMessage', 'importScripts', 'fetch', 'indexedDB', 'onmessage']) {
      try { if (Object.getOwnPropertyDescriptor(o, k)) hits.push(k + '@' + path); } catch (e) {}
    }
    try { if (typeof o === 'object' && 'HEAPU8' in o) hits.push('EMSCRIPTEN_MODULE@' + path); } catch (e) {}
    if (typeof o === 'function' && (o.name === 'Function' || o.name === 'eval') && o !== Function && o !== eval) {
      try { const res = o.name === 'eval' ? o('typeof importScripts') : o('return typeof importScripts')(); if (res !== 'undefined') hits.push('EVALUATOR@' + path); } catch (e) {}
    }
    let keys = [];
    try { keys = ArrayBuffer.isView(o) ? [] : Reflect.ownKeys(o); } catch (e) { continue; }
    for (const k of keys) { let d; try { d = Object.getOwnPropertyDescriptor(o, k); } catch (e) { continue; } if (d && 'value' in d) q.push([d.value, path + '.' + String(k)]); }
    let p; try { p = Object.getPrototypeOf(o); } catch (e) { p = null; } if (p) q.push([p, path + '.__proto__']);
  }
  throw new Error('WALK:' + JSON.stringify({ visited: n, hits: hits.slice(0, 20) }));
`;

function expectAllBlocked(report: Record<string, unknown>, hasValidationError = true): void {
  const holes = Object.entries(report).filter(([k, v]) => !k.startsWith('__') && v !== 'blocked');
  expect(holes, `reachable from model code: ${JSON.stringify(holes)}`).toEqual([]);
  // The original-Error probes need an engine ValidationError to start from.
  if (hasValidationError) expect(report.__gotValidationError).toBe(true);
  expect(report.__endowments).toEqual(['number', 'number', '0', 1.5, 1, 'function', 'number', 'function', 'function', 'function']);
}

test.describe('SES model-code sandbox', () => {
  test('runs model code in a compartment: no Worker global, inert evaluators, frozen built-ins', async ({ page }) => {
    test.setTimeout(120_000);
    await boot(page);
    const manifold = payload((await run(page, ISOLATION_PROBE)).error, 'PROBE');
    expectAllBlocked(manifold);
    const info = await page.evaluate(async () => (await import('/src/geometry/engine.ts')).getEngineWorkerReadyInfo());
    expect(info?.compiler).toBe('ses-compartment');
    // Worker boot: SES lockdown + manifold-3d init + global audit.
    console.log(`[ses] worker ready: ${JSON.stringify(info)}`);
    // Voxel and replicad sessions get the same compartment (the probe's
    // api.Manifold calls work there too: replicad exposes Manifold; voxel
    // doesn't, so swap in its own throwing call).
    const voxProbe = ISOLATION_PROBE
      .replace(/api\.Manifold\.cube\('bad'\)/g, "api.voxels().set('x')")
      .replace(/api\.Manifold\.sphere\(\)/, "api.voxels().set('x')")
      .replace(/api\.Manifold\.(constructor|cube\.constructor)/g, 'api.voxels.$1');
    expectAllBlocked(payload((await run(page, voxProbe, 'voxel')).error, 'PROBE'));
    // (replicad's api throws plain Errors — no ValidationError to start from.)
    expectAllBlocked(payload((await run(page, ISOLATION_PROBE, 'replicad')).error, 'PROBE'), false);
    // The engine is healthy after the hostile runs.
    const cube = await run(page, 'const { Manifold } = api; return Manifold.cube([10, 10, 10], true);', 'manifold-js');
    expect(cube.error ?? null).toBeNull();
    expect(cube.triangleCount).toBe(12);
  });

  test('dynamic import() is refused at compile time, naming the line', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(async () => {
      const pw = (window as unknown as { partwright: PW }).partwright;
      return pw.run("const { Manifold } = api;\n\nconst m = import('/src/geometry/workerLockdown.ts');\nreturn Manifold.cube(1);");
    });
    expect(r.error).toMatch(/^Possible import expression rejected on line 3 \(SES_IMPORT_REJECTED\)\.\nHint: dynamic `import\(\)` is not available/);
    // …and the editor diagnostic lands on that line.
    const diag = await page.evaluate(async () => {
      const e = await import('/src/geometry/engine.ts');
      const res = await e.executeCodeAsync("const a = 1;\nconst b = import('x');\nreturn a;", 'manifold-js');
      return res.diagnostics?.[0]?.line ?? null;
    });
    expect(diag).toBe(2);
  });

  test('a reachability walk from api and its return values finds no way back to the Worker', async ({ page }) => {
    test.setTimeout(180_000);
    await boot(page);
    for (const [lang, seeds] of [['manifold-js', MANIFOLD_SEEDS], ['voxel', VOXEL_SEEDS], ['replicad', REPLICAD_SEEDS]] as const) {
      const out = payload((await run(page, WALK_PROBE(seeds), lang)).error, 'WALK') as { visited: number; hits: string[] };
      expect(out.hits, `${lang}: ${JSON.stringify(out.hits)}`).toEqual([]);
      expect(out.visited, lang).toBeGreaterThan(lang === 'voxel' ? 100 : 300);
      console.log(`[ses] ${lang} reachability walk: ${out.visited} objects, no hits`);
    }
  });

  test('no shared mutable state: nothing a run writes is visible to the next run', async ({ page }) => {
    test.setTimeout(180_000);
    await boot(page);
    // Run 1 stamps every object it can reach and extend; run 2 (same Worker)
    // looks for the stamp. Anything found outlived run 1 AND was writable.
    for (const [lang, seeds, ret] of [
      ['manifold-js', MANIFOLD_SEEDS, 'return api.Manifold.cube([1, 1, 1]);'],
      ['voxel', VOXEL_SEEDS, "const g = api.voxels(); g.set(0, 0, 0, '#fff'); return g;"],
      ['replicad', REPLICAD_SEEDS, 'return api.BREP.box([3, 3, 3]);'],
    ] as const) {
      const mark = await run(page, markCode(seeds, ret), lang);
      expect(mark.error ?? null, `${lang} mark run`).toBeNull();
      const out = payload((await run(page, checkCode(seeds), lang)).error, 'SHARED') as { visited: number; found: string[] };
      expect(out.found, `${lang}: shared mutable objects ${JSON.stringify(out.found)}`).toEqual([]);
      expect(out.visited, lang).toBeGreaterThan(100);
    }
  });

  test('patching api.Manifold.prototype / api.Curves / a method in one run does not reach the next', async ({ page }) => {
    await boot(page);
    const out = await page.evaluate(async () => {
      const pw = (window as unknown as { partwright: PW }).partwright;
      const attempt = await pw.run(`
        const { Manifold } = api;
        const tried = {};
        const t = (k, f) => { try { f(); tried[k] = 'WROTE'; } catch (e) { tried[k] = 'refused'; } };
        t('Manifold.prototype.x', () => { Manifold.prototype.x = 1; });
        t('Curves.y', () => { api.Curves.y = 1; });
        t('replace Manifold.prototype.translate', () => { Manifold.prototype.translate = function () { return this; }; });
        t('replace Manifold.cube', () => { Manifold.cube = () => Manifold.sphere(1); });
        t('replace Curves.text', () => { api.Curves.text = () => null; });
        t('api.extra', () => { api.extra = 1; });
        // The compartment's own global object is writable — it is per run.
        globalThis.planted = 1;
        if (Object.values(tried).some((v) => v === 'WROTE')) throw new Error('TRIED:' + JSON.stringify(tried));
        return Manifold.cube([2, 2, 2]).translate([5, 0, 0]);`);
      const next = await pw.run(`
        const { Manifold } = api;
        const seen = { protoX: Manifold.prototype.x, curvesY: api.Curves.y, planted: globalThis.planted, extra: api.extra,
          translateNative: Manifold.prototype.translate.length, textFn: typeof api.Curves.text };
        if (seen.protoX !== undefined || seen.curvesY !== undefined || seen.planted !== undefined || seen.extra !== undefined || seen.textFn !== 'function') throw new Error('SEEN:' + JSON.stringify(seen));
        return Manifold.cube([2, 2, 2]).translate([5, 0, 0]);`);
      return { attempt, next };
    });
    // Every write was refused, and both runs build the same geometry.
    expect(out.attempt.error ?? null).toBeNull();
    expect(out.next.error ?? null).toBeNull();
    expect(out.attempt.triangleCount).toBe(12);
    expect(out.next.triangleCount).toBe(12);
    expect(out.next.volume).toBeCloseTo(8, 6);
  });

  test('undeclared names throw ReferenceError like strict JS — only when the read runs, with the line', async ({ page }) => {
    await boot(page);
    const out = await page.evaluate(async () => {
      const e = await import('/src/geometry/engine.ts');
      const run = async (code: string) => {
        const r = await e.executeCodeAsync(code, 'manifold-js');
        return { error: r.error ?? null, tris: r.mesh?.numTri ?? 0, line: r.diagnostics?.[0]?.line ?? null };
      };
      return {
        bare: await run('return zzznotdefined123;'),
        fallback: await run('const { Manifold } = api;\n\nconst s = siz || 10;\nreturn Manifold.cube([s, 1, 1]);'),
        // First reference (line 2) is dead code; the read that runs is on line 4.
        laterLine: await run('const { Manifold } = api;\nif (false) late;\nfunction f() {\n  return late;\n}\nreturn f();'),
        // typeof guards, dead code, uncalled helpers and code-made globals all still run.
        valid: await run([
          'const { Manifold } = api;',
          'const n = typeof navigator !== "undefined" && navigator.hardwareConcurrency ? 2 : 1;',
          'const w = typeof (window) === "undefined" ? 1 : window.x;',
          'if (false) nope();',
          'function never() { return alsoNope; }',
          'globalThis["made"] = 3; const k = "other" + "Made"; globalThis[k] = 4;',
          'return Manifold.cube([n + w, made, otherMade]);',
        ].join('\n')),
        // Assigning an undeclared name throws too (strict JS)…
        typoAssign: await run('const { Manifold } = api;\nlet width = 10;\nwidht = 20;\nreturn Manifold.cube([width, 1, 1]);'),
        undeclaredLoop: await run('const { Manifold } = api;\nfor (i = 0; i < 3; i++) {}\nreturn Manifold.cube(1);'),
        // …unless the code writes globals through a computed globalThis key,
        // where `x = …` and `globalThis[k] = …` can't be told apart.
        computedGlobal: await run('const { Manifold } = api;\nconst k = "s" + "z";\nglobalThis[k] = 2;\nsz = sz + 1;\nreturn Manifold.cube([sz, 1, 1]);'),
        // Inherited global properties read like plain JS.
        inherited: await run('const { Manifold } = api;\nif (typeof toString !== "function" || typeof hasOwnProperty !== "function") throw new Error("typeof inherited");\nreturn Manifold.cube(1);'),
        // Known gap: declared somewhere, but not in scope where it's read —
        // SES reads it as undefined (strict JS would throw ReferenceError).
        outOfScope: await run('const { Manifold } = api;\nfunction g() { const Manfold = 1; return Manfold; }\nreturn Manfold.cube([1, 1, 1]);'),
      };
    });
    expect(out.bare).toEqual({ error: 'zzznotdefined123 is not defined', tris: 0, line: 1 });
    expect(out.fallback).toEqual({ error: 'siz is not defined', tris: 0, line: 3 });
    expect(out.laterLine).toEqual({ error: 'late is not defined', tris: 0, line: 4 });
    expect(out.typoAssign).toEqual({ error: 'widht is not defined', tris: 0, line: 3 });
    expect(out.undeclaredLoop).toEqual({ error: 'i is not defined', tris: 0, line: 2 });
    expect(out.computedGlobal.error).toBeNull();
    expect(out.computedGlobal.tris).toBe(12);
    expect(out.inherited.error).toBeNull();
    expect(out.valid.error).toBeNull();
    expect(out.valid.tris).toBe(12);
    expect(out.outOfScope.error).toBe("Cannot read properties of undefined (reading 'cube')");
  });

  test('the glue error classes (embind BindingError, ManifoldError) cannot carry code into a later run', async ({ page }) => {
    await boot(page);
    const out = await page.evaluate(async () => {
      const pw = (window as unknown as { partwright: PW }).partwright;
      const attempt = await pw.run(`
        const { Manifold } = api;
        const tried = {};
        const grab = (f) => { try { f(); } catch (e) { return e; } return null; };
        const errs = { binding: grab(() => Manifold.cube([1, 1, 1]).add(5)), manifold: grab(() => new Manifold({})),
          deleted: grab(() => { const t = Manifold.cube([1, 1, 1]); t.delete(); return t.volume(); }) };
        for (const [k, e] of Object.entries(errs)) {
          if (!e) { tried[k] = 'no error'; continue; }
          try { e.constructor.prototype.toString = () => 'PWNED'; tried[k] = 'WROTE'; } catch (x) { tried[k] = 'refused'; }
          try { Object.defineProperty(e.constructor.prototype, 'code', { set() { globalThis.leak = 1; } }); tried[k + '.code'] = 'WROTE'; } catch (x) { tried[k + '.code'] = 'refused'; }
        }
        throw new Error('TRIED:' + JSON.stringify(tried));`);
      const next = await pw.run(`
        const { Manifold } = api;
        let msg = '';
        try { Manifold.cube([1, 1, 1]).add(5); } catch (e) { msg = String(e) + ' ' + String(e.stack).slice(0, 80); }
        throw new Error('NEXT:' + JSON.stringify({ msg }));`);
      return { attempt: attempt.error ?? '', next: next.error ?? '' };
    });
    const tried = payload(out.attempt, 'TRIED') as Record<string, string>;
    for (const [k, v] of Object.entries(tried)) expect(v, k).not.toBe('WROTE');
    expect(tried.binding).toBe('refused');
    expect((payload(out.next, 'NEXT') as { msg: string }).msg).not.toContain('PWNED');
  });

  test('typeof a free name answers like plain JS, also after the code makes it a global', async ({ page }) => {
    await boot(page);
    const r = await run(page, `
      const before = typeof madeLater;
      const k = 'made' + 'Later';
      globalThis[k] = 5;
      throw new Error('T:' + JSON.stringify({ before, after: typeof madeLater, value: madeLater, other: typeof (neverMade) }));`);
    expect(payload(r.error, 'T')).toEqual({ before: 'undefined', after: 'number', value: 5, other: 'undefined' });
  });

  test('error UX: browser globals are not defined, and comments/strings mentioning import( / eval( / --> still run', async ({ page }) => {
    await boot(page);
    const out = await page.evaluate(async () => {
      const pw = (window as unknown as { partwright: PW }).partwright;
      const typo = await pw.run('const { Manifold } = api;\nreturn Manfold.cube([1, 1, 1]);');
      const browserGlobal = await pw.run('const { Manifold } = api;\nreturn Manifold.cube([navigator.hardwareConcurrency, 1, 1]);');
      const comments = await pw.run([
        "// see import('x'), eval(y) and <!-- html --> comments",
        '/* a --> b */',
        'const s = "import(1) eval(2) <!-- -->";',
        'const t = `tpl import( ${s.length}`;',
        'let i = 3, n = 0; while (i --> 0) n++;',
        'const { Manifold } = api;',
        'return Manifold.cube([s.length, t.length, n]);',
      ].join('\n'));
      const realEval = await pw.run('const { Manifold } = api;\nconst v = eval("1");\nreturn Manifold.cube(1);');
      return { typo: typo.error ?? '', browserGlobal: browserGlobal.error ?? '', comments, realEval: realEval.error ?? '' };
    });
    expect(out.typo).toBe('Manfold is not defined');
    expect(out.browserGlobal).toBe('navigator is not defined');
    expect(out.comments.error ?? null).toBeNull();
    // The literals kept their values: "import(1) eval(2) <!-- -->" is 26 chars,
    // `tpl import( 26` is 14, and `i --> 0` looped 3 times.
    expect(out.comments.volume).toBeCloseTo(26 * 14 * 3, 6);
    expect(out.realEval).toMatch(/rejected on line 2 \(SES_EVAL_REJECTED\)/);
  });

  test('the kill switch restores the pre-SES new Function path', async ({ page }) => {
    await boot(page, 'off');
    const out = await page.evaluate(async () => {
      const pw = (window as unknown as { partwright: PW }).partwright;
      const r = await pw.run('throw new Error("REALM:" + JSON.stringify({ self: typeof self, nav: typeof navigator, tag: Object.prototype.toString.call(globalThis), frozen: Object.isFrozen(Object.prototype) }));');
      const cube = await pw.run('return api.Manifold.cube([3, 3, 3]);');
      const info = (await import('/src/geometry/engine.ts')).getEngineWorkerReadyInfo();
      return { probe: r.error ?? '', cube, info };
    });
    expect(payload(out.probe, 'REALM')).toEqual({ self: 'object', nav: 'object', tag: '[object DedicatedWorkerGlobalScope]', frozen: false });
    expect(out.cube.triangleCount).toBe(12);
    expect(out.info?.compiler).toBe('function');
    expect(out.info?.sesMs ?? null).toBeNull();
  });

  test('every engine still renders under SES: SDF figure, levelSet closure, BOSL2, Phase C BREP, replicad', async ({ page }) => {
    test.setTimeout(240_000);
    await boot(page);
    const out = await page.evaluate(async () => {
      const pw = (window as unknown as { partwright: PW }).partwright;
      const results: Record<string, RunResult> = {};
      results.levelSet = await pw.run(`const { Manifold } = api;
        const sdf = (p) => Math.sqrt(p[0]*p[0] + p[1]*p[1] + p[2]*p[2]) - 5 + 0.3 * Math.sin(p[0]) * Math.cos(p[1]);
        return Manifold.levelSet(sdf, { min: [-7, -7, -7], max: [7, 7, 7] }, 0.5);`);
      results.sdf = await pw.run('const s = api.sdf; return s.smoothUnion(s.sphere(4), s.box([6, 2, 2]), 1).build({ edgeLength: 0.6 });');
      results.text = await pw.run('return api.text("Hi", { size: 8, height: 2 });');
      results.paintSurface = await pw.run(`const { Manifold } = api;
        const body = api.label(Manifold.sphere(6, 48), 'body', { color: '#ff8800' });
        api.paint.slab({ axis: 'z', offset: 2, thickness: 1, color: '#0000ff' });
        api.surface.fuzzy({ amplitude: 0.2 });
        api.material('brass');
        return body;`);
      results.phaseC = await pw.run('const { Manifold, BREP } = api;\nreturn BREP.toManifold(BREP.box([20, 20, 10]).fillet(2), Manifold);');
      await pw.setActiveLanguage('replicad');
      results.replicad = await pw.run('const { BREP } = api; return BREP.cylinder(5, 10).fillet(1);');
      await pw.setActiveLanguage('voxel');
      results.voxel = await pw.run("const v = api.voxels(); v.fillBox([0,0,0],[4,4,4],'#88aaff'); v.sdf(api.sdf.sphere(3).translate([2,2,6]), { res: 1, color: '#ff0000' }); return v;");
      await pw.setActiveLanguage('scad');
      results.bosl2 = await pw.run('include <BOSL2/std.scad>\ncuboid([20, 20, 10], rounding = 2);');
      return results;
    });
    for (const [k, r] of Object.entries(out)) {
      expect(r.error ?? null, k).toBeNull();
      expect(r.triangleCount ?? 0, k).toBeGreaterThan(10);
    }
  });
});

test.describe('SES model-code sandbox — other Workers', () => {
  test('the Assembly pool workers run model code under SES too', async ({ page }) => {
    test.setTimeout(120_000);
    await boot(page);
    const out = await page.evaluate(async () => {
      const pool = await import('/src/geometry/enginePool.ts');
      const code = 'throw new Error("POOL:" + JSON.stringify({ self: typeof self, frozen: Object.isFrozen(Array.prototype) }));';
      const cube = await pool.buildInPool({ code: 'return api.Manifold.cube([4, 4, 4]);', lang: 'manifold-js' });
      const probe = await pool.buildInPool({ code, lang: 'manifold-js' });
      pool.disposeEnginePool();
      return { cubeTris: cube.mesh?.numTri ?? null, cubeError: cube.error ?? null, probe: probe.error ?? '' };
    });
    expect(out.cubeError).toBeNull();
    expect(out.cubeTris).toBe(12);
    expect(payload(out.probe, 'POOL')).toEqual({ self: 'undefined', frozen: true });
  });

  test('the #1110 iframe-sandbox Worker runs model code under SES too', async ({ page }) => {
    test.setTimeout(180_000);
    await page.addInitScript(() => {
      if (window !== window.top) return;
      try { localStorage.setItem('partwright-engine-sandbox', 'origin'); } catch { /* ignore */ }
    });
    await boot(page);
    const sandboxOrigin = await page.evaluate(() => (window as unknown as { partwright: { getEngineSandboxStatus: () => { sandboxOrigin: string | null } } }).partwright.getEngineSandboxStatus().sandboxOrigin);
    test.skip(!sandboxOrigin, 'dev server has no VITE_SANDBOX_ORIGIN configured');
    const cube = await run(page, 'return api.Manifold.cube([1, 1, 1]);');
    expect(cube.error ?? null).toBeNull();
    const status = await page.evaluate(() => (window as unknown as { partwright: { getEngineSandboxStatus: () => { active: string } } }).partwright.getEngineSandboxStatus());
    expect(status.active).toBe('origin');
    expectAllBlocked(payload((await run(page, ISOLATION_PROBE)).error, 'PROBE'));
    const phaseC = await run(page, 'const { Manifold, BREP } = api;\nreturn BREP.toManifold(BREP.box([10, 10, 10]).fillet(1), Manifold);');
    expect(phaseC.error ?? null).toBeNull();
    expect(phaseC.triangleCount ?? 0).toBeGreaterThan(100);
  });
});
