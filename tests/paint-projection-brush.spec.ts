// Projection (screen-space) paintbrush — "paint exactly what I see".
//
// With edge smoothing OFF, the regular brush footprint is the set of triangles
// *visible* under the brush disk, found by rendering an offscreen triangle-id
// buffer and reading back the pixels under the cursor (src/color/projectionPaint
// .ts). This replaces the old 3D-ball centroid scan. The committed region stores
// base-mesh triangle ids, so it stays put when a later smooth stroke refines the
// mesh (no horizontal-band smear).
//
// Covers: a non-smooth brush drag paints visible triangles without subdividing
// the mesh, the colour renders, and a regular region stays spatially localized
// after a subsequent smooth stroke refines the mesh under a different spot.

import { test, expect } from 'playwright/test';

async function openSlabEditor(page: import('playwright/test').Page) {
  await page.goto('/editor');
  await page.waitForSelector('text=Ready', { timeout: 15000 });
  await page.evaluate(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pw = (window as any).partwright;
    // A wide flat slab fills the viewport so canvas-dispatched coordinates
    // reliably hit the model after auto-framing.
    await pw.run('const { Manifold } = api; return Manifold.cube([40, 40, 3], true);');
    pw.setBrushSize(4);
    pw.setBrushSmooth(false); // non-smooth → projection footprint path
  });
  await page.locator('#paint-toggle').dispatchEvent('click');
  await page.waitForSelector('#paint-picker-panel:not(.hidden)');
  await page.locator('#paint-picker-panel button:has-text("Brush")').dispatchEvent('click');
  // Let the viewport auto-frame the new mesh so the centre ray hits it.
  await page.waitForTimeout(200);
}

/** Drive a real brush drag across the canvas, offset from centre by (ox, oy). */
async function dragBrush(page: import('playwright/test').Page, ox = 0, oy = 0) {
  await page.evaluate(async ({ ox, oy }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pw = (window as any).partwright;
    const canvas = document.querySelector('canvas')!;
    const r = canvas.getBoundingClientRect();
    const cx = r.left + r.width / 2 + ox, cy = r.top + r.height / 2 + oy;
    const fire = (t: string, x: number, y: number) =>
      canvas.dispatchEvent(new PointerEvent(t, { bubbles: true, clientX: x, clientY: y, button: 0, buttons: 1, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
    fire('pointermove', cx, cy);
    fire('pointerdown', cx, cy);
    for (let dx = 6; dx <= 30; dx += 6) fire('pointermove', cx + dx, cy);
    fire('pointerup', cx + 30, cy);
    await pw.waitForPaint();
  }, { ox, oy });
}

test.describe('projection paintbrush', () => {
  test('a non-smooth brush drag paints visible triangles without subdividing', async ({ page }) => {
    await openSlabEditor(page);

    const out = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return { before: (window as any).partwright.getMesh().numTri };
    });
    await dragBrush(page);
    const result = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      const regions = pw.listRegions();
      return { after: pw.getMesh().numTri, regions };
    });

    // Exactly one region, with real painted triangles — projection found the
    // visible faces under the disk.
    expect(result.regions.length).toBe(1);
    expect(result.regions[0].triangles).toBeGreaterThan(0);
    expect(result.regions[0].source).toBe('paintbrush');
    // Projection paint never subdivides — the mesh is untouched (unlike the
    // smooth brush, which grows the triangle count).
    expect(result.after).toBe(out.before);

    // Capture a screenshot artifact for eyes-on verification (dismiss the
    // first-run tour backdrop first so the painted slab is clearly visible).
    const skip = page.locator('button:has-text("Skip")');
    if (await skip.count()) await skip.first().click().catch(() => {});
    await page.waitForTimeout(150);
    await page.screenshot({ path: 'test-results/projection-brush.png' });

    // The paint renders: a tri-view composite should show the red-dominant patch.
    const dataUrl = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return await (window as any).partwright.renderViews({ views: 'tri', size: 200 });
    });
    const redFrac = await page.evaluate(async (url: string) => {
      const img = await new Promise<HTMLImageElement>((res, rej) => {
        const el = new Image(); el.onload = () => res(el); el.onerror = () => rej(new Error('decode')); el.src = url;
      });
      const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
      const ctx = c.getContext('2d')!; ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(0, 0, img.width, img.height).data;
      let red = 0, total = 0;
      for (let i = 0; i < d.length; i += 4) { total++; if (d[i] > 100 && d[i] - d[i + 1] > 40 && d[i] - d[i + 2] > 40) red++; }
      return red / total;
    }, dataUrl);
    expect(redFrac).toBeGreaterThan(0.005);
  });

  test('regular paint stays localized after a later smooth stroke refines the mesh', async ({ page }) => {
    await openSlabEditor(page);

    // Paint a regular (projection) region near the centre.
    await dragBrush(page, -40, 0);
    const before = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      const reg = pw.listRegions()[0];
      return { id: reg.id, bbox: reg.bbox, tris: reg.triangles, numTri: pw.getMesh().numTri };
    });
    expect(before.bbox).not.toBeNull();
    const bboxSpan = (b: { min: number[]; max: number[] }) =>
      Math.hypot(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]);
    const spanBefore = bboxSpan(before.bbox);

    // Now run a smooth stroke elsewhere that subdivides the mesh — this is the
    // scenario that used to smear refined-space ids of the regular region.
    const refined = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      const r = pw.paintStroke({ points: [[10, 0, 1.5]], radius: 3, maxEdge: 0.3, color: [0.2, 0.4, 0.9] });
      await pw.waitForPaint();
      return { err: r.error, numTri: pw.getMesh().numTri };
    });
    expect(refined.err).toBeFalsy();
    expect(refined.numTri).toBeGreaterThan(before.numTri); // the smooth stroke refined the mesh

    // The regular region must still be a single localized patch — its bbox span
    // should be close to what it was, NOT exploded into bands across the slab.
    const after = await page.evaluate((id: number) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const reg = (window as any).partwright.listRegions().find((r: { id: number }) => r.id === id);
      return reg ? { bbox: reg.bbox, tris: reg.triangles } : null;
    }, before.id);
    expect(after).not.toBeNull();
    const spanAfter = bboxSpan(after!.bbox);
    // A smear would blow the span up toward the 40-unit slab diagonal (~56).
    // Require it to stay within a small multiple of the original footprint.
    expect(spanAfter).toBeLessThan(spanBefore + 6);
  });
});
