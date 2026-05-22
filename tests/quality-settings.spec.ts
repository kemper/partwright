import { test, expect } from 'playwright/test';

// Curve-quality (circular-segment) settings in the viewport "Mesh" popover:
//   1. The popover shows the five presets, with Very High ('highest') active by
//      default.
//   2. The manifold-js engine applies the chosen segment count, and Ultra
//      (1024) yields more triangles than the default.
//   3. The choice is SESSION-scoped: it persists with the active session
//      (restored on reload), not globally.

// Dismiss the onboarding tour so its backdrop doesn't intercept overlay clicks.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('partwright-tour-completed', '1'));
});

type RunResult = { triangleCount?: number; error?: string };
type PartwrightApi = { run: (code: string) => Promise<RunResult> };

async function waitForEngine(page: import('playwright/test').Page): Promise<void> {
  await page.waitForFunction(
    () => !!(window as unknown as { partwright?: { run?: unknown } }).partwright?.run,
    { timeout: 20_000 },
  );
}

function readMeshSettings(page: import('playwright/test').Page, sessionId: string) {
  return page.evaluate((id) => new Promise<{ quality: string; refine: number } | null>((resolve) => {
    const req = indexedDB.open('partwright');
    req.onsuccess = () => {
      const db = req.result;
      const get = db.transaction('sessions', 'readonly').objectStore('sessions').get(id);
      get.onsuccess = () => resolve((get.result?.meshSettings ?? null));
      get.onerror = () => resolve(null);
    };
    req.onerror = () => resolve(null);
  }), sessionId);
}

test.describe('Curve quality settings', () => {
  test('Mesh popover shows presets with Very High active by default', async ({ page }) => {
    await page.goto('/editor');
    await page.waitForSelector('#mesh-settings-toggle');

    await page.locator('#mesh-settings-toggle').click();
    await expect(page.locator('#mesh-settings-panel')).toBeVisible();

    // All five presets are present; 'highest' (labeled "Very High") is default.
    for (const q of ['low', 'medium', 'high', 'highest', 'ultra']) {
      await expect(page.locator(`#mesh-settings-panel [data-quality="${q}"]`)).toBeVisible();
    }
    await expect(page.locator('#mesh-settings-panel [data-quality="highest"]')).toHaveClass(/bg-blue-500/);
  });

  test('preset choice persists per session and restores on reload', async ({ page }) => {
    await page.goto('/editor');
    await page.waitForSelector('#mesh-settings-toggle');
    await waitForEngine(page);

    await page.evaluate(() => (window as unknown as { partwright: { createSession(n: string): Promise<unknown> } }).partwright.createSession('quality-persist'));
    const id = new URL(page.url()).searchParams.get('session') ?? '';
    expect(id).not.toBe('');

    await page.locator('#mesh-settings-toggle').click();
    await page.locator('#mesh-settings-panel [data-quality="low"]').click();
    await expect.poll(() => readMeshSettings(page, id)).toMatchObject({ quality: 'low' });

    await page.reload();
    await page.waitForSelector('#mesh-settings-toggle');
    await page.locator('#mesh-settings-toggle').click();
    await expect(page.locator('#mesh-settings-panel [data-quality="low"]')).toHaveClass(/bg-blue-500/);
    await expect(page.locator('#mesh-settings-panel [data-quality="highest"]')).not.toHaveClass(/bg-blue-500/);
  });

  test('manifold-js engine applies the chosen segment count', async ({ page }) => {
    await page.goto('/editor');
    await page.waitForSelector('#mesh-settings-toggle');
    await waitForEngine(page);

    const sphereCode = 'const { Manifold } = api; return Manifold.sphere(5);';
    const runSphere = () =>
      page.evaluate((code) => {
        const api = (window as unknown as { partwright: PartwrightApi }).partwright;
        return api.run(code);
      }, sphereCode);

    // Very High (default) — many triangles.
    const high = await runSphere();
    expect(high.triangleCount ?? 0).toBeGreaterThan(2000);

    // Drop to Low via the Mesh popover.
    await page.locator('#mesh-settings-toggle').click();
    await page.locator('#mesh-settings-panel [data-quality="low"]').click();

    const low = await runSphere();
    expect(low.triangleCount ?? 0).toBeLessThan(high.triangleCount ?? 0);
    expect(low.triangleCount ?? 0).toBeGreaterThan(0);
  });

  test('Ultra preset yields more triangles than the default', async ({ page }) => {
    await page.goto('/editor');
    await page.waitForSelector('#mesh-settings-toggle');
    await waitForEngine(page);

    // A cylinder stays cheap at 1024 segments (~4k tris); a sphere would be
    // ~2M and too heavy for a smoke test. Either way the count must climb.
    const cylinderCode = 'const { Manifold } = api; return Manifold.cylinder(5, 3, 3);';
    const runCyl = () =>
      page.evaluate((code) => {
        const api = (window as unknown as { partwright: PartwrightApi }).partwright;
        return api.run(code);
      }, cylinderCode);

    const high = await runCyl();

    await page.locator('#mesh-settings-toggle').click();
    await page.locator('#mesh-settings-panel [data-quality="ultra"]').click();

    const ultra = await runCyl();
    expect(ultra.triangleCount ?? 0).toBeGreaterThan(high.triangleCount ?? 0);
  });

  test('exported session carries its mesh settings (schema 1.7)', async ({ page }) => {
    await page.goto('/editor');
    await page.waitForSelector('#mesh-settings-toggle');
    await waitForEngine(page);

    await page.evaluate(() => (window as unknown as { partwright: { createSession(n: string): Promise<unknown> } }).partwright.createSession('quality-export'));
    const id = new URL(page.url()).searchParams.get('session') ?? '';

    await page.locator('#mesh-settings-toggle').click();
    await page.locator('#mesh-settings-panel [data-quality="low"]').click();
    await expect.poll(() => readMeshSettings(page, id)).toMatchObject({ quality: 'low' });

    const exported = await page.evaluate(async (sid) => {
      const w = window as unknown as { partwright: { exportSessionData(id: string): Promise<{ data: { session: { meshSettings?: { quality: string; refine: number } } } }> } };
      return (await w.partwright.exportSessionData(sid)).data;
    }, id);
    expect(exported.session.meshSettings).toMatchObject({ quality: 'low' });
  });
});
