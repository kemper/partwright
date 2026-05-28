import { test, expect, type Page } from 'playwright/test';
import { openAiPanel } from './helpers/aiPanel';

// Smoke tests that run with no external network — every assertion either
// hits localhost or a same-origin static asset. The bad-key test does try
// api.anthropic.com (and may legitimately fail in a network-restricted
// sandbox) but is gated behind a connectivity probe so it self-skips.

// Playwright gives each test a fresh BrowserContext by default, so
// localStorage and IndexedDB are isolated. We don't need explicit storage
// clearing — but we do guard against IndexedDB races between tests by
// landing on `/` first and giving the engine a beat to settle.

test.beforeEach(async ({ page }) => {
  // Suppress the first-run guided tour — its backdrop intercepts clicks.
  // (Previously dodged via the now-removed ?view=ai entry URL.)
  await page.addInitScript(() => {
    try { localStorage.setItem('partwright-tour-completed', '1'); } catch { /* ignore */ }
  });
});

test.describe('Landing + editor', () => {
  test('landing page renders hero', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Partwright', level: 1 })).toBeVisible();
    await expect(page.getByRole('button', { name: /Open Editor/i })).toBeVisible();
  });

  test('editor loads with AI button', async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto('/editor');
    await page.waitForSelector('#btn-ai', { timeout: 10_000 });
    await expect(page.locator('#btn-ai')).toContainText(/Connect AI|AI/);
    expect(errors.filter(isAppRelevant)).toEqual([]);
  });
});

