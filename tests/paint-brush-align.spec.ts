// Brush alignment (View / Surface / Smoothed), Visible faces only and the Sphere
// volume. The UI brush defaults to View + Visible faces only: the brush stays a
// circle on screen and paints what's under it, never the back of a thin part.

import { test, expect, type Page } from 'playwright/test';

// A thin 40×40 plate, 0.6 thick, with a gridded top so a stroke has triangles
// to pick; its bottom face sits well inside a 4-unit brush's reach.
const THIN_PLATE = `const { Manifold } = api;
return Manifold.cube([40, 40, 0.6], true).refine(8);`;

async function openBrush(page: Page) {
  await page.goto('/editor');
  await page.waitForSelector('text=Ready', { timeout: 15000 });
  await page.evaluate(async (code) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pw = (window as any).partwright;
    await pw.run(code);
    pw.setBrushSize(4);
  }, THIN_PLATE);
  await page.locator('#paint-toggle').dispatchEvent('click');
  await page.waitForSelector('#paint-picker-panel:not(.hidden)');
  await page.locator('#paint-picker-panel button:has-text("Brush")').dispatchEvent('click');
  await page.waitForTimeout(200);
}

/** Centroid z of every triangle in the newest region. */
async function paintedZs(page: Page): Promise<number[]> {
  return page.evaluate(async () => {
    const { getCurrentMesh } = await import('/src/color/paintMode.ts');
    const { getRegions } = await import('/src/color/regions.ts');
    const m = getCurrentMesh()!;
    const regs = getRegions();
    const out: number[] = [];
    for (const t of regs[regs.length - 1]?.triangles ?? []) {
      let z = 0;
      for (let k = 0; k < 3; k++) z += m.vertProperties[m.triVerts[t * 3 + k] * m.numProp + 2];
      out.push(z / 3);
    }
    return out;
  });
}

