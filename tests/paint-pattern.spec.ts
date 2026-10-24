// paintPattern (console twin of api.paint.pattern) — the soccer-ball pattern
// scoped to a part with smooth (sub-triangle) seams: refines only the part,
// never paints outside it, and rebuilds identically from its descriptor on a
// version reload. Plus the Paint panel's "Soccer ball" button.

import { test, expect, type Page } from 'playwright/test';

// A labelled ball fused with a labelled box that cuts into it — the box sits
// inside several pentagon cones, so an unscoped clip would split it.
const CODE = `
  const { Manifold } = api;
  const ball = api.label(Manifold.sphere(10, 48), 'ball');
  const box = api.label(Manifold.cube([12, 12, 12]).translate([6, -6, -6]), 'box');
  return ball.add(box);
`;

async function open(page: Page): Promise<void> {
  await page.addInitScript(() => localStorage.setItem('partwright-tour-completed', '1'));
  await page.goto('/editor');
  await page.waitForSelector('text=Ready', { timeout: 60_000 });
}

test.describe('paintPattern', () => {
  test.setTimeout(180_000);

  test('soccer + withinPart + smooth refines only the part and survives a version reload', async ({ page }) => {
    await open(page);
    const out = await page.evaluate(async (code) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      const { getRegions } = await import('/src/color/regions.ts');
      await pw.createSession('soccer-pattern');
      await pw.run(code);
      const baseTri = pw.getMesh().numTri;
      const boxLabel = pw.listLabels().labels.find((l: { name: string }) => l.name === 'box').triangleCount;

      const bad = pw.paintPattern({ pattern: 'spots', colors: ['#ffffff', '#111111'], withinPart: 'ball', smooth: true });
      const unknownKey = pw.paintPattern({ pattern: 'soccer', colors: ['#ffffff', '#111111'], withinPart: 'ball', wat: 1 });
      const noPart = pw.paintPattern({ pattern: 'soccer', colors: ['#ffffff', '#111111'], withinPart: 'nope' });

      pw.paintByLabel({ label: 'box', color: [1, 0, 0] });
      const res = pw.paintPattern({ pattern: 'soccer', withinPart: 'ball', colors: ['#ffffff', '#111111'], smooth: true });

      const snapshot = () => {
        const regions = getRegions();
        const box = regions.find((r) => r.descriptor.kind === 'byLabel')!;
        const pat = regions.find((r) => r.descriptor.kind === 'pattern')!;
        let overlap = 0;
        for (const t of pat.triangles) if (box.triangles.has(t)) overlap++;
        let dark = 0;
        for (const c of pat.perTriColors?.values() ?? []) if (c[0] < 0.2) dark++;
        return { meshTri: pw.getMesh().numTri, boxTri: box.triangles.size, patTri: pat.triangles.size, dark, overlap };
      };
      const live = snapshot();

      const sv = await pw.runAndSave(pw.getCode(), 'soccer-v');
      await pw.run('return api.Manifold.cube([1, 1, 1]);');
      await pw.loadVersion({ index: sv.version.index });
      const reloaded = snapshot();
      const descriptor = getRegions().find((r) => r.descriptor.kind === 'pattern')!.descriptor;
      return { baseTri, boxLabel, bad, unknownKey, noPart, res, live, reloaded, descriptor };
    }, CODE);

    expect(out.bad.error).toMatch(/soccer \/ stripes \/ checker/);
    expect(out.unknownKey.error).toMatch(/wat is not a recognized field/);
    expect(out.noPart.error).toMatch(/no part "nope"/);

    expect(out.res.error).toBeUndefined();
    expect(out.res.smooth).toBe(true);
    expect(out.res.sphere.radius).toBeGreaterThan(9.5);
    expect(out.res.sphere.radius).toBeLessThan(10.5);
    expect(out.res.meshTriangles).toBeGreaterThan(out.baseTri);   // the seams were refined + clipped
    expect(out.res.markTriangles).toBeGreaterThan(0);

    // Scoped: the box part kept its exact triangles (never split), and no
    // pattern triangle lies on the box.
    expect(out.live.boxTri).toBe(out.boxLabel);
    expect(out.live.overlap).toBe(0);
    expect(out.live.patTri).toBeGreaterThan(0);

    // Persisted as a small descriptor (no mesh, no per-triangle data) …
    expect(out.descriptor).toMatchObject({ kind: 'pattern', pattern: 'soccer', withinPart: 'ball', smooth: true });
    expect(JSON.stringify(out.descriptor).length).toBeLessThan(400);
    // … and rebuilt identically on load.
    expect(out.reloaded).toEqual(out.live);
  });

  test('the Paint panel Soccer ball button paints the chosen part', async ({ page }) => {
    await open(page);
    await page.evaluate(async (code) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (window as any).partwright.run(code);
    }, CODE);
    await page.locator('#paint-toggle').dispatchEvent('click');
    await page.waitForSelector('#paint-picker-panel:not(.hidden)');
    const btn = page.locator('#paint-pattern-soccer');
    await expect(btn).toBeDisabled();
    await expect(page.locator('#paint-pattern-hint')).toBeVisible();
    await page.getByLabel('Paint within part').selectOption('ball');
    await expect(btn).toBeEnabled();
    await btn.click();
    const r = await page.evaluate(async () => {
      const { getRegions } = await import('/src/color/regions.ts');
      const pat = getRegions().find((x) => x.descriptor.kind === 'pattern');
      return pat ? { withinPart: pat.descriptor.withinPart, smooth: (pat.descriptor as { smooth?: boolean }).smooth, tris: pat.triangles.size } : null;
    });
    expect(r).toMatchObject({ withinPart: 'ball', smooth: true });
    expect(r!.tris).toBeGreaterThan(0);
  });
});