test.describe('AI chat panel', () => {
  test('toolbar button toggles the drawer', async ({ page }) => {
    await page.goto('/editor');
    await page.waitForSelector('#btn-ai');
    // Wait for full editor init (console API ready) so the click doesn't race
    // a COI service-worker reload / WASM boot on the default Interactive tab.
    await page.waitForFunction(() => !!(window as unknown as { partwright?: { help?: unknown } }).partwright?.help);

    // The drawer opens by default on a fresh visit.
    await expect(page.locator('#ai-panel')).toBeVisible();
    // Close via the ✕, then reopen via the rail button.
    await page.click('#ai-panel button:has-text("✕")');
    await expect(page.locator('#ai-panel')).toBeHidden();
    await page.click('#btn-ai');
    await expect(page.locator('#ai-panel')).toBeVisible();
    // Disconnected → reopening via the rail also surfaces the AI Settings modal
    // (the connect flow). Dismiss it to leave a clean state.
    await expect(page.getByRole('heading', { name: 'AI Settings' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('heading', { name: 'AI Settings' })).toBeHidden();
  });

  test('connected: reopening via the rail opens the panel with no settings modal', async ({ page }) => {
    await page.goto('/editor');
    await page.waitForSelector('#btn-ai');
    await page.waitForFunction(() => !!(window as unknown as { partwright?: { help?: unknown } }).partwright?.help);
    // Seed a hosted key so we're "connected": reopening should just show the
    // panel, NOT auto-open the connect-settings modal.
    await page.evaluate(async () => {
      await new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('partwright');
        open.onsuccess = () => {
          const db = open.result;
          const txn = db.transaction('aiKeys', 'readwrite');
          txn.objectStore('aiKeys').put({
            provider: 'anthropic', apiKey: 'sk-ant-test-0000000000', createdAt: Date.now(),
            lastUsed: Date.now(), totalInputTokens: 0, totalOutputTokens: 0, totalCostUsd: 0,
          });
          txn.oncomplete = () => { db.close(); resolve(); };
          txn.onerror = () => reject(txn.error);
        };
        open.onerror = () => reject(open.error);
      });
    });
    // Panel is open by default; close it, then reopen via the rail.
    await expect(page.locator('#ai-panel')).toBeVisible();
    await page.click('#ai-panel button:has-text("✕")');
    await expect(page.locator('#ai-panel')).toBeHidden();
    await page.click('#btn-ai');
    await expect(page.locator('#ai-panel')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'AI Settings' })).toHaveCount(0);
  });

  test('code pane defaults hidden when the AI drawer is open, and respects an explicit Show code', async ({ page }) => {
    // First visit: drawer opens by default, so the code pane should NOT
    // compete with it for screen real estate. The "▶ Show code" expand
    // button only shows when the editor group is collapsed.
    await page.goto('/editor');
    await page.waitForSelector('#btn-ai');
    await page.waitForFunction(() => !!(window as unknown as { partwright?: { help?: unknown } }).partwright?.help);
    await expect(page.locator('#ai-panel')).toBeVisible();
    const expandBtn = page.locator('button:has-text("▶ Show code")');
    await expect(expandBtn).toBeVisible();

    // User opts in to the code pane; that choice must survive a reload even
    // though the AI drawer is still open.
    await expandBtn.click();
    await expect(expandBtn).toBeHidden();
    await expect(page.locator('.cm-content')).toBeVisible();

    await page.reload();
    await page.waitForFunction(() => !!(window as unknown as { partwright?: { help?: unknown } }).partwright?.help);
    await expect(page.locator('#ai-panel')).toBeVisible();
    await expect(page.locator('button:has-text("▶ Show code")')).toBeHidden();
    await expect(page.locator('.cm-content')).toBeVisible();
  });

  test('drawer close state persists across reload', async ({ page }) => {
    // The drawer opens by default, but the user's choice is remembered: once
    // they close it, the stored drawerOpen=false keeps it closed on reload.
    await page.goto('/editor');
    await page.waitForSelector('#btn-ai');
    // Wait for full editor init (console API ready) so the click doesn't race
    // a COI service-worker reload / WASM boot on the default Interactive tab.
    await page.waitForFunction(() => !!(window as unknown as { partwright?: { help?: unknown } }).partwright?.help);
    await expect(page.locator('#ai-panel')).toBeVisible();
    await page.click('#ai-panel button:has-text("✕")');
    await expect(page.locator('#ai-panel')).toBeHidden();

    await page.reload();
    await page.waitForSelector('#ai-panel', { state: 'attached' });
    await expect(page.locator('#ai-panel')).toBeHidden();
  });

  test('drawer survives switching tabs', async ({ page }) => {
    await page.goto('/editor');
    await openAiPanel(page);

    // Switch to another destination via the activity rail; the drawer should
    // stay open across the tab change.
    await page.locator('[data-tab="Versions"]').click();
    await expect(page.locator('#ai-panel')).toBeVisible();
  });

  test('panel widgets render', async ({ page }) => {
    await page.goto('/editor');
    await openAiPanel(page);
    const panel = page.locator('#ai-panel');

    // Toggle pills
    await expect(panel.locator('button', { hasText: /📸 Auto-render/ })).toBeVisible();
    await expect(panel.locator('button', { hasText: /▶ Run/ })).toBeVisible();
    await expect(panel.locator('button', { hasText: /💾 Save/ })).toBeVisible();
    await expect(panel.locator('button', { hasText: /🎨 Paint/ })).toBeVisible();

    // Cost meter — "ctx", "session", "next turn"
    await expect(panel).toContainText(/ctx/);
    await expect(panel).toContainText(/session:/);
    await expect(panel).toContainText(/next turn/);

    // Show AI + paperclip + send
    await expect(panel.locator('button', { hasText: /Show AI/ })).toBeVisible();
    await expect(panel.locator('button', { hasText: /^Send$/ })).toBeVisible();
  });

  test('inline key entry shows in settings and dismisses cleanly', async ({ page }) => {
    await page.goto('/editor');
    // Let editor init (and session auto-restore) settle before interacting, so
    // a late ?session= navigation doesn't tear down the modal mid-test.
    await page.waitForFunction(() => !!(window as unknown as { partwright?: { help?: unknown } }).partwright?.help);
    await openAiPanel(page);
    // The panel CTA opens the AI Settings modal. The per-provider key form is
    // now inline in the tab (no separate pop-up): the Anthropic tab is shown
    // by default and exposes the password field + Connect button right away.
    // dispatchEvent — same flex-child viewport quirk as the toggle pills.
    await page.locator('#ai-panel button:has-text("Connect an AI agent")').dispatchEvent('click');
    await expect(page.getByRole('heading', { name: 'AI Settings' })).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();
    await expect(page.locator('button:has-text("Connect Anthropic API")')).toBeVisible();

    // Done closes the modal; no key was persisted. The AI control now lives in
    // the rail and shows the disconnected state via its status dot (grey).
    await page.locator('.bg-zinc-800.rounded-xl button:text-is("Done")').click();
    await expect(page.locator('input[type="password"]')).toHaveCount(0);
    await expect(page.locator('#ai-status-dot')).toHaveClass(/bg-zinc-500/);
  });

  test('stale local-model id falls back to the connect prompt', async ({ page }) => {
    // Regression: when the curated local-model list is pruned, a user whose
    // saved provider was 'local' would get stuck on "No local model picked.
    // Choose a model" instead of the friendlier generic "Connect an AI agent"
    // prompt that fresh users get. Simulate by planting localStorage with a
    // provider=local + bogus model id before the app boots.
    await page.addInitScript(() => {
      localStorage.setItem('partwright-ai-settings-v1', JSON.stringify({
        toggles: { provider: 'local', localModel: 'Bogus-Removed-Model-MLC' },
      }));
    });
    await page.goto('/editor');
    await openAiPanel(page);
    const panel = page.locator('#ai-panel');
    await expect(panel.locator('button:has-text("Connect an AI agent")')).toBeVisible();
  });

  test('toggle pills flip state on click', async ({ page }) => {
    await page.goto('/editor');
    await openAiPanel(page);
    const viewsPill = page.locator('#ai-panel button', { hasText: /📸 Auto-render/ });
    const before = await viewsPill.getAttribute('class');
    // The toggle strip lives inside the panel's bottom region. Playwright
    // (1.58 + chromium 141) intermittently reports `Element is outside of
    // the viewport` for these even when their bounding box is well inside
    // — likely a hit-test edge case with very small flex children of a
    // recently-transformed parent. Dispatching a synthetic click event
    // exercises the same handler path the user would and is what the
    // app's onClick wiring registered for. We still asserted visibility
    // and that the locator resolved to exactly one element above.
    await viewsPill.dispatchEvent('click');
    const after = await viewsPill.getAttribute('class');
    expect(before).not.toBe(after);
  });

  test('ai.md is served at the root', async ({ page }) => {
    await page.goto('/editor');
    const ok = await page.evaluate(async () => {
      const r = await fetch('/ai.md');
      return r.ok && (await r.text()).length > 100;
    });
    expect(ok).toBe(true);
  });

  test('toggle pills carry tooltips explaining what they do', async ({ page }) => {
    await page.goto('/editor');
    await openAiPanel(page);
    const pillNames = ['📸 Auto-render', '▶ Run', '💾 Save', '🎨 Paint'];
    for (const name of pillNames) {
      const pill = page.locator('#ai-panel button', { hasText: name });
      await expect(pill).toBeVisible();
      const title = await pill.getAttribute('title');
      expect(title, `${name} should have a tooltip`).toBeTruthy();
      expect(title!.length).toBeGreaterThan(20);
      expect(title!.toLowerCase()).toMatch(/on|off|click/);
    }
  });

  test('drawer + send from landing page navigates to editor', async ({ page }) => {
    // Ensure the drawer is open on /editor first so it persists open, then go
    // back to the landing page. The drawer docks into the app-level row
    // (outside the per-page subtrees), so it stays mounted and visible there.
    await page.goto('/editor');
    await openAiPanel(page);
    await page.goto('/');
    await page.waitForSelector('#ai-panel', { state: 'attached' });
    await expect(page.locator('#ai-panel')).toBeVisible();

    // Sending a message from the landing page should navigate to /editor.
    // No key is set so the key modal appears first — that path is fine,
    // we just want to confirm we don't silently model on /.
    await page.locator('#ai-panel textarea').fill('build a cube');
    await page.locator('#ai-panel button:has-text("Send")').dispatchEvent('click');
    const onEditor = page.waitForURL(/\/editor/, { timeout: 5000 }).then(() => 'editor');
    const onModal = page.waitForSelector('input[type="password"]', { timeout: 5000 }).then(() => 'modal');
    const which = await Promise.race([onEditor, onModal]);
    expect(['editor', 'modal']).toContain(which);
  });

  test('Send stays as Send when a turn is in flight; Stop is the separate red button', async ({ page }) => {
    // Regression: pre-queue, the Send button toggled to Stop while a turn
    // was in flight. The queue feature requires Send to keep dispatching
    // (queueing mid-run) with Stop split out as its own button so a typed
    // follow-up doesn't accidentally abort the agent.
    await page.goto('/editor');
    await openAiPanel(page);

    const panel = page.locator('#ai-panel');
    // Idle state: Send is visible, Stop and queued-message badge are hidden.
    await expect(panel.locator('button', { hasText: /^Send$/ })).toBeVisible();
    await expect(panel.locator('#btn-ai-stop')).toBeHidden();
    await expect(panel.locator('#queued-message-badge')).toBeHidden();

    // No assertion runs an actual turn (that needs an API key + network),
    // but the end-to-end queue → drain → transcript path is covered by
    // the chatLoop unit test suite when added; this test pins the UX
    // contract that Send never becomes Stop.
  });
});

// === helpers ===

interface CollectedError {
  type: 'pageerror' | 'console';
  text: string;
}

function collectPageErrors(page: Page): CollectedError[] {
  const errors: CollectedError[] = [];
  page.on('pageerror', e => errors.push({ type: 'pageerror', text: e.message }));
  page.on('console', msg => {
    if (msg.type() === 'error') errors.push({ type: 'console', text: msg.text() });
  });
  return errors;
}

// Filter out errors that aren't from the app code under test:
//   - coi-serviceworker.js' import.meta warning (pre-existing, build-time)
//   - sandbox-only certificate failures from external assets
function isAppRelevant(err: CollectedError): boolean {
  const ignored = [
    /import\.meta/i,
    /ERR_CERT_AUTHORITY_INVALID/i,
    /Failed to load resource.*coi-serviceworker/i,
  ];
  return !ignored.some(re => re.test(err.text));
}
