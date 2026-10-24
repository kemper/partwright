// Part colour + paint scope from the Objects list (#1003):
//   1. Each part's swatch in the Objects list fills the whole part (a byLabel
//      region — the same descriptor partwright.paintByLabel / setObjectPartColor
//      produce), re-picking recolours in place, the row flips to "painted", and
//      ↺ Reset returns it to the code colour.
//   2. Selecting a part in the rail and the Paint panel's "Paint within" are
//      ONE scope: selecting sets it, picking "Whole model" clears the
//      selection, and Replace says it stays inside the part.
//
// Uses `dispatchEvent('click')` to dodge the first-paint onboarding backdrop.

import { test, expect } from 'playwright/test';

async function openEditorWithCode(page: import('playwright/test').Page, code: string) {
  await page.addInitScript(() => localStorage.setItem('partwright-tour-completed', '1'));
  await page.goto('/editor');
  await page.waitForSelector('text=Ready', { timeout: 15000 });
  await page.evaluate(async (src) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pw = (window as any).partwright;
    await pw.createSession('labels');
    await pw.runAndSave(src, 'v1');
  }, code);
}

const HEAD = `
  const { Manifold } = api;
  const head = api.label(Manifold.sphere(20, 32), 'head');
  const eye = api.label(Manifold.sphere(5, 16).translate([-8, 14, 5]), 'eye');
  return head.add(eye);
`;

test.describe('part colour and scope from the Objects list (#1003)', () => {
  test('the rail swatch fills the whole part, recolours in place, and resets', async ({ page }) => {
    await openEditorWithCode(page, HEAD);
    const swatch = page.locator('#parts-rail button[data-action="set-part-color"][data-part="eye"]');
    await expect(swatch).toHaveCount(1);

    const pickColor = async (hex: string) => {
      await swatch.dispatchEvent('click');
      await page.waitForSelector('[data-testid="color-picker"]');
      await page.evaluate((h) => {
        const ov = document.querySelector('[data-testid="color-picker"]')!;
        const ci = ov.querySelector('input[data-action="custom-color"]') as HTMLInputElement;
        ci.value = h;
        ci.dispatchEvent(new Event('input', { bubbles: true }));
      }, hex);
      await page.locator('[data-testid="color-picker"] button:has-text("Apply")').dispatchEvent('click');
      await page.waitForSelector('[data-testid="color-picker"]', { state: 'detached' });
    };

    const expectedTris = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const labels: { name: string; triangleCount: number }[] = (window as any).partwright.listLabels().labels;
      return labels.find(l => l.name === 'eye')?.triangleCount ?? 0;
    });
    expect(expectedTris).toBeGreaterThan(0);

    await pickColor('#00ff00');
    const eyeRegions = () => page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const regions = (window as any).partwright.listRegions() as { name: string; color: [number, number, number]; triangles: number }[];
      return regions.filter(r => r.name === 'eye');
    });
    let regions = await eyeRegions();
    expect(regions).toHaveLength(1);
    expect(regions[0].color.map(c => Math.round(c * 255))).toEqual([0, 255, 0]);
    expect(regions[0].triangles).toBe(expectedTris);
    await expect(page.locator('#parts-rail [data-object-part="part:eye"] [data-color-source="painted"]')).toBeVisible();

    // Re-picking recolours the same region rather than stacking a duplicate.
    await pickColor('#0000ff');
    regions = await eyeRegions();
    expect(regions).toHaveLength(1);
    expect(regions[0].color.map(c => Math.round(c * 255))).toEqual([0, 0, 255]);

    // Select the part → its drawer offers ↺ Reset, which drops the fill.
    await page.locator('#parts-rail [data-object-part="part:eye"]').click();
    await page.locator('#object-part-drawer [data-part-action="reset-color"]').click();
    await expect.poll(async () => (await eyeRegions()).length).toBe(0);
  });

  test('the rail selection and "Paint within" are one scope', async ({ page }) => {
    await openEditorWithCode(page, HEAD);
    await page.locator('#paint-toggle').dispatchEvent('click');
    await page.waitForSelector('#paint-picker-panel:not(.hidden)');
    const within = page.locator('#paint-within-part');
    await expect(within).toHaveValue('');

    await page.evaluate(() => (window as unknown as { partwright: { selectObjectPart(n: string): unknown } }).partwright.selectObjectPart('eye'));
    await expect(within).toHaveValue('eye');
    // The Replace tool says it will stay inside the part.
    await page.locator('#paint-picker-panel button', { hasText: 'Replace' }).first().dispatchEvent('click');
    await expect(page.locator('#paint-picker-panel button', { hasText: 'Replace in eye' })).toHaveCount(1);

    // "Whole model" in the picker clears the rail selection too.
    await within.selectOption('');
    await expect.poll(() => page.evaluate(() => (window as unknown as { partwright: { getSelectedObjectPart(): unknown } }).partwright.getSelectedObjectPart())).toBeNull();
    // …and picking a part there selects it in the rail.
    await within.selectOption('head');
    await expect.poll(() => page.evaluate(() => (window as unknown as { partwright: { getSelectedObjectPart(): { part?: string } | null } }).partwright.getSelectedObjectPart()?.part)).toBe('head');
  });
});
