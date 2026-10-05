#!/usr/bin/env node
// Catalog review harness — runs Partwright's reviewer (src/ai/review.ts) over
// catalog entries so the review prompt can be evaluated at scale.
//
// Each entry is loaded into the REAL app (dev server + Playwright), its stored
// code is re-run, and the app's own gatherReviewContext() / formatReviewPrompt()
// / buildReviewSystemPrompt() build the reviewer input. The prompt text, live
// geometry stats and 4-view snapshot are therefore exactly what an in-app
// automatic review would send. The entry's catalog name + description stands in
// for the user's request.
//
// Usage (dev server must be up: `npm run dev`):
//   node scripts/catalog-review.mjs prepare [--only id,id] [--out dir] [--base url]
//       → <out>/SYSTEM.txt, <out>/<id>.user.txt, <out>/<id>.png, <out>/<id>.meta.json
//   node scripts/catalog-review.mjs call [--model claude-sonnet-5-5] [--only …] [--out dir]
//       → <out>/<id>.review.txt via the Anthropic Messages API (needs ANTHROPIC_API_KEY;
//         entries that already have a review are skipped)
//   node scripts/catalog-review.mjs report [--out dir]
//       → <out>/report.json + a verdict tally on stdout

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CATALOG = path.join(REPO, 'public', 'catalog');

function parseArgs(argv) {
  const a = { cmd: argv[0] ?? 'prepare', out: '/tmp/catalog-review', base: 'http://localhost:5173', only: [], model: 'claude-sonnet-5-5' };
  for (let i = 1; i < argv.length; i++) {
    const t = argv[i];
    if (t === '--out') a.out = argv[++i];
    else if (t === '--base') a.base = argv[++i];
    else if (t === '--only') a.only = argv[++i].split(',').map(s => s.trim()).filter(Boolean);
    else if (t === '--model') a.model = argv[++i];
  }
  return a;
}

function manifestEntries(only) {
  const entries = JSON.parse(fs.readFileSync(path.join(CATALOG, 'manifest.json'), 'utf8')).entries;
  return only.length ? entries.filter(e => only.includes(e.id)) : entries;
}

function findChrome() {
  const root = '/opt/pw-browsers';
  if (!fs.existsSync(root)) return undefined;
  const dirs = fs.readdirSync(root).filter(d => /^chromium-\d+$/.test(d))
    .sort((x, y) => Number(y.split('-')[1]) - Number(x.split('-')[1]));
  for (const d of dirs) {
    const p = path.join(root, d, 'chrome-linux', 'chrome');
    if (fs.existsSync(p)) return p;
  }
  return undefined;
}

async function freshPage(context, base) {
  const page = await context.newPage();
  await page.addInitScript(() => { try { localStorage.setItem('partwright-tour-completed', '1'); } catch { /* */ } });
  await page.goto(`${base}/editor`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!(window.partwright?.run && window.partwright?.importSessionData), null, { timeout: 60_000 });
  for (let i = 0; i < 60; i++) {
    const ok = await page.evaluate(async () => (await window.partwright.run('return api.Manifold.cube([1,1,1], true);'))?.status === 'ok');
    if (ok) break;
    await new Promise(r => setTimeout(r, 1000));
  }
  return page;
}

async function prepareOne(page, entry) {
  const payload = JSON.parse(fs.readFileSync(path.join(CATALOG, entry.file), 'utf8'));
  const request = `${entry.name} — ${entry.description ?? ''}`.trim();
  return page.evaluate(async ({ payload, request }) => {
    const pw = window.partwright;
    const imp = await pw.importSessionData(payload);
    if (imp?.error) return { error: `import: ${imp.error}` };
    await new Promise(r => setTimeout(r, 500));
    const code = payload.versions[payload.versions.length - 1].code;
    const geo = await pw.run(code);
    if (!geo || geo.status === 'error') return { error: `run: ${geo?.error ?? 'no result'}` };
    if (typeof pw.ensureSurfaceTexturesApplied === 'function') { try { await pw.ensureSurfaceTexturesApplied(); } catch { /* best effort */ } }
    await new Promise(r => setTimeout(r, 300));
    const review = await import('/src/ai/review.ts');
    const prompt = await import('/src/ai/reviewPrompt.ts');
    const ctx = await review.gatherReviewContext();
    // Same focus string the automatic review uses (runAutoReview in aiPanel.ts).
    const full = { ...ctx, focus: `Grade the result against the user's request: ${request}` };
    return {
      system: prompt.buildReviewSystemPrompt(null),
      user: review.formatReviewPrompt(full),
      snapshot: ctx.snapshot,
      stats: pw.getGeometryData(),
    };
  }, { payload, request });
}

