#!/usr/bin/env node
// Refresh tests/e2e-timings.json (the per-file weights the time-balanced CI
// sharding uses — see scripts/lib/e2eShard.mjs) from Playwright JSON reports.
//
// CI writes one report per shard to playwright-report/e2e-report.json and the
// staging gate uploads them as `e2e-report-<shard>` artifacts. To refresh:
//   1. download the artifacts from a recent green "Gate main → staging" run
//   2. node scripts/e2e-timings.mjs path/to/e2e-report-*/e2e-report.json
// A local full run works too: `npx playwright test --reporter=json > r.json`.
//
// Stale timings only cost balance, never correctness: every spec file still
// runs in exactly one shard, and unknown files get the median weight.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { basename, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const reports = process.argv.slice(2);
if (!reports.length) {
  console.error('usage: node scripts/e2e-timings.mjs <playwright-json-report>...');
  process.exit(1);
}

const totals = {};
function walkSuite(suite) {
  for (const spec of suite.specs ?? []) {
    const file = basename(spec.file ?? suite.file ?? '');
    for (const test of spec.tests ?? []) {
      // Use the final attempt's duration so a retried flake isn't double-counted.
      const last = test.results?.[test.results.length - 1];
      if (last && typeof last.duration === 'number') totals[file] = (totals[file] ?? 0) + last.duration / 1000;
    }
  }
  for (const child of suite.suites ?? []) walkSuite(child);
}
for (const path of reports) {
  const report = JSON.parse(readFileSync(path, 'utf8'));
  for (const suite of report.suites ?? []) walkSuite(suite);
}

// Merge over the existing timings so a partial report (one shard, a local
// subset run) only updates the files it covered; drop specs that no longer exist.
const testsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'tests');
const out = join(testsDir, 'e2e-timings.json');
const previous = existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')).files ?? {} : {};
const merged = { ...previous };
for (const [f, s] of Object.entries(totals)) merged[f] = s;
const files = Object.fromEntries(
  Object.entries(merged)
    .filter(([f]) => f.endsWith('.spec.ts') && existsSync(join(testsDir, f)))
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([f, s]) => [f, Math.round(s * 10) / 10]),
);
writeFileSync(out, JSON.stringify({
  _comment: 'Per-spec-file e2e duration in seconds; weights for time-balanced CI sharding (scripts/lib/e2eShard.mjs). Regenerate with scripts/e2e-timings.mjs.',
  files,
}, null, 2) + '\n');
const sum = Object.values(files).reduce((a, b) => a + b, 0);
console.log(`updated ${Object.keys(totals).length} files; wrote ${Object.keys(files).length} files, ${(sum / 60).toFixed(1)} min total → ${out}`);
