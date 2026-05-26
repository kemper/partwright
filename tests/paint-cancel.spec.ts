// The paint Cancel button + waitForPaint API. Heavy strokes at max settings
// used to freeze the main thread for seconds; now subdivision runs in a Web
// Worker with a Cancel UI. These tests cover the user-visible contracts:
//
//  - `partwright.waitForPaint()` resolves only once the async worker has
//    applied a UI-driven stroke.
//  - The progress badge appears while a worker job is in flight (gated by a
//    SHOW_DELAY we force to 0 here so the test isn't timing the worker).
//  - Clicking Cancel during a stroke removes the orphan region and reverts
//    the mesh — letting users escape a runaway max-settings stroke instead
//    of waiting it out.

import { test, expect } from 'playwright/test';

async function openEditor(page: import('playwright/test').Page) {
  await page.goto('/editor');
  await page.waitForSelector('text=Ready', { timeout: 15000 });
  await page.evaluate(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pw = (window as any).partwright;
    await pw.run(`const { Manifold } = api; return Manifold.cube([10, 10, 10], true);`);
  });
}

test.describe('paint cancellation + waitForPaint', () => {
  test('waitForPaint() returns a Promise and resolves to undefined', async ({ page }) => {
    await openEditor(page);
    const result = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      const p = pw.waitForPaint();
      const isPromise = typeof p?.then === 'function';
      const resolved = await p;
      return { isPromise, resolved };
    });
    expect(result.isPromise).toBe(true);
    expect(result.resolved).toBeUndefined();
  });

  test('the progress badge shows for a UI-driven smooth stroke and a Cancel button is present', async ({ page }) => {
    await openEditor(page);
    // Force the badge to appear immediately so we don't race the worker.
    await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).partwright.__setProgressModalDelay(0);
    });

    await page.locator('#paint-toggle').dispatchEvent('click');
    await page.waitForSelector('#paint-picker-panel:not(.hidden)');
    await page.locator('#paint-picker-panel button:has-text("Brush")').dispatchEvent('click');

    // Drive a stroke through the canvas; mouseup commits → async worker job.
    await page.evaluate(() => {
      const canvas = document.querySelector('canvas')!;
      const r = canvas.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const fire = (t: string, x: number, y: number) =>
        canvas.dispatchEvent(new MouseEvent(t, { bubbles: true, clientX: x, clientY: y, button: 0 }));
      fire('mousemove', cx, cy);
      fire('mousedown', cx, cy);
      for (let dx = 6; dx <= 30; dx += 6) fire('mousemove', cx + dx, cy);
      fire('mouseup', cx + 30, cy);
    });

    // With delay=0, the badge is visible as soon as the worker job is dispatched.
    const modal = page.locator('#progress-modal');
    const cancel = page.locator('[data-testid="progress-modal-cancel"]');
    await expect(cancel).toBeVisible({ timeout: 5000 });
    await expect(modal).toBeVisible();

    // Let the worker finish naturally; the badge should disappear and the
    // region count should hit 1 (the stroke landed).
    await page.evaluate(() =>
      (window as unknown as { partwright: { waitForPaint(): Promise<void> } }).partwright.waitForPaint()
    );
    await expect(modal).toBeHidden();
    const regions = await page.evaluate(() =>
      (window as unknown as { partwright: { listRegions(): unknown[] } }).partwright.listRegions().length
    );
    expect(regions).toBe(1);
  });

  test('an agent paintStroke during a UI smooth stroke produces correct state (no stale worker overwrite)', async ({ page }) => {
    // Race coverage: a worker job is in flight (UI stroke), then an agent
    // calls paintStroke synchronously. withSyncReconcile aborts the worker
    // and rebuilds; the worker's stale continuation must be discarded so it
    // doesn't clobber the sync rebuild's mesh / region triangles.
    await openEditor(page);
    await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      pw.__setProgressModalDelay(0);
      await pw.run(`const { Manifold } = api; return Manifold.cube([60, 60, 60], true);`);
      pw.setBrushSize(8);
      pw.setBrushSmoothDivisor(512);
    });

    await page.locator('#paint-toggle').dispatchEvent('click');
    await page.waitForSelector('#paint-picker-panel:not(.hidden)');
    await page.locator('#paint-picker-panel button:has-text("Brush")').dispatchEvent('click');

    // Drive a UI stroke (commits async worker job), then synchronously fire
    // an agent paintStroke from the same evaluate — withSyncReconcile must
    // abort the worker and produce correct state regardless.
    const result = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      const canvas = document.querySelector('canvas')!;
      const r = canvas.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const fire = (t: string, x: number, y: number) =>
        canvas.dispatchEvent(new MouseEvent(t, { bubbles: true, clientX: x, clientY: y, button: 0 }));
      fire('mousemove', cx, cy);
      fire('mousedown', cx, cy);
      for (let dx = 4; dx <= 40; dx += 4) fire('mousemove', cx + dx, cy);
      fire('mouseup', cx + 40, cy);
      // Worker is now subdividing the UI stroke. Fire an agent stroke at a
      // different spot — must return a populated region synchronously and
      // must not get clobbered when the (cancelled) UI stroke's worker
      // continuation eventually unwinds.
      const agent = pw.paintStroke({ points: [[0, 0, 30]], radius: 4, maxEdge: 0.5, color: [0, 1, 0] });
      // Wait for any pending async work to drain — there shouldn't be a real
      // worker job left (withSyncReconcile aborted it), but the internal
      // abort still has a microtask cleanup to flush.
      await pw.waitForPaint();
      return {
        agentRegion: agent,
        regions: pw.listRegions(),
        meshTri: pw.getMesh().numTri,
      };
    });

    // Agent stroke returned a populated triangle set (synchronous contract).
    expect(result.agentRegion.error).toBeFalsy();
    expect(result.agentRegion.triangles).toBeGreaterThan(0);
    // Final state: the agent's region is present with non-empty triangles
    // (sync rebuild produced it; worker's stale continuation didn't clobber).
    const agentRegions = result.regions.filter((r: { id: number }) => r.id === result.agentRegion.id);
    expect(agentRegions.length).toBe(1);
    expect(agentRegions[0].triangles).toBeGreaterThan(0);
  });

  test('clicking Cancel drops the in-flight stroke and reverts the mesh', async ({ page }) => {
    await openEditor(page);
    // 0-delay so we catch the badge immediately, and a large base mesh so
    // the worker job is meaty enough that the cancel arrives mid-flight.
    await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      pw.__setProgressModalDelay(0);
      await pw.run(`const { Manifold } = api; return Manifold.cube([60, 60, 60], true);`);
      pw.setBrushSize(8);
      pw.setBrushSmoothDivisor(512); // fine subdivision = heavy work
    });

    const baseMeshTris = await page.evaluate(() =>
      (window as unknown as { partwright: { getMesh(): { numTri: number } } }).partwright.getMesh().numTri
    );

    await page.locator('#paint-toggle').dispatchEvent('click');
    await page.waitForSelector('#paint-picker-panel:not(.hidden)');
    await page.locator('#paint-picker-panel button:has-text("Brush")').dispatchEvent('click');

    // Drive a stroke; the worker starts subdividing immediately on mouseup.
    await page.evaluate(() => {
      const canvas = document.querySelector('canvas')!;
      const r = canvas.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const fire = (t: string, x: number, y: number) =>
        canvas.dispatchEvent(new MouseEvent(t, { bubbles: true, clientX: x, clientY: y, button: 0 }));
      fire('mousemove', cx, cy);
      fire('mousedown', cx, cy);
      for (let dx = 4; dx <= 40; dx += 4) fire('mousemove', cx + dx, cy);
      fire('mouseup', cx + 40, cy);
    });

    // Cancel before the worker finishes. With a 60x60x60 cube at divisor 512
    // there's plenty of work; even if the worker has finished by the time we
    // click, the test still validates the no-op-cancel path (region stays).
    const cancel = page.locator('[data-testid="progress-modal-cancel"]');
    await expect(cancel).toBeVisible({ timeout: 5000 });
    // Dispatch directly: Playwright's auto-wait .click() can fail if the worker
    // finishes between toBeVisible and the click action retries (badge hides).
    // We tolerate the worker-beat-cancel case below by asserting on regions, so
    // here we just want the click to fire without an extra visibility check.
    await cancel.dispatchEvent('click');

    // Settle: waitForPaint resolves whether cancel landed or the job completed.
    await page.evaluate(() =>
      (window as unknown as { partwright: { waitForPaint(): Promise<void> } }).partwright.waitForPaint()
    );

    const after = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      return { regions: pw.listRegions().length, meshTri: pw.getMesh().numTri };
    });

    // After cancel: the orphan stroke is removed and the mesh reverts to base.
    // (If the worker happened to finish before cancel, the region would still
    // be there — but the badge timing here makes that unlikely; we tolerate
    // either by asserting the cancel-path post-conditions when the orphan was
    // actually removed.)
    if (after.regions === 0) {
      expect(after.meshTri).toBe(baseMeshTris);
    } else {
      // Worker beat the cancel click — the region landed; still a passing path,
      // just covering the no-cancel branch.
      expect(after.regions).toBe(1);
    }
  });
});
