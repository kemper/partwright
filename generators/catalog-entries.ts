// One-shot generator: takes each new example in examples/*.js, runs it
// through the engine via Playwright (so geometryData / thumbnail are
// populated correctly), exports the session as .partwright.json, and
// writes the result into public/catalog/. Also patches public/catalog/
// manifest.json with the new entries.
//
// Lives outside `tests/` so the default `npm run test:e2e` (which uses
// playwright.config.ts → testDir: './tests') never picks it up.
// Silently regenerating the catalog on every test run would leave the
// working tree dirty after each run and confuse follow-up sessions.
// It still uses the Playwright runner — that's where Page / fixtures /
// the dev-server lifecycle come from — but loads via a dedicated
// playwright.generators.config.ts.
//
// Run with:
//   npm run generate:catalog

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, type Page } from 'playwright/test';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const examplesDir = path.resolve(__dirname, '..', 'examples');
const catalogDir = path.resolve(__dirname, '..', 'public', 'catalog');

// Each entry: examples/*.js → public/catalog/*.partwright.json + manifest line.
interface CatalogEntry {
  exampleFile: string;          // file in examples/
  catalogFile: string;          // file in public/catalog/
  id: string;                   // manifest id (kebab-case)
  name: string;                 // user-facing name
  description: string;          // shows up under the tile
}

const newEntries: CatalogEntry[] = [
  {
    exampleFile: 'spiral_staircase.js',
    catalogFile: 'spiral_staircase.partwright.json',
    id: 'spiral-staircase',
    name: 'Spiral Staircase',
    description: 'A 16-step helical staircase around a central column, topped by a circular platform and balusters. Built with the spiralPattern helper for the steps and railing posts.',
  },
  {
    exampleFile: 'geodesic_lantern.js',
    catalogFile: 'geodesic_lantern.partwright.json',
    id: 'geodesic-lantern',
    name: 'Geodesic Lantern',
    description: 'A faceted dome lantern with two rings of cylindrical window cutouts and a small spire finial. Showcases circularPattern, placeOn, and the expectUnion safety net.',
  },
  {
    exampleFile: 'clock_face.js',
    catalogFile: 'clock_face.partwright.json',
    id: 'clock-face',
    name: 'Wall Clock Face',
    description: '100mm-diameter clock face with 12 hour markers, 60 minute ticks, and tapered hour + minute hands posed at 10:10. Built with the circularPattern radius shortcut.',
  },
  {
    exampleFile: 'honeycomb_planter.js',
    catalogFile: 'honeycomb_planter.partwright.json',
    id: 'honeycomb-planter',
    name: 'Honeycomb Planter',
    description: 'A cylindrical planter pot with a staggered honeycomb pattern carved through its wall. Built with nested linearPattern + circularPattern and the expectUnion connectivity check.',
  },
  {
    exampleFile: 'wind_turbine.js',
    catalogFile: 'wind_turbine.partwright.json',
    id: 'wind-turbine',
    name: 'Wind Turbine',
    description: 'A tapered tower with a nacelle, hub, and 3 swept blades — plus a service ladder up the tower face. Showcases placeOn for the nacelle and circularPattern with a non-Z axis for the rotor.',
  },
];

async function waitForEngine(page: Page): Promise<void> {
  await page.waitForSelector('text=Ready', { timeout: 30_000 });
  await page.waitForFunction(
    () => !!(window as unknown as { partwright?: { run?: unknown } }).partwright?.run,
    { timeout: 30_000 },
  );
}

test.describe.serial('generate catalog entries', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('partwright-tour-completed', '1'));
  });

  for (const entry of newEntries) {
    test(`build ${entry.catalogFile}`, async ({ page }) => {
      const src = fs.readFileSync(path.join(examplesDir, entry.exampleFile), 'utf8');

      await page.goto('/editor');
      await waitForEngine(page);

      // Build a session, run the code, export as JSON (with thumbnails so
      // the catalog tiles render the rendered preview, not a placeholder).
      const payload = await page.evaluate(async ({ code, name }) => {
        const pw = (window as unknown as { partwright: {
          createSession: (n: string) => Promise<unknown>;
          runAndSave: (c: string, label?: string, a?: unknown) => Promise<unknown>;
          exportSessionData: (id?: string, opts?: { includeThumbnails?: boolean }) => Promise<{ data?: unknown; error?: string }>;
        } }).partwright;
        await pw.createSession(name);
        const run = await pw.runAndSave(code, 'v1', { isManifold: true, maxComponents: 1 }) as { passed?: boolean; failures?: string[]; geometry?: { status?: string; error?: string } };
        if (run.failures && run.failures.length > 0) {
          throw new Error('runAndSave assertions failed: ' + run.failures.join('; '));
        }
        if (run.geometry?.status === 'error') {
          throw new Error('runAndSave geometry error: ' + run.geometry.error);
        }
        // captureThumbnail() inside runAndSave runs async after the version
        // row is written; give it a beat so the PNG blob lands on the
        // version before we read it back.
        await new Promise(r => setTimeout(r, 300));
        const exported = await pw.exportSessionData(undefined, { includeThumbnails: true });
        if (exported.error) throw new Error('exportSessionData: ' + exported.error);
        return exported.data;
      }, { code: src, name: entry.name });

      // Write to public/catalog/<name>.partwright.json — pretty-printed so
      // diffs are readable.
      const outPath = path.join(catalogDir, entry.catalogFile);
      fs.writeFileSync(outPath, JSON.stringify(payload, null, 2) + '\n', 'utf8');
    });
  }

  test('patch manifest.json', async () => {
    const manifestPath = path.join(catalogDir, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as { entries: Array<{ id: string; name: string; file: string; language: string; description: string }> };
    for (const entry of newEntries) {
      // Skip if already present (idempotent re-runs).
      if (manifest.entries.some(e => e.id === entry.id)) continue;
      manifest.entries.push({
        id: entry.id,
        name: entry.name,
        file: entry.catalogFile,
        language: 'manifold-js',
        description: entry.description,
      });
    }
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  });
});
