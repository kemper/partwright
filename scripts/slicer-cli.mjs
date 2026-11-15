#!/usr/bin/env node
// slicer-cli — run the reference slicer's own command line (Bambu Studio) as an
// EXTERNAL tool, for checking that a 3MF we export loads, slices and renders
// the way the real consumer sees it.
//
//   node scripts/slicer-cli.mjs status                 # JSON: what is installed (runs nothing)
//   node scripts/slicer-cli.mjs fetch                  # download + hash-check the pinned build (runs nothing)
//   node scripts/slicer-cli.mjs install [--apt]        # fetch, unpack, check system packages, build the GL shim
//   node scripts/slicer-cli.mjs run -- <slicer args>   # see the two recipes below
//
// Recipes (both take ~1-2 s on a small model):
//   plate render   run -- --export-png 0 --camera-view 0 --outputdir <dir> model.3mf
//                  → <dir>/plate_<n>_<view>.png, 512x512, painted filament colours included.
//                  Views: 0 iso, 1 top-front, 2 left, 3 right, 10/11/12 other isos.
//   real slice     run -- --slice 0 --export-3mf sliced.gcode.3mf --outputdir <dir> model.3mf
//                  → <dir>/result.json (per-filament grams, filament changes, print time,
//                  object bounding boxes) plus the G-code.
//
// Why a wrapper instead of calling the binary directly:
//   - It only ever executes ONE build: the release asset pinned below, checked
//     against its SHA-256 before it is unpacked and again before every run. The
//     `.claude/settings.json` allow rule names this script, so the rule can't be
//     used to run some other downloaded file.
//   - Nothing from the slicer is committed or bundled. The build is downloaded
//     into the gitignored `.partwright/slicer/` on demand and executed as a
//     separate process. It is AGPL-3.0; we run it unmodified and link nothing.
//   - The CLI needs a graphics context even headless. This build's windowing
//     layer is Wayland-only (an X server such as xvfb does not help), and its GL
//     loader insists on GLX. So `run` starts a throwaway headless compositor
//     (weston) and preloads a small shim (scripts/slicer-cli/glx-osmesa-shim.c)
//     that answers those GLX calls from software GL (OSMesa).
//
// The CLI is not the desktop app: it loads projects through a different path
// than the GUI, so a clean run here does not prove the GUI opens the file.
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
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
const SHIM = join(DIR, 'glx-osmesa-shim.so');

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

const hasCommand = (name) => spawnSync('sh', ['-c', `command -v ${name}`], { stdio: 'ignore' }).status === 0;

function sha256(file) {
  return new Promise((ok, bad) => {
    const h = createHash('sha256');
    createReadStream(file).on('data', (d) => h.update(d)).on('end', () => ok(h.digest('hex'))).on('error', bad);
  });
}

async function bundleMatches() {
  return existsSync(BUNDLE) && (await sha256(BUNDLE)) === PINNED.sha256;
}

function unpackedMatches() {
  return existsSync(LAUNCHER) && existsSync(MARKER) && readFileSync(MARKER, 'utf8').trim() === PINNED.sha256;
}

/** Path of the software GL library, or null when it isn't installed. */
function osmesaPath() {
  const r = spawnSync('ldconfig', ['-p'], { encoding: 'utf8' });
  const m = /libOSMesa\.so\.\d+ .*=> (\S+)/.exec(r.stdout ?? '');
  return m ? m[1] : null;
}

