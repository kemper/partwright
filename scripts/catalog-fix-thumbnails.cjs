#!/usr/bin/env node
/* eslint-disable */
// Targeted fix for catalog entries whose stored thumbnail (and baked stats)
// drifted from the entry's current code. For each id, re-imports the payload,
// re-runs the stored code through the real app engine, then refreshes BOTH the
// thumbnail AND the geometry-derived stat fields — preserving entry-specific
// metadata (sessionUrl / galleryUrl / sessionId) and the existing color regions.
//
// Usage: node scripts/catalog-fix-thumbnails.cjs <id,id,...> [BASE_URL]
//   (requires `npm run dev` running)

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const REPO = path.resolve(__dirname, '..');
const CATALOG = path.join(REPO, 'public', 'catalog');
const IDS = (process.argv[2] || '').split(',').map(s => s.trim()).filter(Boolean);
const BASE = process.argv[3] || 'http://localhost:5173';
if (!IDS.length) { console.error('usage: catalog-fix-thumbnails.cjs <id,id,...> [base]'); process.exit(1); }

const VIEW = { elevation: 30, azimuth: 45, ortho: false, size: 512, edges: 'none' };
// Geometry-derived fields refreshed from the fresh run. Entry-identity fields
// (sessionId/sessionUrl/galleryUrl) and authored fields (colorRegions, unit)
// are intentionally left untouched.
const STAT_FIELDS = ['status', 'vertexCount', 'triangleCount', 'boundingBox', 'centroid',
  'volume', 'surfaceArea', 'genus', 'isManifold', 'componentCount', 'crossSections', 'codeHash'];

function findChrome() {
  const root = '/opt/pw-browsers';
  if (!fs.existsSync(root)) return undefined;
  const dirs = fs.readdirSync(root).filter(d => /^chromium-\d+$/.test(d))
    .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]));
  for (const d of dirs) {
    const c = path.join(root, d, 'chrome-linux', 'chrome');
    if (fs.existsSync(c)) return c;
  }
  return undefined;
}

function fileForId(id) {
  const manifest = JSON.parse(fs.readFileSync(path.join(CATALOG, 'manifest.json'), 'utf8')).entries;
  const e = manifest.find(x => x.id === id);
  if (!e) throw new Error('no manifest entry for id ' + id);
  return e.file;
}

async function freshPage(context) {
  const page = await context.newPage();
  page.on('console', m => { if (m.type() === 'error') console.error('   [page]', m.text().slice(0, 200)); });
  await page.goto(`${BASE}/editor`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => !!(window.partwright && window.partwright.run && window.partwright.renderView && window.partwright.importSessionData),
    null, { timeout: 30000 });
  for (let i = 0; i < 60; i++) {
    const ok = await page.evaluate(async () => {
      const g = await window.partwright.run('return api.Manifold.cube([1,1,1], true);');
      return g && g.status === 'ok';
    });
    if (ok) break;
    await new Promise(r => setTimeout(r, 1000));
  }
  return page;
}

async function main() {
  const browser = await chromium.launch({
    executablePath: findChrome(),
    headless: true,
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'],
  });
  const context = await browser.newContext();

  for (const id of IDS) {
    const file = fileForId(id);
    const fp = path.join(CATALOG, file);
    const payload = JSON.parse(fs.readFileSync(fp, 'utf8'));
    process.stdout.write(`  ${id.padEnd(24)} `);
    const page = await freshPage(context);
    const res = await page.evaluate(async ({ payload, view }) => {
      const imp = await window.partwright.importSessionData(payload);
      if (imp && imp.error) return { error: 'import: ' + imp.error };
      await new Promise(r => setTimeout(r, 600)); // let color regions rehydrate
      const code = payload.versions[payload.versions.length - 1].code;
      const geo = await window.partwright.run(code);
      if (!geo || geo.status === 'error') return { error: 'run: ' + (geo && geo.error) };
      await new Promise(r => setTimeout(r, 400)); // let paint re-apply + render settle
      const fresh = window.partwright.getGeometryData();
      const thumb = window.partwright.renderView(view);
      if (!thumb) return { error: 'renderView null' };
      return { fresh, thumb };
    }, { payload, view: VIEW });
    await page.close();
    if (res.error) { console.log(`✘ ${res.error}`); process.exitCode = 1; continue; }

    const v = payload.versions[payload.versions.length - 1];
    const before = { vol: v.geometryData && v.geometryData.volume, tri: v.geometryData && v.geometryData.triangleCount };
    v.thumbnail = res.thumb;
    if (v.geometryData && res.fresh) {
      for (const k of STAT_FIELDS) {
        if (res.fresh[k] !== undefined) v.geometryData[k] = res.fresh[k];
      }
    }
    fs.writeFileSync(fp, JSON.stringify(payload, null, 2) + '\n');
    console.log(`✔ vol ${before.vol}->${res.fresh.volume}  tri ${before.tri}->${res.fresh.triangleCount}  thumb ${(res.thumb.length/1024|0)}KB`);
  }
  await browser.close();
}
main().catch(e => { console.error('FATAL', e); process.exit(1); });
