// Character Creator — the Realistic family (api.human) beside the Avatar one
// (api.sdf.figure), picked at the top of the panel (kemper/partwright#1170).
// A Realistic character generates `api.human` code with a
// `// @human-character` header; switching families keeps the shared settings;
// the console twin is `buildCharacter({ family: 'realistic', ... })`.

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
  getGeometryData: () => { isManifold?: boolean; componentCount?: number; triangleCount?: number } | null;
  buildCharacter: (spec: unknown, opts?: { save?: boolean; label?: string }) =>
    Promise<{ code?: string; error?: string; geometry?: { componentCount?: number; isManifold?: boolean }; version?: { label?: string } }>;
  getCharacterSpec: () => { spec?: Record<string, unknown>; family?: string; error?: string };
  listCharacterPresets: (family?: string) => Array<{ id: string; spec: Record<string, unknown> }>;
  randomCharacter: (opts?: unknown) => Promise<{ seed?: number; spec?: Record<string, unknown>; code?: string; error?: string }>;
};

/** Open the Character Creator from the command palette. */
async function openPanel(page: Page) {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
  await page.keyboard.press('ControlOrMeta+k');
  await page.locator('input[aria-label="Search commands"]').fill('Character Creator');
  await page.keyboard.press('Enter');
  const panel = page.getByRole('dialog', { name: 'Character Creator' });
  await expect(panel).toBeVisible();
  return panel;
}

test.describe('Character Creator: Realistic', () => {
  test.describe.configure({ timeout: 180_000 });

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('partwright-tour-completed', '1'));
  });

  test('buildCharacter builds a Realistic character and getCharacterSpec reads it back', async ({ page }) => {
    await page.goto('/editor');
    await waitForEngine(page);
    const out = await page.evaluate(async () => {
      const api = (window as unknown as { partwright: PW }).partwright;
      await api.createSession('realistic-api');
      const r = await api.buildCharacter({ family: 'realistic', body: { gender: 0.1, age: 40 }, hair: { style: 'bob' } }, { save: true, label: 'Realistic' });
      const read = api.getCharacterSpec();
      const bad = await api.buildCharacter({ family: 'realistic', hair: { style: 'shag' } });
      const badFamily = await api.buildCharacter({ family: 'cartoon' });
      const presets = api.listCharacterPresets('realistic');
      const avatarPresets = api.listCharacterPresets();
      return { r, code: api.getCode(), read, bad: bad.error, badFamily: badFamily.error, presets: presets.map(p => p.spec.family), avatarFamily: avatarPresets[0].spec.family ?? null };
    });
    expect(out.r.error).toBeUndefined();
    expect(out.r.geometry?.isManifold).toBe(true);
    expect(out.r.geometry?.componentCount).toBe(1);
    expect(out.r.version?.label).toBe('Realistic');
    expect(out.code).toMatch(/^\/\/ @human-character v1 /);
    expect(out.code).toContain('return api.human({');
    expect(out.read.family).toBe('realistic');
    expect((out.read.spec?.body as { age: number }).age).toBe(40);
    expect(out.bad).toMatch(/hair\.style/);
    expect(out.badFamily).toMatch(/family/);
    expect(new Set(out.presets)).toEqual(new Set(['realistic']));
    expect(out.avatarFamily).toBeNull();
  });

  test('the panel switches families, keeps shared settings, and restores the family on reopen', async ({ page }) => {
    await page.goto('/editor');
    await waitForEngine(page);
    await page.evaluate(async () => { await (window as unknown as { partwright: PW }).partwright.createSession('realistic-panel'); });

    const panel = await openPanel(page);
    const family = panel.getByRole('group', { name: 'Type', exact: true });
    // A fresh device opens on Realistic.
    await expect(family.getByRole('button', { name: 'Realistic' })).toHaveAttribute('aria-pressed', 'true');

    await panel.getByRole('list', { name: 'Realistic character presets', exact: true }).getByRole('button', { name: 'Knight' }).click();
    await page.getByRole('dialog', { name: 'Start a character' }).getByRole('button', { name: 'Replace', exact: true }).click();
    await page.waitForFunction(() => {
      const api = (window as unknown as { partwright: PW }).partwright;
      // The starter sphere is manifold too: wait for the knight's mesh.
      const g = api.getGeometryData();
      return api.getCode().includes('@human-character v1') && api.getCode().includes('cuirass') && !!g?.isManifold && (g.triangleCount ?? 0) > 50_000;
    }, undefined, { timeout: 90_000 });
    await expect(page.getByText(/^(Rendering|Running)/).first()).toBeHidden({ timeout: 90_000 });
    await page.screenshot({ path: 'test-results/character-realistic-knight.png' });
    await panel.getByText('Hat, props and accessories').click();
    await expect(panel.getByRole('combobox', { name: 'Right hand' })).toHaveValue('sword');

    // A shared setting: the hair colour carries over to the Avatar.
    await page.evaluate(async () => {
      const api = (window as unknown as { partwright: PW }).partwright;
      await api.buildCharacter({ ...api.getCharacterSpec().spec, colors: { ...(api.getCharacterSpec().spec!.colors as object), hair: '#abcdef' } });
    });
    await panel.getByRole('button', { name: 'Close' }).click();
    const reopened = await openPanel(page);
    await expect(reopened.getByRole('group', { name: 'Type', exact: true }).getByRole('button', { name: 'Realistic' })).toHaveAttribute('aria-pressed', 'true');

    await reopened.getByRole('group', { name: 'Type', exact: true }).getByRole('button', { name: 'Avatar' }).click();
    await page.waitForFunction(() => {
      const api = (window as unknown as { partwright: PW }).partwright;
      return api.getCode().includes('@character v2') && api.getCode().includes('#abcdef');
    }, undefined, { timeout: 120_000 });
    await expect(reopened.getByRole('list', { name: 'Character presets', exact: true })).toBeVisible();
    await expect(reopened.getByRole('list', { name: 'Realistic character presets', exact: true })).toBeHidden();
    await expect(page.getByText(/^(Rendering|Running)/).first()).toBeHidden({ timeout: 120_000 });
    await page.screenshot({ path: 'test-results/character-avatar-switched.png' });

    // Back to Realistic: the knight's armor (Realistic-only) is still there.
    await reopened.getByRole('group', { name: 'Type', exact: true }).getByRole('button', { name: 'Realistic' }).click();
    await page.waitForFunction(() => (window as unknown as { partwright: PW }).partwright.getCode().includes('cuirass'), undefined, { timeout: 90_000 });
  });

  test('the Realistic controls show and hide with their choices', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 1000 });
    await page.goto('/editor');
    await waitForEngine(page);
    await page.evaluate(async () => { await (window as unknown as { partwright: PW }).partwright.createSession('realistic-controls'); });
    const panel = await openPanel(page);
    await expect(panel.getByRole('combobox', { name: 'Sleeves' })).toBeVisible();
    await panel.getByRole('combobox', { name: 'Top' }).selectOption('none');
    const replace = page.getByRole('dialog', { name: 'Start a character' });
    if (await replace.isVisible().catch(() => false)) await replace.getByRole('button', { name: 'Replace', exact: true }).click();
    await expect(panel.getByRole('combobox', { name: 'Sleeves' })).toHaveCount(0);
    await expect(panel.getByRole('combobox', { name: 'Skirt length' })).toHaveCount(0);
    await panel.getByRole('combobox', { name: 'Bottom' }).selectOption('skirt');
    await expect(panel.getByRole('combobox', { name: 'Skirt length' })).toBeVisible();
    await page.screenshot({ path: 'test-results/character-realistic-panel.png' });
  });
});
