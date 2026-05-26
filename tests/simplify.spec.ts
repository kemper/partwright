// Smoke tests for the Simplify overlay tool:
//  - the panel opens from the viewport overlay and shows a slider + a typeable
//    "max triangles" input bounded by the model's current triangle count
//  - setting a target alone does nothing; clicking Apply reduces the live
//    model; Reset restores it
//  - "Save as version" bakes the reduced mesh into a new saved version
//
// Uses dispatchEvent('click') instead of .click() to dodge the onboarding tour
// backdrop that can intercept pointer events on first load of the editor.

import { test, expect, type Page } from 'playwright/test';

// A sphere has plenty of triangles, so there's real headroom to simplify
// (a cube's 12 triangles can't be reduced).
const SPHERE = 'const { Manifold } = api; return Manifold.sphere(10, 64);';

async function triangleCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const pw = (window as unknown as { partwright: { getGeometryData(): { triangleCount?: number } } }).partwright;
    return pw.getGeometryData().triangleCount ?? 0;
  });
}

async function openEditorWithSphere(page: Page): Promise<number> {
  await page.goto('/editor');
  await page.waitForSelector('text=Ready', { timeout: 15000 });
  await page.evaluate(async (code) => {
    const pw = (window as unknown as { partwright: { createSession(name?: string): Promise<unknown>; run(code: string): Promise<unknown> } }).partwright;
    await pw.createSession('simplify-test');
    await pw.run(code);
  }, SPHERE);
  return triangleCount(page);
}

