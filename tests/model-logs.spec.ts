// Model code's console output reaches the caller: whatever the code prints with
// console.log / warn / error inside the geometry Worker comes back as `logs` on
// run / runAndSave / runIsolated results — including when the code throws —
// so agents can debug without throwing JSON in an Error.

import { test, expect, type Page } from 'playwright/test';
import { openSharedEditor } from './helpers/sharedPage';

let page: Page;
test.beforeAll(async ({ browser }, testInfo) => {
  page = await openSharedEditor(browser, testInfo);
});
test.afterAll(async () => {
  await page?.context().close();
});

test.describe('model code console output', () => {
  test('run, runAndSave and runIsolated return the logs, also on error', async () => {
    const out = await page.evaluate(async () => {
      type R = Record<string, unknown> & { logs?: string[] };
      const api = (window as unknown as { partwright: {
        createSession: (n?: string) => Promise<unknown>;
        run: (code: string) => Promise<R>;
        runAndSave: (code: string, label?: string) => Promise<R>;
        runIsolated: (code: string) => Promise<R>;
        getGeometryData: () => R;
      } }).partwright;
      await api.createSession('model-logs');
      const ok = [
        'const { Manifold } = api;',
        'const box = Manifold.cube([10, 10, 10], true);',
        "console.log('box', box);",
        "console.warn('careful', { n: 2 });",
        'return box;',
      ].join('\n');
      const run = await api.run(ok);
      const geometryLogs = api.getGeometryData().logs;
      return {
        run,
        geometryLogs,
        saved: await api.runAndSave(ok, 'with logs'),
        isolated: await api.runIsolated(ok),
        failed: await api.run("console.log('before throw', 1);\nthrow new Error('boom');"),
        quiet: await api.run('return api.Manifold.cube([1, 1, 1]);'),
      };
    });

    const expected = ['box Manifold{tris: 12, bbox: [[-5, -5, -5], [5, 5, 5]]}', 'warn: careful {"n":2}'];
    expect(out.run.logs).toEqual(expected);
    expect(out.geometryLogs).toEqual(expected);
    expect(out.saved.logs).toEqual(expected);
    expect(out.isolated.logs).toEqual(expected);
    expect(out.failed.status).toBe('error');
    expect(out.failed.logs).toEqual(['before throw 1']);
    expect(out.quiet.logs).toBeUndefined();
  });
});

test.describe('model console panel', () => {
  const run = (code: string) => page.evaluate(async (c) => {
    await (window as unknown as { partwright: { run: (code: string) => Promise<unknown> } }).partwright.run(c);
  }, code);
  const setAutoHide = (ms: number) => page.evaluate(async (v) => {
    const cfg = await import('/src/config/appConfig.ts');
    const c = cfg.getConfig();
    cfg.saveAppConfig({ ...c, ui: { ...c.ui, modelConsoleAutoHideMs: v } });
  }, ms);
  const quiet = 'return api.Manifold.cube([4, 4, 4]);';
  const chatty = "console.log('hello', { n: 1 });\nconsole.warn('careful');\nreturn api.Manifold.cube([4, 4, 4]);";

  test.afterEach(async () => {
    await page.evaluate(async () => {
      const cfg = await import('/src/config/appConfig.ts');
      const c = cfg.getConfig();
      cfg.saveAppConfig({ ...c, ui: { ...c.ui, modelConsoleAutoHideMs: cfg.APP_CONFIG_DEFAULTS.ui.modelConsoleAutoHideMs } });
    });
    await run(quiet);
  });

  test('a run that prints shows a collapsed pill that expands, collapses, and hides after a quiet run', async () => {
    await setAutoHide(0);
    const panel = page.locator('#model-console');
    const body = page.locator('#model-console-body');
    const toggle = page.locator('#model-console-toggle');

    await run(chatty);
    await expect(panel).toBeVisible();
    await expect(page.locator('#model-console-count')).toHaveText('2');
    // Arrives as a pill — the output drawer stays shut until asked for.
    await expect(body).toBeHidden();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    // Worst level is a warning → amber count badge.
    await expect(page.locator('#model-console-count')).toHaveClass(/bg-amber-600/);

    await toggle.click();
    await expect(body).toBeVisible();
    await expect(body).toContainText('hello {"n":1}');
    await expect(body.locator('div', { hasText: 'warn: careful' })).toHaveClass(/text-amber-500/);
    // An open drawer stays open when the next run prints.
    await run("console.log('again');\nreturn api.Manifold.cube([4, 4, 4]);");
    await expect(body).toContainText('again');
    await expect(body).toBeVisible();

    await toggle.click();
    await expect(body).toBeHidden();
    await expect(panel).toBeVisible();

    await run(quiet);
    await expect(panel).toBeHidden();
  });

  test('× dismisses until the next run prints; the palette command brings it back', async () => {
    await setAutoHide(0);
    const panel = page.locator('#model-console');
    await run(chatty);
    await expect(panel).toBeVisible();
    await page.locator('#model-console-close').click();
    await expect(panel).toBeHidden();

    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
    await page.keyboard.press('ControlOrMeta+k');
    await page.locator('input[aria-label="Search commands"]').fill('Show console output');
    await page.keyboard.press('Enter');
    await expect(panel).toBeVisible();
    await expect(page.locator('#model-console-body')).toBeVisible();

    await page.locator('#model-console-close').click();
    await run(chatty);
    await expect(panel).toBeVisible();
    await expect(page.locator('#model-console-body')).toBeHidden();
  });

  test('the collapsed pill fades on its own, but error output stays', async () => {
    await setAutoHide(400);
    const panel = page.locator('#model-console');
    await run(chatty);
    await expect(panel).toBeVisible();
    await expect(panel).toBeHidden({ timeout: 5000 });

    await run("console.error('bad');\nreturn api.Manifold.cube([4, 4, 4]);");
    await expect(page.locator('#model-console-count')).toHaveClass(/bg-red-600/);
    await page.waitForTimeout(1200);
    await expect(panel).toBeVisible();
  });
});
