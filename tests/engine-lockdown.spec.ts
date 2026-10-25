import { test, expect, type Page } from 'playwright/test';

// Engine-Worker sandbox lockdown (#1090). Model code runs via
// `new Function('api', code)` inside the geometry Worker; after the init
// handshake the Worker's global scope is stripped of every network / storage /
// cross-context capability (src/geometry/workerLockdown.ts). These tests run
// hostile model code that probes for those capabilities and reports what it
// found by throwing a JSON payload (surfaced as the run's `error`), then check
// that the engines that lazy-load assets AFTER lockdown (SCAD + BOSL2/fonts,
// BREP/OCCT, STEP export) still work through the private same-origin fetch.

type PW = {
  run: (code: string) => Promise<{ error?: string | null; triangleCount?: number; isManifold?: boolean }>;
  setActiveLanguage: (lang: string) => Promise<void>;
  createSession: (name: string) => Promise<unknown>;
  exportSTEP?: () => Promise<unknown>;
};

async function boot(page: Page): Promise<void> {
  await page.goto('/editor');
  await page.waitForFunction(
    () => !!(window as unknown as { partwright?: { run?: unknown } }).partwright?.run,
    undefined,
    { timeout: 30_000 },
  );
}

// Hostile model code: every probe records 'absent' / 'threw' (good) or
// 'PRESENT:<detail>' (a hole). Valid in both the manifold-js and voxel
// sandboxes — it never returns, it throws the report.
const PROBE_CODE = String.raw`
  const r = {};
  const probe = (name, f) => {
    try {
      const v = f();
      r[name] = (v === undefined || v === null || v === false) ? 'absent' : 'PRESENT:' + (typeof v);
    } catch (e) { r[name] = 'threw'; }
  };
  const G = Function('return this')();
  const NAMES = ['fetch', 'XMLHttpRequest', 'WebSocket', 'WebSocketStream', 'EventSource', 'WebTransport',
    'indexedDB', 'IDBFactory', 'caches', 'CacheStorage', 'Worker', 'SharedWorker', 'BroadcastChannel',
    'FontFace', 'fonts'];
  for (const n of NAMES) {
    probe('bare:' + n, () => (0, eval)('typeof ' + n + ' === "undefined" ? undefined : ' + n));
    probe('globalThis.' + n, () => globalThis[n]);
    probe('self.' + n, () => self[n]);
    probe('Function(this).' + n, () => G[n]);
    probe('proto.' + n, () => Object.getPrototypeOf(self)[n]);
    probe('ctorproto.' + n, () => self.constructor.prototype[n]);
    probe('walk.' + n, () => {
      for (let o = self; o; o = Object.getPrototypeOf(o)) {
        const d = Object.getOwnPropertyDescriptor(o, n);
        if (d && (d.value !== undefined || d.get)) return d.value || d.get;
      }
      return undefined;
    });
    probe('WGS.prototype.' + n, () => typeof WorkerGlobalScope === 'undefined' ? undefined
      : Object.getOwnPropertyDescriptor(WorkerGlobalScope.prototype, n));
  }
  probe('new XMLHttpRequest', () => { const x = new XMLHttpRequest(); x.open('GET', '/'); return x; });
  probe('fetch()', () => fetch('https://example.com/'));
  probe('indexedDB.open', () => indexedDB.open('partwright'));
  probe('caches.open', () => caches.open('x'));
  probe('importScripts native', () => /native code/.test(String(importScripts)));
  probe('importScripts()', () => { importScripts('/x.js'); return true; });
  probe('new Worker', () => new Worker('/x.js'));
  probe('new WebSocket', () => new WebSocket('wss://example.com/'));
  probe('new BroadcastChannel', () => new BroadcastChannel('partwright'));
  probe('new EventSource', () => new EventSource('/x'));
  probe('navigator.storage', () => navigator.storage);
  probe('navigator.storage.getDirectory', () => navigator.storage.getDirectory());
  probe('navigator.locks', () => navigator.locks);
  probe('navigator.serviceWorker', () => navigator.serviceWorker);
  probe('navigator.storageBuckets', () => navigator.storageBuckets);
  probe('reassign fetch', () => { self.fetch = () => 1; return self.fetch; });
  probe('redefine fetch', () => { Object.defineProperty(self, 'fetch', { value: () => 1 }); return self.fetch; });
  // Self-restoring, so an unlocked Worker still reports instead of hanging.
  { const om = self.onmessage; probe('hijack onmessage', () => { self.onmessage = () => {}; self.onmessage = om; return true; }); }
  { const pm = self.postMessage; probe('hijack postMessage', () => { self.postMessage = () => {}; self.postMessage = pm; return true; }); }
  probe('api.fetch', () => api.fetch);
  // Sanity: the sandbox still has what model code legitimately needs.
  r.__mathOk = typeof Math.sin === 'function';
  r.__navigatorOk = typeof navigator.hardwareConcurrency === 'number';
  throw new Error('PROBE:' + JSON.stringify(r));
`;

