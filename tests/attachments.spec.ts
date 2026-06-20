import { test, expect, type Page } from 'playwright/test';

// Session attachments: the generalization of "reference images" into typed
// project files (image | model | document | text | other). They persist with
// the session, survive a chat clear, and the AI can list them via the
// getAttachments tool (images are viewed via getReferenceImages).

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

async function waitForEngine(page: Page) {
  await page.goto('/editor');
  await page.waitForFunction(
    () => !!(window as unknown as { partwright?: { run?: unknown } }).partwright?.run,
    undefined,
    { timeout: 30_000 },
  );
}

test.describe('session attachments', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('partwright-tour-completed', '1'));
  });

  test('classifies mixed attachment kinds and clearImages preserves non-images', async ({ page }) => {
    await waitForEngine(page);
    await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      await pw.createSession('attachments');
    });
    await page.waitForTimeout(1000);

    const kinds = await page.evaluate(async ({ png }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      pw.addAttachment({ src: png, label: 'Front' });
      pw.addAttachment({ src: 'data:model/stl;base64,AAAA', label: 'Reference bracket' });
      pw.addAttachment({ src: 'data:application/pdf;base64,AAAA', label: 'Spec sheet' });
      // kind inferred from a filename-bearing label when no media type is in the src
      pw.addAttachment({ src: 'https://example.com/notes.md', label: 'notes.md' });
      return pw.getAttachments().map((a: { kind: string }) => a.kind).sort();
    }, { png: PNG });
    expect(kinds).toEqual(['document', 'image', 'model', 'text']);

    // Newly-pinned attachments are stamped with addedAt + source (the metadata
    // the "aging"/provenance story relies on).
    const meta = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const a = (window as any).partwright.getAttachments()[0];
      return { addedAt: typeof a.addedAt, source: a.source };
    });
    expect(meta.addedAt).toBe('number');
    expect(meta.source).toBe('user');

    // clearImages drops only the image-kind attachment; the rest remain.
    const afterClear = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      pw.clearImages();
      return pw.getAttachments().map((a: { kind: string }) => a.kind).sort();
    });
    expect(afterClear).toEqual(['document', 'model', 'text']);
    expect(await page.evaluate(() => (window as unknown as { partwright: { getImages: () => unknown[] } }).partwright.getImages().length)).toBe(0);
  });

  test('getAttachments tool returns a manifest with inline text and an image hint', async ({ page }) => {
    await waitForEngine(page);
    await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (window as any).partwright.createSession('attachments-tool');
    });
    await page.waitForTimeout(1000);

    const result = await page.evaluate(async ({ png }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      pw.addAttachment({ src: png, label: 'Front' });
      pw.addAttachment({ src: 'data:text/markdown;base64,' + btoa('# Notes\nrounded corners'), label: 'Design notes' });
      const { executeTool } = await import('/src/ai/tools.ts');
      return executeTool('getAttachments', {});
    }, { png: PNG });

    expect(result.isError).toBe(false);
    expect(result.content).toMatch(/2 attachment/);
    expect(result.content).toMatch(/\[image\]/);
    expect(result.content).toMatch(/\[text\]/);
    // text attachment contents are inlined
    expect(result.content).toMatch(/rounded corners/);
    // points the model at getReferenceImages to actually view the image
    expect(result.content).toMatch(/getReferenceImages/);
    // it's a text manifest, not an image block
    expect(result.image).toBeFalsy();
  });

  test('renders a typed tile (kind badge) per attachment in the Attachments tab', async ({ page }) => {
    await waitForEngine(page);
    await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (window as any).partwright.createSession('attachments-ui');
    });
    await page.waitForTimeout(1000);
    await page.evaluate(async ({ png }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      pw.addAttachment({ src: png, label: 'Front' });
      pw.addAttachment({ src: 'data:model/stl;base64,AAAA', label: 'Reference bracket' });
    }, { png: PNG });

    await page.locator('[data-tab="Images"]').click();
    const panel = page.locator('#images-container');
    await expect(panel.getByText('Attachments', { exact: true })).toBeVisible();
    await expect(panel.getByText('Image', { exact: true })).toBeVisible();
    await expect(panel.getByText('Model', { exact: true })).toBeVisible();
    await expect(panel.getByText('model/stl', { exact: true })).toBeVisible();
  });
});
