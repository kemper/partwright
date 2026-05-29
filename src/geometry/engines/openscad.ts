import type { Engine, MeshData, MeshResult, SourceDiagnostic, ValidateResult } from './types';
import { parseBinarySTLToMeshGL } from './scadToManifold';
import { parseAmfObjects } from './amfParser';
import { scanScadLabels } from './scadLabels';
import { getManifoldModule, manifoldJsEngine } from './manifoldJs';
import { scadDiagnostics } from '../sourceDiagnostics';
import { ensureBosl2InMemfs, sourceUsesBosl2 } from '../bosl2Loader';
import { getDefaultCircularSegments } from '../qualitySettings';
import { parseScadParams, buildScadDefines } from '../scadParams';

/** Tiny passthrough module pre-injected into every SCAD compile so user code
 *  can write `label("name") <expr>;` without breaking. Duplicate declarations
 *  are silent in OpenSCAD, so this is safe even if the user includes their
 *  own copy (e.g. when sharing the file across editors). */
const LABEL_MODULE_PREFIX = 'module label(name) { children(); }\n';

/** Line count of {@link LABEL_MODULE_PREFIX}. OpenSCAD's stderr reports line
 *  numbers against the file it actually compiled, so we subtract this from
 *  every "line N" reference before handing the message to scadDiagnostics. */
const LABEL_PREFIX_LINES = 1;

/** Rewrite "line N" references in an OpenSCAD stderr blob so they line up
 *  with the user's source instead of the prefixed version we fed the WASM. */
