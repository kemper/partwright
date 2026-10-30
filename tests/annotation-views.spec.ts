// Snapshot-style annotation views: mark up the frozen frame, Save view → a
// history entry with the exact camera, the frame, and what each mark hit;
// "Attach to AI" stages it in the chat input; the AI tool re-renders it; the
// history round-trips through session export/import. Floating style keeps
// the original per-version behaviour.

import { test, expect, type Page } from 'playwright/test';

type PW = Record<string, (...a: unknown[]) => unknown>;

async function waitForEngine(page: Page) {
  await page.waitForSelector('text=Ready', { timeout: 20_000 });
  await page.waitForFunction(() => !!(window as unknown as { partwright?: { run?: unknown } }).partwright?.run, { timeout: 20_000 });
}

/** Drag a closed loop around the canvas centre. */
async function drawLoop(page: Page, radiusFrac = 0.12) {
  const box = (await page.locator('canvas#viewport').boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const r = Math.min(box.width, box.height) * radiusFrac;
  await page.mouse.move(cx + r, cy);
  await page.mouse.down();
  for (let i = 1; i <= 36; i++) {
    const a = (i / 36) * Math.PI * 2;
    await page.mouse.move(cx + r * Math.cos(a), cy + r * Math.sin(a));
  }
  await page.mouse.up();
}

test.describe('annotation views', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('partwright-tour-completed', '1'));
  });

  test('snapshot: draw, save view, history, attach to AI, render, export round-trip', async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto('/editor');
    await waitForEngine(page);
    await page.evaluate(async () => {
      const pw = (window as unknown as { partwright: PW }).partwright;
      await pw.createSession('annotation-views');
      await pw.runAndSave(
        "const { Manifold } = api;\nreturn api.label(Manifold.cube([20, 20, 20], true), 'body', { color: '#5a9367' })\n  .add(api.label(Manifold.cylinder(14, 4, 4, 32).translate([0, 0, 10]), 'post', { color: '#7a6fb0' }));",
        'labelled',
      );
    });

    expect(await page.evaluate(() => (window as unknown as { partwright: PW }).partwright.getAnnotateStyle())).toBe('snapshot');
    await page.evaluate(() => (window as unknown as { partwright: PW }).partwright.setAnnotateMode('pen'));
    await expect(page.locator('#annotate-picker-panel')).toBeVisible();
    await expect(page.locator('[data-annotate-style="snapshot"]')).toHaveClass(/ring-1/);

    await drawLoop(page);
    // The draft is in scope while drafting…
    expect(await page.evaluate(() => ((window as unknown as { partwright: PW }).partwright.listAnnotations() as unknown[]).length)).toBe(1);

    await page.locator('#annotate-picker-panel input[placeholder^="View title"]').fill('around the post');
    await page.locator('#annotate-save-view').click();
    await expect(page.locator('#annotate-view-history [data-view-id]')).toHaveCount(1);
    await expect(page.locator('#annotate-view-history')).toContainText('around the post');

    const views = await page.evaluate(() => (window as unknown as { partwright: PW }).partwright.listAnnotationViews()) as {
      id: string; title: string; summary: string; camera: { fov: number }; marks2D: { kind: string; closed?: boolean }[];
      hits: { hits: number; samples: number; parts: { name: string }[] }[];
    }[];
    expect(views).toHaveLength(1);
    const v = views[0];
    expect(v.title).toBe('around the post');
    expect(v.camera.fov).toBeGreaterThan(0);
    expect(v.marks2D[0]).toMatchObject({ kind: 'stroke', closed: true });
    expect(v.hits[0].hits).toBeGreaterThan(0);
    expect(v.hits[0].parts.length).toBeGreaterThan(0);
    // …and saving moved it out of the frame.
    expect(await page.evaluate(() => ((window as unknown as { partwright: PW }).partwright.listAnnotations() as unknown[]).length)).toBe(0);

    await page.screenshot({ path: 'test-results/annotation-views-panel.png' });

    // Attach to AI: stages the image + summary line, sends nothing.
    await page.locator(`#annotate-view-history [data-view-id="${v.id}"] button`, { hasText: 'Attach to AI' }).click();
    const chatInput = page.locator('#ai-panel textarea');
    await expect(chatInput).toHaveValue(new RegExp(`\\[Annotation view "around the post" \\(${v.id}\\)`));
    await expect(page.locator('#ai-panel img[src^="data:image/jpeg"]').first()).toBeVisible();
    await page.screenshot({ path: 'test-results/annotation-views-attached.png' });

    // The AI tool returns the frame, or a fresh render from the same camera.
    const tool = await page.evaluate(async (id) => {
      const tools = await import('/src/ai/tools.ts');
      const saved = await tools.executeTool('viewAnnotationView', { id });
      const fresh = await tools.executeTool('viewAnnotationView', { id, fresh: true });
      const list = await tools.executeTool('listAnnotations', {});
      return {
        saved: { isError: saved.isError, media: saved.image?.mediaType, meta: JSON.parse(saved.content) },
        fresh: { isError: fresh.isError, media: fresh.image?.mediaType, label: fresh.image?.label },
        listViews: JSON.parse(list.content).views,
      };
    }, v.id);
    expect(tool.saved).toMatchObject({ isError: false, media: 'image/jpeg', meta: { id: v.id } });
    expect(tool.fresh).toMatchObject({ isError: false, media: 'image/png' });
    expect(tool.fresh.label).toContain('same camera');
    expect(tool.listViews).toEqual([expect.objectContaining({ id: v.id, attached: true })]);

    // Export → import keeps the history (new ids, same content).
    const round = await page.evaluate(async () => {
      const pw = (window as unknown as { partwright: PW }).partwright;
      const exported = await pw.exportSession() as { annotationViews?: unknown[] };
      await pw.importSession(exported);
      await new Promise(r => setTimeout(r, 300));
      return { exported: exported.annotationViews?.length ?? 0, imported: (pw.listAnnotationViews() as { title: string }[]).map(x => x.title) };
    });
    expect(round).toEqual({ exported: 1, imported: ['around the post'] });
  });

  test('floating style keeps marks in the scene; delete removes a view', async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto('/editor');
    await waitForEngine(page);
    await page.evaluate(async () => {
      const pw = (window as unknown as { partwright: PW }).partwright;
      await pw.createSession('annotation-floating');
      await pw.runAndSave('const { Manifold } = api;\nreturn Manifold.cube([20, 20, 20], true);', 'cube');
      pw.setAnnotateStyle('floating');
      pw.setAnnotateMode('pen');
    });
    await drawLoop(page);
    await page.locator('#annotate-save-view').click();
    await expect(page.locator('#annotate-view-history [data-view-id]')).toHaveCount(1);

    // Esc → Select; dragging the stroke moves it (and does not orbit the camera).
    await page.keyboard.press('Escape');
    expect(await page.evaluate(() => (window as unknown as { partwright: PW }).partwright.getAnnotateMode())).toBe('select');
    const firstPoint = () => page.evaluate(() => ((window as unknown as { partwright: PW }).partwright.listAnnotations() as { points: number[][] }[])[0].points[0]);
    const camPos = () => page.evaluate(async () => (await import('/src/renderer/viewport.ts')).getCameraPose().position);
    const p0 = await firstPoint();
    const c0 = await camPos();
    const box = (await page.locator('canvas#viewport').boundingBox())!;
    const r = Math.min(box.width, box.height) * 0.12;
    await page.mouse.move(box.x + box.width / 2 + r, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + r + 60, box.y + box.height / 2 + 30, { steps: 6 });
    await page.mouse.up();
    expect(await firstPoint()).not.toEqual(p0);
    const c1 = await camPos();
    for (let k = 0; k < 3; k++) expect(Math.abs(c1[k] - c0[k])).toBeLessThan(1e-3);

    await page.evaluate(() => (window as unknown as { partwright: PW }).partwright.setAnnotateMode(null));
    // Floating marks persist after close and after Save view.
    expect(await page.evaluate(() => ((window as unknown as { partwright: PW }).partwright.listAnnotations() as unknown[]).length)).toBe(1);

    const id = await page.evaluate(() => ((window as unknown as { partwright: PW }).partwright.listAnnotationViews() as { id: string }[])[0].id);
    expect(await page.evaluate((vid) => (window as unknown as { partwright: PW }).partwright.restoreAnnotationView(vid), id)).toEqual({ restored: true });
    expect(await page.evaluate((vid) => (window as unknown as { partwright: PW }).partwright.deleteAnnotationView(vid), id)).toEqual({ deleted: true });
    expect(await page.evaluate(() => ((window as unknown as { partwright: PW }).partwright.listAnnotationViews() as unknown[]).length)).toBe(0);
    expect(await page.evaluate(() => (window as unknown as { partwright: PW }).partwright.setAnnotateStyle('sideways'))).toHaveProperty('error');
  });

  test('drafts never leak into another session, and sub-mode switches keep redo', async ({ page }) => {
    test.setTimeout(60_000); // two sessions + two runs
    await page.goto('/editor');
    await waitForEngine(page);
    const call = (name: string) => page.evaluate((n) => (window as unknown as { partwright: PW }).partwright[n](), name);
    const count = (name: string) => page.evaluate((n) => ((window as unknown as { partwright: PW }).partwright[n]() as unknown[]).length, name);
    await page.evaluate(async () => {
      const p = (window as unknown as { partwright: PW }).partwright;
      await p.createSession('drafts-a');
      await p.runAndSave('const { Manifold } = api;\nreturn Manifold.cube([20, 20, 20], true);', 'cube');
      p.setAnnotateStyle('snapshot');
      p.setAnnotateMode('pen');
    });
    await drawLoop(page);
    await drawLoop(page, 0.2);
    // Undo one, then Pen -> Select -> Pen: redo must survive the switch.
    await call('undoAnnotation');
    await page.locator('#annotate-picker-panel button', { hasText: 'Select' }).click();
    await page.locator('#annotate-picker-panel button', { hasText: 'Pen' }).click();
    expect(await call('redoAnnotation')).toMatchObject({ redone: true });
    expect(await count('listAnnotations')).toBe(2);

    // Close with unsaved drafts, open another session, reopen Annotate.
    await page.evaluate(async () => {
      const p = (window as unknown as { partwright: PW }).partwright;
      p.setAnnotateMode(null);
      await p.createSession('drafts-b');
      await p.runAndSave('const { Manifold } = api;\nreturn Manifold.sphere(10, 48);', 'sphere');
      p.setAnnotateMode('pen');
    });
    expect(await count('listAnnotations')).toBe(0);
    expect(await count('listAnnotationViews')).toBe(0);
  });

  test('Annotate opens in Select (view free, Lock off); colour → Pen freezes the view; Esc → Select', async ({ page }) => {
    await page.goto('/editor');
    await waitForEngine(page);
    await page.evaluate(async () => {
      const p = (window as unknown as { partwright: PW }).partwright;
      await p.createSession('annotate-modes');
      await p.runAndSave('const { Manifold } = api;\nreturn Manifold.cube([20, 20, 20], true);', 'cube');
    });
    const lockText = await page.locator('#orbit-lock-toggle').textContent();
    const pose = () => page.evaluate(async () => (await import('/src/renderer/viewport.ts')).getCameraPose());
    const userLocked = () => page.evaluate(async () => (await import('/src/renderer/viewport.ts')).isUserOrbitLocked());

    // The real entry point: the toolbar button.
    await page.evaluate(() => (document.getElementById('annotate-toggle') as HTMLButtonElement).click());
    await expect(page.locator('#annotate-picker-panel')).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { partwright: PW }).partwright.getAnnotateMode())).toBe('select');
    const tabs = page.locator('#annotate-picker-panel button', { hasText: /Select|Pen|Text/ });
    await expect(tabs.first()).toContainText('Select');
    expect(await userLocked()).toBe(false);
    await expect(page.locator('#orbit-lock-toggle')).toHaveText(lockText!);

    // Select: dragging empty space orbits as usual.
    const box = (await page.locator('canvas#viewport').boundingBox())!;
    const before = await pose();
    await page.mouse.move(box.x + 60, box.y + box.height - 60);
    await page.mouse.down();
    await page.mouse.move(box.x + 200, box.y + box.height - 80, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(400);
    const afterOrbit = await pose();
    expect(afterOrbit.position).not.toEqual(before.position);

    // Picking a colour jumps to Pen; the view is frozen (wheel does nothing) and Lock stays off.
    await page.locator('#annotate-picker-panel button[title="#2196f2"]').click();
    expect(await page.evaluate(() => (window as unknown as { partwright: PW }).partwright.getAnnotateMode())).toBe('pen');
    expect(await userLocked()).toBe(false);
    await expect(page.locator('#orbit-lock-toggle')).toHaveText(lockText!);
    await page.waitForTimeout(400);
    const penStart = await pose();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, -400);
    await page.waitForTimeout(400);
    // Frozen: a wheel zoom would move the camera by whole units; allow only
    // the last of the orbit damping settling (~1e-6).
    const penEnd = await pose();
    for (let k = 0; k < 3; k++) expect(Math.abs(penEnd.position[k] - penStart.position[k])).toBeLessThan(1e-3);

    // Esc leaves Pen for Select (panel stays open); Esc again closes it.
    await page.keyboard.press('Escape');
    expect(await page.evaluate(() => (window as unknown as { partwright: PW }).partwright.getAnnotateMode())).toBe('select');
    await expect(page.locator('#annotate-picker-panel')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#annotate-picker-panel')).toBeHidden();
  });
});
