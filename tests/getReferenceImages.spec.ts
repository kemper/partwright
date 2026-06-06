import { test, expect, type Page } from 'playwright/test';

// getReferenceImages tool: returns the session's attached reference images as a
// single labeled grid image (the tool-result channel carries only one image),
// so the model can re-read what the user attached on any turn.

async function waitForEngine(page: Page) {
  await page.goto('/editor');
  await page.waitForFunction(
    () => !!(window as unknown as { partwright?: { run?: unknown } }).partwright?.run,
    undefined,
    { timeout: 30_000 },
  );
}

test.describe('getReferenceImages tool', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('partwright-tour-completed', '1'));
  });

  test('composites attached references into one labeled grid image', async ({ page }) => {
    await waitForEngine(page);
    const result = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      await pw.createSession('ref-tool');

      const swatch = (color: string): string => {
        const c = document.createElement('canvas');
        c.width = c.height = 48;
        const ctx = c.getContext('2d')!;
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, 48, 48);
        return c.toDataURL('image/png');
      };
      pw.setImages([
        { src: swatch('#ff0000'), label: 'Front' },
        { src: swatch('#00ff00'), label: 'Right' },
      ]);

      const { executeTool } = await import('/src/ai/tools.ts');
      return executeTool('getReferenceImages', {});
    });

    expect(result.isError).toBe(false);
    expect(result.content).toMatch(/2 reference image/);
    expect(result.content).toMatch(/Front/);
    expect(result.content).toMatch(/Right/);
    // A composited grid image is returned (single multimodal block).
    expect(result.image).toBeTruthy();
    expect(result.image.mediaType).toBe('image/png');
    expect(typeof result.image.data).toBe('string');
    expect(result.image.data.length).toBeGreaterThan(100);
  });

  test('reports clearly when no references are attached', async ({ page }) => {
    await waitForEngine(page);
    const result = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      await pw.createSession('ref-tool-empty');
      pw.clearImages();
      const { executeTool } = await import('/src/ai/tools.ts');
      return executeTool('getReferenceImages', {});
    });
    expect(result.isError).toBe(false);
    expect(result.content).toMatch(/No reference images/i);
    expect(result.image).toBeFalsy();
  });
});
