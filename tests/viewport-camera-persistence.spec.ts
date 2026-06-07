// Golden-path tests for interactive camera-angle persistence across version
// switches within a session. Switching versions re-renders the geometry; that
// re-render used to auto-frame the camera back to the default 3/4 view, throwing
// away whatever angle/zoom the user had orbited to. The fix snapshots the live
// camera pose and restores it after the new geometry is in — but only within the
// same session (the first render of a freshly-opened session still auto-frames).
//
// See src/main.ts captureCameraToPreserve / setCameraPose (src/renderer/viewport.ts).

import { test, expect, type Page } from 'playwright/test';

type PW = {
  run: (code: string) => Promise<unknown>;
  runAndSave: (code: string, label?: string) => Promise<unknown>;
  listVersions: () => Promise<Array<{ index: number; id: string }>>;
  loadVersion: (t: { index?: number; id?: string }) => Promise<unknown>;
  getViewState: () => { camera: { azimuth: number; elevation: number; distance: number; target: [number, number, number] } };
};

const BOX = 'const { Manifold } = api; return Manifold.cube([10, 10, 10], true);';
const SPHERE = 'const { Manifold } = api; return Manifold.sphere(8, 32);';

function camera(page: Page) {
  return page.evaluate(() => (window as unknown as { partwright: PW }).partwright.getViewState().camera);
}

// Orbit + zoom the viewport away from its default framing via a real mouse drag
// + wheel on the canvas (OrbitControls' own input path).
async function orbitAndZoom(page: Page): Promise<void> {
  const canvas = page.locator('#viewport');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('no #viewport canvas');
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 140, cy - 90, { steps: 12 });
  await page.mouse.up();
  await page.mouse.move(cx, cy);
  await page.mouse.wheel(0, -300);
  await page.waitForTimeout(600);
}

test.describe('viewport camera persistence', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('partwright-tour-completed', '1'));
  });

  test('preserves the camera angle when switching versions in a session', async ({ page }) => {
    await page.goto('/editor');
    await page.waitForSelector('text=Ready', { timeout: 15000 });

    await page.evaluate(async ([box, sphere]) => {
      const pw = (window as unknown as { partwright: PW }).partwright;
      await pw.runAndSave(box, 'box');
      await pw.runAndSave(sphere, 'sphere');
    }, [BOX, SPHERE]);
    await page.waitForTimeout(800);

    await orbitAndZoom(page);
    const before = await camera(page);
    // Sanity: we actually moved off the default ~45°/35° framing.
    expect(Math.abs(before.azimuth - 45) > 5 || Math.abs(before.elevation - 35) > 5).toBe(true);

    // Switch to the earlier version. The debounced auto-run also re-renders
    // ~300ms later, so wait long enough to catch a late reframe.
    await page.evaluate(async () => {
      const pw = (window as unknown as { partwright: PW }).partwright;
      const versions = await pw.listVersions();
      await pw.loadVersion({ index: versions[0].index });
    });
    await page.waitForTimeout(1200);

    const after = await camera(page);
    expect(Math.abs(after.azimuth - before.azimuth)).toBeLessThan(2);
    expect(Math.abs(after.elevation - before.elevation)).toBeLessThan(2);
    expect(Math.abs(after.distance - before.distance)).toBeLessThan(2);
  });

  test('still auto-frames on the first render of a freshly-opened session', async ({ page }) => {
    await page.goto('/editor');
    await page.waitForSelector('text=Ready', { timeout: 15000 });

    // Frame + orbit session A.
    await page.evaluate(async (box) => {
      await (window as unknown as { partwright: PW }).partwright.run(box);
    }, BOX);
    await page.waitForTimeout(600);
    await orbitAndZoom(page);
    const orbited = await camera(page);

    // Open a brand-new session — its first render must auto-frame to the default
    // view, NOT inherit the orbited angle from the previous session.
    await page.evaluate(async (sphere) => {
      const pw = (window as unknown as { partwright: { createSession(): Promise<unknown> } & PW }).partwright;
      await pw.createSession();
      await pw.run(sphere);
    }, SPHERE);
    await page.waitForTimeout(1000);

    const fresh = await camera(page);
    // Default framing is ~azimuth 45 / elevation 35; assert we snapped there and
    // did not carry over the orbited angle.
    expect(Math.abs(fresh.azimuth - orbited.azimuth)).toBeGreaterThan(5);
    expect(Math.abs(fresh.elevation - 35)).toBeLessThan(5);
  });
});
