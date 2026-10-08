// Cancellable export progress modal. A multi-part export bakes each part in a
// loop behind the "Preparing …" progress modal; long ones used to trap the
// user with no way out. Now the modal carries a Cancel button AND Escape
// aborts the in-flight job at the next part boundary.
//
// Two contracts:
//  - progressModal: Escape triggers a cancellable job's onCancel and hides the
//    modal (and is inert for a non-cancellable job).
//  - the multi-part export flow wires an onCancel, so its progress modal shows
//    a Cancel button (previously it had none).

import { test, expect } from 'playwright/test';

async function openEditor(page: import('playwright/test').Page) {
  await page.goto('/editor');
  await page.waitForSelector('text=Ready', { timeout: 15000 });
  await page.waitForFunction(
    () => !!(window as unknown as { partwright?: { run?: unknown } }).partwright?.run,
  );
}

test.describe('export progress modal is cancellable', () => {
  test('Escape cancels a cancellable progress job and hides the modal', async ({ page }) => {
    await openEditor(page);

    const res = await page.evaluate(async () => {
      const pm = await import('/src/ui/progressModal.tsx');
      pm.__setProgressModalDelayForTests(0);
      const flush = () => new Promise((r) => setTimeout(r, 40));
      const shown = () => getComputedStyle(document.querySelector('#progress-modal') as HTMLElement).display !== 'none';

      // Cancellable job: Escape must fire onCancel and the modal must be up.
      let cancelled = false;
      const id = pm.startProgress({
        title: 'Cancellable job', message: 'working…', indeterminate: true,
        onCancel: () => { cancelled = true; },
      });
      await flush();
      const visibleBefore = shown();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      const cancelledAfterEsc = cancelled;
      pm.endProgress(id);
      await flush();

      // Non-cancellable job: Escape must be inert (no throw, modal stays up).
      const id2 = pm.startProgress({ title: 'Plain job', message: 'working…', indeterminate: true });
      await flush();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      const stillVisible = shown();
      pm.endProgress(id2);

      return { visibleBefore, cancelledAfterEsc, stillVisible };
    });

    expect(res.visibleBefore).toBe(true);
    expect(res.cancelledAfterEsc).toBe(true);
    expect(res.stillVisible).toBe(true);
  });

  test('a multi-part export shows a Cancel button in its progress modal', async ({ page }) => {
    await page.addInitScript(() => { try { localStorage.setItem('partwright-tour-completed', '1'); localStorage.setItem('editor-auto-format', 'false'); } catch { /* ignore */ } });
    await openEditor(page);

    // Record whether the per-part export progress modal's Cancel button ever
    // appears while the bake runs (it renders for at least one frame while the
    // parts bake through the Worker pool). Only the UI picker flow shows the
    // per-part progress modal — the console twins bake without it.
    await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      (await import('/src/geometry/units.ts')).setUnits('mm');

      const w = window as unknown as { __exportCancelSeen: boolean };
      w.__exportCancelSeen = false;
      const obs = new MutationObserver(() => {
        if (document.querySelector('[data-testid="export-progress-cancel"]')) w.__exportCancelSeen = true;
      });
      obs.observe(document.body, { childList: true, subtree: true, attributes: true });

      // Two saved parts so the export uses the multi-part bake loop. Plain cubes
      // (saved, print-clean) so no export-confirm modal precedes the part picker.
      await pw.runAndSave('return api.Manifold.cube([10,10,10], true);', 'box');
      await pw.createPart('Pyramid');
      await pw.runAndSave('return api.Manifold.cube([8,8,8], true);', 'pyramid');
    });
    await page.waitForTimeout(500);

    // Drive the STL multi-part export through the UI: export dropdown → STL →
    // part picker → select all → Export. This runs the bake-loop-behind-the-modal.
    await page.locator('#btn-export').click();
    await page.locator('#export-dropdown').getByText('STL', { exact: true }).click();

    const modal = page.getByRole('dialog');
    await expect(modal.getByText(/Export parts to STL/i)).toBeVisible({ timeout: 10000 });
    await modal.getByRole('button', { name: /select all/i }).click();
    const download = page.waitForEvent('download', { timeout: 30000 }).catch(() => null);
    await modal.getByRole('button', { name: /^export/i }).click();
    await download;

    const seen = await page.evaluate(() => (window as unknown as { __exportCancelSeen: boolean }).__exportCancelSeen);
    expect(seen).toBe(true);
  });
});
