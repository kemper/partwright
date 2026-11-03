#!/usr/bin/env node
// bench-engine-sandbox — measure what the engine sandbox (docs/engine-sandbox.md,
// kemper/partwright#1090) costs, per mode: off / origin. (The former 'opaque'
// mode was removed; earlier revisions of docs/engine-sandbox.md have its numbers.)
//
//   node scripts/bench-engine-sandbox.mjs [--iterations 3] [--runs 6]
//        [--app-port 5204] [--sandbox-port 5205] [--out <dir>] [--no-build]
//        [--modes off,origin]
//
// Uses a PRODUCTION build (`vite build`, with VITE_SANDBOX_ORIGIN pointing at
// the second port) served by two `vite preview` servers — app + sandbox
// origin, both with the COOP/COEP headers from vite.config.ts — and
// Playwright Chromium. Per mode and iteration, in a FRESH browser context:
//
//   1. cold start   — navigation → `partwright:engine-worker-ready` mark
//                     (+ network requests/bytes of that load);
//   2. lazy engines (cold) — first SCAD run, first BREP (replicad) run;
//   3. warm start   — reload in the same context → ready mark, and the
//                     network requests/bytes for .wasm / JS on that reload
//                     (does the sandbox lose HTTP-cache reuse?);
//   4. run latency  — median of N runs (after a warmup) of a cube, a 204,800-
//                     triangle sphere and a 500,000-triangle sphere: the
//                     engine round trip (post → mesh on the main thread,
//                     from the worker-health ring), the worker-side compute,
//                     their difference (≈ message/transfer cost), and the
//                     full `partwright.run` wall time (incl. render);
//   5. memory       — performance.measureUserAgentSpecificMemory() (forced
//                     eager), plus the PSS of the whole browser process tree
//                     from /proc (Linux) — captures the extra renderer
//                     process + Worker WASM heaps the sandbox adds;
//   6. lazy engines (warm) — first SCAD / BREP run after the reload.
//
// Writes raw JSON + a Markdown summary to --out and prints the summary.
// Chromium only (Firefox/WebKit are not measured).

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, mkdirSync, writeFileSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const VITE_BIN = join(root, 'node_modules', 'vite', 'bin', 'vite.js');

function parseArgs(argv) {
  const a = {
    iterations: 3, runs: 6, appPort: 5204, sandboxPort: 5205,
    out: join(root, 'test-results', 'sandbox-bench'), build: true,
    modes: ['off', 'origin'],
  };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === '--iterations') a.iterations = parseInt(argv[++i], 10);
    else if (t === '--runs') a.runs = parseInt(argv[++i], 10);
    else if (t === '--app-port') a.appPort = parseInt(argv[++i], 10);
    else if (t === '--sandbox-port') a.sandboxPort = parseInt(argv[++i], 10);
    else if (t === '--out') a.out = resolve(argv[++i]);
    else if (t === '--no-build') a.build = false;
    else if (t === '--modes') {
      a.modes = argv[++i].split(',');
      const bad = a.modes.filter(m => m !== 'off' && m !== 'origin');
      if (bad.length) { console.error(`unknown mode(s) ${bad.join(', ')} - modes are off, origin`); process.exit(2); }
    }
    else { console.error(`unknown flag ${t}`); process.exit(2); }
  }
  return a;
}

const args = parseArgs(process.argv.slice(2));
const APP = `http://localhost:${args.appPort}`;
const SANDBOX = `http://localhost:${args.sandboxPort}`;
const env = { ...process.env, VITE_SANDBOX_ORIGIN: SANDBOX, VITE_APP_ORIGIN: APP };

function detectChromium() {
  const sandboxRoot = '/opt/pw-browsers';
  if (!existsSync(sandboxRoot)) return undefined;
  const dirs = readdirSync(sandboxRoot).filter(d => /^chromium-\d+$/.test(d))
    .sort((x, y) => Number(y.split('-')[1]) - Number(x.split('-')[1]));
  for (const d of dirs) for (const sub of ['chrome-linux', 'chrome-linux64']) {
    const c = join(sandboxRoot, d, sub, 'chrome');
    if (existsSync(c)) return c;
  }
  return undefined;
}

