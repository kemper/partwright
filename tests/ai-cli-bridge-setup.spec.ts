import { test, expect, type Page } from 'playwright/test';
import { waitForEditorReady } from './helpers/aiPanel';

// Golden path for the CLIProxyAPI ("use a Claude or Codex subscription")
// endpoint on the AI Settings → Custom tab. No real bridge runs here — the
// bridge's /v1/models is mocked — so we assert the saved-endpoint UI: the
// generated key is created once and kept, the setup command APPENDS it, a
// signed-out bridge is diagnosed with the login command, and endpoints
// persist and switch.

async function openCustomTab(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const m = await import('/src/ui/aiSettingsModal.tsx');
    await m.showAiSettingsModal({ onChange: () => {} }, { initialTab: 'custom' });
  });
  await expect(page.getByRole('heading', { name: 'AI Settings' })).toBeVisible();
  await expect(page.getByTestId('custom-endpoint-editor')).toBeVisible();
}

test.describe('AI CLI bridge setup', () => {
  test('the bridge endpoint keeps its key, diagnoses a missing login, and persists', async ({ page }) => {
    let models: string[] = [];
    await page.route('**/v1/models', route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: models.map(id => ({ id })) }),
    }));

    await page.goto('/editor');
    await page.evaluate(() => { try { localStorage.setItem('partwright-tour-completed', '1'); } catch {} });
    await page.reload();
    await waitForEditorReady(page);
    await openCustomTab(page);

    // A first-time user gets one saved "Local CLIProxyAPI" endpoint, already
    // in use by the Custom provider, with the setup steps.
    const rows = page.getByTestId('custom-endpoint-row');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('Local CLIProxyAPI');
    await expect(rows.first()).toContainText('In use');
    await expect(page.getByText('Install & start the bridge')).toBeVisible();
    await expect(page.getByText('Log in with your subscription')).toBeVisible();
    await expect(page.getByTestId('custom-endpoint-url')).toHaveValue('http://localhost:8317/v1');

    // Its key was generated once; the macOS command APPENDS it (awk, keeps
    // other keys) instead of replacing every key with sed.
    await page.getByRole('button', { name: 'macOS' }).click();
    const keyField = page.getByTestId('custom-endpoint-key');
    const key = await keyField.inputValue();
    expect(key).toMatch(/^pw-[0-9a-f]{48}$/);
    const addCmd = page.getByTestId('bridge-add-key-cmd');
    const fullCmd = await addCmd.getAttribute('data-command');
    expect(fullCmd).toContain(`KEY='${key}'`);
    expect(fullCmd).toContain('awk');
    expect(fullCmd).toMatch(/brew services restart cliproxyapi$/);
    // The long script shows as a one-line summary until expanded.
    await expect(addCmd).toContainText('then restart the bridge');
    await page.getByRole('button', { name: 'Show the full command' }).click();
    await expect(addCmd).toContainText(`KEY='${key}'`);

    // A bridge that answers with no models isn't signed in → the status says
    // so and offers the login command.
    await page.getByRole('button', { name: 'Connect', exact: true }).click();
    const status = page.getByTestId('custom-endpoint-status');
    await expect(status).toContainText('isn\'t signed in to a subscription');
    await expect(status).toContainText('cliproxyapi --claude-login');

    // Logged in → Connect lists models and picks a Claude default.
    models = ['claude-haiku-5-5', 'claude-opus-5-5', 'claude-sonnet-5-5'];
    await page.getByRole('button', { name: /Reconnect/ }).click();
    await expect(status).toContainText('3 model(s) available');
    await expect(page.getByTestId('custom-endpoint-model')).toHaveValue('claude-opus-5-5');

    // Close and reopen: the same key comes back (never regenerated), so the
    // bridge config never needs touching again.
    await page.getByRole('button', { name: 'Save & activate Custom endpoint' }).click();
    await expect(page.getByRole('heading', { name: 'AI Settings' })).toHaveCount(0);
    await page.reload();
    await waitForEditorReady(page);
    await openCustomTab(page);
    await expect(page.getByTestId('custom-endpoint-key')).toHaveValue(key);
    await expect(page.getByTestId('custom-endpoint-model')).toHaveValue('claude-opus-5-5');

    // The active key + model reach what the chat reads.
    const applied = await page.evaluate(async () => {
      const [{ loadSettings }, { resolveCustomApiKey }] = await Promise.all([
        import('/src/ai/settings.ts'),
        import('/src/ai/customEndpoints.ts'),
      ]);
      const t = loadSettings().toggles;
      return { provider: t.provider, model: t.customModel, key: await resolveCustomApiKey(t.customBaseUrl) };
    });
    expect(applied).toEqual({ provider: 'custom', model: 'claude-opus-5-5', key });

    // A second endpoint (e.g. a remote gateway) — "Use" switches the provider
    // to it, and both stay saved.
    await page.getByRole('button', { name: '+ Other endpoint' }).click();
    await page.getByTestId('custom-endpoint-url').fill('https://gw.example.com/v1');
    await page.getByTestId('custom-endpoint-url').blur();
    await page.getByTestId('custom-endpoint-key').fill('sk-remote');
    await page.getByTestId('custom-endpoint-key').blur();
    await page.getByRole('button', { name: 'Use this endpoint' }).click();
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(1)).toContainText('gw.example.com');
    await expect(rows.nth(1)).toContainText('In use');
    const switched = await page.evaluate(async () => {
      const [{ loadSettings }, { resolveCustomApiKey }] = await Promise.all([
        import('/src/ai/settings.ts'),
        import('/src/ai/customEndpoints.ts'),
      ]);
      const t = loadSettings().toggles;
      return { url: t.customBaseUrl, key: await resolveCustomApiKey(t.customBaseUrl) };
    });
    expect(switched).toEqual({ url: 'https://gw.example.com/v1', key: 'sk-remote' });
  });
});
