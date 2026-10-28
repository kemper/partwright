// "Built differently than saved": every save records a geometry fingerprint,
// each object's newest version keeps the mesh it displayed, and opening a
// version whose code now builds a different model raises a pill offering to
// restore the saved model or keep the new one. See src/geometry/modelFingerprint.ts,
// src/storage/versionMesh.ts and checkVersionDrift in src/main.ts.
//
// A real drift needs an app update between save and open, so these tests
// simulate one: they save a sphere, then graft its saved snapshot onto a cube
// version ("saved with v1.4.0, it built a sphere; this code now builds a cube").

import { test, expect, type Page } from 'playwright/test';

async function waitForEngine(page: Page) {
  await page.waitForSelector('text=Ready', { timeout: 20_000 });
  await page.waitForFunction(
    () => !!(window as unknown as { partwright?: { run?: unknown } }).partwright?.run,
    { timeout: 20_000 },
  );
}

const SPHERE = 'const { Manifold } = api;\nreturn Manifold.sphere(8, 48);\n';
const CUBE = 'const { Manifold } = api;\nreturn Manifold.cube([12, 12, 12], true);\n';

/** Saves a sphere (v1) and a cube (v2), then rewrites v2's stored snapshot
 *  (fingerprint, mesh, thumbnail, app version) to the sphere's. Returns what
 *  the stored records looked like along the way. */
async function seedDriftedVersion(page: Page) {
  return page.evaluate(async ({ SPHERE, CUBE }) => {
    type V = Record<string, unknown> & { id: string; index: number; partId: string };
    const pw = (window as unknown as { partwright: Record<string, (...a: unknown[]) => Promise<unknown>> }).partwright;
    const db = await import('/src/storage/db') as unknown as {
      listParts(sessionId: string): Promise<{ id: string }[]>;
      listVersions(partId: string): Promise<V[]>;
      putVersion(v: V): Promise<void>;
    };
    const session = await pw.createSession('model-drift') as { id: string };
    await pw.runAndSave(SPHERE, 'sphere');
    const [{ id: partId }] = await db.listParts(session.id);
    const [sphere] = await db.listVersions(partId);
    const sphereHadMesh = !!sphere.latestMesh;
    const sphereHadPrint = !!sphere.fingerprint;
    await pw.runAndSave(CUBE, 'cube');
    const afterCube = await db.listVersions(partId);
    const cube = afterCube[1];
    await db.putVersion({
      ...cube,
      fingerprint: sphere.fingerprint,
      latestMesh: sphere.latestMesh,
      thumbnail: sphere.thumbnail,
      appVersion: '1.4.0',
    });
    return {
      sphereHadMesh,
      sphereHadPrint,
      sphereMeshDroppedOnNextSave: afterCube[0].latestMesh === undefined,
      cubeHadMesh: !!cube.latestMesh,
      partId,
    };
  }, { SPHERE, CUBE });
}