async function prepare(args) {
  fs.mkdirSync(args.out, { recursive: true });
  const entries = manifestEntries(args.only);
  const browser = await chromium.launch({ executablePath: findChrome(), args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  let page = await freshPage(context, args.base);
  let done = 0;
  for (const entry of entries) {
    const t0 = Date.now();
    let res;
    try {
      res = await Promise.race([
        prepareOne(page, entry),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout after 240s')), 240_000)),
      ]);
    } catch (err) {
      res = { error: String(err?.message ?? err) };
      // A hung or crashed page poisons the next entry; start clean.
      await page.close().catch(() => {});
      page = await freshPage(context, args.base);
    }
    const meta = { id: entry.id, name: entry.name, language: entry.language, file: entry.file, tags: entry.tags ?? [], ms: Date.now() - t0 };
    if (res.error) {
      meta.error = res.error;
    } else {
      fs.writeFileSync(path.join(args.out, 'SYSTEM.txt'), res.system);
      fs.writeFileSync(path.join(args.out, `${entry.id}.user.txt`), res.user);
      if (res.snapshot) fs.writeFileSync(path.join(args.out, `${entry.id}.png`), Buffer.from(res.snapshot.data, 'base64'));
      meta.snapshot = !!res.snapshot;
      meta.stats = res.stats && { isManifold: res.stats.isManifold, componentCount: res.stats.componentCount, genus: res.stats.genus, bbox: res.stats.boundingBox?.dimensions };
    }
    fs.writeFileSync(path.join(args.out, `${entry.id}.meta.json`), JSON.stringify(meta, null, 2));
    done++;
    console.log(`[${done}/${entries.length}] ${entry.id} ${meta.error ? `ERROR ${meta.error}` : 'ok'} ${(meta.ms / 1000).toFixed(1)}s`);
  }
  await browser.close();
}

async function call(args) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) { console.error('call: set ANTHROPIC_API_KEY'); process.exit(2); }
  const system = fs.readFileSync(path.join(args.out, 'SYSTEM.txt'), 'utf8');
  for (const entry of manifestEntries(args.only)) {
    const userPath = path.join(args.out, `${entry.id}.user.txt`);
    const outPath = path.join(args.out, `${entry.id}.review.txt`);
    if (!fs.existsSync(userPath) || fs.existsSync(outPath)) continue;
    const content = [{ type: 'text', text: fs.readFileSync(userPath, 'utf8') }];
    const png = path.join(args.out, `${entry.id}.png`);
    if (fs.existsSync(png)) content.push({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: fs.readFileSync(png).toString('base64') } });
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: args.model, max_tokens: 2000, system, messages: [{ role: 'user', content }] }),
    });
    const body = await res.json();
    if (!res.ok) { console.error(`${entry.id}: HTTP ${res.status} ${JSON.stringify(body).slice(0, 300)}`); continue; }
    const text = body.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
    fs.writeFileSync(outPath, text);
    console.log(`${entry.id}: ${text.split('\n')[0]} (in ${body.usage?.input_tokens}, out ${body.usage?.output_tokens})`);
  }
}

function report(args) {
  const rows = [];
  for (const entry of manifestEntries(args.only)) {
    const metaPath = path.join(args.out, `${entry.id}.meta.json`);
    const meta = fs.existsSync(metaPath) ? JSON.parse(fs.readFileSync(metaPath, 'utf8')) : { id: entry.id, error: 'not prepared' };
    const reviewPath = path.join(args.out, `${entry.id}.review.txt`);
    const review = fs.existsSync(reviewPath) ? fs.readFileSync(reviewPath, 'utf8') : null;
    const m = review && /^\s*\**\s*verdict\s*\**\s*[:\-–]\s*\**\s*(pass|minor issues?|needs rework|rework)\b/im.exec(review);
    const verdict = !review ? null : !m ? 'unparsed' : m[1].toLowerCase().startsWith('minor') ? 'minor' : m[1].toLowerCase() === 'pass' ? 'pass' : 'rework';
    const findings = review ? (review.match(/^\s*\d+\.\s/gm) ?? []).length : 0;
    rows.push({ id: entry.id, language: entry.language, tags: entry.tags ?? [], error: meta.error ?? null, verdict, findings });
  }
  fs.writeFileSync(path.join(args.out, 'report.json'), JSON.stringify(rows, null, 2));
  const tally = {};
  for (const r of rows) { const k = r.error ? 'error' : (r.verdict ?? 'no review'); tally[k] = (tally[k] ?? 0) + 1; }
  console.log(JSON.stringify(tally));
}

const args = parseArgs(process.argv.slice(2));
if (args.cmd === 'prepare') await prepare(args);
else if (args.cmd === 'call') await call(args);
else if (args.cmd === 'report') report(args);
else { console.error(`unknown command ${args.cmd}`); process.exit(2); }
