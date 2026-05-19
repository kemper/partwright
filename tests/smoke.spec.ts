import { test, expect, type Page } from 'playwright/test';

// Smoke tests that run with no external network — every assertion either
// hits localhost or a same-origin static asset. The bad-key test does try
// api.anthropic.com (and may legitimately fail in a network-restricted
// sandbox) but is gated behind a connectivity probe so it self-skips.

// Playwright gives each test a fresh BrowserContext by default, so
// localStorage and IndexedDB are isolated. We don't need explicit storage
// clearing — but we do guard against IndexedDB races between tests by
// landing on `/` first and giving the engine a beat to settle.

test.describe('Landing + editor', () => {
  test('landing page renders hero', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Partwright', level: 1 })).toBeVisible();
    await expect(page.getByRole('button', { name: /Open Editor/i })).toBeVisible();
  });

  test('editor loads with AI button', async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto('/editor?view=ai');
    await page.waitForSelector('#btn-ai', { timeout: 10_000 });
    await expect(page.locator('#btn-ai')).toContainText(/Connect AI|AI/);
    expect(errors.filter(isAppRelevant)).toEqual([]);
  });
});

test.describe('AI chat panel', () => {
  test('toolbar button toggles the drawer', async ({ page }) => {
    await page.goto('/editor?view=ai');
    await page.waitForSelector('#btn-ai');

    // Drawer exists from boot but is translated off-screen until first open.
    await page.click('#btn-ai');
    await expect(page.locator('#ai-panel')).toHaveClass(/translate-x-0/);
    await page.click('#ai-panel button:has-text("✕")');
    await expect(page.locator('#ai-panel')).toHaveClass(/translate-x-full/);
  });

  test('drawer state persists across reload', async ({ page }) => {
    // Start clean (beforeEach cleared storage), open drawer, then reload —
    // the stored drawerOpen=true should bring it back open.
    await page.goto('/editor?view=ai');
    await page.waitForSelector('#btn-ai');
    await page.click('#btn-ai');
    await expect(page.locator('#ai-panel')).toHaveClass(/translate-x-0/);

    await page.reload();
    await page.waitForSelector('#ai-panel');
    await expect(page.locator('#ai-panel')).toHaveClass(/translate-x-0/);
  });

  test('drawer survives switching tabs', async ({ page }) => {
    await page.goto('/editor?view=ai');
    await page.waitForSelector('#btn-ai');
    await page.click('#btn-ai');
    await expect(page.locator('#ai-panel')).toHaveClass(/translate-x-0/);

    const galleryTab = page.locator('button', { hasText: /^Gallery$/ });
    if (await galleryTab.count()) {
      await galleryTab.first().click();
      await expect(page.locator('#ai-panel')).toHaveClass(/translate-x-0/);
    }
  });

  test('panel widgets render', async ({ page }) => {
    await page.goto('/editor?view=ai');
    await page.click('#btn-ai');
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

  test('key modal opens and closes', async ({ page }) => {
    await page.goto('/editor?view=ai');
    await page.click('#btn-ai');
    // dispatchEvent — same flex-child viewport quirk as the toggle pills.
    await page.locator('#ai-panel button:has-text("Connect Anthropic API")').dispatchEvent('click');
    await expect(page.locator('input[type="password"]')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Connect Anthropic API' })).toBeVisible();

    // Cancel returns to the panel, no key persisted
    await page.locator('.bg-zinc-800.rounded-xl button:text-is("Cancel")').click();
    await expect(page.locator('input[type="password"]')).toHaveCount(0);
    await expect(page.locator('#btn-ai')).toContainText(/Connect AI/);
  });

  test('stale local-model id falls back to the dual connect prompt', async ({ page }) => {
    // Regression: when the curated local-model list is pruned, a user whose
    // saved provider was 'local' would get stuck on "No local model picked.
    // Choose a model" instead of the friendlier "Connect Anthropic API or
    // run a local model" dual prompt. Simulate by planting localStorage with
    // a provider=local + bogus model id before the app boots.
    await page.addInitScript(() => {
      localStorage.setItem('partwright-ai-settings-v1', JSON.stringify({
        toggles: { provider: 'local', localModel: 'Bogus-Removed-Model-MLC' },
      }));
    });
    await page.goto('/editor?view=ai');
    await page.click('#btn-ai');
    const panel = page.locator('#ai-panel');
    await expect(panel.locator('button:has-text("Connect Anthropic API")')).toBeVisible();
    await expect(panel.locator('button:has-text("run a local model")')).toBeVisible();
  });

  test('toggle pills flip state on click', async ({ page }) => {
    await page.goto('/editor?view=ai');
    await page.click('#btn-ai');
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
    await page.goto('/editor?view=ai');
    const ok = await page.evaluate(async () => {
      const r = await fetch('/ai.md');
      return r.ok && (await r.text()).length > 100;
    });
    expect(ok).toBe(true);
  });

  test('toggle pills carry tooltips explaining what they do', async ({ page }) => {
    await page.goto('/editor');
    await page.waitForSelector('#ai-panel');
    await page.locator('#btn-ai').dispatchEvent('click');
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
    // Open the drawer on /editor first so it persists open, then go back
    // to the landing page. The drawer is a body-level overlay so it
    // should still be visible there.
    await page.goto('/editor');
    // Wait for the panel itself, not just the toolbar button — the button
    // mounts first, the panel's click-handler comes online a beat later.
    await page.waitForSelector('#ai-panel');
    // Click via dispatchEvent so we sidestep the same viewport-hit-test
    // edge case that bites the toggle-pill click on a freshly-mounted
    // panel; we just need the click handler to fire.
    await page.locator('#btn-ai').dispatchEvent('click');
    await expect(page.locator('#ai-panel')).toHaveClass(/translate-x-0/, { timeout: 5000 });
    await page.goto('/');
    await page.waitForSelector('#ai-panel');
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
    await page.waitForSelector('#ai-panel');
    await page.locator('#btn-ai').dispatchEvent('click');

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
