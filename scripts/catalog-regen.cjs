#!/usr/bin/env node
/* eslint-disable */
// Catalog regeneration harness. Drives a running dev server with Playwright to
// (re)render single hero-view, wireframe-free thumbnails for catalog entries,
// and to rebuild full `.partwright.json` entries from improved code + paint ops.
//
// Usage:
//   1. `npm run dev` in another terminal (http://localhost:5173)
//   2. `node scripts/catalog-regen.cjs <jobs.json> [BASE_URL]`
//
// jobs.json shape:
//   {
//     "view": { "elevation":30, "azimuth":45, "ortho":false, "size":640 },  // default hero angle
//     "thumbDir": "/tmp/thumbs_new",   // where to also drop PNGs for inspection
//     "jobs": [
//       { "id":"chess-rook", "file":"chess_rook.partwright.json", "mode":"rethumb", "view?":{...} }
//       { "id":"lighthouse", "file":"lighthouse.partwright.json", "mode":"build",
//         "name":"Lighthouse", "description":"...", "language":"manifold-js",
//         "code":"...", "paint":[ {kind,...} ], "view?":{...} }
//       // mode:"eval" == build but DOES NOT write the catalog file (PNG + stats only)
//     ]
//   }
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const REPO = path.resolve(__dirname, '..');
const CATALOG = path.join(REPO, 'public', 'catalog');
const JOBS_FILE = process.argv[2];
const BASE = process.argv[3] || 'http://localhost:5173';
if (!JOBS_FILE) { console.error('usage: catalog-regen.cjs <jobs.json> [base]'); process.exit(1); }

const spec = JSON.parse(fs.readFileSync(JOBS_FILE, 'utf8'));
const DEFAULT_VIEW = Object.assign({ elevation: 30, azimuth: 45, ortho: false, size: 640 }, spec.view || {});
const DRY_RUN = !!spec.dryRun; // when true, produce PNGs only — never write catalog files
const THUMB_DIR = spec.thumbDir || '/tmp/thumbs_new';
fs.mkdirSync(THUMB_DIR, { recursive: true });

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
  const p = path.join(THUMB_DIR, `${id}.png`);
  fs.writeFileSync(p, Buffer.from(b64, 'base64'));
  return p;
}

// In-page worker: import an existing payload and capture a hero view.
async function doRethumb(page, job) {
  const payload = JSON.parse(fs.readFileSync(path.join(CATALOG, job.file), 'utf8'));
  const view = Object.assign({}, DEFAULT_VIEW, job.view || {});
  const res = await page.evaluate(async ({ payload, view }) => {
    const imp = await window.partwright.importSessionData(payload);
    if (imp && imp.error) return { error: imp.error };
    await new Promise(r => setTimeout(r, 600)); // let color rehydrate settle
    const regions = window.partwright.listRegions ? window.partwright.listRegions() : [];
    const thumb = window.partwright.renderView({ ...view, edges: 'none' });
    if (!thumb) return { error: 'renderView returned null' };
    const geo = window.partwright.getGeometryData();
    return { thumb, regionCount: Array.isArray(regions) ? regions.length : 0, geo };
  }, { payload, view });
  if (res.error) return { error: res.error };
  // Surgical: replace ONLY the latest version's thumbnail in the existing file.
  const v = payload.versions[payload.versions.length - 1];
  v.thumbnail = res.thumb;
  if (!DRY_RUN) fs.writeFileSync(path.join(CATALOG, job.file), JSON.stringify(payload, null, 2) + '\n');
  writePng(job.id, res.thumb);
  return { ok: true, regionCount: res.regionCount, status: res.geo && res.geo.status, isManifold: res.geo && res.geo.isManifold, components: res.geo && res.geo.componentCount, tris: res.geo && res.geo.triangleCount, bytes: res.thumb.length };
}

