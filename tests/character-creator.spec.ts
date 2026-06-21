// Character Creator — the no-code GUI over the SDF figure system. The panel
// edits a CharacterSpec and generates self-contained `api.sdf.figure` code; the
// console twin is `partwright.buildCharacter(spec, { save })` (UI ↔ API parity).
// The generated code embeds the spec as a `// @character` header so re-opening
// the panel restores every control.

import { test, expect, type Page } from 'playwright/test';

async function waitForEngine(page: Page) {
  await page.waitForSelector('text=Ready', { timeout: 20_000 });
  await page.waitForFunction(
    () => !!(window as unknown as { partwright?: { run?: unknown } }).partwright?.run,
    { timeout: 20_000 },
  );
}

type PW = {
  createSession: (n?: string) => Promise<unknown>;
  getCode: () => string;
  buildCharacter: (spec: unknown, opts?: { save?: boolean; label?: string }) =>
    Promise<{ code: string; error?: string; geometry?: { triangleCount?: number; componentCount?: number; isManifold?: boolean }; version?: { label?: string } }>;
};

test.describe('Character Creator', () => {
  // SDF figure rebuilds are heavy (~20s each); a save path does two, so give
  // these tests plenty of headroom over the default 30s.
  test.describe.configure({ timeout: 180_000 });

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('partwright-tour-completed', '1'));
  });

  test('buildCharacter generates a manifold figure and round-trips the spec', async ({ page }) => {
    await page.goto('/editor');
    await waitForEngine(page);

    const out = await page.evaluate(async () => {
      const pw = (window as unknown as { partwright: PW }).partwright;
      await pw.createSession('character-api');
      // A minimal spec patch — normalizeSpec fills the rest from defaults.
      const spec = {
        body: { height: 60, sex: 'female', bust: 0.4 },
        hair: { style: 'bun' },
        colors: { skin: '#c68642', top: '#aa3366' },
      };
      const r = await pw.buildCharacter(spec, { save: true, label: 'My character' });
      return { r, code: pw.getCode() };
    });

    expect(out.r.error).toBeUndefined();
    expect(out.r.geometry?.isManifold).toBe(true);
    expect(out.r.geometry?.componentCount).toBe(1);
    expect(out.r.geometry?.triangleCount ?? 0).toBeGreaterThan(1000);
    expect(out.r.version?.label).toBe('My character');
    // Self-contained, painted figure code with the round-trip header.
    expect(out.code).toContain('@character v1');
    expect(out.code).toContain('F.rig({');
    expect(out.code).toContain("api.paint.label('skin', '#c68642')");
    expect(out.code).toContain("F.hair(rig, { style: 'bun'");
  });

  test('rejects a non-object spec with an actionable error', async ({ page }) => {
    await page.goto('/editor');
    await waitForEngine(page);
    const err = await page.evaluate(async () => {
      const pw = (window as unknown as { partwright: PW }).partwright;
      const r = await pw.buildCharacter(null as unknown);
      return r.error ?? '';
    });
    expect(err).toContain('spec');
  });

  test('the panel opens, a preset builds a figure, and Save commits a version', async ({ page }) => {
    await page.goto('/editor');
    await waitForEngine(page);

    await page.evaluate(async () => {
      const pw = (window as unknown as { partwright: PW }).partwright;
      await pw.createSession('character-panel');
    });

    // Open the Character Creator from the command palette.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
    await page.keyboard.press('ControlOrMeta+k');
    const palette = page.locator('input[aria-label="Search commands"]');
    await palette.fill('Character Creator');
    await page.keyboard.press('Enter');

    const panel = page.getByRole('dialog', { name: 'Character Creator' });
    await expect(panel).toBeVisible();

    // Pick a preset — this generates and live-previews the figure.
    await panel.getByRole('button', { name: 'Chibi' }).click();
    // A fresh session has starter code, so generating asks to replace it once.
    await page.getByRole('dialog', { name: 'Start a character' })
      .getByRole('button', { name: 'Replace', exact: true }).click();
    await page.waitForFunction(
      () => (window as unknown as { partwright: PW }).partwright.getCode().includes('@character v1'),
      { timeout: 60_000 },
    );

    // Save commits a version.
    await panel.getByRole('button', { name: 'Save to session' }).click();
    await expect(page.getByText(/Character saved/)).toBeVisible({ timeout: 60_000 });

    const code = await page.evaluate(() => (window as unknown as { partwright: PW }).partwright.getCode());
    expect(code).toContain('@character v1');
    expect(code).toContain('headsTall');
  });

  test('switching presets mid-build cancels the in-flight render (no stacking)', async ({ page }) => {
    // A figure rebuild is heavy; without cancellation a second preset would start
    // a build while the first kept churning in the worker. Switching mid-build
    // must terminate the prior build (worker restart) so previews don't stack.
    const restarts: string[] = [];
    page.on('console', m => { if (m.text().includes('[EngineWorker]')) restarts.push(m.text()); });

    await page.goto('/editor');
    await waitForEngine(page);
    await page.evaluate(async () => (window as unknown as { partwright: PW }).partwright.createSession('character-cancel'));

    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
    await page.keyboard.press('ControlOrMeta+k');
    await page.locator('input[aria-label="Search commands"]').fill('Character Creator');
    await page.keyboard.press('Enter');
    const panel = page.getByRole('dialog', { name: 'Character Creator' });

    await panel.getByRole('button', { name: 'Adult woman' }).click();
    await page.getByRole('dialog', { name: 'Start a character' })
      .getByRole('button', { name: 'Replace', exact: true }).click();
    await page.waitForTimeout(1500);                       // let the build start
    await panel.getByRole('button', { name: 'Chibi' }).click();   // switch mid-build

    await page.waitForFunction(
      () => (window as unknown as { partwright: PW }).partwright.getCode().includes('headsTall: 3.2'),
      { timeout: 60_000 },
    );
    // The mid-build switch terminated the running build at least once.
    expect(restarts.some(r => /cancel/i.test(r))).toBe(true);
  });
});
