// One-shot catalog baker (NOT part of the test suite — skipped unless
// BAKE_CATALOG=1). Reads pairs from /tmp/catalog-bake/:
//   <id>.js        — the parametric manifold-js model (uses api.params + api.label)
//   <id>.meta.json — { id, name, description, paints: [{ label, color:"#hex", name? }] }
// For each it loads the editor, runs+saves the model, paints each labeled region
// (byLabel regions re-resolve on param change, so the color survives the
// Customizer), saves a colored version, exports the session JSON (with the
// colorized thumbnail) and writes it as a catalog entry + manifest row.
//
// Run:  BAKE_CATALOG=1 npx playwright test _catalogBake

import { test, expect, type Page } from 'playwright/test';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const FIX_DIR = '/tmp/catalog-bake';
const CATALOG = resolve(process.cwd(), 'public/catalog');

interface Meta {
  id: string;
  name: string;
  description: string;
  paints: { label: string; color: string; name?: string }[];
}

function hexToRgb01(hex: string): [number, number, number] {
  const s = hex.replace('#', '');
  const full = s.length === 3 ? s.split('').map(c => c + c).join('') : s;
  return [parseInt(full.slice(0, 2), 16) / 255, parseInt(full.slice(2, 4), 16) / 255, parseInt(full.slice(4, 6), 16) / 255];
}

async function waitForEngine(page: Page) {
  await page.waitForSelector('text=Ready', { timeout: 20_000 });
  await page.waitForFunction(() => !!(window as unknown as { partwright?: { run?: unknown } }).partwright?.run, { timeout: 20_000 });
}

test.describe('catalog baker', () => {
  test.skip(!process.env.BAKE_CATALOG, 'set BAKE_CATALOG=1 to run the baker');

  test('bake colorized parametric catalog entries', async ({ page }) => {
    test.setTimeout(600_000); // 6 serial browser sessions (some heavy) >> the 30s default
    const metaFiles = readdirSync(FIX_DIR).filter(f => f.endsWith('.meta.json'));
    expect(metaFiles.length).toBeGreaterThan(0);
    const baked: string[] = [];

    for (const mf of metaFiles) {
      const meta = JSON.parse(readFileSync(resolve(FIX_DIR, mf), 'utf8')) as Meta;
      const model = readFileSync(resolve(FIX_DIR, mf.replace('.meta.json', '.js')), 'utf8');
      const paints = meta.paints.map(p => ({ label: p.label, color: hexToRgb01(p.color), name: p.name ?? p.label }));

      await page.goto('/editor');
      await waitForEngine(page);

      const out = await page.evaluate(async ({ model, name, paints }) => {
        /* eslint-disable @typescript-eslint/no-explicit-any */
        const pw = (window as any).partwright;
        await pw.createSession(name);
        const run = await pw.runAndSave(model, 'shape');
        if (run?.geometry?.status === 'error') return { error: 'model error: ' + run.geometry.error };
        const paintResults: any[] = [];
        for (const p of paints) paintResults.push(await pw.paintByLabel(p));
        const saved = await pw.saveVersion('colored');
        const ex = await pw.exportSessionData(undefined, { includeThumbnails: true });
        return {
          geometry: run?.geometry,
          saved,
          paints: paintResults.map((r: any) => (r && r.error) ? `ERR:${r.error}` : `ok:${r.name}`),
          regionCount: (ex?.data?.versions?.at(-1)?.colorRegions ?? []).length,
          hasThumb: !!ex?.data?.versions?.at(-1)?.thumbnail,
          data: ex?.data,
        };
      }, { model, name: meta.name, paints });

      if ((out as { error?: string }).error || !out.data) {
        console.log(`BAKE_FAIL ${meta.id}: ${(out as { error?: string }).error ?? 'no data'}`);
        continue;
      }

      const file = `${meta.id.replace(/-/g, '_')}.partwright.json`;
      writeFileSync(resolve(CATALOG, file), JSON.stringify(out.data, null, 2) + '\n');
      const manifestPath = resolve(CATALOG, 'manifest.json');
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { entries: Array<Record<string, unknown>> };
      const row = { id: meta.id, name: meta.name, file, language: 'manifold-js', description: meta.description };
      const idx = manifest.entries.findIndex(e => e.id === meta.id);
      if (idx >= 0) manifest.entries[idx] = row; else manifest.entries.push(row);
      writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

      console.log(`BAKE_OK ${meta.id}: regions=${out.regionCount} thumb=${out.hasThumb} paints=[${out.paints.join(', ')}]`);
      baked.push(meta.id);
    }

    console.log(`BAKED_TOTAL ${baked.length}/${metaFiles.length}`);
    expect(baked.length).toBeGreaterThan(0);
  });
});

