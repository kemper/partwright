import { test, expect } from 'playwright/test';

// Verifies the OpenSCAD engine seeds $fn from the quality preset.
// We use the in-page console API to run a tiny sphere in SCAD under
// each preset and compare the resulting triangle counts.

test.setTimeout(60_000);

test.beforeEach(async ({ page }) => {
  // Suppress the first-run guided tour — its backdrop intercepts clicks.
  await page.addInitScript(() => {
    try { localStorage.setItem('partwright-tour-completed', '1'); } catch { /* ignore */ }
  });
});

test('SCAD engine applies the chosen $fn from quality preset', async ({ page }) => {
  await page.goto('/editor');
  await page.waitForFunction(() => !!document.querySelector('#simplify-toggle'));

  type RunResult = {
    triangleCount?: number;
    error?: string;
    scadTimings?: {
      compileMs: number;
      parseMs: number;
      regionImportMs: { name: string; ms: number; triangleCount: number }[];
      composeMs: number;
      labelResolveMs: number;
      totalMs: number;
    };
  };
  type PartwrightApi = {
    run: (code: string) => Promise<RunResult>;
    setLanguage?: (lang: 'manifold-js' | 'scad') => Promise<void> | void;
  };

  await page.waitForFunction(
    () => !!(window as unknown as { partwright?: { run?: unknown } }).partwright?.run,
    { timeout: 30_000 },
  );

  // Switch to SCAD by clicking the SCAD button in the language toggle.
  // The button is the second pill in #lang-toggle ("SCAD"). Confirm any
  // dialog asking about session switching.
  page.on('dialog', d => d.accept());

  // The simpler path: switch via the toolbar language button. We've seen
  // it ask for confirmation when a session has versions — there's none
  // here, so it should switch silently.
  await page.locator('#lang-toggle button:has-text("SCAD")').click();
  await page.waitForTimeout(2000); // give SCAD WASM a moment to spin up

  const scadCode = 'sphere(5);';

  // Run under Medium (SCAD default = 32 segments) — produces a visible mesh.
  const high = await page.evaluate(async (code) => {
    const api = (window as unknown as { partwright: PartwrightApi }).partwright;
    return api.run(code);
  }, scadCode);
  expect(high.error).toBeFalsy();
  expect(high.triangleCount ?? 0).toBeGreaterThan(100);

  // Drop to Low via the curvature quality panel, then Apply to commit it
  // (picking a preset only previews; closing without Apply would revert). The
  // Quality button now lives in the viewport Tools popover, so open it first.
  await page.locator('#viewport-tools-group-btn').click();
  await page.locator('#simplify-toggle').click();
  await page.locator('#simplify-panel input[type=radio][value=low]').check();
  await page.locator('#simplify-apply').click();
  await page.locator('#simplify-panel button[aria-label="Close quality panel"]').click();

  // Re-run — fewer triangles.
  const low = await page.evaluate(async (code) => {
    const api = (window as unknown as { partwright: PartwrightApi }).partwright;
    return api.run(code);
  }, scadCode);
  expect(low.error).toBeFalsy();
  expect(low.triangleCount ?? 0).toBeLessThan(high.triangleCount ?? 0);
  expect(low.triangleCount ?? 0).toBeGreaterThan(0);
});

test('label-aware SCAD run reports timing breakdown by region', async ({ page }) => {
  await page.goto('/editor');
  await page.waitForFunction(() => !!document.querySelector('#simplify-toggle'));
  await page.waitForFunction(
    () => !!(window as unknown as { partwright?: { run?: unknown } }).partwright?.run,
    { timeout: 30_000 },
  );

  page.on('dialog', d => d.accept());
  await page.locator('#lang-toggle button:has-text("SCAD")').click();
  await page.waitForTimeout(2000);

  const result = await page.evaluate(async () => {
    type PartwrightApi = {
      run: (code: string) => Promise<RunResult>;
      getGeometryData: () => RunResult;
    };
    const api = (window as unknown as { partwright: PartwrightApi }).partwright;
    const run = await api.run(`
      label("base") cube([10, 10, 2], center=true);
      label("knob") translate([0, 0, 3]) cylinder(h=4, r=2, center=true);
    `);
    return {
      runError: run.error,
      runTimings: run.scadTimings,
      dataTimings: api.getGeometryData().scadTimings,
    };
  });

  expect(result.runError).toBeFalsy();
  expect(result.runTimings?.compileMs).toBeGreaterThanOrEqual(0);
  expect(result.runTimings?.parseMs).toBeGreaterThanOrEqual(0);
  expect(result.runTimings?.composeMs).toBeGreaterThanOrEqual(0);
  expect(result.runTimings?.labelResolveMs).toBeGreaterThanOrEqual(0);
  expect(result.runTimings?.totalMs).toBeGreaterThanOrEqual(result.runTimings?.compileMs ?? 0);
  expect(result.runTimings?.regionImportMs.map(r => r.name)).toEqual(['base', 'knob']);
  for (const region of result.runTimings?.regionImportMs ?? []) {
    expect(region.ms).toBeGreaterThanOrEqual(0);
    expect(region.triangleCount).toBeGreaterThan(0);
  }
  expect(result.dataTimings).toEqual(result.runTimings);
});
