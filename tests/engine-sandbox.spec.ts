import { test, expect, type Page } from 'playwright/test';

// Engine sandbox (kemper/partwright#1090, "option 2"; docs/engine-sandbox.md).
//
// With the sandbox on, model code runs in a geometry Worker that lives inside a
// hidden cross-origin iframe ('opaque' = sandboxed iframe with an opaque
// origin; 'origin' = iframe served from VITE_SANDBOX_ORIGIN — the Playwright
// config runs a second dev server for it). These tests prove, per mode:
//   1. model code can't reach the app's IndexedDB (a value saved through the
//      app's own aiKeys store stays unreadable), has no localStorage, and its
//      network is fenced by the frame CSP (cross-origin fetches are refused
//      with a CSP violation, not just a network error);
//   2. ordinary modelling still works: manifold-js, voxel, SCAD, BREP (both
//      api.BREP inside manifold-js and a replicad session) and the Assembly
//      view's parallel worker pool.
//
// The probe value below is deliberately not key-shaped.
const PROBE_VALUE = 'sandbox-probe-value-1090';

type PW = Record<string, (...args: unknown[]) => unknown>;

const MODES = ['opaque', 'origin'] as const;
type Mode = (typeof MODES)[number];

async function bootInMode(page: Page, mode: Mode | 'off'): Promise<void> {
  // The init script also runs in the sandbox frame, where localStorage is
  // unavailable (opaque) or another origin's — only set it in the app.
  await page.addInitScript((m) => {
    if (window !== window.top) return;
    try { localStorage.setItem('partwright-engine-sandbox', m); } catch { /* ignore */ }
  }, mode);
  await page.goto('/editor');
  await page.waitForFunction(
    () => !!(window as unknown as { partwright?: PW }).partwright?.run,
    undefined,
    { timeout: 60_000 },
  );
}

interface SandboxStatus {
  requested: string;
  active: string;
  state: string;
  frameCrossOriginIsolated: boolean | null;
  workerCrossOriginIsolated: boolean | null;
  frameOrigin: string | null;
  fallbackReason: string | null;
  sandboxOrigin: string | null;
}

async function status(page: Page): Promise<SandboxStatus> {
  return page.evaluate(() => (window as unknown as { partwright: PW }).partwright.getEngineSandboxStatus()) as Promise<SandboxStatus>;
}

async function run(page: Page, code: string, lang?: string): Promise<{ error?: string | null; triangleCount?: number }> {
  return page.evaluate(async ({ code, lang }) => {
    const pw = (window as unknown as { partwright: PW }).partwright;
    if (lang) await pw.setActiveLanguage(lang);
    return (await pw.run(code)) as { error?: string | null; triangleCount?: number };
  }, { code, lang });
}

/** Skip 'origin' mode when this server has no VITE_SANDBOX_ORIGIN (e.g. a
 *  reused `npm run dev` started without the Playwright config's env). */
async function requireMode(page: Page, mode: Mode): Promise<void> {
  const s = await status(page);
  test.skip(mode === 'origin' && !s.sandboxOrigin, 'dev server has no VITE_SANDBOX_ORIGIN configured');
  // Force the geometry Worker into existence and wait until it answers.
  const r = await run(page, 'const { Manifold } = api; return Manifold.cube([1, 1, 1]);');
  expect(r.error ?? null).toBeNull();
  const after = await status(page);
  expect(after.fallbackReason, 'sandbox fell back to off').toBeNull();
  expect(after.active).toBe(mode);
  expect(after.state).toBe('ready');
  expect(after.frameCrossOriginIsolated).toBe(true);
  expect(after.workerCrossOriginIsolated).toBe(true);
  if (mode === 'opaque') expect(after.frameOrigin).toBe('null');
  else expect(after.frameOrigin).toBe(after.sandboxOrigin);
}

