// End-to-end coverage for the AI-planning pointer workflow.
//
// Verifies the loop the docs promise:
//  1. Drop a pointer at a probed surface point;
//  2. List it back with the right anchor + status;
//  3. Preview the proposed paint without committing;
//  4. Commit, and the pointer's status flips to 'painted' while a real
//     color region appears on the model.
// Plus a smaller check that the AI tool layer dispatches `dropPointer`
// end-to-end so the chat surface is wired the same way the console API
// is.

import { test, expect, type Page } from 'playwright/test';

async function waitForEngine(page: Page) {
  await page.waitForSelector('text=Ready', { timeout: 20_000 });
  await page.waitForFunction(
    () => !!(window as unknown as { partwright?: { run?: unknown } }).partwright?.run,
    { timeout: 20_000 },
  );
}

test.describe('AI-planning pointers', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('partwright-tour-completed', '1'));
  });

  test('drop → list → preview → commit round-trip', async ({ page }) => {
    await page.goto('/editor');
    await waitForEngine(page);

    const result = await page.evaluate(async () => {
      const pw = (window as unknown as { partwright: {
        createSession: (n?: string) => Promise<unknown>;
        runAndSave: (code: string, label?: string) => Promise<unknown>;
        dropPointer: (opts: Record<string, unknown>) => Record<string, unknown>;
        listPointers: (opts?: Record<string, unknown>) => unknown;
        previewPointerPaint: (id: string, opts?: Record<string, unknown>) => unknown;
        commitPaintFromPointer: (id: string, opts?: Record<string, unknown>) => unknown;
        listRegions: () => unknown[];
      } }).partwright;
      await pw.createSession('pointers-e2e');
      await pw.runAndSave(
        'const { Manifold } = api; return Manifold.cube([10, 10, 10], true);',
        'cube',
      );

      // Drop a pointer on the top face at the centroid (0, 0, 5).
      const created = pw.dropPointer({
        label: 'top_face',
        point: [0, 0, 5],
        normal: [0, 0, 1],
        paintHint: { kind: 'coplanar', normalToleranceDeg: 5 },
        proposedColor: [0.2, 0.6, 0.95],
      }) as { id?: string; error?: string };

      const list = pw.listPointers() as Array<{ id: string; label: string; status: string; paintHint?: unknown }>;
      const preview = pw.previewPointerPaint(created.id as string) as { triangleCount?: number; error?: string };
      const regionsBefore = pw.listRegions().length;
      const commit = pw.commitPaintFromPointer(created.id as string) as { regionId?: number; error?: string };
      const regionsAfter = pw.listRegions().length;
      const after = pw.listPointers() as Array<{ id: string; status: string; regionId?: number }>;
      return { created, list, preview, commit, regionsBefore, regionsAfter, after };
    });

    expect(result.created.error).toBeUndefined();
    expect(typeof result.created.id).toBe('string');
    expect(result.list.length).toBe(1);
    expect(result.list[0].label).toBe('top_face');
    expect(result.list[0].status).toBe('proposed');
    expect(result.preview.error).toBeUndefined();
    expect(result.preview.triangleCount).toBeGreaterThan(0);
    expect(result.commit.error).toBeUndefined();
    expect(typeof result.commit.regionId).toBe('number');
    // The commit added exactly one paint region.
    expect(result.regionsAfter).toBe(result.regionsBefore + 1);
    // The pointer is still there but flipped to 'painted'.
    expect(result.after.length).toBe(1);
    expect(result.after[0].status).toBe('painted');
    expect(result.after[0].regionId).toBe(result.commit.regionId);
  });

  test('AI tool layer dispatches dropPointer + listPointers end-to-end', async ({ page }) => {
    await page.goto('/editor');
    await waitForEngine(page);

    const tools = await page.evaluate(async () => {
      const mod = await import('/src/ai/tools.ts');
      const baseToggles = {
        vision: { views: true, resolution: 'medium', angles: 'auto' },
        scope: { runCode: true, saveVersions: true, paintFaces: true, sessionNotes: true },
        autoRetry: 0,
        maxIterations: 'medium',
        maxSpend: 'high',
        thinking: 'off',
        provider: 'anthropic',
        anthropicModel: 'claude-haiku-4-5',
        localModel: null,
        openaiModel: 'gpt-5-mini',
        geminiModel: 'gemini-flash-latest',
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const names = mod.buildToolList(baseToggles as any).map((d: { name: string }) => d.name);

      const pw = (window as unknown as { partwright: {
        createSession: (n?: string) => Promise<unknown>;
        runAndSave: (code: string, label?: string) => Promise<unknown>;
      } }).partwright;
      await pw.createSession('pointers-tool-dispatch');
      await pw.runAndSave('const { Manifold } = api; return Manifold.cube([10, 10, 10], true);', 'cube');

      const drop = await mod.executeTool('dropPointer', {
        label: 'top',
        point: [0, 0, 5],
        normal: [0, 0, 1],
        paintHint: { kind: 'coplanar', normalToleranceDeg: 5 },
      });
      const list = await mod.executeTool('listPointers', {});
      return { names, drop, list };
    });

    // Every pointer tool must appear in the chat tool list under default scope.
    for (const name of [
      'dropPointer', 'listPointers', 'previewPointerPaint',
      'commitPaintFromPointer', 'commitPaintFromPointers',
      'hidePointers', 'showPointers', 'clearPointers', 'getPointerCoverageReport',
    ]) {
      expect(tools.names).toContain(name);
    }

    expect(tools.drop.isError).toBe(false);
    expect(tools.drop.content).not.toContain('Unknown tool');
    const dropped = JSON.parse(tools.drop.content) as { id?: string; label?: string };
    expect(dropped.label).toBe('top');
    expect(typeof dropped.id).toBe('string');

    expect(tools.list.isError).toBe(false);
    const listed = JSON.parse(tools.list.content) as Array<{ label: string }>;
    expect(listed.length).toBe(1);
    expect(listed[0].label).toBe('top');
  });
});
