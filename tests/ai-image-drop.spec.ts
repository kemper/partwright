import { test, expect, type Page } from 'playwright/test';
import { openAiPanel, waitForEditorReady } from './helpers/aiPanel';

// Dropping an image onto the AI chat panel attaches it to the next message.
// The drop also bubbles to main.ts's document-level drag-and-drop import,
// which used to treat it as a generic image import and pop the
// "Import image as…" (relief / voxel) chooser on top of the chat — even
// though the image was already attached. The panel now claims image drops
// (preventDefault) and the document handler stands down for claimed drops.

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
      try { localStorage.setItem('partwright-tour-completed', '1'); } catch { /* ignore */ }
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
});
