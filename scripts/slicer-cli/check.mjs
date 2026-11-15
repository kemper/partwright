// `slicer-cli check` — validate ONE print job with the real slicer and print a
// single JSON report an agent can read without looking at pixels.
//
//   node scripts/slicer-cli.mjs check <file.3mf | model.js | model.scad> [options]
//   node scripts/slicer-cli.mjs check --current [options]
//
// For a `.3mf` it checks that file as-is. For a model file it first runs the
// code in the real app (the warm-browser daemon) and exports it through the
// app's own 3MF project exporter, so the file under test is exactly what a user
// would download. `--current` exports whatever session the daemon has open
// (set it up with `partwright call …` first): multi-object sessions, brush
// paint, anything code alone can't express.
//
// It then (1) reads the file with OUR 3MF reader, (2) asks the slicer for plate
// renders, (3) asks the slicer to slice it, and (4) compares the two views of
// the file. See scripts/slicer-cli/report.mjs for the checks.
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, extname, join, relative, resolve, sep } from 'node:path';
import { SLICER_VIEWS, buildChecks, parseViews, summarizeFile, summarizeSlicer } from './report.mjs';

const USAGE = `usage: node scripts/slicer-cli.mjs check <file.3mf | model.js | model.scad> [options]
       node scripts/slicer-cli.mjs check --current [options]
  --current               export the session open in the partwright daemon instead of a file
  --export-opts '<json>'  extra export3MFObjectsData options for a model/--current export (e.g. '{"plateLayout":"grid"}')
  --out <dir>             where renders, the slice and the log go (default: .partwright/slicer-check/<name>/).
                          Replaced on each run; a custom dir must be new, empty, or one this command made
  --views 0,1,2,3         plate-render cameras: ${Object.entries(SLICER_VIEWS).map(([n, v]) => `${n} ${v}`).join(', ')}
  --no-render             skip the plate renders
  --no-slice              skip slicing (load + render only)
  --printer <id>          printer profile for a model-file export (default p1s)
  --lang <language>       language of a model file (default: by extension)
  --expect-filaments N    fail unless exactly N filaments are used
  --expect-objects N      fail unless exactly N objects are sliced
  --expect-plates N       fail unless exactly N plates are sliced`;

function parseArgs(argv) {
  const a = { _: [], flags: new Set() };
  const valued = ['out', 'views', 'printer', 'lang', 'export-opts', 'expect-filaments', 'expect-objects', 'expect-plates'];
  const bare = ['no-render', 'no-slice', 'current', 'help'];
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (!t.startsWith('--')) { a._.push(t); continue; }
    const key = t.slice(2);
    if (bare.includes(key)) a.flags.add(key);
    else if (valued.includes(key)) {
      if (i + 1 >= argv.length) throw new Error(`--${key} needs a value`);
      a[key] = argv[++i];
    } else throw new Error(`unknown option ${t}`);
  }
  return a;
}

function expectNumber(a, key) {
  if (a[key] === undefined) return undefined;
  const n = Number(a[key]);
  if (!Number.isInteger(n) || n < 0) throw new Error(`--${key} expects a whole number, got "${a[key]}"`);
  return n;
}

const readJson = (file) => { try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; } };

/**
 * Export a Bambu-project 3MF from the real app (the warm-browser daemon) and
 * return its bytes. With `file`, runs that model in a fresh session first;
 * without, exports whatever session the daemon currently has open.
 */
async function exportFromApp({ file, lang, filename, opts }) {
  const { evalInPage, resetPage } = await import('../cli/client.mjs');
  // The daemon's page full-reloads whenever a source file changes, which is
  // exactly what an agent has just done before re-checking. For a model file,
  // start from a fresh page (so the export under test is the current source);
  // for --current, keep the open session and wait for the page to settle.
  if (file) await resetPage();
  let ready = false;
  for (let i = 0; i < 120 && !ready; i++) {
    const probe = await evalInPage('return typeof pw?.run === "function" && typeof pw?.export3MFObjectsData === "function";', {}).catch(() => null);
    ready = probe?.ok === true && probe.result === true;
    if (!ready) await new Promise((r) => setTimeout(r, 500));
  }
  if (!ready) throw new Error('could not export the model: the app did not become ready in the daemon (see .partwright/ logs)');
  const r = await evalInPage(`
    if (arg.code !== null) {
      await pw.createSession('slicer-check');
      await pw.setActiveLanguage(arg.lang);
      const run = await pw.runAndSave(arg.code, 'slicer-check');
      if (run && typeof run.error === 'string') return { error: run.error };
      if (run && run.passed === false) return { error: (run.failures || []).join('; ') || 'the model did not run' };
      if (run && run.geometry?.status === 'error') return { error: run.geometry.error || 'the model did not run' };
    }
    return await pw.export3MFObjectsData(undefined, arg.filename, arg.opts);
  `, { code: file ? readFileSync(file, 'utf8') : null, lang, filename, opts });
  if (!r.ok) throw new Error(`could not export the model: ${r.error}`);
  if (typeof r.result?.error === 'string') throw new Error(`could not export the model: ${r.result.error}`);
  if (typeof r.result?.base64 !== 'string') throw new Error('could not export the model: the app returned no file');
  return Buffer.from(r.result.base64, 'base64');
}

