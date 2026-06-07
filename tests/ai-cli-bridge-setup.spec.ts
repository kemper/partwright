import { test, expect } from 'playwright/test';
import { waitForEditorReady } from './helpers/aiPanel';

// Golden path for the "Use a Claude or Codex subscription" quick-setup card
// on the AI Settings → Custom tab. We don't run a real bridge here — we assert
// the onboarding UI renders and that "Use this endpoint" fills the Base URL
// field with CLIProxyAPI's default localhost endpoint.
test.describe('AI CLI bridge setup', () => {
  test('Custom tab shows the subscription bridge card and fills the endpoint', async ({ page }) => {
    await page.goto('/editor');
    await page.evaluate(() => { try { localStorage.setItem('partwright-tour-completed', '1'); } catch {} });
    await page.reload();
    await waitForEditorReady(page);

    // Open AI Settings straight onto the Custom tab.
    await page.evaluate(async () => {
      const m = await import('/src/ui/aiSettingsModal.tsx');
      await m.showAiSettingsModal({ onChange: () => {} }, { initialTab: 'custom' });
    });

    await expect(page.getByRole('heading', { name: 'AI Settings' })).toBeVisible();

    // The quick-setup card and its three steps render.
    await expect(page.getByText('Use a Claude or Codex subscription')).toBeVisible();
    await expect(page.getByText('Install & start the bridge')).toBeVisible();
    await expect(page.getByText('Log in with your subscription')).toBeVisible();

    // The Base URL starts empty; clicking "Use this endpoint" fills it.
    const baseUrl = page.locator('input[placeholder="http://localhost:8080/v1"]');
    await expect(baseUrl).toHaveValue('');

    await page.getByRole('button', { name: /Use this endpoint/ }).click();
    await expect(baseUrl).toHaveValue('http://localhost:8317/v1');
  });
});
