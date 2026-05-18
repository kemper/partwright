import type { Engine, MeshResult, ValidateResult } from './types';
import { parseBinarySTLToMeshGL } from './scadToManifold';
import { getManifoldModule, manifoldJsEngine } from './manifoldJs';
import { scadDiagnostics } from '../sourceDiagnostics';
import { ensureBosl2InMemfs, sourceUsesBosl2 } from '../bosl2Loader';
import { getDefaultCircularSegments } from '../qualitySettings';

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

/** Async run — creates a fresh WASM instance, compiles SCAD, parses STL,
 *  and round-trips through Manifold.ofMesh(). */
export async function runScadAsync(source: string): Promise<MeshResult> {
  if (!createFn) {
    const error = 'OpenSCAD engine not initialized.';
    return { mesh: null, manifold: null, error, diagnostics: scadDiagnostics(source, error) };
  }

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
    instance.FS.writeFile('/in.scad', source);

    // Seed $fn from the user's quality preset. The script can still
    // reassign $fn=… at the top level or pass $fn= per primitive to
    // override.
    const exitCode = instance.callMain([
      '--enable=manifold',
      '-D', `$fn=${getDefaultCircularSegments()}`,
      '--export-format=binstl',
      '-o', '/out.stl',
      '/in.scad',
    ]);

    if (exitCode !== 0) {
      const error = `OpenSCAD exited with code ${exitCode}\n${formatStderr(stderr)}`;
      return {
        mesh: null,
        manifold: null,
        error,
        diagnostics: scadDiagnostics(source, error),
      };
    }

    let stlBytes: Uint8Array;
    try {
      const raw = instance.FS.readFile('/out.stl');
      stlBytes = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
    } catch (e) {
      const error = `OpenSCAD did not produce output: ${e instanceof Error ? e.message : String(e)}\n${formatStderr(stderr)}`;
      return {
        mesh: null,
        manifold: null,
        error,
        diagnostics: scadDiagnostics(source, error),
      };
    }

    const mesh = parseBinarySTLToMeshGL(stlBytes);
    if (!mesh || mesh.numTri === 0) {
      const error = `OpenSCAD produced empty or invalid STL output.\n${formatStderr(stderr)}`;
      return {
        mesh: null,
        manifold: null,
        error,
        diagnostics: scadDiagnostics(source, error),
      };
    }

    // Round-trip into manifold-3d so sliceAtZ, genus, etc. work unchanged.
    const module = getManifoldModule();
    if (!module) {
      return { mesh, manifold: null, error: null };
    }

    let manifold: unknown | null = null;
    try {
      manifold = module.Manifold.ofMesh(mesh);
    } catch {
      // Non-manifold SCAD output — still render raw mesh.
      return { mesh, manifold: null, error: null };
    }

    // Get canonical mesh with merge vectors for clean export topology.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const canonical = (manifold as any).getMesh();
    const exportMesh = {
      vertProperties: canonical.vertProperties as Float32Array,
      triVerts: canonical.triVerts as Uint32Array,
      numVert: canonical.numVert as number,
      numTri: canonical.numTri as number,
      numProp: canonical.numProp as number,
      mergeFromVert: canonical.mergeFromVert as Uint32Array | undefined,
      mergeToVert: canonical.mergeToVert as Uint32Array | undefined,
    };
    return { mesh: exportMesh, manifold, error: null };
  } catch (e: unknown) {
    let msg: string;
    if (typeof e === 'number' && instance?.formatException) {
      try { msg = instance.formatException(e); } catch { msg = `exception #${e}`; }
    } else {
      msg = e instanceof Error ? e.message : String(e);
    }
    const error = `OpenSCAD: ${msg}\n${formatStderr(stderr)}`;
    return {
      mesh: null,
      manifold: null,
      error,
      diagnostics: scadDiagnostics(source, error),
    };
  }
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
    instance.FS.writeFile('/v.scad', source);
    const code = instance.callMain([
      '--export-format=ast',
      '-o', '/v.ast',
      '/v.scad',
    ]);
    if (code === 0) return { valid: true };
    const error = formatStderr(stderr);
    return { valid: false, error, diagnostics: scadDiagnostics(source, error) };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    return { valid: false, error, diagnostics: scadDiagnostics(source, error) };
  }
}
