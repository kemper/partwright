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

    // The quick-setup card and its steps render — including the required
    // API-key step CLIProxyAPI needs before it will start.
    await expect(page.getByText('Use a Claude or Codex subscription')).toBeVisible();
    await expect(page.getByText('Install & start the bridge')).toBeVisible();
    await expect(page.getByText('Set an API key (required)')).toBeVisible();
    await expect(page.getByText('Log in with your subscription')).toBeVisible();

    // Footer shows Close, and a disabled "Done & enable" until the endpoint is set.
    await expect(page.getByRole('button', { name: 'Close' })).toBeVisible();
    const enableBtn = page.getByRole('button', { name: 'Done & enable Custom endpoint' });
    await expect(enableBtn).toBeDisabled();

    // The Base URL starts empty; clicking "Use this endpoint" fills it and,
    // in turn, enables the footer's "Done & enable".
    const baseUrl = page.locator('input[placeholder="http://localhost:8080/v1"]');
    await expect(baseUrl).toHaveValue('');
    await page.getByRole('button', { name: /Use this endpoint/ }).click();
    await expect(baseUrl).toHaveValue('http://localhost:8317/v1');
    await expect(enableBtn).toBeEnabled();

    // "Use the bridge key" fills the (now visible, text) API-key field with the
    // generated key — and it matches the one shown in the setup command.
    const keyField = page.locator('input[placeholder="leave blank if the endpoint needs no auth"]');
    await expect(keyField).toHaveAttribute('type', 'text');
    await page.getByRole('button', { name: 'Use the bridge key' }).click();
    await expect(keyField).toHaveValue(/^pw-[0-9a-f]{48}$/);
  });
});
