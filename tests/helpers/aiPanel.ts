import { expect, type Page } from 'playwright/test';
import { waitFor } from './waitFor';

/** Ensure the AI panel is open.
 *
 *  The panel now opens by default on a fresh visit, so the old "click #btn-ai
 *  to open it" no longer holds — a single click would *close* it. This helper
 *  is idempotent: it only clicks when the panel is hidden, and retries so it
 *  tolerates the brief window during editor init where `state.open` is already
 *  true but the drawer hasn't been un-hidden yet (a click then would race the
 *  init and toggle it shut).
 *
 *  Opening the panel from the rail *while disconnected* also kicks off the
 *  connect flow, which auto-opens the AI Settings modal one tick later (after an
 *  async connection check). Left open, that modal races — and clobbers — the
 *  next modal a caller opens, since `createModalShell` permits only one modal at
 *  a time. So whenever we actually had to click to open the panel, wait for that
 *  connect modal to settle and dismiss it. Callers that genuinely want a modal
 *  open it explicitly after this resolves. On a fast machine the default-open
 *  wins the race and no click happens, so this path is skipped entirely. */
export async function openAiPanel(page: Page): Promise<void> {
  await page.waitForSelector('#ai-panel', { state: 'attached' });
  const panel = page.locator('#ai-panel');
  let clicked = false;
  await expect(async () => {
    if (!(await panel.isVisible())) {
      await page.locator('#btn-ai').dispatchEvent('click');
      clicked = true;
    }
    await expect(panel).toBeVisible({ timeout: 500 });
  }).toPass({ timeout: 10_000 });

  if (clicked) {
    const settingsHeading = page.getByRole('heading', { name: 'AI Settings' });
    const appeared = await settingsHeading
      .waitFor({ state: 'visible', timeout: 2_000 })
      .then(() => true)
      .catch(() => false);
    if (appeared) {
      await page.keyboard.press('Escape');
      await expect(settingsHeading).toBeHidden();
    }
  }
}

/** Wait until the editor is fully booted and *past* the one-time COI service-
 *  worker reload.
 *
 *  `coi-serviceworker.js` reloads the page once on a fresh context to turn on
 *  cross-origin isolation. A `page.evaluate` issued before that reload lands is
 *  torn down by the navigation ("Execution context was destroyed"). The "Ready"
 *  status only appears after WASM init, which needs cross-origin isolation, so
 *  it is a reliable signal that the reload is behind us — wait for it before any
 *  early `page.evaluate` / `createSession` / seed step. */
export async function waitForEditorReady(page: Page): Promise<void> {
  await page.waitForSelector('text=Ready', { timeout: 20_000 });
}

/** Wait for the editor bootstrap to create/restore the active session and return
 *  its id.
 *
 *  On a bare `/editor` load the session is created only *after* WASM init
 *  (`syncEditorFromURL` → `createSession`), which is long after `#ai-panel`
 *  attaches. Tests that seed chat messages keyed to the session bucket must wait
 *  for this first — otherwise, under load, `getState().session?.id` is still
 *  undefined and the seed lands in `GLOBAL_CHAT_BUCKET`, which the post-reload
 *  session restore never reads back, so the seeded turn never renders.
 *
 *  Each poll is one `page.evaluate`; if a COI reload tears the context down
 *  mid-poll, `waitFor` swallows the throw and retries on the fresh page. */
export async function waitForChatSessionId(page: Page): Promise<string> {
  return waitFor(
    () =>
      page.evaluate(async () => {
        const sm = await import('/src/storage/sessionManager.ts');
        return sm.getState().session?.id ?? null;
      }),
    { timeout: 15_000, message: 'the editor session to initialize' },
  );
}
