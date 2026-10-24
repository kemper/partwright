// Golden paths for the core-operation parity methods (#1085): UI capabilities
// that had no window.partwright equivalent — camera, edges, curvature quality,
// simplify/enhance, object merge/reorder, app config, the diagnostic log.
// Each test drives the API the way an external agent would and asserts the
// visible/stored outcome.

import { test, expect, type Page } from 'playwright/test';

type PW = Record<string, (...args: unknown[]) => unknown>;

async function boot(page: Page, name: string): Promise<void> {
  await page.goto('/editor');
  await page.waitForSelector('text=Ready', { timeout: 30000 });
  await page.evaluate(async (n) => {
    const pw = (window as unknown as { partwright: PW }).partwright;
    await pw.createSession(n);
  }, name);
}

function pw<T>(page: Page, fn: (pw: PW) => T | Promise<T>): Promise<T> {
  return page.evaluate(`(${fn.toString()})(window.partwright)`) as Promise<T>;
}

test.describe('Core API parity', () => {
  test('setCamera / frameObjectPart / setEdgesVisible drive the live viewport', async ({ page }) => {
    await boot(page, 'camera-parity');
    await pw(page, async (p) => {
      await p.run(`const { Manifold } = api;
        return Manifold.union([
          api.label(Manifold.cube([10, 10, 10], true), 'body'),
          api.label(Manifold.sphere(3, 24).translate([30, 0, 0]), 'knob'),
        ]);`);
    });

    const cam = await pw(page, (p) => p.setCamera({ azimuth: 90, elevation: 20, distance: 80, target: [0, 0, 0] })) as { camera: { azimuth: number; elevation: number; distance: number } };
    expect(cam.camera.azimuth).toBeCloseTo(90, 0);
    expect(cam.camera.elevation).toBeCloseTo(20, 0);
    expect(cam.camera.distance).toBeCloseTo(80, 0);
    const view = await pw(page, (p) => p.getViewState()) as { camera: { azimuth: number } };
    expect(view.camera.azimuth).toBeCloseTo(90, 0);
    // Omitted fields keep their value.
    const cam2 = await pw(page, (p) => p.setCamera({ elevation: -30 })) as { camera: { azimuth: number; elevation: number } };
    expect(cam2.camera.azimuth).toBeCloseTo(90, 0);
    expect(cam2.camera.elevation).toBeCloseTo(-30, 0);
    expect(await pw(page, (p) => p.setCamera({ elevation: 200 }))).toHaveProperty('error');
    expect(await pw(page, (p) => p.setCamera({ zoom: 2 }))).toHaveProperty('error');

    const framed = await pw(page, (p) => p.frameObjectPart('knob')) as { ok: boolean; camera: { target: number[] } };
    expect(framed.ok).toBe(true);
    expect(framed.camera.target[0]).toBeCloseTo(30, 0);
    expect(await pw(page, (p) => p.frameObjectPart('nope'))).toHaveProperty('error');

    expect(await pw(page, (p) => p.setEdgesVisible(true))).toBe(true);
    expect(await pw(page, (p) => p.areEdgesVisible())).toBe(true);
    await expect(page.locator('#wireframe-toggle')).toHaveAttribute('title', 'Hide mesh edges');
    expect(await pw(page, (p) => p.setEdgesVisible())).toBe(false);
  });

  test('curvature quality and simplifyModel mirror the Quality panel', async ({ page }) => {
    await boot(page, 'quality-parity');
    const low = await pw(page, async (p) => {
      await p.run('const { Manifold } = api; return Manifold.sphere(10);');
      return p.setCurvatureQuality({ quality: 'low' });
    }) as { quality: string; segments: number; geometry: { triangleCount: number } };
    expect(low.quality).toBe('low');
    expect(low.segments).toBe(16);
    const high = await pw(page, (p) => p.setCurvatureQuality({ segments: 64 })) as { quality: string; geometry: { triangleCount: number } };
    expect(high.quality).toBe('high');
    expect(high.geometry.triangleCount).toBeGreaterThan(low.geometry.triangleCount);
    expect(await pw(page, (p) => p.getCurvatureQuality())).toMatchObject({ quality: 'high', segments: 64 });
    expect(await pw(page, (p) => p.setCurvatureQuality({ quality: 'low', segments: 48 }))).toHaveProperty('error');

    const before = await pw(page, async (p) => {
      await p.saveVersion('base');
      return (p.listVersions() as Promise<unknown[]>);
    }) as unknown[];
    const base = high.geometry.triangleCount;
    const r = await pw(page, (p) => p.simplifyModel({ targetTris: 600 })) as { ok: boolean; before: number; after: number; version: { index: number } };
    expect(r.ok).toBe(true);
    expect(r.before).toBe(base);
    expect(r.after).toBeLessThan(base);
    const after = await pw(page, (p) => p.listVersions()) as unknown[];
    expect(after.length).toBe(before.length + 1);
    expect(await pw(page, (p) => p.simplifyModel({ targetTris: 600, targetEdge: 1 }))).toHaveProperty('error');
    expect(await pw(page, (p) => p.simplifyModel({ targetTris: 10_000_000 }))).toHaveProperty('error');
  });

  test('mergeObjects and reorderObjects mirror the object rail', async ({ page }) => {
    await boot(page, 'objects-parity');
    const names = await pw(page, async (p) => {
      await p.runAndSave('const { Manifold } = api; return Manifold.cube([10, 10, 10]);', 'cube');
      await p.renameObject(0, 'A');
      await p.createObject('B');
      await p.runAndSave('const { Manifold } = api; return Manifold.sphere(5, 24).translate([20, 0, 0]);', 'ball');
      await p.reorderObjects(['B', 'A']);
      return (p.listObjects() as { name: string }[]).map(o => o.name);
    });
    expect(names).toEqual(['B', 'A']);
    expect(await pw(page, (p) => p.reorderObjects(['A', 'A']))).toHaveProperty('error');

    const merged = await pw(page, (p) => p.mergeObjects(['A', 'B'])) as { merged: { name: string }; mode: string; replaced: unknown[] };
    expect(merged.mode).toBe('new');
    expect(merged.replaced).toEqual([]);
    const afterNew = await pw(page, (p) => p.listObjects()) as { name: string; isCurrent: boolean }[];
    expect(afterNew).toHaveLength(3);
    expect(afterNew.find(o => o.isCurrent)?.name).toBe(merged.merged.name);
    const geo = await pw(page, (p) => p.getGeometryData()) as { componentCount: number };
    expect(geo.componentCount).toBe(2);

    const replaced = await pw(page, (p) => p.mergeObjects(['A', 'B'], { mode: 'replace' })) as { replaced: { name: string }[] };
    expect(replaced.replaced.map(o => o.name).sort()).toEqual(['A', 'B']);
    const deleted = await pw(page, (p) => p.listDeleted()) as { objects: { name: string }[] };
    expect(deleted.objects.map(o => o.name).sort()).toEqual(['A', 'B']);
    expect(await pw(page, (p) => p.mergeObjects(['A']))).toHaveProperty('error');
  });

  test('getAppConfig / setAppConfig validate like Advanced Settings; getDiagnosticLog redacts', async ({ page }) => {
    await boot(page, 'config-parity');
    const cfg = await pw(page, (p) => p.getAppConfig()) as Record<string, Record<string, { value: unknown; min?: number }>>;
    expect(cfg.import.voxelDefaultMaxSize.value).toBe(64);
    expect(cfg.import.voxelDefaultMaxSize.min).toBe(4);
    const set = await pw(page, (p) => p.setAppConfig('import', 'voxelDefaultMaxSize', 96)) as { value: number; previous: number };
    expect(set).toMatchObject({ value: 96, previous: 64 });
    expect((await pw(page, (p) => p.getAppConfig()) as typeof cfg).import.voxelDefaultMaxSize).toMatchObject({ value: 96, modified: true });
    expect(await pw(page, (p) => p.setAppConfig('import', 'voxelDefaultMaxSize', 1))).toHaveProperty('error');
    expect(await pw(page, (p) => p.setAppConfig('import', 'voxelDefaultMaxSize', '96'))).toHaveProperty('error');
    expect(await pw(page, (p) => p.setAppConfig('renderer', 'sdfCompileChunkNodes', 50))).toHaveProperty('error');
    await pw(page, (p) => p.setAppConfig('import', 'voxelDefaultMaxSize', 64));

    await page.evaluate(() => console.warn('parity-probe fetch https://api.example.test/v1?key=SUPERSECRET123&alt=sse failed'));
    const log = await pw(page, (p) => p.getDiagnosticLog({ source: 'app', level: 'warn', limit: 5 })) as { entries: { message: string }[] };
    const probe = log.entries.find(e => e.message.includes('parity-probe'));
    expect(probe).toBeTruthy();
    expect(probe!.message).not.toContain('SUPERSECRET123');
    expect(probe!.message).toContain('[REDACTED]');
    expect(await pw(page, (p) => p.getDiagnosticLog({ level: 'fatal' }))).toHaveProperty('error');
  });
});
