#!/usr/bin/env node
// eval:models — vision-judged model-quality eval loop (tracking: #827).
//
// Subject-neutral: a case can be a figure, an animal, an accessory, or any
// object — the harness just builds, renders, gates, and judges whatever the
// model returns. Builds an eval case with the CURRENT library, renders
// matched-angle tiles, runs printability gates, judges the render against a
// pinned REFERENCE (a target look) with a pluggable judge, and checks the score
// against a committed baseline so a change can't silently regress the rest of
// the corpus. Spend is tallied and budget-capped so looping is cheap and VISIBLE.
//
//   npm run eval:models -- <case> [--judge claude|pixel|human|gemini] [--model <id>]
//   npm run eval:models -- shoulders --set-reference   # pin current render as the target
//   npm run eval:models -- shoulders --set-baseline    # commit current score as baseline (per judge)
//   npm run eval:models -- shoulders --judge claude --budget 0.20
//   npm run eval:models -- --all                       # whole corpus
//
// The DEFAULT 'claude' judge is the real semantic judge and runs IN-CONTAINER
// via the `claude` CLI (bills against the user's Max OAuth). The 'pixel' judge
// is free/offline (a regression sentinel + harness proof); 'gemini' is an
// alternate cloud judge on a separate quota; 'human' is the anchor. Baselines
// are keyed by judge. See evals/README.md.

import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import sharp from 'sharp';
import { runPreview, composePng, resolveViews } from './cli/preview.mjs';
import { runJudge } from './cli/judge.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CASES_DIR = join(ROOT, 'evals/cases');
const RESULTS_DIR = join(ROOT, 'evals/results');
const BASELINE_PATH = join(ROOT, 'evals/baseline.json');
const TILE = 640;

function parseArgs(argv) {
  const a = { case: null, judge: 'claude', model: null, tolerance: 0, setReference: false, setBaseline: false, budget: Infinity, all: false };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === '--judge') a.judge = argv[++i];
    else if (t === '--model') a.model = argv[++i];
    else if (t === '--tolerance') { a.tolerance = Number(argv[++i]); if (!Number.isFinite(a.tolerance) || a.tolerance < 0) { console.error('--tolerance needs a non-negative number'); process.exit(2); } }
    else if (t === '--set-reference') a.setReference = true;
    else if (t === '--set-baseline') a.setBaseline = true;
    else if (t === '--budget') {
      a.budget = Number(argv[++i]);
      if (!Number.isFinite(a.budget) || a.budget < 0) { console.error('--budget needs a non-negative USD number (e.g. --budget 0.05)'); process.exit(2); }
    }
    else if (t === '--all') a.all = true;
    else if (!t.startsWith('-') && !a.case) a.case = t;
  }
  return a;
}

function loadCase(name) {
  const dir = join(CASES_DIR, name);
  const spec = JSON.parse(readFileSync(join(dir, 'case.json'), 'utf8'));
  const rubricMd = readFileSync(join(dir, spec.rubric || 'rubric.md'), 'utf8');
  const items = rubricMd.split('\n').map((l) => l.match(/^\s*[-*]\s+(.*)/)?.[1]).filter(Boolean);
  const { views } = resolveViews(spec.views ? spec.views.map((v) => v.join(',')).join(';') : null, null);
  // Color: a case can declare a `palette` (label→"#rrggbb", or a path to a JSON
  // file relative to the case dir) so figures with uncolored labels render — and
  // are judged — in their intended colors. Default sibling: `palette.json`.
  let palette = null;
  if (spec.palette && typeof spec.palette === 'object') palette = spec.palette;
  else {
    const pPath = join(dir, typeof spec.palette === 'string' ? spec.palette : 'palette.json');
    if (existsSync(pPath)) { try { palette = JSON.parse(readFileSync(pPath, 'utf8')); } catch { /* ignore */ } }
  }
  return { name, dir, spec, rubric: { items }, views, palette };
}

