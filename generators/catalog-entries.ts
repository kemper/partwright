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
  /** Optional per-entry thumbnail-camera pin (degrees; azimuth 0=front/−Y,
   *  90=right/+X, 180=back/+Y; elevation 0=horizon, 90=top — see
   *  STANDARD_VIEWS in src/renderer/multiview.ts). Defaults to the standard
   *  iso tile (az 45, el 35 — the +X/−Y corner) when omitted — set this
   *  instead of baking orientation into the geometry when a model's "hero
   *  face" doesn't sit on the default corner. */
  thumbCamera?: { azimuth: number; elevation: number };
  /** Expected component count for the runAndSave manifold assertion. Defaults
   *  to 1; set higher for intentionally multi-part models (e.g. a two-part box
   *  whose base + lid are separate solids). */
  maxComponents?: number;
}

// This list is the CURRENT batch to bake — the generator writes a
// .partwright.json for each and appends any missing manifest entry (existing
// ids are skipped, so prior batches aren't disturbed). Replace it with the new
// examples when adding a batch.
const newEntries: CatalogEntry[] = [
  {
    exampleFile: 'parametric_enclosure.js',
    catalogFile: 'parametric_enclosure.partwright.json',
    id: 'parametric-enclosure',
    name: 'Project Box / Enclosure',
    description: 'A fully parametric two-part project box built with api.enclosure — choose a lip-nesting or screw-down lid, then tune size, wall, corner radius, fit, and screw size in the Customizer. The screw lid composes api.fasteners for its tapped corner bosses and countersunk holes.',
    maxComponents: 2, // base + lid are separate solids across the clearance gap
  },
  {
    exampleFile: 'knurled_control_knob.js',
    catalogFile: 'knurled_control_knob.partwright.json',
    id: 'knurled-control-knob',
    name: 'Knurled Control Knob',
    description: 'A customizable control knob with a functional knurled grip built with api.knurl — switch between a diamond cross-hatch, straight splines, or finger ribs, and mount it on a plain shaft, a D-shaft, or a heat-set threaded insert. Pointer notch optional.',
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
      const payload = await page.evaluate(async ({ code, name, thumbCamera, maxComponents }) => {
        const pw = (window as unknown as { partwright: {
          createSession: (n: string) => Promise<unknown>;
          runAndSave: (c: string, label?: string, a?: unknown) => Promise<unknown>;
          setThumbnailCamera: (c: { azimuth: number; elevation: number }) => Promise<unknown>;
          exportSessionData: (id?: string, opts?: { includeThumbnails?: boolean }) => Promise<{ data?: unknown; error?: string }>;
        } }).partwright;
        await pw.createSession(name);
        // Pin the tile camera BEFORE runAndSave so captureThumbnail() inside it
        // renders from the entry's chosen angle (and the pin is exported with
        // the session, so re-renders keep it).
        if (thumbCamera) await pw.setThumbnailCamera(thumbCamera);
        const run = await pw.runAndSave(code, 'v1', { isManifold: true, maxComponents }) as { passed?: boolean; failures?: string[]; geometry?: { status?: string; error?: string } };
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
      }, { code: src, name: entry.name, thumbCamera: entry.thumbCamera ?? null, maxComponents: entry.maxComponents ?? 1 });

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
