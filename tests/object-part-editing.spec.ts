// Editing parts from the Objects list (#1003). The rail is a SELECTOR: a
// selected part becomes the scope the existing tools act in (paint, surface,
// AI), plus the part-level actions (colour, isolate, info, go-to-code, rename,
// bake) and the piece actions (extract / export / delete). Paint whose part
// the code no longer has is flagged as "Unmatched paint" with a fix.

import { test, expect, type Page } from 'playwright/test';

type PW = Record<string, (...a: unknown[]) => unknown>;

async function boot(page: Page) {
  await page.addInitScript(() => localStorage.setItem('partwright-tour-completed', '1'));
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto('/editor');
  await page.waitForSelector('text=Ready', { timeout: 20_000 });
  await page.waitForFunction(() => !!(window as unknown as { partwright?: PW }).partwright?.selectObjectPart, { timeout: 20_000 });
}

const MUG = `const { Manifold, CrossSection } = api;
const body = Manifold.cylinder(40, 22, 22, 64);
const cavity = Manifold.cylinder(40, 19, 19, 64).translate([0, 0, 3]);
const handle = CrossSection.circle(3.5, 24).translate([11, 0]).revolve(48).rotate([90, 0, 0]).translate([25, 0, 21]);
const coaster = Manifold.cylinder(3, 28, 28, 64).translate([-70, 0, 0]);
const mug = api.label(body, 'body', { color: '#3b82f6' })
  .add(api.label(handle, 'handle', { color: '#f97316' }))
  .subtract(api.label(cavity, 'inside', { color: '#1e3a8a' }));
return mug.add(api.label(coaster, 'coaster', { color: '#a8a29e' }));`;

async function openMug(page: Page) {
  await boot(page);
  await page.evaluate(async (code) => {
    const pw = (window as unknown as { partwright: PW }).partwright;
    await pw.createSession('Mug');
    await pw.runAndSave(code, 'mug');
  }, MUG);
}

const pw = <T = unknown>(page: Page, method: string, ...args: unknown[]) =>
  page.evaluate(([m, a]) => (window as unknown as { partwright: PW }).partwright[m as string](...(a as unknown[])), [method, args] as const) as Promise<T>;