async function waitForUrl(url, ms = 60_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { const r = await fetch(url); if (r.ok) return; } catch { /* not up yet */ }
    await new Promise(r => setTimeout(r, 300));
  }
  throw new Error(`server ${url} did not come up`);
}

// ── /proc helpers: PSS of the browser's whole process tree ─────────────────
function procTree(rootPid) {
  const children = new Map();
  for (const d of readdirSync('/proc')) {
    if (!/^\d+$/.test(d)) continue;
    try {
      const stat = readFileSync(`/proc/${d}/stat`, 'utf8');
      const ppid = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1]);
      if (!children.has(ppid)) children.set(ppid, []);
      children.get(ppid).push(Number(d));
    } catch { /* process exited */ }
  }
  const out = [];
  const stack = [rootPid];
  while (stack.length) {
    const p = stack.pop();
    out.push(p);
    for (const c of children.get(p) ?? []) stack.push(c);
  }
  return out;
}
function findPidWithArg(marker) {
  for (const d of readdirSync('/proc')) {
    if (!/^\d+$/.test(d)) continue;
    try {
      const cmd = readFileSync(`/proc/${d}/cmdline`, 'utf8');
      if (cmd.includes(marker) && !cmd.includes('--type=')) return Number(d);
    } catch { /* gone */ }
  }
  return null;
}
function treeMemory(rootPid) {
  if (!rootPid) return null;
  let pssKb = 0; let renderers = 0;
  for (const p of procTree(rootPid)) {
    try {
      const roll = readFileSync(`/proc/${p}/smaps_rollup`, 'utf8');
      const m = /^Pss:\s+(\d+) kB/m.exec(roll);
      if (m) pssKb += Number(m[1]);
      if (readFileSync(`/proc/${p}/cmdline`, 'utf8').includes('--type=renderer')) renderers++;
    } catch { /* gone */ }
  }
  return { pssMB: +(pssKb / 1024).toFixed(1), renderers };
}

