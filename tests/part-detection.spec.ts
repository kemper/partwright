// Part detection (#1025) golden path: import a fused mesh, detect two parts
// from named seeds, check the numbered render + overlay, edit, accept, and
// confirm the parts are real labels on the import that survive a reload.

import { test, expect, type Page } from 'playwright/test';

type PW = Record<string, (...args: unknown[]) => Promise<Record<string, unknown>> | Record<string, unknown>>;

/** Build a fused "step" solid in-app (a cube with a smaller cube unioned on
 *  top — a concave crease runs around the junction), export its STL bytes and
 *  re-import them so the session holds a plain imported mesh with no labels. */
async function importSteppedBlock(page: Page): Promise<void> {
  await page.waitForFunction(() => !!(window as unknown as { partwright?: PW }).partwright);
  const ok = await page.evaluate(async () => {
    const pw = (window as unknown as { partwright: PW }).partwright;
    await pw.runAndSave(`const { Manifold } = api;
return Manifold.cube([20, 20, 10]).add(Manifold.cube([10, 10, 10]).translate([5, 5, 10])).refine(4);`, 'block');
    const stl = await pw.exportSTLData() as { base64: string };
    const r = await pw.importMeshData(stl.base64, 'block.stl') as { isManifold?: boolean; error?: string };
    return r;
  });
  expect(ok.error).toBeUndefined();
  await page.waitForFunction(() => /api\.imports\[0\]/.test(String((window as unknown as { partwright: PW }).partwright.getCode())));
  await page.waitForSelector('text=Ready', { timeout: 30_000 });
}

