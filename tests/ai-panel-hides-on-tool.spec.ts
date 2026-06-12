// Opening a hands-on viewport tool panel (Customize, Paint, …) steps the docked
// AI drawer out of the way — once the user is driving a tool by hand they're not
// chatting, and the AI column would otherwise sit underneath the tool panel and
// be easy to miss. Every tool panel funnels through openViewportPanel(), so this
// covers the whole family via the auto-revealing Customize panel.

import { test, expect, type Page } from 'playwright/test';
import { openAiPanel, waitForEditorReady } from './helpers/aiPanel';

const PARAM_MODEL = `const { Manifold } = api;
const p = api.params({ width: { type: 'number', default: 20, min: 10, max: 100 } });
return Manifold.cube([p.width, p.width, p.width], true);`;

async function waitForEngine(page: Page) {
  await waitForEditorReady(page);
  await page.waitForFunction(
    () => !!(window as unknown as { partwright?: { run?: unknown } }).partwright?.run,
    { timeout: 20_000 },
  );
}

test.describe('AI panel yields to viewport tools', () => {
  test('opening the Customize panel hides the AI panel', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('partwright-tour-completed', '1'));
    await page.goto('/editor');
    await waitForEngine(page);

    await openAiPanel(page);
    await expect(page.locator('#ai-panel')).toBeVisible();

    // Run a customizable model — the Customize panel auto-reveals through the
    // shared openViewportPanel() chokepoint.
    await page.evaluate(
      (code) =>
        (window as unknown as { partwright: { run: (c: string) => Promise<unknown> } }).partwright.run(code),
      PARAM_MODEL,
    );

    await expect(page.locator('#params-panel')).toBeVisible();
    await expect(page.locator('#ai-panel')).toBeHidden();
  });
});
