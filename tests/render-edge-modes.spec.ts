// Pins the renderView/renderViews `edges` option and the new default for
// uncolored meshes:
//
//   - 'none'      draws no edge overlay (cleanest read of form).
//   - 'crease'    draws only feature edges (corners, rims) — far less ink
//                 than a full wireframe.
//   - 'wireframe' draws every triangle edge (most ink).
//   - default (uncolored) == 'crease', NOT the old full wireframe.
//
// We compare mean image brightness: more edge ink => lower brightness. The
// ordering none > crease > wireframe is robust to antialiasing, and the
// default tracking 'crease' (and clearly differing from 'wireframe') is the
// behavioral guard for the change.

import { test, expect } from 'playwright/test';

async function meanBrightness(page: import('playwright/test').Page, dataUrl: string): Promise<number> {
  return page.evaluate(async (url: string) => {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('decode'));
      el.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, img.width, img.height).data;
    let sum = 0;
    for (let i = 0; i < data.length; i += 4) {
      sum += (data[i] + data[i + 1] + data[i + 2]) / 3 / 255;
    }
    return sum / (data.length / 4);
  }, dataUrl);
}

test.describe('render edge modes', () => {
  test('uncolored renders default to crease edges, not the full wireframe', async ({ page }) => {
    await page.goto('/editor');
    await page.waitForSelector('text=Ready', { timeout: 15000 });

    // A cube fused with a many-segment cylinder: the cube contributes hard
    // 90° corners (crease edges), the cylinder a curved surface whose facet
    // edges only the full wireframe should draw.
    const urls = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      await pw.run('return api.Manifold.cube([20,20,20], true).add(api.Manifold.cylinder(34, 7, 7, 96, true));');
      const view = { elevation: 30, azimuth: 35, ortho: false, size: 320 } as const;
      return {
        none: pw.renderView({ ...view, edges: 'none' }),
        crease: pw.renderView({ ...view, edges: 'crease' }),
        wireframe: pw.renderView({ ...view, edges: 'wireframe' }),
        def: pw.renderView({ ...view }), // no edges arg → default
      };
    });
    for (const u of Object.values(urls)) expect(typeof u).toBe('string');

    const none = await meanBrightness(page, urls.none);
    const crease = await meanBrightness(page, urls.crease);
    const wire = await meanBrightness(page, urls.wireframe);
    const def = await meanBrightness(page, urls.def);

    const ctx = `none=${none.toFixed(4)} crease=${crease.toFixed(4)} wireframe=${wire.toFixed(4)} default=${def.toFixed(4)}`;

    // More edge ink = darker image: none (cleanest) > crease > wireframe.
    expect(crease, `crease should add edge ink vs none — ${ctx}`).toBeLessThan(none);
    expect(wire, `wireframe should add more ink than crease — ${ctx}`).toBeLessThan(crease);

    // The whole point of the change: the default uncolored render is crease,
    // NOT the full wireframe. Default tracks crease almost exactly, and is far
    // closer to crease than to the (denser) full wireframe.
    expect(Math.abs(def - crease), `default should match crease — ${ctx}`).toBeLessThan(0.002);
    expect(
      Math.abs(def - crease),
      `default must track crease, not the full wireframe — ${ctx}`,
    ).toBeLessThan(Math.abs(def - wire));
  });

  test('painted meshes keep a clean (no-overlay) default', async ({ page }) => {
    await page.goto('/editor');
    await page.waitForSelector('text=Ready', { timeout: 15000 });

    // Paint the cube, then the default render must have no overlay; forcing
    // wireframe must visibly add ink even over paint.
    const urls = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      await pw.run('return api.Manifold.cube([20,20,20], true).add(api.Manifold.cylinder(34, 7, 7, 96, true));');
      pw.paintInBox({ box: { min: [-12, -12, 9], max: [12, 12, 18] }, color: [1, 0, 0] });
      const view = { elevation: 30, azimuth: 35, ortho: false, size: 320 } as const;
      return {
        def: pw.renderView({ ...view }),           // painted default → none
        none: pw.renderView({ ...view, edges: 'none' }),
        wireframe: pw.renderView({ ...view, edges: 'wireframe' }),
      };
    });
    for (const u of Object.values(urls)) expect(typeof u).toBe('string');

    const def = await meanBrightness(page, urls.def);
    const none = await meanBrightness(page, urls.none);
    const wire = await meanBrightness(page, urls.wireframe);
    const ctx = `default=${def.toFixed(4)} none=${none.toFixed(4)} wireframe=${wire.toFixed(4)}`;

    // Painted default == none (no overlay added over the paint).
    expect(Math.abs(def - none), `painted default should add no overlay — ${ctx}`).toBeLessThan(0.002);
    // Explicit wireframe still works on a painted mesh (the cylinder facets
    // add clearly visible ink over the shaded/painted surface).
    expect(wire, `explicit wireframe should still draw over paint — ${ctx}`).toBeLessThan(none - 0.005);
  });

  test('renderViews rejects an unknown edges value', async ({ page }) => {
    await page.goto('/editor');
    await page.waitForSelector('text=Ready', { timeout: 15000 });

    const result = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      await pw.run('return api.Manifold.cube([10,10,10], true);');
      try {
        await pw.renderViews({ edges: 'sketch' });
        return { threw: false, msg: '' };
      } catch (e) {
        return { threw: true, msg: e instanceof Error ? e.message : String(e) };
      }
    });
    expect(result.threw).toBe(true);
    expect(result.msg).toContain('edges');
  });
});