// Build the model and render the matched-angle tiles into one grid PNG buffer.
async function renderCandidate(c) {
  const result = await runPreview(join(c.dir, c.spec.model), { params: {}, lang: c.spec.lang || 'manifold-js', palette: c.palette ?? undefined });
  if (!result.ok) throw new Error(`model failed to build: ${result.error}`);
  const r = result.render;
  // c.views is null when the case omits `views`; pass undefined so composePng falls back to DEFAULT_VIEWS (null would throw).
  const png = await composePng(r.positions, r.triVerts, r.triColors, r.bbox, TILE, c.views ?? undefined).toBuffer();
  return { png, stats: result.stats };
}

// Hard printability gates — a case FAILS regardless of looks if these trip.
function checkGates(stats, gates = {}) {
  const fails = [];
  if (gates.manifold && !stats.isManifold) fails.push(`not manifold (componentCount ${stats.componentCount})`);
  if (gates.maxGenus != null && stats.genus > gates.maxGenus) fails.push(`genus ${stats.genus} > max ${gates.maxGenus}`);
  if (gates.maxComponents != null && stats.componentCount > gates.maxComponents) fails.push(`components ${stats.componentCount} > max ${gates.maxComponents}`);
  for (const lbl of gates.requireLabels || []) {
    const found = (stats.labels || []).find((l) => l.name === lbl);
    if (!found || found.triangleCount === 0) fails.push(`label "${lbl}" paints 0 triangles (buried/aliased)`);
  }
  return fails;
}

// Contact sheet: [ reference grid | divider | candidate grid ], side by side at a
// common height. Both panels are scaled to PANEL_H (not squished to one TILE
// width) so the candidate keeps enough resolution for the judge to see small
// accessories — at TILE 384 the candidate was downscaled to ~192px/tile and fine
// detail (glasses, makeup, a belt buckle) vanished before the judge ever saw it.
// PANEL_H is chosen so the sheet's long side stays near the vision API's ~1568px
// downsample ceiling, where extra pixels stop helping.
async function contactSheet(referencePng, candidatePng, outPath) {
  const GAP = 16, PANEL_H = 1024;
  const cand = await sharp(candidatePng).resize({ height: PANEL_H }).toBuffer();
  const ref = referencePng
    ? await sharp(referencePng).resize({ height: PANEL_H }).toBuffer()
    : await sharp({ create: { width: PANEL_H, height: PANEL_H, channels: 3, background: { r: 40, g: 40, b: 46 } } }).png().toBuffer();
  const cw = (await sharp(cand).metadata()).width || PANEL_H;
  const rw = (await sharp(ref).metadata()).width || PANEL_H;
  const sheet = await sharp({ create: { width: rw + GAP + cw, height: PANEL_H, channels: 3, background: { r: 24, g: 24, b: 28 } } })
    .composite([{ input: ref, left: 0, top: 0 }, { input: cand, left: rw + GAP, top: 0 }])
    .png().toBuffer();
  await sharp(sheet).toFile(outPath);
  return outPath;
}

function loadBaseline() { return existsSync(BASELINE_PATH) ? JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) : { cases: {} }; }
function saveBaseline(b) { writeFileSync(BASELINE_PATH, JSON.stringify(b, null, 2)); }