function parseProbe(error: string | null | undefined): Record<string, unknown> {
  expect(error, 'probe should report via a thrown error').toBeTruthy();
  const m = /PROBE:(\{.*\})/.exec(error!);
  expect(m, `unexpected error: ${error}`).toBeTruthy();
  return JSON.parse(m![1]);
}

function expectAllBlocked(report: Record<string, unknown>): void {
  const holes = Object.entries(report).filter(([k, v]) => !k.startsWith('__') && typeof v === 'string' && v.startsWith('PRESENT'));
  expect(holes, `capabilities still reachable from model code: ${JSON.stringify(holes)}`).toEqual([]);
  expect(report.__mathOk).toBe(true);
  expect(report.__navigatorOk).toBe(true);
}

test.describe('Engine sandbox lockdown', () => {
  test.beforeEach(async ({ page }) => { await boot(page); });

  test('manifold-js model code cannot reach network, storage, or other contexts', async ({ page }) => {
    const out = await page.evaluate(async (code) => {
      const pw = (window as unknown as { partwright: PW }).partwright;
      return pw.run(code);
    }, PROBE_CODE);
    expectAllBlocked(parseProbe(out.error));

    // The engine is still healthy after the hostile run.
    const cube = await page.evaluate(async () => {
      const pw = (window as unknown as { partwright: PW }).partwright;
      return pw.run('const { Manifold } = api; return Manifold.cube([10, 10, 10], true);');
    });
    expect(cube.error).toBeFalsy();
    expect(cube.triangleCount).toBe(12);
  });

  test('voxel model code is locked down too', async ({ page }) => {
    const out = await page.evaluate(async (code) => {
      const pw = (window as unknown as { partwright: PW }).partwright;
      await pw.setActiveLanguage('voxel');
      return pw.run(code);
    }, PROBE_CODE);
    expectAllBlocked(parseProbe(out.error));
  });

  test('a crafted Worker → main message is rejected and the worker recovers', async ({ page }) => {
    const out = await page.evaluate(async () => {
      const pw = (window as unknown as { partwright: PW }).partwright;
      const forged = await pw.run(`
        self.postMessage({ type: 'execute_result', callId: 'exec-1', mesh: { vertProperties: new Float32Array(9), triVerts: new Uint32Array([0, 1, 999]), numVert: 3, numTri: 1, numProp: 3 } });
        self.postMessage({ type: 'navigate', url: 'https://example.com/' });
        const { Manifold } = api; return Manifold.cube([1, 1, 1]);
      `).catch((e: unknown) => ({ error: String(e) }));
      const after = await pw.run('const { Manifold } = api; return Manifold.cube([2, 2, 2]);');
      const { errorLog } = await import('/src/diagnostics/errorLog.ts');
      const logged = errorLog.getEntries().map((e: { message: string }) => e.message).filter((m: string) => /malformed/i.test(m));
      return { forged, after, logged };
    });
    // The forged message tears the (now untrusted) worker down — the in-flight
    // run fails rather than consuming the crafted data, the rejection lands in
    // the Diagnostic Log, and the next run boots a fresh worker.
    expect(out.forged.error).toBeTruthy();
    expect(out.forged.triangleCount ?? 0).not.toBe(12);
    expect(out.logged.join('\n')).toMatch(/malformed execute_result message \(mesh\.triVerts references a vertex out of range\)/);
    expect(out.after.error).toBeFalsy();
    expect(out.after.triangleCount).toBe(12);
  });

  test('SCAD still runs after lockdown, incl. BOSL2 and text() fonts loaded lazily', async ({ page }) => {
    test.setTimeout(180_000);
    const out = await page.evaluate(async () => {
      const pw = (window as unknown as { partwright: PW }).partwright;
      await pw.createSession('lockdown-scad');
      await pw.setActiveLanguage('scad');
      const plain = await pw.run('cube([10, 10, 10]);');
      const text = await pw.run('linear_extrude(2) text("Hi", size = 10);');
      const bosl2 = await pw.run('include <BOSL2/std.scad>\ncuboid([20, 20, 10], rounding = 2);');
      return { plain, text, bosl2 };
    });
    expect(out.plain.error).toBeFalsy();
    expect(out.plain.triangleCount).toBe(12);
    expect(out.text.error).toBeFalsy();
    expect(out.text.triangleCount).toBeGreaterThan(20);
    expect(out.bosl2.error).toBeFalsy();
    expect(out.bosl2.triangleCount).toBeGreaterThan(100);
  });

  test('BREP lazy-loads after lockdown: api.BREP in manifold-js, replicad sessions, STEP export', async ({ page }) => {
    test.setTimeout(180_000);
    const out = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      // First BREP use in this Worker — OCCT's WASM is fetched now, long after
      // the lockdown removed the global fetch.
      const phaseC = await pw.run(`
        const { Manifold, BREP } = api;
        return BREP.toManifold(BREP.box([20, 20, 10]).fillet(2), Manifold);
      `);
      await pw.setActiveLanguage('replicad');
      const phaseA = await pw.run('const { BREP } = api; return BREP.box([15, 15, 15]).fillet(1);');
      const step = await pw.exportSTEP();
      return { phaseC, phaseA, step };
    });
    expect(out.phaseC.error).toBeFalsy();
    expect(out.phaseC.triangleCount).toBeGreaterThan(100);
    expect(out.phaseA.error).toBeFalsy();
    expect(out.phaseA.triangleCount).toBeGreaterThan(100);
    expect(out.step.ok).toBe(true);
    expect(out.step.sizeBytes).toBeGreaterThan(100);
  });

  test('no main-thread path evaluates model code: engine entry points refuse, exports/studio/reference use the Worker', async ({ page }) => {
    const out = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      const w = window as unknown as { __mainThreadRan?: boolean };
      // Direct calls into the engines from the page realm throw.
      const voxelMod = await import('/src/geometry/engines/voxel.ts');
      const mjsMod = await import('/src/geometry/engines/manifoldJs.ts');
      const engineMod = await import('/src/geometry/engine.ts');
      const refusals: string[] = [];
      for (const f of [
        () => voxelMod.voxelEngine.run('return api.voxels().set(0,0,0,"#fff");'),
        () => voxelMod.runVoxelGrid('return api.voxels().set(0,0,0,"#fff");'),
        () => mjsMod.manifoldJsEngine.run('return api.Manifold.cube(1);'),
      ]) {
        try { f(); refusals.push('RAN'); } catch (e) { refusals.push(String(e)); }
      }
      // Model code that marks the page if it ever runs where a document exists.
      const MARK = 'if (typeof document !== "undefined") globalThis.__mainThreadRan = true;';
      await pw.setActiveLanguage('voxel');
      const voxelRun = await pw.run(`${MARK} return api.voxels().fillBox([0,0,0],[2,2,2],'#3366ff');`);
      const vox = pw.exportVOX('lockdown.vox');
      const voxData = await pw.exportVOXData('lockdown.vox');
      const stl = pw.exportSTL ? await pw.exportSTL('lockdown.stl') : null;
      const studio = pw.activateVoxelPaint();
      pw.deactivateVoxelPaint();
      await pw.setActiveLanguage('manifold-js');
      const ghost = await pw.setReferenceGeometry(`${MARK} return api.Manifold.cube([2, 2, 30], true);`);
      return {
        refusals,
        hasExecuteCode: 'executeCode' in engineMod,
        voxelRunError: voxelRun.error ?? null,
        vox, voxDataBytes: voxData.sizeBytes ?? null, stl,
        studio,
        ghost,
        mainThreadRan: w.__mainThreadRan === true,
      };
    });
    for (const r of out.refusals) expect(r).toMatch(/engine Worker, never on the main thread/);
    expect(out.hasExecuteCode).toBe(false);
    expect(out.voxelRunError).toBeFalsy();
    expect(out.vox, JSON.stringify(out)).toMatchObject({ ok: true });
    expect(out.voxDataBytes).toBeGreaterThan(0);
    expect(out.studio.error).toBeFalsy();
    expect(out.studio.voxelCount).toBe(27);
    expect(out.ghost.success).toBe(true);
    expect(out.ghost.volume).toBeCloseTo(120, 0);
    expect(out.mainThreadRan).toBe(false);
  });

  test('a new session gets a fresh worker realm (no cross-session observation)', async ({ page }) => {
    const out = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      const run = (code: string) => pw.run(code);
      // Session A: leave state behind in the realm (a global + a message spy).
      await pw.createSession('isolation-A');
      await run(`
        globalThis.__planted = 'session-A';
        self.addEventListener('message', (e) => { (globalThis.__spied ||= []).push(String(e.data && e.data.code).slice(0, 40)); });
        return api.Manifold.cube(1);
      `);
      const sameSession = await run('throw new Error("PROBE:" + JSON.stringify({ planted: globalThis.__planted ?? null }));');
      // Session B: the next request must land in a brand-new Worker.
      await pw.createSession('isolation-B');
      const t0 = performance.now();
      const firstInB = await run('throw new Error("PROBE:" + JSON.stringify({ planted: globalThis.__planted ?? null, spied: globalThis.__spied ?? null }));');
      const firstRunMs = performance.now() - t0;
      const t1 = performance.now();
      await run('return api.Manifold.cube(1);');
      const warmRunMs = performance.now() - t1;
      return { sameSession: sameSession.error, firstInB: firstInB.error, firstRunMs, warmRunMs };
    });
    const parse = (s: string) => JSON.parse(/PROBE:(\{.*\})/.exec(s)![1]);
    // Within one session the realm persists (it is NOT a per-run sandbox)…
    expect(parse(out.sameSession).planted).toBe('session-A');
    // …but session B never sees session A's realm.
    expect(parse(out.firstInB)).toEqual({ planted: null, spied: null });
    // Report the isolation cost (fresh Worker + manifold-3d init) in the log.
    console.log(`[isolation] first run in new session: ${Math.round(out.firstRunMs)} ms (warm run ${Math.round(out.warmRunMs)} ms)`);
  });

  test('a run in flight across a session switch ends as cancelled, not as an error', async ({ page }) => {
    const out = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      const { getWorkerRuns } = await import('/src/diagnostics/workerStats.ts');
      const { errorLog } = await import('/src/diagnostics/errorLog.ts');
      await pw.createSession('switch-from');
      await pw.run('return api.Manifold.cube(1);');
      const since = Date.now();
      // A slow model still running when the session changes.
      const inFlight = pw.run('const t = Date.now(); while (Date.now() - t < 2500) {} return api.Manifold.cube(2);');
      await new Promise((r) => setTimeout(r, 600));
      await pw.createSession('switch-to');
      const result = await inFlight;
      // getWorkerRuns is newest-first; keep this window's geometry runs.
      const runs = getWorkerRuns().filter((r: { worker: string; timestamp: number }) => r.worker === 'geometry' && r.timestamp >= since);
      const statusText = document.body.innerText.includes('isolating sessions') ? 'shows-isolation-error' : 'ok';
      const engineErrors = errorLog.getEntries().filter((e: { source?: string; level: string }) => e.source === 'engine' && e.level !== 'info');
      return { result, runs: runs.map((r: { status: string; detail?: string }) => `${r.status}: ${r.detail ?? ''}`), statusText, engineErrors: engineErrors.length };
    });
    // The slow run is recorded as cancelled (superseded by the session switch),
    // and nothing in that window is recorded as an error.
    expect(out.runs.some((r: string) => /^cancelled: .*cancelled/i.test(r)), JSON.stringify(out.runs)).toBe(true);
    expect(out.runs.filter((r: string) => r.startsWith('error')), JSON.stringify(out.runs)).toEqual([]);
    expect(out.statusText).toBe('ok');
    expect(out.engineErrors).toBe(0);
  });

  test('api.paint.pattern size caps fail with a readable recorder error', async ({ page }) => {
    const out = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      const colors = await pw.run(`
        const s = api.Manifold.sphere(5, 24);
        api.paint.pattern({ pattern: 'spots', colors: Array.from({ length: 65 }, () => '#ff0000') });
        return s;`);
      const anchors = await pw.run(`
        const s = api.Manifold.sphere(5, 24);
        api.paint.pattern({ pattern: 'soccer', colors: ['#fff', '#000'], anchors: Array.from({ length: 1025 }, () => [0, 0, 5]) });
        return s;`);
      return { colors: colors.error ?? '', anchors: anchors.error ?? '' };
    });
    expect(out.colors).toMatch(/api\.paint\.pattern: at most 64 colors/);
    expect(out.anchors).toMatch(/api\.paint\.pattern: at most 1024 anchors/);
    expect(out.colors).not.toMatch(/malformed/);
  });

  test('voxel grid survives an object switch served from the mesh cache (A→B→A, then VOX export + Studio)', async ({ page }) => {
    const out = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      await pw.createSession('voxel-cache');
      await pw.setActiveLanguage('voxel');
      const a = await pw.runAndSave("return api.voxels().fillBox([0,0,0],[3,3,3],'#ff8800');", 'A');
      const objA = pw.getCurrentObject();
      await pw.createObject('B');
      await pw.setActiveLanguage('manifold-js');
      await pw.runAndSave('return api.Manifold.cube([5, 5, 5]);', 'B');
      await pw.changeObject(objA.id);
      const lang = pw.getActiveLanguage();
      const vox = pw.exportVOX('a.vox');
      const voxData = await pw.exportVOXData('a.vox');
      const studio = pw.activateVoxelPaint();
      pw.deactivateVoxelPaint();
      return { saved: !a.error, lang, vox, voxBytes: voxData.sizeBytes ?? null, studio };
    });
    expect(out.saved).toBe(true);
    expect(out.lang).toBe('voxel');
    expect(out.vox, JSON.stringify(out)).toMatchObject({ ok: true });
    expect(out.voxBytes).toBeGreaterThan(0);
    expect(out.studio.error).toBeFalsy();
    expect(out.studio.voxelCount).toBe(64);
  });
});
