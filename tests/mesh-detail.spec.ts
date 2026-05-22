import { test, expect } from 'playwright/test';

// "Mesh detail" slider in the viewport Mesh popover (global mesh-refinement
// factor):
//   1. Defaults to OFF (factor 1) — no global subdivision out of the box.
//   2. Driving it changes triangle density by ~n² (refine math), including on
//      flat-faced geometry — a 12-triangle cube becomes 12·n².
//   3. The chosen factor is SESSION-scoped: it persists with the active session
//      (restored on reload) and resets to the default for a brand-new session.
//
// The slider lives inside the (initially hidden) Mesh popover, so we drive it
// via its value + change event rather than opening the panel — that also keeps
// the onboarding tour (interactive view) from intercepting clicks.

type RunResult = { triangleCount?: number; error?: string };
type PartwrightApi = { run: (code: string) => Promise<RunResult> };

const CUBE = 'const { Manifold } = api; return Manifold.cube([10, 10, 10]);';

async function setDetail(page: import('playwright/test').Page, n: number): Promise<void> {
  await page.evaluate((v) => {
    const el = document.getElementById('mesh-detail-slider') as HTMLInputElement;
    el.value = String(v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, n);
}

async function runCube(page: import('playwright/test').Page): Promise<RunResult> {
  return page.evaluate((code) => {
    const api = (window as unknown as { partwright: PartwrightApi }).partwright;
    return api.run(code);
  }, CUBE);
}

// Read a session's persisted meshSettings straight from IndexedDB, so we can
// deterministically wait for the (fire-and-forget) write to commit.
function readMeshSettings(page: import('playwright/test').Page, sessionId: string) {
  return page.evaluate((id) => new Promise<{ quality: string; refine: number } | null>((resolve) => {
    const req = indexedDB.open('partwright');
    req.onsuccess = () => {
      const db = req.result;
      const get = db.transaction('sessions', 'readonly').objectStore('sessions').get(id);
      get.onsuccess = () => resolve((get.result?.meshSettings ?? null));
      get.onerror = () => resolve(null);
    };
    req.onerror = () => resolve(null);
  }), sessionId);
}

async function waitForEngine(page: import('playwright/test').Page): Promise<void> {
  await page.waitForFunction(
    () => !!(window as unknown as { partwright?: { run?: unknown } }).partwright?.run,
    { timeout: 20_000 },
  );
}

function activeSessionId(page: import('playwright/test').Page): string {
  return new URL(page.url()).searchParams.get('session') ?? '';
}

test.describe('Mesh detail slider', () => {
  test('defaults to off and refines a flat cube by n²', async ({ page }) => {
    await page.goto('/editor');
    await page.waitForSelector('#mesh-detail-slider', { state: 'attached' });

    // Default factor is 1 (off) — no global subdivision out of the box.
    await expect(page.locator('#mesh-detail-slider')).toHaveValue('1');
    await expect(page.locator('#mesh-detail-readout')).toHaveText('off');

    await waitForEngine(page);

    // Default (off) leaves the bare cube at its native 12 triangles.
    expect((await runCube(page)).triangleCount).toBe(12);

    // refine(2) splits every edge in two → 12·4.
    await setDetail(page, 2);
    await expect(page.locator('#mesh-detail-readout')).toHaveText('2×');
    expect((await runCube(page)).triangleCount).toBe(48);

    // refine(3) → 12·9 triangles.
    await setDetail(page, 3);
    await expect(page.locator('#mesh-detail-readout')).toHaveText('3×');
    expect((await runCube(page)).triangleCount).toBe(108);

    // The range goes well past single digits — refine(32) → 12·1024 triangles.
    await setDetail(page, 32);
    await expect(page.locator('#mesh-detail-readout')).toHaveText('32×');
    expect((await runCube(page)).triangleCount).toBe(12288);
  });

  test('persists the factor to the session and restores on reload', async ({ page }) => {
    await page.goto('/editor');
    await page.waitForSelector('#mesh-detail-slider', { state: 'attached' });
    await waitForEngine(page);

    // Settings are per-session, so create a real session to persist into.
    await page.evaluate(() => (window as unknown as { partwright: { createSession(n: string): Promise<unknown> } }).partwright.createSession('mesh-detail-persist'));
    const id = activeSessionId(page);
    expect(id).not.toBe('');

    await setDetail(page, 4);
    // Wait for the write-through to IndexedDB before reloading.
    await expect.poll(() => readMeshSettings(page, id)).toMatchObject({ refine: 4 });

    await page.reload();
    await page.waitForSelector('#mesh-detail-slider', { state: 'attached' });
    await expect(page.locator('#mesh-detail-slider')).toHaveValue('4');
    await expect(page.locator('#mesh-detail-readout')).toHaveText('4×');
  });

  test('a brand-new session resets the factor to the default (off)', async ({ page }) => {
    await page.goto('/editor');
    await page.waitForSelector('#mesh-detail-slider', { state: 'attached' });
    await waitForEngine(page);

    await page.evaluate(() => (window as unknown as { partwright: { createSession(n: string): Promise<unknown> } }).partwright.createSession('first'));
    await setDetail(page, 8);
    await expect(page.locator('#mesh-detail-slider')).toHaveValue('8');

    // A new session must not inherit the previous session's mesh detail.
    await page.evaluate(() => (window as unknown as { partwright: { createSession(n: string): Promise<unknown> } }).partwright.createSession('second'));
    await expect(page.locator('#mesh-detail-slider')).toHaveValue('1');
    await expect(page.locator('#mesh-detail-readout')).toHaveText('off');
  });
});