// ── stats ───────────────────────────────────────────────────────────────────
const median = (xs) => {
  const s = xs.filter(x => typeof x === 'number' && Number.isFinite(x)).sort((a, b) => a - b);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const spread = (xs) => {
  const s = xs.filter(x => typeof x === 'number' && Number.isFinite(x));
  return s.length ? [Math.min(...s), Math.max(...s)] : null;
};

// ── page helpers ──────────────────────────────────────────────────────────
function netCollector(context) {
  const reqs = [];
  const onDone = async (req, failed) => {
    let status = null; let bytes = 0;
    try {
      const res = failed ? null : await req.response();
      status = res ? res.status() : 'failed';
      const sz = await req.sizes();
      bytes = (sz.responseBodySize || 0) + (sz.responseHeadersSize || 0);
    } catch { /* detached */ }
    reqs.push({ url: req.url(), type: req.resourceType(), status, bytes });
  };
  context.on('requestfinished', (r) => { void onDone(r, false); });
  context.on('requestfailed', (r) => { void onDone(r, true); });
  return {
    take() { return reqs.splice(0); },
  };
}

function summarizeNet(reqs) {
  const cat = (u) => /\.wasm(\?|$)/.test(u) ? 'wasm' : /\.m?js(\?|$)/.test(u) ? 'js' : 'other';
  const out = {};
  for (const r of reqs) {
    const c = cat(r.url);
    out[c] ??= { requests: 0, bytes: 0, status200: 0, status304: 0, other: 0 };
    const o = out[c];
    o.requests++; o.bytes += r.bytes;
    if (r.status === 200) o.status200++; else if (r.status === 304) o.status304++; else o.other++;
  }
  return out;
}

async function waitEngineReady(page) {
  await page.waitForFunction(
    () => performance.getEntriesByName('partwright:engine-worker-ready').length > 0
      && !!window.partwright?.getEngineSandboxStatus,
    undefined, { timeout: 180_000, polling: 50 },
  );
  return page.evaluate(() => {
    const ready = performance.getEntriesByName('partwright:engine-worker-ready')[0].startTime;
    const start = performance.getEntriesByName('partwright:engine-worker-start')[0]?.startTime ?? null;
    return { readyMs: Math.round(ready), workerBootMs: start == null ? null : Math.round(ready - start), status: window.partwright.getEngineSandboxStatus() };
  });
}

async function timedRun(page, code, lang) {
  return page.evaluate(async ({ code, lang }) => {
    const pw = window.partwright;
    if (lang) await pw.setActiveLanguage(lang);
    const startEpoch = Date.now();
    const t0 = performance.now();
    const r = await pw.run(code);
    const wallMs = performance.now() - t0;
    // The worker-health ring is newest-first.
    const last = pw.getWorkerHealth().runs
      .find(x => x.worker === 'geometry' && x.status === 'ok' && x.timestamp >= startEpoch);
    return {
      error: r.error ?? null, triangleCount: r.triangleCount,
      wallMs: +wallMs.toFixed(1),
      engineMs: last?.durationMs ?? null,
      workerMs: last?.workerMs ?? null,
      overheadMs: last && typeof last.workerMs === 'number' ? last.durationMs - last.workerMs : null,
    };
  }, { code, lang });
}

async function measureMemory(page) {
  return page.evaluate(async () => {
    const out = {};
    try {
      if (typeof performance.measureUserAgentSpecificMemory === 'function') {
        const m = await performance.measureUserAgentSpecificMemory();
        out.uaMemoryMB = +(m.bytes / 1048576).toFixed(1);
        let workers = 0;
        for (const b of m.breakdown) {
          if (b.attribution.some(a => a.scope === 'DedicatedWorkerGlobalScope')) workers += b.bytes;
        }
        out.uaWorkerMB = +(workers / 1048576).toFixed(1);
      }
    } catch (e) { out.uaError = String(e); }
    const pm = performance.memory;
    if (pm) out.mainHeapMB = +(pm.usedJSHeapSize / 1048576).toFixed(1);
    return out;
  });
}

const MODELS = {
  cube: (i) => `// run ${i}\nconst { Manifold } = api; return Manifold.cube([10, 10, 10]);`,
  sphere200k: (i) => `// run ${i}\nconst { Manifold } = api; return Manifold.sphere(10, 640);`,
  sphere500k: (i) => `// run ${i}\nconst { Manifold } = api; return Manifold.sphere(10, 1000);`,
};
const SCAD = (i) => `// run ${i}\ncube(10);`;
const BREP = (i) => `// run ${i}\nconst { BREP } = api; return BREP.box([15, 15, 15]).fillet(1);`;

async function benchOne(mode, iter) {
  // A fresh PERSISTENT profile per (mode, iteration): an empty disk cache for
  // the cold start, and a real on-disk HTTP + code cache for the warm reload
  // (Playwright's default non-persistent contexts use a small in-memory cache
  // that silently refuses the ~10 MB OCCT/OpenSCAD wasm, which would make
  // every mode look cache-less). One browser per profile also makes the /proc
  // memory figure that mode's alone.
  const marker = `--bench-marker-${process.pid}-${mode}-${iter}-${Date.now()}`;
  const profile = mkdtempSync(join(tmpdir(), 'pw-sandbox-bench-'));
  const context = await chromium.launchPersistentContext(profile, {
    executablePath: detectChromium(),
    args: ['--no-sandbox', '--enable-blink-features=ForceEagerMeasureMemory', marker],
    viewport: { width: 1280, height: 900 },
  });
  const browserPid = findPidWithArg(marker);
  await context.addInitScript((m) => {
    if (window !== window.top) return;
    try { localStorage.setItem('partwright-engine-sandbox', m); } catch { /* ignore */ }
  }, mode);
  const net = netCollector(context);
  const page = context.pages()[0] ?? await context.newPage();
  const res = { mode, iteration: iter, chromium: context.browser()?.version() ?? null };
  const tick = () => new Promise(r => setTimeout(r, 500));

  // 1. cold start
  await page.goto(`${APP}/editor`, { waitUntil: 'commit' });
  res.cold = await waitEngineReady(page);
  await tick();
  res.cold.network = summarizeNet(net.take());

  // 2. lazy engines, cold
  res.scadCold = await timedRun(page, SCAD(0), 'scad');
  res.brepCold = await timedRun(page, BREP(0), 'replicad');
  await page.evaluate(() => window.partwright.setActiveLanguage('manifold-js'));
  await tick();
  net.take();

  // 3. warm start (reload, same context)
  await page.reload({ waitUntil: 'commit' });
  res.warm = await waitEngineReady(page);
  await tick();
  res.warm.network = summarizeNet(net.take());

  // 4. run latency
  res.runs = {};
  for (const [name, gen] of Object.entries(MODELS)) {
    await timedRun(page, gen(-1), 'manifold-js'); // warmup
    const samples = [];
    for (let i = 0; i < args.runs; i++) samples.push(await timedRun(page, gen(i)));
    const err = samples.find(s => s.error);
    res.runs[name] = {
      triangleCount: samples[0].triangleCount,
      error: err?.error ?? null,
      engineMs: median(samples.map(s => s.engineMs)),
      workerMs: median(samples.map(s => s.workerMs)),
      overheadMs: median(samples.map(s => s.overheadMs)),
      wallMs: median(samples.map(s => s.wallMs)),
      samples,
    };
  }

  // 5. memory (after the manifold-js runs, before the lazy engines reload)
  res.memory = { ...(await measureMemory(page)), process: treeMemory(browserPid) };

  // 6. lazy engines, warm (new Worker after the reload)
  net.take();
  res.scadWarm = await timedRun(page, SCAD(1), 'scad');
  res.brepWarm = await timedRun(page, BREP(1), 'replicad');
  await tick();
  res.lazyWarmNetwork = summarizeNet(net.take());
  res.finalStatus = await page.evaluate(() => window.partwright.getEngineSandboxStatus());

  await context.close();
  rmSync(profile, { recursive: true, force: true });
  return res;
}

function fmt(v, unit = '') {
  if (v == null) return '—';
  return `${typeof v === 'number' ? Math.round(v * 10) / 10 : v}${unit}`;
}
function cell(values, unit = 'ms') {
  const m = median(values);
  const s = spread(values);
  if (m == null) return '—';
  return s && s[0] !== s[1] ? `${fmt(m, unit)} (${fmt(s[0])}–${fmt(s[1])})` : fmt(m, unit);
}

function summarize(results) {
  const byMode = {};
  for (const r of results) (byMode[r.mode] ??= []).push(r);
  const modes = Object.keys(byMode);
  const rows = [];
  const row = (label, f, unit) => rows.push(`| ${label} | ${modes.map(m => cell(byMode[m].map(f), unit)).join(' | ')} |`);
  const netCell = (f) => rows.push(`| ${f.label} | ${modes.map(m => {
    const xs = byMode[m].map(f.get).filter(Boolean);
    if (!xs.length) return '—';
    const req = median(xs.map(x => x.requests)); const kb = median(xs.map(x => x.bytes / 1024));
    const s200 = median(xs.map(x => x.status200)); const s304 = median(xs.map(x => x.status304));
    return `${req} req / ${fmt(kb, ' KB')} (200×${s200}, 304×${s304})`;
  }).join(' | ')} |`);

  rows.push(`| Metric (median, min–max over ${results.length / modes.length} iterations) | ${modes.join(' | ')} |`);
  rows.push(`|---|${modes.map(() => '---').join('|')}|`);
  row('Cold start: navigation → engine ready', r => r.cold.readyMs);
  row('Cold start: worker create → ready', r => r.cold.workerBootMs);
  row('Warm reload: navigation → engine ready', r => r.warm.readyMs);
  row('Warm reload: worker create → ready', r => r.warm.workerBootMs);
  netCell({ label: 'Cold load network: .wasm', get: r => r.cold.network.wasm });
  netCell({ label: 'Cold load network: JS', get: r => r.cold.network.js });
  netCell({ label: 'Warm reload network: .wasm', get: r => r.warm.network.wasm });
  netCell({ label: 'Warm reload network: JS', get: r => r.warm.network.js });
  for (const name of Object.keys(MODELS)) {
    const tri = results[0].runs[name].triangleCount;
    row(`Run ${name} (${tri} tris): engine round trip`, r => r.runs[name].engineMs);
    row(`Run ${name}: worker compute`, r => r.runs[name].workerMs);
    row(`Run ${name}: round trip − compute (transfer/msg)`, r => r.runs[name].overheadMs);
    row(`Run ${name}: partwright.run wall (incl. render)`, r => r.runs[name].wallMs);
  }
  row('SCAD first use (cold context)', r => r.scadCold.wallMs);
  row('SCAD first use (after warm reload)', r => r.scadWarm.wallMs);
  row('BREP first use (cold context)', r => r.brepCold.wallMs);
  row('BREP first use (after warm reload)', r => r.brepWarm.wallMs);
  netCell({ label: 'Lazy-engine reload network: .wasm', get: r => r.lazyWarmNetwork.wasm });
  netCell({ label: 'Lazy-engine reload network: JS', get: r => r.lazyWarmNetwork.js });
  row('measureUserAgentSpecificMemory total', r => r.memory.uaMemoryMB, ' MB');
  row('…of which dedicated workers', r => r.memory.uaWorkerMB, ' MB');
  row('Browser process tree PSS', r => r.memory.process?.pssMB, ' MB');
  row('Renderer processes', r => r.memory.process?.renderers, '');
  rows.push(`| crossOriginIsolated (frame / worker) | ${modes.map(m => {
    const s = byMode[m].map(r => r.finalStatus);
    const f = [...new Set(s.map(x => String(x.frameCrossOriginIsolated)))].join('/');
    const w = [...new Set(s.map(x => String(x.workerCrossOriginIsolated)))].join('/');
    return m === 'off' ? 'n/a (app is COI)' : `${f} / ${w}`;
  }).join(' | ')} |`);
  rows.push(`| Active mode / unavailable | ${modes.map(m => {
    const s = byMode[m].map(r => r.finalStatus);
    return `${[...new Set(s.map(x => x.active))].join('/')} / ${s.filter(x => x.unavailableReason).length}`;
  }).join(' | ')} |`);
  return rows.join('\n');
}

async function main() {
  mkdirSync(args.out, { recursive: true });
  if (args.build) {
    console.error('[bench] building (vite build, VITE_SANDBOX_ORIGIN=' + SANDBOX + ')…');
    const b = spawnSync(process.execPath, [VITE_BIN, 'build'], { cwd: root, env, stdio: ['ignore', 'ignore', 'inherit'] });
    if (b.status !== 0) throw new Error('build failed');
  }
  const servers = [args.appPort, args.sandboxPort].map(port =>
    spawn(process.execPath, [VITE_BIN, 'preview', '--port', String(port), '--strictPort'], { cwd: root, env, stdio: 'ignore' }));
  try {
    await waitForUrl(`${APP}/editor`);
    await waitForUrl(`${SANDBOX}/sandbox`);
    const results = [];
    for (let it = 0; it < args.iterations; it++) {
      // Rotate the mode order each iteration so no mode always runs first.
      const order = args.modes.map((_, i) => args.modes[(i + it) % args.modes.length]);
      for (const mode of order) {
        console.error(`[bench] iteration ${it + 1}/${args.iterations} mode=${mode}`);
        const r = await benchOne(mode, it);
        results.push(r);
        console.error(`[bench]   cold ${r.cold.readyMs}ms warm ${r.warm.readyMs}ms 500k ${r.runs.sphere500k.engineMs}ms active=${r.finalStatus.active}`);
      }
    }
    const version = results[0]?.chromium ?? 'unknown';
    const meta = {
      date: new Date().toISOString(), chromium: version, iterations: args.iterations, runsPerModel: args.runs,
      app: APP, sandbox: SANDBOX, cpus: (await import('node:os')).cpus().length,
    };
    const table = summarize(results);
    const stamp = meta.date.replace(/[:.]/g, '-');
    writeFileSync(join(args.out, `bench-${stamp}.json`), JSON.stringify({ meta, results }, null, 2));
    writeFileSync(join(args.out, `bench-${stamp}.md`), `Chromium ${version}, ${meta.cpus} CPUs, ${meta.date}\n\n${table}\n`);
    console.log(`Chromium ${version}, ${meta.cpus} CPUs\n\n${table}`);
    console.error(`[bench] wrote ${join(args.out, `bench-${stamp}.json`)}`);
  } finally {
    for (const s of servers) s.kill('SIGTERM');
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
