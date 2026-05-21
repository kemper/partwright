import { test, expect } from 'playwright/test';

// Verifies the "Mesh detail" slider in the viewport Mesh popover (global
// mesh-refinement factor):
//   1. It defaults to OFF (factor 1) — no global subdivision out of the box.
//   2. Driving it changes the rendered triangle density by ~n² (refine math),
//      including on flat-faced geometry — a 12-triangle cube becomes 12·n².
//   3. The chosen factor persists to the shared quality-settings localStorage.
//
// The slider lives inside the (initially hidden) Mesh popover, so we drive it
// via its value + change event rather than opening the panel — that also keeps
// the onboarding tour (interactive view) from intercepting clicks.

type RunResult = { triangleCount?: number; error?: string };
type PartwrightApi = { run: (code: string) => Promise<RunResult> };

const CUBE = 'const { Manifold } = api; return Manifold.cube([10, 10, 10]);';

async function setDetail(page: import('playwright/test').Page, n: number): Promise<void> {
  await page.evaluate((v) => {
    const el = document.getElementById('mesh-detail-slider') as HTMLInputElement;
    el.value = String(v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, n);
}

async function runCube(page: import('playwright/test').Page): Promise<RunResult> {
  return page.evaluate((code) => {
    const api = (window as unknown as { partwright: PartwrightApi }).partwright;
    return api.run(code);
  }, CUBE);
}

test.describe('Mesh detail slider', () => {
  test('defaults to off and refines a flat cube by n²', async ({ page }) => {
    await page.goto('/editor');
    await page.waitForSelector('#mesh-detail-slider', { state: 'attached' });

    // Default factor is 1 (off) — no global subdivision out of the box.
    await expect(page.locator('#mesh-detail-slider')).toHaveValue('1');
    await expect(page.locator('#mesh-detail-readout')).toHaveText('off');

    await page.waitForFunction(
      () => !!(window as unknown as { partwright?: { run?: unknown } }).partwright?.run,
      { timeout: 20_000 },
    );

    // Default (off) leaves the bare cube at its native 12 triangles.
    expect((await runCube(page)).triangleCount).toBe(12);

    // refine(2) splits every edge in two → 12·4.
    await setDetail(page, 2);
    await expect(page.locator('#mesh-detail-readout')).toHaveText('2×');
    expect((await runCube(page)).triangleCount).toBe(48);

    // refine(3) → 12·9 triangles.
    await setDetail(page, 3);
    await expect(page.locator('#mesh-detail-readout')).toHaveText('3×');
    expect((await runCube(page)).triangleCount).toBe(108);

    // The range goes well past single digits — refine(32) → 12·1024 triangles.
    await setDetail(page, 32);
    await expect(page.locator('#mesh-detail-readout')).toHaveText('32×');
    expect((await runCube(page)).triangleCount).toBe(12288);
  });

  test('persists the chosen factor to quality settings', async ({ page }) => {
    await page.goto('/editor');
    await page.waitForSelector('#mesh-detail-slider', { state: 'attached' });

    await setDetail(page, 4);

    const stored = await page.evaluate(() =>
      localStorage.getItem('partwright-quality-settings-v1'),
    );
    expect(JSON.parse(stored!)).toMatchObject({ refine: 4 });

    // Reload — the slider should reflect the persisted factor.
    await page.reload();
    await page.waitForSelector('#mesh-detail-slider', { state: 'attached' });
    await expect(page.locator('#mesh-detail-slider')).toHaveValue('4');
    await expect(page.locator('#mesh-detail-readout')).toHaveText('4×');
  });
});
