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
import { waitFor } from './helpers/waitFor';

type PW = {
  run: (code: string) => Promise<unknown>;
  runAndSave: (code: string, label?: string, assertions?: unknown, opts?: { preserveCamera?: boolean }) => Promise<unknown>;
  listVersions: () => Promise<Array<{ index: number; id: string }>>;
  loadVersion: (t: { index?: number; id?: string }) => Promise<unknown>;
  getViewState: () => { camera: { azimuth: number; elevation: number; distance: number; target: [number, number, number] } };
};

type Camera = { azimuth: number; elevation: number; distance: number; target: [number, number, number] };

const BOX = 'const { Manifold } = api; return Manifold.cube([10, 10, 10], true);';
const SPHERE = 'const { Manifold } = api; return Manifold.sphere(8, 32);';

function camera(page: Page): Promise<Camera> {
  return page.evaluate(() => (window as unknown as { partwright: PW }).partwright.getViewState().camera);
}

/** Read the X-axis bounding-box width off the `#geometry-data` element that
 *  every run (including debounced auto-runs and the SCAD Customizer's
 *  event-driven re-render) writes to — a concrete, code-visible completion
 *  signal for "the new geometry actually landed" instead of a guessed settle
 *  time. */
function bboxWidth(page: Page): Promise<number | null> {
  return page.evaluate(() => {
    try {
      const data = JSON.parse(document.getElementById('geometry-data')?.textContent || '{}');
      const x = data?.boundingBox?.x;
      return Array.isArray(x) ? x[1] - x[0] : null;
    } catch {
      return null;
    }
  });
}

// Orbit + zoom the viewport away from its default framing via a real mouse drag
// + wheel on the canvas (OrbitControls' own input path), then poll the live
// camera state until damping has actually decayed to a stop instead of
// sleeping a guessed duration.
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
  await waitForCameraSettle(page);
}

/** Poll the live camera pose until it stops changing between samples (damping
 *  has decayed) for a short stable window, rather than sleeping a guessed
 *  duration. Real signal: OrbitControls fires 'change' every frame while
 *  still decaying, so consecutive reads keep moving until it actually stops. */
