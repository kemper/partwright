// partwright CLI dispatch. Phase 1 (preview/run) is stateless Vite SSR; Phase 2
// (call/render/bake) drives a long-lived headless-browser daemon. See
// docs/headless-cli.md.
import { resolve, dirname, basename, join } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
import { runPreview, composePng, composeContactSheet, explainComponents, checkExpectComponents, resolveViews, defaultPreviewPng } from './preview.mjs';
import { runPhoto, meshToPng, loadPalette } from './photo.mjs';
import { runDaemon } from './daemon.mjs';
import { startDaemon, stopDaemon, statusDaemon, rpc, evalInPage, resetPage } from './client.mjs';

const coerce = (s) => { if (s === 'true') return true; if (s === 'false') return false; const n = Number(s); return Number.isNaN(n) ? s : n; };

// Minimal flag parser: collects --flags (with values), -p k=v params, and
// positionals. Boolean flags (in `bools`) consume no value.
function parse(argv, bools = []) {
  const o = { _: [], params: {} };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === '-p' || t === '--param') { const [k, ...v] = argv[++i].split('='); o.params[k] = coerce(v.join('=')); }
    else if (t.startsWith('--')) { const k = t.slice(2); if (bools.includes(k)) o[k] = true; else o[k] = argv[++i]; }
    else o._.push(t);
  }
  return o;
}

function writeDataUrl(dataUrl, outPath) {
  const m = /^data:image\/\w+;base64,(.*)$/s.exec(dataUrl);
  if (!m) throw new Error('result is not a base64 image data URL');
  writeFileSync(outPath, Buffer.from(m[1], 'base64'));
}

const json = (v) => JSON.stringify(v, (_k, val) => (ArrayBuffer.isView(val) ? undefined : val), 2);

async function cmdPreview(argv, { pngDefault }) {
  const a = parse(argv, ['json', 'explain-components']);
  const file = a._[0];
  if (!file) { console.error('usage: partwright preview <file.js> [--lang manifold-js|voxel] [--png out] [--json] [--size N] [--view az,el] [--views front,iso,…] [--explain-components] [--expect-components N] [-p k=v]'); process.exit(2); }
  const abs = resolve(file);
  const { views, error: viewErr } = resolveViews(a.view, a.views);
  if (viewErr) { console.error(viewErr); process.exit(2); }
  const result = await runPreview(abs, { params: a.params, lang: a.lang || 'manifold-js' });
  if (!result.ok) { console.log(json({ ok: false, error: result.error, diagnostics: result.diagnostics })); process.exit(1); }

  let pngPath = null;
  if (pngDefault && !a.json && result.render) {
    pngPath = a.png ? resolve(a.png) : defaultPreviewPng(abs);
    const img = composePng(result.render.positions, result.render.triVerts, result.render.triColors, result.render.bbox, Number(a.size) || 480, views || undefined);
    await img.toFile(pngPath);
  }
  console.log(json({ ok: true, png: pngPath, stats: result.stats }));

  if (a['explain-components']) console.error(explainComponents(result.stats));
  const expectErr = checkExpectComponents(result.stats, a['expect-components']);
  if (expectErr) { console.error(expectErr); process.exit(1); }
}

// Contact sheet — run N model files and tile one iso view of each into a single
// PNG for side-by-side comparison (variant sweeps, before/after, A/B params).
async function cmdCompare(argv) {
  const a = parse(argv, ['json']);
  const files = a._;
  if (files.length < 2) { console.error('usage: partwright compare <a.js> <b.js> [more.js …] [--lang manifold-js|voxel|scad] [--png out] [--size N] [--view az,el] [--json] [-p k=v]'); process.exit(2); }
  if (a.views !== undefined) { console.error('compare renders one view per model — use --view az,el (not --views).'); process.exit(2); }
  const { views, error: viewErr } = resolveViews(a.view, undefined);
  if (viewErr) { console.error(viewErr); process.exit(2); }
  const results = [];
  for (const f of files) {
    const r = await runPreview(resolve(f), { params: a.params, lang: a.lang || 'manifold-js' });
    results.push({ file: f, ok: r.ok, error: r.error, stats: r.stats, render: r.render });
  }
  let pngPath = null;
  if (!a.json) {
    pngPath = a.png ? resolve(a.png) : resolve('compare.png');
    await composeContactSheet(results, Number(a.size) || 360, views ? views[0] : undefined).toFile(pngPath);
  }
  // Drop the heavy render buffers from the JSON; the PNG carries the pixels.
  const models = results.map((r, i) => ({ cell: i, file: r.file, ok: r.ok, error: r.error, stats: r.stats }));
  console.log(json({ ok: true, png: pngPath, models }));
}

