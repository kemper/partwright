import { defineConfig, devices } from 'playwright/test';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { filesForShard, parseShardSpec } from './scripts/lib/e2eShard.mjs';

// Multi-env browser path detection. The Anthropic Claude Code on the web
// sandbox preinstalls Playwright browsers at /opt/pw-browsers/ — using a
// version (e.g. chromium-1194) that may not match the SDK pinned in
// package.json. On a developer laptop, browsers live under Playwright's
// default cache (~/.cache/ms-playwright on Linux, ~/Library/Caches on
// macOS) and the SDK + browser versions match.
//
// Strategy:
//   1. If /opt/pw-browsers exists, pick the highest chromium-* there and
//      use its `chrome` binary directly via launchOptions.executablePath.
//   2. Otherwise, leave executablePath unset and Playwright finds its own
//      cache. Run `npx playwright install chromium` once on a new machine.
function detectChromiumExecutable(): string | undefined {
  const sandboxRoot = '/opt/pw-browsers';
  if (!existsSync(sandboxRoot)) return undefined;
  const dirs = readdirSync(sandboxRoot)
    .filter(d => /^chromium-\d+$/.test(d))
    .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]));
  for (const d of dirs) {
    const candidate = join(sandboxRoot, d, 'chrome-linux', 'chrome');
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

const executablePath = detectChromiumExecutable();
if (executablePath) {
  // eslint-disable-next-line no-console
  console.info(`[playwright.config] Using sandbox browser at ${executablePath}`);
}

// Time-balanced sharding. CI sets E2E_SHARD=i/N and each job runs only the
// spec files scripts/lib/e2eShard.mjs assigns to shard i, weighted by the
// per-file durations in tests/e2e-timings.json. (Playwright's own --shard
// balances by test COUNT, which left one shard twice as slow as another.)
// Unset locally → the whole suite, exactly as before.
const shard = parseShardSpec(process.env.E2E_SHARD);
const shardFiles = shard ? filesForShard(shard.index, shard.total, fileURLToPath(new URL('./tests', import.meta.url))) : null;
if (shard) {
  // eslint-disable-next-line no-console
  console.info(`[playwright.config] E2E_SHARD ${shard.index}/${shard.total}: ${shardFiles!.length} spec files`);
}

export default defineConfig({
  testDir: './tests',
  // Only the browser e2e specs. Pure-logic *.test.ts files under tests/unit/
  // belong to the fast vitest runner (see vitest.config.ts) — keep them out.
  testMatch: shardFiles ? shardFiles.map(f => `**/tests/${f}`) : '**/*.spec.ts',
  // Run serially on any single machine. Each test boots WASM in its own page,
  // which is CPU-heavy; running pages concurrently on one box starves the
  // renderer and produces 30s timeout flakes. We get parallelism instead by
  // SHARDING across CI jobs (see staging-gate.yml: --shard=i/N), so every
  // shard is itself serial and contention-free while wall-clock time still
  // drops ~N×. Don't raise `workers` here without re-validating flake rates.
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  // CI also writes a JSON report per shard; the staging gate uploads it so
  // tests/e2e-timings.json can be refreshed (scripts/e2e-timings.mjs).
  reporter: process.env.CI
    ? [['list'], ['json', { outputFile: 'playwright-report/e2e-report.json' }]]
    : [['list']],
  timeout: 30_000,
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
    // Default Desktop Chrome (1280x720) clips the bottom of the AI panel
    // (toggle strip + input row land below the fold), making low-pill
    // clicks fail. 900px gives comfortable headroom on every test.
    viewport: { width: 1280, height: 900 },
    launchOptions: {
      ...(executablePath ? { executablePath } : {}),
      // The sandbox's chrome binary needs --no-sandbox; harmless on a laptop.
      args: ['--no-sandbox'],
    },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
