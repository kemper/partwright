// Golden path for the Objects rail's expandable PARTS / PIECES section: the
// open object lists its api.label regions as parts (tracked through unions and
// cuts, so they survive fusing into one solid), the unlabeled remainder, and its
// physically separate pieces; clicking a part tints it in the viewport. Also
// covers the console twins (listObjectParts / highlightObjectPart / selectObjectPart) and the
// Parts → Objects rename on the rail itself.

import { test, expect, type Page } from 'playwright/test';

async function waitForEngine(page: Page) {
  await page.waitForSelector('text=Ready', { timeout: 20_000 });
  await page.waitForFunction(
    () => !!(window as unknown as { partwright?: { listObjectParts?: unknown } }).partwright?.listObjectParts,
    { timeout: 20_000 },
  );
}

// A mug: body + handle + rim fused into ONE solid (the cavity cut labelled
// "inside"), plus a separate coaster — so 4 parts + 2 pieces.
const MUG = `const { Manifold, CrossSection } = api;
const body = Manifold.cylinder(40, 22, 22, 64);
const cavity = Manifold.cylinder(40, 19, 19, 64).translate([0, 0, 3]);
const handle = CrossSection.circle(3.5, 24).translate([11, 0]).revolve(48).rotate([90, 0, 0]).translate([25, 0, 21]);
const rim = CrossSection.circle(1.8, 16).translate([20.5, 0]).revolve(64).translate([0, 0, 40]);
const coaster = Manifold.cylinder(3, 28, 28, 64).translate([-70, 0, 0]);
const mug = api.label(body, 'body', { color: '#3b82f6' })
  .add(api.label(handle, 'handle', { color: '#f97316' }))
  .add(api.label(rim, 'rim', { color: '#f4f4f5' }))
  .subtract(api.label(cavity, 'inside', { color: '#1e3a8a' }));
return mug.add(api.label(coaster, 'coaster', { color: '#a8a29e' }));`;