test.describe('Part detection', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('partwright-tour-completed', '1'));
  });

  test('detect → render → edit → accept turns parts into labels', async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto('/editor');
    await page.waitForSelector('text=Ready', { timeout: 30_000 });
    await importSteppedBlock(page);

    const det = await page.evaluate(async () => {
      const pw = (window as unknown as { partwright: PW }).partwright;
      return pw.detectParts({
        algorithm: 'crease-watershed',
        seeds: [{ label: 'base', point: [10, 10, 0] }, { label: 'top', point: [10, 10, 20] }],
      });
    }) as { parts?: { name: string; triCount: number }[]; quality?: { partCount: number; boundaryCreaseMean: number }; error?: string };
    expect(det.error).toBeUndefined();
    expect(det.parts!.map((p) => p.name)).toEqual(['base', 'top']);
    // The boundary must sit on the 90° junction crease.
    expect(det.quality!.boundaryCreaseMean).toBeGreaterThan(45);

    const render = await page.evaluate(() => (window as unknown as { partwright: PW }).partwright.renderParts({ views: ['front', 'iso'], size: 256 })) as { image?: string; legend?: { id: number; visibleIn: string[] }[] };
    expect(render.image).toMatch(/^data:image\/png;base64,/);
    expect(render.legend!.every((l) => l.visibleIn.length > 0)).toBe(true);

    const edited = await page.evaluate(() => (window as unknown as { partwright: PW }).partwright.editParts({ ops: [
      { op: 'rename', id: 2, name: 'cap' },
      { op: 'setColor', id: 'cap', color: '#3b82f6' },
    ] })) as { parts: { name: string; color: string | null }[] };
    expect(edited.parts.map((p) => [p.name, p.color])).toEqual([['base', null], ['cap', '#3b82f6']]);

    // Bad input returns { error } rather than throwing — unknown ops, bad
    // shapes, and a duplicate name (names become labels, so must be unique).
    const bad = await page.evaluate(async () => {
      const pw = (window as unknown as { partwright: PW }).partwright;
      return [
        await pw.editParts({ ops: [{ op: 'explode' }] }),
        await pw.editParts({ ops: [{ op: 'reassign', point: [1, 2], to: 'cap' }] }),
        await pw.editParts({ ops: [{ op: 'rename', id: 1, name: 'cap' }] }),
      ];
    }) as { error?: string }[];
    expect(bad[0].error).toMatch(/op/);
    expect(bad[1].error).toMatch(/point/);
    expect(bad[2].error).toMatch(/already named/);

    // The panel reflects the same draft.
    await page.evaluate(() => document.getElementById('parts-viewport-toggle')?.click());
    await expect(page.getByRole('dialog', { name: 'Detect parts' })).toBeVisible();
    await expect(page.getByLabel('Name of part 2')).toHaveValue('cap');

    const acc = await page.evaluate(() => (window as unknown as { partwright: PW }).partwright.acceptParts()) as { ok?: boolean; labels?: string[]; error?: string };
    expect(acc.error).toBeUndefined();
    expect(acc.labels).toEqual(expect.arrayContaining(['base', 'cap']));
    const code = await page.evaluate(() => String((window as unknown as { partwright: PW }).partwright.getCode()));
    expect(code).toContain('api.importWithParts(0)');

    const parts = await page.evaluate(() => (window as unknown as { partwright: PW }).partwright.listObjectParts()) as { parts: { name: string; color?: string }[] };
    expect(parts.parts.find((p) => p.name === 'cap')?.color).toBe('#3b82f6');

    // Persisted on the import: survives a reload.
    await page.reload();
    await page.waitForSelector('text=Ready', { timeout: 30_000 });
    await page.waitForFunction(() => {
      const r = (window as unknown as { partwright: PW }).partwright.listObjectParts() as { parts?: { name: string }[] };
      return (r.parts ?? []).some((p) => p.name === 'cap');
    }, undefined, { timeout: 30_000 });
  });

  test('auto patches, presets, lock, smooth accept and reopen', async ({ page }) => {
    test.setTimeout(180_000);
    await page.goto('/editor');
    await page.waitForSelector('text=Ready', { timeout: 30_000 });
    await importSteppedBlock(page);

    // Seedless auto patches: generic names, at least the two crease-split faces.
    const auto = await page.evaluate(() => (window as unknown as { partwright: PW }).partwright.detectParts({ algorithm: 'auto-merge', params: { mergeBelowDeg: 30 } })) as { parts?: { name: string; triCount: number }[]; edgeSmoothing?: number; error?: string };
    expect(auto.error).toBeUndefined();
    expect(auto.parts!.length).toBeGreaterThanOrEqual(2);
    expect(auto.parts!.every((p) => /^patch \d+$/.test(p.name))).toBe(true);
    expect(auto.edgeSmoothing).toBe(3);

    // Presets run without touching the draft, ranked best-first.
    const pre = await page.evaluate(() => (window as unknown as { partwright: PW }).partwright.previewPartPresets({ algorithm: 'auto-merge', image: false })) as { presets?: { score: number }[]; error?: string };
    expect(pre.error).toBeUndefined();
    expect(pre.presets!.length).toBeGreaterThanOrEqual(4);
    const scores = pre.presets!.map((p) => p.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
    const still = await page.evaluate(() => (window as unknown as { partwright: PW }).partwright.getPartDraft()) as { parts: unknown[] };
    expect(still.parts.length).toBe(auto.parts!.length);

    // Name the biggest patch, lock it, and re-detect finer: it keeps its triangles.
    const locked = await page.evaluate(async () => {
      const pw = (window as unknown as { partwright: PW }).partwright;
      await pw.editParts({ ops: [{ op: 'rename', id: 1, name: 'body' }, { op: 'lock', id: 'body' }] });
      const before = (pw.getPartDraft() as { parts: { name: string; triCount: number }[] }).parts.find((p) => p.name === 'body')!.triCount;
      const r = await pw.detectParts({ algorithm: 'auto-merge', params: { mergeBelowDeg: 1 } }) as { parts: { name: string; triCount: number; locked?: boolean }[] };
      const body = r.parts.find((p) => p.name === 'body')!;
      return { before, after: body.triCount, locked: body.locked };
    });
    expect(locked.after).toBe(locked.before);
    expect(locked.locked).toBe(true);

    // Seeds round-trip through the working list.
    const seeds = await page.evaluate(() => {
      const pw = (window as unknown as { partwright: PW }).partwright;
      pw.setPartSeeds([{ label: 'top', point: [10, 10, 20] }]);
      return pw.getPartSeeds();
    }) as { label: string }[];
    expect(seeds.map((s) => s.label)).toEqual(['top']);

    // Smooth accept re-meshes the import and stays manifold.
    const acc = await page.evaluate(() => (window as unknown as { partwright: PW }).partwright.acceptParts()) as { smoothEdges?: { fromTris: number; toTris: number }; error?: string };
    expect(acc.error).toBeUndefined();
    expect(acc.smoothEdges!.toTris).toBeGreaterThan(acc.smoothEdges!.fromTris);
    await page.waitForSelector('text=Ready', { timeout: 30_000 });
    const geo = await page.evaluate(() => (window as unknown as { partwright: PW }).partwright.getGeometryData()) as { isManifold?: boolean };
    expect(geo.isManifold).toBe(true);

    // Reopen the saved parts: same names, smoothing off (mesh already cut).
    const re = await page.evaluate(() => (window as unknown as { partwright: PW }).partwright.reopenParts()) as { parts?: { name: string }[]; edgeSmoothing?: number; error?: string };
    expect(re.error).toBeUndefined();
    expect(re.parts!.some((p) => p.name === 'body')).toBe(true);
    expect(re.edgeSmoothing).toBe(0);
    await expect(page.getByRole('dialog', { name: 'Detect parts' })).toHaveCount(0);
    await page.evaluate(() => (window as unknown as { partwright: PW }).partwright.openPartsPanel());
    await expect(page.getByRole('dialog', { name: 'Detect parts' })).toBeVisible();
    await expect(page.getByLabel('Edge smoothness')).toHaveValue('0');
  });

  test('detectParts without an import explains what to do', async ({ page }) => {
    await page.goto('/editor');
    await page.waitForSelector('text=Ready', { timeout: 30_000 });
    await page.waitForFunction(() => !!(window as unknown as { partwright?: PW }).partwright);
    const r = await page.evaluate(() => (window as unknown as { partwright: PW }).partwright.detectParts({ algorithm: 'pieces' })) as { error?: string };
    expect(r.error).toMatch(/import/i);
  });
});
