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
  previewSurfaceModifier: (id: string, opts?: Record<string, unknown>, preserveColor?: boolean) =>
    Promise<{ ok?: true; error?: string }>;
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

  test('the Scope picker writes a label-scoped call (one shape of a union)', async ({ page }) => {
    await page.goto('/editor');
    await waitForEngine(page);

    await page.evaluate(async () => {
      const pw = (window as unknown as { partwright: PW }).partwright;
      await pw.createSession('surface-scope-label-panel');
      await pw.run([
        'const { Manifold } = api;',
        "const box = api.label(Manifold.cube([16, 16, 16], true).translate([-6, 0, 0]), 'grip', { color: [0.2, 0.6, 1] });",
        'const ball = Manifold.sphere(9, 48).translate([7, 0, 0]);',
        'return box.add(ball);',
      ].join('\n'));
    });

    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
    await page.keyboard.press('ControlOrMeta+k');
    const palette = page.locator('input[aria-label="Search commands"]');
    await palette.fill('Knurl');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'Surface modifiers' })).toBeVisible();

    // Whole model → the Scope section appears; By label → the 'grip' dropdown.
    await page.getByRole('button', { name: 'Whole model' }).click();
    await expect(page.getByText('Scope', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'By label' }).click();
    const select = page.locator('select[aria-label="Scope label"]');
    await expect(select).toHaveValue('grip');

    await page.getByRole('button', { name: 'Apply as code' }).click();
    await expect(page.getByRole('heading', { name: 'Surface modifiers' })).toHaveCount(0, { timeout: 60_000 });
    const code = await page.evaluate(() => (window as unknown as { partwright: PW }).partwright.getCode());
    expect(code).toContain('api.surface.knurl({');
    expect(code).toContain("label: 'grip'");
  });

  test('the Scope picker captures a clicked point and writes a region scope', async ({ page }) => {
    await page.goto('/editor');
    await waitForEngine(page);

    await page.evaluate(async () => {
      const pw = (window as unknown as { partwright: PW }).partwright;
      await pw.createSession('surface-scope-region-panel');
      await pw.run('const { Manifold } = api;\nreturn Manifold.sphere(14, 96);');
    });
    await page.waitForTimeout(2500); // let WASM + auto-frame settle so the raycast hits

    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
    await page.keyboard.press('ControlOrMeta+k');
    const palette = page.locator('input[aria-label="Search commands"]');
    await palette.fill('Fuzzy skin');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'Surface modifiers' })).toBeVisible();

    await page.getByRole('button', { name: 'Whole model' }).click();
    await page.getByRole('button', { name: 'Near point' }).click();
    await page.getByRole('button', { name: 'Pick point on model' }).click();

    // Dispatch a pointerdown at the canvas center, where the auto-framed model is.
    await page.evaluate(() => {
      const canvas = document.querySelector('canvas')!;
      const r = canvas.getBoundingClientRect();
      canvas.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2,
        button: 0, buttons: 1, pointerId: 1, pointerType: 'mouse', isPrimary: true,
      }));
    });
    await expect(page.getByText(/Point \(/)).toBeVisible();

    await page.getByRole('button', { name: 'Apply as code' }).click();
    await expect(page.getByRole('heading', { name: 'Surface modifiers' })).toHaveCount(0, { timeout: 60_000 });
    const code = await page.evaluate(() => (window as unknown as { partwright: PW }).partwright.getCode());
    expect(code).toContain('api.surface.fuzzy({');
    expect(code).toContain('region: {');
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

  test('previewSurfaceModifier resolves a label/region scope (preview matches a scoped apply)', async ({ page }) => {
    await page.goto('/editor');
    await waitForEngine(page);
    const out = await page.evaluate(async () => {
      const pw = (window as unknown as { partwright: PW }).partwright;
      await pw.createSession('scoped-preview');
      // A union of a labeled grip cube + a smooth sphere.
      await pw.run([
        'const { Manifold } = api;',
        "const grip = api.label(Manifold.cube([14, 14, 14], true).translate([-9, 0, 0]), 'grip');",
        'const ball = Manifold.sphere(9, 48).translate([9, 0, 0]);',
        'return grip.add(ball);',
      ].join('\n'));
      // A label-scoped preview resolves to the grip's triangles (no whole-model fallback).
      const scoped = await pw.previewSurfaceModifier('knurl', { label: 'grip', cellWidth: 2, amplitude: 0.8 }, true);
      // An unknown label previews as a no-op (selects nothing) rather than texturing the whole model.
      const unknown = await pw.previewSurfaceModifier('knurl', { label: 'nope', cellWidth: 2 }, true);
      // A malformed region surfaces the same validation error Apply would.
      const bad = await pw.previewSurfaceModifier('knurl', { region: { point: [0, 0], radius: 5 } }, true);
      return { scoped, unknown, bad };
    });
    expect(out.scoped.ok).toBe(true);
    expect(out.scoped.error).toBeUndefined();
    expect(out.unknown.ok).toBe(true); // empty selection, no error
    expect(out.bad.error).toBeTruthy(); // [0,0] is not [x,y,z]
  });
});
