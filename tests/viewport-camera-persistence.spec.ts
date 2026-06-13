// Golden-path tests for interactive camera-angle persistence. Re-rendering used
// to auto-frame the camera back to the default 3/4 view, throwing away whatever
// angle/zoom the user had orbited to. Coverage here:
//   • version switches and live code edits keep the angle (same-session gate)
//   • a freshly-opened session still auto-frames
//   • the in-app AI path (runAndSave with preserveCamera) keeps the angle, while
//     a bare console runAndSave still auto-frames
//   • the orbited view is persisted per-session and restored on reload
//
// See src/main.ts captureCameraToPreserve / setCameraPose (src/renderer/viewport.ts)
// and session.workCamera (src/storage + setSessionWorkCamera).

import { test, expect, type Page } from 'playwright/test';

type PW = {
  run: (code: string) => Promise<unknown>;
  runAndSave: (code: string, label?: string, assertions?: unknown, opts?: { preserveCamera?: boolean }) => Promise<unknown>;
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

  test('preserves the camera angle when editing code (live re-run)', async ({ page }) => {
    await page.goto('/editor');
    await page.waitForSelector('text=Ready', { timeout: 15000 });
    await page.evaluate(async (box) => {
      await (window as unknown as { partwright: PW }).partwright.run(box);
    }, BOX);
    await page.waitForTimeout(800);

    await orbitAndZoom(page);
    const before = await camera(page);
    expect(Math.abs(before.azimuth - 45) > 5 || Math.abs(before.elevation - 35) > 5).toBe(true);

    // Edit the code for real — replace it via the editor so the debounced
    // auto-run fires through the same runCode path a user hits while typing.
    // The code pane is shown by default now, so the "▶ Show code" expander is in
    // the DOM but hidden; only click it when it's actually visible (i.e. the pane
    // is collapsed), otherwise the click waits on a hidden element until timeout.
    const showCode = page.getByText('Show code', { exact: false });
    if (await showCode.first().isVisible().catch(() => false)) {
      await showCode.first().click().catch(() => {});
    }
    const editor = page.locator('.cm-content').first();
    await editor.click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('const { Manifold } = api; return Manifold.cube([6, 6, 6], true);');
    await page.waitForTimeout(2000); // past the 300ms auto-run debounce + render

    const after = await camera(page);
    // The model shrank, but the camera angle/distance must be unchanged.
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

  // The in-app AI re-renders via runAndSave with { preserveCamera: true } (set by
  // the tool dispatcher) so iterating on a model keeps the user's orbit; a bare
  // console runAndSave (no opts) still auto-frames.
  test('AI-path runAndSave preserves the camera; bare console runAndSave auto-frames', async ({ page }) => {
    await page.goto('/editor');
    await page.waitForSelector('text=Ready', { timeout: 15000 });
    await page.evaluate(async () => {
      await (window as unknown as { partwright: PW }).partwright.run('const { Manifold } = api; return Manifold.cube([12, 12, 12], true);');
    });
    await page.waitForTimeout(700);
    await orbitAndZoom(page);
    await page.waitForTimeout(800); // let damping settle before sampling
    const before = await camera(page);
    expect(Math.abs(before.azimuth - 45) > 5 || Math.abs(before.elevation - 35) > 5).toBe(true);

    // AI path: preserveCamera keeps the angle across the re-render.
    await page.evaluate(async () => {
      await (window as unknown as { partwright: PW }).partwright.runAndSave('const { Manifold } = api; return Manifold.cube([6, 6, 6], true);', 'ai-edit', undefined, { preserveCamera: true });
    });
    await page.waitForTimeout(700);
    const afterAI = await camera(page);
    expect(Math.abs(afterAI.azimuth - before.azimuth)).toBeLessThan(2);
    expect(Math.abs(afterAI.distance - before.distance)).toBeLessThan(2);

    // Bare console runAndSave (no opts) auto-frames back to the default ~45/35.
    await page.evaluate(async () => {
      await (window as unknown as { partwright: PW }).partwright.runAndSave('const { Manifold } = api; return Manifold.cube([20, 20, 20], true);', 'console-edit');
    });
    await page.waitForTimeout(700);
    const afterBare = await camera(page);
    expect(Math.abs(afterBare.azimuth - 45)).toBeLessThan(5);
    expect(Math.abs(afterBare.elevation - 35)).toBeLessThan(5);
  });

  // The Customizer (panel slider / setParams) re-renders the same model with a
  // new parameter, so it must keep the user's angle. SCAD is the tricky engine:
  // it renders progressively, and that mid-run preview used to auto-frame the
  // camera back to default *before* the preserve-snapshot ran — so customizing a
  // parametric SCAD model snapped the view. Now the pose is captured before the
  // engine runs and the preview skips auto-framing while preserving.
  test('preserves the camera when customizing a parametric SCAD model', async ({ page }) => {
    await page.goto('/editor');
    await page.waitForSelector('text=Ready', { timeout: 15000 });

    const SCAD = ['width = 20; // [10:60]', 'cube([width, width, 10], center=true);'].join('\n');
    await page.evaluate(async (code) => {
      const pw = (window as unknown as { partwright: { createSession(n?: string): Promise<unknown>; setActiveLanguage(l: string): Promise<void> } & PW }).partwright;
      await pw.createSession('scad-camera');
      await pw.setActiveLanguage('scad'); // first SCAD run lazy-loads the WASM engine
      await pw.run(code);
    }, SCAD);
    await page.waitForTimeout(1500);

    await orbitAndZoom(page);
    const before = await camera(page);
    expect(Math.abs(before.azimuth - 45) > 5 || Math.abs(before.elevation - 35) > 5).toBe(true);

    // Drive the Customize panel's Width slider — the exact path the user hits.
    await page.evaluate(() => {
      const panel = document.getElementById('params-panel')!;
      const slider = panel.querySelector('input[type="range"]') as HTMLInputElement;
      slider.value = '50';
      slider.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.waitForTimeout(2500); // SCAD re-render (two-phase) + settle

    const after = await camera(page);
    expect(Math.abs(after.azimuth - before.azimuth)).toBeLessThan(2);
    expect(Math.abs(after.elevation - before.elevation)).toBeLessThan(2);
    expect(Math.abs(after.distance - before.distance)).toBeLessThan(2);
  });

  // The orbited view is persisted per-session and restored on reload, instead of
  // snapping back to the default framing.
  test('persists the working-view camera across a reload', async ({ page }) => {
    await page.goto('/editor');
    await page.waitForSelector('text=Ready', { timeout: 15000 });
    await page.evaluate(async () => {
      await (window as unknown as { partwright: PW }).partwright.runAndSave('const { Manifold } = api; return Manifold.cube([12, 12, 12], true);', 'box');
    });
    await page.waitForTimeout(700);
    await orbitAndZoom(page);
    // Wait past the workCamera save debounce + IDB write, then sample the settled
    // pose (which is what got persisted).
    await page.waitForTimeout(1600);
    const before = await camera(page);
    expect(Math.abs(before.azimuth - 45) > 5 || Math.abs(before.elevation - 35) > 5).toBe(true);
    const url = page.url();
    expect(url).toContain('session=');

    // Reload the same session URL — fresh page, IndexedDB persists.
    await page.goto(url);
    await page.waitForSelector('text=Ready', { timeout: 15000 });
    await page.waitForTimeout(2500); // WASM + first render + workCamera restore
    const after = await camera(page);
    expect(Math.abs(after.azimuth - before.azimuth)).toBeLessThan(3);
    expect(Math.abs(after.elevation - before.elevation)).toBeLessThan(3);
    expect(Math.abs(after.distance - before.distance)).toBeLessThan(3);
  });
});
