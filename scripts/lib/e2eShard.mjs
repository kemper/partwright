// Time-balanced e2e sharding.
//
// Playwright's built-in `--shard=i/N` splits the suite into N contiguous
// chunks of equal TEST COUNT. Our per-test cost varies wildly (a pure-logic
// spec runs 184 tests in 0.1s; a multi-part save spec takes 14s for one), so
// count-balanced shards came out 8.5 / 11.3 / 17.1 min — the slowest shard
// sets the PR's wall-clock time. Instead, CI sets E2E_SHARD=i/N and
// playwright.config.ts restricts `testMatch` to the files this module assigns
// to shard i, using per-file durations recorded in tests/e2e-timings.json.
//
// Assignment is greedy LPT (longest processing time first): sort files by
// recorded duration descending, give each to the currently-lightest shard.
// Deterministic — every CI job computes the same partition independently.
// Files missing from the timings (new specs) are weighted at the median known
// duration, so they're spread around rather than piling onto one shard.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/** Parse "i/N" (1-based). Returns null for an unset/empty value; throws on a malformed one. */
export function parseShardSpec(spec) {
  if (spec == null || spec === '') return null;
  const m = /^(\d+)\/(\d+)$/.exec(String(spec).trim());
  if (!m) throw new Error(`E2E_SHARD must look like "i/N", got ${JSON.stringify(spec)}`);
  const index = Number(m[1]);
  const total = Number(m[2]);
  if (total < 1 || index < 1 || index > total) {
    throw new Error(`E2E_SHARD out of range: ${spec}`);
  }
  return { index, total };
}

/**
 * Partition `files` into `total` buckets balanced by `timings[file]` seconds.
 * Returns an array of `total` arrays of file names (each sorted by name).
 */
export function assignShards(files, timings, total) {
  const known = files.map((f) => timings[f]).filter((t) => typeof t === 'number' && t >= 0);
  const sorted = [...known].sort((a, b) => a - b);
  const fallback = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 1;
  const weighted = files.map((f) => ({
    file: f,
    weight: typeof timings[f] === 'number' && timings[f] >= 0 ? timings[f] : fallback,
  }));
  // Heaviest first; ties broken by name so the partition is deterministic.
  weighted.sort((a, b) => b.weight - a.weight || (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
  const buckets = Array.from({ length: total }, () => ({ load: 0, files: [] }));
  for (const { file, weight } of weighted) {
    let lightest = 0;
    for (let i = 1; i < total; i++) if (buckets[i].load < buckets[lightest].load) lightest = i;
    buckets[lightest].files.push(file);
    buckets[lightest].load += weight;
  }
  return buckets.map((b) => b.files.sort());
}

/** Every e2e spec file name under `testsDir` (top level only — matches the suite layout). */
function listSpecFiles(testsDir) {
  return readdirSync(testsDir).filter((f) => f.endsWith('.spec.ts')).sort();
}

/** Load `{ files: { "<name>.spec.ts": seconds } }`; missing file → no timings (all equal weight). */
export function loadTimings(timingsPath) {
  if (!existsSync(timingsPath)) return {};
  const parsed = JSON.parse(readFileSync(timingsPath, 'utf8'));
  return parsed.files ?? {};
}

/** The spec file names assigned to shard `index` of `total` (1-based). */
export function filesForShard(index, total, testsDir, timingsPath = join(testsDir, 'e2e-timings.json')) {
  return assignShards(listSpecFiles(testsDir), loadTimings(timingsPath), total)[index - 1];
}
