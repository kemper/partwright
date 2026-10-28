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
      } }).partwright;
      await api.createSession('model-logs');
      const ok = [
        'const { Manifold } = api;',
        'const box = Manifold.cube([10, 10, 10], true);',
        "console.log('box', box);",
        "console.warn('careful', { n: 2 });",
        'return box;',
      ].join('\n');
      return {
        run: await api.run(ok),
        saved: await api.runAndSave(ok, 'with logs'),
        isolated: await api.runIsolated(ok),
        failed: await api.run("console.log('before throw', 1);\nthrow new Error('boom');"),
        quiet: await api.run('return api.Manifold.cube([1, 1, 1]);'),
      };
    });

    const expected = ['box Manifold{tris: 12, bbox: [[-5, -5, -5], [5, 5, 5]]}', 'warn: careful {"n":2}'];
    expect(out.run.logs).toEqual(expected);
    expect(out.saved.logs).toEqual(expected);
    expect(out.isolated.logs).toEqual(expected);
    expect(out.failed.status).toBe('error');
    expect(out.failed.logs).toEqual(['before throw 1']);
    expect(out.quiet.logs).toBeUndefined();
  });
});
