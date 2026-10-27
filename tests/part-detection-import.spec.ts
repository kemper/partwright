// Part detection on STL import (#1025): an interactive import runs the
// automatic detectors. A multi-body file opens the Detect parts panel on the
// proposal; a single solid gets the convert-to-code ask with a "Detect
// parts…" button. The Paint panel's Labels section offers the same entry.

import { test, expect, type Page } from 'playwright/test';

type PW = Record<string, (...args: unknown[]) => Promise<Record<string, unknown>> | Record<string, unknown>>;

/** Binary STL of axis-aligned boxes ([min, max] corners), each a closed solid. */
function boxesStl(boxes: [number[], number[]][]): Buffer {
  const tris: number[][][] = [];
  for (const [a, b] of boxes) {
    const v = (i: number) => [i & 1 ? b[0] : a[0], i & 2 ? b[1] : a[1], i & 4 ? b[2] : a[2]];
    // Outward-wound quads (corner index bits: x=1, y=2, z=4).
    const quads = [[0, 2, 3, 1], [4, 5, 7, 6], [0, 1, 5, 4], [2, 6, 7, 3], [0, 4, 6, 2], [1, 3, 7, 5]];
    for (const [p, q, r, s] of quads) {
      tris.push([v(p), v(q), v(r)], [v(p), v(r), v(s)]);
    }
  }
  const buf = Buffer.alloc(84 + tris.length * 50);
  buf.writeUInt32LE(tris.length, 80);
  tris.forEach((t, i) => {
    const o = 84 + i * 50;
    t.forEach((p, k) => p.forEach((c, j) => buf.writeFloatLE(c, o + 12 + k * 12 + j * 4)));
  });
  return buf;
}

async function importStl(page: Page, name: string, buffer: Buffer): Promise<void> {
  await page.locator('#import-wrapper input[type="file"]').setInputFiles({ name, mimeType: 'model/stl', buffer });
}

