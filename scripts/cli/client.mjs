// Daemon client + lifecycle for the partwright CLI. Talks to the control server
// over 127.0.0.1 HTTP and manages start/stop/status. See docs/headless-cli.md.
import { spawn } from 'node:child_process';
import { openSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import {
  STATE_FILE, LOG_FILE, ensureStateDir, readState, writeState, clearState, isProcessAlive,
} from './paths.mjs';

const BIN = join(dirname(dirname(fileURLToPath(import.meta.url))), '..', 'bin', 'partwright.mjs');

async function http(controlPort, method, path, body) {
  const res = await fetch(`http://127.0.0.1:${controlPort}${path}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

export async function health(controlPort) {
  try { return await http(controlPort, 'GET', '/health'); } catch { return null; }
}

// Resolve a healthy running daemon, or null. Cleans up stale state files.
export async function findRunning() {
  const state = readState();
  if (!state) return null;
  if (!isProcessAlive(state.pid)) { clearState(); return null; }
  const h = await health(state.controlPort);
  if (h && h.ok) return state;
  return null;
}

function freePortPair() {
  // Deterministic-ish defaults; strictPort on the vite side will surface a
  // clash loudly rather than silently picking another port.
  const base = 5180 + Math.floor(Math.random() * 40);
  return { appPort: base, controlPort: base + 2000 };
}

export async function startDaemon({ appPort, controlPort, quiet } = {}) {
  const existing = await findRunning();
  if (existing) return existing;

  ensureStateDir();
  const ports = { appPort: appPort ?? freePortPair().appPort, controlPort: controlPort ?? freePortPair().controlPort };
  const log = openSync(LOG_FILE, 'a');
  const child = spawn(process.execPath, [
    BIN, '__daemon-run',
    '--app-port', String(ports.appPort),
    '--control-port', String(ports.controlPort),
  ], { detached: true, stdio: ['ignore', log, log] });
  child.unref();

  const state = { pid: child.pid, ...ports, startedAt: new Date().toISOString() };
  writeState(state);

  // Poll /health until the page reports window.partwright ready.
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const h = await health(ports.controlPort);
    if (h && h.ok && h.ready) { if (!quiet) console.error(`[partwright] daemon ready (pid ${child.pid}, app :${ports.appPort})`); return state; }
    if (!isProcessAlive(child.pid)) throw new Error(`daemon exited during startup — see ${LOG_FILE}`);
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`daemon did not become ready in 90s — see ${LOG_FILE}`);
}

export async function ensureDaemon() {
  return (await findRunning()) ?? (await startDaemon({ quiet: false }));
}

export async function stopDaemon() {
  const state = readState();
  if (!state) return { stopped: false, reason: 'no daemon state' };
  try { await http(state.controlPort, 'POST', '/shutdown'); } catch { /* fall through to kill */ }
  if (isProcessAlive(state.pid)) { try { process.kill(state.pid, 'SIGTERM'); } catch { /* gone */ } }
  clearState();
  return { stopped: true, pid: state.pid };
}

export async function statusDaemon() {
  const state = readState();
  if (!state) return { running: false };
  const alive = isProcessAlive(state.pid);
  const h = alive ? await health(state.controlPort) : null;
  return { running: !!(h && h.ok), pid: state.pid, appPort: state.appPort, controlPort: state.controlPort, startedAt: state.startedAt, stateFile: STATE_FILE };
}

// Call a window.partwright method via the daemon (auto-starting it if needed).
export async function rpc(method, args) {
  const state = await ensureDaemon();
  return http(state.controlPort, 'POST', '/rpc', { method, args });
}

// Run an async function body in the page via the daemon.
export async function evalInPage(body, arg) {
  const state = await ensureDaemon();
  return http(state.controlPort, 'POST', '/eval', { body, arg });
}

// Reload /editor in the page — resets in-page state between batch operations.
export async function resetPage() {
  const state = await ensureDaemon();
  return http(state.controlPort, 'POST', '/reset');
}
