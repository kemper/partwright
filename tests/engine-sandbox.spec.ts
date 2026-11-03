import { test, expect, type Page } from 'playwright/test';

// Engine sandbox (kemper/partwright#1090, "option 2"; docs/engine-sandbox.md).
//
// With the sandbox on ('origin' — the default wherever the build configures a
// sandbox host), model code runs in a geometry Worker that lives inside a
// hidden iframe served from VITE_SANDBOX_ORIGIN (the Playwright config runs a
// second dev server for it, and pins the e2e build default to 'off' so other
// specs run unsandboxed; these tests opt in per page). They prove:
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

const MODES = ['origin'] as const;
type Mode = (typeof MODES)[number];

async function bootInMode(page: Page, mode: Mode | 'off', ses: 'on' | 'off' = 'on'): Promise<void> {
  // The init script also runs in the sandbox frame, whose localStorage is
  // another origin's — only set it in the app.
  await page.addInitScript(({ m, ses }) => {
    if (window !== window.top) return;
    try {
      localStorage.setItem('partwright-engine-sandbox', m);
      if (ses === 'off') localStorage.setItem('partwright.sesSandbox', 'off');
    } catch { /* ignore */ }
  }, { m: mode, ses });
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
  unavailableReason: string | null;
  frameRestarts: number;
  pendingAfterReload: string;
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

/** Skip when this dev server can't host the sandbox — e.g. a reused
 *  `npm run dev` started without the Playwright config's env (no
 *  VITE_SANDBOX_ORIGIN). */
async function requireMode(page: Page, mode: Mode): Promise<void> {
  const s = await status(page);
  test.skip(!s.sandboxOrigin, 'dev server has no VITE_SANDBOX_ORIGIN configured');
  // Force the geometry Worker into existence and wait until it answers.
  const r = await run(page, 'const { Manifold } = api; return Manifold.cube([1, 1, 1]);');
  expect(r.error ?? null).toBeNull();
  const after = await status(page);
  expect(after.unavailableReason, 'sandbox unavailable').toBeNull();
  expect(after.active).toBe(mode);
  expect(after.state).toBe('ready');
  expect(after.frameCrossOriginIsolated).toBe(true);
  expect(after.workerCrossOriginIsolated).toBe(true);
  expect(after.frameOrigin).toBe(after.sandboxOrigin);
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
  // Some contexts refuse IndexedDB synchronously (SecurityError). Probe that
  // first: there indexedDB.databases() rejects in a way that escapes every
  // handler and recycles the Worker, wiping this probe.
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
      // This proves the ORIGIN layer, assuming model code already holds the
      // Worker realm — so it runs with the SES kill switch on: under SES (the
      // default) model code can't name `self`/`indexedDB`/`fetch` at all, nor
      // stash the probe on the Worker global between runs (engine-ses.spec).
      await bootInMode(page, mode, 'off');
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
      // Separate origin: IndexedDB works but is the sandbox origin's own,
      // empty, partitioned store — no app databases, no aiKeys store.
      expect(probe.stores ?? []).not.toContain('aiKeys');
      expect(probe.dbs ?? []).not.toContain('partwright');
      // Every cross-origin fetch fails from model code. (With the #1109
      // Worker lockdown `fetch` is already gone from the realm; the frame CSP
      // below is the independent second layer.)
      for (const name of Object.keys(targets)) {
        expect(probe.fetch[name], `${name} fetch`).toMatch(/^failed/);
      }

      // The frame CSP itself refuses those connections — checked in the
      // frame's own document (its blob: Worker inherits this exact policy),
      // where the lockdown doesn't apply.
      const frame = page.frames().find(f => /\/sandbox(\.html)?$/.test(new URL(f.url()).pathname));
      expect(frame, 'sandbox frame').toBeTruthy();
      const cspProbe = await frame!.evaluate(async (urls) => {
        const violations: { uri: string; directive: string }[] = [];
        document.addEventListener('securitypolicyviolation', (e) => {
          violations.push({ uri: e.blockedURI, directive: e.effectiveDirective });
        });
        const fetched: Record<string, string> = {};
        for (const [name, url] of Object.entries(urls)) {
          try { fetched[name] = 'status ' + (await fetch(url)).status; } catch (e) { fetched[name] = 'failed: ' + String(e); }
        }
        await new Promise(r => setTimeout(r, 100));
        return { violations, fetched };
      }, targets);
      test.info().annotations.push({ type: 'frame-csp', description: JSON.stringify(cspProbe) });
      for (const [name, url] of Object.entries(targets)) {
        expect(cspProbe.fetched[name], `${name} fetch from the frame`).toMatch(/^failed/);
        expect(
          cspProbe.violations.some(v => v.directive === 'connect-src' && url.startsWith(v.uri)),
          `${name} (${url}) should be a connect-src CSP violation; got ${JSON.stringify(cspProbe.violations)}`,
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
      // Voxel paint / export fetch the raw grid from the Worker
      // ('voxel_grid_result' must pass the sandbox's message allow-list).
      const grid = await page.evaluate(async () => {
        const eng = await import('/src/geometry/engine.ts' as string);
        const r = await eng.runVoxelGridInWorker("const v = api.voxels(); v.fillBox([0, 0, 0], [1, 1, 1], '#00ff00'); return v;");
        return r.ok ? { ok: true, count: r.grid.size } : { ok: false, error: r.error };
      });
      expect(grid).toEqual({ ok: true, count: 8 });

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
      expect(s.unavailableReason).toBeNull();
      expect(s.state).toBe('ready');
      expect(s.active).toBe(mode);
    });
  });
}