function shiftErrorLines(text: string): string {
  return text.replace(/\bline\s+(\d+)/gi, (_match, n) => {
    const shifted = Math.max(1, Number(n) - LABEL_PREFIX_LINES);
    return `line ${shifted}`;
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CreateOpenSCAD = (opts: any) => Promise<any>;

/** Cached factory function — loaded once, reused to create fresh instances per run. */
let createFn: CreateOpenSCAD | null = null;
let initPromise: Promise<void> | null = null;

function formatStderr(lines: string[]): string {
  const filtered = lines.filter(Boolean);
  if (filtered.length === 0) return 'OpenSCAD produced no error output.';
  // Pull ERROR/WARNING lines to the top for readability.
  const errors = filtered.filter(l => /^ERROR/i.test(l));
  const warnings = filtered.filter(l => /^WARNING/i.test(l));
  const other = filtered.filter(l => !/^ERROR|^WARNING/i.test(l));
  return [...errors, ...warnings, ...other].join('\n');
}

/** Create a fresh OpenSCAD WASM instance. Each callMain() can only be called
 *  once per Emscripten instantiation, so we create a new one for every run. */
async function createInstance(): Promise<{ instance: any; stderr: string[]; stdout: string[] }> {
  if (!createFn) throw new Error('OpenSCAD factory not loaded — call init() first');
  const stderr: string[] = [];
  const stdout: string[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const wrapper = await createFn({
    noInitialRun: true,
    print: (s: string) => { stdout.push(s); },
    printErr: (s: string) => { stderr.push(s); },
  });
  const instance = wrapper.getInstance();
  return { instance, stderr, stdout };
}

async function doInit(): Promise<void> {
  if (createFn) return;
  // Ensure manifold-3d is loaded too — we need it to round-trip SCAD output
  // into a Manifold handle so downstream APIs (slice, genus, etc.) work.
  if (!manifoldJsEngine.isReady()) {
    await manifoldJsEngine.init();
  }
  const mod = await import('openscad-wasm-prebuilt');
  // The package exports { createOpenSCAD } plus a default; use createOpenSCAD.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const factory = (mod as any).createOpenSCAD ?? (mod as any).default?.createOpenSCAD;
  if (typeof factory !== 'function') {
    throw new Error('openscad-wasm-prebuilt: createOpenSCAD export not found');
  }
  createFn = factory;
}

export const openscadEngine: Engine = {
  id: 'scad',

  async init() {
    if (createFn) return;
    if (initPromise) return initPromise;
    initPromise = doInit().catch((err) => {
      initPromise = null;
      throw err;
    });
    return initPromise;
  },

  isReady() {
    return createFn !== null;
  },

  run(_source: string): MeshResult {
    // run() is sync in the Engine interface, but we need an async instance creation.
    // The workaround: use a synchronous wrapper that throws if not init'd,
    // and actually perform the async instance creation inside the sync shell.
    // Since the caller (engine.ts dispatcher) checks isReady() first, and
    // init() is always called before run(), this is safe.
    //
    // However, Emscripten's callMain is itself synchronous once the instance exists.
    // The problem is that createInstance() is async (awaits WASM instantiation).
    //
    // We solve this by making run() create the instance synchronously using
    // WebAssembly.Module that was already compiled and cached by Emscripten.
    // Unfortunately this isn't possible with the prebuilt package.
    //
    // Real fix: make the Engine.run() interface async, or use a pre-warmed instance pool.
    // For now, we use a blocking pattern via the executeCode path in engine.ts
    // which already handles the async init separately.

    // This should not be reached — use runAsync() instead via the dispatcher.
    return {
      mesh: null,
      manifold: null,
      error: 'OpenSCAD requires async execution. Use the async API path.',
    };
  },

  validate(_source: string): ValidateResult {
    // Validation also needs a fresh instance — can't be sync.
    return { valid: false, error: 'OpenSCAD validation requires async execution.' };
  },
};

/** Async run — creates a fresh WASM instance, compiles SCAD, parses STL or
 *  multi-object AMF (when `label()` is used to mark paintable regions), and
 *  round-trips through Manifold.ofMesh().
 *
 *  Customizer: top-level variables annotated in the OpenSCAD customizer style
 *  (see `scadParams.ts`) surface as the same Parameters panel the JS engines
 *  drive via `api.params`. The user's tweaks arrive as `paramOverrides` and are
 *  applied through OpenSCAD's native `-D name=value` flag — no source
 *  rewriting. The parsed schema rides on every result (success and error) so
 *  the panel stays live, matching the other engines. */
export async function runScadAsync(source: string, paramOverrides?: Record<string, unknown>): Promise<MeshResult> {
  const schema = parseScadParams(source);
  const paramsSchema = schema.length > 0 ? schema : undefined;
  const defines = buildScadDefines(source, paramOverrides);
  const result = await runScadInner(source, defines);
  return paramsSchema ? { ...result, paramsSchema } : result;
}

async function runScadInner(source: string, defines: string[]): Promise<MeshResult> {
  if (!createFn) {
    const error = 'OpenSCAD engine not initialized.';
    return { mesh: null, manifold: null, error, diagnostics: scadDiagnostics(source, error) };
  }

  // Source-side scan — single linear pass over the user's text. Decides which
  // compile mode we use below (label-aware vs the historical STL fast path).
  const labelScan = scanScadLabels(source);
  const effectiveSource = LABEL_MODULE_PREFIX + source;

  let instance: any;
  let stderr: string[];
  try {
    ({ instance, stderr } = await createInstance());
  } catch (e) {
    const error = `Failed to create OpenSCAD instance: ${e instanceof Error ? e.message : String(e)}`;
    return { mesh: null, manifold: null, error, diagnostics: scadDiagnostics(source, error) };
  }

  try {
    if (sourceUsesBosl2(source)) {
      try {
        await ensureBosl2InMemfs(instance);
      } catch (e) {
        const error = `Failed to load BOSL2 library: ${e instanceof Error ? e.message : String(e)}`;
        return { mesh: null, manifold: null, error, diagnostics: scadDiagnostics(source, error) };
      }
    }
    instance.FS.writeFile('/in.scad', effectiveSource);

    if (labelScan.hasAnyLabelCalls) {
      // Label-aware path: single compile to multi-object AMF via lazy-union,
      // then one Manifold component per object so paintByLabel resolves via
      // manifold-3d's originalID provenance — same machinery as manifold-js
      // labelled construction. Any label-shape warnings (nested-in-boolean
      // etc.) are emitted as diagnostics on the result inside that helper,
      // so they surface even when the compile succeeds.
      return runLabelAwareAsync(instance, source, stderr, labelScan, defines);
    }

    // Fast path: no labels in source → single STL compile, single Manifold.
    // Functionally identical to the pre-label-support pipeline.
    return runFlatStlAsync(instance, source, stderr, defines);
  } catch (e: unknown) {
    let msg: string;
    if (typeof e === 'number' && instance?.formatException) {
      try { msg = instance.formatException(e); } catch { msg = `exception #${e}`; }
    } else {
      msg = e instanceof Error ? e.message : String(e);
    }
    const error = `OpenSCAD: ${msg}\n${shiftErrorLines(formatStderr(stderr))}`;
    return {
      mesh: null,
      manifold: null,
      error,
      diagnostics: scadDiagnostics(source, error),
    };
  }
}

/** Historical SCAD pipeline: compile to binary STL, weld, round-trip through
 *  Manifold.ofMesh. Used whenever the source has no `label()` calls. */
async function runFlatStlAsync(
  instance: any,
  source: string,
  stderr: string[],
  defines: string[],
): Promise<MeshResult> {
  // Seed $fn from the user's quality preset. The script can still
  // reassign $fn=… at the top level or pass $fn= per primitive to override.
  // Customizer overrides follow as additional `-D` flags.
  const exitCode = instance.callMain([
    '--enable=manifold',
    '-D', `$fn=${getDefaultCircularSegments()}`,
    ...defines,
    '--export-format=binstl',
    '-o', '/out.stl',
    '/in.scad',
  ]);

  if (exitCode !== 0) {
    const error = `OpenSCAD exited with code ${exitCode}\n${shiftErrorLines(formatStderr(stderr))}`;
    return { mesh: null, manifold: null, error, diagnostics: scadDiagnostics(source, error) };
  }

  let stlBytes: Uint8Array;
  try {
    const raw = instance.FS.readFile('/out.stl');
    stlBytes = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
  } catch (e) {
    const error = `OpenSCAD did not produce output: ${e instanceof Error ? e.message : String(e)}\n${shiftErrorLines(formatStderr(stderr))}`;
    return { mesh: null, manifold: null, error, diagnostics: scadDiagnostics(source, error) };
  }

  const mesh = parseBinarySTLToMeshGL(stlBytes);
  if (!mesh || mesh.numTri === 0) {
    const error = `OpenSCAD produced empty or invalid STL output.\n${shiftErrorLines(formatStderr(stderr))}`;
    return { mesh: null, manifold: null, error, diagnostics: scadDiagnostics(source, error) };
  }

  const module = getManifoldModule();
  if (!module) return { mesh, manifold: null, error: null };

  let manifold: unknown | null = null;
  try {
    manifold = module.Manifold.ofMesh(mesh);
  } catch {
    // Non-manifold SCAD output — still render raw mesh.
    return { mesh, manifold: null, error: null };
  }

  return { mesh: canonicalMeshOf(manifold), manifold, error: null };
}

/** Label-aware SCAD pipeline. Compiles once with `--enable=lazy-union
 *  --export-format=amf`; each top-level statement becomes its own `<object>`
 *  in document order. We pair AMF objects with the label names recovered
 *  from the source scan, then `Manifold.compose([...originals])` so the
 *  resulting mesh's `runOriginalID` array carries the per-region provenance
 *  that `paintByLabel` queries. */
async function runLabelAwareAsync(
  instance: any,
  source: string,
  stderr: string[],
  labelScan: ReturnType<typeof scanScadLabels>,
  defines: string[],
): Promise<MeshResult> {
  const exitCode = instance.callMain([
    '--enable=manifold',
    '--enable=lazy-union',
    '-D', `$fn=${getDefaultCircularSegments()}`,
    ...defines,
    '--export-format=amf',
    '-o', '/out.amf',
    '/in.scad',
  ]);

  if (exitCode !== 0) {
    const error = `OpenSCAD exited with code ${exitCode}\n${shiftErrorLines(formatStderr(stderr))}`;
    return { mesh: null, manifold: null, error, diagnostics: scadDiagnostics(source, error) };
  }

  let amfText: string;
  try {
    const raw = instance.FS.readFile('/out.amf');
    const bytes = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
    amfText = new TextDecoder().decode(bytes);
  } catch (e) {
    const error = `OpenSCAD did not produce output: ${e instanceof Error ? e.message : String(e)}\n${shiftErrorLines(formatStderr(stderr))}`;
    return { mesh: null, manifold: null, error, diagnostics: scadDiagnostics(source, error) };
  }

  const objects = parseAmfObjects(amfText);
  if (objects.length === 0) {
    const error = `OpenSCAD produced empty AMF output.\n${shiftErrorLines(formatStderr(stderr))}`;
    return { mesh: null, manifold: null, error, diagnostics: scadDiagnostics(source, error) };
  }

  // Map AMF objects to source-scan names by position. lazy-union emits
  // objects in source declaration order; the source scan walks in the same
  // order. When the counts disagree (for-loop expansion, conditional
  // statements, runtime-computed names), fall back to auto-named regions
  // for unmatched objects rather than producing wrong labels.
  const names = resolveLabelNames(objects.length, labelScan, stderr);

  const module = getManifoldModule();
  if (!module) {
    // Without the manifold-3d module loaded we can't run booleans — return
    // the first object's raw mesh so the renderer still shows *something*.
    return { mesh: objects[0], manifold: null, error: null };
  }

  // Build one Manifold per object, then compose. asOriginal() assigns each
  // a fresh originalID() that propagates through compose's runOriginalID
  // array — the same provenance channel manifold-js labels ride on.
  const labelRegistry = new Map<number, string>();
  const originals: any[] = [];
  for (let i = 0; i < objects.length; i++) {
    let m: any;
    try {
      m = module.Manifold.ofMesh(objects[i]);
    } catch {
      // Skip non-manifold components rather than failing the whole render.
      // Tell the user if the dropped component was labelled — silently losing
      // a name they're trying to paint by would be confusing.
      if (names[i]) {
        stderr.push(
          `WARNING: label "${names[i]}" attached to a non-manifold component ` +
          `(object ${i}); paintByLabel("${names[i]}") will return no triangles.`,
        );
      }
      continue;
    }
    const original = m.asOriginal();
    const id = original.originalID();
    if (typeof id === 'number' && id >= 0 && names[i]) {
      labelRegistry.set(id, names[i] as string);
    }
    originals.push(original);
  }

  if (originals.length === 0) {
    const error = `OpenSCAD output contained no manifold components.\n${shiftErrorLines(formatStderr(stderr))}`;
    return { mesh: null, manifold: null, error, diagnostics: scadDiagnostics(source, error) };
  }

  // Manifold.compose([single]) is a no-op identity, so guard the common case.
  const composed = originals.length === 1
    ? originals[0]
    : module.Manifold.compose(originals);

  const canonical = canonicalMeshOf(composed);
  const labelMap = resolveLabelMap(canonical, labelRegistry);
  // Diff what the scanner SAW in source against what made it into labelMap.
  // De-dupe and drop names the labelMap delivered so paintByLabel actually
  // works on them. The leftovers are "the user wrote it but can't paint it."
  const seen = new Set(labelScan.allLiteralLabelNames);
  if (labelMap) for (const k of labelMap.keys()) seen.delete(k);
  const lostLabels = seen.size > 0 ? [...seen] : undefined;
  // Surface a parse-time WARNING as a diagnostic when label() appeared
  // inside a `{ ... }` block. The compile likely succeeded — those
  // labels just don't reach paintByLabel because CGAL strips originalID
  // through booleans. Emitting this on the success path (instead of via
  // stderr, which only surfaces on errors) means the agent and the
  // editor's diagnostic panel both see it.
  const diagnostics: SourceDiagnostic[] = [];
  if (labelScan.hasNestedLabels) {
    const lostList = lostLabels && lostLabels.length > 0
      ? ` Lost labels: ${lostLabels.join(', ')}.`
      : '';
    diagnostics.push({
      message:
        'label(...) inside a `{ ... }` block (difference/intersection/union/hull/etc.) ' +
        'is stripped by OpenSCAD\'s CGAL backend — those names won\'t reach paintByLabel.' +
        lostList,
      severity: 'warning',
      source: 'OpenSCAD',
      hint:
        'Apply label() OUTSIDE the boolean to tag the whole result, or refactor the operands ' +
        'into separate top-level statements.',
    });
  }
  return {
    mesh: canonical,
    manifold: composed,
    error: null,
    labelMap,
    lostLabels,
    diagnostics: diagnostics.length > 0 ? diagnostics : undefined,
  };
}

/** Walk the source-scan output and decide a name (or null) for each of the
 *  N AMF objects we got back from lazy-union. */
function resolveLabelNames(
  amfCount: number,
  labelScan: ReturnType<typeof scanScadLabels>,
  stderr: string[],
): (string | null)[] {
  const stmts = labelScan.topLevelStatements;
  if (stmts.length !== amfCount) {
    // The scanner's view of top-level statements diverges from what
    // lazy-union actually emitted — common when for-loops or conditionals
    // expand at runtime. Log once for diagnostics, then auto-name.
    stderr.push(
      `INFO: label scanner counted ${stmts.length} top-level statement(s) but ` +
      `OpenSCAD emitted ${amfCount} object(s); using auto names for unmatched objects.`,
    );
    return new Array<string | null>(amfCount).fill(null);
  }
  return stmts.map(s => s.labelName);
}

/** Get the canonical mesh (with merge vectors + runOriginalID/runIndex) out
 *  of a Manifold, in the MeshData shape downstream code consumes. */
function canonicalMeshOf(manifold: unknown): MeshData {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const m = (manifold as any).getMesh();
  return {
    vertProperties: m.vertProperties as Float32Array,
    triVerts: m.triVerts as Uint32Array,
    numVert: m.numVert as number,
    numTri: m.numTri as number,
    numProp: m.numProp as number,
    mergeFromVert: m.mergeFromVert as Uint32Array | undefined,
    mergeToVert: m.mergeToVert as Uint32Array | undefined,
    runIndex: m.runIndex as Uint32Array | undefined,
    runOriginalID: m.runOriginalID as Uint32Array | undefined,
  };
}

/** Bucket triangle ids by label name using the composed mesh's
 *  `runOriginalID` + `runIndex` arrays. Mirrors the manifold-js
 *  resolveLabelMap (kept private to that engine) but lives here so SCAD
 *  doesn't have to depend on it. */
function resolveLabelMap(
  mesh: MeshData,
  registry: Map<number, string>,
): Map<string, Set<number>> | undefined {
  if (registry.size === 0) return undefined;
  const out = new Map<string, Set<number>>();
  const runOriginalID = mesh.runOriginalID;
  const runIndex = mesh.runIndex;
  if (!runOriginalID || !runIndex || runOriginalID.length === 0) return out;
  for (let i = 0; i < runOriginalID.length; i++) {
    const name = registry.get(runOriginalID[i]);
    if (name === undefined) continue;
    const startTri = runIndex[i] / 3;
    const endTri = runIndex[i + 1] / 3;
    let set = out.get(name);
    if (!set) {
      set = new Set<number>();
      out.set(name, set);
    }
    for (let t = startTri; t < endTri; t++) set.add(t);
  }
  return out;
}

/** Async validate — creates a fresh instance, compiles to AST (fast path). */
export async function validateScadAsync(source: string): Promise<ValidateResult> {
  if (!createFn) {
    const error = 'OpenSCAD not initialized';
    return { valid: false, error, diagnostics: scadDiagnostics(source, error) };
  }

  let instance: any;
  let stderr: string[];
  try {
    ({ instance, stderr } = await createInstance());
  } catch (e) {
    const error = `Failed to create OpenSCAD instance: ${e instanceof Error ? e.message : String(e)}`;
    return { valid: false, error, diagnostics: scadDiagnostics(source, error) };
  }

  try {
    if (sourceUsesBosl2(source)) {
      try {
        await ensureBosl2InMemfs(instance);
      } catch (e) {
        const error = `Failed to load BOSL2 library: ${e instanceof Error ? e.message : String(e)}`;
        return { valid: false, error, diagnostics: scadDiagnostics(source, error) };
      }
    }
    // Match runScadAsync — prepend the label() helper so a source that uses
    // it doesn't trip "unknown module" warnings during the AST pass.
    instance.FS.writeFile('/v.scad', LABEL_MODULE_PREFIX + source);
    const code = instance.callMain([
      '--export-format=ast',
      '-o', '/v.ast',
      '/v.scad',
    ]);
    if (code === 0) return { valid: true };
    const error = shiftErrorLines(formatStderr(stderr));
    return { valid: false, error, diagnostics: scadDiagnostics(source, error) };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    return { valid: false, error, diagnostics: scadDiagnostics(source, error) };
  }
}
