#!/usr/bin/env node
// slicer-cli — run the reference slicer's own command line (Bambu Studio) as an
// EXTERNAL tool, for checking that a 3MF we export loads, slices and renders
// the way the real consumer sees it.
//
//   node scripts/slicer-cli.mjs status                 # JSON: what is installed (runs nothing)
//   node scripts/slicer-cli.mjs fetch                  # download + hash-check the pinned build (runs nothing)
//   node scripts/slicer-cli.mjs install [--apt]        # fetch, unpack, check system packages
//   node scripts/slicer-cli.mjs check <file.3mf | model.js>   # THE AGENT COMMAND: renders + slice + one JSON report
//   node scripts/slicer-cli.mjs run -- <slicer args>   # raw slicer CLI, see the two recipes below
//
// `check` (scripts/slicer-cli/check.mjs) is what agents should reach for: it
// exports a model through the real app when given code, reads the file with our
// own 3MF reader, asks the slicer for plate renders and a slice, compares the
// two, and exits non-zero when a check fails. `check --help` lists its options.
//
// Raw recipes (each takes a few seconds on a small model):
//   plate render   run -- --export-png 0 --camera-view 0 --outputdir <dir> model.3mf
//                  → <dir>/plate_<n>_<view>.png, 512x512, painted filament colours included.
//                  Views: 0 iso, 1 top-front, 2 left, 3 right, 10/11/12 other isos.
//   real slice     run -- --slice 0 --export-3mf sliced.gcode.3mf --outputdir <dir> model.3mf
//                  → <dir>/result.json (per-filament grams, filament changes, print time,
//                  object bounding boxes) plus the G-code.
//
// Why a wrapper instead of calling the binary directly:
//   - It only ever executes ONE build: the release asset pinned below. The
//     download is checked against its SHA-256 before it is unpacked, and the
//     two files that are actually launched (the launcher script and the main
//     binary) are re-hashed before every run. The rest of the unpacked tree
//     (bundled libraries, resources) is trusted like the working tree. The
//     `.claude/settings.json` allow rule names this script, so the rule can't
//     be used to run some other downloaded file.
//   - Nothing from the slicer is committed or distributed. The build is
//     downloaded into the gitignored `.partwright/slicer/` on demand and
//     executed, unmodified, as a separate process (it is AGPL-3.0). At run
//     time a small shim of our own is preloaded into that process locally.
//   - The CLI needs a graphics context even headless. This build's windowing
//     layer is Wayland-only (an X server such as xvfb does not help), and its GL
//     loader insists on GLX. So `run` starts a throwaway headless compositor
//     (weston) and preloads a small shim (scripts/slicer-cli/glx-osmesa-shim.c,
//     compiled fresh for each run) that answers those GLX calls from software
//     GL (OSMesa).
//
// The CLI is not the desktop app: it loads projects through a different path
// than the GUI, so a clean run here does not prove the GUI opens the file.
import { createHash } from 'node:crypto';
import { closeSync, createReadStream, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, renameSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

/** The one build this script will run. Bump all three together. */
const PINNED = {
  version: 'v02.09.01.70',
  asset: 'BambuStudio_ubu24-v02.09.01.70-20261103183404.AppImage',
  sha256: '668dabb1be53c758189ed6bc89935285dea5e0af46216546b1bafd6882e9aff0',
  /** The unpacked files `run` launches, relative to the unpacked root. */
  files: {
    'AppRun': 'eaf5a1c6ff4f0d49d6e0c0bacf106309daa2c822ca1ebe8739067699e6cdaef4',
    'bin/bambu-studio': 'bb906b566bc99d743da964ad0d66a4828a4df97615a59b4ecfce128220b5c7c3',
  },
};
const DOWNLOAD_URL = `https://github.com/bambulab/BambuStudio/releases/download/${PINNED.version}/${PINNED.asset}`;

const DIR = join(ROOT, '.partwright', 'slicer');
const BUNDLE = join(DIR, PINNED.asset);
const UNPACKED = join(DIR, 'squashfs-root');
const LAUNCHER = join(UNPACKED, 'AppRun');
const BINARY = join(UNPACKED, 'bin', 'bambu-studio');
/** Records which bundle hash `squashfs-root` was unpacked from. */
const MARKER = join(DIR, 'unpacked.sha256');
const SHIM_SOURCE = join(HERE, 'slicer-cli', 'glx-osmesa-shim.c');

/** Shared libraries the build needs that a bare container may lack → Ubuntu package. */
const LIB_PACKAGES = {
  'libwebkit2gtk-4.1.so.0': 'libwebkit2gtk-4.1-0',
  'libjavascriptcoregtk-4.1.so.0': 'libwebkit2gtk-4.1-0',
  'libwayland-server.so.0': 'libwayland-server0',
};

function fail(message) {
  console.error(`slicer-cli: ${message}`);
  process.exit(1);
}

const hasCommand = (name) => spawnSync('sh', ['-c', 'command -v "$1"', 'sh', name], { stdio: 'ignore' }).status === 0;

function sha256(file) {
  return new Promise((ok, bad) => {
    const h = createHash('sha256');
    createReadStream(file).on('data', (d) => h.update(d)).on('end', () => ok(h.digest('hex'))).on('error', bad);
  });
}

async function bundleMatches() {
  return existsSync(BUNDLE) && (await sha256(BUNDLE)) === PINNED.sha256;
}

/** The unpacked tree came from the pinned bundle AND the files we launch are unmodified. */
async function unpackedMatches() {
  if (!existsSync(MARKER) || readFileSync(MARKER, 'utf8').trim() !== PINNED.sha256) return false;
  for (const [rel, want] of Object.entries(PINNED.files)) {
    const file = join(UNPACKED, rel);
    if (!existsSync(file) || (await sha256(file)) !== want) return false;
  }
  return true;
}

/** Path of the software GL library, or null when it isn't installed. */
function osmesaPath() {
  // Non-root shells on Debian often lack /sbin on PATH.
  const ldconfig = hasCommand('ldconfig') ? 'ldconfig' : '/sbin/ldconfig';
  const r = spawnSync(ldconfig, ['-p'], { encoding: 'utf8' });
  const lines = (r.stdout ?? '').split('\n').filter((l) => /libOSMesa\.so\.\d+ /.test(l));
  // On a multiarch host, take the library that matches this process.
  const line = (process.arch === 'x64' ? lines.find((l) => l.includes('x86-64')) : undefined) ?? lines[0];
  const m = line ? /=> (\S+)/.exec(line) : null;
  return m ? m[1] : null;
}

/** `ldd` output for the slicer binary, resolved the way its launcher resolves it. */
function lddOutput() {
  if (!existsSync(BINARY)) return '';
  const ldd = spawnSync('ldd', [BINARY], { encoding: 'utf8', env: { ...process.env, LD_LIBRARY_PATH: join(UNPACKED, 'bin') } });
  return `${ldd.stdout ?? ''}\n${ldd.stderr ?? ''}`;
}

/** Ubuntu packages still needed before the slicer can start and render. */
function missingPackages() {
  const packages = new Set();
  for (const m of lddOutput().matchAll(/^\s*(\S+) => not found/gm)) packages.add(LIB_PACKAGES[m[1]] ?? `(unknown package providing ${m[1]})`);
  if (!hasCommand('weston')) packages.add('weston');
  if (!osmesaPath()) packages.add('libosmesa6');
  if (!hasCommand('gcc')) packages.add('gcc');
  return [...packages];
}

async function fetchBundle() {
  if (await bundleMatches()) return;
  mkdirSync(DIR, { recursive: true });
  const partial = `${BUNDLE}.partial`;
  console.error(`slicer-cli: downloading ${PINNED.asset} …`);
  // curl, not Node's fetch: it follows the session's proxy settings.
  const dl = spawnSync('curl', ['-fsSL', '--retry', '3', '--retry-delay', '5', '-o', partial, DOWNLOAD_URL], { stdio: 'inherit' });
  if (dl.status !== 0) { rmSync(partial, { force: true }); fail(`download failed (curl exit ${dl.status})`); }
  const got = await sha256(partial);
  if (got !== PINNED.sha256) {
    rmSync(partial, { force: true });
    fail(`hash mismatch for ${PINNED.asset}: expected ${PINNED.sha256}, got ${got}. Not installing.`);
  }
  renameSync(partial, BUNDLE);
  chmodSync(BUNDLE, 0o755);
}

/** Compile the GL shim into `dir` and return its path, or null on failure. */
function buildShim(dir, osmesa) {
  const out = join(dir, 'glx-osmesa-shim.so');
  const cc = spawnSync('gcc', ['-shared', '-fPIC', '-O2', '-o', out, SHIM_SOURCE, osmesa, '-ldl'], { stdio: 'inherit' });
  return cc.status === 0 ? out : null;
}

async function install({ apt = false } = {}) {
  await fetchBundle();
  if (!(await unpackedMatches())) {
    rmSync(UNPACKED, { recursive: true, force: true });
    rmSync(MARKER, { force: true });
    // Self-extraction: no FUSE needed, which containers usually lack.
    const ex = spawnSync(BUNDLE, ['--appimage-extract'], { cwd: DIR, stdio: ['ignore', 'ignore', 'inherit'] });
    if (ex.status !== 0 || !existsSync(LAUNCHER)) fail(`could not unpack the app bundle (exit ${ex.status})`);
    writeFileSync(MARKER, `${PINNED.sha256}\n`);
    if (!(await unpackedMatches())) fail('the unpacked files do not match the pinned hashes. Not running them.');
  }
  // A too-old C library shows up as a version error, not a missing file.
  const tooOld = /version `(GLIBC\w*_[\d.]+)' not found/.exec(lddOutput());
  if (tooOld) fail(`this system's C library is too old for the pinned build (it needs ${tooOld[1]}); use an Ubuntu 24.04-class system.`);
  let missing = missingPackages();
  const installable = missing.filter((p) => !p.startsWith('('));
  if (installable.length > 0 && apt) {
    if (!hasCommand('apt-get')) fail('--apt needs apt-get (Ubuntu/Debian). Install these another way: ' + installable.join(' '));
    if (process.getuid?.() !== 0) fail('--apt must run as root. Missing packages: ' + installable.join(' '));
    console.error(`slicer-cli: installing ${installable.join(' ')} …`);
    const aptEnv = { ...process.env, DEBIAN_FRONTEND: 'noninteractive' };
    const up = spawnSync('apt-get', ['update', '-qq'], { stdio: 'inherit', env: aptEnv });
    if (up.status !== 0) console.error(`slicer-cli: apt-get update failed (exit ${up.status}); trying the install anyway`);
    const r = spawnSync('apt-get', ['install', '-y', '-qq', '--no-install-recommends', ...installable], { stdio: 'inherit', env: aptEnv });
    if (r.status !== 0) fail(`apt-get install failed (exit ${r.status})`);
    missing = missingPackages();
  }
  if (missing.length > 0) fail(`missing system packages: ${missing.join(' ')}\n  re-run with: node scripts/slicer-cli.mjs install --apt   (Ubuntu/Debian, as root)`);
}

/** A short private temp dir for one run (compositor socket + shim). */
function makeRunDir() {
  // Unix socket paths are capped at ~108 bytes, so keep the runtime dir short.
  const base = tmpdir().length < 40 ? tmpdir() : '/tmp';
  const dir = mkdtempSync(join(base, 'pw-wl-'));
  chmodSync(dir, 0o700);
  return dir;
}

/** Start a headless Wayland compositor on a private socket in `runtimeDir`. */
async function startCompositor(runtimeDir) {
  const socket = 'wl-0';
  const child = spawn('weston', ['--backend=headless', `--socket=${socket}`, '--idle-time=0'], {
    stdio: 'ignore', env: { ...process.env, XDG_RUNTIME_DIR: runtimeDir },
  });
  let failed = false;
  child.on('error', () => { failed = true; });
  for (let i = 0; i < 50; i++) {
    if (existsSync(join(runtimeDir, socket))) return { socket, child };
    if (failed || child.exitCode !== null || child.signalCode !== null) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  child.kill();
  return null;
}

/**
 * Set up one slicer session and hand `fn` an `exec(args, { log })` that runs
 * the slicer once (several calls share the compositor and shim). `log` sends
 * the slicer's output to a file instead of this process's stdio. Verifies the
 * launched files first and cleans up on every path, including an interrupt.
 */
async function withSession(fn) {
  if (!(await unpackedMatches()) || missingPackages().length > 0) await install();
  const osmesa = osmesaPath();
  const runDir = makeRunDir();
  let compositor = null;
  let slicer = null;
  const cleanup = () => {
    compositor?.child.kill();
    rmSync(runDir, { recursive: true, force: true });
  };
  // Interrupted (Ctrl-C, a harness timeout, a closed terminal): pass the signal
  // on to the slicer, stop the compositor and remove the temp dir before exiting.
  const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'].map((sig) => [sig, () => { slicer?.kill(sig); cleanup(); process.exit(1); }]);
  for (const [sig, handler] of signals) process.on(sig, handler);
  try {
    const shim = buildShim(runDir, osmesa);
    if (!shim) throw new Error('could not build the GL shim (gcc failed)');
    compositor = await startCompositor(runDir);
    if (!compositor) throw new Error('the headless compositor (weston) did not start');
    const preload = [shim, osmesa, process.env.LD_PRELOAD].filter(Boolean).join(' ');
    const env = { ...process.env, XDG_RUNTIME_DIR: runDir, WAYLAND_DISPLAY: compositor.socket, LD_PRELOAD: preload };
    const exec = (args, { log } = {}) => new Promise((done, bad) => {
      const fd = log ? openSync(log, 'a') : null;
      // Node can emit both 'error' and 'exit' for one child: settle once.
      let settled = false;
      const finish = () => {
        if (settled) return false;
        settled = true;
        if (fd !== null) closeSync(fd);
        slicer = null;
        return true;
      };
      try {
        slicer = spawn(LAUNCHER, args, { stdio: fd !== null ? ['ignore', fd, fd] : 'inherit', env });
      } catch (e) {
        finish();
        bad(e);
        return;
      }
      slicer.on('error', (e) => { if (finish()) bad(e); });
      slicer.on('exit', (status, signal) => { if (finish()) done(status ?? (signal ? 1 : 0)); });
    });
    return await fn({ exec });
  } finally {
    for (const [sig, handler] of signals) process.off(sig, handler);
    cleanup();
  }
}

async function run(args) {
  let code;
  try { code = await withSession(({ exec }) => exec(args)); } catch (e) { fail(e instanceof Error ? e.message : String(e)); }
  process.exit(code);
}

async function check(args) {
  const { runCheck } = await import('./slicer-cli/check.mjs');
  // `check` never installs anything by itself: it reports what is missing as JSON.
  const notReady = async () => {
    if (!(await unpackedMatches())) return 'the slicer is not installed (or its files changed). Run: node scripts/slicer-cli.mjs install --apt';
    const missing = missingPackages();
    return missing.length > 0 ? `missing system packages: ${missing.join(' ')}. Run: node scripts/slicer-cli.mjs install --apt` : null;
  };
  process.exit(await runCheck(args, { withSession, notReady, root: ROOT }));
}

async function status() {
  console.log(JSON.stringify({
    version: PINNED.version,
    asset: PINNED.asset,
    dir: DIR,
    downloaded: existsSync(BUNDLE),
    hashOk: await bundleMatches(),
    unpacked: await unpackedMatches(),
    missingPackages: missingPackages(),
  }, null, 2));
}

const [command, ...rest] = process.argv.slice(2);
if (command === 'status') await status();
else if (command === 'fetch') await fetchBundle();
else if (command === 'install') await install({ apt: rest.includes('--apt') });
else if (command === 'run') await run(rest[0] === '--' ? rest.slice(1) : rest);
else if (command === 'check') await check(rest);
else {
  console.error('usage: node scripts/slicer-cli.mjs status | fetch | install [--apt] | check <file.3mf|model.js> [options] | run -- <slicer args>');
  process.exit(2);
}
