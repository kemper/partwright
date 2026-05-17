// Smoke tests for the deformers prototype (sculpt mode).
//
// What we cover:
//  - The Sculpt toolbar button + panel are wired up.
//  - Applying an Inflate deformer to the top face of a cube mutates the
//    rendered mesh's bounding box.
//  - Round-trip: after saving the sculpted version and reloading the page,
//    the deformer rehydrates and the mutated bounding box reappears.
//  - The editor lock fires when a deformer is present.
//
// The deformer apply flow normally requires a pointer pick on the canvas,
// which is awkward to script in headless Chromium without a deterministic
// raycast. Tests bypass the pointer pick by pushing a deformer descriptor
// straight into the store via a test bridge installed at boot, then
// re-running the code — the rehydration path inside runCodeSync is what
// would normally fire on session load, so this exercises the exact code
// path we care about.

import { test, expect } from 'playwright/test';

interface SculptTestBridge {
  addDeformer(d: unknown): unknown;
  clearDeformers(): void;
  hasDeformers(): boolean;
  rerunCurrentCode(): Promise<void>;
  getRenderedMeshMaxZ(): number;
  syncLockState(): void;
}

declare global {
  interface Window {
    __sculptTest?: SculptTestBridge;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    partwright?: any;
  }
}

test.describe('sculpt deformers', () => {
  test('toolbar button toggles the sculpt panel', async ({ page }) => {
    await page.goto('/editor');
    await page.waitForSelector('text=Ready', { timeout: 20_000 });
    await page.waitForSelector('#sculpt-toggle');

    const panel = page.locator('#sculpt-panel');
    await expect(panel).toBeHidden();
    await page.locator('#sculpt-toggle').dispatchEvent('click');
    await expect(panel).toBeVisible();

    // Inflate / Smooth buttons render
    await expect(panel.locator('button:has-text("Inflate")')).toBeVisible();
    await expect(panel.locator('button:has-text("Smooth")')).toBeVisible();

    // Apply is disabled until a region is selected
    await expect(panel.locator('button:has-text("Apply")')).toBeDisabled();

    // Close again
    await page.locator('#sculpt-toggle').dispatchEvent('click');
    await expect(panel).toBeHidden();
  });

  test('inflate deformer mutates mesh bbox and persists across reload', async ({ page }) => {
    await page.goto('/editor');
    await page.waitForSelector('text=Ready', { timeout: 20_000 });

    const apply = await page.evaluate(async () => {
      const pw = window.partwright!;
      const bridge = window.__sculptTest!;
      const session = await pw.createSession('sculpt-roundtrip');
      const code = 'const { Manifold } = api; return Manifold.cube([10, 10, 10], true);';
      await pw.run(code);
      // Save baseline
      await pw.runAndSave(code, 'baseline');
      const beforeMaxZ = bridge.getRenderedMeshMaxZ();

      // Add a deformer that targets the +Z face of the cube.
      bridge.addDeformer({
        kind: 'inflate',
        regionDescriptor: {
          kind: 'coplanar',
          seedPoint: [0, 0, 5],
          seedNormal: [0, 0, 1],
          normalTolerance: 0.9995,
        },
        params: { distance: 2.5 },
      });

      // Re-run the code so the runCodeSync replay path applies the deformer.
      await bridge.rerunCurrentCode();
      const afterMaxZ = bridge.getRenderedMeshMaxZ();

      // Save a sculpted version. force: true so it doesn't dedupe by code+annotations
      // (it shouldn't since deformers differ, but force makes the intent explicit).
      const saveResult = await pw.runAndSave(code, 'sculpted');

      // Inspect what was saved.
      const versions = await pw.listVersions();
      const lastIndex = versions[versions.length - 1].index;
      const loaded = await pw.loadVersion({ index: lastIndex });
      const savedDeformers = ((loaded.geometryData as Record<string, unknown> | null)?.deformers as unknown[] | undefined ?? []).length;

      return {
        sessionId: session.id,
        beforeMaxZ,
        afterMaxZ,
        savedVersionLabel: saveResult.version?.label as string | undefined,
        savedDeformers,
        versionCount: versions.length,
        lastIndex,
      };
    });

    expect(apply.beforeMaxZ).toBeCloseTo(5, 1);
    // +Z inflate of 2.5 → top face vertices at ~7.5, corners less (averaged normal).
    // Empirically the cube's corner Z lifts to ~6.7, the face vertices to ~7.5.
    expect(apply.afterMaxZ).toBeGreaterThan(apply.beforeMaxZ + 1);
    expect(apply.savedDeformers).toBe(1);

    // Reload the session URL — the deformer should rehydrate during the
    // version load and apply during the subsequent runCodeSync.
    await page.goto(`/editor?session=${apply.sessionId}`);
    await page.waitForSelector('text=Ready', { timeout: 20_000 });
    // Give the version load path time to run code + apply deformer.
    await page.waitForTimeout(1500);

    const reloadedMaxZ = await page.evaluate(() => {
      return window.__sculptTest!.getRenderedMeshMaxZ();
    });

    expect(reloadedMaxZ).toBeGreaterThan(apply.beforeMaxZ + 1);
  });

  test('editor locks after a deformer is applied', async ({ page }) => {
    await page.goto('/editor');
    await page.waitForSelector('text=Ready', { timeout: 20_000 });

    await page.evaluate(async () => {
      const pw = window.partwright!;
      const bridge = window.__sculptTest!;
      await pw.createSession('sculpt-lock-test');
      const code = 'const { Manifold } = api; return Manifold.cube([10, 10, 10], true);';
      await pw.run(code);
      bridge.addDeformer({
        kind: 'inflate',
        regionDescriptor: {
          kind: 'coplanar',
          seedPoint: [0, 0, 5],
          seedNormal: [0, 0, 1],
          normalTolerance: 0.9995,
        },
        params: { distance: 1.0 },
      });
      bridge.syncLockState();
    });

    // Lock overlay should appear with the deformer wording.
    const overlay = page.locator('#editor-lock-overlay');
    await expect(overlay).toBeVisible();
    await expect(overlay).toContainText(/deformer/i);

    // Run button should be disabled.
    const runBtn = page.locator('#btn-run');
    await expect(runBtn).toBeDisabled();
  });
});
