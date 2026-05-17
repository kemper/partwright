// AI-tool wiring for the sculpt deformer prototype.
//
// The applyDeformer / listAppliedDeformers tools call into the same
// applyDeformerAndSave path as the human Sculpt button — these tests drive
// those tools directly through window.partwright (the same surface the AI
// dispatcher hits in src/ai/tools.ts), without going through a real
// Anthropic API call.
//
// We cover:
//  - applyDeformer with a top-face seed mutates the rendered mesh and
//    creates a new locked version with a deformer descriptor.
//  - listAppliedDeformers reflects the stored descriptor.
//  - Reloading the page replays the deformer on the saved version.
//  - Bad input (non-finite distance) returns {error}, not a throw.

import { test, expect } from 'playwright/test';

declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    partwright?: any;
    __sculptTest?: {
      getRenderedMeshMaxZ(): number;
    };
  }
}

test.describe('sculpt deformers — AI tool dispatcher', () => {
  test('applyDeformer inflates the +Z face and saves a new version', async ({ page }) => {
    await page.goto('/editor');
    await page.waitForSelector('text=Ready', { timeout: 20_000 });

    const out = await page.evaluate(async () => {
      const pw = window.partwright!;
      await pw.createSession('sculpt-ai-apply');
      const code = 'const { Manifold } = api; return Manifold.cube([10, 10, 10], true);';
      await pw.runAndSave(code, 'baseline');
      const beforeMaxZ = window.__sculptTest!.getRenderedMeshMaxZ();
      const beforeVersions = await pw.listVersions();

      // Same input shape an AI agent would send: {x,y,z} objects, not
      // tuples. probePixel returns the same shape.
      const result = await pw.applyDeformer({
        seedPoint: { x: 0, y: 0, z: 5 },
        seedNormal: { x: 0, y: 0, z: 1 },
        deformer: 'inflate',
        distance: 2,
      });

      const afterMaxZ = window.__sculptTest!.getRenderedMeshMaxZ();
      const afterVersions = await pw.listVersions();

      return {
        result,
        beforeMaxZ,
        afterMaxZ,
        beforeCount: beforeVersions.length,
        afterCount: afterVersions.length,
        lastLabel: afterVersions[afterVersions.length - 1]?.label,
      };
    });

    expect(out.result?.error).toBeUndefined();
    expect(out.result?.versionId).toBeTruthy();
    expect(out.result?.affectedTriangles).toBeGreaterThan(0);
    expect(out.result?.deformer?.kind).toBe('inflate');
    expect(out.result?.deformer?.params?.distance).toBe(2);
    expect(out.result?.deformer?.regionDescriptor?.kind).toBe('coplanar');

    expect(out.beforeMaxZ).toBeCloseTo(5, 1);
    // +2 inflation of the top face lifts it above 6.
    expect(out.afterMaxZ).toBeGreaterThan(out.beforeMaxZ + 1);

    // A new version was saved.
    expect(out.afterCount).toBe(out.beforeCount + 1);
    // Default label generator emits "inflate +2.00" — assert the prefix.
    expect(out.lastLabel).toMatch(/inflate/);
  });

  test('listAppliedDeformers reflects the freshly-applied deformer', async ({ page }) => {
    await page.goto('/editor');
    await page.waitForSelector('text=Ready', { timeout: 20_000 });

    const listed = await page.evaluate(async () => {
      const pw = window.partwright!;
      await pw.createSession('sculpt-ai-list');
      const code = 'const { Manifold } = api; return Manifold.cube([10, 10, 10], true);';
      await pw.runAndSave(code, 'baseline');
      await pw.applyDeformer({
        seedPoint: { x: 0, y: 0, z: 5 },
        seedNormal: { x: 0, y: 0, z: 1 },
        deformer: 'inflate',
        distance: 1.5,
        label: 'top inflate',
      });
      return pw.listAppliedDeformers();
    });

    expect(Array.isArray(listed?.deformers)).toBe(true);
    expect(listed.deformers.length).toBe(1);
    const d = listed.deformers[0];
    expect(d.kind).toBe('inflate');
    expect(d.params.distance).toBe(1.5);
    expect(d.regionDescriptor.kind).toBe('coplanar');
    expect(d.regionDescriptor.seedPoint).toEqual([0, 0, 5]);
    expect(d.regionDescriptor.seedNormal).toEqual([0, 0, 1]);
  });

  test('deformer replays on reload — saved bbox signature matches', async ({ page }) => {
    await page.goto('/editor');
    await page.waitForSelector('text=Ready', { timeout: 20_000 });

    const before = await page.evaluate(async () => {
      const pw = window.partwright!;
      const session = await pw.createSession('sculpt-ai-reload');
      const code = 'const { Manifold } = api; return Manifold.cube([10, 10, 10], true);';
      await pw.runAndSave(code, 'baseline');
      await pw.applyDeformer({
        seedPoint: { x: 0, y: 0, z: 5 },
        seedNormal: { x: 0, y: 0, z: 1 },
        deformer: 'inflate',
        distance: 2,
      });
      return {
        sessionId: session.id,
        maxZ: window.__sculptTest!.getRenderedMeshMaxZ(),
      };
    });

    expect(before.maxZ).toBeGreaterThan(6);

    // Reload directly into the session — the version load path should
    // rehydrate the deformer descriptor and the runCodeSync replay should
    // re-inflate the +Z face to the same height.
    await page.goto(`/editor?session=${before.sessionId}`);
    await page.waitForSelector('text=Ready', { timeout: 20_000 });
    // Allow the version load → runCodeSync → replay chain to settle.
    await page.waitForTimeout(1500);

    const reloadedMaxZ = await page.evaluate(() => window.__sculptTest!.getRenderedMeshMaxZ());
    // Replay is deterministic: same code + same deformer descriptor =>
    // same vertex positions. Tolerate a tiny float epsilon.
    expect(reloadedMaxZ).toBeCloseTo(before.maxZ, 3);

    // And the deformer is still listed on the loaded version.
    const listed = await page.evaluate(() => window.partwright!.listAppliedDeformers());
    expect(listed.deformers.length).toBe(1);
    expect(listed.deformers[0].kind).toBe('inflate');
  });

  test('applyDeformer rejects bad input with {error}, no throw', async ({ page }) => {
    await page.goto('/editor');
    await page.waitForSelector('text=Ready', { timeout: 20_000 });

    const errors = await page.evaluate(async () => {
      const pw = window.partwright!;
      await pw.run('const { Manifold } = api; return Manifold.cube([10, 10, 10], true);');

      // Each invocation should return {error}, NOT throw. Wrap in try/catch
      // so a stray throw surfaces as a clear failure rather than crashing
      // the evaluate.
      async function call(opts: unknown): Promise<unknown> {
        try {
          return await pw.applyDeformer(opts);
        } catch (e) {
          return { thrown: e instanceof Error ? e.message : String(e) };
        }
      }

      const nonFiniteDistance = await call({
        seedPoint: { x: 0, y: 0, z: 5 },
        seedNormal: { x: 0, y: 0, z: 1 },
        deformer: 'inflate',
        distance: Number.POSITIVE_INFINITY,
      });
      const badKind = await call({
        seedPoint: { x: 0, y: 0, z: 5 },
        seedNormal: { x: 0, y: 0, z: 1 },
        deformer: 'twist',
      });
      const missingSeed = await call({
        seedNormal: { x: 0, y: 0, z: 1 },
        deformer: 'inflate',
      });
      const seedNotOnMesh = await call({
        seedPoint: { x: 1000, y: 1000, z: 1000 },
        seedNormal: { x: 0, y: 0, z: 1 },
        deformer: 'inflate',
        distance: 1,
      });
      const tupleSeed = await call({
        // Tuples should be rejected — the schema specifies {x,y,z} objects.
        seedPoint: [0, 0, 5],
        seedNormal: { x: 0, y: 0, z: 1 },
        deformer: 'inflate',
      });
      return { nonFiniteDistance, badKind, missingSeed, seedNotOnMesh, tupleSeed };
    });

    for (const [name, value] of Object.entries(errors)) {
      const v = value as Record<string, unknown>;
      expect(v?.thrown, `${name} should NOT throw`).toBeUndefined();
      expect(v?.error, `${name} should return {error}`).toBeTruthy();
    }
    // Spot-check the messages so future refactors don't silently swap them
    // for unhelpful ones.
    expect(String((errors.nonFiniteDistance as { error?: string }).error)).toMatch(/finite/i);
    expect(String((errors.seedNotOnMesh as { error?: string }).error)).toMatch(/zero triangles|did not raycast/i);
  });
});
