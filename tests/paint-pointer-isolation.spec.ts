// Regression: a pointerdown on an overlay panel that sits in front of the 3D
// view must NOT paint the model behind it, and must not leave the brush stuck
// "painting" so later moves keep applying paint with no button held. Both stem
// from the capture-phase pointerdown listener firing for non-canvas targets.

import { test, expect } from 'playwright/test';

async function setup(page: import('playwright/test').Page) {
  await page.addInitScript(() => localStorage.setItem('partwright-tour-completed', new Date().toISOString()));
  await page.goto('/editor');
  await page.waitForSelector('text=Ready', { timeout: 15000 });
  await page.evaluate(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pw = (window as any).partwright;
    await pw.run(`const { Manifold } = api; return Manifold.sphere(20, 64);`);
  });
  await page.locator('#paint-toggle').dispatchEvent('click');
  await page.waitForSelector('#paint-picker-panel:not(.hidden)');
  await page.locator('#paint-picker-panel button:has-text("Brush")').dispatchEvent('click');
  await page.waitForTimeout(150);
}

test.describe('paint pointer-target isolation', () => {
  test('a press on an overlay in front of the model does not paint or stick', async ({ page }) => {
    await setup(page);
    const regions = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      const canvas = document.querySelector('canvas')!;
      const container = canvas.parentElement!;
      const r = canvas.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2; // over the sphere

      // An overlay panel covering the model, like the paint picker / AI drawer.
      const overlay = document.createElement('div');
      overlay.style.cssText = `position:absolute;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;z-index:9999`;
      container.appendChild(overlay);

      const fire = (el: Element, type: string, x: number, y: number, buttons: number) =>
        el.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0, buttons, pointerId: 1, pointerType: 'mouse', isPrimary: true }));

      // 1) Press on the overlay (target = overlay, not the canvas), over the model.
      fire(overlay, 'pointerdown', cx, cy, 1);
      // 2) Move over the canvas — if the brush got stuck on, this paints.
      fire(canvas, 'pointermove', cx + 10, cy, 1);
      fire(canvas, 'pointermove', cx + 20, cy + 10, 1);
      // 3) Release over the canvas — a stuck stroke would commit a region here.
      fire(canvas, 'pointerup', cx + 20, cy + 10, 0);
      await pw.waitForPaint();

      overlay.remove();
      return pw.listRegions().length;
    });
    expect(regions).toBe(0); // nothing painted from the overlay press
  });

  test('a genuine press on the canvas still paints (fix does not over-block)', async ({ page }) => {
    await setup(page);
    const regions = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      const canvas = document.querySelector('canvas')!;
      const r = canvas.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const fire = (type: string, x: number, y: number, buttons: number) =>
        canvas.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0, buttons, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
      fire('pointermove', cx, cy, 0);
      fire('pointerdown', cx, cy, 1);
      fire('pointermove', cx + 8, cy, 1);
      fire('pointerup', cx + 8, cy, 0);
      await pw.waitForPaint();
      return pw.listRegions().length;
    });
    expect(regions).toBe(1); // normal canvas painting unaffected
  });
});
