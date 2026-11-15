import { test, expect, type Page } from 'playwright/test';
import { openAiPanel, waitForEditorReady } from './helpers/aiPanel';

// Dropping an image onto the AI chat panel attaches it to the next message.
// The drop also bubbles to main.ts's document-level drag-and-drop import,
// which used to treat it as a generic image import and pop the
// "Import image as…" (relief / voxel) chooser on top of the chat — even
// though the image was already attached. The panel now claims image drops
// (stopPropagation), so the document handler never sees them.

// 1×1 red PNG.
const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';

/** Dispatch a synthetic file drop on `selector`, the way the OS does for a
 *  dragged-in file (dragenter → dragover → drop, all bubbling). */
async function dropFile(page: Page, selector: string, name: string, type: string, b64: string): Promise<void> {
  await page.evaluate(({ selector, name, type, b64 }) => {
    const target = document.querySelector(selector);
    if (!target) throw new Error(`no drop target ${selector}`);
    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], name, { type }));
    for (const kind of ['dragenter', 'dragover', 'drop']) {
      target.dispatchEvent(new DragEvent(kind, { bubbles: true, cancelable: true, dataTransfer: dt }));
    }
  }, { selector, name, type, b64 });
}

test.describe('AI panel image drop', () => {
  test.beforeEach(async ({ page }) => {
    // Suppress the first-run guided tour — its backdrop intercepts clicks.
    await page.addInitScript(() => {
      try {
        localStorage.setItem('partwright-tour-completed', '1');
        // The drop target below is the full code editor, not the compact map.
        localStorage.setItem('partwright-ai-settings-v1', JSON.stringify({ codeView: 'full' }));
      } catch { /* ignore */ }
    });
    await page.goto('/editor');
    await waitForEditorReady(page);
  });

  test('dropping an image on the chat attaches it without the import chooser', async ({ page }) => {
    await openAiPanel(page);
    await dropFile(page, '#ai-panel textarea', 'screenshot.png', 'image/png', PNG_B64);

    // The image lands in the pending-attachments row…
    await expect(page.locator('#ai-panel img[src^="data:image/png"]')).toHaveCount(1);
    // …and the generic relief/voxel chooser never opens.
    await page.waitForTimeout(500);
    await expect(page.getByText('Import image as…')).toHaveCount(0);
    await page.screenshot({ path: 'test-results/ai-image-drop.png' });
  });

  test('dropping an image on the viewport still opens the import chooser', async ({ page }) => {
    await dropFile(page, '#viewport', 'photo.png', 'image/png', PNG_B64);
    await expect(page.getByText('Import image as…')).toBeVisible();
  });

  test('the import chooser offers relief, layered print, voxel and raw; raw just attaches', async ({ page }) => {
    await dropFile(page, '#viewport', 'photo.png', 'image/png', PNG_B64);
    const dialog = page.getByRole('dialog', { name: 'Import image as…' });
    await expect(dialog).toBeVisible();
    for (const kind of ['relief', 'layered', 'voxel', 'raw']) await expect(dialog.locator(`[data-kind="${kind}"]`)).toHaveCount(1);
    await page.screenshot({ path: 'test-results/import-image-chooser.png' });
    const before = await page.evaluate(() => (window as any).partwright.getImages().length);
    await dialog.locator('[data-kind="raw"]').click();
    await expect(dialog).toBeHidden();
    await page.waitForFunction((n) => (window as any).partwright.getImages().length === n + 1, before);
  });

  test('a voxel import from the chooser attaches the image and records the tool (#1256)', async ({ page }) => {
    // A 4×4 opaque PNG drawn in the page (voxel import needs opaque pixels).
    const b64 = await page.evaluate(() => {
      const c = document.createElement('canvas'); c.width = 4; c.height = 4;
      const g = c.getContext('2d')!; g.fillStyle = '#d2452b'; g.fillRect(0, 0, 4, 4); g.fillStyle = '#2f6fd0'; g.fillRect(2, 0, 2, 4);
      return c.toDataURL('image/png').split(',')[1];
    });
    await dropFile(page, '#viewport', 'tile.png', 'image/png', b64);
    const dialog = page.getByRole('dialog', { name: 'Import image as…' });
    await dialog.locator('[data-kind="voxel"]').click();
    await page.getByRole('button', { name: 'Import', exact: true }).click();
    await page.waitForFunction(() => (window as any).partwright.getImageToolOp()?.tool === 'voxel', null, { timeout: 30_000 });
    const res = await page.evaluate(() => {
      const pw = (window as any).partwright;
      return { op: pw.getImageToolOp(), images: pw.getImages().map((i: { id: string }) => i.id) };
    });
    expect(res.op?.tool).toBe('voxel');
    expect(res.images).toContain(res.op.image);
  });

  test('a voxel import into a NEW session attaches only its own image, and it persists (#1256)', async ({ page }) => {
    test.setTimeout(120_000);
    // Session A: real work plus an unrelated reference image.
    await page.evaluate(async () => {
      const pw = (window as any).partwright;
      for (let i = 0; i < 60; i++) {
        const r = await pw.runAndSave('return api.Manifold.cube([1, 1, 1], true);', 'probe', {});
        if (r && !r.error && r.version) break;
        await new Promise((res) => setTimeout(res, 1000));
      }
      const c = document.createElement('canvas'); c.width = 2; c.height = 2;
      const g = c.getContext('2d')!; g.fillStyle = '#00ff00'; g.fillRect(0, 0, 2, 2);
      pw.setAttachments([{ src: c.toDataURL('image/png'), label: 'reference' }]);
    });
    const b64 = await page.evaluate(() => {
      const c = document.createElement('canvas'); c.width = 4; c.height = 4;
      const g = c.getContext('2d')!; g.fillStyle = '#d2452b'; g.fillRect(0, 0, 4, 4);
      return c.toDataURL('image/png').split(',')[1];
    });
    await dropFile(page, '#viewport', 'tile.png', 'image/png', b64);
    await page.getByRole('dialog', { name: 'Import image as…' }).locator('[data-kind="voxel"]').click();
    await page.getByRole('button', { name: 'Import', exact: true }).click();
    await page.getByRole('button', { name: /^New session/ }).click();
    await page.waitForFunction(() => (window as any).partwright.getImageToolOp()?.tool === 'voxel', null, { timeout: 30_000 });
    const labels = () => page.evaluate(() => (window as any).partwright.getImages().map((i: { label?: string }) => i.label));
    expect(await labels()).toEqual(['tile.png']);
    // Persisted on the new session's record: the stored list, not just the
    // in-memory one, holds only the imported image.
    await expect.poll(async () => page.evaluate(async () => {
      const sm = await import('/src/storage/sessionManager.ts');
      return ((await sm.getAttachmentsFromSession()) ?? []).map((a: { label?: string }) => a.label);
    }), { timeout: 10_000 }).toEqual(['tile.png']);
  });

  // CodeMirror preventDefault()s every file drop on the editor, so the
  // document import must not treat a prevented drop as already handled.
  test('dropping an image on the code editor still opens the import chooser', async ({ page }) => {
    await dropFile(page, '.cm-content', 'photo.png', 'image/png', PNG_B64);
    await expect(page.getByText('Import image as…')).toBeVisible();
  });

  test('a non-image drop on the chat falls through to the general import', async ({ page }) => {
    await openAiPanel(page);
    await dropFile(page, '#ai-panel textarea', 'notes.xyz', 'application/octet-stream', btoa('hello'));
    // The general import ran (and rejected the unsupported type) — it wasn't
    // swallowed by the chat.
    await expect(page.getByText(/unsupported file type/)).toBeVisible();
    await expect(page.locator('#ai-panel img[src^="data:"]')).toHaveCount(0);
  });
});