test.describe('Objects rail — parts and pieces', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('partwright-tour-completed', '1');
    });
  });

  test('lists labelled parts + pieces of the open object and highlights on click', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1200 });
    await page.goto('/editor');
    await waitForEngine(page);
    await page.evaluate(async (code) => {
      const pw = (window as unknown as { partwright: { createSession(n: string): Promise<unknown>; runAndSave(c: string, l: string): Promise<unknown> } }).partwright;
      await pw.createSession('Mug');
      await pw.runAndSave(code, 'mug');
    }, MUG);

    const rail = page.locator('#parts-rail');
    await expect(rail).toContainText('Objects');
    const section = rail.locator('#object-parts');
    for (const name of ['body', 'handle', 'rim', 'inside', 'coaster']) {
      await expect(section.locator(`[data-object-part="part:${name}"]`)).toBeVisible();
    }
    // Two separate solids: the fused mug and the coaster, each named by its part.
    await expect(section).toContainText('Pieces · 2');
    await expect(section.locator('[data-object-part="piece:0"]')).toContainText(/Piece 1 · body/);
    await expect(section.locator('[data-object-part="piece:1"]')).toContainText('Piece 2 · coaster');

    // The console twin reports the same thing.
    const listed = await page.evaluate(() => (window as unknown as { partwright: { listObjectParts(): { parts: { name: string; triangleCount: number; color?: string }[]; pieces: { part?: string }[]; lostParts: string[] } } }).partwright.listObjectParts());
    expect(listed.parts.map(p => p.name)).toEqual(['body', 'handle', 'rim', 'inside', 'coaster']);
    expect(listed.parts.every(p => p.triangleCount > 0)).toBe(true);
    expect(listed.parts.find(p => p.name === 'handle')?.color).toBe('#f97316');
    expect(listed.pieces).toHaveLength(2);
    expect(listed.lostParts).toEqual([]);

    // Click the handle → it's pressed and tinted.
    const handleBtn = section.locator('[data-object-part="part:handle"]');
    await handleBtn.click();
    await expect(rail.locator('[data-object-part="part:handle"]')).toHaveAttribute('aria-pressed', 'true');
    await page.mouse.move(1100, 900); // drop the row tooltip
    await page.waitForTimeout(400);
    await page.screenshot({ path: 'test-results/object-parts-handle.png' });

    // Clicking again clears it; the API can drive the same highlight.
    await rail.locator('[data-object-part="part:handle"]').click();
    await expect(rail.locator('[data-object-part="part:handle"]')).toHaveAttribute('aria-pressed', 'false');
    // highlightObjectPart is a transient visual tint; selectObjectPart is the
    // API twin of clicking the row.
    const tint = await page.evaluate(() => (window as unknown as { partwright: { highlightObjectPart(t: unknown): { ok?: boolean; triangles?: number } } }).partwright.highlightObjectPart({ piece: 1 }));
    expect(tint.ok).toBe(true);
    expect(tint.triangles).toBeGreaterThan(0);
    await expect(rail.locator('[data-object-part="piece:1"]')).toHaveAttribute('aria-pressed', 'false');
    const viaApi = await page.evaluate(() => (window as unknown as { partwright: { selectObjectPart(t: unknown): { ok?: boolean; triangles?: number } } }).partwright.selectObjectPart({ piece: 1 }));
    expect(viaApi.ok).toBe(true);
    expect(viaApi.triangles).toBeGreaterThan(0);
    await expect(rail.locator('[data-object-part="piece:1"]')).toHaveAttribute('aria-pressed', 'true');
    await rail.locator('[data-object-part="piece:1"]').scrollIntoViewIfNeeded();
    await page.mouse.move(1100, 900);
    await page.waitForTimeout(400);
    await page.screenshot({ path: 'test-results/object-parts-piece.png' });

    // A re-run sweeps the tint (it never outlives the mesh it was built for).
    await page.evaluate(() => (window as unknown as { partwright: { run(): Promise<unknown> } }).partwright.run());
    await expect(rail.locator('[data-object-part="piece:1"]')).toHaveAttribute('aria-pressed', 'false');
  });

  test('collapses, flags lost labels, and lists a second object', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1200 });
    await page.goto('/editor');
    await waitForEngine(page);
    await page.evaluate(async () => {
      const pw = (window as unknown as { partwright: { createSession(n: string): Promise<unknown>; runAndSave(c: string, l: string): Promise<unknown>; createObject(n: string): Promise<unknown>; renameObject(t: number, n: string): Promise<unknown> } }).partwright;
      await pw.createSession('Box and lid');
      await pw.runAndSave(`const { Manifold } = api;
const box = Manifold.cube([30, 30, 20], true);
const hole = Manifold.cube([4, 4, 4], true).translate([0, 0, 40]);
const ghost = Manifold.cube([2, 2, 2], true);
// "ghost" is swallowed by the box, so its label ends up with no triangles.
return api.label(box, 'box').add(api.label(ghost, 'ghost')).subtract(api.label(hole, 'vent'));`, 'box');
      await pw.renameObject(0, 'Box');
      await pw.createObject('Lid');
      await pw.runAndSave(`const { Manifold } = api;
return api.label(Manifold.cube([32, 32, 3], true), 'plate', { color: '#22c55e' })
  .add(api.label(Manifold.cylinder(4, 3, 3, 32).translate([0, 0, 1.5]), 'knob', { color: '#eab308' }));`, 'lid');
    });

    const rail = page.locator('#parts-rail');
    await expect(rail.locator('[data-part-id]')).toHaveCount(2);
    const section = rail.locator('#object-parts');
    await expect(section.locator('[data-object-part="part:plate"]')).toBeVisible();
    await expect(section.locator('[data-object-part="part:knob"]')).toBeVisible();
    await page.waitForTimeout(300);
    await rail.screenshot({ path: 'test-results/object-parts-rail-lid.png' });

    // Switch to Box: "ghost" is lost; "vent" never touched the box so it's lost too.
    await rail.locator('[data-part-id]', { hasText: 'Box' }).click();
    await expect(section.locator('[data-object-part="part:box"]')).toBeVisible();
    await expect(rail.locator('#object-parts')).toContainText('ghost');
    await expect(rail.locator('#object-parts')).toContainText('lost');
    await page.mouse.move(1100, 900);
    await page.waitForTimeout(300);
    await rail.screenshot({ path: 'test-results/object-parts-rail-box-lost.png' });

    // Collapse hides the section; expand brings it back.
    await rail.locator('#btn-object-parts-toggle').click();
    await expect(rail.locator('#object-parts')).toHaveCount(0);
    await rail.locator('#btn-object-parts-toggle').click();
    await expect(rail.locator('#object-parts')).toBeVisible();
  });

  test('shapes inserted from the Insert palette show up as labelled parts', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto('/editor');
    await waitForEngine(page);
    await page.evaluate(async () => {
      const pw = (window as unknown as { partwright: { createSession(n: string): Promise<unknown>; setCode(c: string): void; run(): Promise<unknown> } }).partwright;
      await pw.createSession('Arranged');
      pw.setCode('const { Manifold } = api;\nreturn Manifold.cube([10, 10, 10], true);');
      await pw.run();
    });
    const palette = '#insert-palette-panel';
    await page.locator('#btn-insert').dispatchEvent('click');
    await page.locator(palette).getByRole('button', { name: 'Cube' }).click();
    await page.getByRole('button', { name: 'Insert', exact: true }).click();
    await page.locator(palette).getByRole('button', { name: 'Sphere' }).click();
    await page.getByRole('button', { name: 'Insert', exact: true }).click();

    const section = page.locator('#parts-rail #object-parts');
    await expect(section.locator('[data-object-part="part:box"]')).toBeVisible({ timeout: 10_000 });
    await expect(section.locator('[data-object-part="part:ball"]')).toBeVisible();
    const code = await page.evaluate(() => (window as unknown as { partwright: { getCode(): string } }).partwright.getCode());
    expect(code).toContain("api.label(box, 'box')");
    expect(code).toContain("api.label(ball, 'ball')");
    await page.locator('#parts-rail').screenshot({ path: 'test-results/object-parts-arrange-rail.png' });
  });
});