// Photo → palette-constrained voxel model. Stateless (no daemon): decode +
// snap + emit `voxels.decode(…)` code, write a 4-view preview PNG, print stats.
async function cmdPhoto(argv) {
  const a = parse(argv, ['bg', 'invert', 'json', 'calls']);
  const file = a._[0];
  if (!file) { console.error('usage: partwright photo <image> [--out model.js] [--png out.png] [--palette p.json] [--max N] [--mode billboard|heightmap] [--depth N] [--bg] [--crop x,y,w,h] [--brightness n] [--contrast n] [--saturation n] [--size N] [--calls] [--json]'); process.exit(2); }
  const abs = resolve(file);
  const stem = basename(abs).replace(/\.[^.]+$/, '');
  const crop = a.crop ? a.crop.split(',').map((n) => parseInt(n, 10)) : null;
  const palette = a.palette ? loadPalette(resolve(a.palette)) : undefined;
  const num = (v, d) => (v === undefined ? d : Number(v));

  const r = await runPhoto(abs, {
    palette,
    max: num(a.max, 64),
    mode: a.mode || 'billboard',
    depth: num(a.depth, 1),
    maxHeight: num(a['max-height'], 16),
    baseThickness: num(a['base'], 1),
    invert: !!a.invert,
    removeBackground: !!a.bg,
    brightness: num(a.brightness, 0),
    contrast: num(a.contrast, 0),
    saturation: num(a.saturation, 0),
    crop,
    codeStyle: a.calls ? 'calls' : 'decode',
  });

  const outJs = resolve(a.out || stem + '.voxel.js');
  writeFileSync(outJs, r.code);
  let png = null;
  if (!a.json) {
    png = resolve(a.png || stem + '.voxel.png');
    await meshToPng(r.mesh, Number(a.size) || 480).toFile(png);
  }
  console.log(json({ ok: true, model: outJs, png, stats: r.stats }));
}

async function cmdDaemon(argv) {
  const sub = argv[0];
  const a = parse(argv.slice(1));
  if (sub === 'start') { const s = await startDaemon({ appPort: a['app-port'] && Number(a['app-port']), controlPort: a['control-port'] && Number(a['control-port']) }); console.log(json({ started: true, ...s })); return; }
  if (sub === 'stop') { console.log(json(await stopDaemon())); return; }
  if (sub === 'status') { console.log(json(await statusDaemon())); return; }
  console.error('usage: partwright daemon <start|stop|status>'); process.exit(2);
}

async function cmdCall(argv) {
  const a = parse(argv);
  const method = a._[0];
  if (!method) { console.error('usage: partwright call <method> [argsJSON] [--out file]'); process.exit(2); }
  const args = a._[1] ? JSON.parse(a._[1]) : [];
  const r = await rpc(method, args);
  if (!r.ok) { console.log(json(r)); process.exit(1); }
  if (a.out && typeof r.result === 'string' && r.result.startsWith('data:image')) {
    writeDataUrl(r.result, resolve(a.out));
    console.log(json({ ok: true, out: resolve(a.out) }));
  } else {
    console.log(json(r));
  }
}

async function cmdRender(argv) {
  const a = parse(argv);
  const out = resolve(a.out || 'partwright-render.png');
  if (a.code) {
    const code = readFileSync(resolve(a.code), 'utf8');
    await rpc('setActiveLanguage', ['manifold-js']);
    const run = await rpc('runAndSave', [code, 'render']);
    if (!run.ok || run.result?.geometry?.status === 'error') { console.log(json({ ok: false, error: run.result?.geometry?.error || run.error })); process.exit(1); }
  }
  const opts = { views: a.views || 'all', size: Number(a.size) || 420 };
  const r = await rpc('renderViews', [opts]);
  if (!r.ok || typeof r.result !== 'string') { console.log(json({ ok: false, error: r.error || 'no image (is a model loaded?)' })); process.exit(1); }
  writeDataUrl(r.result, out);
  console.log(json({ ok: true, out }));
}

