// Image-paint stamps must coexist with brush paint. Two regressions are covered:
//
//   1. Stamping onto a model that already has brush paint must NOT wipe the
//      brush strokes (and the stamp itself must land). The stamp flow builds the
//      final mesh + resolves every region itself, so committing the stamp runs
//      with the paint reconciler suspended — otherwise the reconciler rebuilds
//      from base and drops the stamp (its colours live in runtime perTriColors,
//      not its descriptor) plus the existing paint.
//
//   2. The image-paint panel's "Clear" removes only the stamps, leaving brush
//      paint (and any other region) intact.
//
// The stamp has no console API, so this drives the real UI: load an image into
// the panel's file input (via a DataTransfer built in-page), then dispatch
// pointer events on the viewport to stamp.

import { test, expect } from 'playwright/test';
import type { Page } from 'playwright/test';

async function openEditor(page: Page) {
  await page.goto('/editor');
  await page.waitForSelector('text=Ready', { timeout: 15000 });
  // Dismiss the first-run onboarding tour so it doesn't dim the viewport.
  const skip = page.locator('button:has-text("Skip")');
  if (await skip.count()) await skip.first().dispatchEvent('click').catch(() => {});
  await page.evaluate(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pw = (window as any).partwright;
    // A wide, flat slab fills the viewport so the centre ray reliably hits the
    // top face for both the brush stroke and the stamp click.
    await pw.run(`const { Manifold } = api; return Manifold.cube([40, 40, 3], true);`);
  });
  await page.waitForTimeout(200); // let the viewport auto-frame settle
}

// Load a two-colour PNG into the image-paint panel and wait until it's ready to
// stamp. Background removal is turned off so the whole image stamps (a solid
// region we can assert on).
async function loadStampImage(page: Page) {
  await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 64; canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ff3030'; ctx.fillRect(0, 0, 64, 64);
    ctx.fillStyle = '#3030ff'; ctx.fillRect(16, 16, 32, 32);
    const blob: Blob = await new Promise((res) => canvas.toBlob((b) => res(b!), 'image/png'));
    const file = new File([blob], 'stamp.png', { type: 'image/png' });
    const input = document.querySelector('#image-paint-panel input[type="file"]') as HTMLInputElement;
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  // Wait until the panel reports it's ready to stamp (pickedImageData decoded).
  await expect(page.locator('#image-paint-panel [data-stamp-hint]')).toHaveText('Click on model to stamp', { timeout: 10000 });

  // Turn off auto background removal so the solid image stamps in full.
  await page.evaluate(() => {
    const panel = document.querySelector('#image-paint-panel')!;
    const box = panel.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
    if (box && box.checked) { box.checked = false; box.dispatchEvent(new Event('change', { bubbles: true })); }
  });
}

// Click the centre of the viewport to drop a stamp there.
async function stampAtCentre(page: Page) {
  await page.evaluate(() => {
    const canvas = document.querySelector('canvas')!;
    const r = canvas.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const fire = (t: string) => canvas.dispatchEvent(new PointerEvent(t, {
      bubbles: true, clientX: cx, clientY: cy, button: 0, buttons: 1,
      pointerId: 1, pointerType: 'mouse', isPrimary: true,
    }));
    fire('pointermove'); // hover preview
    fire('pointerdown'); // commits the stamp
    fire('pointerup');
  });
  // Drain any paint-reconcile work the stamp may have kicked off. Pre-fix, this
  // is exactly where the destructive rebuild ran and wiped the stamp/brush, so
  // waiting for it to settle makes the regression deterministic.
  await page.evaluate(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pw = (window as any).partwright;
    if (pw.waitForPaint) await pw.waitForPaint();
  });
  await page.waitForTimeout(200);
}

test.describe('image-paint stamps coexist with brush paint', () => {
  test('stamping after brush paint keeps the brush, and Clear drops only stamps', async ({ page }) => {
    await openEditor(page);

    // 1. Brush a stroke (same code path as the UI smooth brush).
    const brushTris = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      const r = pw.paintStroke({ points: [[-12, 0, 1.5]], radius: 5, maxEdge: 0.5, color: [0.1, 0.8, 0.2] });
      return r.triangles as number;
    });
    expect(brushTris).toBeGreaterThan(0);

    // 2. Open the image-paint panel and load an image.
    await page.locator('#image-paint-toggle').dispatchEvent('click');
    await page.waitForSelector('#image-paint-panel:not(.hidden)');
    await loadStampImage(page);

    // 3. Stamp on the model.
    await stampAtCentre(page);

    // 4. Both regions must be present and populated: the stamp landed AND the
    //    brush survived (the bug wiped one or the other).
    const afterStamp = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      const regions = pw.listRegions() as Array<{ source: string; triangles: number }>;
      const brush = regions.filter(r => r.source !== 'imagePaint');
      const stamps = regions.filter(r => r.source === 'imagePaint');
      return {
        stampCount: stamps.length,
        stampTris: stamps.reduce((n, r) => n + r.triangles, 0),
        brushCount: brush.length,
        brushTris: brush.reduce((n, r) => n + r.triangles, 0),
      };
    });
    expect(afterStamp.stampCount).toBe(1);
    expect(afterStamp.stampTris).toBeGreaterThan(0);   // the stamp actually landed
    expect(afterStamp.brushCount).toBe(1);
    expect(afterStamp.brushTris).toBeGreaterThan(0);   // brush paint was NOT wiped

    // Close the panel for a clean eyes-on shot: green brush dab on the left,
    // red/blue stamp in the centre, both on the slab.
    await page.locator('#image-paint-panel button[title*="Close"]').dispatchEvent('click');
    await page.waitForTimeout(300);
    await page.screenshot({ path: 'test-results/stamp-with-brush.png' });

    // 5. Reopen the panel and Clear — removes only the stamp.
    await page.locator('#image-paint-toggle').dispatchEvent('click');
    await page.waitForSelector('#image-paint-panel:not(.hidden)');
    await page.locator('#image-paint-panel').getByRole('button', { name: 'Clear', exact: true }).dispatchEvent('click');
    await page.waitForTimeout(300);

    const afterClear = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      const regions = pw.listRegions() as Array<{ source: string; triangles: number }>;
      return {
        stampCount: regions.filter(r => r.source === 'imagePaint').length,
        brushCount: regions.filter(r => r.source !== 'imagePaint').length,
        brushTris: regions.filter(r => r.source !== 'imagePaint').reduce((n, r) => n + r.triangles, 0),
      };
    });
    expect(afterClear.stampCount).toBe(0);             // stamps cleared
    expect(afterClear.brushCount).toBe(1);             // brush paint preserved
    expect(afterClear.brushTris).toBeGreaterThan(0);

    await page.locator('#image-paint-panel button[title*="Close"]').dispatchEvent('click');
    await page.waitForTimeout(300);
    await page.screenshot({ path: 'test-results/stamp-cleared-brush-kept.png' });
  });
});
