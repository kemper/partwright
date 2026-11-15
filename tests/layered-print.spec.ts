import { test, expect } from 'playwright/test';

// HueForge-style filament layering: photo → solver (Worker) → session painted
// with the predicted look → layer-swap 3MF. Uses a synthetic image drawn in the
// page (a sunset-ish gradient with a dark disc and coloured blobs), so no
// third-party photo is involved.

async function syntheticImage(page: import('playwright/test').Page): Promise<string> {
  return page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 320; c.height = 200;
    const g = c.getContext('2d')!;
    const grad = g.createLinearGradient(0, 0, 0, 200);
    grad.addColorStop(0, '#f6e7c8'); grad.addColorStop(0.6, '#f08a3c'); grad.addColorStop(1, '#3a2a5c');
    g.fillStyle = grad; g.fillRect(0, 0, 320, 200);
    g.fillStyle = '#1b1b22'; g.beginPath(); g.arc(160, 110, 55, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#2f6fd0'; g.beginPath(); g.arc(60, 60, 30, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#f4f4f0'; g.beginPath(); g.arc(160, 100, 22, 0, Math.PI * 2); g.fill();
    return c.toDataURL('image/png');
  });
}

async function gotoEditor(page: import('playwright/test').Page): Promise<void> {
  await page.addInitScript(() => {
    try { localStorage.setItem('partwright-tour-completed', '1'); } catch { /* ignore */ }
  });
  await page.goto('/editor');
  await page.waitForFunction(() => !!(window as any).partwright?.createLayeredPrint);
  // Engine warmup: the session import runs the import wrapper through the engine.
  await page.evaluate(async () => {
    const pw = (window as any).partwright;
    for (let i = 0; i < 60; i++) {
      const p = await pw.runAndSave('return api.Manifold.cube([1, 1, 1], true);', 'probe', {});
      if (p && !p.error && p.version) return;
      await new Promise((r) => setTimeout(r, 1000));
    }
  });
}

