import { test, expect, type Page } from 'playwright/test';

// api.human — the parametric MakeHuman-based character. Golden path: the
// asset lazy-loads inside the locked-down engine Worker, a posed figure builds
// as one manifold piece with its paint labels, and it renders in the viewport.

const HUMAN_MODEL = `return api.human({
  height: 60, base: true,
  body: { gender: 0.2, breast: 0.4, muscle: 0.55, age: 9 },
  face: { cheekbones: 0.4, eyeSize: 0.2 },
  expression: 'grin',
  pose: { armR: { raiseSide: 140, bend: 40, twist: 60 }, head: { yaw: -10 } },
});`;

type PW = {
  run: (code?: string) => Promise<Record<string, unknown>>;
  getGeometryData: () => Record<string, unknown>;
  listObjectParts: () => { parts?: { name: string; triangleCount: number }[] };
};

async function waitForEngine(page: Page) {
  await page.waitForSelector('text=Ready', { timeout: 20_000 });
  await page.waitForFunction(() => !!(window as unknown as { partwright?: { run?: unknown } }).partwright?.run, { timeout: 20_000 });
}

test.describe('api.human', () => {
  test('builds a posed, labelled, printable human in the editor', async ({ page }) => {
    test.setTimeout(90_000);
    await page.addInitScript(() => localStorage.setItem('partwright-tour-completed', '1'));
    await page.goto('/editor');
    await waitForEngine(page);
    const result = await page.evaluate(
      (code) => (window as unknown as { partwright: PW }).partwright.run(code),
      HUMAN_MODEL,
    );
    expect(result.error ?? null).toBeNull();
    const data = await page.evaluate(() => (window as unknown as { partwright: PW }).partwright.getGeometryData());
    expect(data.isManifold).toBe(true);
    expect(data.componentCount).toBe(1);
    const parts = await page.evaluate(() => (window as unknown as { partwright: PW }).partwright.listObjectParts());
    const tris = Object.fromEntries((parts.parts ?? []).map((p) => [p.name, p.triangleCount]));
    for (const name of ['skin', 'lips', 'mouth', 'brows', 'eyes', 'iris', 'pupil', 'base']) expect(tris[name] ?? 0).toBeGreaterThan(0);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: 'test-results/human-editor.png' });
  });

  test("weld: 'voxel' stays one piece and api.removePart reaches the eye labels", async ({ page }) => {
    test.setTimeout(120_000);
    await page.addInitScript(() => localStorage.setItem('partwright-tour-completed', '1'));
    await page.goto('/editor');
    await waitForEngine(page);
    const voxel = await page.evaluate((code) => (window as unknown as { partwright: PW }).partwright.run(code),
      `return api.human({ height: 60, weld: 'voxel', pose: { legL: { raiseFwd: 80, bend: 15 } } });`);
    expect(voxel.error ?? null).toBeNull();
    let data = await page.evaluate(() => (window as unknown as { partwright: PW }).partwright.getGeometryData());
    expect(data.isManifold).toBe(true);
    expect(data.componentCount).toBe(1);

    const removed = await page.evaluate((code) => (window as unknown as { partwright: PW }).partwright.run(code),
      `api.removePart('iris');\nreturn api.human({ height: 60 });`);
    expect(removed.error ?? null).toBeNull();
    data = await page.evaluate(() => (window as unknown as { partwright: PW }).partwright.getGeometryData());
    expect(data.componentCount).toBe(1);
    const parts = await page.evaluate(() => (window as unknown as { partwright: PW }).partwright.listObjectParts());
    const names = (parts.parts ?? []).map((p) => p.name);
    expect(names).not.toContain('iris');
    expect(names).toContain('pupil');
  });

  test('dresses the figure: hair, beard, clothing, armor, a held prop and a hat, still one piece', async ({ page }) => {
    test.setTimeout(120_000);
    await page.addInitScript(() => localStorage.setItem('partwright-tour-completed', '1'));
    await page.goto('/editor');
    await waitForEngine(page);
    const result = await page.evaluate((code) => (window as unknown as { partwright: PW }).partwright.run(code),
      `return api.human({ height: 60, base: true, body: { gender: 0.9 },
        hair: { style: 'short', beard: 'full' },
        wear: ['shirt', 'pants', 'boots', 'cuirass', 'pauldrons', { item: 'belt', color: '#3b2a1e' }],
        hold: { R: 'sword' }, accessories: ['cape', 'cap'] });`);
    expect(result.error ?? null).toBeNull();
    const data = await page.evaluate(() => (window as unknown as { partwright: PW }).partwright.getGeometryData());
    expect(data.isManifold).toBe(true);
    expect(data.componentCount).toBe(1);
    const parts = await page.evaluate(() => (window as unknown as { partwright: PW }).partwright.listObjectParts());
    const tris = Object.fromEntries((parts.parts ?? []).map((p) => [p.name, p.triangleCount]));
    for (const name of ['skin', 'hair', 'beard', 'shirt', 'pants', 'boots', 'cuirass', 'pauldrons', 'belt', 'sword', 'cape', 'cap']) {
      expect(tris[name] ?? 0, name).toBeGreaterThan(0);
    }
    await page.waitForTimeout(1500);
    await page.screenshot({ path: 'test-results/human-dressed.png' });
  });

  test('style presets: an anime figure and a Funko-style toy stay one printable piece', async ({ page }) => {
    test.setTimeout(150_000);
    await page.addInitScript(() => localStorage.setItem('partwright-tour-completed', '1'));
    await page.goto('/editor');
    await waitForEngine(page);
    for (const [style, labels] of [['anime', ['eyes', 'iris', 'pupil', 'highlight', 'lashes', 'hair']], ['funko', ['eyes', 'hair', 'tshirt']]] as const) {
      const result = await page.evaluate((code) => (window as unknown as { partwright: PW }).partwright.run(code),
        `return api.human({ height: 60, base: true, style: '${style}', hair: 'bob', wear: ['tshirt', 'jeans', 'sneakers'] });`);
      expect(result.error ?? null, style).toBeNull();
      const data = await page.evaluate(() => (window as unknown as { partwright: PW }).partwright.getGeometryData());
      expect(data.isManifold, style).toBe(true);
      expect(data.componentCount, style).toBe(1);
      const parts = await page.evaluate(() => (window as unknown as { partwright: PW }).partwright.listObjectParts());
      const tris = Object.fromEntries((parts.parts ?? []).map((p) => [p.name, p.triangleCount]));
      for (const name of labels) expect(tris[name] ?? 0, `${style}: ${name}`).toBeGreaterThan(0);
    }
    await page.waitForTimeout(1500);
    await page.screenshot({ path: 'test-results/human-funko.png' });
  });

  test('fitHuman recovers raised arms from a rendered photo, building candidates off-screen', async ({ page }) => {
    test.setTimeout(180_000);
    await page.addInitScript(() => localStorage.setItem('partwright-tour-completed', '1'));
    await page.goto('/editor');
    await waitForEngine(page);
    type FitPW = PW & {
      renderView: (o: Record<string, unknown>) => string | { error: string } | null;
      fitHuman: (o: Record<string, unknown>) => Promise<Record<string, unknown>>;
    };
    // The "photo": a known body with its arms out, rendered from the front.
    const target = await page.evaluate((code) => (window as unknown as { partwright: PW }).partwright.run(code),
      `return api.human({ height: 60, pose: { armL: { raiseSide: 45 }, armR: { raiseSide: 45 } } });`);
    expect(target.error ?? null).toBeNull();
    const photo = await page.evaluate(() => (window as unknown as { partwright: FitPW }).partwright.renderView({ azimuth: 0, elevation: 0, ortho: true, size: 512, edges: 'none' }));
    expect(typeof photo).toBe('string');
    const fit = await page.evaluate(async (image) => (window as unknown as { partwright: FitPW }).partwright.fitHuman({
      image, fit: ['armL', 'armR'], budget: 14, save: false,
    }), photo as string);
    expect(fit.error ?? null).toBeNull();
    expect(fit.silhouetteIoU as number).toBeGreaterThan(0.85);
    const fitted = fit.fitted as { armL: number; armR: number };
    expect(Math.abs(fitted.armL - 45)).toBeLessThan(15);
    expect(Math.abs(fitted.armR - 45)).toBeLessThan(15);
    expect(String(fit.code)).toMatch(/api\.human/);

    // The chat tool: listed only when the user allows commits, and it saves a
    // version without echoing the code back into the model's context.
    const tool = await page.evaluate(async (image) => {
      const tools = await import('/src/ai/tools.ts');
      const toggles = {
        vision: { views: true, resolution: 'medium', angles: 'auto' },
        scope: { runCode: true, saveVersions: true, paintFaces: true, sessionNotes: true },
        autoRetry: 0, maxIterations: 'medium', maxSpend: 'high', thinking: 'off', provider: 'anthropic',
        anthropicModel: 'claude-haiku-4-5', localModel: null, openaiModel: 'gpt-5-mini', geminiModel: 'gemini-flash-latest',
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const names = (t: any) => tools.buildToolList(t).map((d) => d.name);
      const withSave = names(toggles).includes('fitHumanToPhoto');
      const withoutSave = names({ ...toggles, scope: { ...toggles.scope, saveVersions: false } }).includes('fitHumanToPhoto');
      const exec = await tools.executeTool('fitHumanToPhoto', { image, fit: ['armL'], budget: 6, label: 'fitted' });
      return { withSave, withoutSave, exec };
    }, photo as string);
    expect(tool.withSave).toBe(true);
    expect(tool.withoutSave).toBe(false);
    expect(tool.exec.isError).toBe(false);
    const out = JSON.parse(tool.exec.content) as Record<string, unknown>;
    expect(out.code).toBeUndefined();
    expect(out.silhouetteIoU as number).toBeGreaterThan(0.7);
    expect((out.version as { label?: string } | null)?.label).toBe('fitted');
  });
});