// Catalog baker — mirrors tests/_catalogBake.spec.ts but driven through the
// daemon instead of a Playwright spec. Reads <id>.js + <id>.meta.json pairs.
async function cmdBake(argv) {
  const a = parse(argv);
  const dir = resolve(a._[0] || '.');
  const catalog = resolve(a.catalog || 'public/catalog');
  const { readdirSync } = await import('node:fs');
  const hexToRgb01 = (hex) => { const s = hex.replace('#', ''); const f = s.length === 3 ? s.split('').map((c) => c + c).join('') : s; return [parseInt(f.slice(0, 2), 16) / 255, parseInt(f.slice(2, 4), 16) / 255, parseInt(f.slice(4, 6), 16) / 255]; };

  const metas = readdirSync(dir).filter((f) => f.endsWith('.meta.json'));
  if (!metas.length) { console.error(`no *.meta.json fixtures in ${dir}`); process.exit(2); }

  const body = `
    const { model, name, paints, thumbCamera } = arg;
    await pw.createSession(name);
    if (thumbCamera && pw.setThumbnailCamera) await pw.setThumbnailCamera(thumbCamera);
    const run = await pw.runAndSave(model, 'shape');
    if (run && run.geometry && run.geometry.status === 'error') return { error: 'model error: ' + run.geometry.error };
    const paintResults = [];
    for (const p of paints) paintResults.push(await pw.paintByLabel(p));
    await pw.saveVersion('final');
    const ex = await pw.exportSessionData(undefined, { includeThumbnails: true });
    const last = ex && ex.data && ex.data.versions && ex.data.versions[ex.data.versions.length - 1];
    return {
      geometry: run && run.geometry,
      paints: paintResults.map((r) => (r && r.error) ? ('ERR:' + r.error) : ('ok:' + (r && r.name))),
      regionCount: (last && last.colorRegions ? last.colorRegions.length : 0),
      hasThumb: !!(last && last.thumbnail),
      data: ex && ex.data,
    };
  `;

  const baked = [];
  for (const mf of metas) {
    const meta = JSON.parse(readFileSync(join(dir, mf), 'utf8'));
    const model = readFileSync(join(dir, mf.replace('.meta.json', '.js')), 'utf8');
    const paints = (meta.paints || []).map((p) => ({ label: p.label, color: hexToRgb01(p.color), name: p.name ?? p.label }));

    await resetPage(); // fresh page per entry, mirroring tests/_catalogBake.spec.ts
    // Optional per-entry tile-camera pin: `"thumbCamera": {"azimuth":225,"elevation":30}`
    // in the .meta.json (degrees; default iso az 45 / el 35).
    const r = await evalInPage(body, { model, name: meta.name, paints, thumbCamera: meta.thumbCamera ?? null });
    const out = r.result;
    if (!r.ok || out?.error || !out?.data) { console.log(`BAKE_FAIL ${meta.id}: ${r.error || out?.error || 'no data'}`); continue; }

    const file = `${meta.id.replace(/-/g, '_')}.partwright.json`;
    writeFileSync(join(catalog, file), JSON.stringify(out.data, null, 2) + '\n');
    const manifestPath = join(catalog, 'manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const row = { id: meta.id, name: meta.name, file, language: meta.language || 'manifold-js', description: meta.description };
    if (meta.group) row.group = meta.group;
    const idx = manifest.entries.findIndex((e) => e.id === meta.id);
    if (idx >= 0) manifest.entries[idx] = row; else manifest.entries.push(row);
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

    console.log(`BAKE_OK ${meta.id}: regions=${out.regionCount} thumb=${out.hasThumb} paints=[${out.paints.join(', ')}] verts=${out.geometry?.vertexCount ?? '?'}`);
    baked.push(meta.id);
  }
  console.log(`BAKED ${baked.length}/${metas.length}`);
}

// High-level one-shot agent feedback: run a model in the daemon and return the
// stat block (with warnings + printability) AND a real WebGL render in a single
// call — the inner loop for "I wrote this, is it good? show me." Use `preview`
// for the faster stateless/software-rendered variant.
async function cmdIterate(argv) {
  const a = parse(argv);
  const file = a._[0];
  if (!file) { console.error('usage: partwright iterate <file.js> [--out png] [--views all] [--lang manifold-js] [-p k=v]'); process.exit(2); }
  const code = readFileSync(resolve(file), 'utf8');
  await rpc('setActiveLanguage', [a.lang || 'manifold-js']);
  const runRes = await rpc('run', [code]);
  if (!runRes.ok) { console.log(json(runRes)); process.exit(1); }
  if (runRes.result?.status === 'error') { console.log(json({ ok: false, error: runRes.result.error, stats: runRes.result })); process.exit(1); }
  if (Object.keys(a.params).length) await rpc('setParams', [a.params]); // re-runs with overrides
  const stats = (await rpc('getGeometryData', [])).result;
  const img = await rpc('renderViews', [{ views: a.views || 'all', size: Number(a.size) || 420 }]);
  let png = null;
  if (img.ok && typeof img.result === 'string') { png = resolve(a.out || basename(file).replace(/\.[^.]+$/, '') + '.iterate.png'); writeDataUrl(img.result, png); }
  console.log(json({ ok: true, png, stats }));
}

// Fetch a remote image (or any file) to disk so the stateless `photo` flow can
// consume it — agents often have an image URL but `photo` needs a local path.
// (The original "chat-attached image" ask isn't reachable from a Node CLI; a URL
// download is the implementable equivalent. Honors the env's network policy.)
async function cmdFetch(argv) {
  const a = parse(argv);
  const url = a._[0];
  if (!url) { console.error('usage: partwright fetch <url> [--out file]'); process.exit(2); }
  if (!/^https?:\/\//i.test(url)) { console.log(json({ ok: false, error: 'fetch needs an http(s) URL' })); process.exit(1); }
  let out = a.out;
  if (!out) { try { out = basename(new URL(url).pathname) || 'download'; } catch { out = 'download'; } }
  out = resolve(out);
  let res;
  try { res = await fetch(url); } catch (e) { console.log(json({ ok: false, error: `fetch failed: ${e?.message || e}` })); process.exit(1); }
  if (!res.ok) { console.log(json({ ok: false, error: `HTTP ${res.status} ${res.statusText}` })); process.exit(1); }
  // Guard against an oversized/hostile response OOMing the process. 50 MB is far
  // larger than any reference image; reject up front on the advertised length.
  const MAX_FETCH_BYTES = 50 * 1024 * 1024;
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_FETCH_BYTES) {
    console.log(json({ ok: false, error: `response is ${declared} bytes, over the ${MAX_FETCH_BYTES}-byte fetch cap` })); process.exit(1);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_FETCH_BYTES) { console.log(json({ ok: false, error: `downloaded ${buf.length} bytes, over the ${MAX_FETCH_BYTES}-byte fetch cap` })); process.exit(1); }
  writeFileSync(out, buf);
  console.log(json({ ok: true, out, bytes: buf.length, contentType: res.headers.get('content-type') || 'unknown' }));
}

// Discovery — list the window.partwright methods reachable via `call`.
async function cmdMethods(argv) {
  const a = parse(argv);
  const filter = (a._[0] || '').toLowerCase();
  const r = await evalInPage('const pw = window.partwright; return Object.keys(pw).filter((k) => typeof pw[k] === "function").sort();', {});
  if (!r.ok) { console.log(json(r)); process.exit(1); }
  const names = (r.result || []).filter((n) => !filter || n.toLowerCase().includes(filter));
  console.log(json({ ok: true, count: names.length, methods: names }));
}

const USAGE = `partwright — headless Partwright CLI for driving model creation + feedback

Phase 1 (stateless, no browser — fast inner loop):
  partwright preview <file.js> [--lang manifold-js|voxel] [--png out] [--json] [--size N]
                               [--view az,el] [--views front,right,top,bottom,left,back,iso]
                               [--explain-components] [--expect-components N] [-p k=v]
  partwright run     <file.js> [--lang …] [-p k=v]       stats JSON only
  partwright compare <a.js> <b.js> [more.js …] [--png out] [--size N] [--view az,el] [-p k=v]
                                                         tile each model's view into one contact-sheet PNG
  partwright photo   <image>   [--palette p.json] [--max N] [--mode billboard|heightmap]
                               [--depth N] [--bg] [--crop x,y,w,h] [--out model.js] [--png out]
                               photo → palette-snapped voxel model + preview
  partwright fetch   <url>     [--out file]              download a remote image to disk (for photo)

Phase 2 (headless-browser daemon — full fidelity + state):
  partwright iterate <file.js> [--out png] [--views all] [-p k=v]
                                                         run → stats+warnings+real render
  partwright render  [--code file.js] [--out png] [--views all] [--size N]
  partwright call    <method> [argsJSON] [--out png]     any window.partwright method
  partwright methods [filter]                            list callable methods
  partwright bake    <fixtureDir> [--catalog public/catalog]
  partwright daemon  start|stop|status

See docs/headless-cli.md.`;

export async function main(argv) {
  const [cmd, ...rest] = argv;
  switch (cmd) {
    case 'preview': return cmdPreview(rest, { pngDefault: true });
    case 'run': return cmdPreview(rest, { pngDefault: false });
    case 'compare': return cmdCompare(rest);
    case 'photo': return cmdPhoto(rest);
    case 'fetch': return cmdFetch(rest);
    case 'iterate': return cmdIterate(rest);
    case 'daemon': return cmdDaemon(rest);
    case 'call': return cmdCall(rest);
    case 'render': return cmdRender(rest);
    case 'methods': return cmdMethods(rest);
    case 'bake': return cmdBake(rest);
    case '__daemon-run': { const a = parse(rest); return runDaemon({ appPort: Number(a['app-port']), controlPort: Number(a['control-port']) }); }
    case 'help': case '--help': case '-h': console.log(USAGE); return;
    default:
      console.error(USAGE);
      process.exit(cmd ? 1 : 0);
  }
}