async function waitForCameraSettle(page: Page, opts: { timeout?: number; stableMs?: number } = {}): Promise<Camera> {
  const { timeout = 5000, stableMs = 150 } = opts;
  const deadline = Date.now() + timeout;
  let last = await camera(page);
  let stableSince = Date.now();
  for (;;) {
    await new Promise((r) => setTimeout(r, 40));
    const cur = await camera(page);
    const delta = Math.abs(cur.azimuth - last.azimuth) + Math.abs(cur.elevation - last.elevation) + Math.abs(cur.distance - last.distance);
    if (delta < 0.02) {
      if (Date.now() - stableSince >= stableMs) return cur;
    } else {
      stableSince = Date.now();
    }
    last = cur;
    if (Date.now() >= deadline) return cur; // best effort — caller's own assertions will catch a real failure
  }
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
    // runAndSave awaits the full run (including the synchronous auto-frame),
    // so no settle margin is needed before orbiting.

    await orbitAndZoom(page);
    const before = await camera(page);
    // Sanity: we actually moved off the default ~45°/35° framing.
    expect(Math.abs(before.azimuth - 45) > 5 || Math.abs(before.elevation - 35) > 5).toBe(true);

    // Switch to the earlier version. loadVersion's setValue synchronously
    // cancels any pending debounced auto-run (see codeEditor.ts setValue), so
    // there's no later re-render to wait out — just a small margin for the
    // evaluate() round-trip to fully settle in the page.
    await page.evaluate(async () => {
      const pw = (window as unknown as { partwright: PW }).partwright;
      const versions = await pw.listVersions();
      await pw.loadVersion({ index: versions[0].index });
    });
    await page.waitForTimeout(150);

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
    // Wait for the debounced auto-run to actually land the new geometry (bbox
    // width 6, down from the original 10) instead of sleeping past a guessed
    // debounce + render time.
    await waitFor(() => bboxWidth(page).then((w) => (w !== null && Math.abs(w - 6) < 0.5 ? w : null)), {
      timeout: 8000,
      message: 'the debounced auto-run to land the edited geometry',
    });

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
    await orbitAndZoom(page);
    const orbited = await camera(page);

    // Open a brand-new session — its first render must auto-frame to the default
    // view, NOT inherit the orbited angle from the previous session.
    await page.evaluate(async (sphere) => {
      const pw = (window as unknown as { partwright: { createSession(): Promise<unknown> } & PW }).partwright;
      await pw.createSession();
      await pw.run(sphere);
    }, SPHERE);

    // Default framing is ~azimuth 45 / elevation 35; poll for it directly
    // (also the exact condition the assertions below check) instead of
    // sleeping a guess and sampling once.
    const fresh = await waitFor(
      () => camera(page).then((c) => (Math.abs(c.elevation - 35) < 5 ? c : null)),
      { timeout: 5000, message: 'the fresh session to auto-frame to the default view' },
    );
    // Assert we snapped to the default and did not carry over the orbited angle.
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
    await orbitAndZoom(page);
    const before = await camera(page);
    expect(Math.abs(before.azimuth - 45) > 5 || Math.abs(before.elevation - 35) > 5).toBe(true);

    // AI path: preserveCamera keeps the angle across the re-render. setCameraPose
    // restores the preserved pose synchronously inside runCodeSync — awaited
    // fully by runAndSave — so no post-await margin is needed.
    await page.evaluate(async () => {
      await (window as unknown as { partwright: PW }).partwright.runAndSave('const { Manifold } = api; return Manifold.cube([6, 6, 6], true);', 'ai-edit', undefined, { preserveCamera: true });
    });
    const afterAI = await camera(page);
    expect(Math.abs(afterAI.azimuth - before.azimuth)).toBeLessThan(2);
    expect(Math.abs(afterAI.distance - before.distance)).toBeLessThan(2);

    // Bare console runAndSave (no opts) auto-frames back to the default ~45/35 —
    // again synchronous within the awaited call.
    await page.evaluate(async () => {
      await (window as unknown as { partwright: PW }).partwright.runAndSave('const { Manifold } = api; return Manifold.cube([20, 20, 20], true);', 'console-edit');
    });
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
      await pw.setActiveLanguage('scad'); // first SCAD run lazy-loads the WASM engine (awaited)
      await pw.run(code);
    }, SCAD);

    await orbitAndZoom(page);
    const before = await camera(page);
    expect(Math.abs(before.azimuth - 45) > 5 || Math.abs(before.elevation - 35) > 5).toBe(true);

    // Drive the Customize panel's Width slider — the exact path the user hits.
    // This is a raw DOM event dispatch (not an awaited call), so wait for the
    // real completion signal: the bbox reflecting the new width (50, up from 20).
    await page.evaluate(() => {
      const panel = document.getElementById('params-panel')!;
      const slider = panel.querySelector('input[type="range"]') as HTMLInputElement;
      slider.value = '50';
      slider.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await waitFor(() => bboxWidth(page).then((w) => (w !== null && Math.abs(w - 50) < 1 ? w : null)), {
      timeout: 10000,
      message: 'the SCAD Customizer two-phase re-render to land the new width',
    });

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
    await orbitAndZoom(page);
    // Wait for the debounced workCamera save to actually land in session state
    // (real signal — see workCameraSaveDebounceMs in appConfig.ts) rather than
    // sleeping past a guessed debounce + IDB-write time.
    await waitFor(
      () => page.evaluate(async () => {
        const sm = await import('/src/storage/sessionManager.ts');
        return !!sm.getState().session?.workCamera;
      }),
      { timeout: 5000, message: 'the debounced workCamera save to land' },
    );
    const before = await camera(page);
    expect(Math.abs(before.azimuth - 45) > 5 || Math.abs(before.elevation - 35) > 5).toBe(true);
    const url = page.url();
    expect(url).toContain('session=');

    // Reload the same session URL — fresh page, IndexedDB persists.
    await page.goto(url);
    await page.waitForSelector('text=Ready', { timeout: 15000 });
    // Poll for the restored pose to actually match — the exact condition the
    // assertions below check — instead of sleeping a guess and sampling once.
    const after = await waitFor(
      () => camera(page).then((c) =>
        Math.abs(c.azimuth - before.azimuth) < 3 && Math.abs(c.elevation - before.elevation) < 3 && Math.abs(c.distance - before.distance) < 3
          ? c
          : null,
      ),
      { timeout: 10000, message: 'the persisted workCamera to be restored after reload' },
    );
    expect(Math.abs(after.azimuth - before.azimuth)).toBeLessThan(3);
    expect(Math.abs(after.elevation - before.elevation)).toBeLessThan(3);
    expect(Math.abs(after.distance - before.distance)).toBeLessThan(3);
  });
});
