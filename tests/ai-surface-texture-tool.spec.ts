// The in-app chat AI's single surface-texture tool: `applySurfaceTexture`
// replaces the eight per-texture bake tools (fuzzy/knit/cable/waffle/fur/
// woven/voronoi + smoothModel). It routes like the Surface panel: manifold-js
// sessions get the texture written INTO THE CODE (api.surface.<id> — stays
// parametric); other engines fall back to the bake path with the engine-bake
// warning. mode 'code'/'bake' force a path. The console twin is
// `partwright.applySurfaceTexture` (UI ↔ API ↔ tool parity).

import { test, expect, type Page } from 'playwright/test';

async function waitForEngine(page: Page) {
  await page.waitForSelector('text=Ready', { timeout: 20_000 });
  await page.waitForFunction(
    () => !!(window as unknown as { partwright?: { run?: unknown } }).partwright?.run,
    { timeout: 20_000 },
  );
}

const BASE_TOGGLES = {
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

test.describe('applySurfaceTexture chat tool', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('partwright-tour-completed', '1'));
  });

  test('replaces the per-texture bake tools and is save-gated', async ({ page }) => {
    await page.goto('/editor');
    await waitForEngine(page);

    const result = await page.evaluate(async (baseToggles) => {
      const tools = await import('/src/ai/tools.ts');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const listFor = (t: any) => tools.buildToolList(t).map((d: { name: string }) => d.name);
      const names = listFor(baseToggles);
      const namesNoSave = listFor({ ...baseToggles, scope: { ...baseToggles.scope, saveVersions: false } });
      return {
        hasNew: names.includes('applySurfaceTexture'),
        gatedOff: !namesNoSave.includes('applySurfaceTexture'),
        removed: ['applyFuzzySkin', 'applyKnitTexture', 'applyCableKnit', 'applyWaffleStitch',
          'applyFurVelvet', 'applyWovenFabric', 'applyVoronoiShell', 'smoothModel']
          .filter(n => names.includes(n)),
        bakeOnlyKept: ['applyVoronoiLamp', 'engraveModel', 'voxelizeModel'].every(n => names.includes(n)),
      };
    }, BASE_TOGGLES);

    expect(result.hasNew).toBe(true);
    expect(result.gatedOff).toBe(true);
    expect(result.removed).toEqual([]); // no per-texture bake tool remains listed
    expect(result.bakeOnlyKept).toBe(true); // engine-changing / cut ops stay
  });

  test('auto mode writes api.surface code on manifold-js; bake mode flattens', async ({ page }) => {
    await page.goto('/editor');
    await waitForEngine(page);

    const out = await page.evaluate(async () => {
      const tools = await import('/src/ai/tools.ts');
      const pw = (window as unknown as { partwright: {
        createSession: (n?: string) => Promise<unknown>;
        run: (code: string) => Promise<unknown>;
        getCode: () => string;
      } }).partwright;
      await pw.createSession('ai-surface-tool');
      await pw.run('const { Manifold } = api;\nreturn Manifold.sphere(10, 32);');

      const codeExec = await tools.executeTool('applySurfaceTexture', { id: 'fuzzy', opts: { amplitude: 0.4 } });
      const codeResult = JSON.parse(codeExec.content) as { path?: string; ok?: boolean; error?: string };
      const codeAfter = pw.getCode();

      // Forcing a bake on the same session flattens to an ofMesh wrapper.
      const bakeExec = await tools.executeTool('applySurfaceTexture', { id: 'smooth', opts: { iterations: 2 }, mode: 'bake' });
      const bakeResult = JSON.parse(bakeExec.content) as { path?: string; ok?: boolean; error?: string };
      const bakeAfter = pw.getCode();

      return {
        codeIsError: codeExec.isError, codeResult, codeAfter,
        bakeIsError: bakeExec.isError, bakeResult, bakeAfter,
      };
    });

    expect(out.codeIsError).toBe(false);
    expect(out.codeResult.path).toBe('code');
    expect(out.codeResult.ok).toBe(true);
    expect(out.codeAfter).toContain('api.surface.fuzzy({ amplitude: 0.4 });');
    expect(out.codeAfter).not.toContain('Manifold.ofMesh(api.imports[0])');

    expect(out.bakeIsError).toBe(false);
    expect(out.bakeResult.path).toBe('bake');
    expect(out.bakeResult.ok).toBe(true);
    expect(out.bakeAfter).toContain('Manifold.ofMesh(api.imports[0])');
  });

  test('auto mode falls back to bake on a non-manifold-js session', async ({ page }) => {
    await page.goto('/editor');
    await waitForEngine(page);

    const out = await page.evaluate(async () => {
      const tools = await import('/src/ai/tools.ts');
      const pw = (window as unknown as { partwright: {
        createSession: (n?: string) => Promise<unknown>;
        setActiveLanguage: (l: string) => Promise<unknown>;
        run: (code: string) => Promise<unknown>;
        getActiveLanguage: () => string;
      } }).partwright;
      await pw.createSession('ai-surface-tool-voxel');
      await pw.setActiveLanguage('voxel');
      await pw.run([
        'const v = api.voxels();',
        'v.fillBox(0, 0, 0, 7, 7, 7, 0x4488ff);',
        'return v;',
      ].join('\n'));

      const exec = await tools.executeTool('applySurfaceTexture', { id: 'smooth', opts: { iterations: 1 } });
      const result = JSON.parse(exec.content) as { path?: string; ok?: boolean; warnings?: string[]; error?: string };
      return { isError: exec.isError, result, langAfter: pw.getActiveLanguage() };
    });

    expect(out.isError).toBe(false);
    expect(out.result.path).toBe('bake');
    expect(out.result.ok).toBe(true);
    // The bake converted the voxel session to manifold-js. (engineBakeWarning
    // deliberately only warns for SCAD/BREP, where parametric source is lost.)
    expect(out.langAfter).toBe('manifold-js');
  });
});
