// E2E: partwright.photoMatch — the text-only likeness score. Feeding the
// current model's OWN render back in as the "photo" must score a near-perfect
// silhouette match, find every coloured part, and name no big mismatch; a
// deliberately different model must score worse and say where.

import { test, expect, type Page } from 'playwright/test';
import { openSharedEditor } from './helpers/sharedPage';

type Match = {
  error?: string;
  silhouetteIoU: number;
  aspect: { ratio: number };
  bands: { band: number; widthDiffPct: number }[];
  regions: { name: string; iou: number }[];
  worst: string[];
  regionNames: string[];
  overlay?: string;
};
type PW = {
  run: (code: string) => Promise<unknown>;
  renderView: (o: unknown) => string | null;
  photoMatch: (o?: unknown) => Promise<Match>;
};

// A two-colour "figure": a wide blue head on a narrower red body.
const FIGURE = (headR: number) => `const { Manifold } = api;
const body = api.label(Manifold.cube([16, 10, 30], true).translate([0, 0, 15]), 'body', { color: '#d03030' });
const head = api.label(Manifold.sphere(${headR}, 48).translate([0, 0, 30 + ${headR} * 0.8]), 'head', { color: '#2050d0' });
return body.add(head);`;

let page: Page;
test.beforeAll(async ({ browser }, testInfo) => {
  page = await openSharedEditor(browser, testInfo);
});
test.afterAll(async () => {
  await page?.context().close();
});

test.describe('Photo match', () => {
  test('a model scored against its own front render matches ~perfectly', async () => {
    const r = await page.evaluate(async (code) => {
      const pw = (window as unknown as { partwright: PW }).partwright;
      await pw.run(code);
      const photo = pw.renderView({ azimuth: 0, elevation: 0, ortho: true, size: 600, edges: 'none' })!;
      return pw.photoMatch({ image: photo, view: { azimuth: 0, elevation: 0, ortho: true }, overlay: true });
    }, FIGURE(12));
    expect(r.error).toBeUndefined();
    expect(r.silhouetteIoU).toBeGreaterThan(0.95);
    expect(Math.abs(r.aspect.ratio - 1)).toBeLessThan(0.05);
    expect(r.regionNames.sort()).toEqual(['body', 'head']);
    for (const reg of r.regions) expect(reg.iou).toBeGreaterThan(0.85);
    for (const b of r.bands) expect(Math.abs(b.widthDiffPct)).toBeLessThan(10);
    expect(r.overlay?.startsWith('data:image/png')).toBe(true);
  });

  test('a smaller head scores worse and is named in the findings', async () => {
    const r = await page.evaluate(async ({ ref, model }) => {
      const pw = (window as unknown as { partwright: PW }).partwright;
      await pw.run(ref);
      const photo = pw.renderView({ azimuth: 0, elevation: 0, ortho: true, size: 600, edges: 'none' })!;
      await pw.run(model);
      return pw.photoMatch({ image: photo });
    }, { ref: FIGURE(12), model: FIGURE(8) });
    expect(r.silhouetteIoU).toBeLessThan(0.9);
    expect(r.worst.join('\n')).toMatch(/head/);
  });

  test('validates its arguments', async () => {
    const r = await page.evaluate(async () => {
      const pw = (window as unknown as { partwright: PW }).partwright;
      return [
        await pw.photoMatch({ bogus: 1 }),
        await pw.photoMatch({ image: 'not-an-attachment' }),
        await pw.photoMatch({ image: 'data:image/png;base64,AAAA', fit: 'wide' }),
      ];
    });
    for (const x of r) expect(typeof x.error).toBe('string');
  });
});
