#!/usr/bin/env node
// segment:bench — the scoreboard for part detectors (#1025).
//
// Runs labelled example models (their api.label parts are the ground truth),
// strips the labels, runs each detector configuration on the bare fused mesh,
// and scores it with area-weighted best-match IoU (1 = perfect). Seeded
// detectors get ONE seed per true label, on that label's triangle nearest its
// area-weighted centroid — "a person clicked the middle of each part".
//
//   npm run segment:bench                       # default model set
//   npm run segment:bench -- examples/foo.js …  # your own models
//   npm run segment:bench -- --json             # machine-readable
//
// Third-party scans stay out of the repo; this uses models we own.
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { loadSegmentModule } from './cli/segment.mjs';

const DEFAULT_MODELS = [
  'examples/christmas_tree.js',
  'examples/fountain_pen.js',
  'examples/cactus_dock.js',
  'examples/figure_soccer_striker.js',
  'examples/figure_chibi_wizard.js',
];

// Each config: a detector run. Add a row here when a new detector lands.
// `smooth` is a normal-smoothing radius in median-edge-lengths (resolved per
// mesh so it means the same thing at every scale); omitted = raw normals.
const CONFIGS = [
  { name: 'pieces', algorithm: 'pieces' },
  { name: 'crease-watershed hybrid', algorithm: 'crease-watershed', params: { growth: 'hybrid' } },
  { name: 'crease-watershed minimax', algorithm: 'crease-watershed', params: { growth: 'minimax' } },
  { name: 'crease-watershed summed', algorithm: 'crease-watershed', params: { growth: 'summed' } },
  { name: 'crease-watershed hybrid q10', algorithm: 'crease-watershed', params: { growth: 'hybrid', creaseQuantumDeg: 10 } },
  { name: 'crease-watershed hybrid smooth3', algorithm: 'crease-watershed', params: { growth: 'hybrid' }, smooth: 3 },
];

// Each model is scored clean AND with scan-like vertex jitter (this fraction
// of its median edge length), so noise robustness is part of the score.
const NOISE_FRAC = 0.25;

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const models = args.filter((a) => !a.startsWith('--'));
const files = models.length ? models : DEFAULT_MODELS;

const { mod, close } = await loadSegmentModule();
const rows = [];
try {
  for (const file of files) {
    let lm;
    try {
      lm = await mod.labelledMeshFromCode(readFileSync(file, 'utf8'));
    } catch (e) {
      rows.push({ model: basename(file), error: String(e.message ?? e) });
      continue;
    }
    if (lm.names.length < 2) { rows.push({ model: basename(file), error: 'fewer than 2 labels — skipped' }); continue; }
    for (const variant of ['clean', 'noisy']) {
      const f0 = mod.featuresFor(lm.mesh);
      const mesh = variant === 'clean' ? lm.mesh : mod.jitterMesh(lm.mesh, NOISE_FRAC * f0.medianEdgeLen);
      const f = variant === 'clean' ? f0 : mod.featuresFor(mesh);
      const seeds = mod.seedsFromTruth(f, lm.truth, lm.names);
      for (const c of CONFIGS) {
        const t0 = performance.now();
        const featureOptions = c.smooth ? { normalSmoothRadius: c.smooth * f.medianEdgeLen } : undefined;
        const out = mod.segmentMesh(mesh, { algorithm: c.algorithm, params: c.params, featureOptions, seeds: c.algorithm === 'pieces' ? undefined : seeds });
        const score = mod.scorePartition(out.triPart, lm.truth, f.triArea);
        rows.push({
          model: basename(file), variant, tris: f.triCount, labels: lm.names.length, config: c.name,
          iou: +score.iou.toFixed(3), parts: out.summary.parts.length,
          boundaryCrease: out.summary.quality.boundaryCreaseMean, ms: Math.round(performance.now() - t0),
        });
      }
    }
  }
} finally {
  await close();
}

if (asJson) {
  console.log(JSON.stringify(rows, null, 2));
} else {
  const ok = rows.filter((r) => !r.error);
  const pad = (s, n) => String(s).padEnd(n);
  console.log(`${pad('model', 28)}${pad('variant', 8)}${pad('config', 34)}${pad('IoU', 7)}${pad('parts', 7)}${pad('crease°', 9)}ms`);
  for (const r of ok) console.log(`${pad(r.model, 28)}${pad(r.variant, 8)}${pad(r.config, 34)}${pad(r.iou, 7)}${pad(r.parts, 7)}${pad(r.boundaryCrease, 9)}${r.ms}`);
  for (const r of rows.filter((x) => x.error)) console.log(`${pad(r.model, 28)}ERROR ${r.error}`);
  // Mean IoU per config across models — the headline number.
  console.log('\nmean IoU per config (clean / noisy):');
  const mean = (xs) => (xs.length ? (xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(3) : '—');
  for (const c of CONFIGS) {
    const of = (v) => ok.filter((r) => r.config === c.name && r.variant === v).map((r) => r.iou);
    console.log(`  ${pad(c.name, 34)}${mean(of('clean'))} / ${mean(of('noisy'))}`);
  }
}
