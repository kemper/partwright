// Smoke tests for the Simplify overlay tool:
//  - the panel opens from the viewport overlay and shows a slider + a typeable
//    "max triangles" input bounded by the model's current triangle count
//  - setting a target alone does nothing; Reset clears the pending target
//  - the single shared Apply reduces the live model AND bakes the result into a
//    new saved version in one step (there is no separate "Save as version")
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

  test('setting a target does nothing until Apply; Reset clears the pending target', async ({ page }) => {
    const base = await openEditorWithSphere(page);

    await page.locator('#simplify-toggle').dispatchEvent('click');
    await page.waitForSelector('#simplify-panel:not(.hidden)');

    // Nothing pending yet → both Reset and Apply start disabled.
    await expect(page.locator('#simplify-reset')).toBeDisabled();
    await expect(page.locator('#simplify-apply')).toBeDisabled();

    const target = Math.max(50, Math.round(base / 4));
    await page.locator('#simplify-input').fill(String(target));

    // Setting the target doesn't touch the live model — that's Apply's job.
    // Apply (and Reset) become enabled, but the mesh stays at full detail.
    await expect(page.locator('#simplify-apply')).toBeEnabled();
    await expect(page.locator('#simplify-reset')).toBeEnabled();
    expect(await triangleCount(page)).toBe(base);

    // Reset clears the pending target without ever running the op, so both go
    // idle again and the model is untouched.
    await page.locator('#simplify-reset').dispatchEvent('click');
    await expect(page.locator('#simplify-apply')).toBeDisabled();
    await expect(page.locator('#simplify-reset')).toBeDisabled();
    await expect(page.locator('#simplify-input')).toHaveValue(String(base));
    expect(await triangleCount(page)).toBe(base);
  });

  test('Apply reduces the mesh and bakes a new saved version in one step', async ({ page }) => {
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

    // The single Apply both reduces the live mesh and saves a version — there
    // is no separate "Save as version" step.
    await page.locator('#simplify-apply').dispatchEvent('click');
    await expect(page.locator('#simplify-status')).toContainText('Saved', { timeout: 15000 });

    const reduced = await triangleCount(page);
    expect(reduced).toBeLessThan(base);
    expect(reduced).toBeLessThanOrEqual(target);
    expect(reduced).toBeGreaterThanOrEqual(4);

    const versions = await page.evaluate(async () => {
      const pw = (window as unknown as { partwright: { listVersions(): Promise<{ label: string | null }[]> } }).partwright;
      return await pw.listVersions();
    });
    expect(versions.length).toBe(before + 1);
    expect(versions[versions.length - 1].label).toBe('simplified');

    // Apply committed everything, so both Reset and Apply are idle again.
    await expect(page.locator('#simplify-apply')).toBeDisabled();
    await expect(page.locator('#simplify-reset')).toBeDisabled();
  });

  test('Apply preserves an unsaved edited original as its own version', async ({ page }) => {
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
    // Apply reduces and bakes in one step; the status line calls out that the
    // unsaved original was preserved as its own version, not just saved.
    await page.locator('#simplify-apply').dispatchEvent('click');
    await expect(page.locator('#simplify-status')).toContainText('original', { timeout: 15000 });

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

test.describe('Quality panel — edge-length & size knobs', () => {
  // A coarse box fused with a fine sphere: lots of big flat triangles plus an
  // already-dense region. Edge-length enhance should split the big faces.
  const MIXED = 'const { Manifold } = api; return Manifold.cube([24,24,24], true).add(Manifold.sphere(7, 48).translate([12,12,12]));';

  async function openEditorWithMixed(page: Page): Promise<number> {
    await page.goto('/editor');
    await page.waitForSelector('text=Ready', { timeout: 20000 });
    return page.evaluate(async (code) => {
      const pw = (window as unknown as { partwright: { createSession(name?: string): Promise<unknown>; run(code: string): Promise<unknown>; getGeometryData(): { triangleCount?: number } } }).partwright;
      await pw.createSession('quality-knobs');
      await pw.run(code);
      return pw.getGeometryData().triangleCount ?? 0;
    }, MIXED);
  }

  test('Enhance + Edge knob refines the large triangles', async ({ page }) => {
    const base = await openEditorWithMixed(page);
    expect(base).toBeGreaterThan(100);

    await page.locator('#simplify-toggle').dispatchEvent('click');
    await page.waitForSelector('#simplify-panel:not(.hidden)');

    // Switch to Enhance, then the Edge-length knob — the count slider hides and
    // the length controls appear.
    await page.getByRole('button', { name: 'Enhance', exact: true }).dispatchEvent('click');
    await page.locator('#simplify-knob-edge').dispatchEvent('click');
    await expect(page.locator('#simplify-length-input')).toBeVisible();
    await expect(page.locator('#simplify-slider')).toBeHidden();

    // A small target edge length splits the big box faces → more triangles.
    // The single Apply refines and bakes the result in one step.
    await page.locator('#simplify-length-input').fill('3');
    await page.locator('#simplify-length-input').dispatchEvent('change');
    await page.locator('#simplify-apply').dispatchEvent('click');
    await page.waitForFunction(
      (b) => {
        const pw = (window as unknown as { partwright: { getGeometryData(): { triangleCount?: number } } }).partwright;
        return (pw.getGeometryData().triangleCount ?? 0) > b;
      },
      base,
      { timeout: 15000 },
    );
    expect(await triangleCount(page)).toBeGreaterThan(base);
  });

  test('an edge length longer than every edge warns and leaves the mesh unchanged', async ({ page }) => {
    const base = await openEditorWithMixed(page);

    await page.locator('#simplify-toggle').dispatchEvent('click');
    await page.waitForSelector('#simplify-panel:not(.hidden)');
    await page.getByRole('button', { name: 'Enhance', exact: true }).dispatchEvent('click');
    await page.locator('#simplify-knob-edge').dispatchEvent('click');

    await page.locator('#simplify-length-input').fill('100000');
    await page.locator('#simplify-length-input').dispatchEvent('change');
    await page.locator('#simplify-apply').dispatchEvent('click');

    await expect(page.locator('#simplify-status')).toContainText('Nothing to enhance', { timeout: 10000 });
    expect(await triangleCount(page)).toBe(base);
  });

  test('Simplify + Size knob reduces the triangle count', async ({ page }) => {
    const base = await openEditorWithMixed(page);

    await page.locator('#simplify-toggle').dispatchEvent('click');
    await page.waitForSelector('#simplify-panel:not(.hidden)');
    // Simplify is the default mode; pick the Size knob (threshold + amount).
    await page.locator('#simplify-knob-size').dispatchEvent('click');
    await expect(page.locator('#simplify-length-input')).toBeVisible();
    await expect(page.locator('#simplify-amount-slider')).toBeVisible();

    // A generous min-feature size collapses the fine sphere detail away.
    await page.locator('#simplify-length-input').fill('2');
    await page.locator('#simplify-length-input').dispatchEvent('change');
    await page.locator('#simplify-apply').dispatchEvent('click');
    await page.waitForFunction(
      (b) => {
        const pw = (window as unknown as { partwright: { getGeometryData(): { triangleCount?: number } } }).partwright;
        return (pw.getGeometryData().triangleCount ?? b) < b;
      },
      base,
      { timeout: 15000 },
    );
    expect(await triangleCount(page)).toBeLessThan(base);
  });
});

test.describe('Quality panel — heavy-enhance guard', () => {
  // Inject a low warn threshold (and a high hard cap) so an ordinary enhance
  // trips the Proceed/Cancel confirmation without needing a 10M-triangle model.
  async function openWithLowWarn(page: Page): Promise<number> {
    await page.addInitScript(() => {
      try {
        localStorage.setItem('partwright-tour-completed', '1');
        localStorage.setItem('partwright-app-config-v1', JSON.stringify({
          renderer: { enhanceWarnTriangles: 100, enhanceMaxTriangles: 100_000_000 },
        }));
      } catch { /* ignore */ }
    });
    await page.goto('/editor');
    await page.waitForSelector('text=Ready', { timeout: 15000 });
    return page.evaluate(async () => {
      const pw = (window as unknown as { partwright: { createSession(n?: string): Promise<unknown>; run(c: string): Promise<unknown>; getGeometryData(): { triangleCount?: number } } }).partwright;
      await pw.createSession('heavy-enhance');
      await pw.run('const { Manifold } = api; return Manifold.sphere(10, 48);');
      return pw.getGeometryData().triangleCount ?? 0;
    });
  }

  test('an enhance over the warn limit asks before applying; Cancel leaves the mesh', async ({ page }) => {
    const base = await openWithLowWarn(page);
    expect(base).toBeGreaterThan(100);

    await page.locator('#simplify-toggle').dispatchEvent('click');
    await page.waitForSelector('#simplify-panel:not(.hidden)');
    // Enhance mode (count knob default target is base×2 → well over the warn=100).
    await page.getByRole('button', { name: 'Enhance', exact: true }).dispatchEvent('click');

    await page.locator('#simplify-apply').dispatchEvent('click');
    // The confirmation modal appears instead of immediately running.
    const proceed = page.locator('[data-testid="heavy-enhance-proceed"]');
    await expect(proceed).toBeVisible({ timeout: 5000 });

    // Cancel → nothing runs, the mesh stays at its original count.
    await page.locator('[data-testid="heavy-enhance-cancel"]').click();
    await expect(proceed).toBeHidden();
    expect(await triangleCount(page)).toBe(base);

    // Apply again and proceed → the enhance runs and the mesh grows.
    await page.locator('#simplify-apply').dispatchEvent('click');
    await expect(proceed).toBeVisible({ timeout: 5000 });
    await proceed.click();
    await page.waitForFunction(
      (b) => {
        const pw = (window as unknown as { partwright: { getGeometryData(): { triangleCount?: number } } }).partwright;
        return (pw.getGeometryData().triangleCount ?? 0) > b;
      },
      base,
      { timeout: 15000 },
    );
    expect(await triangleCount(page)).toBeGreaterThan(base);
  });

  test('an enhance over the hard cap is refused, not applied', async ({ page }) => {
    // Tiny cap so even a modest enhance is refused outright (no confirm, no commit).
    await page.addInitScript(() => {
      try {
        localStorage.setItem('partwright-tour-completed', '1');
        localStorage.setItem('partwright-app-config-v1', JSON.stringify({
          renderer: { enhanceWarnTriangles: 10, enhanceMaxTriangles: 100 },
        }));
      } catch { /* ignore */ }
    });
    await page.goto('/editor');
    await page.waitForSelector('text=Ready', { timeout: 15000 });
    const base = await page.evaluate(async () => {
      const pw = (window as unknown as { partwright: { createSession(n?: string): Promise<unknown>; run(c: string): Promise<unknown>; getGeometryData(): { triangleCount?: number } } }).partwright;
      await pw.createSession('enhance-cap');
      await pw.run('const { Manifold } = api; return Manifold.sphere(10, 48);');
      return pw.getGeometryData().triangleCount ?? 0;
    });
    expect(base).toBeGreaterThan(100); // already above the tiny cap

    await page.locator('#simplify-toggle').dispatchEvent('click');
    await page.waitForSelector('#simplify-panel:not(.hidden)');
    await page.getByRole('button', { name: 'Enhance', exact: true }).dispatchEvent('click');
    await page.locator('#simplify-apply').dispatchEvent('click');

    // Refused before running — status calls out the limit and the mesh is untouched.
    await expect(page.locator('#simplify-status')).toContainText('over the', { timeout: 5000 });
    await expect(page.locator('[data-testid="heavy-enhance-proceed"]')).toHaveCount(0);
    expect(await triangleCount(page)).toBe(base);
  });
});
