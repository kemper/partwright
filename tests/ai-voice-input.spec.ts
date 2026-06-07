import { test, expect } from 'playwright/test';
import { openAiPanel, waitForEditorReady } from './helpers/aiPanel';

// Voice-to-text dictation in the AI panel rides the browser-native Web Speech
// API. Headless Chromium has no real speech engine, so we install a minimal
// stub that emits a transcript on start — enough to exercise the panel wiring
// (button visibility, listening state, transcript landing in the textarea).
async function stubSpeechRecognition(page: import('playwright/test').Page): Promise<void> {
  await page.addInitScript(() => {
    class FakeRecognition extends EventTarget {
      lang = '';
      continuous = false;
      interimResults = false;
      maxAlternatives = 1;
      onresult: ((e: unknown) => void) | null = null;
      onerror: ((e: unknown) => void) | null = null;
      onend: ((e: unknown) => void) | null = null;
      onstart: ((e: unknown) => void) | null = null;
      start() {
        this.onstart?.(new Event('start'));
        setTimeout(() => {
          this.onresult?.({
            resultIndex: 0,
            results: {
              length: 1,
              0: { isFinal: true, length: 1, 0: { transcript: 'make a hexagon nut', confidence: 0.9 } },
            },
          });
        }, 50);
      }
      stop() { this.onend?.(new Event('end')); }
      abort() { this.onend?.(new Event('end')); }
    }
    (window as unknown as { SpeechRecognition: unknown }).SpeechRecognition = FakeRecognition;
  });
  // Suppress the first-run guided tour — its backdrop intercepts clicks.
  await page.addInitScript(() => {
    try { localStorage.setItem('partwright-tour-completed', '1'); } catch { /* ignore */ }
  });
}

test.describe('AI voice input', () => {
  test('mic button dictates speech into the input', async ({ page }) => {
    await stubSpeechRecognition(page);
    await page.goto('/editor');
    await waitForEditorReady(page);
    await openAiPanel(page);

    const mic = page.locator('#btn-ai-mic');
    await expect(mic).toBeVisible();

    // Type some text first — dictation should append to it, not replace it.
    const ta = page.locator('#ai-panel textarea');
    await ta.fill('Please');

    await mic.click();
    await expect(ta).toHaveValue(/Please make a hexagon nut/);

    // Stop dictation; the button returns to its idle (un-pressed) state.
    await mic.click();
    await expect(mic).toHaveAttribute('aria-pressed', 'false');
  });

  test('mic button is hidden when the browser lacks speech recognition', async ({ page }) => {
    // No stub: ensure neither vendor-prefixed constructor exists.
    await page.addInitScript(() => {
      try { localStorage.setItem('partwright-tour-completed', '1'); } catch { /* ignore */ }
      delete (window as unknown as Record<string, unknown>).SpeechRecognition;
      delete (window as unknown as Record<string, unknown>).webkitSpeechRecognition;
    });
    await page.goto('/editor');
    await waitForEditorReady(page);
    await openAiPanel(page);

    await expect(page.locator('#btn-ai-mic')).toHaveCount(0);
  });
});
