// E2E coverage for part grouping: parts sharing a group name are threaded under
// a collapsible group header in the parts rail. Exercises the console API
// (setPartGroup), the rail's threaded rendering + collapse, the multi-select
// "Group…" action, and persistence across a reload. Network-free.

import { test, expect, type Page } from 'playwright/test';

interface GroupAPI {
  createSession: (name?: string) => Promise<{ id: string }>;
  runAndSave: (code: string, label?: string) => Promise<unknown>;
  createPart: (name?: string) => Promise<{ id: string; name: string } | { error: string }>;
  setPartGroup: (targets: unknown, group: string | null) => Promise<{ grouped: number; group: string | null } | { error: string }>;
  listParts: () => { id: string; name: string; order: number; group?: string; isCurrent: boolean }[];
}

async function waitForEngine(page: Page) {
  await page.waitForSelector('text=Ready', { timeout: 20_000 });
  await page.waitForFunction(
    () => !!(window as unknown as { partwright?: { setPartGroup?: unknown } }).partwright?.setPartGroup,
    { timeout: 20_000 },
  );
}

const cube = (s: number, marker: string) =>
  `// ${marker}\nconst { Manifold } = api; return Manifold.cube([${s}, ${s}, ${s}], true);`;

async function seedThreeParts(page: Page, sessionName: string) {
  await page.evaluate(async ({ code, sessionName }) => {
    const pw = (window as unknown as { partwright: GroupAPI }).partwright;
    await pw.createSession(sessionName);
    await pw.runAndSave(code, 'a1');   // Part 1
    await pw.createPart('Helmet');
    await pw.createPart('Chestplate');
  }, { code: cube(10, 'A1'), sessionName });
}

test.describe('Part grouping', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('partwright-tour-completed', '1');
      try {
        localStorage.setItem('partwright-ai-settings-v1', JSON.stringify({ editorCollapsed: false }));
      } catch { /* ignore */ }
    });
  });

  test('setPartGroup threads parts under a collapsible group header', async ({ page }) => {
    await page.goto('/editor');
    await waitForEngine(page);
    await seedThreeParts(page, 'group-api');

    // Group the two armor parts via the console API.
    const res = await page.evaluate(async () => {
      const pw = (window as unknown as { partwright: GroupAPI }).partwright;
      return pw.setPartGroup(['Helmet', 'Chestplate'], 'Armor');
    });
    expect(res).toMatchObject({ grouped: 2, group: 'Armor' });

    const list = page.locator('#parts-list');
    // The group header renders, holding both members (still mounted, expanded).
    const groupWrap = list.locator('[data-group="Armor"]');
    await expect(groupWrap).toHaveCount(1);
    await expect(list.locator('[data-group-header="Armor"]')).toBeVisible();
    await expect(groupWrap.locator('[data-part-id]')).toHaveCount(2);
    // The ungrouped part stays at the top level (outside any group wrap).
    await expect(list.locator('[data-part-id]')).toHaveCount(3);

    // Collapsing the group hides its member rows (header remains).
    await page.locator('[data-group-header="Armor"]').click();
    await expect(groupWrap.locator('[data-part-id]')).toHaveCount(0);
    await expect(list.locator('[data-part-id]')).toHaveCount(1);

    // Expanding restores them.
    await page.locator('[data-group-header="Armor"]').click();
    await expect(groupWrap.locator('[data-part-id]')).toHaveCount(2);
  });

  test('the multi-select "Group…" action groups the checked parts', async ({ page }) => {
    await page.goto('/editor');
    await waitForEngine(page);
    await seedThreeParts(page, 'group-ui');

    const list = page.locator('#parts-list');
    await expect(list.locator('[data-part-id]')).toHaveCount(3);

    const checkbox = (name: string) =>
      list.locator('[data-part-id]', { hasText: name }).locator('input[type="checkbox"]');
    await checkbox('Helmet').click();
    await checkbox('Chestplate').click();

    // The action bar offers a Group button; clicking opens a name prompt.
    const groupBtn = page.locator('#btn-group-parts');
    await expect(groupBtn).toBeVisible();
    await groupBtn.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.locator('input[type="text"]').fill('Armor');
    await dialog.getByRole('button', { name: 'Group' }).click();

    // Both parts now carry the group, and the rail shows the threaded header.
    await expect
      .poll(() => page.evaluate(() =>
        (window as unknown as { partwright: GroupAPI }).partwright.listParts()
          .filter(p => p.group === 'Armor').length))
      .toBe(2);
    await expect(list.locator('[data-group="Armor"]')).toHaveCount(1);
  });

  test('ungroup from the group header clears the group', async ({ page }) => {
    await page.goto('/editor');
    await waitForEngine(page);
    await seedThreeParts(page, 'ungroup');

    await page.evaluate(async () => {
      const pw = (window as unknown as { partwright: GroupAPI }).partwright;
      await pw.setPartGroup(['Helmet', 'Chestplate'], 'Armor');
    });

    const list = page.locator('#parts-list');
    await expect(list.locator('[data-group="Armor"]')).toHaveCount(1);

    // The header's ungroup button removes the group from every member.
    await page.locator('[data-group-header="Armor"] button[aria-label="Ungroup — remove this group"]').click();

    await expect(list.locator('[data-group="Armor"]')).toHaveCount(0);
    await expect
      .poll(() => page.evaluate(() =>
        (window as unknown as { partwright: GroupAPI }).partwright.listParts()
          .every(p => !p.group)))
      .toBe(true);
  });

  test('groups persist across a reload', async ({ page }) => {
    await page.goto('/editor');
    await waitForEngine(page);

    const sessionId = await page.evaluate(async ({ code }) => {
      const pw = (window as unknown as { partwright: GroupAPI }).partwright;
      const s = await pw.createSession('group-persist');
      await pw.runAndSave(code, 'a1');
      await pw.createPart('Helmet');
      await pw.createPart('Chestplate');
      await pw.setPartGroup(['Helmet', 'Chestplate'], 'Armor');
      return s.id;
    }, { code: cube(10, 'A1') });

    // Reload by URL — bootstrap must re-open the session and its parts' groups.
    await page.goto(`/editor?session=${sessionId}`);
    await waitForEngine(page);

    const groups = await page.evaluate(() =>
      (window as unknown as { partwright: GroupAPI }).partwright.listParts()
        .map(p => p.group ?? null));
    expect(groups.filter(g => g === 'Armor')).toHaveLength(2);
  });
});