/** Ubuntu packages still needed before the slicer can start and render. */
function missingPackages() {
  const packages = new Set();
  if (existsSync(BINARY)) {
    const ldd = spawnSync('ldd', [BINARY], { encoding: 'utf8', env: { ...process.env, LD_LIBRARY_PATH: join(UNPACKED, 'bin') } });
    for (const m of (ldd.stdout ?? '').matchAll(/^\s*(\S+) => not found/gm)) packages.add(LIB_PACKAGES[m[1]] ?? `(unknown package providing ${m[1]})`);
  }
  if (!hasCommand('weston')) packages.add('weston');
  if (!osmesaPath()) packages.add('libosmesa6');
  if (!existsSync(SHIM) && !hasCommand('gcc')) packages.add('gcc');
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

function buildShim() {
  if (existsSync(SHIM)) return;
  const osmesa = osmesaPath();
  if (!osmesa) fail('software GL (libosmesa6) is not installed');
  const cc = spawnSync('gcc', ['-shared', '-fPIC', '-O2', '-o', SHIM, SHIM_SOURCE, osmesa, '-ldl'], { stdio: 'inherit' });
  if (cc.status !== 0) fail(`could not build the GL shim (gcc exit ${cc.status})`);
}

async function install({ apt = false } = {}) {
  await fetchBundle();
  if (!unpackedMatches()) {
    rmSync(UNPACKED, { recursive: true, force: true });
    rmSync(MARKER, { force: true });
    // Self-extraction: no FUSE needed, which containers usually lack.
    const ex = spawnSync(BUNDLE, ['--appimage-extract'], { cwd: DIR, stdio: ['ignore', 'ignore', 'inherit'] });
    if (ex.status !== 0 || !existsSync(LAUNCHER)) fail(`could not unpack the app bundle (exit ${ex.status})`);
    writeFileSync(MARKER, `${PINNED.sha256}\n`);
  }
  let missing = missingPackages();
  if (missing.length > 0 && apt) {
    const installable = missing.filter((p) => !p.startsWith('('));
    console.error(`slicer-cli: installing ${installable.join(' ')} …`);
    spawnSync('apt-get', ['update', '-qq'], { stdio: 'inherit' });
    const r = spawnSync('apt-get', ['install', '-y', '-qq', '--no-install-recommends', ...installable], { stdio: 'inherit', env: { ...process.env, DEBIAN_FRONTEND: 'noninteractive' } });
    if (r.status !== 0) fail(`apt-get install failed (exit ${r.status})`);
    missing = missingPackages();
  }
  if (missing.length > 0) fail(`missing system packages: ${missing.join(' ')}\n  re-run with: node scripts/slicer-cli.mjs install --apt   (Ubuntu/Debian, as root)`);
  buildShim();
}

/** Start a headless Wayland compositor on a private socket. */
async function startCompositor() {
  // Unix socket paths are capped at ~108 bytes, so keep the runtime dir short.
  const base = tmpdir().length < 40 ? tmpdir() : '/tmp';
  const runtimeDir = mkdtempSync(join(base, 'pw-wl-'));
  chmodSync(runtimeDir, 0o700);
  const socket = 'wl-0';
  const child = spawn('weston', ['--backend=headless', `--socket=${socket}`, '--idle-time=0'], {
    stdio: 'ignore', env: { ...process.env, XDG_RUNTIME_DIR: runtimeDir },
  });
  const stop = () => { child.kill(); rmSync(runtimeDir, { recursive: true, force: true }); };
  for (let i = 0; i < 50; i++) {
    if (existsSync(join(runtimeDir, socket))) return { runtimeDir, socket, stop };
    if (child.exitCode !== null) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  stop();
  fail('the headless compositor (weston) did not start');
}

async function run(args) {
  if (!(await bundleMatches()) || !unpackedMatches() || !existsSync(SHIM) || missingPackages().length > 0) await install();
  const compositor = await startCompositor();
  const preload = [SHIM, osmesaPath(), process.env.LD_PRELOAD].filter(Boolean).join(' ');
  const r = spawnSync(LAUNCHER, args, {
    stdio: 'inherit',
    env: { ...process.env, XDG_RUNTIME_DIR: compositor.runtimeDir, WAYLAND_DISPLAY: compositor.socket, LD_PRELOAD: preload },
  });
  compositor.stop();
  if (r.error) fail(`could not start the slicer: ${r.error.message}`);
  process.exit(r.status ?? 1);
}

async function status() {
  console.log(JSON.stringify({
    version: PINNED.version,
    asset: PINNED.asset,
    dir: DIR,
    downloaded: existsSync(BUNDLE),
    hashOk: await bundleMatches(),
    unpacked: unpackedMatches(),
    shimBuilt: existsSync(SHIM),
    missingPackages: missingPackages(),
  }, null, 2));
}

const [command, ...rest] = process.argv.slice(2);
if (command === 'status') await status();
else if (command === 'fetch') await fetchBundle();
else if (command === 'install') await install({ apt: rest.includes('--apt') });
else if (command === 'run') await run(rest[0] === '--' ? rest.slice(1) : rest);
else {
  console.error('usage: node scripts/slicer-cli.mjs status | fetch | install [--apt] | run -- <slicer args>');
  process.exit(2);
}
