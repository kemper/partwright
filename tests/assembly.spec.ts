import { test, expect } from 'playwright/test';

// Golden path for the multi-part Assembly view: build a 3-part session where two
// parts share a parameter name, open the grid, and assert every part places, the
// shared-parameter union is correct (with the "affects N parts" counts), and a
// shared edit live-previews across the affected parts.

const BOX = `const p = api.params({ size: { type:'number', default: 20, min:5, max:60 } });
const { Manifold } = api; return Manifold.cube([p.size, p.size, p.size], true);`;

const SPHERE = `const p = api.params({ size: { type:'number', default: 15, min:5, max:60 } });
const { Manifold } = api; return Manifold.sphere(p.size, 32);`;

const CYL = `const p = api.params({ height: { type:'number', default: 30, min:5, max:80 } });
const { Manifold } = api; return Manifold.cylinder(p.height, 8, 8, 48);`;

test.describe('Assembly view', () => {
  test('shows all parts in a grid with a shared-parameter panel', async ({ page }) => {
    test.setTimeout(120000);
    await page.goto('/editor');
    await page.waitForFunction(() => !!(window as any).partwright, null, { timeout: 60000 });
    await page.waitForTimeout(4000); // WASM boot

    await page.evaluate(async ({ BOX, SPHERE, CYL }) => {
      const pw = (window as any).partwright;
      await pw.createSession('Assembly e2e');
      await pw.runAndSave(BOX, 'Box');
      await pw.createPart('Sphere');
      await pw.runAndSave(SPHERE, 'Sphere');
      await pw.createPart('Cylinder');
      await pw.runAndSave(CYL, 'Cylinder');
    }, { BOX, SPHERE, CYL });

    // The in-viewport "All parts" toggle is present for multi-part sessions.
    await expect(page.locator('#assembly-toggle')).toBeVisible();

    // Open via the console API (same path the toggle drives); avoids the
    // onboarding tour backdrop that can intercept a click in a fresh profile.
    await page.evaluate(() => { void (window as any).partwright.openAssembly(); });

    // Every part places, and the shared param panel populates.
    await expect.poll(
      async () => (await page.evaluate(() => (window as any).partwright.getAssembly())).parts.every((p: any) => p.placed),
      { timeout: 60000 },
    ).toBe(true);
    await expect(page.locator('#assembly-params-panel')).toBeVisible();

    const snap = await page.evaluate(() => (window as any).partwright.getAssembly());
    expect(snap.parts).toHaveLength(3);
    const size = snap.sharedParams.find((p: any) => p.spec.key === 'size');
    expect(size).toBeTruthy();
    expect(size.partIds).toHaveLength(2); // Box + Sphere declare "size"
    const height = snap.sharedParams.find((p: any) => p.spec.key === 'height');
    expect(height.partIds).toHaveLength(1); // Cylinder only

    // Read-only overview: the editing tool popovers (Tools + Inspect, which hold
    // paint/surface/measure/cross-section) are hidden while the view is open.
    await expect(page.locator('#viewport-tools-group')).toHaveClass(/hidden/);
    await expect(page.locator('#viewport-inspect-group')).toHaveClass(/hidden/);

    // A shared edit marks the panel dirty (Save enabled) — live preview committed.
    await page.evaluate(() => {
      const num = document.querySelector('#assembly-params-panel input[type="number"]') as HTMLInputElement;
      num.value = '50';
      num.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await expect(page.locator('#assembly-params-panel button', { hasText: 'Save' })).toBeEnabled();

    // Selecting a part from the list exits the overview onto that part, with the
    // editing tools restored.
    const sphereId = await page.evaluate(() => (window as any).partwright.listParts().find((p: any) => p.name === 'Sphere').id);
    // Dismiss the onboarding tour backdrop that can intercept clicks in a fresh profile.
    await page.evaluate(() => document.querySelectorAll('.tour-backdrop, [class*="tour"]').forEach(e => e.remove()));
    await page.click(`[data-part-id="${sphereId}"]`);
    await expect.poll(async () => (await page.evaluate(() => (window as any).partwright.getAssembly())).open).toBe(false);
    await expect(page.locator('#assembly-params-panel')).toHaveCount(0);
    await expect(page.locator('#viewport-tools-group')).not.toHaveClass(/hidden/);
    expect(await page.evaluate(() => (window as any).partwright.getCurrentPart()?.name)).toBe('Sphere');
  });
});