test.describe('brush alignment', () => {
  test('defaults to View + Visible faces only; the panel shows the alignment row and hides wrap in View mode', async ({ page }) => {
    await openBrush(page);
    const state = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      return { align: pw.getBrushAlign().align, front: pw.getBrushFrontFacesOnly().frontFacesOnly, surface: pw.getBrushSurface().surface };
    });
    expect(state).toEqual({ align: 'view', front: true, surface: 'slab' });
    await expect(page.locator('#brush-align-wrap')).toBeVisible();
    await expect(page.locator('#brush-front-toggle')).toHaveText(/Visible faces only: On/);
    await expect(page.locator('#brush-wrap-wrap')).toBeHidden();

    // Surface alignment brings the wrap tolerance back; Sphere hides alignment.
    await page.locator('#brush-align-wrap button[data-align="surface"]').dispatchEvent('click');
    await expect(page.locator('#brush-wrap-wrap')).toBeVisible();
    expect(await page.evaluate(() => (window as any).partwright.getBrushAlign().align)).toBe('surface');
    await page.locator('#paint-picker-panel button[data-surface="sphere"]').dispatchEvent('click');
    await expect(page.locator('#brush-align-wrap')).toBeHidden();
    await expect(page.locator('#brush-wrap-wrap')).toBeHidden();
  });

  test('a default UI stroke stores the camera and never paints the back of a thin plate', async ({ page }) => {
    await openBrush(page);
    await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      pw.setCamera({ azimuth: 20, elevation: 40, distance: 70, target: [0, 0, 0] });
      await new Promise(r => setTimeout(r, 300));
      const canvas = document.querySelector('#viewport-container canvas')!;
      const r = canvas.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const fire = (t: string, x: number, y: number) =>
        canvas.dispatchEvent(new PointerEvent(t, { bubbles: true, clientX: x, clientY: y, button: 0, buttons: 1, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
      fire('pointermove', cx - 40, cy);
      fire('pointerdown', cx - 40, cy);
      for (let dx = -34; dx <= 40; dx += 6) {
        fire('pointermove', cx + dx, cy);
        await new Promise(res => requestAnimationFrame(() => res(null)));
      }
      fire('pointerup', cx + 40, cy);
      await pw.waitForPaint();
    });
    const desc = await page.evaluate(async () => {
      const { getRegions } = await import('/src/color/regions.ts');
      const d = getRegions()[0].descriptor as { kind: string; align?: string; view?: { dir: number[]; origin?: number[] }; frontFaceMaxDeg?: number; occlude?: boolean };
      return { kind: d.kind, align: d.align, hasView: !!d.view?.dir && !!d.view?.origin, front: d.frontFaceMaxDeg, occlude: d.occlude };
    });
    expect(desc).toEqual({ kind: 'brushStroke', align: 'view', hasView: true, front: 90, occlude: true });
    const zs = await paintedZs(page);
    expect(zs.length).toBeGreaterThan(0);
    expect(zs.some(z => z > 0.25)).toBe(true);   // the top face is painted
    expect(zs.some(z => z < -0.25)).toBe(false); // the bottom face never is
  });

  test('paintStroke / paintAirbrush validate the brush-direction options', async ({ page }) => {
    await openBrush(page);
    const out = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      const base = { points: [[0, 0, 0.3]], radius: 3, color: [0.2, 0.4, 0.9] };
      return {
        badAlign: pw.paintStroke({ ...base, align: 'sideways' }).error,
        strayDir: pw.paintStroke({ ...base, viewDir: [0, 0, -1] }).error,
        zeroDir: pw.paintStroke({ ...base, align: 'view', viewDir: [0, 0, 0] }).error,
        airbrush: pw.paintAirbrush({ ...base, surface: 'sphere', viewDir: [0, 0, -1], frontFacesOnly: true, strength: 1 }),
      };
    });
    expect(out.badAlign).toMatch(/align/);
    expect(out.strayDir).toMatch(/viewDir only applies/);
    expect(out.zeroDir).toMatch(/viewDir/);
    expect(out.airbrush.error).toBeUndefined();
    const zs = await paintedZs(page);
    expect(zs.some(z => z < -0.25)).toBe(false);
  });

  test('paintStroke occlude: a View stroke beside an overhang never paints the surface hidden under it', async ({ page }) => {
    await page.goto('/editor');
    await page.waitForSelector('text=Ready', { timeout: 15000 });
    const out = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      // A plate (top at z = 0.3) with a 4×4 roof floating over its middle at z 3.5–4.5.
      await pw.run(`const { Manifold } = api;
        return Manifold.cube([40, 40, 0.6], true).refine(40)
          .add(Manifold.cube([4, 4, 1], true).refine(8).translate([0, 0, 4]));`);
      const run = async (occlude: boolean) => {
        for (const g of pw.listRegions()) pw.removeRegion(g.id);
        const r = pw.paintStroke({ points: [[3, 0, 0.3]], radius: 4, color: [0.9, 0.2, 0.2], align: 'view', viewDir: [0, 0, -1], frontFacesOnly: true, occlude });
        if (r.error) return { error: r.error as string };
        const { getCurrentMesh } = await import('/src/color/paintMode.ts');
        const { getRegions } = await import('/src/color/regions.ts');
        const m = getCurrentMesh()!;
        let under = 0, visible = 0;
        for (const t of getRegions()[0].triangles) {
          const c = [0, 0, 0];
          for (let k = 0; k < 3; k++) for (let a = 0; a < 3; a++) c[a] += m.vertProperties[m.triVerts[t * 3 + k] * m.numProp + a] / 3;
          if (Math.abs(c[2] - 0.3) < 0.05) {
            if (Math.abs(c[0]) < 1.6 && Math.abs(c[1]) < 1.6) under++;
            else if (c[0] > 2.5) visible++;
          }
        }
        return { under, visible };
      };
      return { off: await run(false), on: await run(true) };
    });
    expect(out.off).toMatchObject({ under: expect.any(Number) });
    expect((out.off as { under: number }).under).toBeGreaterThan(0);   // without occlusion it paints under the roof
    expect(out.on).toEqual({ under: 0, visible: expect.any(Number) });
    expect((out.on as { visible: number }).visible).toBeGreaterThan(0); // the visible plate is still painted
  });

  test('paintStroke: a sphere reaches through a thin plate unless frontFacesOnly', async ({ page }) => {
    await openBrush(page);
    const run = (front: boolean) => page.evaluate(async (front) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      for (const g of pw.listRegions()) pw.removeRegion(g.id);
      const r = pw.paintStroke({ points: [[0, 0, 0.3]], radius: 3, color: [0.9, 0.2, 0.2], surface: 'sphere', ...(front ? { viewDir: [0, 0, -1], frontFacesOnly: true } : {}) });
      return r.error ?? null;
    }, front);
    expect(await run(false)).toBeNull();
    expect((await paintedZs(page)).some(z => z < -0.25)).toBe(true);
    expect(await run(true)).toBeNull();
    const zs = await paintedZs(page);
    expect(zs.some(z => z > 0.25)).toBe(true);
    expect(zs.some(z => z < -0.25)).toBe(false);
  });
});
