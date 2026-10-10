// E2E coverage for AI object addressing: object-scoped tools accept an optional
// `object` target (name / id / 0-based index) so the model acts on the object it
// names rather than the shared "current object" pointer the user can move from
// the object list mid-turn. (Objects were called "parts" before the rename; the
// legacy `part` target key and the *Part console aliases must keep working.)
// Exercised through the real executeTool dispatch and the window.partwright
// console API. Network-free — geometry is produced locally.

import { test, expect, type Page } from 'playwright/test';

async function waitForEngine(page: Page) {
  await page.waitForSelector('text=Ready', { timeout: 20_000 });
  await page.waitForFunction(
    () => !!(window as unknown as { partwright?: { createObject?: unknown } }).partwright?.createObject,
    { timeout: 20_000 },
  );
}

const cube = (s: number, marker: string) =>
  `// ${marker}\nconst { Manifold } = api; return Manifold.cube([${s}, ${s}, ${s}], true);`;

// Build a two-object session: "Object 1" (code A) + "Lid" (code B), leaving
// Object 1 focused so an `object` target has to do real work to reach Lid.
async function setupTwoParts(page: Page) {
  return page.evaluate(async ({ codeA, codeB }) => {
    interface PartsAPI {
      createSession: (name?: string) => Promise<{ id: string }>;
      runAndSave: (code: string, label?: string) => Promise<unknown>;
      createObject: (name?: string) => Promise<{ id: string; name: string }>;
      changeObject: (t: string | number) => Promise<unknown>;
      listObjects: () => { id: string; name: string; order: number; isCurrent: boolean }[];
    }
    const pw = (window as unknown as { partwright: PartsAPI }).partwright;
    await pw.createSession('targets');
    await pw.runAndSave(codeA, 'a1');          // Object 1
    const lid = await pw.createObject('Lid');
    await pw.runAndSave(codeB, 'b1');          // Lid (now current)
    await pw.changeObject('Object 1');         // refocus Object 1 by NAME
    const parts = pw.listObjects();
    return { lidId: lid.id, current: parts.find(p => p.isCurrent)?.name, names: parts.map(p => p.name) };
  }, { codeA: cube(10, 'PARTONE'), codeB: cube(6, 'LIDCODE') });
}