test.describe('engine sandbox: frame crash', () => {
  /** Simulate the frame dying (as when model code OOM-kills its renderer):
   *  drop the iframe. Its document and Worker go away without any message to
   *  the app; the host's liveness check has to notice. (CDP Page.crash would
   *  be closer, but headless Chromium here keeps the frame in the app's
   *  renderer process, so it crashes the whole page.) */
  async function crashFrame(page: Page): Promise<void> {
    await page.evaluate(() => document.querySelector('iframe[data-engine-sandbox]')?.remove());
  }

  test('a crashed frame is replaced and model code stays sandboxed', async ({ page }) => {
    test.setTimeout(120_000);
    await bootInMode(page, 'origin');
    await requireMode(page, 'origin');
    await crashFrame(page);
    await expect.poll(async () => (await status(page)).frameRestarts, { timeout: 30_000 }).toBe(1);
    expect(await page.locator('iframe[data-engine-sandbox]').count()).toBe(1);
    const r = await run(page, 'const { Manifold } = api; return Manifold.cube([3, 3, 3]);');
    expect(r.error ?? null).toBeNull();
    expect(r.triangleCount).toBe(12);
    const s = await status(page);
    expect(s.state).toBe('ready');
    expect(s.active).toBe('origin');
    expect(s.unavailableReason).toBeNull();
  });

  test('fails closed when the frame cannot be restarted, until an explicit bypass', async ({ page }) => {
    test.setTimeout(120_000);
    // No restart budget: the first crash makes the sandbox unavailable.
    await page.addInitScript(() => {
      if (window !== window.top) return;
      try {
        localStorage.setItem('partwright-app-config-v1', JSON.stringify({ renderer: { engineSandboxMaxFrameRestarts: 0 } }));
      } catch { /* ignore */ }
    });
    await bootInMode(page, 'origin');
    await requireMode(page, 'origin');
    await crashFrame(page);
    await expect.poll(async () => (await status(page)).state, { timeout: 30_000 }).toBe('unavailable');

    // Fail closed: model code does not run anywhere, and no frame is left.
    const blocked = await run(page, 'const { Manifold } = api; return Manifold.cube([3, 3, 3]);');
    expect(blocked.error ?? '').toContain('engine sandbox unavailable');
    expect(await page.locator('iframe[data-engine-sandbox]').count()).toBe(0);
    // The first-visit onboarding tour's backdrop would cover the pill.
    await page.evaluate(() => document.querySelectorAll('.tour-backdrop, [class*="tour"]').forEach(e => e.remove()));
    const pill = page.locator('#engine-sandbox-pill');
    await expect(pill).toBeVisible();
    await expect(pill).toContainText('Engine sandbox unavailable');

    // The only way out is the explicit per-tab bypass.
    await pill.getByRole('button', { name: 'Run without sandbox (this tab)' }).click();
    await expect.poll(async () => (await status(page)).state).toBe('bypassed');
    const ran = await run(page, 'const { Manifold } = api; return Manifold.cube([3, 3, 3]);');
    expect(ran.error ?? null).toBeNull();
    expect((await status(page)).active).toBe('off');
    await expect(pill).toContainText('Running without the engine sandbox');
  });
});

