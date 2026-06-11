// Voxel Studio camera behavior. The studio vetoes OrbitControls for presses
// within the model's bounds so editing doesn't rotate the view — and crucially,
// because the delete tool carves holes straight through the mesh, the veto is
// bounds-based (not surface-based like mesh paint): a click that lands in a
// just-carved hole must NOT fall through and rotate the camera mid-edit. A drag
// that starts clearly outside the model still orbits.

import { test, expect, type Page } from 'playwright/test';

async function getCamera(page: Page) {
  return page.evaluate(() => (window as unknown as {
    partwright: { getViewState(): { camera: { azimuth: number; elevation: number } } };
  }).partwright.getViewState().camera);
}

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
    // A thin slab so a wide-brush delete punches all the way through to the
    // background, leaving a real hole to click into.
    await pw.run(`return api.voxels().fillBox([0,0,0],[20,20,2], '#cc4444');`);
  });
  await page.waitForTimeout(1000);
  await page.locator('#voxel-paint-toggle').dispatchEvent('click');
  await page.waitForSelector('#voxel-paint-panel:not(.hidden)');
  await page.waitForTimeout(500);
}

test.describe('voxel studio camera', () => {
  test('delete tool does not rotate the view when clicking into a carved hole', async ({ page }) => {
    await setup(page);
    await page.locator('#voxel-paint-panel button[data-tool="remove"]').dispatchEvent('click');
    await page.evaluate(() => (window as unknown as { partwright: { setVoxelBrush(o: object): void } }).partwright.setVoxelBrush({ radius: 5 }));
    await page.waitForTimeout(150);

    const canvas = await page.locator('#viewport').boundingBox();
    if (!canvas) throw new Error('viewport missing');
    const cx = canvas.x + canvas.width / 2;
    const cy = canvas.y + canvas.height / 2;

    const dragRot = async (x0: number, y0: number, x1: number, y1: number) => {
      const b = await getCamera(page);
      await page.mouse.move(x0, y0);
      await page.mouse.down();
      await page.mouse.move((x0 + x1) / 2, (y0 + y1) / 2, { steps: 6 });
      await page.mouse.move(x1, y1, { steps: 6 });
      await page.mouse.up();
      await page.waitForTimeout(250);
      const a = await getCamera(page);
      return Math.abs(a.azimuth - b.azimuth) + Math.abs(a.elevation - b.elevation);
    };

    // Punch a hole through the slab at the centre.
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForTimeout(300);

    // Dragging starting inside that hole must NOT rotate the camera.
    const inHole = await dragRot(cx, cy, cx + 50, cy + 30);
    expect(inHole).toBeLessThan(1);

    // A drag from the far corner, well outside the model bounds, still orbits.
    const outside = await dragRot(
      canvas.x + 6, canvas.y + 6,
      canvas.x + canvas.width - 6, canvas.y + canvas.height - 6,
    );
    expect(outside).toBeGreaterThan(5);
  });

  // OrbitControls sets `touch-action: none` on the canvas once (on connect) and
  // relies on it staying. The studio overrides it while editing, so on teardown
  // it must RESTORE that value — clearing it to '' would let the browser reclaim
  // touch gestures, leaving a post-studio orbit drag only partially rotating on
  // mobile ("the model turns far less"). Mouse orbit is unaffected, so this is a
  // touch-only regression; we assert the underlying style is preserved.
  test('restores the canvas touch-action after the studio closes (mobile orbit)', async ({ page }) => {
    await setup(page);
    const touchAction = () => page.evaluate(
      () => (document.querySelector('#viewport') as HTMLCanvasElement).style.touchAction,
    );
    // Studio is open here (setup opened the panel); OrbitControls/studio both want 'none'.
    expect(await touchAction()).toBe('none');
    // Close the studio and confirm touch-action is restored, not cleared.
    await page.evaluate(() => (window as unknown as { partwright: { deactivateVoxelPaint(): unknown } }).partwright.deactivateVoxelPaint());
    await page.waitForTimeout(200);
    expect(await touchAction()).toBe('none');
  });
});
