import type { Browser, Page, TestInfo } from 'playwright/test';

export interface SharedEditorOptions {
  /** Route to open. Default `/editor`. */
  path?: string;
  /** Extra init script(s) run before any page script, after the tour is suppressed. */
  initScript?: () => void;
}

/** Boot ONE editor page to share across every test in a spec file.
 *
 *  Each test's default `page` fixture is a fresh context that re-boots the
 *  editor + manifold WASM (~2s). For specs whose tests only drive the engine
 *  through `window.partwright` and assert on the result — no persisted-state
 *  or UI-flow dependence between tests — that boot dominates the runtime.
 *  Use this instead of the `page` fixture:
 *
 *    let page: Page;
 *    test.beforeAll(async ({ browser }, testInfo) => { page = await openSharedEditor(browser, testInfo); });
 *    test.afterAll(async () => { await page?.context().close(); });
 *    test('…', async () => { … page … });   // don't destructure `{ page }`
 *
 *  Only share a page when tests are order-independent: a test must not rely on
 *  state a sibling left behind, and must not leave the page in a state that
 *  breaks the next one (open modals, a paused engine, a different route). If
 *  a test fails, Playwright tears the worker down and the next test's
 *  `beforeAll` boots a fresh page, so one failure can't poison the rest.
 *
 *  Things a fresh `page.goto` resets that the API calls you'd reach for don't:
 *  `createSession()` keeps the live paint regions (call `clearColors()` too)
 *  and the active engine language (call `setActiveLanguage(...)`), a plain
 *  `run()` re-resolves existing paint rather than clearing it, toggle buttons
 *  (paint panel, print panel, orbit lock) flip whatever state the last test
 *  left, and the editor buffer isn't restored to starter code. Tests that need
 *  any of these fresh keep the per-test `{ page }` fixture in their own
 *  `test.describe` — mixing both in one file is fine.
 *
 *  Mirrors the project `use` options that matter for rendering (baseURL,
 *  viewport, …), since contexts created by hand don't inherit them. */
export async function openSharedEditor(
  browser: Browser,
  testInfo: TestInfo,
  options: SharedEditorOptions = {},
): Promise<Page> {
  const use = testInfo.project.use;
  const context = await browser.newContext({
    baseURL: use.baseURL,
    viewport: use.viewport,
    deviceScaleFactor: use.deviceScaleFactor,
    userAgent: use.userAgent,
    hasTouch: use.hasTouch,
    isMobile: use.isMobile,
  });
  const page = await context.newPage();
  await page.addInitScript(() => localStorage.setItem('partwright-tour-completed', '1'));
  if (options.initScript) await page.addInitScript(options.initScript);
  await page.goto(options.path ?? '/editor');
  await page.waitForSelector('text=Ready', { timeout: 20_000 });
  await page.waitForFunction(
    () => !!(window as unknown as { partwright?: { run?: unknown } }).partwright?.run,
    { timeout: 20_000 },
  );
  return page;
}