test.describe('Objects list — editing parts', () => {
  test('a selected part scopes paint, isolates, and reports its info', async ({ page }) => {
    await openMug(page);
    const rail = page.locator('#parts-rail');
    await rail.locator('[data-object-part="part:handle"]').click();
    const drawer = page.locator('#object-part-drawer');
    await expect(drawer).toBeVisible();
    await expect(drawer.locator('[data-part-info]')).toContainText('area');
    expect(await pw(page, 'getSelectedObjectPart')).toMatchObject({ part: 'handle' });

    // Scoped API paint: the same slab paints far fewer triangles inside the handle.
    const scoped = await pw<{ triangles: number; scope: { label: string } }>(page, 'paintSlab', { axis: 'z', offset: 30, thickness: 30, color: [0.1, 0.8, 0.2], scope: { label: 'handle' } });
    expect(scoped.scope).toEqual({ label: 'handle' });
    const unscoped = await pw<{ triangles: number }>(page, 'paintSlab', { axis: 'z', offset: 30, thickness: 30, color: [0.1, 0.8, 0.2] });
    expect(scoped.triangles).toBeGreaterThan(0);
    expect(scoped.triangles).toBeLessThan(unscoped.triangles);
    await pw(page, 'undoLastPaint');
    // A scope naming a missing part is a clear error.
    expect(await pw(page, 'paintSlab', { axis: 'z', offset: 30, thickness: 30, color: [1, 0, 0], scope: { label: 'lid' } })).toMatchObject({ error: expect.stringContaining('no part "lid"') });

    // Isolate ghosts the rest of the object.
    await drawer.locator('[data-part-action="isolate"]').click();
    await expect(page.locator('#object-part-drawer [data-part-action="isolate"]')).toHaveAttribute('aria-pressed', 'true');
    await page.mouse.move(1200, 1000);
    await page.waitForTimeout(400);
    await page.screenshot({ path: 'test-results/part-edit-isolate.png' });
    expect(await pw(page, 'getSelectedObjectPart')).toMatchObject({ isolated: true });

    // Go to code selects the label literal in the editor.
    await page.locator('#object-part-drawer [data-part-action="go-to-code"]').click();
    const sel = await page.evaluate(() => window.getSelection()?.toString() ?? '');
    expect(sel).toContain('handle');

    // The selection rides along as AI context.
    await page.evaluate(() => (window as unknown as { partwright: PW }).partwright.isolateObjectPart(null));
    await page.locator('#object-part-drawer [data-part-action="edit-with-ai"]').click();
    await expect(page.locator('#ai-part-context')).toContainText('part "handle"');
  });

  test('flags unmatched paint after a hand rename and moves it on request', async ({ page }) => {
    await openMug(page);
    await pw(page, 'setObjectPartColor', 'body', '#ef4444');
    await expect(page.locator('#parts-rail [data-object-part="part:body"] [data-color-source="painted"]')).toBeVisible();
    // Rename the label in the code by hand — the red fill no longer lands anywhere.
    const res = await page.evaluate(async (code) => (window as unknown as { partwright: PW }).partwright.runAndSave(code.replace("'body'", "'cup'"), 'hand rename'), MUG) as { unmatchedPaint?: { label: string; hint?: string }[] };
    expect(res.unmatchedPaint?.[0]).toMatchObject({ label: 'body', hint: expect.stringContaining('cup') });
    const box = page.locator('#unmatched-paint');
    await expect(box).toContainText('Unmatched paint (1)');
    await expect(box.locator('[data-rename-suggestion="body→cup"]')).toBeVisible();
    await page.mouse.move(1200, 1000);
    await page.waitForTimeout(300);
    await page.locator('#parts-rail').screenshot({ path: 'test-results/part-edit-unmatched.png' });

    await box.locator('[data-part-action="accept-rename"]').click();
    await expect(page.locator('#unmatched-paint')).toHaveCount(0);
    await expect(page.locator('#parts-rail [data-object-part="part:cup"] [data-color-source="painted"]')).toBeVisible();
  });

  test('rename and bake rewrite the code and keep the paint attached', async ({ page }) => {
    await openMug(page);
    await pw(page, 'setObjectPartColor', 'handle', '#22c55e');
    await page.locator('#parts-rail [data-object-part="part:handle"]').click();
    await page.locator('#object-part-drawer [data-part-action="rename"]').click();
    const input = page.locator('input[type="text"]').last();
    await input.fill('grip');
    await page.getByRole('button', { name: 'Rename', exact: true }).click();
    await expect(page.locator('#parts-rail [data-object-part="part:grip"]')).toBeVisible({ timeout: 10_000 });
    let code = await pw<string>(page, 'getCode');
    expect(code).toContain("api.label(handle, 'grip'");
    // The paint followed the rename (still fills the part, nothing unmatched).
    const parts = await pw<{ parts: { name: string; colorSource?: string }[]; unmatchedPaint: unknown[] }>(page, 'listObjectParts');
    expect(parts.parts.find(p => p.name === 'grip')?.colorSource).toBe('painted');
    expect(parts.unmatchedPaint).toEqual([]);

    // Bake writes the colour into the code and drops the overlay.
    await page.locator('#object-part-drawer [data-part-action="bake-color"]').click();
    await expect.poll(async () => (await pw<string>(page, 'getCode')).includes("api.paint.label('grip', '#22c55e')")).toBe(true);
    code = await pw<string>(page, 'getCode');
    const regions = await pw<{ name: string }[]>(page, 'listRegions');
    expect(regions.filter(r => r.name === 'grip')).toHaveLength(0);
    expect(code).toContain('return mug.add');
  });

  test('pieces: delete a stray piece and extract one into a new object', async ({ page }) => {
    await openMug(page);
    // Extract the coaster (piece 2) into its own object.
    await page.locator('#parts-rail [data-object-part="piece:1"]').click();
    await page.mouse.move(1200, 1000);
    await page.waitForTimeout(300);
    await page.locator('#parts-rail').screenshot({ path: 'test-results/part-edit-piece.png' });
    await page.locator('#object-part-drawer [data-part-action="extract-piece"]').click();
    await page.getByRole('button', { name: 'Extract', exact: true }).click();
    await expect(page.locator('#parts-rail [data-part-id]')).toHaveCount(2, { timeout: 15_000 });
    const objects = await pw<{ name: string; isCurrent: boolean }[]>(page, 'listObjects');
    expect(objects.find(o => o.isCurrent)?.name).toContain('coaster');
    let parts = await pw<{ pieces: unknown[]; parts: { name: string }[] }>(page, 'listObjectParts');
    expect(parts.pieces).toHaveLength(1);
    expect(parts.parts.map(p => p.name)).toContain('coaster');

    // Back on the mug, the coaster is gone from its code's output.
    await page.locator('#parts-rail [data-part-id]:not([aria-current="true"])').click();
    await expect.poll(async () => (await pw<{ name: string } | null>(page, 'getCurrentObject'))?.name).toBe('Object 1');
    await expect.poll(async () => {
      const v = await pw<{ pieces?: unknown[]; parts?: { name: string }[] }>(page, 'listObjectParts');
      return `${v.pieces?.length}:${v.parts?.some(p => p.name === 'coaster')}`;
    }).toBe('1:false');
    expect(await pw<string>(page, 'getCode')).toMatch(/__pwPieces = \{\s*"?mode"?: ["']drop/);

    // Delete a stray piece via the API twin.
    await page.evaluate(async () => {
      const p = (window as unknown as { partwright: PW }).partwright;
      await p.runAndSave(`const { Manifold } = api;
return api.label(Manifold.cube([10, 10, 10], true), 'block').add(Manifold.cube([1, 1, 1], true).translate([20, 0, 0]));`, 'stray');
    });
    parts = await pw(page, 'listObjectParts');
    expect(parts.pieces).toHaveLength(2);
    await page.locator('#parts-rail [data-object-part="piece:1"]').click();
    await page.locator('#object-part-drawer [data-part-action="delete-piece"]').click();
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect.poll(async () => (await pw<{ pieces?: unknown[] }>(page, 'listObjectParts')).pieces?.length).toBe(1);
    expect(await pw<string>(page, 'getCode')).toContain('Partwright piece filter');
  });
});