test.describe('Layered print from photo', () => {
  test('createLayeredPrint solves, opens a session, and exports a layer-swap 3MF', async ({ page }) => {
    test.setTimeout(180_000);
    await gotoEditor(page);
    const src = await syntheticImage(page);

    const res = await page.evaluate(async (src) => {
      const pw = (window as any).partwright;
      const bad = await pw.createLayeredPrint({ src, colors: 99 });
      const created = await pw.createLayeredPrint({ src, colors: 5, widthMm: 60, pixelSizeMm: 0.5, maxHeightMm: 2, effort: 0.3, name: 'hf spec' });
      const plan = pw.getLayeredPrintPlan();
      const code: string = pw.getCode();
      const images = pw.getImages();
      // Edit the pinned schedule in code: move the top filament up one layer.
      const last = plan.schedule[plan.schedule.length - 1];
      const edited = code.replace(`layer: ${last.layer} }`, `layer: ${last.layer + 1} }`);
      const ran = await pw.run(edited);
      const replanned = pw.getLayeredPrintPlan();
      // Compose: a frame around the print still runs and keeps one plan.
      const framed = await pw.run(edited.replace('return print;', 'return print.add(api.Manifold.cube([64, 4, 1]).translate([-32, -26, 0]));'));
      return { bad, created, plan, code, images, ran, replanned, framed, framedPlan: pw.getLayeredPrintPlan() };
    }, src);

    expect(res.code).toMatch(/api\.layeredPrint\(api\.image\('/);
    expect(res.code).toMatch(/schedule: \[/);
    expect(res.images).toHaveLength(1);
    expect(res.ran.error ?? null).toBeNull();
    expect(res.replanned.schedule.at(-1).layer).toBe(res.plan.schedule.at(-1).layer + 1);
    expect(res.framed.error ?? null).toBeNull();
    expect(res.framedPlan.blocks.length).toBe(res.plan.blocks.length);

    expect(res.bad.error).toMatch(/colors/);
    expect(res.created.error).toBeUndefined();
    expect(res.created.blocks.length).toBeGreaterThanOrEqual(2);
    expect(res.created.blocks.length).toBeLessThanOrEqual(5);
    expect(res.created.swaps.length).toBe(res.created.blocks.length - 1);
    expect(res.created.meanDeltaE).toBeLessThan(20);
    expect(res.plan.instructions).toMatch(/swap to/);

    // Reload: the model reads its photo attachment again and rebuilds the plan.
    await page.reload();
    await page.waitForFunction(() => !!(window as any).partwright?.getLayeredPrintPlan);
    await page.waitForFunction(() => {
      const p = (window as any).partwright.getLayeredPrintPlan();
      return p && !p.error;
    }, null, { timeout: 90_000 });

    // Switching objects (mesh-cache hits) swaps the plan with the geometry:
    // a plain object has none, switching back restores it.
    const sw = await page.evaluate(async () => {
      const pw = (window as any).partwright;
      await pw.createObject('plain');
      await pw.runAndSave('return api.Manifold.cube([10, 10, 10]);', 'plain cube', {});
      const onPlain = pw.getLayeredPrintPlan();
      await pw.changeObject(0);
      const back = pw.getLayeredPrintPlan();
      await pw.changeObject(1);
      const plainAgain = pw.getLayeredPrintPlan();
      await pw.changeObject(0);
      return { onPlain, back, plainAgain, final: pw.getLayeredPrintPlan() };
    });
    expect(sw.onPlain.error).toBeTruthy();
    expect(sw.back.error).toBeUndefined();
    expect(sw.plainAgain.error).toBeTruthy();
    expect(sw.final.error).toBeUndefined();

    const download = page.waitForEvent('download');
    const exp = await page.evaluate(() => (window as any).partwright.exportLayeredPrint3MF({ swapMode: 'ams', printer: 'p1s' }));
    expect(exp.error).toBeUndefined();
    const dl = await download;
    expect(dl.suggestedFilename()).toMatch(/\.3mf$/);
    expect(exp.swaps).toBe(res.framedPlan.blocks.length - 1);

    // Painted (AMS) mode from the same export path: colours reduced to the slot cap.
    const download2 = page.waitForEvent('download');
    const painted = await page.evaluate(() => (window as any).partwright.exportLayeredPrint3MF({ mode: 'painted', slots: 4 }));
    expect(painted.error).toBeUndefined();
    await download2;
    expect(painted.mode).toBe('painted');
    expect(painted.filaments.length).toBeGreaterThan(0);
    expect(painted.filaments.length).toBeLessThanOrEqual(4);
    const bad = await page.evaluate(() => (window as any).partwright.exportLayeredPrint3MF({ mode: 'layer-swap', slots: 4 }));
    expect(bad.error).toMatch(/painted/);
  });

  test('dialog previews the predicted print and opens it in the editor', async ({ page }) => {
    test.setTimeout(180_000);
    await gotoEditor(page);
    const src = await syntheticImage(page);
    await page.evaluate((src) => (window as any).partwright.openLayeredPrintDialog(src), src);

    const dialog = page.getByRole('dialog', { name: 'Layered print from photo' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId('layered-print-status')).toHaveText(/predicted print/, { timeout: 90_000 });
    await expect(dialog.getByTestId('layered-print-preview')).toBeVisible();
    await expect(dialog.getByTestId('layered-print-stack')).toContainText('Start:');
    await dialog.getByLabel('Export as').selectOption('painted');
    await expect(dialog.getByLabel('AMS slots')).toBeVisible();
    await page.screenshot({ path: 'test-results/layered-print-dialog.png' });

    await dialog.getByRole('button', { name: 'Open in editor' }).click();
    await expect(dialog).toBeHidden({ timeout: 90_000 });
    const plan = await page.evaluate(() => (window as any).partwright.getLayeredPrintPlan());
    expect(plan.error).toBeUndefined();
    await page.evaluate(() => (window as any).partwright.setCodeView('full'));
    await page.waitForTimeout(1500);
    await page.screenshot({ path: 'test-results/layered-print-session.png' });
  });
});
