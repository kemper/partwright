#!/usr/bin/env node
// slicer-cli — run the reference slicer's own command line (Bambu Studio) as an
// EXTERNAL tool, for checking that a 3MF we export loads, slices and renders
// the way the real consumer sees it.
//
//   node scripts/slicer-cli.mjs status              # JSON: what is installed (runs nothing)
//   node scripts/slicer-cli.mjs fetch               # download + hash-check the pinned build (runs nothing)
//   node scripts/slicer-cli.mjs install             # fetch, then unpack the app bundle
//   node scripts/slicer-cli.mjs run -- <slicer args>   # e.g. run -- --export-png 0 --outputdir out model.3mf
//
// Why a wrapper instead of calling the binary directly:
//   - It only ever executes ONE build: the release asset pinned below, checked
//     against its SHA-256 before it is unpacked and again before every run. The
//     `.claude/settings.json` allow rule names this script, so the rule can't be
//     used to run some other downloaded file.
//   - Nothing from the slicer is committed or bundled. The build is downloaded
//     into the gitignored `.partwright/slicer/` on demand and executed as a
//     separate process. It is AGPL-3.0; we run it unmodified and link nothing.
//
// The CLI is not the desktop app: it loads projects through a different path
// than the GUI, so a clean run here does not prove the GUI opens the file.
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

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
/** Records which bundle hash `squashfs-root` was unpacked from. */
const MARKER = join(DIR, 'unpacked.sha256');

function fail(message) {
  console.error(`slicer-cli: ${message}`);
  process.exit(1);
}

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

async function install() {
  await fetchBundle();
  if (unpackedMatches()) return;
  rmSync(UNPACKED, { recursive: true, force: true });
  rmSync(MARKER, { force: true });
  // Self-extraction: no FUSE needed, which containers usually lack.
  const ex = spawnSync(BUNDLE, ['--appimage-extract'], { cwd: DIR, stdio: ['ignore', 'ignore', 'inherit'] });
  if (ex.status !== 0 || !existsSync(LAUNCHER)) fail(`could not unpack the app bundle (exit ${ex.status})`);
  writeFileSync(MARKER, `${PINNED.sha256}\n`);
}

async function run(args) {
  if (!(await bundleMatches()) || !unpackedMatches()) await install();
  // The CLI opens an offscreen GL context; give it a virtual display when one exists.
  const hasXvfb = spawnSync('sh', ['-c', 'command -v xvfb-run'], { stdio: 'ignore' }).status === 0;
  const [cmd, cmdArgs] = hasXvfb ? ['xvfb-run', ['-a', LAUNCHER, ...args]] : [LAUNCHER, args];
  const r = spawnSync(cmd, cmdArgs, { stdio: 'inherit' });
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
  }, null, 2));
}

const [command, ...rest] = process.argv.slice(2);
if (command === 'status') await status();
else if (command === 'fetch') await fetchBundle();
else if (command === 'install') await install();
else if (command === 'run') await run(rest[0] === '--' ? rest.slice(1) : rest);
else {
  console.error('usage: node scripts/slicer-cli.mjs status | fetch | install | run -- <slicer args>');
  process.exit(2);
}
