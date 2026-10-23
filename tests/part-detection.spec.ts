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

/** Where a world point lands on screen (the viewport's current camera). */
async function screenXY(page: Page, p: [number, number, number]): Promise<{ x: number; y: number }> {
  return page.evaluate(async (pt) => {
    const vp = await import('/src/renderer/viewport.ts');
    const cam = vp.getCamera();
    const v = cam.position.clone().set(pt[0], pt[1], pt[2]).project(cam);
    const r = vp.getCanvas().getBoundingClientRect();
    return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height };
  }, p);
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

    // Bad input returns { error } rather than throwing — unknown ops and bad
    // shapes. (Renaming to a taken name is not an error: it merges.)
    const bad = await page.evaluate(async () => {
      const pw = (window as unknown as { partwright: PW }).partwright;
      return [
        await pw.editParts({ ops: [{ op: 'explode' }] }),
        await pw.editParts({ ops: [{ op: 'reassign', point: [1, 2], to: 'cap' }] }),
      ];
    }) as { error?: string }[];
    expect(bad[0].error).toMatch(/op/);
    expect(bad[1].error).toMatch(/point/);

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
      // `Ready` can paint before window.partwright is assigned after a reload.
      const r = (window as unknown as { partwright?: PW }).partwright?.listObjectParts() as { parts?: { name: string }[] } | undefined;
      return (r?.parts ?? []).some((p) => p.name === 'cap');
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

    // The block's patch boundaries sit on 90° box edges: smooth edges pin
    // them, so accept keeps the original mesh.
    const pinnedAcc = await page.evaluate(() => (window as unknown as { partwright: PW }).partwright.acceptParts({ label: 'pinned' })) as { smoothEdges?: unknown; error?: string };
    expect(pinnedAcc.error).toBeUndefined();
    expect(pinnedAcc.smoothEdges).toBeUndefined();
    await page.waitForSelector('text=Ready', { timeout: 30_000 });

    // With pinning off, the same boundaries are smoothed: accept re-meshes
    // the import and it stays manifold.
    await page.evaluate(async () => {
      const cfg = await import('/src/config/appConfig.ts');
      const c = cfg.getConfig();
      cfg.saveAppConfig({ ...c, segmentation: { ...c.segmentation, edgePinCreaseDeg: 0 } });
    });
    const reopened = await page.evaluate(() => (window as unknown as { partwright: PW }).partwright.reopenParts()) as { edgeSmoothing?: number; error?: string };
    expect(reopened.error).toBeUndefined();
    expect(reopened.edgeSmoothing).toBe(3); // not re-meshed, so smoothing starts on
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

  test('panel: select, merge, solo, reorder, presets apply, discard clears pins', async ({ page }) => {
    test.setTimeout(180_000);
    await page.goto('/editor');
    await page.waitForSelector('text=Ready', { timeout: 30_000 });
    await importSteppedBlock(page);
    const det = await page.evaluate(() => (window as unknown as { partwright: PW }).partwright.detectParts({
      algorithm: 'crease-watershed',
      seeds: [{ label: 'base', point: [2, 2, 0] }, { label: 'top', point: [10, 10, 20] }, { label: 'side', point: [20, 10, 5] }],
    })) as { parts?: { name: string; pins: number }[]; error?: string };
    expect(det.error).toBeUndefined();
    expect(det.parts!.every((p) => p.pins >= 1)).toBe(true);
    await page.evaluate(() => (window as unknown as { partwright: PW }).partwright.openPartsPanel());
    const panel = page.getByRole('dialog', { name: 'Detect parts' });
    await expect(panel).toBeVisible();

    // Select two parts from the list → the action bar appears.
    await page.getByLabel('Select base').check();
    await page.getByLabel('Select side').check();
    await expect(panel.getByText('2 selected')).toBeVisible();
    // Solo the selection.
    await panel.getByRole('button', { name: 'Solo', exact: true }).click();
    expect((await page.evaluate(() => (window as unknown as { partwright: PW }).partwright.getPartsView()) as { mode: string }).mode).toBe('solo');
    await panel.getByRole('button', { name: 'Show all', exact: true }).click();
    // Merge them under a typed name: the merged part keeps both parts' pins.
    await page.getByLabel('Merged part name').fill('body');
    await panel.getByRole('button', { name: 'Merge', exact: true }).click();
    await page.waitForFunction(() => ((window as unknown as { partwright: PW }).partwright.getPartDraft() as { parts: { name: string }[] }).parts.some((p) => p.name === 'body'));
    const merged = await page.evaluate(() => (window as unknown as { partwright: PW }).partwright.getPartDraft()) as { parts: { name: string; pins: number }[] };
    expect(merged.parts.map((p) => p.name).sort()).toEqual(['body', 'top']);
    expect(merged.parts.find((p) => p.name === 'body')!.pins).toBeGreaterThanOrEqual(2);

    // Reorder with Alt+↓ in the first name box.
    const first = merged.parts[0].name;
    await page.getByLabel('Name of part 1').press('Alt+ArrowDown');
    await page.waitForFunction((nm) => ((window as unknown as { partwright: PW }).partwright.getPartDraft() as { parts: { name: string }[] }).parts[1]?.name === nm, first);

    // Presets: with a draft, the Start details are folded — unfold them,
    // then clicking a tile applies it and closes the strip.
    await panel.getByRole('button', { name: '▸ Detection settings' }).click();
    await panel.getByRole('button', { name: '▶ Try presets' }).click();
    await page.waitForFunction(() => document.querySelectorAll('[aria-label="Preset results"] button[data-index]').length >= 2, undefined, { timeout: 60_000 });
    await page.locator('[aria-label="Preset results"] button[data-index="0"]').click();
    await expect(panel.getByText(/Applied preset/)).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('[aria-label="Preset results"]')).toBeHidden();

    // Discard throws away parts and pins.
    await panel.getByRole('button', { name: 'Discard' }).click();
    await expect.poll(async () => (await page.evaluate(() => (window as unknown as { partwright: PW }).partwright.getPartSeeds()) as unknown[]).length).toBe(0);
    expect(await page.evaluate(() => (window as unknown as { partwright: PW }).partwright.getPartDraft())).toEqual({ draft: null });
  });

  test('label chips: pick a chip, click the model, accept keeps the chip colours', async ({ page }) => {
    test.setTimeout(180_000);
    await page.goto('/editor');
    await page.waitForSelector('text=Ready', { timeout: 30_000 });
    await importSteppedBlock(page);
    // Start from an auto-patches draft: picking a chip must switch to a seeded
    // method and start fresh rather than mix pins into the patches.
    const auto = await page.evaluate(() => (window as unknown as { partwright: PW }).partwright.detectParts({ algorithm: 'auto-merge', params: { mergeBelowDeg: 30 } })) as { error?: string };
    expect(auto.error).toBeUndefined();
    await page.evaluate(() => (window as unknown as { partwright: PW }).partwright.openPartsPanel());
    const panel = page.getByRole('dialog', { name: 'Detect parts' });
    await expect(panel).toBeVisible();

    await panel.locator('[data-chip="hair"]').click();
    await expect(panel.getByLabel('Detection method')).toHaveValue('crease-watershed');
    await expect(panel.getByText(/Started fresh for Crease watershed/)).toBeVisible();
    await expect(panel.locator('[data-chip="hair"]')).toHaveAttribute('aria-pressed', 'true');
    const cleared = await page.evaluate(() => (window as unknown as { partwright: PW }).partwright.getPartDraft()) as { detector: string; parts: unknown[] };
    expect(cleared.detector).toBe('crease-watershed');
    expect(cleared.parts).toHaveLength(0);

    /** Click the model where a world point projects (no typing involved). */
    const clickAt = async (p: [number, number, number]) => {
      const xy = await page.evaluate(async (pt) => {
        const vp = await import('/src/renderer/viewport.ts');
        const cam = vp.getCamera();
        const v = cam.position.clone().set(pt[0], pt[1], pt[2]).project(cam);
        const r = vp.getCanvas().getBoundingClientRect();
        return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height };
      }, p);
      await page.mouse.click(xy.x, xy.y);
    };
    const partsNow = () => page.evaluate(() => ((window as unknown as { partwright: PW }).partwright.getPartDraft() as { parts?: { name: string; color: string | null }[] }).parts ?? []);

    // Top of the upper block → "hair".
    await clickAt([10, 10, 20]);
    await expect.poll(async () => (await partsNow()).map((p) => [p.name, p.color]), { timeout: 30_000 }).toEqual([['hair', '#4a2e1c']]);
    await expect(panel.locator('[data-chip="hair"]')).toHaveAttribute('data-chip-state', 'owned');

    // Key 2 picks the "face" chip; then the lower block's top → "face".
    await page.keyboard.press('2');
    await expect(panel.locator('[data-chip="face"]')).toHaveAttribute('aria-pressed', 'true');
    await clickAt([2, 2, 10]);
    await expect.poll(async () => (await partsNow()).map((p) => p.name).sort(), { timeout: 30_000 }).toEqual(['face', 'hair']);
    expect((await partsNow()).find((p) => p.name === 'face')!.color).toBe('#e8b98f');

    // Accept: the next step replaces the Accept button, colours carry through.
    await panel.getByRole('button', { name: 'Accept parts' }).click();
    await expect(panel.locator('[data-parts-saved]')).toBeVisible({ timeout: 30_000 });
    await expect(panel.getByRole('button', { name: 'Accept parts' })).toBeHidden();
    await expect(panel.getByRole('button', { name: 'Edit parts' })).toBeVisible();
    const saved = await page.evaluate(() => (window as unknown as { partwright: PW }).partwright.listObjectParts()) as { parts: { name: string; color?: string }[] };
    expect(Object.fromEntries(saved.parts.map((p) => [p.name, p.color]))).toMatchObject({ hair: '#4a2e1c', face: '#e8b98f' });

    // Open Paint lands scoped to the chosen part.
    await panel.getByLabel('Part to paint within').selectOption('face');
    await panel.getByRole('button', { name: 'Open Paint' }).click();
    await expect(page.locator('#paint-within-part')).toHaveValue('face');
    // The Labels list shows each part in its OWN colour, not the brush's.
    const faceSwatch = page.locator('#paint-label-list [data-label-name="face"] button[data-action="set-label-color"]');
    await expect(faceSwatch).toHaveCSS('background-color', 'rgb(232, 185, 143)');
  });

  /** Import the block, detect base + top, and open the panel at a size
   *  where the model is clear of the docked panel. */
  async function openBlockPanel(page: Page) {
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.goto('/editor');
    await page.waitForSelector('text=Ready', { timeout: 30_000 });
    await importSteppedBlock(page);
    await page.evaluate(() => (window as unknown as { partwright: PW }).partwright.detectParts({
      algorithm: 'crease-watershed',
      seeds: [{ label: 'base', point: [2, 2, 0] }, { label: 'top', point: [10, 10, 20] }],
    }));
    await page.evaluate(() => (window as unknown as { partwright: PW }).partwright.openPartsPanel());
    const panel = page.getByRole('dialog', { name: 'Detect parts' });
    await expect(panel).toBeVisible();
    return panel;
  }
  const draftTris = async (page: Page) => Object.fromEntries(((await page.evaluate(() => (window as unknown as { partwright: PW }).partwright.getPartDraft())) as { parts: { name: string; triCount: number }[] }).parts.map((p) => [p.name, p.triCount]));

  test('select brush: a drag brushes into the part it starts in; Alt-drag merges whole parts', async ({ page }) => {
    test.setTimeout(180_000);
    const panel = await openBlockPanel(page);
    // A draft folds the Start details into a summary line; the chips stay.
    await expect(panel.locator('#parts-start-details')).toBeHidden();
    await expect(panel.getByRole('button', { name: '▸ Detection settings' })).toBeVisible();
    await expect(panel.locator('[data-chip="hair"]')).toBeVisible();

    const before = await draftTris(page);
    const drag = async (from: [number, number, number], to: [number, number, number], alt = false) => {
      const a = await screenXY(page, from);
      const b = await screenXY(page, to);
      if (alt) await page.keyboard.down('Alt');
      await page.mouse.move(a.x, a.y);
      await page.mouse.down();
      for (let i = 1; i <= 12; i++) await page.mouse.move(a.x + (b.x - a.x) * i / 12, a.y + (b.y - a.y) * i / 12);
      await page.mouse.up();
      if (alt) await page.keyboard.up('Alt');
    };
    // From the base's front face up onto the top block: those triangles join the base.
    await drag([16, 0, 3], [9, 5, 17]);
    await expect.poll(async () => (await draftTris(page)).base, { timeout: 30_000 }).toBeGreaterThan(before.base);
    expect((await draftTris(page)).top).toBeLessThan(before.top);
    expect((await page.evaluate(() => (window as unknown as { partwright: PW }).partwright.getPartSelection()) as { parts: unknown[] }).parts).toHaveLength(0);
    // One stroke is one undo step.
    await panel.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect.poll(async () => (await draftTris(page)).base, { timeout: 30_000 }).toBe(before.base);

    // Alt-drag from the top block down onto the base: the base joins "top" whole.
    await drag([13, 5, 17], [16, 0, 3], true);
    await expect.poll(async () => Object.keys(await draftTris(page)), { timeout: 30_000 }).toEqual(['top']);

    // The API twin validates its input.
    const bad = await page.evaluate(() => (window as unknown as { partwright: PW }).partwright.editParts({ ops: [{ op: 'brush', to: 'top', points: [[1, 2, 3]] }] })) as { error?: string };
    expect(bad.error).toMatch(/radius/);
  });

  test('type a name to rename (a taken name merges); M merges, R renames, Enter accepts', async ({ page }) => {
    test.setTimeout(180_000);
    const panel = await openBlockPanel(page);
    const names = async () => Object.keys(await draftTris(page)).sort();
    const click = async (p: [number, number, number]) => { const xy = await screenXY(page, p); await page.mouse.click(xy.x, xy.y); };
    const TOP: [number, number, number] = [13, 7, 20];
    const BASE: [number, number, number] = [17, 3, 10];
    const pop = page.locator('[data-rename-popover]');

    // Click the top block, then just type: the popover opens at the cursor.
    await click(TOP);
    await expect.poll(async () => ((await page.evaluate(() => (window as unknown as { partwright: PW }).partwright.getPartSelection())) as { parts: { name: string }[] }).parts.map((p) => p.name)).toEqual(['top']);
    await page.keyboard.type('cap');
    await expect(pop).toBeVisible();
    await expect(pop.getByRole('option', { name: /“cap”/ })).toBeVisible();
    await page.keyboard.press('Enter');
    await expect.poll(names, { timeout: 30_000 }).toEqual(['base', 'cap']);
    await expect(pop).toHaveCount(0);

    // Esc cancels without renaming (and doesn't close the panel).
    await click(TOP);
    await page.keyboard.type('zz');
    await expect(pop).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(pop).toHaveCount(0);
    await expect(panel).toBeVisible();
    expect(await names()).toEqual(['base', 'cap']);

    // R renames the part under the cursor.
    await page.evaluate(() => (window as unknown as { partwright: PW }).partwright.setPartSelection(null));
    const capXY = await screenXY(page, TOP);
    await page.mouse.move(capXY.x - 3, capXY.y);
    await page.mouse.move(capXY.x, capXY.y);
    // Hovering names the part (its row highlights) before R.
    await expect(panel.locator('[data-part-name="cap"]')).toHaveClass(/bg-zinc-700\/50/);
    await page.keyboard.press('r');
    await expect(pop).toBeVisible();
    await page.keyboard.type('hat');
    await page.keyboard.press('Enter');
    await expect.poll(names, { timeout: 30_000 }).toEqual(['base', 'hat']);

    // A taken name merges: click the base, type "ha" → "hat" is offered first.
    await click(BASE);
    await page.keyboard.type('ha');
    await expect(pop.getByRole('option').first()).toHaveAttribute('data-name', 'hat');
    await page.keyboard.press('Enter');
    await expect.poll(names, { timeout: 30_000 }).toEqual(['hat']);

    // M merges the selection (after undoing that merge).
    await panel.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect.poll(names, { timeout: 30_000 }).toEqual(['base', 'hat']);
    await page.evaluate(() => (window as unknown as { partwright: PW }).partwright.setPartSelection(['base', 'hat']));
    await page.locator('body').evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press('m');
    await expect.poll(names, { timeout: 30_000 }).toEqual(['base']);

    // Enter accepts.
    await page.keyboard.press('Enter');
    await expect(panel.locator('[data-parts-saved]')).toBeVisible({ timeout: 30_000 });
  });

  test('phone: the panel is a bottom sheet with compact rows', async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/editor');
    await page.waitForSelector('text=Ready', { timeout: 30_000 });
    await importSteppedBlock(page);
    await page.evaluate(() => (window as unknown as { partwright: PW }).partwright.detectParts({
      algorithm: 'crease-watershed',
      seeds: [{ label: 'base', point: [2, 2, 0] }, { label: 'top', point: [10, 10, 20] }],
    }));
    await page.evaluate(() => (window as unknown as { partwright: PW }).partwright.openPartsPanel());
    const panel = page.getByRole('dialog', { name: 'Detect parts' });
    await expect(panel).toBeVisible();
    await expect.poll(async () => {
      const b = await panel.boundingBox();
      return b ? [Math.round(b.x), Math.round(b.width), Math.round(b.y + b.height)] : null;
    }).toEqual([0, 375, 812]);
    const box = (await panel.boundingBox())!;
    expect(box.height).toBeLessThan(812 * 0.5);
    // Compact rows: lock / solo / remove fold into ⋯.
    await expect(panel.getByRole('button', { name: 'Lock top' })).toBeHidden();
    await panel.getByRole('button', { name: 'More for top' }).click();
    await page.getByRole('menuitem', { name: 'Solo' }).click();
    expect((await page.evaluate(() => (window as unknown as { partwright: PW }).partwright.getPartsView()) as { mode: string }).mode).toBe('solo');
  });

  test('acceptParts applyColors:false saves labels only; seed colours validate', async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto('/editor');
    await page.waitForSelector('text=Ready', { timeout: 30_000 });
    await importSteppedBlock(page);
    const bad = await page.evaluate(() => (window as unknown as { partwright: PW }).partwright.detectParts({
      algorithm: 'crease-watershed', seeds: [{ label: 'base', point: [10, 10, 0], color: 'red' }],
    })) as { error?: string };
    expect(bad.error).toMatch(/color/);
    const det = await page.evaluate(() => (window as unknown as { partwright: PW }).partwright.detectParts({
      algorithm: 'crease-watershed',
      seeds: [{ label: 'base', point: [10, 10, 0], color: '#123456' }, { label: 'top', point: [10, 10, 20] }],
    })) as { parts: { name: string; color: string | null }[] };
    expect(det.parts.find((p) => p.name === 'base')!.color).toBe('#123456');
    const acc = await page.evaluate(() => (window as unknown as { partwright: PW }).partwright.acceptParts({ applyColors: false })) as { parts?: { color: string | null }[]; error?: string };
    expect(acc.error).toBeUndefined();
    expect(acc.parts!.every((p) => p.color === null)).toBe(true);
  });

  test('detectParts without an import explains what to do', async ({ page }) => {
    await page.goto('/editor');
    await page.waitForSelector('text=Ready', { timeout: 30_000 });
    await page.waitForFunction(() => !!(window as unknown as { partwright?: PW }).partwright);
    const r = await page.evaluate(() => (window as unknown as { partwright: PW }).partwright.detectParts({ algorithm: 'pieces' })) as { error?: string };
    expect(r.error).toMatch(/import/i);
  });
});
