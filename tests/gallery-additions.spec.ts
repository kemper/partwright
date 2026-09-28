// Verifies every new gallery model from this task actually runs and
// produces the expected one-piece manifold result. Catches subagent code
// that *looks* right but fails on the real WASM (degenerate booleans,
// off-by-one wedge overlap, etc.) so I can fix it before the PR.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, type Page } from 'playwright/test';
import { openSharedEditor } from './helpers/sharedPage';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

// Each case runs a whole example file through partwright.runAndSave and
// checks only the returned result object — nothing persists between cases —
// so the file shares one booted editor instead of paying a fresh page +
// WASM boot per example.
let page: Page;
test.beforeAll(async ({ browser }, testInfo) => {
  page = await openSharedEditor(browser, testInfo);
});
test.afterAll(async () => {
  await page?.context().close();
});

test.describe('Gallery additions render cleanly', () => {
  for (const name of newExamples) {
    test(`${name} runs and produces a single-component manifold`, async () => {
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
