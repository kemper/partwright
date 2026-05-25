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
});
