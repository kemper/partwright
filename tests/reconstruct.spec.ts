import { test, expect, type Page } from 'playwright/test';

// Prototype: multi-view silhouette carving (visual hull) reconstruction.
// Exercises both partwright entry points end-to-end in a real browser:
//   - reconstructFromCurrentModel: render the live model's own silhouettes and
//     carve them back (the zero-API self-test playground).
//   - reconstructFromSilhouettes: carve from supplied silhouette images (the
//     real "Gemini turntable" workflow), using canvas-drawn discs as stand-ins.

async function waitForEngine(page: Page) {
  await page.goto('/editor');
  await page.waitForFunction(
    () => !!(window as unknown as { partwright?: { run?: unknown } }).partwright?.run,
    undefined,
    { timeout: 30_000 },
  );
}

test.describe('multi-view silhouette reconstruction', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('partwright-tour-completed', '1'));
  });

  test('reconstructs the current model from its own rendered silhouettes', async ({ page }) => {
    await waitForEngine(page);
    const result = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      await pw.createSession('recon-self');
      // A sphere: its visual hull from a turntable should come back ~spherical.
      await pw.runAndSave(`const { Manifold } = api; return Manifold.sphere(20, 48);`, 'v1');
      return pw.reconstructFromCurrentModel({ azimuthCount: 8, resolution: 48, smooth: 0 });
    });
    expect(result.error).toBeUndefined();
    expect(result.views).toBe(10);              // 8 azimuths + 2 poles
    expect(result.voxelCount).toBeGreaterThan(1000);
    expect(typeof result.sessionId).toBe('string');
  });

  test('carves a visual hull from supplied silhouette images', async ({ page }) => {
    await waitForEngine(page);
    const result = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;

      // Draw a filled black disc on a white background → a silhouette image.
      const disc = (size: number, radiusFrac: number): string => {
        const c = document.createElement('canvas');
        c.width = c.height = size;
        const ctx = c.getContext('2d')!;
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, size, size);
        ctx.fillStyle = 'black';
        ctx.beginPath();
        ctx.arc(size / 2, size / 2, (size / 2) * radiusFrac, 0, Math.PI * 2);
        ctx.fill();
        return c.toDataURL('image/png');
      };

      await pw.createSession('recon-supplied');
      return pw.reconstructFromSilhouettes({
        views: [
          { src: disc(96, 0.8), azimuth: 0, elevation: 0 },
          { src: disc(96, 0.8), azimuth: 90, elevation: 0 },
          { src: disc(96, 0.8), azimuth: 180, elevation: 0 },
          { src: disc(96, 0.8), azimuth: 270, elevation: 0 },
          { src: disc(96, 0.8), azimuth: 0, elevation: 80 },
        ],
        options: { resolution: 48, smooth: 0, frameFill: 0.8 },
      });
    });
    expect(result.error).toBeUndefined();
    expect(result.views).toBe(5);
    expect(result.voxelCount).toBeGreaterThan(500);
  });

  test('rejects an empty silhouette instead of carving everything away', async ({ page }) => {
    await waitForEngine(page);
    const result = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      // A blank white image → empty silhouette.
      const c = document.createElement('canvas');
      c.width = c.height = 32;
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = 'white';
      ctx.fillRect(0, 0, 32, 32);
      const blank = c.toDataURL('image/png');
      await pw.createSession('recon-empty');
      return pw.reconstructFromSilhouettes({ views: [{ src: blank, azimuth: 0, elevation: 0 }] });
    });
    expect(result.error).toMatch(/empty silhouette|carved away everything/);
  });
});
