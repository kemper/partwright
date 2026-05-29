import { test, expect } from 'playwright/test';

// Smoke for the "What language to pick?" help modal added next to the
// toolbar language toggle. Verifies the link is present, opens a modal
// describing all three engines, and dismisses cleanly. Doesn't try the
// actual content matching beyond "all three language names are in there"
// so a copy edit to the cards won't break this test.

test.describe('Language help modal', () => {
  test('opens from the "?" link next to the language toggle and lists all three engines', async ({ page }) => {
    await page.goto('/editor');
    await page.waitForFunction(
      () => !!(window as unknown as { partwright?: { run?: unknown } }).partwright?.run,
      undefined,
      { timeout: 30_000 },
    );

    // The help link is a small "?" button right after the BREP toggle.
    // Tour backdrop may overlay the toolbar on a fresh open; dispatchEvent
    // bypasses the pointer-event interceptor without affecting the click
    // semantics from JS's POV.
    const helpLink = page.locator('button[aria-label="Open language help"]');
    await expect(helpLink).toBeVisible();
    await helpLink.dispatchEvent('click');

    // Modal title.
    const modal = page.getByLabel('Pick a modeling language');
    await expect(modal).toBeVisible();
    // Each engine card has its badge — JS, SCAD, BREP. Scoped to the modal
    // so the session-bar badge doesn't get picked up too.
    for (const badge of ['JS', 'SCAD', 'BREP']) {
      await expect(modal.getByText(badge, { exact: true })).toBeVisible();
    }

    // Dismiss via "Got it" button — dispatchEvent because the modal's
    // content is taller than the viewport on the 1280×900 test profile,
    // and Playwright's click() refuses to scroll a button-in-modal into
    // view (see CLAUDE.md tip about dispatchEvent for clipped flex
    // children).
    await modal.getByRole('button', { name: 'Got it' }).dispatchEvent('click');
    await expect(modal).toBeHidden();
  });
});
