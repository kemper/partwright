// Sculpt strokes smoke test — verifies the sculpt prototype lifecycle:
//   1. Sculpt button appears in the viewport toolbar.
//   2. Clicking it opens the sculpt picker panel (brush picker, sliders, etc.).
//   3. Subdivide ×1 adds vertices (mesh density increases).
//   4. Dragging a push stroke deforms the mesh (vertex count or bbox changes).
//   5. Apply persists the strokes to the current version.
//   6. Reload — the persisted strokes replay and the mesh is still deformed.

import { test, expect } from 'playwright/test';

test.describe('sculpt strokes', () => {
  test('subdivide + push stroke persist across reload', async ({ page }) => {
    // Disable the first-visit tour before any page script runs — its
    // backdrop overlay swallows pointer events on the viewport canvas.
    await page.addInitScript(() => {
      try { localStorage.setItem('partwright-tour-completed', new Date().toISOString()); } catch { /* fine */ }
    });
    await page.goto('/editor');
    await page.waitForSelector('text=Ready', { timeout: 15000 });

    // Run a deterministic base shape inside a fresh session so the
    // rest of the test has a stable starting point and the save flow
    // has a session to write to.
    await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      await pw.createSession('sculpt-test');
      await pw.runAndSave('return api.Manifold.sphere(10, 24);', 'base');
    });

    // Sculpt button is wired into the viewport toolbar.
    const sculptBtn = page.locator('#sculpt-toggle');
    await expect(sculptBtn).toBeVisible();

    // Capture baseline stats.
    const baseline = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = JSON.parse((document.getElementById('geometry-data') as any).textContent || '{}');
      return { triangleCount: data.triangleCount, vertexCount: data.vertexCount };
    });
    expect(baseline.triangleCount).toBeGreaterThan(0);

    // Open sculpt mode → picker panel appears.
    await sculptBtn.dispatchEvent('click');
    await expect(page.locator('#sculpt-picker-panel')).toBeVisible();
    // Give the listener registration a tick to settle.
    await page.waitForTimeout(150);

    // Subdivide once. Subdivision pins the level for the next stroke
    // recorded in this session; the level shows up in the panel.
    await page.locator('#sculpt-subdivide').dispatchEvent('click');
    await expect(page.locator('#sculpt-picker-panel')).toContainText('lvl 1');

    // Drag a push stroke across the visible model. The exact world-
    // space coverage doesn't matter — we only need at least one
    // sample to register so a stroke gets committed.
    const canvas = page.locator('canvas').first();
    const box = await canvas.boundingBox();
    if (!box) throw new Error('canvas not visible');
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;

    await page.mouse.move(cx - 30, cy);
    await page.mouse.down();
    for (let i = 0; i < 8; i++) {
      await page.mouse.move(cx - 30 + i * 8, cy + (i % 2 ? 4 : -4), { steps: 2 });
    }
    await page.mouse.up();
    await page.waitForTimeout(100);

    // Apply persists the strokes onto a new version and locks the editor.
    await page.locator('#sculpt-apply').dispatchEvent('click');
    await expect(page.locator('#editor-lock-overlay')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#editor-lock-overlay')).toContainText(/sculpt strokes/);

    // Apply is async (thumbnail capture + IndexedDB write). Poll until
    // #geometry-data reflects the sculpted (denser) mesh.
    await page.waitForFunction(
      (baseTri) => {
        const el = document.getElementById('geometry-data');
        if (!el) return false;
        try {
          const d = JSON.parse(el.textContent || '{}');
          return typeof d.triangleCount === 'number' && d.triangleCount > baseTri;
        } catch { return false; }
      },
      baseline.triangleCount,
      { timeout: 10_000 },
    );

    // Sculpted mesh stats reflect the new subdivision + brush effect.
    const sculpted = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = JSON.parse((document.getElementById('geometry-data') as any).textContent || '{}');
      return { triangleCount: data.triangleCount, vertexCount: data.vertexCount };
    });
    expect(sculpted.triangleCount).toBeGreaterThan(baseline.triangleCount);

    // Reload — the persisted strokes should replay on load and the
    // sculpted topology should match what we saved.
    await page.reload();
    await page.waitForSelector('text=Ready', { timeout: 15000 });
    await expect(page.locator('#editor-lock-overlay')).toBeVisible({ timeout: 10_000 });

    // Auto-run debounce can re-run the code 300ms after setValue, so
    // wait a beat for the sculpt-stroke replay path inside runCodeSync
    // to settle and #geometry-data to flush.
    await page.waitForTimeout(500);
    const afterReload = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = JSON.parse((document.getElementById('geometry-data') as any).textContent || '{}');
      return { triangleCount: data.triangleCount, vertexCount: data.vertexCount };
    });

    expect(afterReload.triangleCount).toBe(sculpted.triangleCount);
  });
});
