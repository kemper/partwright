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
    expect(out.code).toContain('@character v2');
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
    await panel.getByRole('group', { name: 'Character presets' }).getByRole('button', { name: 'Chibi' }).click();
    // A fresh session has starter code, so generating asks to replace it once.
    await page.getByRole('dialog', { name: 'Start a character' })
      .getByRole('button', { name: 'Replace', exact: true }).click();
    await page.waitForFunction(
      () => (window as unknown as { partwright: PW }).partwright.getCode().includes('@character v2'),
      { timeout: 60_000 },
    );

    // Save commits a version.
    await panel.getByRole('button', { name: 'Save to session' }).click();
    await expect(page.getByText(/Character saved/)).toBeVisible({ timeout: 60_000 });

    const code = await page.evaluate(() => (window as unknown as { partwright: PW }).partwright.getCode());
    expect(code).toContain('@character v2');
    expect(code).toContain('headsTall');
  });

  test('Funko style + anime hair + held ball builds a manifold figure and the panel restores it', async ({ page }) => {
    await page.goto('/editor');
    await waitForEngine(page);
    await page.evaluate(async () => (window as unknown as { partwright: PW }).partwright.createSession('character-funko'));

    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
    await page.keyboard.press('ControlOrMeta+k');
    await page.locator('input[aria-label="Search commands"]').fill('Character Creator');
    await page.keyboard.press('Enter');
    const panel = page.getByRole('dialog', { name: 'Character Creator' });
    await expect(panel).toBeVisible();

    // Style → Funko (the starter code asks to be replaced once).
    await panel.getByRole('group', { name: 'Proportions' }).getByRole('button', { name: 'Funko' }).click();
    await page.getByRole('dialog', { name: 'Start a character' })
      .getByRole('button', { name: 'Replace', exact: true }).click();
    await expect(panel.getByRole('group', { name: 'Proportions' }).getByRole('button', { name: 'Funko' }))
      .toHaveAttribute('aria-pressed', 'true');

    // Hair → anime reveals the anime-only lock knobs.
    await expect(panel.getByText('Lock shape')).toHaveCount(0);
    await panel.getByRole('combobox', { name: 'Style', exact: true }).selectOption('anime');
    await expect(panel.getByText('Lock shape')).toBeVisible();

    // Holding → ball reveals the ball controls and hides the arm sliders.
    await panel.getByRole('group', { name: 'Holding' }).getByRole('button', { name: 'Ball' }).click();
    await expect(panel.getByText('Ball size')).toBeVisible();
    await expect(panel.getByText('Arms out')).toHaveCount(0);

    // Save builds + commits the figure.
    await panel.getByRole('button', { name: 'Save to session' }).click();
    await expect(page.getByText(/Character saved/)).toBeVisible({ timeout: 120_000 });

    const out = await page.evaluate(() => {
      const pw = (window as unknown as { partwright: PW & { getGeometryData: () => { isManifold?: boolean; triangleCount?: number } } }).partwright;
      return { code: pw.getCode(), geo: pw.getGeometryData() };
    });
    expect(out.code).toContain('@character v2');
    expect(out.code).toContain("proportions: 'funko'");
    expect(out.code).toContain("style: 'anime'");
    expect(out.code).toContain('F.heldSphere(rig)');
    expect(out.code).toContain("pattern: 'soccer'");
    expect(out.code).toContain("return F.place(model, rig, { face: '+X' });");
    expect(out.geo.isManifold).toBe(true);
    expect(out.geo.triangleCount ?? 0).toBeGreaterThan(1000);

    // getCharacterSpec reads the same spec back (UI ↔ API parity).
    const read = await page.evaluate(() => (window as unknown as { partwright: { getCharacterSpec: () => { spec?: { body: { proportions: string }; hair: { style: string }; pose: { hold: { kind: string } } } } } }).partwright.getCharacterSpec());
    expect(read.spec?.body.proportions).toBe('funko');
    expect(read.spec?.hair.style).toBe('anime');
    expect(read.spec?.pose.hold.kind).toBe('ball');

    // Close + reopen: the controls restore from the @character header.
    await panel.getByRole('button', { name: 'Close' }).click();
    await expect(panel).toHaveCount(0);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
    await page.keyboard.press('ControlOrMeta+k');
    await page.locator('input[aria-label="Search commands"]').fill('Character Creator');
    await page.keyboard.press('Enter');
    const reopened = page.getByRole('dialog', { name: 'Character Creator' });
    await expect(reopened.getByRole('group', { name: 'Proportions' }).getByRole('button', { name: 'Funko' }))
      .toHaveAttribute('aria-pressed', 'true');
    await expect(reopened.getByRole('group', { name: 'Holding' }).getByRole('button', { name: 'Ball' }))
      .toHaveAttribute('aria-pressed', 'true');
    await expect(reopened.getByRole('combobox', { name: 'Style', exact: true })).toHaveValue('anime');
    await expect(reopened.getByText('Lock shape')).toBeVisible();
  });

  test('Funko style + shag hair (spiky crown) builds a manifold figure with only the shag knobs shown', async ({ page }) => {
    await page.goto('/editor');
    await waitForEngine(page);
    await page.evaluate(async () => (window as unknown as { partwright: PW }).partwright.createSession('character-shag'));

    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
    await page.keyboard.press('ControlOrMeta+k');
    await page.locator('input[aria-label="Search commands"]').fill('Character Creator');
    await page.keyboard.press('Enter');
    const panel = page.getByRole('dialog', { name: 'Character Creator' });
    await expect(panel).toBeVisible();

    await panel.getByRole('group', { name: 'Proportions' }).getByRole('button', { name: 'Funko' }).click();
    await page.getByRole('dialog', { name: 'Start a character' })
      .getByRole('button', { name: 'Replace', exact: true }).click();

    // Hair → shag reveals the shag knobs (and not the anime-only ones).
    await expect(panel.getByText('Raggedness')).toHaveCount(0);
    await panel.getByRole('combobox', { name: 'Style', exact: true }).selectOption('shag');
    await expect(panel.getByRole('combobox', { name: 'Crown', exact: true })).toHaveValue('spiky');
    for (const label of ['Layers', 'Raggedness', 'Flare', 'Spike', 'Fringe']) await expect(panel.getByText(label, { exact: true })).toBeVisible();
    await expect(panel.getByText('Lock shape')).toHaveCount(0);
    await expect(panel.getByText('Swoop')).toHaveCount(0);

    await panel.getByRole('button', { name: 'Save to session' }).click();
    await expect(page.getByText(/Character saved/)).toBeVisible({ timeout: 120_000 });
    const out = await page.evaluate(() => {
      const pw = (window as unknown as { partwright: PW & { getGeometryData: () => { isManifold?: boolean; triangleCount?: number } } }).partwright;
      return { code: pw.getCode(), geo: pw.getGeometryData() };
    });
    expect(out.code).toContain("F.hair(rig, { style: 'shag', length: 'mid', on: head })");
    expect(out.geo.isManifold).toBe(true);
    expect(out.geo.triangleCount ?? 0).toBeGreaterThan(1000);
    await page.screenshot({ path: 'test-results/character-creator-shag.png' });

    // The spec API takes the shag knobs too (UI ↔ API parity) and the panel restores them.
    const api = await page.evaluate(async () => {
      const pw = (window as unknown as { partwright: PW & { getCharacterSpec: () => { spec?: { hair: { style: string; crown: string; layers: number } } } } }).partwright;
      const res = await pw.buildCharacter({ body: { proportions: 'funko' }, hair: { style: 'shag', crown: 'tousled', layers: 2, raggedness: 1.5 } });
      return { code: res.code, error: res.error, spec: pw.getCharacterSpec().spec };
    });
    expect(api.error).toBeUndefined();
    expect(api.code).toContain("crown: 'tousled', layers: 2, raggedness: 1.5");
    expect(api.spec?.hair).toMatchObject({ style: 'shag', crown: 'tousled', layers: 2 });
  });

  test('buildCharacter validates every field and getCharacterSpec needs a header', async ({ page }) => {
    await page.goto('/editor');
    await waitForEngine(page);
    const out = await page.evaluate(async () => {
      const pw = (window as unknown as { partwright: PW & { getCharacterSpec: () => { error?: string } } }).partwright;
      await pw.createSession('character-validate');
      const bad = await pw.buildCharacter({ body: { proportions: 'anime' }, hair: { chunk: 9 } });
      return { bad: bad.error ?? '', noHeader: pw.getCharacterSpec().error ?? '' };
    });
    expect(out.bad).toContain('body.proportions');
    expect(out.bad).toContain('hair.chunk');
    expect(out.noHeader).toContain('@character');
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
    await panel.getByRole('group', { name: 'Character presets' }).getByRole('button', { name: 'Chibi' }).click();   // switch mid-build

    await page.waitForFunction(
      () => (window as unknown as { partwright: PW }).partwright.getCode().includes('headsTall: 3.2'),
      { timeout: 60_000 },
    );
    // The mid-build switch terminated the running build at least once.
    expect(restarts.some(r => /cancel/i.test(r))).toBe(true);
  });
});