// Model code that starts async probes on its first run (stashing results on the
// Worker's global) and reports them by throwing on later runs — model code is
// synchronous and can only hand back a Manifold or an error string.
function probeCode(targets: Record<string, string>): string {
  return `
const g = globalThis;
if (!g.__sandboxProbe) {
  const out = g.__sandboxProbe = { done: false, violations: [] };
  try {
    self.addEventListener('securitypolicyviolation', (e) => {
      out.violations.push({ uri: e.blockedURI, directive: e.effectiveDirective || e.violatedDirective });
    });
  } catch (e) { out.violationListenerError = String(e); }
  out.localStorage = typeof localStorage;
  out.hasIndexedDB = typeof indexedDB !== 'undefined';
  // An opaque origin refuses IndexedDB synchronously (SecurityError). Probe
  // that first: in that context indexedDB.databases() rejects in a way that
  // escapes every handler and recycles the Worker, wiping this probe.
  let req = null;
  try { req = indexedDB.open('partwright'); } catch (e) { out.idbError = String((e && e.name) || e); }
  (async () => {
    if (req) try {
      const db = await new Promise((res, rej) => {
        req.onupgradeneeded = () => { out.createdFresh = true; };
        req.onsuccess = () => res(req.result);
        req.onerror = () => rej(req.error);
      });
      out.stores = Array.from(db.objectStoreNames);
      if (out.stores.includes('aiKeys')) {
        out.keys = await new Promise((res, rej) => {
          const q = db.transaction('aiKeys').objectStore('aiKeys').getAll();
          q.onsuccess = () => res(q.result.map((k) => k.apiKey));
          q.onerror = () => rej(q.error);
        });
      }
      db.close();
      try { out.dbs = (await indexedDB.databases()).map((d) => d.name); }
      catch (e) { out.dbsError = String((e && e.name) || e); }
      if (out.createdFresh) {
        // Our own open() just created it in the sandbox origin's store.
        out.dbs = (out.dbs || []).filter((n) => n !== 'partwright');
        try { indexedDB.deleteDatabase('partwright'); } catch (e) { /* ignore */ }
      }
    } catch (e) { out.idbError = String((e && e.name) || e); }
    out.fetch = {};
    for (const [name, url] of Object.entries(${JSON.stringify(targets)})) {
      try {
        const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
        out.fetch[name] = 'status ' + r.status;
      } catch (e) { out.fetch[name] = 'failed: ' + String((e && e.name) || e); }
    }
    out.done = true;
  })();
  return api.Manifold.cube([1, 1, 1]);
}
throw new Error('PROBE' + JSON.stringify(g.__sandboxProbe));
`;
}

interface ProbeResult {
  done: boolean;
  violations: { uri: string; directive: string }[];
  localStorage: string;
  hasIndexedDB: boolean;
  dbs?: string[];
  stores?: string[];
  keys?: string[];
  idbError?: string;
  fetch: Record<string, string>;
}

async function runProbe(page: Page, targets: Record<string, string>): Promise<ProbeResult> {
  const code = probeCode(targets);
  const first = await run(page, code, 'manifold-js');
  expect(first.error ?? null).toBeNull();
  let result: ProbeResult | null = null;
  let last = '';
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const r = await run(page, code);
    last = r.error ?? '';
    const m = /PROBE(\{.*\})/s.exec(last);
    result = m ? (JSON.parse(m[1]) as ProbeResult) : null;
    if (result?.done) break;
    await page.waitForTimeout(500);
  }
  expect(result?.done, `probe never finished; last result: ${last.slice(0, 2000)}`).toBe(true);
  return result!;
}

async function saveAppKey(page: Page): Promise<void> {
  await page.evaluate(async (value) => {
    // Through the app's own aiKeys store module, exactly as the AI settings do.
    const db = await import('/src/ai/db.ts' as string);
    await db.putKey({
      provider: 'custom', apiKey: value, createdAt: Date.now(), lastUsed: Date.now(),
      totalInputTokens: 0, totalOutputTokens: 0, totalCostUsd: 0,
    });
  }, PROBE_VALUE);
}