test.describe('Built differently than saved (model drift)', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('partwright-tour-completed', '1'));
  });

  test('saves fingerprints and only the newest mesh; flags drift; restores the saved model', async ({ page }) => {
    await page.goto('/editor');
    await waitForEngine(page);
    const seeded = await seedDriftedVersion(page);
    expect(seeded.sphereHadPrint).toBe(true);
    expect(seeded.sphereHadMesh).toBe(true);
    expect(seeded.sphereMeshDroppedOnNextSave).toBe(true);
    expect(seeded.cubeHadMesh).toBe(true);

    // Opening the cube version re-runs its code, which now builds a cube where
    // a sphere was saved.
    const loaded = await page.evaluate(async () => {
      const pw = (window as unknown as { partwright: Record<string, (...a: unknown[]) => unknown> }).partwright;
      return await pw.loadVersion({ index: 2 }) as { builtDifferently?: Record<string, unknown> };
    });
    expect(loaded.builtDifferently?.changed).toBe(true);
    expect(loaded.builtDifferently?.savedWith).toBe('1.4.0');
    expect(loaded.builtDifferently?.canRestore).toBe(true);
    expect((loaded.builtDifferently?.differences as string[]).join(' ')).toMatch(/volume/);

    const pill = page.getByTestId('model-drift-pill');
    await expect(pill).toBeVisible();
    await page.screenshot({ path: 'test-results/model-drift-pill.png' });
    await pill.click();
    const dialog = page.getByRole('dialog', { name: 'Built differently than saved' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Partwright v1.4.0');
    await expect(dialog.getByRole('img', { name: 'The model as it was saved' })).toBeVisible();
    await page.screenshot({ path: 'test-results/model-drift-dialog.png' });

    await dialog.getByRole('button', { name: 'Restore the saved model' }).click();
    await expect(dialog).toBeHidden({ timeout: 20_000 });
    await expect(pill).toBeHidden();

    const after = await page.evaluate(async (partId) => {
      const pw = (window as unknown as { partwright: Record<string, (...a: unknown[]) => unknown> }).partwright;
      const db = await import('/src/storage/db') as unknown as { listVersions(p: string): Promise<Record<string, unknown>[]> };
      const versions = await db.listVersions(partId);
      const restored = versions[versions.length - 1];
      const geo = pw.getGeometryData() as { volume?: number };
      return {
        count: versions.length,
        label: restored.label,
        meshBacked: Array.isArray(restored.importedMeshes) && restored.importedMeshes.length === 1,
        keptSecondCopy: restored.latestMesh !== undefined,
        volume: geo.volume ?? 0,
        drift: pw.getModelDrift() as { changed: boolean },
      };
    }, seeded.partId);
    expect(after.count).toBe(3);
    expect(after.label).toBe('v2 as saved');
    expect(after.meshBacked).toBe(true);
    // The restored model IS a stored mesh: no second copy.
    expect(after.keptSecondCopy).toBe(false);
    // A sphere of radius 8 (≈ 2145), not the 12-unit cube (1728).
    expect(after.volume).toBeGreaterThan(2000);
    expect(after.volume).toBeLessThan(2200);
    expect(after.drift.changed).toBe(false);
  });

  test('keeping the new model saves it with a fresh fingerprint; no false alarms', async ({ page }) => {
    await page.goto('/editor');
    await waitForEngine(page);
    const seeded = await seedDriftedVersion(page);

    const kept = await page.evaluate(async () => {
      const pw = (window as unknown as { partwright: Record<string, (...a: unknown[]) => unknown> }).partwright;
      await pw.loadVersion({ index: 2 });
      return await pw.keepRebuiltModel() as { ok?: boolean; label?: string; index?: number };
    });
    expect(kept.ok).toBe(true);
    expect(kept.index).toBe(3);
    expect(kept.label).toMatch(/^v2 rebuilt/);

    const reopened = await page.evaluate(async (partId) => {
      const pw = (window as unknown as { partwright: Record<string, (...a: unknown[]) => unknown> }).partwright;
      const db = await import('/src/storage/db') as unknown as {
        listVersions(p: string): Promise<(Record<string, unknown> & { id: string })[]>;
        putVersion(v: Record<string, unknown>): Promise<void>;
      };
      const keptDrift = (await pw.loadVersion({ index: 3 }) as { builtDifferently?: unknown }).builtDifferently ?? null;
      // A version saved before fingerprints (and with stats that disagree)
      // isn't compared at all.
      const versions = await db.listVersions(partId);
      const legacy = { ...versions[2] };
      delete legacy.fingerprint;
      legacy.geometryData = { ...(legacy.geometryData as Record<string, unknown>), volume: 1000 };
      await db.putVersion(legacy);
      const legacyDrift = (await pw.loadVersion({ index: 3 }) as { builtDifferently?: unknown }).builtDifferently ?? null;
      // A sphere at the default quality, reopened at another one: quality
      // isn't saved with a version, so that is not a changed model.
      const saved = await pw.runAndSave('const { Manifold } = api;\nreturn Manifold.sphere(8);\n', 'default quality') as { version?: { index: number } };
      const trisSaved = (pw.getGeometryData() as { triangleCount: number }).triangleCount;
      await pw.setCurvatureQuality({ quality: 'low' });
      const otherQuality = (await pw.loadVersion({ index: 4 }) as { builtDifferently?: unknown }).builtDifferently ?? null;
      const trisLow = (pw.getGeometryData() as { triangleCount: number }).triangleCount;
      return { keptDrift, legacyDrift, otherQuality, trisSaved, trisLow, savedIndex: saved.version?.index ?? null };
    }, seeded.partId);
    expect(reopened.keptDrift).toBeNull();
    expect(reopened.legacyDrift).toBeNull();
    expect(reopened.savedIndex).toBe(4);
    // The quality change really did rebuild it differently…
    expect(reopened.trisLow).not.toBe(reopened.trisSaved);
    // …and that isn't reported as drift.
    expect(reopened.otherQuality).toBeNull();
  });

  test('code saved unformatted still records its snapshot', async ({ page }) => {
    await page.goto('/editor');
    await waitForEngine(page);
    const out = await page.evaluate(async () => {
      const pw = (window as unknown as { partwright: Record<string, (...a: unknown[]) => Promise<unknown>> }).partwright;
      const db = await import('/src/storage/db') as unknown as {
        listParts(s: string): Promise<{ id: string }[]>;
        listVersions(p: string): Promise<Record<string, unknown>[]>;
      };
      const session = await pw.createSession('model-drift-format') as { id: string };
      // The editor auto-formats this; the save stores the formatted text.
      await pw.runAndSave('const {Manifold}=api;return Manifold.cube([5,5,5]);', 'squashed');
      await pw.run('const {Manifold}=api;return Manifold.cube([6,6,6]);');
      await pw.saveVersion('after run');
      const [part] = await db.listParts(session.id);
      const versions = await db.listVersions(part.id);
      return versions.map(v => ({ print: !!v.fingerprint, mesh: !!v.latestMesh }));
    });
    expect(out).toEqual([{ print: true, mesh: false }, { print: true, mesh: true }]);
  });

  test('export can embed the newest meshes and import restores them', async ({ page }) => {
    await page.goto('/editor');
    await waitForEngine(page);
    await page.evaluate(async (SPHERE) => {
      const pw = (window as unknown as { partwright: Record<string, (...a: unknown[]) => Promise<unknown>> }).partwright;
      await pw.createSession('model-drift-export');
      await pw.runAndSave(SPHERE, 'sphere');
      await pw.runAndSave(SPHERE.replace('sphere(8', 'sphere(9'), 'bigger');
    }, SPHERE);

    const out = await page.evaluate(async () => {
      type Ex = { versions: { fingerprint?: unknown; latestMesh?: { numTri: number } }[] };
      const pw = (window as unknown as { partwright: Record<string, (...a: unknown[]) => Promise<unknown>> }).partwright;
      const plain = await pw.exportSession(undefined, {}) as Ex;
      const withMeshes = await pw.exportSession(undefined, { includeLatestMeshes: true }) as Ex;
      const bad = await pw.exportSession(undefined, { includeLatestMeshs: true }) as { error?: string };
      const imported = await pw.importSession(withMeshes) as { id: string };
      const db = await import('/src/storage/db') as unknown as {
        listParts(s: string): Promise<{ id: string }[]>;
        listVersions(p: string): Promise<Record<string, unknown>[]>;
      };
      const [part] = await db.listParts(imported.id);
      const versions = await db.listVersions(part.id);
      return {
        plainPrints: plain.versions.map(v => !!v.fingerprint),
        plainMeshes: plain.versions.map(v => !!v.latestMesh),
        withMeshes: withMeshes.versions.map(v => v.latestMesh?.numTri ?? 0),
        badError: bad.error ?? '',
        importedPrints: versions.map(v => !!v.fingerprint),
        importedMeshes: versions.map(v => !!v.latestMesh),
      };
    });
    expect(out.plainPrints).toEqual([true, true]);
    expect(out.plainMeshes).toEqual([false, false]);
    expect(out.withMeshes[0]).toBe(0);
    expect(out.withMeshes[1]).toBeGreaterThan(0);
    expect(out.badError).toMatch(/includeLatestMeshs/);
    expect(out.importedPrints).toEqual([true, true]);
    expect(out.importedMeshes).toEqual([false, true]);
  });
});
