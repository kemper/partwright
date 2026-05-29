// Verifies every new gallery model from this task actually runs and
// produces the expected one-piece manifold result. Catches subagent code
// that *looks* right but fails on the real WASM (degenerate booleans,
// off-by-one wedge overlap, etc.) so I can fix it before the PR.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, type Page } from 'playwright/test';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function waitForEngine(page: Page): Promise<void> {
  await page.waitForSelector('text=Ready', { timeout: 20_000 });
  await page.waitForFunction(
    () => !!(window as unknown as { partwright?: { run?: unknown } }).partwright?.run,
    { timeout: 20_000 },
  );
}

interface RunResult {
  geometry: { status: string; error?: string; isManifold?: boolean; componentCount?: number; triangleCount?: number };
  passed?: boolean;
  failures?: string[];
}

const examplesDir = path.resolve(__dirname, '..', 'examples');
const newExamples = [
  'spiral_staircase.js',
  'geodesic_lantern.js',
  'clock_face.js',
  'honeycomb_planter.js',
  'wind_turbine.js',
];

test.describe('Gallery additions render cleanly', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('partwright-tour-completed', '1'));
    await page.goto('/editor');
    await waitForEngine(page);
  });

  for (const name of newExamples) {
    test(`${name} runs and produces a single-component manifold`, async ({ page }) => {
      const filePath = path.join(examplesDir, name);
      if (!fs.existsSync(filePath)) {
        test.skip(true, `Example ${name} not present yet`);
      }
      const src = fs.readFileSync(filePath, 'utf8');

      const result = await page.evaluate(async ({ code, label }) => {
        const pw = (window as unknown as { partwright: { runAndSave: (c: string, l?: string, a?: unknown) => Promise<unknown> } }).partwright;
        return await pw.runAndSave(code, label, { isManifold: true, maxComponents: 1 });
      }, { code: src, label: name });

      const r = result as RunResult;
      if (r.geometry.status === 'error') {
        throw new Error(`${name} failed to run:\n${r.geometry.error}`);
      }
      if (r.failures && r.failures.length > 0) {
        throw new Error(`${name} failed assertions:\n${r.failures.join('; ')}`);
      }
      expect(r.geometry.isManifold).toBe(true);
      expect(r.geometry.componentCount).toBe(1);
      expect(r.geometry.triangleCount ?? 0).toBeGreaterThan(100);
    });
  }
});