/** Read the 3MF with the app's own parser (loaded through Vite SSR, like model:preview). */
async function readWithOurParser(bytes, root) {
  const { createServer } = await import('vite');
  const server = await createServer({ root, configFile: false, server: { middlewareMode: true, watch: null }, appType: 'custom', logLevel: 'silent', optimizeDeps: { noDiscovery: true } });
  try {
    const mod = await server.ssrLoadModule('/src/import/parsers/threemf.ts');
    return summarizeFile(await mod.parse3MF(new Uint8Array(bytes)));
  } finally {
    await server.close();
  }
}

/** Tile the slicer's plate PNGs into one contact sheet. */
async function writeSheet(pngs, out) {
  const { default: sharp } = await import('sharp');
  const size = 512;
  const cols = Math.min(pngs.length, pngs.length <= 4 ? 2 : 3);
  const rows = Math.ceil(pngs.length / cols);
  await sharp({ create: { width: cols * size, height: rows * size, channels: 4, background: '#2b2f36' } })
    .composite(pngs.map((p, i) => ({ input: p, left: (i % cols) * size, top: Math.floor(i / cols) * size })))
    .png().toFile(out);
}

/** Marker file that says "`slicer-cli check` made this folder and may replace it". */
const MARKER = '.slicer-check';

const isInside = (child, parent) => {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !rel.startsWith(sep) && rel !== child);
};

/**
 * Decide the output folder and whether it is safe to replace. The folder is
 * wiped on every run, and this script is pre-approved for agents, so it must
 * never delete something it did not create. Returns `{ out }` or `{ error }`.
 */
function resolveOutDir({ custom, root, stem, input }) {
  const base = join(root, '.partwright', 'slicer-check');
  const out = resolve(custom ?? join(base, stem));
  // Never a folder that holds the input, the repo, the home dir or the filesystem root.
  for (const [what, path] of [['the input file', input], ['the repository', root], ['your home directory', homedir()], ['the filesystem root', resolve(sep)]]) {
    if (path && isInside(path, out)) return { error: `the output folder ${out} contains ${what}, and this command replaces its output folder on every run; pass --out <another folder>` };
  }
  const ownDefault = isInside(out, base) && out !== base;
  if (!ownDefault && existsSync(out)) {
    const entries = readdirSync(out);
    if (entries.length > 0 && !entries.includes(MARKER)) return { error: `the output folder ${out} exists and was not created by this command; pass --out with a new or empty folder` };
  }
  return { out };
}

/**
 * @param {string[]} argv arguments after `check`
 * @param {{ withSession: Function, notReady: () => Promise<string | null>, root: string }} deps
 *   the wrapper's slicer session, a "why can't the slicer run?" probe, and the repo root
 * @returns {Promise<number>} process exit code: 0 every check passed, 1 a check
 *   failed or the tool could not run (stdout still carries JSON), 2 bad arguments
 */
