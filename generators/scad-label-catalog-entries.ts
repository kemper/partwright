// One-shot generator for new SCAD-with-label() catalog entries.
//
// Reads JSON specs from `generators/scad-label-specs/*.json` (each
// describing one model: slug, name, description, scadCode, paintCalls,
// triangleCount), runs each through the SCAD label-aware pipeline in a
// real browser, applies the paint calls, and writes the exported session
// data to `public/catalog/<slug>.partwright.json`. Also writes the SCAD
// source to `examples/<slug>.scad` and patches
// `public/catalog/manifest.json`.
//
// Lives outside `tests/` so the default `npm run test:e2e` (which uses
// `playwright.config.ts → testDir: './tests'`) never picks it up.
//
// Specs live under `generators/scad-label-specs/` (tracked) instead of
// `.plans/` (gitignored) so a fresh clone can regenerate the same catalog
// entries deterministically.
//
// Run with:
//   npm run generate:catalog -- generators/scad-label-catalog-entries.ts

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, type Page } from 'playwright/test';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const specsDir = path.join(__dirname, 'scad-label-specs');
const examplesDir = path.join(repoRoot, 'examples');
const catalogDir = path.join(repoRoot, 'public', 'catalog');

interface PaintCall {
  label: string;
  color: [number, number, number];
}

interface Spec {
  slug: string;
  name: string;
  description: string;
  scadCode: string;
  paintCalls: PaintCall[];
  triangleCount?: number;
}

function loadSpecs(): Spec[] {
  if (!fs.existsSync(specsDir)) {
    throw new Error(
      `scad-label-catalog-entries: specs dir not found: ${specsDir}. ` +
      'Add JSON specs there (see existing files for shape) and re-run.',
    );
  }
  const files = fs.readdirSync(specsDir).filter(f => f.endsWith('.json'));
  if (files.length === 0) {
    throw new Error(
      `scad-label-catalog-entries: no JSON specs found in ${specsDir}. ` +
      'Without specs the generator would silently no-op and leave catalog files stale.',
    );
  }
  return files.map(f => {
    const raw = JSON.parse(fs.readFileSync(path.join(specsDir, f), 'utf8'));
    return raw as Spec;
  });
}

const specs = loadSpecs();

async function waitForEngine(page: Page): Promise<void> {
  await page.waitForSelector('text=Ready', { timeout: 30_000 });
  await page.waitForFunction(
    () => !!(window as unknown as { partwright?: { run?: unknown } }).partwright?.run,
    { timeout: 30_000 },
  );
}

test.describe.serial('generate SCAD label catalog entries', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('partwright-tour-completed', '1'));
  });

  test.setTimeout(300_000);

  for (const spec of specs) {
    test(`build ${spec.slug}`, async ({ page }) => {
      // Also write the SCAD source to examples/ so it shows up as a sharable
      // standalone file (the catalog JSON embeds the same code, but having
      // the .scad alongside is the existing convention).
      const examplePath = path.join(examplesDir, `${spec.slug.replace(/-/g, '_')}.scad`);
      fs.writeFileSync(examplePath, spec.scadCode, 'utf8');

      await page.goto('/editor');
      await waitForEngine(page);

      const payload = await page.evaluate(async ({ code, name, paintCalls }) => {
        const pw = (window as unknown as { partwright: {
          setActiveLanguage: (lang: 'manifold-js' | 'scad') => Promise<void>;
          createSession: (n: string) => Promise<unknown>;
          runAndSave: (c: string, label?: string, a?: unknown) => Promise<{ passed?: boolean; failures?: string[]; geometry?: { status?: string; error?: string } }>;
          paintByLabel: (opts: { label: string; color: [number, number, number] }) => Promise<unknown> | { error?: string };
          listLabels: () => { labels?: Array<{ name: string }> } | { error?: string };
          saveVersion: (label?: string) => Promise<unknown>;
          exportSessionData: (id?: string, opts?: { includeThumbnails?: boolean }) => Promise<{ data?: unknown; error?: string }>;
        } }).partwright;
        await pw.setActiveLanguage('scad');
        await pw.createSession(name);
        const run = await pw.runAndSave(code, 'v1', { isManifold: true });
        if (run.failures && run.failures.length > 0) {
          throw new Error('runAndSave assertions failed: ' + run.failures.join('; '));
        }
        if (run.geometry?.status === 'error') {
          throw new Error('runAndSave geometry error: ' + run.geometry.error);
        }
        // Sanity: the labels we plan to paint must actually have resolved.
        const labels = pw.listLabels();
        if ('error' in labels && labels.error) {
          throw new Error('listLabels error: ' + labels.error);
        }
        const known = new Set(('labels' in labels && labels.labels ? labels.labels : []).map(l => l.name));
        const missing = paintCalls.map(p => p.label).filter(n => !known.has(n));
        if (missing.length) {
          throw new Error(
            `expected labels not registered: ${missing.join(', ')}. ` +
            `Known: ${[...known].join(', ') || '(none)'}`,
          );
        }
        // Apply paint calls one at a time so a per-region failure surfaces a
        // clear error message (paintByLabels would mask which call broke).
        for (const pc of paintCalls) {
          const r = await pw.paintByLabel(pc);
          if (r && typeof r === 'object' && 'error' in r && r.error) {
            throw new Error(`paintByLabel(${pc.label}): ${r.error}`);
          }
        }
        // Persist the painted state as a new version so the catalog tile
        // shows the colored model rather than the v1 base.
        await pw.saveVersion('painted');
        await new Promise(r => setTimeout(r, 500));
        const exported = await pw.exportSessionData(undefined, { includeThumbnails: true });
        if (exported.error) throw new Error('exportSessionData: ' + exported.error);
        return exported.data;
      }, { code: spec.scadCode, name: spec.name, paintCalls: spec.paintCalls });

      const outPath = path.join(catalogDir, `${spec.slug.replace(/-/g, '_')}.partwright.json`);
      fs.writeFileSync(outPath, JSON.stringify(payload, null, 2) + '\n', 'utf8');
    });
  }

  test('patch manifest.json with label-aware SCAD entries', async () => {
    const manifestPath = path.join(catalogDir, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as {
      entries: Array<{ id: string; name: string; file: string; language: string; description: string }>;
    };
    for (const spec of specs) {
      const file = `${spec.slug.replace(/-/g, '_')}.partwright.json`;
      if (!fs.existsSync(path.join(catalogDir, file))) continue;
      if (manifest.entries.some(e => e.id === spec.slug)) continue;
      manifest.entries.push({
        id: spec.slug,
        name: spec.name,
        file,
        language: 'scad',
        description: spec.description,
      });
    }
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  });
});