test.describe('Simplify tool', () => {
  test('panel opens with a slider and triangle-count input bounded by the model', async ({ page }) => {
    const base = await openEditorWithSphere(page);
    expect(base).toBeGreaterThan(100);

    await page.locator('#simplify-toggle').dispatchEvent('click');
    await page.waitForSelector('#simplify-panel:not(.hidden)');

    await expect(page.locator('#simplify-slider')).toBeVisible();
    const input = page.locator('#simplify-input');
    await expect(input).toBeVisible();
    // The max triangles default to (and are capped at) the current count.
    await expect(input).toHaveValue(String(base));
    await expect(input).toHaveAttribute('max', String(base));
    await expect(page.locator('#simplify-original')).toContainText(base.toLocaleString());
  });

  test('setting a target does nothing until Apply; Apply reduces and Reset restores', async ({ page }) => {
    const base = await openEditorWithSphere(page);

    await page.locator('#simplify-toggle').dispatchEvent('click');
    await page.waitForSelector('#simplify-panel:not(.hidden)');

    const target = Math.max(50, Math.round(base / 4));
    await page.locator('#simplify-input').fill(String(target));

    // Setting the target no longer touches the live model — that's Apply's job.
    // Apply becomes enabled, but the mesh stays at full detail until clicked.
    await expect(page.locator('#simplify-apply')).toBeEnabled();
    expect(await triangleCount(page)).toBe(base);

    // Apply runs the reduction; wait for the model to actually shrink.
    await page.locator('#simplify-apply').dispatchEvent('click');
    await page.waitForFunction(
      (b) => {
        const pw = (window as unknown as { partwright: { getGeometryData(): { triangleCount?: number } } }).partwright;
        return (pw.getGeometryData().triangleCount ?? b) < b;
      },
      base,
      { timeout: 10000 },
    );

    const reduced = await triangleCount(page);
    expect(reduced).toBeLessThan(base);
    expect(reduced).toBeLessThanOrEqual(target);
    expect(reduced).toBeGreaterThanOrEqual(4);

    // Reset puts the full-detail mesh back on screen.
    await page.locator('#simplify-reset').dispatchEvent('click');
    await page.waitForFunction(
      (b) => {
        const pw = (window as unknown as { partwright: { getGeometryData(): { triangleCount?: number } } }).partwright;
        return (pw.getGeometryData().triangleCount ?? 0) === b;
      },
      base,
      { timeout: 10000 },
    );
    expect(await triangleCount(page)).toBe(base);
  });

  test('Save as version bakes the reduced mesh into a new version', async ({ page }) => {
    const base = await openEditorWithSphere(page);
    // Commit the parametric sphere as v1 so we can see the count grow.
    await page.evaluate(async () => {
      const pw = (window as unknown as { partwright: { runAndSave(code: string, label?: string): Promise<unknown> } }).partwright;
      await pw.runAndSave('const { Manifold } = api; return Manifold.sphere(10, 64);', 'sphere');
    });
    const before = await page.evaluate(async () => {
      const pw = (window as unknown as { partwright: { listVersions(): Promise<unknown[]> } }).partwright;
      return (await pw.listVersions()).length;
    });

    await page.locator('#simplify-toggle').dispatchEvent('click');
    await page.waitForSelector('#simplify-panel:not(.hidden)');

    const target = Math.max(50, Math.round(base / 4));
    await page.locator('#simplify-input').fill(String(target));
    await page.locator('#simplify-apply').dispatchEvent('click');
    await page.waitForFunction(
      (b) => {
        const pw = (window as unknown as { partwright: { getGeometryData(): { triangleCount?: number } } }).partwright;
        return (pw.getGeometryData().triangleCount ?? b) < b;
      },
      base,
      { timeout: 10000 },
    );

    await page.locator('#simplify-save').dispatchEvent('click');
    await expect(page.locator('#simplify-status')).toContainText('Saved', { timeout: 10000 });

    const versions = await page.evaluate(async () => {
      const pw = (window as unknown as { partwright: { listVersions(): Promise<{ label: string | null }[]> } }).partwright;
      return await pw.listVersions();
    });
    expect(versions.length).toBe(before + 1);
    expect(versions[versions.length - 1].label).toBe('simplified');
  });

  test('Save as version preserves an unsaved edited original as its own version', async ({ page }) => {
    const base = await openEditorWithSphere(page);

    // Commit a baseline sphere as a saved version.
    await page.evaluate(async () => {
      const pw = (window as unknown as { partwright: { runAndSave(code: string, label?: string): Promise<unknown> } }).partwright;
      await pw.runAndSave('const { Manifold } = api; return Manifold.sphere(10, 64);', 'sphere');
    });

    // Edit the model WITHOUT saving (different radius → different code, same
    // triangle budget). This unsaved original is what should be preserved when
    // the simplified mesh gets baked into a version.
    await page.evaluate(async () => {
      const pw = (window as unknown as { partwright: { run(code: string): Promise<unknown> } }).partwright;
      await pw.run('const { Manifold } = api; return Manifold.sphere(12, 64);');
    });

    const before = await page.evaluate(async () => {
      const pw = (window as unknown as { partwright: { listVersions(): Promise<unknown[]> } }).partwright;
      return (await pw.listVersions()).length;
    });

    await page.locator('#simplify-toggle').dispatchEvent('click');
    await page.waitForSelector('#simplify-panel:not(.hidden)');

    const target = Math.max(50, Math.round(base / 4));
    await page.locator('#simplify-input').fill(String(target));
    await page.locator('#simplify-apply').dispatchEvent('click');
    await page.waitForFunction(
      (b) => {
        const pw = (window as unknown as { partwright: { getGeometryData(): { triangleCount?: number } } }).partwright;
        return (pw.getGeometryData().triangleCount ?? b) < b;
      },
      base,
      { timeout: 10000 },
    );

    await page.locator('#simplify-save').dispatchEvent('click');
    // The status line calls out that the original was preserved, not just saved.
    await expect(page.locator('#simplify-status')).toContainText('original', { timeout: 10000 });

    const indices = await page.evaluate(async () => {
      const pw = (window as unknown as { partwright: { listVersions(): Promise<{ index: number; label: string | null }[]> } }).partwright;
      return (await pw.listVersions()).map(v => ({ index: v.index, label: v.label }));
    });

    // Two new versions: the preserved original, then the baked simplified import.
    expect(indices.length).toBe(before + 2);
    expect(indices[indices.length - 1].label).toBe('simplified');

    // The second-newest version is the edited radius-12 sphere — a real geometry
    // version, not an import, and distinct from the saved radius-10 baseline.
    const originalIndex = indices[indices.length - 2].index;
    const original = await page.evaluate(async (idx) => {
      const pw = (window as unknown as { partwright: { loadVersion(t: { index: number }): Promise<{ code?: string }> } }).partwright;
      return await pw.loadVersion({ index: idx });
    }, originalIndex);
    expect(original.code ?? '').toContain('Manifold.sphere');
    expect(original.code ?? '').toContain('12');
    expect(original.code ?? '').not.toContain('api.imports');
  });

  test('opening simplify auto-enables the mesh-edges (wireframe) overlay and restores it on close', async ({ page }) => {
    await openEditorWithSphere(page);

    // Wireframe defaults to off — the toolbar button reflects state via its
    // active class (blue tint when on). Tracking via the DOM keeps this test
    // free of internal-API coupling.
    const wireBtn = page.locator('#wireframe-toggle');
    await expect(wireBtn).not.toHaveClass(/text-blue-400/);

    await page.locator('#simplify-toggle').dispatchEvent('click');
    await page.waitForSelector('#simplify-panel:not(.hidden)');
    await expect(wireBtn).toHaveClass(/text-blue-400/);

    // Closing simplify restores the original (off) state.
    await page.locator('#simplify-toggle').dispatchEvent('click');
    await expect(page.locator('#simplify-panel')).toHaveClass(/hidden/);
    await expect(wireBtn).not.toHaveClass(/text-blue-400/);
  });

  test('Apply runs in a worker; the modal surfaces a Cancel button while in flight', async ({ page }) => {
    // Use a denser sphere so the binary-search actually has work to do
    // (the 64-segment default finishes too fast to reliably catch the modal).
    await page.goto('/editor');
    await page.waitForSelector('text=Ready', { timeout: 15000 });
    await page.evaluate(async () => {
      const pw = (window as unknown as { partwright: {
        createSession(name?: string): Promise<unknown>;
        run(code: string): Promise<unknown>;
        __setProgressModalDelay(ms: number): number;
      } }).partwright;
      await pw.createSession('simplify-cancel');
      // High segment counts → ~hundreds of thousands of triangles → the
      // simplify search is multi-step and visible.
      await pw.run('const { Manifold } = api; return Manifold.sphere(10, 512);');
      pw.__setProgressModalDelay(0);
    });
    const base = await triangleCount(page);

    await page.locator('#simplify-toggle').dispatchEvent('click');
    await page.waitForSelector('#simplify-panel:not(.hidden)');
    await page.locator('#simplify-input').fill(String(Math.max(50, Math.round(base / 8))));
    await page.locator('#simplify-apply').dispatchEvent('click');

    // The shared progress modal appears with a Cancel button. We don't
    // race-click here (the dense-sphere test below covers the cancel
    // path). The deliverable for this case is the modal/button being
    // present at all — proves Apply now goes through the worker.
    const modal = page.locator('#progress-modal');
    const cancel = page.locator('[data-testid="progress-modal-cancel"]');
    await expect(cancel).toBeVisible({ timeout: 5000 });
    await expect(modal).toBeVisible();

    // Let it finish naturally.
    await expect(modal).toBeHidden({ timeout: 30000 });
    const reduced = await triangleCount(page);
    expect(reduced).toBeLessThan(base);
  });

  test('closing the simplify panel mid-apply preserves progress; reopening shows the post-state', async ({ page }) => {
    await page.goto('/editor');
    await page.waitForSelector('text=Ready', { timeout: 15000 });
    await page.evaluate(async () => {
      const pw = (window as unknown as { partwright: {
        createSession(name?: string): Promise<unknown>;
        run(code: string): Promise<unknown>;
        __setProgressModalDelay(ms: number): number;
      } }).partwright;
      await pw.createSession('simplify-reopen');
      await pw.run('const { Manifold } = api; return Manifold.sphere(10, 512);');
      pw.__setProgressModalDelay(0);
    });
    const base = await triangleCount(page);

    await page.locator('#simplify-toggle').dispatchEvent('click');
    await page.waitForSelector('#simplify-panel:not(.hidden)');
    const target = Math.max(50, Math.round(base / 8));
    await page.locator('#simplify-input').fill(String(target));
    await page.locator('#simplify-apply').dispatchEvent('click');

    const modal = page.locator('#progress-modal');
    await expect(modal).toBeVisible({ timeout: 5000 });

    // Close the simplify panel mid-apply (the modal stays up — it's global).
    await page.locator('#simplify-toggle').dispatchEvent('click');
    await expect(page.locator('#simplify-panel')).toHaveClass(/hidden/);
    // Modal must remain visible after the panel hides — that's the whole
    // point of the close/reopen contract.
    await expect(modal).toBeVisible();

    // Wait for the apply to finish (modal hides). Reopen the panel; the
    // result line shows the reduced count, not the pristine baseline.
    await expect(modal).toBeHidden({ timeout: 30000 });
    await page.locator('#simplify-toggle').dispatchEvent('click');
    await page.waitForSelector('#simplify-panel:not(.hidden)');

    const reduced = await triangleCount(page);
    expect(reduced).toBeLessThan(base);
    await expect(page.locator('#simplify-result')).toContainText(`${reduced.toLocaleString()} triangles`);
  });
});