async function runOne(c, a, spend) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = join(RESULTS_DIR, c.name, stamp);
  mkdirSync(outDir, { recursive: true });

  const { png: candidatePng, stats } = await renderCandidate(c);
  writeFileSync(join(outDir, 'candidate.png'), candidatePng);

  // 1. Printability gates — hard fail.
  const gateFails = checkGates(stats, c.spec.gates);

  // --set-reference: pin THIS render as the case's target and stop.
  if (a.setReference) {
    writeFileSync(join(c.dir, 'reference.png'), candidatePng);
    console.log(`[${c.name}] reference pinned → evals/cases/${c.name}/reference.png`);
    return { case: c.name, score: null, gateFails, set: 'reference' };
  }

  const refPath = join(c.dir, 'reference.png');
  const referencePng = existsSync(refPath) ? readFileSync(refPath) : null;
  const sheetPath = await contactSheet(referencePng, candidatePng, join(outDir, 'contact-sheet.png'));

  // 2. Judge (skipped if gates already failed — don't spend on a broken build).
  let verdict = null;
  if (gateFails.length === 0) {
    if (spend.usd >= a.budget) {
      console.log(`[${c.name}] budget $${a.budget} reached — skipping judge`);
    } else {
      verdict = await runJudge(a.judge, {
        candidatePng, referencePng,
        contactSheetPath: sheetPath,
        verdictPath: join(c.dir, 'verdict.json'),
        rubric: c.rubric,
        ...(a.model ? { model: a.model } : {}),
      });
      if (verdict?.usage) { spend.usd += verdict.usage.estUsd; spend.calls++; spend.inTok += verdict.usage.inputTokens; spend.outTok += verdict.usage.outputTokens; }
    }
  }

  // 3. Regression gate vs committed baseline. Baselines are keyed BY JUDGE —
  // scores from different judges aren't comparable (a pixel 100 and a claude 72
  // measure different things), so we only compare like-with-like.
  const baseline = loadBaseline();
  const base = baseline.cases[c.name]?.[a.judge]?.score ?? null;
  const score = verdict?.score ?? null;
  let regression = null;
  // A semantic (LLM) judge is noisy run-to-run, so allow a tolerance band below
  // the baseline before calling it a regression (set higher for the claude judge).
  if (score != null && base != null) regression = score < base - (a.tolerance || 0) ? `REGRESSION ${score} < baseline ${base}${a.tolerance ? ` (tol ${a.tolerance})` : ''}` : null;

  if (a.setBaseline && score != null) {
    baseline.cases[c.name] = { ...(baseline.cases[c.name] || {}), [a.judge]: { score, at: stamp } };
    saveBaseline(baseline);
  }

  // Persist the per-run result for the scoreboard.
  const rec = { case: c.name, score, baseline: base, regression, gateFails, judge: a.judge, contactSheet: sheetPath, perItem: verdict?.perItem || [], stats: { isManifold: stats.isManifold, componentCount: stats.componentCount, genus: stats.genus } };
  writeFileSync(join(outDir, 'result.json'), JSON.stringify(rec, null, 2));
  return rec;
}

function printReport(recs, spend, budget) {
  console.log('\n──────── eval:models ────────');
  for (const r of recs) {
    if (r.set) { console.log(`  ${r.case}: ${r.set} pinned`); continue; }
    const gate = r.gateFails.length ? `❌ GATE: ${r.gateFails.join('; ')}` : '✓ gates';
    const sc = r.score == null ? '— (pending/awaiting human verdict)' : `${r.score}/100${r.baseline != null ? ` (baseline ${r.baseline})` : ''}`;
    const reg = r.regression ? `  ⚠ ${r.regression}` : '';
    console.log(`  ${r.case}: ${sc}  ${gate}${reg}`);
    for (const it of r.perItem) if (it.pass === false) console.log(`      ✗ ${it.item}: ${it.critique}${it.fix ? ` → ${it.fix}` : ''}`);
    console.log(`      contact sheet: ${r.contactSheet}`);
  }
  console.log('──────── spend ────────');
  console.log(`  judge calls: ${spend.calls}   tokens: ${spend.inTok} in / ${spend.outTok} out   est cost: $${spend.usd.toFixed(4)}${budget !== Infinity ? ` (budget $${budget})` : ''}`);
  console.log('───────────────────────\n');
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  const names = a.all ? readdirSync(CASES_DIR).filter((n) => existsSync(join(CASES_DIR, n, 'case.json'))) : (a.case ? [a.case] : null);
  if (!names) { console.error('Usage: npm run eval:models -- <case> [--judge claude|pixel|human|gemini] [--model <id>] [--set-reference] [--set-baseline] [--budget USD]\n       npm run eval:models -- --all'); process.exit(2); }

  const spend = { usd: 0, calls: 0, inTok: 0, outTok: 0 };
  const recs = [];
  let regressed = false;
  for (const name of names) {
    const c = loadCase(name);
    const rec = await runOne(c, a, spend);
    recs.push(rec);
    // --set-reference/--set-baseline are pin operations; don't fail their exit code on the build's gate state.
    if (!rec.set && (rec.regression || rec.gateFails?.length)) regressed = true;
  }
  printReport(recs, spend, a.budget);
  process.exit(regressed ? 1 : 0);
}

main().catch((e) => { console.error('eval:models failed:', e?.stack || e?.message || e); process.exit(1); });
