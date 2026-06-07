#!/usr/bin/env node
/* eslint-disable */
// Catalog thumbnail staleness audit. Drives a running dev server with Playwright,
// re-runs every catalog entry's stored code through the REAL app engine
// (manifold-js / scad / replicad / voxel), and compares the freshly-computed
// geometry against the stats that were baked alongside the stored thumbnail.
//
// Rationale: each stored thumbnail was rendered in the SAME pass that produced
// the stored geometryData. So if a fresh run of the stored code yields different
// stats, the code drifted after the thumbnail was baked => the thumbnail is stale.
// This is angle-independent (no need to know the stored hero camera angle) and
// works uniformly across all four engines, unlike the manifold-js-only
// `model:preview` headless path.
//
// Usage:
//   1. `npm run dev` (http://localhost:5173)
//   2. `node scripts/catalog-audit.cjs [BASE_URL]`
// Writes /tmp/catalog-audit/<id>.fresh.png for every flagged entry + a report.

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const REPO = path.resolve(__dirname, '..');
const CATALOG = path.join(REPO, 'public', 'catalog');
const BASE = process.argv[2] || 'http://localhost:5173';
const OUT = '/tmp/catalog-audit';
fs.mkdirSync(OUT, { recursive: true });

const VIEW = { elevation: 30, azimuth: 45, ortho: false, size: 512 };
// Relative deltas above which we treat geometry as materially changed.
const VOL_TOL = 0.02;   // 2%
const TRI_TOL = 0.05;   // 5% (tessellation can wobble a little)

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

function writePng(id, dataUrl) {
  const b64 = dataUrl.replace(/^data:image\/png;base64,/, '');
  const p = path.join(OUT, `${id}.fresh.png`);
  fs.writeFileSync(p, Buffer.from(b64, 'base64'));
  return p;
}

function rel(fresh, baked) {
  if (typeof fresh !== 'number' || typeof baked !== 'number' || baked === 0) return null;
  return Math.abs(fresh - baked) / Math.abs(baked);
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

async function auditOne(page, entry) {
  const payload = JSON.parse(fs.readFileSync(path.join(CATALOG, entry.file), 'utf8'));
  const v = payload.versions[payload.versions.length - 1];
  const baked = v.geometryData || {};
  const view = VIEW;
  const res = await page.evaluate(async ({ payload, view }) => {
    // Import to restore session state (language, params, color regions), then
    // re-run the entry's own stored code so the geometry reflects the code as-is.
    const imp = await window.partwright.importSessionData(payload);
    if (imp && imp.error) return { error: 'import: ' + imp.error };
    await new Promise(r => setTimeout(r, 500));
    const code = payload.versions[payload.versions.length - 1].code;
    const geo = await window.partwright.run(code);
    if (!geo || geo.status === 'error') return { error: 'run: ' + (geo && geo.error) };
    await new Promise(r => setTimeout(r, 200));
    const fresh = window.partwright.getGeometryData();
    const regions = window.partwright.listRegions ? window.partwright.listRegions() : [];
    const thumb = window.partwright.renderView({ ...view, edges: 'none' });
    return { fresh, regionCount: Array.isArray(regions) ? regions.length : 0, thumb };
  }, { payload, view });

  if (res.error) return { id: entry.id, lang: entry.language, error: res.error };

  const f = res.fresh || {};
  const volDelta = rel(f.volume, baked.volume);
  const triDelta = rel(f.triangleCount, baked.triangleCount);
  const compChanged = typeof f.componentCount === 'number'
    && typeof baked.componentCount === 'number'
    && f.componentCount !== baked.componentCount;
  const bakedRegions = (v.colorRegions || []).length;
  const regionChanged = res.regionCount !== bakedRegions;

  const stale = (volDelta !== null && volDelta > VOL_TOL)
    || (triDelta !== null && triDelta > TRI_TOL)
    || compChanged;

  const rec = {
    id: entry.id, lang: entry.language,
    bakedVol: baked.volume, freshVol: f.volume, volDelta,
    bakedTri: baked.triangleCount, freshTri: f.triangleCount, triDelta,
    bakedComp: baked.componentCount, freshComp: f.componentCount, compChanged,
    bakedRegions, freshRegions: res.regionCount, regionChanged,
    stale,
  };
  if (stale && res.thumb) rec.png = writePng(entry.id, res.thumb);
  return rec;
}

async function main() {
  let manifest = JSON.parse(fs.readFileSync(path.join(CATALOG, 'manifest.json'), 'utf8')).entries;
  const only = (process.env.ONLY || '').split(',').map(s => s.trim()).filter(Boolean);
  if (only.length) manifest = manifest.filter(e => only.includes(e.id));
  const browser = await chromium.launch({
    executablePath: findChrome(),
    headless: true,
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'],
  });
  const context = await browser.newContext();
  const out = [];
  for (const entry of manifest) {
    process.stdout.write(`  ${(entry.id || entry.file).padEnd(30)} [${entry.language.padEnd(11)}] `);
    let rec;
    try {
      const page = await freshPage(context);
      rec = await auditOne(page, entry);
      await page.close();
    } catch (e) {
      rec = { id: entry.id, lang: entry.language, error: String(e && e.message || e) };
    }
    out.push(rec);
    if (rec.error) { console.log(`✘ ${rec.error.slice(0, 120)}`); continue; }
    const pct = x => x === null || x === undefined ? '—' : (x * 100).toFixed(1) + '%';
    const flags = [];
    if (rec.compChanged) flags.push(`comp ${rec.bakedComp}->${rec.freshComp}`);
    if (rec.regionChanged) flags.push(`regions ${rec.bakedRegions}->${rec.freshRegions}`);
    console.log(`${rec.stale ? 'STALE' : 'ok   '} volΔ=${pct(rec.volDelta)} triΔ=${pct(rec.triDelta)} ${flags.join(' ')}`);
  }
  await browser.close();

  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(out, null, 2));
  const stale = out.filter(r => r.stale);
  const errs = out.filter(r => r.error);
  console.log(`\n=== AUDIT SUMMARY ===`);
  console.log(`total=${out.length} stale=${stale.length} errored=${errs.length}`);
  if (stale.length) {
    console.log(`\nSTALE thumbnails:`);
    for (const r of stale) console.log(`  ${r.id} (${r.lang}): vol ${r.bakedVol}->${r.freshVol}, comp ${r.bakedComp}->${r.freshComp}, png ${r.png || '-'}`);
  }
  if (errs.length) {
    console.log(`\nERRORED (could not verify):`);
    for (const r of errs) console.log(`  ${r.id} (${r.lang}): ${r.error.slice(0, 140)}`);
  }
}
main().catch(e => { console.error('FATAL', e); process.exit(1); });
