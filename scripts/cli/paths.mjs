// Shared filesystem + Chromium-detection helpers for the partwright CLI daemon.
// State (pid/ports, logs, the persistent Chromium profile) lives under
// .partwright/ in the project root — gitignored. See docs/headless-cli.md.
import { existsSync, readdirSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

export const PROJECT_ROOT = process.cwd();
export const STATE_DIR = join(PROJECT_ROOT, '.partwright');
export const STATE_FILE = join(STATE_DIR, 'daemon.json');
export const LOG_FILE = join(STATE_DIR, 'daemon.log');
export const USER_DATA_DIR = join(STATE_DIR, 'chromium');

export function ensureStateDir() {
  if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true });
}

export function readState() {
  try { return JSON.parse(readFileSync(STATE_FILE, 'utf8')); } catch { return null; }
}
export function writeState(state) {
  ensureStateDir();
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + '\n');
}
export function clearState() {
  try { rmSync(STATE_FILE); } catch { /* already gone */ }
}

// Mirror playwright.config.ts's multi-env browser detection: prefer the sandbox
// prebuilt Chromium under /opt/pw-browsers, else let Playwright find its own
// cache (run `npx playwright install chromium` once on a fresh machine).
export function detectChromiumExecutable() {
  const sandboxRoot = '/opt/pw-browsers';
  if (!existsSync(sandboxRoot)) return undefined;
  const dirs = readdirSync(sandboxRoot)
    .filter((d) => /^chromium-\d+$/.test(d))
    .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]));
  for (const d of dirs) {
    const candidate = join(sandboxRoot, d, 'chrome-linux', 'chrome');
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

export function isProcessAlive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}
