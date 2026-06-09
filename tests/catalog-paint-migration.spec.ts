// The catalog was migrated so that label/box/slab/cylinder paint lives in the
// model CODE as api.paint.* calls instead of the colorRegions sidecar (see
// scripts/convert-catalog-paint.mjs). This guards that a migrated entry loaded
// through the real catalog-load path still renders its colours — and that they
// come from the code (model underlay), not from saved user paint regions.

import { test, expect, type Page } from 'playwright/test';

async function waitForEngine(page: Page) {
  await page.waitForSelector('text=Ready', { timeout: 25_000 });
  await page.waitForFunction(
    () => !!(window as unknown as { partwright?: { run?: unknown } }).partwright?.run,
    { timeout: 25_000 },
  );
}

test('migrated catalog entry renders colours from code, not the paint sidecar', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('partwright-tour-completed', '1'));
  // companion_cube: body/hearts/edges were byLabel paint, now api.paint.label in code.
  await page.goto('/editor?catalog=companion_cube.partwright.json');
  await waitForEngine(page);
  await page.waitForTimeout(3500); // import + run + paint resolve

  const out = await page.evaluate(async () => {
    const regions = await import('/src/color/regions.ts');
    return {
      userRegions: regions.getRegions().length,
      modelRegions: regions.getModelRegions().map(r => r.name).sort(),
    };
  });

  // No user paint regions — the colours are entirely code-derived (the migration
  // emptied the sidecar for fully-convertible entries).
  expect(out.userRegions).toBe(0);
  // The three label colours surfaced as the model underlay.
  expect(out.modelRegions).toEqual(['paint·label body', 'paint·label edges', 'paint·label hearts']);
});