test.describe('Part detection on import', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('partwright-tour-completed', '1'));
    await page.goto('/editor');
    await page.waitForSelector('text=Ready', { timeout: 30_000 });
    await page.waitForFunction(() => !!(window as unknown as { partwright?: PW }).partwright);
  });

  test('a multi-body STL opens the Detect parts panel on the proposal', async ({ page }) => {
    test.setTimeout(90_000);
    await importStl(page, 'two-blocks.stl', boxesStl([[[0, 0, 0], [10, 10, 10]], [[20, 0, 0], [30, 10, 10]]]));

    const panel = page.getByRole('dialog', { name: 'Detect parts' });
    await expect(panel).toBeVisible({ timeout: 30_000 });
    await expect(panel.getByText('Imported two-blocks.stl: found 2 separate parts')).toBeVisible();
    await expect(panel.getByLabel('Name of part 2')).toHaveValue('piece 2');
    await expect(panel.getByLabel('Detection method')).toHaveValue('pieces');
    const draft = await page.evaluate(() => (window as unknown as { partwright: PW }).partwright.getPartDraft()) as { detector?: string; parts?: unknown[] };
    expect(draft.detector).toBe('pieces');
    expect(draft.parts).toHaveLength(2);

    // The alternative next step swaps to the convert ask and drops the draft.
    await panel.getByRole('button', { name: 'Convert to code instead' }).click();
    await expect(page.getByText('Imported two-blocks.stl as a mesh')).toBeVisible();
    await expect(panel).toBeHidden();
    await page.waitForFunction(() => {
      const d = (window as unknown as { partwright: PW }).partwright.getPartDraft() as { draft?: null };
      return d.draft === null;
    });
  });

  test('a fused figure opens ready to label, with one consistent message', async ({ page }) => {
    test.setTimeout(90_000);
    // Count these 12-triangle boxes as a big fused mesh.
    await page.evaluate(async () => {
      const cfg = await import('/src/config/appConfig.ts');
      const c = cfg.getConfig();
      cfg.saveAppConfig({ ...c, segmentation: { ...c.segmentation, fusedPieceMinTris: 10 } });
    });
    await importStl(page, 'two-blocks.stl', boxesStl([[[0, 0, 0], [10, 10, 10]], [[20, 0, 0], [30, 10, 10]]]));
    const panel = page.getByRole('dialog', { name: 'Detect parts' });
    await expect(panel).toBeVisible({ timeout: 30_000 });
    await expect(panel.getByText(/found 2 separate parts, and the largest is one fused solid/)).toBeVisible();
    // Said once: no second, contradictory note in the part list.
    await expect(panel.getByText(/one fused solid/)).toHaveCount(1);
    // The first chip is armed and the Pin tool is on; the proposal stays
    // until the first click.
    await expect(panel.locator('[data-chip="hair"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(panel.getByRole('button', { name: 'Pin (P)' })).toHaveAttribute('aria-pressed', 'true');
    const draftNow = () => page.evaluate(() => (window as unknown as { partwright: PW }).partwright.getPartDraft()) as Promise<{ detector?: string; parts?: { name: string }[] }>;
    expect((await draftNow()).detector).toBe('pieces');

    // The first click switches method, clears the pieces and places the pin
    // as ONE step: a single Undo brings both pieces back.
    const xy = await page.evaluate(async () => {
      const vp = await import('/src/renderer/viewport.ts');
      const cam = vp.getCamera();
      const v = cam.position.clone().set(5, 5, 10).project(cam);
      const r = vp.getCanvas().getBoundingClientRect();
      return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height };
    });
    await page.mouse.click(xy.x, xy.y);
    await expect.poll(async () => (await draftNow()).parts?.map((p) => p.name), { timeout: 30_000 }).toEqual(['hair']);
    await expect(panel.getByText(/Started fresh for Crease watershed/)).toBeVisible();
    await panel.getByRole('button', { name: 'Undo', exact: true }).first().click();
    await expect.poll(async () => { const d = await draftNow(); return [d.detector, d.parts?.length]; }, { timeout: 30_000 }).toEqual(['pieces', 2]);
  });

  test('dismissing an untouched import proposal discards it', async ({ page }) => {
    test.setTimeout(90_000);
    await importStl(page, 'two-blocks.stl', boxesStl([[[0, 0, 0], [10, 10, 10]], [[20, 0, 0], [30, 10, 10]]]));
    const panel = page.getByRole('dialog', { name: 'Detect parts' });
    await expect(panel).toBeVisible({ timeout: 30_000 });
    await panel.getByRole('button', { name: /close/i }).first().click();
    await expect(panel).toBeHidden();
    await page.waitForFunction(() => {
      const d = (window as unknown as { partwright: PW }).partwright.getPartDraft() as { draft?: null };
      return d.draft === null;
    });

  });

  test('the import banner goes away once its proposal is replaced', async ({ page }) => {
    test.setTimeout(90_000);
    await importStl(page, 'two-blocks.stl', boxesStl([[[0, 0, 0], [10, 10, 10]], [[20, 0, 0], [30, 10, 10]]]));
    const panel = page.getByRole('dialog', { name: 'Detect parts' });
    await expect(panel.getByText('found 2 separate parts')).toBeVisible({ timeout: 30_000 });
    await page.evaluate(() => (window as unknown as { partwright: PW }).partwright.detectParts({
      algorithm: 'crease-watershed', seeds: [{ label: 'a', point: [5, 5, 10] }, { label: 'b', point: [25, 5, 10] }],
    }));
    await expect(panel.getByText('found 2 separate parts')).toBeHidden();
    await expect(panel).toBeVisible();
  });

  test('a single solid gets the convert ask with a Detect parts button', async ({ page }) => {
    test.setTimeout(90_000);
    await importStl(page, 'one-block.stl', boxesStl([[[0, 0, 0], [10, 10, 10]]]));

    await expect(page.getByText('Imported one-block.stl as a mesh')).toBeVisible({ timeout: 30_000 });
    // One solid: the automatic pass proposed nothing, so no draft is left behind.
    const auto = await page.evaluate(() => (window as unknown as { partwright: PW }).partwright.autoDetectParts()) as { proposed?: boolean; reason?: string; tried?: { detector: string; partCount: number }[] };
    expect(auto.proposed).toBe(false);
    expect(auto.reason).toMatch(/one solid piece/);
    expect(auto.tried?.[0]).toEqual({ detector: 'pieces', partCount: 1 });
    // ...and a draft that already exists survives a proposal that finds nothing.
    const survived = await page.evaluate(async () => {
      const pw = (window as unknown as { partwright: PW }).partwright;
      await pw.detectParts({ algorithm: 'crease-watershed', seeds: [{ label: 'block', point: [5, 5, 10] }] });
      await pw.autoDetectParts();
      return (pw.getPartDraft() as { detector?: string }).detector;
    });
    expect(survived).toBe('crease-watershed');
    await page.evaluate(() => (window as unknown as { partwright: PW }).partwright.discardParts());

    await page.getByRole('button', { name: 'Detect parts…' }).click();
    await expect(page.getByRole('dialog', { name: 'Detect parts' })).toBeVisible();
    await expect(page.getByText('Imported one-block.stl as a mesh')).toBeHidden();

    // Bad input returns { error } rather than throwing.
    const bad = await page.evaluate(() => (window as unknown as { partwright: PW }).partwright.autoDetectParts({ importIndex: 3 })) as { error?: string };
    expect(bad.error).toMatch(/out of range/);
  });

  test('the Paint panel offers Detect parts on an imported mesh', async ({ page }) => {
    test.setTimeout(90_000);
    await importStl(page, 'one-block.stl', boxesStl([[[0, 0, 0], [10, 10, 10]]]));
    await expect(page.getByText('Imported one-block.stl as a mesh')).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: 'Keep mesh only' }).click();

    await page.evaluate(() => document.getElementById('paint-toggle')?.click());
    const entry = page.locator('#paint-detect-parts');
    await expect(entry).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('This imported mesh has no labels yet')).toBeVisible();
    await entry.click();
    await expect(page.getByRole('dialog', { name: 'Detect parts' })).toBeVisible();
  });
});
