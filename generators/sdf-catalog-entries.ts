// Builds .partwright.json catalog entries for the SDF showcase examples.
// Sibling of generators/catalog-entries.ts — adds a paint-manifest step
// (`examples/<name>.paint.json`) so the catalog tiles can ship pre-coloured.
//
// Lives outside `tests/` so the default `npm run test:e2e` doesn't pick
// it up (same reason as catalog-entries.ts). Run with:
//
//   npx playwright test --config=playwright.generators.config.ts generators/sdf-catalog-entries.ts

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, type Page } from 'playwright/test';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const examplesDir = path.resolve(__dirname, '..', 'examples');
const catalogDir = path.resolve(__dirname, '..', 'public', 'catalog');

interface SdfEntry {
  exampleFile: string;    // examples/sdf_*.js
  paintFile: string;      // examples/sdf_*.paint.json
  catalogFile: string;    // public/catalog/sdf_*.partwright.json
  id: string;             // manifest id (kebab-case)
  name: string;
  description: string;
}

const newEntries: SdfEntry[] = [
  {
    exampleFile: 'sdf_organic_creature.js',
    paintFile: 'sdf_organic_creature.paint.json',
    catalogFile: 'sdf_organic_creature.partwright.json',
    id: 'sdf-organic-creature',
    name: 'SDF Organic Creature',
    description: 'A smooth-blended creature built entirely from SDF primitives — showcases smoothUnion for organic body welds and paint-by-label colourisation of an SDF model.',
  },
  {
    exampleFile: 'sdf_gyroid_chamber.js',
    paintFile: 'sdf_gyroid_chamber.paint.json',
    catalogFile: 'sdf_gyroid_chamber.partwright.json',
    id: 'sdf-gyroid-chamber',
    name: 'SDF Gyroid Chamber',
    description: 'A triply-periodic gyroid lattice clipped inside a solid frame — the SDF way to do 3D-printable infill in one expression.',
  },
  {
    exampleFile: 'sdf_twisted_vessel.js',
    paintFile: 'sdf_twisted_vessel.paint.json',
    catalogFile: 'sdf_twisted_vessel.partwright.json',
    id: 'sdf-twisted-vessel',
    name: 'SDF Twisted Vessel',
    description: 'A spiralled body produced by the SDF `.twist()` domain warp on a non-radially-symmetric profile, joined to a base with smoothUnion.',
  },
  {
    exampleFile: 'sdf_mixed_mechanical.js',
    paintFile: 'sdf_mixed_mechanical.paint.json',
    catalogFile: 'sdf_mixed_mechanical.partwright.json',
    id: 'sdf-mixed-mechanical',
    name: 'SDF + Manifold Mechanical Part',
    description: 'A mechanical part that mixes smooth-blended SDF features (grip, fillets) with crisp Manifold CSG (mounting plate, drilled holes) — shows how the two engines compose.',
  },
  {
    exampleFile: 'sdf_bloom.js',
    paintFile: 'sdf_bloom.paint.json',
    catalogFile: 'sdf_bloom.partwright.json',
    id: 'sdf-bloom',
    name: 'SDF Bloom',
    description: 'A stylised flower showcasing the SDF combinators — ellipsoid petals fanned out with polarArray (no hand-written coordinates), a flattened pollen centre, and a taper-narrowed stem. Three painted regions.',
  },
  {
    exampleFile: 'sdf_tpms_study.js',
    paintFile: 'sdf_tpms_study.paint.json',
    catalogFile: 'sdf_tpms_study.partwright.json',
    id: 'sdf-tpms-study',
    name: 'SDF TPMS Study',
    description: 'Four 14³ lattice tiles side-by-side on a plinth — Schwarz P, Diamond, Lidinoid, and a gradedGyroid with a diagonal thickness ramp. The exhaustive TPMS comparison; five painted regions.',
  },
  {
    exampleFile: 'sdf_radial_creature.js',
    paintFile: 'sdf_radial_creature.paint.json',
    catalogFile: 'sdf_radial_creature.partwright.json',
    id: 'sdf-aetherjelly',
    name: 'SDF Aetherjelly',
    description: 'A radial jellyfish-drifter built from ellipsoids, fanned into shape by polarArray (8 tentacles, 6 ocelli), bilaterally completed by mirrorPair, and tapered along its body axis. Three painted regions; the showcase for the SDF combinators.',
  },
  {
    exampleFile: 'sdf_helix_lamp_standard.js',
    paintFile: 'sdf_helix_lamp_standard.paint.json',
    catalogFile: 'sdf_helix_lamp_standard.partwright.json',
    id: 'sdf-helix-lamp',
    name: 'SDF Helix Lamp Standard',
    description: 'An architectural light post whose square-cross-section shaft spirals around an OFFSET vertical axis, paired with a perforated screen wall built by repeat() clipped to a slab and topped by a roundedCylinder lamp cap. Four painted regions; showcases the new offset-twist, repeat, and roundedCylinder primitives.',
  },
  {
    exampleFile: 'sdf_polarrepeat_showcase.js',
    paintFile: 'sdf_polarrepeat_showcase.paint.json',
    catalogFile: 'sdf_polarrepeat_showcase.partwright.json',
    id: 'sdf-spur-wheel',
    name: 'SDF 28-Tooth Spur Wheel',
    description: 'A spur/turbine wheel — single tooth (roundedBox + taper) folded 28-fold via polarRepeat, plus a 6-hole polarArray lightening web and a bored central hub. The canonical "polarArray for low counts, polarRepeat for high" showcase, in three painted regions.',
  },
  {
    exampleFile: 'sdf_repeatn_showcase.js',
    paintFile: 'sdf_repeatn_showcase.paint.json',
    catalogFile: 'sdf_repeatn_showcase.partwright.json',
    id: 'sdf-perforated-faceplate',
    name: 'SDF Perforated Faceplate',
    description: 'A speaker-style faceplate built on the finite-count repeatN combinator — a 7×5 grid of through-holes subtracted from a rounded slab, a recessed bezel, and a 4×1 row of LED-indicator bumps. The textbook "no intersect needed" case in three painted regions.',
  },
  {
    exampleFile: 'sdf_graded_tpms_study.js',
    paintFile: 'sdf_graded_tpms_study.paint.json',
    catalogFile: 'sdf_graded_tpms_study.partwright.json',
    id: 'sdf-graded-tpms-study',
    name: 'SDF Graded TPMS Study',
    description: 'A femur-inspired model exercising all three new graded TPMS variants: gradedSchwarzP for the cortical shaft (radial density), gradedDiamond for the marrow canal (axial trabecular grading), and gradedLidinoid for the femoral head (spherical-radial). Five painted regions.',
  },
  {
    exampleFile: 'sdf_brick_wall.js',
    paintFile: 'sdf_brick_wall.paint.json',
    catalogFile: 'sdf_brick_wall.partwright.json',
    id: 'sdf-brick-wall',
    name: 'SDF Running-Bond Brick Wall',
    description: 'A classic running-bond brick wall — bricks tiled via repeatN({stagger: {along: x, by: y}}), the new option for brick/honeycomb patterns. Every other course shifts by half a brick. Two painted regions on a recessed mortar slab.',
  },
];

