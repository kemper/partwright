// The setReferenceGeometry ghost reaches the agent's eyes: renderView /
// renderViews draw it (depth-tested, so a part poking through the model shows)
// unless `reference: false`, and renderSection outlines it.

import { test, expect, type Page } from 'playwright/test';
import { openSharedEditor } from './helpers/sharedPage';

let page: Page;
test.beforeAll(async ({ browser }, testInfo) => {
  page = await openSharedEditor(browser, testInfo);
});
test.afterAll(async () => {
  await page?.context().close();
});

const MASK = [
  'const { Manifold } = api;',
  'const head = Manifold.sphere(20, 48).scale([0.8, 0.9, 1.1]);',
  'return api.shell(head.scale(1.08), { thickness: 1.5 }).subtract(Manifold.cube([100, 100, 100], true).translate([0, 45, 0]));',
].join('\n');
// A head with a nose that pokes out through the front of the mask.
const HEAD = 'return api.Manifold.sphere(20, 48).scale([0.8, 0.9, 1.1]).add(api.Manifold.sphere(4, 24).translate([0, -18, 0]));';

/** Pixels of the ghost's blue (0x0066ff) in a rendered data URL. */
async function bluePixels(p: Page, dataUrl: string): Promise<number> {
  return p.evaluate(async (url) => {
    const img = new Image();
    img.src = url;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i + 2] > d[i] + 60 && d[i + 2] > d[i + 1] + 20) n++;
    return n;
  }, dataUrl);
}

test.describe('reference geometry in renders', () => {
  test('renderView/renderViews draw the ghost by default and hide it on request', async () => {
    const out = await page.evaluate(async ([mask, head]) => {
      const pw = (window as unknown as { partwright: Record<string, (...a: unknown[]) => unknown> }).partwright;
      await pw.createSession('reference-renders');
      await pw.run(mask);
      const plain = pw.renderView({ elevation: 10, azimuth: 0, size: 200 }) as string;
      const set = await pw.setReferenceGeometry(head, { color: 0x0066ff, opacity: 0.4 }) as { success: boolean };
      const withRef = pw.renderView({ elevation: 10, azimuth: 0, size: 200 }) as string;
      const hidden = pw.renderView({ elevation: 10, azimuth: 0, size: 200, reference: false }) as string;
      const views = await pw.renderViews({ angles: [{ elevation: 10, azimuth: 0 }], size: 200 }) as string;
      const bad = pw.renderView({ reference: 'yes' }) as { error?: string };
      pw.clearReferenceGeometry();
      const cleared = pw.renderView({ elevation: 10, azimuth: 0, size: 200 }) as string;
      return { plain, set, withRef, hidden, views, bad, cleared };
    }, [MASK, HEAD]);

    expect(out.set.success).toBe(true);
    expect(await bluePixels(page, out.plain)).toBe(0);
    // The nose pokes through the front of the mask: visible from the front.
    expect(await bluePixels(page, out.withRef)).toBeGreaterThan(200);
    expect(await bluePixels(page, out.views)).toBeGreaterThan(200);
    expect(await bluePixels(page, out.hidden)).toBe(0);
    expect(await bluePixels(page, out.cleared)).toBe(0);
    expect(out.bad.error).toMatch(/reference/);
  });
});

test.describe('annotated sections', () => {
  test('each cut reads like its view, is captioned, and outlines the reference', async () => {
    const out = await page.evaluate(async ([head]) => {
      const pw = (window as unknown as { partwright: Record<string, (...a: unknown[]) => unknown> }).partwright;
      await pw.createSession('annotated-sections');
      // An L: a 10×6×20 post (x 0..10, y 0..6, z 0..20) with an arm reaching
      // to x = 30 at the top — asymmetric on every axis.
      await pw.run('const { Manifold } = api;\nreturn Manifold.cube([10, 6, 20]).add(Manifold.cube([30, 6, 4]).translate([0, 0, 16]));');
      const y = pw.renderSection({ axis: 'y', offset: 3 });
      const x = pw.renderSection({ axis: 'x', offset: 5 });
      const z = pw.renderSection({ axis: 'z', offset: 18 });
      await pw.setReferenceGeometry(head);
      const withRef = pw.renderSection({ axis: 'y', offset: 3 });
      const noRef = pw.renderSection({ axis: 'y', offset: 3, reference: false });
      pw.clearReferenceGeometry();
      return { y, x, z, withRef, noRef };
    }, ['return api.Manifold.cube([40, 2, 30]).translate([-5, 2, -5]);']);
    type S = { view: { right: string; up: string }; boundingBox: { min: number[]; max: number[] }; svg: string; area: number; referenceContours?: number };
    const y = out.y as S, x = out.x as S, z = out.z as S;

    // y cut, seen from the front: +X right, +Z up — the arm points right and sits at the top.
    expect(y.view).toMatchObject({ right: '+X', up: '+Z' });
    expect(y.boundingBox.min[0]).toBeCloseTo(0, 3);
    expect(y.boundingBox.max[0]).toBeCloseTo(30, 3);
    expect(y.boundingBox.min[1]).toBeCloseTo(0, 3);
    expect(y.boundingBox.max[1]).toBeCloseTo(20, 3);
    // x cut, seen from the right: +Y right, +Z up.
    expect(x.view).toMatchObject({ right: '+Y', up: '+Z' });
    expect(x.boundingBox.min).toEqual([expect.closeTo(0, 3), expect.closeTo(0, 3)]);
    expect(x.boundingBox.max).toEqual([expect.closeTo(6, 3), expect.closeTo(20, 3)]);
    // z cut, from above: +X right, +Y up.
    expect(z.view).toMatchObject({ right: '+X', up: '+Y' });
    expect(z.boundingBox.max).toEqual([expect.closeTo(30, 3), expect.closeTo(6, 3)]);
    expect(z.area).toBeCloseTo(180, 1);

    // Caption, axis labels and a scale bar are in the image.
    expect(y.svg).toContain('y = 3 · seen from −Y (front)');
    expect(y.svg).toContain('>+X<');
    expect(y.svg).toContain('>+Z<');
    expect(y.svg).toContain('30 × 20');

    const withRef = out.withRef as S, noRef = out.noRef as S;
    expect(withRef.referenceContours).toBeGreaterThan(0);
    expect(withRef.svg).toContain('stroke-dasharray');
    expect(noRef.referenceContours).toBeUndefined();
    expect(noRef.svg).not.toContain('stroke-dasharray');
  });
});
