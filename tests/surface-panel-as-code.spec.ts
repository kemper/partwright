// Surface panel "apply as code" (phase 4): for manifold-js sessions in
// whole-model mode, the in-code-able modifiers write an `api.surface.<id>({…})`
// call into the code instead of baking the mesh — keeping the model parametric.
// Region/patch applies, voxelize/voronoiLamp (engine-changing), and SCAD/BREP
// sessions keep the bake path. The console twin is
// `partwright.applySurfaceTextureAsCode(id, opts?)` (UI ↔ API parity).

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
  run: (code: string) => Promise<{ triangleCount?: number } | unknown>;
  getCode: () => string;
  setActiveLanguage: (l: string) => Promise<unknown>;
  applySurfaceTextureAsCode: (id: string, opts?: Record<string, number | boolean | string>) =>
    Promise<{ ok?: boolean; error?: string; call?: string; replaced?: boolean; version?: { label: string }; geometry?: { triangleCount?: number } }>;
};

test.describe('surface textures applied as code', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('partwright-tour-completed', '1'));
  });

  test('applySurfaceTextureAsCode inserts, re-runs, saves — and updates in place on re-apply', async ({ page }) => {
    await page.goto('/editor');
    await waitForEngine(page);

    const out = await page.evaluate(async () => {
      const pw = (window as unknown as { partwright: PW }).partwright;
      await pw.createSession('surface-as-code');
      const plain = await pw.run([
        'const { Manifold } = api;',
        'return Manifold.sphere(10, 48);',
      ].join('\n')) as { triangleCount?: number };

      const first = await pw.applySurfaceTextureAsCode('cable', { cableWidth: 1.6, amplitude: 0.5 });
      const codeAfterFirst = pw.getCode();

      // Re-apply with tweaked options: the existing call is edited, not duplicated.
      const second = await pw.applySurfaceTextureAsCode('cable', { cableWidth: 2.2, amplitude: 0.4 });
      const codeAfterSecond = pw.getCode();

      return {
        plainTris: plain.triangleCount ?? 0,
        first, second,
        codeAfterFirst,
        cableCallCount: (codeAfterSecond.match(/api\.surface\.cable\(/g) ?? []).length,
        codeAfterSecond,
      };
    });

    expect(out.first.ok).toBe(true);
    expect(out.first.replaced).toBe(false);
    expect(out.codeAfterFirst).toContain('api.surface.cable({ cableWidth: 1.6, amplitude: 0.5 });');
    expect(out.first.version?.label).toBe('api.surface.cable');
    // The run force-applied the texture: stats reflect the textured mesh.
    expect(out.first.geometry?.triangleCount ?? 0).toBeGreaterThan(out.plainTris);

    expect(out.second.ok).toBe(true);
    expect(out.second.replaced).toBe(true);
    expect(out.cableCallCount).toBe(1);
    expect(out.codeAfterSecond).toContain('api.surface.cable({ cableWidth: 2.2, amplitude: 0.4 });');

    // No Re-apply pill: the apply path force-computes.
    await expect(page.getByRole('button', { name: /Re-apply/ })).toBeHidden();
  });

  test('rejects non-manifold-js sessions and unknown options with actionable errors', async ({ page }) => {
    await page.goto('/editor');
    await waitForEngine(page);

    const out = await page.evaluate(async () => {
      const pw = (window as unknown as { partwright: PW }).partwright;
      await pw.createSession('surface-as-code-errors');
      const unknownKey = await pw.applySurfaceTextureAsCode('knit', { nope: 1 });
      const badId = await pw.applySurfaceTextureAsCode('voxelize' as string);
      await pw.setActiveLanguage('voxel');
      const wrongLang = await pw.applySurfaceTextureAsCode('knit', {});
      return {
        unknownKey: unknownKey.error ?? '',
        badId: badId.error ?? '',
        wrongLang: wrongLang.error ?? '',
      };
    });

    expect(out.unknownKey).toContain('nope');
    expect(out.badId).toContain('voxelize');
    expect(out.wrongLang).toContain('manifold-js');
  });

  test('the Surface panel applies as code in whole-model mode (and labels the button)', async ({ page }) => {
    await page.goto('/editor');
    await waitForEngine(page);

    await page.evaluate(async () => {
      const pw = (window as unknown as { partwright: PW }).partwright;
      await pw.createSession('surface-panel-as-code');
      await pw.run([
        'const { Manifold } = api;',
        'return Manifold.sphere(10, 32);',
      ].join('\n'));
    });

    // Open the panel on the Fuzzy tab via the command palette.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
    await page.keyboard.press('ControlOrMeta+k');
    const palette = page.locator('input[aria-label="Search commands"]');
    await palette.fill('Fuzzy skin');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'Surface modifiers' })).toBeVisible();

    // Default region mode bakes; whole-model mode writes code — and says so.
    await expect(page.getByRole('button', { name: 'Apply (bake)' })).toBeVisible();
    await page.getByRole('button', { name: 'Whole model' }).click();
    const applyAsCode = page.getByRole('button', { name: 'Apply as code' });
    await expect(applyAsCode).toBeVisible();
    await expect(page.getByText(/Adds api\.surface\.fuzzy/)).toBeVisible();

    await applyAsCode.click();
    // Panel closes on success; the code now carries the call and the model is textured.
    await expect(page.getByRole('heading', { name: 'Surface modifiers' })).toHaveCount(0, { timeout: 30_000 });
    const code = await page.evaluate(() => (window as unknown as { partwright: PW }).partwright.getCode());
    expect(code).toContain('api.surface.fuzzy({');
    await expect(page.getByRole('button', { name: /Re-apply/ })).toBeHidden();
  });

  test('the Knurl tab applies a diamond grip as code', async ({ page }) => {
    await page.goto('/editor');
    await waitForEngine(page);

    await page.evaluate(async () => {
      const pw = (window as unknown as { partwright: PW }).partwright;
      await pw.createSession('surface-knurl-panel');
      await pw.run([
        'const { Manifold } = api;',
        'return Manifold.cylinder(30, 10, 10, 64);',
      ].join('\n'));
    });

    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
    await page.keyboard.press('ControlOrMeta+k');
    const palette = page.locator('input[aria-label="Search commands"]');
    await palette.fill('Knurl');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'Surface modifiers' })).toBeVisible();

    // The Knurl tab is in-code-able: whole-model mode applies as code.
    await page.getByRole('button', { name: 'Whole model' }).click();
    const applyAsCode = page.getByRole('button', { name: 'Apply as code' });
    await expect(applyAsCode).toBeVisible();
    await expect(page.getByText(/Adds api\.surface\.knurl/)).toBeVisible();
    await applyAsCode.click();
    await expect(page.getByRole('heading', { name: 'Surface modifiers' })).toHaveCount(0, { timeout: 60_000 });

    const out = await page.evaluate(() => {
      const pw = (window as unknown as { partwright: PW & { getGeometryData: () => { triangleCount?: number; isManifold?: boolean } } }).partwright;
      return { code: pw.getCode(), geo: pw.getGeometryData() };
    });
    expect(out.code).toContain('api.surface.knurl({');
    expect(out.geo.triangleCount ?? 0).toBeGreaterThan(5_000); // subdivided + displaced
    await expect(page.getByRole('button', { name: /Re-apply/ })).toBeHidden();
  });

  test('voxelize tab is not dead-locked by an empty region selection', async ({ page }) => {
    await page.goto('/editor');
    await waitForEngine(page);
    await page.evaluate(async () => {
      const pw = (window as unknown as { partwright: PW }).partwright;
      await pw.createSession('surface-voxelize-enabled');
      await pw.run('const { Manifold } = api;\nreturn Manifold.sphere(8, 24);');
    });

    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
    await page.keyboard.press('ControlOrMeta+k');
    const palette = page.locator('input[aria-label="Search commands"]');
    await palette.fill('Voxelize model');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'Surface modifiers' })).toBeVisible();

    // Region mode is the default and nothing is picked, but voxelize has no
    // region support — Apply must be enabled (bake path).
    const apply = page.getByRole('button', { name: 'Apply (bake)' });
    await expect(apply).toBeVisible();
    await expect(apply).toBeEnabled();
  });
});
