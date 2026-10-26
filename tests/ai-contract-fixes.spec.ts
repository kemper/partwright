// Contract fixes from the #1134 sweep: AI paint `scope` reaches withinPart,
// renderView/probePixel agree on the default camera, opening a session loads
// its own paint (not the previous session's), and a share link from a
// multi-object session carries only the current object.

import { test, expect, type Page } from 'playwright/test';
import { openSharedEditor } from './helpers/sharedPage';

let page: Page;
test.beforeAll(async ({ browser }, testInfo) => {
  page = await openSharedEditor(browser, testInfo);
});
test.afterAll(async () => {
  await page?.context().close();
});

/** Run an in-app AI tool exactly as the chat loop does. */
async function tool(name: string, input: Record<string, unknown>) {
  return page.evaluate(async ({ name, input }) => {
    const tools = await import('/src/ai/tools.ts');
    return tools.executeTool(name, input);
  }, { name, input });
}

const TWO_PART_CODE = `const { Manifold } = api;
const base = api.label(Manifold.cube([20, 20, 10]).refine(2), 'base');
const top = api.label(Manifold.cube([20, 20, 10]).refine(2).translate([0, 0, 10]), 'top');
return base.add(top);`;

test.describe('AI contract fixes (#1134)', () => {
  test('legacy scope:{label} on a paint tool clips like withinPart; schema no longer offers it', async () => {
    await page.evaluate(async (code) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      pw.clearColors();
      await pw.run(code);
    }, TWO_PART_CODE);
    const out = await tool('paintSlab', { axis: 'z', offset: 0, thickness: 40, color: [1, 0, 0], name: 'band', scope: { label: 'top' } });
    expect(out.isError).toBe(false);
    const band = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      return pw.listRegions().find((r: { name: string }) => r.name === 'band');
    });
    // A 40-thick slab covers the whole model; the scope keeps it on `top`.
    expect(band.bbox.min[2]).toBeGreaterThanOrEqual(9.999);

    const clash = await tool('paintSlab', { axis: 'z', offset: 0, thickness: 40, color: [1, 0, 0], scope: { label: 'top' }, withinPart: 'base' });
    expect(clash.isError).toBe(true);

    const hasScope = await page.evaluate(async () => {
      const tools = await import('/src/ai/tools.ts');
      const settings = await import('/src/ai/settings.ts');
      const list = tools.buildToolList(settings.loadSettings().toggles);
      return list.filter(t => /^paint/.test(t.name) && t.name !== 'paintPattern' && 'scope' in (t.input_schema.properties ?? {})).map(t => t.name);
    });
    expect(hasScope).toEqual([]);
  });

  test('paintComponent honours withinPart', async () => {
    const r = await page.evaluate(async (code) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      pw.clearColors();
      await pw.run(code);
      return pw.paintComponent({ index: 0, color: [0, 0, 1], name: 'comp', withinPart: 'top' });
    }, TWO_PART_CODE);
    expect(r.error).toBeUndefined();
    const bbox = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      return pw.listRegions().find((x: { name: string }) => x.name === 'comp').bbox;
    });
    expect(bbox.min[2]).toBeGreaterThanOrEqual(9.999);
  });

  test('renderView labels the real default camera, and probePixel defaults to the same size', async () => {
    await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      pw.clearColors();
      await pw.run('return api.Manifold.cube([20, 20, 20], true);');
    });
    const budget = await page.evaluate(async () => (await import('/src/ai/settings.ts')).getRenderBudget().defaultPx);
    const out = await tool('renderView', {});
    expect(out.isError).toBe(false);
    expect(out.content).toContain('az=315°');
    expect(out.content).toContain(`${budget}px`);

    // A pixel near the image corner region the cube covers only at the right
    // scale: an omitted size must probe the same camera as an explicit one.
    const r = await page.evaluate((size) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      const px = [Math.round(size * 0.42), Math.round(size * 0.58)];
      const implicit = pw.probePixel({ pixel: px, view: {} });
      const explicit = pw.probePixel({ pixel: px, view: { size, azimuth: 315, elevation: 30 } });
      return { implicit: implicit?.triangleId ?? null, explicit: explicit?.triangleId ?? null };
    }, budget);
    expect(r.explicit).not.toBeNull();
    expect(r.implicit).toBe(r.explicit);
  });

  test("openSession loads the opened session's paint, not the previous session's", async () => {
    const r = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      const a = await pw.createSession('leak-A');
      pw.clearColors();
      await pw.runAndSave('return api.Manifold.cube([10, 10, 10]);', 'a1');
      pw.paintInBox({ box: { min: [-1, -1, 9], max: [11, 11, 11] }, color: [1, 0, 0], name: 'A-top' });
      await pw.saveVersion('a-painted');
      const b = await pw.createSession('leak-B');
      pw.clearColors();
      await pw.runAndSave('return api.Manifold.cube([10, 10, 10]);', 'b1');
      await pw.openSession(a.id);
      const inA = pw.listRegions().map((x: { name: string }) => x.name);
      await pw.openSession(b.id);
      const inB = pw.listRegions().map((x: { name: string }) => x.name);
      return { inA, inB };
    });
    expect(r.inA).toEqual(['A-top']);
    expect(r.inB).toEqual([]);
  });

  test('a share link from a multi-object session carries only the current object', async () => {
    const r = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      await pw.createSession('share-multi');
      await pw.runAndSave('return api.Manifold.cube([5, 5, 5]);', 'first-1');
      await pw.runAndSave('return api.Manifold.cube([6, 6, 6]);', 'first-2');
      await pw.createObject('second');
      await pw.runAndSave('return api.Manifold.sphere(4, 24);', 'second-1');
      const link = await pw.getShareLink();
      if ('error' in link) return { error: link.error };
      const mod = await import('/src/share/shareLink.ts');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const payload = await mod.decodeShare(link.url.split('#share=')[1]) as any;
      return { parts: payload.parts, versions: payload.versions.map((v: { code: string; part?: number }) => ({ code: v.code, part: v.part })) };
    });
    expect(r.error).toBeUndefined();
    expect(r.parts).toHaveLength(1);
    expect(r.parts[0].name).toBe('second');
    expect(r.versions).toHaveLength(1);
    expect(r.versions[0].code).toContain('sphere');
    expect(r.versions[0].part).toBeUndefined();
  });
});
