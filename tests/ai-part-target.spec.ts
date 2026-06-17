// E2E coverage for AI part addressing: part-scoped tools accept an optional
// `part` target (name / id / 0-based index) so the model acts on the part it
// names rather than the shared "current part" pointer the user can move from the
// part menu mid-turn. Exercised through the real executeTool dispatch and the
// window.partwright console API. Network-free — geometry is produced locally.

import { test, expect, type Page } from 'playwright/test';

async function waitForEngine(page: Page) {
  await page.waitForSelector('text=Ready', { timeout: 20_000 });
  await page.waitForFunction(
    () => !!(window as unknown as { partwright?: { createPart?: unknown } }).partwright?.createPart,
    { timeout: 20_000 },
  );
}

const cube = (s: number, marker: string) =>
  `// ${marker}\nconst { Manifold } = api; return Manifold.cube([${s}, ${s}, ${s}], true);`;

// Build a two-part session: "Part 1" (code A) + "Lid" (code B), leaving Part 1
// focused so a `part` target has to do real work to reach Lid.
async function setupTwoParts(page: Page) {
  return page.evaluate(async ({ codeA, codeB }) => {
    interface PartsAPI {
      createSession: (name?: string) => Promise<{ id: string }>;
      runAndSave: (code: string, label?: string) => Promise<unknown>;
      createPart: (name?: string) => Promise<{ id: string; name: string }>;
      changePart: (t: string | number) => Promise<unknown>;
      listParts: () => { id: string; name: string; order: number; isCurrent: boolean }[];
    }
    const pw = (window as unknown as { partwright: PartsAPI }).partwright;
    await pw.createSession('targets');
    await pw.runAndSave(codeA, 'a1');          // Part 1
    const lid = await pw.createPart('Lid');
    await pw.runAndSave(codeB, 'b1');          // Lid (now current)
    await pw.changePart('Part 1');             // refocus Part 1 by NAME
    const parts = pw.listParts();
    return { lidId: lid.id, current: parts.find(p => p.isCurrent)?.name, names: parts.map(p => p.name) };
  }, { codeA: cube(10, 'PARTONE'), codeB: cube(6, 'LIDCODE') });
}

test.describe('AI part addressing', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('partwright-tour-completed', '1');
      try { localStorage.setItem('partwright-ai-settings-v1', JSON.stringify({ editorCollapsed: false })); } catch { /* ignore */ }
    });
  });

  test('console changePart accepts name and 0-based index', async ({ page }) => {
    await page.goto('/editor');
    await waitForEngine(page);
    const setup = await setupTwoParts(page);
    expect(setup.current).toBe('Part 1');          // refocus-by-name worked

    const out = await page.evaluate(async () => {
      interface PartsAPI {
        changePart: (t: string | number) => Promise<unknown>;
        listParts: () => { name: string; isCurrent: boolean }[];
        getCode: () => string;
      }
      const pw = (window as unknown as { partwright: PartsAPI }).partwright;
      await pw.changePart('Lid');                   // by name
      const afterName = pw.listParts().find(p => p.isCurrent)?.name;
      const nameCode = pw.getCode();
      await pw.changePart(0);                       // by 0-based index → first part
      const afterIndex = pw.listParts().find(p => p.isCurrent)?.name;
      return { afterName, nameCode, afterIndex };
    });
    expect(out.afterName).toBe('Lid');
    expect(out.nameCode).toContain('LIDCODE');
    expect(out.afterIndex).toBe('Part 1');
  });

  test('a part-scoped tool acts on the named part, not the current one', async ({ page }) => {
    await page.goto('/editor');
    await waitForEngine(page);
    await setupTwoParts(page);                       // Part 1 is current

    const out = await page.evaluate(async () => {
      const { executeTool } = await import('/src/ai/tools.ts');
      // Read Lid's code WITHOUT a prior changePart — target it by name.
      const byName = await executeTool('getCode', { part: 'Lid' });
      // Read Part 1's code by index.
      const byIndex = await executeTool('getCode', { part: 0 });
      // Bad target → a clean error, not a wrong-part action.
      const bad = await executeTool('getCode', { part: 'Nope' });
      return {
        byName: byName.content, byNameErr: byName.isError,
        byIndex: byIndex.content, byIndexErr: byIndex.isError,
        badErr: bad.isError, badMsg: bad.content,
      };
    });

    expect(out.byNameErr).toBe(false);
    expect(out.byName).toContain('LIDCODE');         // reached Lid though Part 1 was current
    expect(out.byIndexErr).toBe(false);
    expect(out.byIndex).toContain('PARTONE');        // index 0 = Part 1
    expect(out.badErr).toBe(true);
    expect(out.badMsg).toMatch(/no matching part/i);
  });

  test('runAndSave with a part target commits to that part only', async ({ page }) => {
    await page.goto('/editor');
    await waitForEngine(page);
    await setupTwoParts(page);                       // Part 1 current, each part has 1 version

    const out = await page.evaluate(async ({ newLid }) => {
      interface PartsAPI {
        changePart: (t: string | number) => Promise<unknown>;
        listVersions: () => Promise<{ index: number }[]>;
        getCode: () => string;
      }
      const pw = (window as unknown as { partwright: PartsAPI }).partwright;
      const { executeTool } = await import('/src/ai/tools.ts');
      // Commit a new version to Lid while Part 1 is the current selection.
      const exec = await executeTool('runAndSave', { part: 'Lid', code: newLid, label: 'b2' });
      // Lid gained a version...
      await pw.changePart('Lid');
      const lidVersions = (await pw.listVersions()).length;
      const lidCode = pw.getCode();
      // ...and Part 1 did not.
      await pw.changePart('Part 1');
      const part1Versions = (await pw.listVersions()).length;
      const part1Code = pw.getCode();
      return { execErr: exec.isError, lidVersions, lidCode, part1Versions, part1Code };
    }, { newLid: cube(7, 'LIDV2') });

    expect(out.execErr).toBe(false);
    expect(out.lidVersions).toBe(2);                 // Lid: a1-equivalent + new
    expect(out.lidCode).toContain('LIDV2');
    expect(out.part1Versions).toBe(1);              // Part 1 untouched
    expect(out.part1Code).toContain('PARTONE');
  });
});
