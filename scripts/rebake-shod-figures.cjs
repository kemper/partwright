#!/usr/bin/env node
/* eslint-disable */
// One-off: re-bake the shod figure catalog entries against the CURRENT engine
// (so the resized-footwear fix lands in their baked geometry + thumbnails),
// editing each .partwright.json IN PLACE — re-runs the version's own stored
// `code`, replays its byLabel paint regions, then splices ONLY the
// geometry-derived fields (geometryData, colorRegions, thumbnail) back into the
// existing payload. Everything else (notes, appVersion, session, parts, code)
// is preserved byte-for-byte, so the diff is just the re-baked geometry.
//
//   npm run dev   # in another terminal (http://localhost:5173)
//   node scripts/rebake-shod-figures.cjs
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const REPO = path.resolve(__dirname, '..');
const CATALOG = path.join(REPO, 'public', 'catalog');
const BASE = process.argv[2] || 'http://localhost:5173';
const VIEW = { elevation: 30, azimuth: 45, ortho: false, size: 640 }; // standard hero camera

const FILES = [
  'sprinter_start', 'athlete', 'superhero', 'basketball_dunk',
  'danseur', 'cheerleader', 'pixie_skater',
  'rock_climber', 'runway_model',
].map((s) => `${s}.partwright.json`);

function findChrome() {
  const root = '/opt/pw-browsers';
  if (!fs.existsSync(root)) return undefined;
  const dirs = fs.readdirSync(root).filter((d) => /^chromium-\d+$/.test(d))
    .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]));
  for (const d of dirs) {
    const c = path.join(root, d, 'chrome-linux', 'chrome');
    if (fs.existsSync(c)) return c;
  }
  return undefined;
}

async function freshPage(context) {
  const page = await context.newPage();
  page.on('console', (m) => { if (m.type() === 'error') console.error('   [page]', m.text().slice(0, 200)); });
  await page.goto(`${BASE}/editor`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!(window.partwright && window.partwright.run && window.partwright.renderView && window.partwright.paintByLabel && window.partwright.exportSession), null, { timeout: 30000 });
  for (let i = 0; i < 60; i++) {
    const ok = await page.evaluate(async () => { const g = await window.partwright.run('return api.Manifold.cube([1,1,1], true);'); return g && g.status === 'ok'; });
    if (ok) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return page;
}

async function rebakeOne(page, file) {
  const full = path.join(CATALOG, file);
  const payload = JSON.parse(fs.readFileSync(full, 'utf8'));
  const v = payload.versions[payload.versions.length - 1];
  const code = v.code;
  const prevRegions = (v.geometryData && v.geometryData.colorRegions) || v.colorRegions || [];
  const paint = prevRegions
    .slice()
    .sort((a, b) => (a.order || 0) - (b.order || 0))
    .map((r) => ({ label: r.descriptor.label, color: r.color, name: r.name }));

  const res = await page.evaluate(async ({ code, paint, view }) => {
    await window.partwright.createSession('rebake');
    const geo = await window.partwright.run(code);
    if (!geo || geo.status === 'error') return { error: 'run failed: ' + (geo && geo.error) };
    const paintErrors = [];
    for (const op of paint) {
      let r;
      try { r = window.partwright.paintByLabel({ label: op.label, color: op.color, name: op.name }); }
      catch (e) { r = { error: String(e) }; }
      if (r && r.error) paintErrors.push(op.label + ': ' + r.error);
    }
    await window.partwright.saveVersion('v1');
    const thumb = window.partwright.renderView({ ...view, edges: 'none' });
    const exported = await window.partwright.exportSession(undefined, { includeThumbnails: true, includeColorRegions: true });
    return { thumb, exported, paintErrors, geo: window.partwright.getGeometryData() };
  }, { code, paint, view: VIEW });

  if (res.error) return { error: res.error };
  const exp = res.exported;
  const ev = exp.versions[exp.versions.length - 1];

  // Splice ONLY the geometry-derived fields into the preserved payload.
  v.geometryData = ev.geometryData;
  v.colorRegions = ev.colorRegions || ev.geometryData?.colorRegions || [];
  v.thumbnail = res.thumb;

  fs.writeFileSync(full, JSON.stringify(payload, null, 2) + '\n');
  const g = res.geo || {};
  return {
    ok: true, tris: g.triangleCount, components: g.componentCount, isManifold: g.isManifold,
    status: g.status, regions: v.colorRegions.length, paintErrors: res.paintErrors,
  };
}

async function main() {
  const browser = await chromium.launch({
    executablePath: findChrome(), headless: true,
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'],
  });
  const context = await browser.newContext();
  let failures = 0;
  for (const file of FILES) {
    process.stdout.write(`  ${file.padEnd(30)} `);
    let out;
    try {
      const page = await freshPage(context);
      out = await rebakeOne(page, file);
      await page.close();
    } catch (e) { out = { error: String((e && e.message) || e) }; }
    if (out.error) { console.log(`✘ ${out.error}`); failures++; continue; }
    const flags = [];
    if (out.status && out.status !== 'ok') flags.push(`status=${out.status}`);
    if (out.isManifold === false) flags.push('NOT-MANIFOLD');
    if (out.components > 1) flags.push(`components=${out.components}`);
    if (out.paintErrors && out.paintErrors.length) flags.push(`paintErr=${out.paintErrors.join('|')}`);
    console.log(`✔ tris=${out.tris} regions=${out.regions} ${flags.join(' ')}`);
  }
  await browser.close();
  if (failures) { console.error(`\n${failures} FAILED`); process.exit(1); }
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
