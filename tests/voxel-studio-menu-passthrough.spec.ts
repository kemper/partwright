import { test, expect, type Page } from 'playwright/test';

// Regression for the mobile bug where tapping the Voxel Studio menu painted/
// added voxels on the model behind it. The studio's pointerdown handler runs on
// the viewport container in the CAPTURE phase, so it sees presses on the
// overlaid panel too; it must ignore any press whose target isn't the canvas.

async function setup(page: Page) {
  await page.addInitScript(() => localStorage.setItem('partwright-tour-completed', new Date().toISOString()));
  await page.goto('/editor');
  await page.waitForFunction(
    () => !!(window as unknown as { partwright?: { run?: unknown } }).partwright?.run,
    undefined,
    { timeout: 30_000 },
  );
  await page.evaluate(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pw = (window as any).partwright;
    await pw.setActiveLanguage('voxel');
    await pw.run(`return api.voxels().fillBox([0,0,0],[20,20,20], '#cc4444');`);
  });
  await page.waitForTimeout(1000);
  await page.locator('#voxel-paint-toggle').dispatchEvent('click');
  await page.waitForSelector('#voxel-paint-panel:not(.hidden)');
  await page.waitForTimeout(500);
}

// Read the LIVE in-memory voxel grid size (getGeometryData only reflects baked
// state). An errant edit changes this immediately.
const voxelCount = (page: Page) =>
  page.evaluate(() => import('/src/color/voxelPaint.ts').then((m) => m.voxelCount()));

test('tapping the Voxel Studio menu does not edit the model behind it', async ({ page }) => {
  await setup(page);
  // Use the "add" tool so any errant edit is measurable as a voxel-count change.
  await page.locator('#voxel-paint-panel button[data-tool="add"]').dispatchEvent('click');
  await page.waitForTimeout(150);

  const canvas = await page.locator('#viewport').boundingBox();
  if (!canvas) throw new Error('viewport missing');
  const cx = canvas.x + canvas.width / 2;
  const cy = canvas.y + canvas.height / 2;

  const before = await voxelCount(page);
  expect(before).toBeGreaterThan(0);

  // Simulate the bug: a press whose DOM target is a menu button, but whose
  // screen coordinates land over the model. Before the fix this raycast and
  // added a voxel; now the canvas-target guard rejects it.
  await page.evaluate(({ x, y }) => {
    const btn = document.querySelector('#voxel-paint-panel button[data-tool="add"]') as HTMLElement;
    btn.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true, cancelable: true, composed: true,
      pointerId: 1, isPrimary: true, button: 0, buttons: 1, clientX: x, clientY: y,
    }));
    window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1, button: 0 }));
  }, { x: cx, y: cy });
  await page.waitForTimeout(400);

  const afterMenuTap = await voxelCount(page);
  expect(afterMenuTap).toBe(before); // menu tap must NOT edit the model

  await page.screenshot({ path: 'test-results/voxel-menu-passthrough.png' });

  // Positive control: the same gesture targeting the canvas itself DOES edit.
  await page.evaluate(({ x, y }) => {
    const canvasEl = document.querySelector('#viewport') as HTMLElement;
    canvasEl.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true, cancelable: true, composed: true,
      pointerId: 2, isPrimary: true, button: 0, buttons: 1, clientX: x, clientY: y,
    }));
    window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 2, button: 0 }));
  }, { x: cx, y: cy });
  await page.waitForTimeout(400);

  const afterCanvasTap = await voxelCount(page);
  expect(afterCanvasTap).toBeGreaterThan(before); // canvas tap still works
});
