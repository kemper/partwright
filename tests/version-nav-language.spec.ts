import { test, expect } from 'playwright/test';

// Regression: stepping through versions of a mixed-language session must swap
// the engine to each version's authored language before re-running its code.
//
// The bug: the console `navigateVersion()` API re-ran the target version's
// code in whatever engine happened to be active, instead of switching to the
// version's own language first (the way `loadVersion()` already does). When a
// manifold-js version was re-run under the voxel/replicad engine — whose
// sandbox `api` has no `params` (and voxel has no `Manifold`) — the user saw:
//   - "api.params is not a function"
//   - "Cannot read properties of undefined (reading 'cube')"
// This surfaced on resume, when the agent stepped back through history.

const JS_CUBE = `
const { Manifold } = api;
return Manifold.cube([10, 10, 10], true);
`;

const JS_PARAMS = `
const { Manifold } = api;
api.params({ size: { type: 'number', default: 10 } });
return Manifold.cube([api.size, api.size, api.size], true);
`;

const VOXEL_CODE = `
const v = api.voxels();
v.fillBox([0, 0, 0], [4, 4, 4], '#88aaff');
return v;
`;

async function waitReady(page: import('playwright/test').Page) {
  await page.waitForFunction(
    () => !!(window as unknown as { partwright?: { run?: unknown } }).partwright?.run,
    undefined,
    { timeout: 30_000 },
  );
}

function readGeometryError(page: import('playwright/test').Page) {
  return page.evaluate(() => {
    const txt = document.getElementById('geometry-data')?.textContent || '{}';
    try { return (JSON.parse(txt) as { status?: string; error?: string }); } catch { return {}; }
  });
}

test.describe('cross-language version navigation', () => {
  test('navigateVersion swaps the engine to the target version language', async ({ page }) => {
    await page.goto('/editor');
    await waitReady(page);

    // Build a session with two manifold-js versions and a trailing voxel
    // version, leaving the voxel engine active.
    await page.evaluate(async ({ cube, params, voxel }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      await pw.createSession('mixed');
      await pw.setActiveLanguage('manifold-js');
      await pw.runAndSave(cube, 'js-cube');     // v1
      await pw.runAndSave(params, 'js-params');  // v2
      await pw.setActiveLanguage('voxel');
      await pw.runAndSave(voxel, 'voxel');       // v3 (active engine now = voxel)
    }, { cube: JS_CUBE, params: JS_PARAMS, voxel: VOXEL_CODE });

    // Step back to v2 (manifold-js, uses api.params).
    const r2 = await page.evaluate(() => (window as any).partwright.navigateVersion('prev'));
    expect(r2).toBeTruthy();
    const afterV2 = await readGeometryError(page);
    expect(afterV2.status).not.toBe('error');
    expect(afterV2.error ?? '').not.toMatch(/params is not a function|reading 'cube'/);
    expect(await page.evaluate(() => (window as any).partwright.getActiveLanguage())).toBe('manifold-js');

    // Step back to v1 (manifold-js, uses Manifold.cube).
    const r1 = await page.evaluate(() => (window as any).partwright.navigateVersion('prev'));
    expect(r1).toBeTruthy();
    const afterV1 = await readGeometryError(page);
    expect(afterV1.status).not.toBe('error');
    expect(afterV1.error ?? '').not.toMatch(/params is not a function|reading 'cube'/);

    // Step forward back to the voxel version — engine must swap back too.
    await page.evaluate(() => (window as any).partwright.navigateVersion('next'));
    await page.evaluate(() => (window as any).partwright.navigateVersion('next'));
    const afterVoxel = await readGeometryError(page);
    expect(afterVoxel.status).not.toBe('error');
    expect(await page.evaluate(() => (window as any).partwright.getActiveLanguage())).toBe('voxel');
  });
});
