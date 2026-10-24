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
    // A saved provider key is redacted whatever its shape (a custom endpoint's key).
    const savedKey = ['parity', 'custom', 'endpoint', 'key', '7x'].join('-');
    await page.evaluate(async (k) => {
      const db = await import('/src/ai/db.ts');
      await db.putKey({ provider: 'custom', apiKey: k, createdAt: 0, lastUsed: 0, totalInputTokens: 0, totalOutputTokens: 0, totalCostUsd: 0 });
      console.warn(`parity-saved-key endpoint said: bad token ${k}`);
    }, savedKey);
    const keyLog = await pw(page, (p) => p.getDiagnosticLog({ source: 'app', limit: 10 })) as { entries: { message: string }[] };
    const keyProbe = keyLog.entries.find(e => e.message.includes('parity-saved-key'));
    expect(keyProbe).toBeTruthy();
    expect(keyProbe!.message).not.toContain(savedKey);
    const log = await pw(page, (p) => p.getDiagnosticLog({ source: 'app', level: 'warn', limit: 5 })) as { entries: { message: string }[] };
    const probe = log.entries.find(e => e.message.includes('parity-probe'));
    expect(probe).toBeTruthy();
    expect(probe!.message).not.toContain('SUPERSECRET123');
    expect(probe!.message).toContain('[REDACTED]');
    expect(await pw(page, (p) => p.getDiagnosticLog({ level: 'fatal' }))).toHaveProperty('error');
  });

  test('importMeshData / importVoxData / importStepData honour the import target', async ({ page }) => {
    await boot(page, 'import-parity');
    const stl = await pw(page, async (p) => {
      await p.runAndSave('const { Manifold } = api; return Manifold.cube([10, 10, 10]);', 'cube');
      return ((await p.exportSTLData()) as { base64: string }).base64;
    }) as string;

    const asObject = await page.evaluate(async (b64) => {
      const p = (window as unknown as { partwright: PW }).partwright;
      return p.importMeshData(b64, 'cube.stl', { target: 'new-object' });
    }, stl) as { target: string; object: { name: string }; isManifold: boolean };
    expect(asObject.target).toBe('new-object');
    expect(asObject.object.name).toBe('cube');
    expect(asObject.isManifold).toBe(true);
    expect(await pw(page, (p) => (p.listObjects() as unknown[]).length)).toBe(2);

    const sessionBefore = await pw(page, (p) => (p.getSessionState() as { session: { id: string } }).session.id);
    const composed = await page.evaluate(async (b64) => {
      const p = (window as unknown as { partwright: PW }).partwright;
      return p.importMeshData(b64, 'cube2.stl', { target: 'current-object' });
    }, stl) as { target: string; sessionId: string };
    expect(composed.target).toBe('current-object');
    expect(composed.sessionId).toBe(sessionBefore);
    expect(await pw(page, (p) => (p.getGeometryData() as { componentCount: number }).componentCount)).toBeGreaterThanOrEqual(1);
    expect(await pw(page, (p) => (p.listObjects() as unknown[]).length)).toBe(2);

    expect(await page.evaluate(async (b64) => {
      const p = (window as unknown as { partwright: PW }).partwright;
      return p.importMeshData(b64, 'cube.stl', { target: 'elsewhere' });
    }, stl)).toHaveProperty('error');
    expect(await pw(page, (p) => p.importMeshData('@@not-base64@@', 'x.stl'))).toHaveProperty('error');

    // VOX round trip: a voxel object exported and re-imported as a new object.
    const vox = await pw(page, async (p) => {
      await p.createObject('voxels');
      await p.setActiveLanguage('voxel');
      await p.runAndSave("const v = api.voxels(); v.fillBox([0, 0, 0], [2, 2, 2], '#ff0000'); return v;", 'vox');
      return ((await p.exportVOXData()) as { base64: string }).base64;
    }) as string;
    const voxImport = await page.evaluate(async (b64) => {
      const p = (window as unknown as { partwright: PW }).partwright;
      return p.importVoxData(b64, 'cubes.vox', { target: 'new-object' });
    }, vox) as { voxelCount: number; target: string };
    expect(voxImport.target).toBe('new-object');
    expect(voxImport.voxelCount).toBe(27);
    expect(await pw(page, (p) => p.getActiveLanguage())).toBe('voxel');

    // BREP can't be composed into an existing object — refused before parsing.
    expect(await pw(page, (p) => p.importStepData('AAAA', 'part.step', { target: 'current-object' }))).toHaveProperty('error');
    expect(await pw(page, (p) => p.importStepData('AAAA', 'part.step', { mode: 'wire' }))).toHaveProperty('error');
  });

  test('importStepData imports a STEP file as BREP or as a mesh', async ({ page }) => {
    await boot(page, 'step-parity');
    await pw(page, async (p) => {
      await p.setActiveLanguage('replicad');
      await p.runAndSave('const { BREP } = api; return BREP.box([10, 10, 10]);', 'box');
    });
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      pw(page, (p) => p.exportSTEP('box.step')),
    ]);
    const bytes = await (await download.createReadStream()).toArray();
    const b64 = Buffer.concat(bytes as Buffer[]).toString('base64');

    const brep = await page.evaluate(async (data) => {
      const p = (window as unknown as { partwright: PW }).partwright;
      const r = await p.importStepData(data, 'box.step', { target: 'new-object' });
      return { r, lang: p.getActiveLanguage(), tris: (p.getGeometryData() as { triangleCount: number }).triangleCount };
    }, b64) as { r: { target: string; mode: string; object: { name: string } }; lang: string; tris: number };
    expect(brep.r).toMatchObject({ target: 'new-object', mode: 'brep' });
    expect(brep.r.object.name).toBe('box');
    expect(brep.lang).toBe('replicad');
    expect(brep.tris).toBeGreaterThan(0);

    const mesh = await page.evaluate(async (data) => {
      const p = (window as unknown as { partwright: PW }).partwright;
      const r = await p.importStepData(data, 'box.step', { mode: 'mesh', target: 'new-object' });
      return { r, lang: p.getActiveLanguage(), objects: (p.listObjects() as unknown[]).length };
    }, b64) as { r: { mode: string }; lang: string; objects: number };
    expect(mesh.r.mode).toBe('mesh');
    expect(mesh.lang).toBe('manifold-js');
    expect(mesh.objects).toBe(3);
  });

  test('importFromUrl fetches remote files and decodes share links', async ({ page }) => {
    await boot(page, 'url-parity');
    const stl = await pw(page, async (p) => {
      await p.runAndSave('const { Manifold } = api; return Manifold.cube([6, 6, 6]);', 'cube');
      return ((await p.exportSTLData()) as { base64: string }).base64;
    }) as string;
    const cors = { 'access-control-allow-origin': '*', 'cross-origin-resource-policy': 'cross-origin' };
    await page.route('https://parity.example.test/**', async (route) => {
      const u = route.request().url();
      if (u.endsWith('.stl')) await route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'model/stl' }, body: Buffer.from(stl, 'base64') });
      else await route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'image/png' }, body: Buffer.from([0x89, 0x50, 0x4e, 0x47]) });
    });

    const r = await pw(page, (p) => p.importFromUrl('https://parity.example.test/models/widget.stl', { target: 'new-object' })) as { kind: string; source: string; target: string; object: { name: string } };
    expect(r).toMatchObject({ kind: 'remote', source: 'STL', target: 'new-object' });
    expect(r.object.name).toBe('widget');
    expect(await pw(page, (p) => (p.listObjects() as unknown[]).length)).toBe(2);

    const img = await pw(page, (p) => p.importFromUrl('https://parity.example.test/photo.png')) as { error: string };
    expect(img.error).toMatch(/importImageAsRelief/);
    expect(await pw(page, (p) => p.importFromUrl('file:///etc/passwd'))).toHaveProperty('error');
    // The AI path (geometryOnly) refuses code-bearing sources before fetching.
    const code = await pw(page, (p) => p.importFromUrl('https://parity.example.test/model.scad', { geometryOnly: true })) as { error: string };
    expect(code.error).toMatch(/Import → From URL/);
    const shareRefused = await pw(page, async (p) => {
      const { url } = await p.getShareLink() as { url: string };
      return p.importFromUrl(url, { geometryOnly: true });
    }) as { error: string };
    expect(shareRefused.error).toMatch(/share link/);

    const shared = await pw(page, async (p) => {
      const before = (p.getSessionState() as { session: { id: string } }).session.id;
      const { url } = await p.getShareLink() as { url: string };
      const res = await p.importFromUrl(url) as { kind: string; sessionId: string };
      return { before, res };
    }) as { before: string; res: { kind: string; sessionId: string } };
    expect(shared.res.kind).toBe('share');
    expect(shared.res.sessionId).not.toBe(shared.before);
  });

  test('undoClearColors, annotation strokes/redo/mode and formatCode', async ({ page }) => {
    await boot(page, 'misc-parity');
    const paint = await pw(page, async (p) => {
      await p.run('const { Manifold } = api; return Manifold.cube([10, 10, 10]);');
      await p.paintInBox({ box: { min: [-1, -1, 9], max: [11, 11, 11] }, color: [1, 0, 0] });
      const before = (p.listRegions() as unknown[]).length;
      await p.clearColors();
      const cleared = (p.listRegions() as unknown[]).length;
      const undo = await p.undoClearColors();
      const again = await p.undoClearColors();
      return { before, cleared, undo, again, after: (p.listRegions() as unknown[]).length };
    }) as { before: number; cleared: number; undo: { restored: boolean }; again: { error?: string }; after: number };
    expect(paint.before).toBe(1);
    expect(paint.cleared).toBe(0);
    expect(paint.undo.restored).toBe(true);
    expect(paint.after).toBe(1);
    expect(paint.again.error).toBeTruthy();
    expect(await pw(page, (p) => p.clearColors({ kind: 'image' }))).toMatchObject({ cleared: true, kind: 'image' });
    expect(await pw(page, (p) => (p.listRegions() as unknown[]).length)).toBe(1);
    expect(await pw(page, (p) => p.clearColors({ kind: 'stamps' }))).toHaveProperty('error');
    // A user clear followed by switching to another object must not let
    // undoClearColors resurrect the first object's paint there.
    const crossObject = await pw(page, async (p) => {
      await p.saveVersion('painted');
      await p.clearColors();
      await p.createObject('Other');
      return p.undoClearColors();
    }) as { error?: string };
    expect(crossObject.error).toBeTruthy();
    await pw(page, (p) => p.changeObject(0));

    const stroke = await pw(page, (p) => p.addStrokeAnnotation({ points: [[0, -6, 2], [5, -6, 6], [10, -6, 2]], color: [0, 0, 1], width: 6 })) as { id: string; pointCount: number };
    expect(stroke.pointCount).toBe(3);
    const strokes = await pw(page, (p) => p.listAnnotations()) as { id: string; width: number }[];
    expect(strokes).toHaveLength(1);
    expect(strokes[0]).toMatchObject({ id: stroke.id, width: 6 });
    expect(await pw(page, (p) => p.addStrokeAnnotation({ points: [[0, 0, 0]] }))).toHaveProperty('error');
    await pw(page, (p) => p.undoAnnotation());
    expect(await pw(page, (p) => p.redoAnnotation())).toMatchObject({ redone: true, remaining: 1 });
    expect(await pw(page, (p) => p.redoAnnotation())).toMatchObject({ redone: false });

    expect(await pw(page, (p) => p.setAnnotateMode('text'))).toEqual({ mode: 'text' });
    await expect(page.locator('#annotate-picker-panel')).toBeVisible();
    expect(await pw(page, (p) => p.getAnnotateMode())).toBe('text');
    expect(await pw(page, (p) => p.setAnnotateMode(null))).toEqual({ mode: null });
    await expect(page.locator('#annotate-picker-panel')).toBeHidden();
    expect(await pw(page, (p) => p.setAnnotateMode('eraser'))).toHaveProperty('error');

    const fmt = await pw(page, (p) => {
      p.setCode('const { Manifold } = api;\nreturn Manifold.cube([1,1,1]);');
      return p.formatCode();
    }) as { changed: boolean; code: string };
    expect(typeof fmt.changed).toBe('boolean');
    expect(fmt.code).toContain('Manifold.cube([1, 1, 1])');
  });
});