async function doBuild(page, job, write) {
  const view = Object.assign({}, DEFAULT_VIEW, job.view || {});
  if (!job.code && job.codeFile) job = Object.assign({}, job, { code: fs.readFileSync(job.codeFile, 'utf8') });
  const res = await page.evaluate(async ({ job, view }) => {
    function num(v){ return typeof v === 'number'; }
    await window.partwright.createSession(job.name || job.id);
    const geo = await window.partwright.run(job.code);
    if (!geo || geo.status === 'error') return { error: 'run failed: ' + (geo && geo.error), geo };
    // Replay paint ops.
    const paintErrors = [];
    for (const op of (job.paint || [])) {
      let r;
      try {
        if (op.kind === 'byLabel') r = window.partwright.paintByLabel({ label: op.label, color: op.color, name: op.name, normalCone: op.normalCone, topOnly: op.topOnly });
        else if (op.kind === 'byLabels') r = window.partwright.paintByLabels(op.items);
        else if (op.kind === 'slab') r = window.partwright.paintSlab({ axis: op.axis, normal: op.normal, offset: op.offset, thickness: op.thickness, color: op.color, name: op.name, smooth: op.smooth, resolution: op.resolution ?? (op.smooth === false ? undefined : 64), maxEdge: op.maxEdge });
        else if (op.kind === 'box') r = window.partwright.paintInBox({ box: op.box, color: op.color, normalCone: op.normalCone, name: op.name });
        else if (op.kind === 'orientedBox') r = window.partwright.paintInOrientedBox({ box: op.box, color: op.color, name: op.name, smooth: op.smooth, resolution: op.resolution ?? (op.smooth === false ? undefined : 64), maxEdge: op.maxEdge });
        else if (op.kind === 'near') r = window.partwright.paintNear({ point: op.point, radius: op.radius, color: op.color, normalCone: op.normalCone, name: op.name });
        else if (op.kind === 'component') r = window.partwright.paintComponent({ index: op.index, color: op.color, name: op.name, topOnly: op.topOnly });
        else r = { error: 'unknown paint kind: ' + op.kind };
      } catch (e) { r = { error: String(e) }; }
      if (r && r.error) paintErrors.push((op.name || op.kind) + ': ' + r.error);
    }
    // Persist a single version carrying the color regions.
    await window.partwright.saveVersion('v1');
    const hero = window.partwright.renderView({ ...view, edges: 'none' });
    const exported = await window.partwright.exportSession(undefined, { includeThumbnails: true, includeColorRegions: true });
    const finalGeo = window.partwright.getGeometryData();
    return { hero, exported, paintErrors, geo: finalGeo };
  }, { job, view });

  if (res.error) return { error: res.error };
  writePng(job.id, res.hero);

  // Assemble a clean single-version payload from the export, swapping in the hero thumbnail.
  const exp = res.exported;
  const versions = exp.versions || [];
  const last = versions[versions.length - 1];
  last.index = 1;
  last.label = 'v1';
  last.thumbnail = res.hero;
  const out = {
    partwright: exp.partwright || '1.7',
    session: { name: job.name || exp.session.name, created: exp.session.created, updated: exp.session.updated, images: null },
    parts: exp.parts && exp.parts.length ? [{ name: exp.parts[0].name || 'Part 1', order: 0 }] : [{ name: 'Part 1', order: 0 }],
    versions: [last],
  };
  // strip part pointers on the version (single default part)
  delete last.part;

  if (write && !DRY_RUN) {
    fs.writeFileSync(path.join(CATALOG, job.file), JSON.stringify(out, null, 2) + '\n');
  }
  return {
    ok: true, wrote: !!write, paintErrors: res.paintErrors,
    status: res.geo && res.geo.status, isManifold: res.geo && res.geo.isManifold,
    components: res.geo && res.geo.componentCount, tris: res.geo && res.geo.triangleCount,
    regionCount: (last.colorRegions || []).length, bytes: res.hero.length,
  };
}

async function freshPage(context) {
  const page = await context.newPage();
  page.on('console', m => { if (m.type() === 'error') console.error('   [page]', m.text().slice(0, 240)); });
  await page.goto(`${BASE}/editor`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!(window.partwright && window.partwright.runAndSave && window.partwright.renderView && window.partwright.importSessionData), null, { timeout: 30000 });
  // warm the engine
  for (let i = 0; i < 60; i++) {
    const ok = await page.evaluate(async () => { const g = await window.partwright.run('return api.Manifold.cube([1,1,1], true);'); return g && g.status === 'ok'; });
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

  for (const job of spec.jobs) {
    process.stdout.write(`  ${(job.id || job.file).padEnd(22)} [${job.mode}] `);
    let out;
    try {
      const page = await freshPage(context);
      if (job.mode === 'rethumb') out = await doRethumb(page, job);
      else if (job.mode === 'build') out = await doBuild(page, job, true);
      else if (job.mode === 'eval') out = await doBuild(page, job, false);
      else out = { error: 'unknown mode ' + job.mode };
      await page.close();
    } catch (e) {
      out = { error: String(e && e.message || e) };
    }
    if (out.error) { console.log(`✘ ${out.error}`); continue; }
    const flags = [];
    if (out.status && out.status !== 'ok') flags.push(`status=${out.status}`);
    if (out.isManifold === false) flags.push('NOT-MANIFOLD');
    if (out.components > 1) flags.push(`components=${out.components}`);
    if (out.paintErrors && out.paintErrors.length) flags.push(`paintErr=${out.paintErrors.length}`);
    console.log(`✔ ${out.wrote === false ? '(eval) ' : ''}tris=${out.tris} regions=${out.regionCount} ${(out.bytes/1024|0)}KB ${flags.join(' ') || ''}`);
    if (out.paintErrors && out.paintErrors.length) out.paintErrors.forEach(e => console.log(`       paint: ${e}`));
  }
  await browser.close();
}
main().catch(e => { console.error('FATAL', e); process.exit(1); });
