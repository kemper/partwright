// One-shot generator for new SCAD catalog entries.
//
// Differs from catalog-entries.ts in that it switches the engine to
// 'scad' before running each example. SCAD WASM is heavy (~10MB) and
// the first compile takes ~3s; we use serial+page-per-test for
// isolation and wait for the engine flip to settle before issuing
// pw.run().
//
// Lives outside `tests/` so the default `npm run test:e2e` (which uses
// playwright.config.ts → testDir: './tests') never picks it up.
//
// Run with:
//   npm run generate:catalog -- generators/scad-catalog-entries.ts

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, type Page } from 'playwright/test';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const examplesDir = path.resolve(__dirname, '..', 'examples');
const catalogDir = path.resolve(__dirname, '..', 'public', 'catalog');

interface CatalogEntry {
  exampleFile: string;
  catalogFile: string;
  id: string;
  name: string;
  description: string;
}

const newEntries: CatalogEntry[] = [
  {
    exampleFile: 'hex_bolt_and_nut.scad',
    catalogFile: 'hex_bolt_and_nut.partwright.json',
    id: 'hex-bolt-and-nut',
    name: 'Hex Bolt & Nut Set',
    description: 'M16x3 hex bolt, matching nut, and washer laid out side-by-side. Showcases BOSL2\'s screw() and nut() — real threaded geometry that manifold-js can\'t easily reproduce.',
  },
  {
    exampleFile: 'spur_gear_pair.scad',
    catalogFile: 'spur_gear_pair.partwright.json',
    id: 'spur-gear-pair',
    name: 'Spur Gear Pair',
    description: 'Two meshing involute spur gears on a rounded base plate, with tooth offset so they interlock correctly. Built with BOSL2\'s spur_gear() and gear_dist().',
  },
  {
    exampleFile: 'pipe_tee_fitting.scad',
    catalogFile: 'pipe_tee_fitting.partwright.json',
    id: 'pipe-tee-fitting',
    name: 'Pipe Tee Fitting',
    description: 'A 3-way plumbing tee fitting with flared collars and connected interior cavity. Showcases BOSL2\'s tube() and rounded-end primitives.',
  },
  {
    exampleFile: 'modular_drawer_bin.scad',
    catalogFile: 'modular_drawer_bin.partwright.json',
    id: 'modular-drawer-bin',
    name: 'Modular Drawer Bin',
    description: 'A stackable storage bin with two compartments, rounded corners, and stacking lugs. Built with BOSL2\'s cuboid(rounding=) and attach() — the SCAD-only verbs.',
  },
];

async function waitForEngine(page: Page): Promise<void> {
  await page.waitForSelector('text=Ready', { timeout: 30_000 });
  await page.waitForFunction(
    () => !!(window as unknown as { partwright?: { run?: unknown } }).partwright?.run,
    { timeout: 30_000 },
  );
}

test.describe.serial('generate SCAD catalog entries', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('partwright-tour-completed', '1'));
  });

  // SCAD WASM (~10MB) + BOSL2 import + threaded-rod / gear-tooth math can
  // easily push a single compile past the default 30s timeout. The engine
  // itself allots 180s for a SCAD execute (see EXECUTE_TIMEOUT_MS), and the
  // test does goto + waitForEngine + setActiveLanguage + thumbnail/export on
  // top of that, so give the test a comfortable margin above the engine
  // ceiling rather than racing it.
  test.setTimeout(300_000);

  for (const entry of newEntries) {
    test(`build ${entry.catalogFile}`, async ({ page }) => {
      const filePath = path.join(examplesDir, entry.exampleFile);
      if (!fs.existsSync(filePath)) {
        test.skip(true, `Example ${entry.exampleFile} not present yet`);
      }
      const src = fs.readFileSync(filePath, 'utf8');

      await page.goto('/editor');
      await waitForEngine(page);

      // Switch to SCAD via the partwright API rather than the UI toggle so the
      // active language flip and the SCAD-WASM init are deterministically
      // awaited before runAndSave fires. The toolbar click hands off to an
      // async handler that isn't awaited by Playwright; on a slow CI runner
      // the wait that followed wasn't long enough for activeLanguage to land
      // on 'scad', and runAndSave then executed under the manifold-js 60s
      // timeout ceiling against a BOSL2 compile that needs ~50s on its own.
      const payload = await page.evaluate(async ({ code, name }) => {
        const pw = (window as unknown as { partwright: {
          setActiveLanguage: (lang: 'manifold-js' | 'scad') => Promise<void>;
          createSession: (n: string) => Promise<unknown>;
          runAndSave: (c: string, label?: string, a?: unknown) => Promise<unknown>;
          exportSessionData: (id?: string, opts?: { includeThumbnails?: boolean }) => Promise<{ data?: unknown; error?: string }>;
        } }).partwright;
        await pw.setActiveLanguage('scad');
        await pw.createSession(name);
        // Don't enforce maxComponents — some SCAD models in this batch are
        // intentionally multi-part (hex bolt + nut + washer is 3 pieces laid
        // out side-by-side, the gear pair has 2 free gears on a plate, etc.).
        // The single-component assertion was a manifold-js convention.
        const run = await pw.runAndSave(code, 'v1', { isManifold: true }) as { passed?: boolean; failures?: string[]; geometry?: { status?: string; error?: string } };
        if (run.failures && run.failures.length > 0) {
          throw new Error('runAndSave assertions failed: ' + run.failures.join('; '));
        }
        if (run.geometry?.status === 'error') {
          throw new Error('runAndSave geometry error: ' + run.geometry.error);
        }
        await new Promise(r => setTimeout(r, 500));
        const exported = await pw.exportSessionData(undefined, { includeThumbnails: true });
        if (exported.error) throw new Error('exportSessionData: ' + exported.error);
        return exported.data;
      }, { code: src, name: entry.name });

      const outPath = path.join(catalogDir, entry.catalogFile);
      fs.writeFileSync(outPath, JSON.stringify(payload, null, 2) + '\n', 'utf8');
    });
  }

  test('patch manifest.json with SCAD entries', async () => {
    const manifestPath = path.join(catalogDir, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as { entries: Array<{ id: string; name: string; file: string; language: string; description: string }> };
    for (const entry of newEntries) {
      const built = path.join(catalogDir, entry.catalogFile);
      if (!fs.existsSync(built)) continue; // didn't generate (subagent didn't write source)
      if (manifest.entries.some(e => e.id === entry.id)) continue;
      manifest.entries.push({
        id: entry.id,
        name: entry.name,
        file: entry.catalogFile,
        language: 'scad',
        description: entry.description,
      });
    }
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  });
});