interface PaintManifest {
  regions: Array<{ label: string; color: [number, number, number]; name?: string }>;
}

async function waitForEngine(page: Page): Promise<void> {
  await page.waitForSelector('text=Ready', { timeout: 30_000 });
  await page.waitForFunction(
    () => !!(window as unknown as { partwright?: { run?: unknown } }).partwright?.run,
    { timeout: 30_000 },
  );
}

test.describe.serial('generate sdf catalog entries', () => {
  // SDF lowering is heavier than the existing examples — marching
  // tetrahedra on a 0.4 edgeLength gyroid easily takes 30–60s on a CI
  // box. Give each entry a generous timeout so the runner doesn't
  // false-flag a slow render as a hung test.
  test.setTimeout(180_000);

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('partwright-tour-completed', '1'));
  });

  for (const entry of newEntries) {
    test(`build ${entry.catalogFile}`, async ({ page }) => {
      const code = fs.readFileSync(path.join(examplesDir, entry.exampleFile), 'utf8');
      const paint: PaintManifest = JSON.parse(
        fs.readFileSync(path.join(examplesDir, entry.paintFile), 'utf8'),
      );

      await page.goto('/editor');
      await waitForEngine(page);

      const payload = await page.evaluate(async ({ code, name, paint }) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const pw = (window as any).partwright;
        await pw.createSession(name);

        // 1. Initial save — runs the SDF code, validates, captures base
        // geometryData. Skip the maxComponents:1 assertion (gyroid often
        // has many disconnected lattice components, and a labelled-union
        // can too).
        const run = await pw.runAndSave(code, 'v1', { isManifold: true });
        if (run.failures && run.failures.length > 0) {
          throw new Error('runAndSave assertions failed: ' + run.failures.join('; '));
        }
        if (run.geometry?.status === 'error') {
          throw new Error('runAndSave geometry error: ' + run.geometry.error);
        }

        // 2. Paint each labelled region. If any region fails to resolve,
        // collect the error so we can fix the example or paint manifest
        // — don't silently ship a half-coloured tile.
        const paintFailures: string[] = [];
        for (const region of paint.regions) {
          const r = await pw.paintByLabel({
            label: region.label,
            color: region.color,
            ...(region.name ? { name: region.name } : {}),
          });
          if (r?.error) paintFailures.push(`${region.label}: ${r.error}`);
        }
        if (paintFailures.length > 0) {
          throw new Error('paintByLabel failures: ' + paintFailures.join('; '));
        }

        // 3. Re-save so the colorRegions land in the version's
        // geometryData and survive the export. The code is unchanged, but
        // the colour-region set differs from v1, so saveVersion creates
        // a fresh "v1 colored" version.
        const colored = await pw.runAndSave(code, 'v1 colored');
        if (colored.geometry?.status === 'error') {
          throw new Error('coloured runAndSave error: ' + colored.geometry.error);
        }

        // Let captureThumbnail's async write land before exporting.
        await new Promise(r => setTimeout(r, 400));
        const exported = await pw.exportSessionData(undefined, { includeThumbnails: true });
        if (exported.error) throw new Error('exportSessionData: ' + exported.error);
        return exported.data;
      }, { code, name: entry.name, paint });

      const outPath = path.join(catalogDir, entry.catalogFile);
      fs.writeFileSync(outPath, JSON.stringify(payload, null, 2) + '\n', 'utf8');
    });
  }

  test('patch manifest.json', async () => {
    const manifestPath = path.join(catalogDir, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as {
      entries: Array<{ id: string; name: string; file: string; language: string; description: string }>;
    };
    for (const entry of newEntries) {
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