export async function runCheck(argv, { withSession, notReady, root }) {
  const usageError = (message) => { console.error(`slicer-cli check: ${message}`); return 2; };
  let a;
  try { a = parseArgs(argv); } catch (e) { console.error(`slicer-cli check: ${e.message}\n${USAGE}`); return 2; }
  const current = a.flags.has('current');
  if (a.flags.has('help') || a._.length !== (current ? 0 : 1)) { console.error(USAGE); return 2; }

  // ---- validate everything before touching the disk ----
  const input = current ? null : resolve(a._[0]);
  if (input && !existsSync(input)) return usageError(`no such file: ${input}`);
  const ext = input ? extname(input).toLowerCase() : '';
  const fromApp = ext !== '.3mf';
  const lang = !input ? null : a.lang ?? ({ '.js': 'manifold-js', '.scad': 'scad' })[ext];
  if (input && fromApp && !lang) return usageError(`can't tell the language of ${basename(input)}; pass --lang`);
  if (!fromApp) {
    const ignored = ['export-opts', 'printer', 'lang'].filter((k) => a[k] !== undefined);
    if (ignored.length > 0) return usageError(`${ignored.map((k) => `--${k}`).join(', ')} only apply when exporting a model or --current, not to an existing .3mf`);
  }
  let views, expect, exportOpts;
  try {
    const extra = a['export-opts'] ? JSON.parse(a['export-opts']) : {};
    if (extra === null || typeof extra !== 'object' || Array.isArray(extra)) throw new Error('--export-opts must be a JSON object');
    exportOpts = { bambu: true, printer: a.printer ?? 'p1s', ...extra };
    views = a.flags.has('no-render') ? [] : parseViews(a.views ?? '0,1,2,3');
    expect = { filaments: expectNumber(a, 'expect-filaments'), objects: expectNumber(a, 'expect-objects'), plates: expectNumber(a, 'expect-plates') };
  } catch (e) { return usageError(e.message); }
  const wantSlice = !a.flags.has('no-slice');
  if (views.length === 0 && !wantSlice) return usageError('--no-render with --no-slice leaves nothing to run');

  const stem = current ? 'current-session' : basename(input).replace(/\.[^.]+$/, '') || 'model';
  const where = resolveOutDir({ custom: a.out, root, stem, input });
  if (where.error) return usageError(where.error);
  const out = where.out;
  const shownInput = input ?? '(current daemon session)';
  const stop = (error, extra = {}) => { console.log(JSON.stringify({ ok: false, input: shownInput, ...extra, error }, null, 2)); return 1; };

  const blocked = await notReady();
  if (blocked) return stop(blocked);

  rmSync(out, { recursive: true, force: true });
  mkdirSync(join(out, 'slice'), { recursive: true });
  writeFileSync(join(out, MARKER), 'Created by `node scripts/slicer-cli.mjs check`; replaced on each run.\n');
  const log = join(out, 'slicer.log');

  // 1. The file under test.
  let threemf = input;
  if (fromApp) {
    try {
      threemf = join(out, `${stem}.3mf`);
      writeFileSync(threemf, await exportFromApp({ file: input, lang, filename: stem, opts: exportOpts }));
    } catch (e) {
      return stop(e.message);
    }
  }

  // 2. What our own reader sees in it.
  let file = null;
  let fileError = null;
  try { file = await readWithOurParser(readFileSync(threemf), root); } catch (e) { fileError = e.message; }

  // 3. What the real slicer makes of it. Each run's result.json is removed
  //    first, so a crashed run can never be read as the previous run's result.
  const runs = { load: null, loadExit: null, renderFailures: [], renderAttempted: views.length > 0, slice: null, sliceExit: null, sliceAttempted: false };
  const renders = [];
  try {
    await withSession(async ({ exec }) => {
      const resultFile = join(out, 'result.json');
      for (const view of views) {
        rmSync(resultFile, { force: true });
        const exit = await exec(['--debug', '2', '--export-png', '0', '--camera-view', String(view), '--outputdir', out, threemf], { log });
        const r = readJson(resultFile);
        if (runs.load === null) { runs.load = r; runs.loadExit = exit; }
        if (!r || r.return_code !== 0 || exit !== 0) {
          runs.renderFailures.push(`view ${SLICER_VIEWS[view]}: ${r ? `${r.error_string} (code ${r.return_code})` : 'the slicer wrote no result'}, exit ${exit}`);
          if (!r || r.return_code !== 0) break; // it did not load; more cameras won't help
        }
      }
      rmSync(resultFile, { force: true });
      for (const f of readdirSync(out).sort()) {
        const m = /^plate_(\d+)_(\d+)\.png$/.exec(f);
        if (m) renders.push({ plate: Number(m[1]), view: SLICER_VIEWS[m[2]] ?? m[2], png: join(out, f) });
      }
      const loaded = runs.load?.return_code === 0;
      if (wantSlice && (views.length === 0 || loaded)) {
        runs.sliceAttempted = true;
        runs.sliceExit = await exec(['--debug', '2', '--slice', '0', '--export-3mf', 'sliced.gcode.3mf', '--outputdir', join(out, 'slice'), threemf], { log });
        runs.slice = readJson(join(out, 'slice', 'result.json'));
        if (runs.load === null) { runs.load = runs.slice; runs.loadExit = runs.sliceExit; }
      }
    });
  } catch (e) {
    return stop(`could not run the slicer: ${e.message}`, { threemf });
  }
  if (runs.renderAttempted && runs.renderFailures.length === 0 && renders.length === 0) runs.renderFailures.push('the slicer reported success but wrote no plate image');

  const slicer = summarizeSlicer({ ...runs, sliceSkipped: !wantSlice });
  const { checks, warnings } = buildChecks(file, slicer, expect, { fileError });

  let sheet;
  if (renders.length > 0) {
    sheet = join(out, 'sheet.png');
    try { await writeSheet(renders.map((r) => r.png), sheet); } catch (e) { sheet = undefined; warnings.push(`could not build the contact sheet: ${e.message}`); }
  }

  const ok = checks.every((c) => c.ok);
  console.log(JSON.stringify({
    ok,
    input: shownInput,
    threemf,
    out,
    checks,
    warnings,
    file,
    slicer,
    renders: { ...(sheet ? { sheet } : {}), views: renders },
    log,
  }, null, 2));
  return ok ? 0 : 1;
}