test('engine sandbox: mode is captured once per tab', async ({ page }) => {
  await bootInMode(page, 'off');
  // Another tab (shared localStorage) or the Settings select changes the mode:
  // this tab keeps running as it started, and reports the pending value.
  await page.evaluate(() => localStorage.setItem('partwright-engine-sandbox', 'origin'));
  const s = await status(page);
  expect(s.requested).toBe('off');
  expect(s.active).toBe('off');
  expect(s.pendingAfterReload).toBe('origin');
  const r = await run(page, 'const { Manifold } = api; return Manifold.cube([2, 2, 2]);');
  expect(r.error ?? null).toBeNull();
  expect(await page.locator('iframe[data-engine-sandbox]').count()).toBe(0);
});

test('engine sandbox: the build default applies when nothing is saved (pinned to off for e2e)', async ({ page }) => {
  test.skip(process.env.VITE_ENGINE_SANDBOX === 'origin', 'this run pins the default to origin');
  await page.goto('/editor');
  await page.waitForFunction(() => !!(window as unknown as { partwright?: PW }).partwright?.run, undefined, { timeout: 60_000 });
  const s = await status(page) as SandboxStatus & { defaultMode: string; modes: string[] };
  expect(s.defaultMode).toBe('off');
  expect(s.requested).toBe('off');
  expect(s.active).toBe('off');
  expect(s.modes).toEqual(['off', 'origin']);
  expect(await page.locator('iframe[data-engine-sandbox]').count()).toBe(0);
});

test("engine sandbox: the removed 'opaque' mode is refused, and a saved one is migrated away", async ({ page }) => {
  await page.addInitScript(() => {
    if (window !== window.top) return;
    // Only before the first load: the app must clean it up itself.
    try { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('partwright-engine-sandbox', 'opaque'); sessionStorage.setItem('seeded', '1'); } } catch { /* ignore */ }
  });
  await page.goto('/editor');
  await page.waitForFunction(() => !!(window as unknown as { partwright?: PW }).partwright?.run, undefined, { timeout: 60_000 });
  const out = await page.evaluate(() => {
    const pw = (window as unknown as { partwright: PW }).partwright;
    const s = pw.getEngineSandboxStatus() as { requested: string; defaultMode: string };
    return { requested: s.requested, defaultMode: s.defaultMode, stored: localStorage.getItem('partwright-engine-sandbox'), set: pw.setEngineSandboxMode('opaque') as { error?: string } };
  });
  expect(out.requested).toBe(out.defaultMode);
  expect(out.stored).toBeNull();
  expect(out.set.error).toMatch(/'opaque' mode was removed/);
});

test('engine sandbox: the sandbox host redirects the app to the app origin', async ({ page, baseURL }) => {
  // Same derivation as playwright.config.ts (the second dev server's port).
  const appOrigin = new URL(baseURL!).origin;
  const appPort = Number(new URL(appOrigin).port);
  const sandboxOrigin = `http://localhost:${Number(process.env.E2E_SANDBOX_PORT || appPort + 1000)}`;

  const reachable = await page.request.get(`${sandboxOrigin}/sandbox`).then(r => r.ok(), () => false);
  test.skip(!reachable, 'no sandbox dev server (run with the Playwright config env)');

  // Opening the app on the sandbox host must never boot it there (its storage
  // is the origin 'origin'-mode Workers run in): entry.ts sends it home first.
  await page.goto(`${sandboxOrigin}/editor?gallery#x`);
  await page.waitForURL(`${appOrigin}/editor?gallery#x`, { timeout: 30_000 });
});