test.describe('AI object addressing', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('partwright-tour-completed', '1');
      try { localStorage.setItem('partwright-ai-settings-v1', JSON.stringify({ editorCollapsed: false })); } catch { /* ignore */ }
    });
  });

  test('console changeObject accepts name and 0-based index (and the changePart alias still works)', async ({ page }) => {
    await page.goto('/editor');
    await waitForEngine(page);
    const setup = await setupTwoParts(page);
    expect(setup.current).toBe('Object 1');        // refocus-by-name worked

    const out = await page.evaluate(async () => {
      interface PartsAPI {
        changeObject: (t: string | number) => Promise<unknown>;
        changePart: (t: string | number) => Promise<unknown>;
        listObjects: () => { name: string; isCurrent: boolean }[];
        listParts: () => { name: string; isCurrent: boolean }[];
        getCode: () => string;
      }
      const pw = (window as unknown as { partwright: PartsAPI }).partwright;
      await pw.changeObject('Lid');                 // by name
      const afterName = pw.listObjects().find(p => p.isCurrent)?.name;
      const nameCode = pw.getCode();
      await pw.changeObject(0);                     // by 0-based index → first object
      const afterIndex = pw.listObjects().find(p => p.isCurrent)?.name;
      await pw.changePart('Lid');                   // deprecated alias
      const afterAlias = pw.listParts().find(p => p.isCurrent)?.name;
      return { afterName, nameCode, afterIndex, afterAlias };
    });
    expect(out.afterName).toBe('Lid');
    expect(out.nameCode).toContain('LIDCODE');
    expect(out.afterIndex).toBe('Object 1');
    expect(out.afterAlias).toBe('Lid');
  });

  test('an object-scoped tool acts on the named object, not the current one', async ({ page }) => {
    await page.goto('/editor');
    await waitForEngine(page);
    await setupTwoParts(page);                       // Object 1 is current

    const out = await page.evaluate(async () => {
      const { executeTool, buildToolList } = await import('/src/ai/tools.ts');
      // Read Lid's code WITHOUT a prior changeObject — target it by name.
      const byName = await executeTool('getCode', { object: 'Lid' });
      // Read Object 1's code by index.
      const byIndex = await executeTool('getCode', { object: 0 });
      // Bad target → a clean error, not a wrong-object action.
      const bad = await executeTool('getCode', { object: 'Nope' });
      // The pre-rename `part` key still targets (old chats / habits).
      const legacy = await executeTool('getCode', { part: 'Lid' });
      // …and the pre-rename tool names still dispatch.
      const legacyList = await executeTool('listParts', {});
      const legacySwitch = await executeTool('changePart', { part: 'Lid' });
      await executeTool('changeObject', { object: 'Object 1' }); // restore focus
      const toggles = {
        vision: { views: true, resolution: 'medium', angles: 'auto' },
        scope: { runCode: true, saveVersions: true, paintFaces: true, sessionNotes: true },
        autoRetry: 0, maxIterations: 'medium', maxSpend: 'high', thinking: 'off',
        provider: 'anthropic', anthropicModel: 'claude-haiku-4-5', localModel: null,
        openaiModel: 'gpt-5-mini', geminiModel: 'gemini-flash-latest',
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const getCodeSchema = buildToolList(toggles as any).find(d => d.name === 'getCode')!.input_schema.properties as Record<string, unknown>;
      return {
        byName: byName.content, byNameErr: byName.isError,
        byIndex: byIndex.content, byIndexErr: byIndex.isError,
        badErr: bad.isError, badMsg: bad.content,
        legacy: legacy.content, legacyErr: legacy.isError,
        legacyList: legacyList.content, legacyListErr: legacyList.isError,
        legacySwitchErr: legacySwitch.isError, legacySwitch: legacySwitch.content,
        schemaKeys: Object.keys(getCodeSchema),
      };
    });

    expect(out.byNameErr).toBe(false);
    expect(out.byName).toContain('LIDCODE');         // reached Lid though Object 1 was current
    expect(out.byIndexErr).toBe(false);
    expect(out.byIndex).toContain('PARTONE');        // index 0 = Object 1
    expect(out.badErr).toBe(true);
    expect(out.badMsg).toMatch(/no matching object/i);
    expect(out.legacyErr).toBe(false);
    expect(out.legacy).toContain('LIDCODE');
    expect(out.legacyListErr).toBe(false);
    expect(out.legacyList).toContain('Lid');
    expect(out.legacySwitchErr).toBe(false);
    expect(out.legacySwitch).toContain('Lid');
    // The model is offered the new `object` key, not the ambiguous `part`.
    expect(out.schemaKeys).toContain('object');
    expect(out.schemaKeys).not.toContain('part');
  });

  test('runAndSave with an object target commits to that object only', async ({ page }) => {
    await page.goto('/editor');
    await waitForEngine(page);
    await setupTwoParts(page);                       // Object 1 current, each object has 1 version

    const out = await page.evaluate(async ({ newLid }) => {
      interface PartsAPI {
        changeObject: (t: string | number) => Promise<unknown>;
        listVersions: () => Promise<{ index: number }[]>;
        getCode: () => string;
      }
      const pw = (window as unknown as { partwright: PartsAPI }).partwright;
      const { executeTool } = await import('/src/ai/tools.ts');
      // Commit a new version to Lid while Object 1 is the current selection.
      const exec = await executeTool('runAndSave', { object: 'Lid', code: newLid, label: 'b2' });
      // Lid gained a version...
      await pw.changeObject('Lid');
      const lidVersions = (await pw.listVersions()).length;
      const lidCode = pw.getCode();
      // ...and Object 1 did not.
      await pw.changeObject('Object 1');
      const part1Versions = (await pw.listVersions()).length;
      const part1Code = pw.getCode();
      return { execErr: exec.isError, lidVersions, lidCode, part1Versions, part1Code };
    }, { newLid: cube(7, 'LIDV2') });

    expect(out.execErr).toBe(false);
    expect(out.lidVersions).toBe(2);                 // Lid: a1-equivalent + new
    expect(out.lidCode).toContain('LIDV2');
    expect(out.part1Versions).toBe(1);              // Object 1 untouched
    expect(out.part1Code).toContain('PARTONE');
  });
});