for (const mode of MODES) {
  test.describe(`engine sandbox: ${mode}`, () => {
    test('model code cannot reach app storage, keys or the network', async ({ page }) => {
      test.setTimeout(120_000);
      await bootInMode(page, mode);
      await requireMode(page, mode);
      await saveAppKey(page);

      const appOrigin = new URL(page.url()).origin;
      const appPort = new URL(page.url()).port;
      const targets: Record<string, string> = {
        external: 'https://example.com/',
        // A different origin on the same machine (not 'self' for the frame in
        // either mode): 127.0.0.1 vs localhost.
        loopback: `http://127.0.0.1:${appPort}/favicon.svg`,
      };
      // In 'origin' mode the APP origin is cross-origin for the frame too.
      if (mode === 'origin') targets.appOrigin = `${appOrigin}/favicon.svg`;

      const probe = await runProbe(page, targets);
      test.info().annotations.push({ type: 'probe', description: JSON.stringify(probe) });

      // The value saved through the app's aiKeys store never shows up.
      expect(JSON.stringify(probe)).not.toContain(PROBE_VALUE);
      expect(probe.keys ?? []).not.toContain(PROBE_VALUE);
      // Workers have no localStorage at all.
      expect(probe.localStorage).toBe('undefined');
      if (mode === 'opaque') {
        // Opaque origin: IndexedDB is refused outright.
        expect(!probe.hasIndexedDB || !!probe.idbError, 'IndexedDB should be refused').toBe(true);
        expect(probe.stores).toBeUndefined();
      } else {
        // Separate origin: IndexedDB works but is the sandbox origin's own,
        // empty, partitioned store — no app databases, no aiKeys store.
        expect(probe.stores ?? []).not.toContain('aiKeys');
        expect(probe.dbs ?? []).not.toContain('partwright');
      }
      // Every cross-origin fetch fails, and the frame CSP is the reason.
      for (const [name, url] of Object.entries(targets)) {
        expect(probe.fetch[name], `${name} fetch`).toMatch(/^failed/);
        expect(
          probe.violations.some(v => v.directive === 'connect-src' && url.startsWith(v.uri)),
          `${name} (${url}) should be a connect-src CSP violation; got ${JSON.stringify(probe.violations)}`,
        ).toBe(true);
      }
    });

    test('modelling still works: manifold-js, voxel, SCAD, BREP, Assembly pool', async ({ page }) => {
      test.setTimeout(240_000);
      await bootInMode(page, mode);
      await requireMode(page, mode);

      const cube = await run(page, 'const { Manifold } = api; return Manifold.cube([10, 10, 10], true).subtract(Manifold.sphere(6.5, 48));', 'manifold-js');
      expect(cube.error ?? null).toBeNull();
      expect(cube.triangleCount).toBeGreaterThan(100);

      const vox = await run(page, "const v = api.voxels(); v.fillBox([0, 0, 0], [3, 3, 3], '#ff0000'); return v;", 'voxel');
      expect(vox.error ?? null).toBeNull();
      expect(vox.triangleCount).toBeGreaterThan(0);

      const scad = await run(page, 'difference() { cube(10, center=true); sphere(6.5, $fn=32); }', 'scad');
      expect(scad.error ?? null).toBeNull();
      expect(scad.triangleCount).toBeGreaterThan(50);

      // Phase C: api.BREP inside manifold-js (lazy OCCT load inside the sandbox).
      const brepC = await run(page, 'const { Manifold, BREP } = api; return BREP.toManifold(BREP.box([20, 20, 10]).fillet(2), Manifold);', 'manifold-js');
      expect(brepC.error ?? null).toBeNull();
      expect(brepC.triangleCount).toBeGreaterThan(100);

      // Phase A: replicad session.
      const brepA = await run(page, 'const { BREP } = api; return BREP.box([15, 15, 15]).fillet(1);', 'replicad');
      expect(brepA.error ?? null).toBeNull();
      expect(brepA.triangleCount).toBeGreaterThan(100);

      // Reference (ghost) geometry normally evaluates on the main thread; with
      // the sandbox on it must go through the sandboxed Worker instead.
      const ghost = await page.evaluate(async () => {
        const pw = (window as unknown as { partwright: PW }).partwright;
        await pw.setActiveLanguage('manifold-js');
        return await pw.setReferenceGeometry(
          "if (typeof window !== 'undefined') throw new Error('ran on the main thread');\n" +
          'const { Manifold } = api; return Manifold.cube([4, 4, 4]);',
        ) as { success: boolean; volume?: number; error?: string };
      });
      expect(ghost.error ?? null).toBeNull();
      expect(ghost.success).toBe(true);
      expect(ghost.volume).toBeCloseTo(64, 3);

      // Assembly view: every object meshes in the (sandboxed) engine pool.
      await page.evaluate(async () => {
        const pw = (window as unknown as { partwright: PW }).partwright;
        await pw.createSession('Sandbox assembly');
        await pw.setActiveLanguage('manifold-js');
        await pw.runAndSave('const { Manifold } = api; return Manifold.cube([20, 20, 20], true);', 'Box');
        await pw.createPart('Sphere');
        await pw.runAndSave('const { Manifold } = api; return Manifold.sphere(15, 32);', 'Sphere');
        await pw.createPart('Cylinder');
        await pw.runAndSave('const { Manifold } = api; return Manifold.cylinder(30, 8, 8, 48);', 'Cylinder');
        void pw.openAssembly();
      });
      await expect.poll(
        async () => {
          const snap = await page.evaluate(() => (window as unknown as { partwright: PW }).partwright.getAssembly()) as { parts: { placed: boolean }[] };
          return snap.parts.length === 3 && snap.parts.every(p => p.placed);
        },
        { timeout: 90_000 },
      ).toBe(true);

      // Still sandboxed after all of that (no silent fallback mid-way).
      const s = await status(page);
      expect(s.fallbackReason).toBeNull();
      expect(s.active).toBe(mode);
    });
  });
}

test('engine sandbox: off by default', async ({ page }) => {
  await page.goto('/editor');
  await page.waitForFunction(() => !!(window as unknown as { partwright?: PW }).partwright?.run, undefined, { timeout: 60_000 });
  const s = await status(page);
  expect(s.requested).toBe('off');
  expect(s.active).toBe('off');
  expect(await page.locator('iframe[data-engine-sandbox]').count()).toBe(0);
});
