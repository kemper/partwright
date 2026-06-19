#!/usr/bin/env node
/* eslint-disable */
// Re-bake ALL figure-builder catalog entries against the CURRENT engine, so a
// shared `src/geometry/sdfFigure.ts` fix (e.g. the nose-tear / default-lips fix
// in #770) lands in every figure's baked geometry + thumbnail. Edits each
// .partwright.json IN PLACE: re-runs the version's own stored `code` (which
// dispatches into the live sdfFigure builder via `api.sdf.figure`), replays its
// byLabel paint regions, then splices ONLY the geometry-derived fields
// (geometryData, colorRegions, thumbnail) back into the existing payload.
// Everything else (notes, appVersion, session, parts, code) is preserved
// byte-for-byte, so the diff is just the re-baked geometry + canonical thumbnail.
//
// Targets are discovered automatically: any catalog entry whose latest stored
// code uses the figure builder (`sdf.figure` / `F.rig`). Thumbnails come from
// the app's own `exportSession({includeThumbnails:true})` pipeline — the same
// canonical 500x500 hero tile build-catalog-entry.cjs produces — so this also
// de-outliers the handful of 640x640 thumbs left by rebake-shod-figures.cjs.
//
//   npm run dev   # in another terminal (http://localhost:5173)
//   node scripts/rebake-figure-catalog.cjs
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const REPO = path.resolve(__dirname, '..');
const CATALOG = path.join(REPO, 'public', 'catalog');
const BASE = process.argv[2] || 'http://localhost:5173';
const ONLY = process.argv.slice(3); // optional explicit file list (basenames)

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

// Discover figure-builder entries: latest stored code dispatches into sdfFigure.
function discoverFigureFiles() {
  const out = [];
  for (const f of fs.readdirSync(CATALOG).filter((f) => f.endsWith('.partwright.json'))) {
    let p;
    try { p = JSON.parse(fs.readFileSync(path.join(CATALOG, f), 'utf8')); } catch { continue; }
    const vs = p.versions || [];
    if (!vs.length) continue;
    const code = vs[vs.length - 1].code || '';
    if (code.includes('sdf.figure') || /\bF\.rig\b/.test(code)) out.push(f);
  }
  return out.sort();
}

function paintFromPayload(v) {
  const prevRegions = (v.geometryData && v.geometryData.colorRegions) || v.colorRegions || [];
  return prevRegions
    .slice()
    .filter((r) => r.descriptor && r.descriptor.kind === 'byLabel')
    .sort((a, b) => (a.order || 0) - (b.order || 0))
    .map((r) => ({ label: r.descriptor.label, color: r.color, name: r.name }));
}

// Fresh page per entry — reusing one page across createSession calls tears down
// window.partwright after the first bake. Booting WASM per page is the proven,
// contention-free pattern (mirrors rebake-shod-figures.cjs).
async function freshPage(context) {
  const page = await context.newPage();
  page.on('console', (m) => { if (m.type() === 'error') console.error('   [page]', m.text().slice(0, 160)); });
  await page.goto(`${BASE}/editor`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => !!(window.partwright && window.partwright.runAndSave && window.partwright.paintByLabels && window.partwright.exportSession && window.partwright.commitWithColors),
    null, { timeout: 30000 });
  for (let i = 0; i < 90; i++) {
    const ok = await page.evaluate(async () => {
      const p = await window.partwright.runAndSave('return api.Manifold.cube([1,1,1], true);', 'probe', {});
      return !!(p && !p.error && p.version);
    });
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
  const paint = paintFromPayload(v);

  const res = await page.evaluate(async ({ code, paint, name }) => {
    await window.partwright.createSession(name || 'rebake');
    const r = await window.partwright.runAndSave(code, 'v0', {});
    if (!r || r.error) return { error: 'run failed: ' + (r && r.error) };
    if (!r.version) return { error: 'no version saved' };
    let paintErrors = [];
    if (paint && paint.length) {
      const pr = window.partwright.paintByLabels(paint);
      if (pr && pr.error) paintErrors = [pr.error];
      else if (pr && pr.failed && pr.failed.length) paintErrors = pr.failed;
      await window.partwright.commitWithColors({ label: 'painted' });
    }
    const data = await window.partwright.exportSession(undefined, { includeThumbnails: true });
    if (data && data.error) return { error: 'export failed: ' + data.error };
    return { data, geo: r.geometry || window.partwright.getGeometryData(), paintErrors };
  }, { code, paint, name: (payload.session && payload.session.name) || 'rebake' });

  if (res.error) return { error: res.error };
  const ev = res.data.versions[res.data.versions.length - 1];

  // Splice ONLY the geometry-derived fields into the preserved payload.
  v.geometryData = ev.geometryData;
  v.colorRegions = ev.colorRegions || (ev.geometryData && ev.geometryData.colorRegions) || [];
  v.thumbnail = ev.thumbnail;

  fs.writeFileSync(full, JSON.stringify(payload, null, 2) + '\n');
  const g = res.geo || {};
  return {
    ok: true, tris: g.triangleCount, components: g.componentCount, isManifold: g.isManifold,
    status: g.status, genus: g.genus, regions: v.colorRegions.length, paintErrors: res.paintErrors,
  };
}

async function main() {
  const files = ONLY.length ? ONLY : discoverFigureFiles();
  console.log(`Re-baking ${files.length} figure entries against ${BASE}\n`);
  const browser = await chromium.launch({
    executablePath: findChrome(), headless: true,
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'],
  });
  const context = await browser.newContext();

  let failures = 0;
  for (const file of files) {
    process.stdout.write(`  ${file.padEnd(34)} `);
    let out;
    try {
      const page = await freshPage(context);
      out = await rebakeOne(page, file);
      await page.close();
    }
    catch (e) { out = { error: String((e && e.message) || e) }; }
    if (out.error) { console.log(`✘ ${out.error}`); failures++; continue; }
    const flags = [];
    if (out.status && out.status !== 'ok') flags.push(`status=${out.status}`);
    if (out.isManifold === false) flags.push('NOT-MANIFOLD');
    if (out.components > 1) flags.push(`components=${out.components}`);
    if (out.paintErrors && out.paintErrors.length) flags.push(`paintErr=${out.paintErrors.length}`);
    console.log(`✔ tris=${out.tris} genus=${out.genus} regions=${out.regions} ${flags.join(' ')}`);
  }
  await browser.close();
  if (failures) { console.error(`\n${failures} FAILED`); process.exit(1); }
  console.log(`\nDone — ${files.length} entries re-baked.`);
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
