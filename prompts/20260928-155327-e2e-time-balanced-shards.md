---
session: "016qCCKWGNM2LB6Fhb1UL57U"
timestamp: "2026-09-28T15:53:27Z"
sequence: 1
tools: [subagent]
---

## Human

E2E checks on PRs take 10+ minutes even with three shards in parallel.
Investigate what can be done (including deleting superfluous tests) so PR e2e
completes within a few minutes. After the report: open one PR for
time-balanced sharding + removing the build gate, and a separate PR for the
test-level speedups (shared pages, moving pure logic to vitest, removing
fixed sleeps).

## Assistant

## Key decisions

**Root cause of the long tail**: per-test timings from the CI logs of a green
run showed shards of 11.3 / 8.5 / 17.1 min. Playwright's `--shard` splits
contiguous chunks by *test count*; insert-codegen.spec.ts alone contributes 184
tests that take 0.1s total, so shard 1 got many cheap tests and shard 3 got the
slow paint/part/save/surface/viewport specs. Total serial compute is ~36 min.

**Time-balanced sharding via E2E_SHARD, not --shard**: playwright.config.ts
narrows `testMatch` to the spec files scripts/lib/e2eShard.mjs assigns to
shard i (greedy LPT over per-file seconds in tests/e2e-timings.json, seeded
from that run). Simulated max shard: 12.1 min at N=3, 4.5 min at N=8. Chose a
config-level env var over passing file lists on the CLI (CLI args are regex
filters, and the env var also reproduces a CI shard locally). Unknown/new
files weigh the median so they spread out; stale timings cost balance only,
never coverage (a unit test proves every spec lands in exactly one shard).

**8 shards**: repo is public, so runners are 4 vCPU and minutes are free. The
cost is the 20-concurrent-job account limit. Measured workers=2/3 on a 4-core
box (1.38x / 1.12x more) — sub-linear, so horizontal sharding stays the lever
and workers: 1 is unchanged.

**No build-unit gate on e2e**: it added ~2 min serial latency per run. The e2e
shards use the dev server, not the production build; staging's `promote`
still needs both jobs.

**Timing refresh**: CI adds a JSON reporter; staging-gate uploads each shard's
report; scripts/e2e-timings.mjs merges reports into the timings file (partial
reports only update the files they cover).
