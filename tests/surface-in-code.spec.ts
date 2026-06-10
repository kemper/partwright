// api.surface.* — surface textures declared in code. The op chain is recorded
// during the run but applied (and memoized) on the MAIN thread.
//
// Explicit/console runs (partwright.run / runAndSave, the Run button, version
// loads) FORCE the memoized compute and return the textured mesh — so an
// AI/console caller gets the real result with no extra step (it can't press the
// in-UI pill). Only the editor's live-typing auto-run is gated behind the
// "Re-apply" pill. See src/surface/surfaceOps.ts + applySurfaceTextures.

import { test, expect, type Page } from 'playwright/test';

async function waitForEngine(page: Page) {
  await page.waitForSelector('text=Ready', { timeout: 20_000 });
  await page.waitForFunction(
    () => !!(window as unknown as { partwright?: { run?: unknown } }).partwright?.run,
    { timeout: 20_000 },
  );
}

type PW = {
  createSession: (n?: string) => Promise<unknown>;
  run: (code: string) => Promise<{ error?: string | null; triangleCount?: number } | unknown>;
  getGeometryData: () => { triangleCount?: number };
};

test.describe('api.surface.* (textures declared in code)', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('partwright-tour-completed', '1');
      // Keep the code pane visible (the AI drawer auto-open collapses it),
      // so the stale-export test can click into .cm-content.
      try {
        localStorage.setItem('partwright-ai-settings-v1', JSON.stringify({ editorCollapsed: false }));
      } catch { /* ignore */ }
    });
  });

  test('a console run force-applies the texture and returns the textured mesh', async ({ page }) => {
    await page.goto('/editor');
    await waitForEngine(page);

    const out = await page.evaluate(async () => {
      const pw = (window as unknown as { partwright: PW }).partwright;
      await pw.createSession('surface-in-code');
      // Base sphere triangle count, no texture.
      const plain = await pw.run([
        'const { Manifold } = api;',
        'return Manifold.sphere(10, 48);',
      ].join('\n')) as { triangleCount?: number };
      // Same geometry + a cable texture: the console run must compute it inline
      // (not gate) so the returned stats reflect the textured, subdivided mesh.
      const textured = await pw.run([
        'const { Manifold } = api;',
        'api.surface.cable({ cableWidth: 1.6, amplitude: 0.5 });',
        'return Manifold.sphere(10, 48);',
      ].join('\n')) as { triangleCount?: number };
      return { plainTris: plain.triangleCount ?? 0, texturedTris: textured.triangleCount ?? 0 };
    });

    expect(out.plainTris).toBeGreaterThan(0);
    // The texture subdivides + displaces, so triangle count grows substantially.
    expect(out.texturedTris).toBeGreaterThan(out.plainTris);

    // No "Re-apply" pill on a console/explicit run — the texture was applied.
    await expect(page.getByRole('button', { name: /Re-apply/ })).toBeHidden();
    await page.screenshot({ path: 'test-results/surface-in-code-textured.png' });
  });

  test('exporting while textures are stale carries a warning', async ({ page }) => {
    await page.goto('/editor');
    await waitForEngine(page);

    // Put api.surface code in the editor WITHOUT running it, then trigger the
    // live-typing auto-run by typing. The un-cached chain renders the base mesh
    // and raises the Re-apply pill — the one state where an export would carry
    // the untextured mesh.
    await page.evaluate(async () => {
      const pw = (window as unknown as { partwright: PW & { setCode: (c: string) => void } }).partwright;
      await pw.createSession('surface-stale-export');
      pw.setCode([
        'const { Manifold } = api;',
        'api.surface.fuzzy({ amplitude: 0.5 });',
        'return Manifold.sphere(10, 32);',
      ].join('\n'));
    });
    await page.click('.cm-content');
    await page.keyboard.press('Control+End');
    await page.keyboard.type('\n// touch');
    await expect(page.getByRole('button', { name: /Re-apply/ })).toBeVisible({ timeout: 15_000 });

    const out = await page.evaluate(async () => {
      const pw = (window as unknown as { partwright: { exportSTLData: () => Promise<{ warning?: string }> } }).partwright;
      return await pw.exportSTLData();
    });
    expect(out.warning ?? '').toContain('untextured');

    // An explicit run clears the pill — and with it, the warning.
    const after = await page.evaluate(async () => {
      const pw = (window as unknown as { partwright: PW & { getCode: () => string; exportSTLData: () => Promise<{ warning?: string }> } }).partwright;
      await pw.run(pw.getCode());
      return await pw.exportSTLData();
    });
    expect(after.warning).toBeUndefined();
    await expect(page.getByRole('button', { name: /Re-apply/ })).toBeHidden();
  });

  test('rejects unknown surface options with an actionable error', async ({ page }) => {
    await page.goto('/editor');
    await waitForEngine(page);

    const err = await page.evaluate(async () => {
      const pw = (window as unknown as { partwright: PW }).partwright;
      await pw.createSession('surface-in-code-errors');
      const r = await pw.run([
        'const { Manifold } = api;',
        'api.surface.knit({ stitchWidth: 1, nope: 2 });',
        'return Manifold.cube([10, 10, 10]);',
      ].join('\n')) as { error?: string | null };
      return r?.error ?? '';
    });
    expect(err).toContain('nope');
  });
});
