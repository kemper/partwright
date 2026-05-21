import { test, expect } from 'playwright/test';

// Verifies the editor-header "Detail" slider (global mesh-refinement factor):
//   1. It renders with the default factor (2) and an "N×" readout.
//   2. Driving it changes the rendered triangle density by ~n² (refine math),
//      including on flat-faced geometry — a 12-triangle cube becomes 12·n².
//   3. The chosen factor persists to the shared quality-settings localStorage.

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
  test('defaults to 2× and refines a flat cube by n²', async ({ page }) => {
    await page.goto('/editor');
    await page.waitForSelector('#mesh-detail-slider');

    // Default factor is 2 (a little more refined out of the box).
    await expect(page.locator('#mesh-detail-slider')).toHaveValue('2');
    await expect(page.locator('#mesh-detail-readout')).toHaveText('2×');

    await page.waitForFunction(
      () => !!(window as unknown as { partwright?: { run?: unknown } }).partwright?.run,
      { timeout: 20_000 },
    );

    // A bare cube is 12 triangles; refine(2) splits every edge in two → 12·4.
    expect((await runCube(page)).triangleCount).toBe(48);

    // Slide to 1 (off): readout reads "off" and the cube is its native 12 tris.
    await setDetail(page, 1);
    await expect(page.locator('#mesh-detail-readout')).toHaveText('off');
    expect((await runCube(page)).triangleCount).toBe(12);

    // Slide high: refine(3) → 12·9 triangles.
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
    await page.waitForSelector('#mesh-detail-slider');

    await setDetail(page, 4);

    const stored = await page.evaluate(() =>
      localStorage.getItem('partwright-quality-settings-v1'),
    );
    expect(JSON.parse(stored!)).toMatchObject({ refine: 4 });

    // Reload — the slider should reflect the persisted factor.
    await page.reload();
    await page.waitForSelector('#mesh-detail-slider');
    await expect(page.locator('#mesh-detail-slider')).toHaveValue('4');
    await expect(page.locator('#mesh-detail-readout')).toHaveText('4×');
  });
});
