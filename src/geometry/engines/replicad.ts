import type { Engine, MeshResult, ValidateResult } from './types';
import { javaScriptSyntaxDiagnostics, runtimeDiagnostic } from '../sourceDiagnostics';
import { ensureBrepLoaded, getBrepNamespace, consumeBrepAllocations, disposeBrepAllocationsExcept, extractLabelMap, getPendingBrepImports, type BrepShape } from '../brepRuntime';
import { getManifoldModule, manifoldJsEngine } from './manifoldJs';
import { getActiveImports } from '../../import/importedMesh';

// === replicad engine — Phase A of the BREP integration ===
//
// A session whose `language === 'replicad'` runs its source through this
// engine. The sandbox API exposes Partwright's `BREP` namespace (the same one
// available inside manifold-js sandboxes) — keeping a single vocabulary means
// the AI doesn't have to learn two BREP dialects. The session's source of
// truth is the returned BrepShape: it's tessellated for the renderer (and any
// downstream mesh-side feature: painting, ray-cast, render, export) but the
// underlying OCCT shape lives until `delete()` runs, so STEP export can grab
// it before disposal.
//
// Why "BrepShape lives until delete":
//   manifold-3d intermediates are deleted aggressively per-run (see the
//   memory-management note in manifoldJs.ts) because the editor's auto-run
//   creates a fresh heap state on every keystroke. OCCT shapes are bigger
//   but allocated less frequently — we keep the returned shape long enough
//   to extract a STEP blob on demand, then dispose it when the next run
//   replaces it via `lastShape`.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let manifoldModule: any = null;

let lastShape: BrepShape | null = null;

/** The most recent BREP result, retained for STEP export. Replaced on every
 *  run; the previous one is freed. */
export function getLastBrepShape(): BrepShape | null {
  return lastShape;
}

function disposeLast(): void {
  if (!lastShape) return;
  try { lastShape.delete(); } catch { /* already freed */ }
  lastShape = null;
}

export const replicadEngine: Engine = {
  id: 'replicad',

  async init() {
    // Manifold is needed for the BREP → Manifold round-trip that gives us
    // canonical mesh + slicing + boolean queries downstream of replicad.
    if (!manifoldJsEngine.isReady()) await manifoldJsEngine.init();
    manifoldModule = getManifoldModule();
    await ensureBrepLoaded();
  },

  isReady() {
    return manifoldModule !== null && getBrepNamespace() !== null;
  },

  run(_source: string): MeshResult {
    // Sync `run()` isn't usable here — replicad's WASM init is async and
    // every code path that wants a replicad session goes through the worker
    // (`runReplicadAsync`). Keep the method around to satisfy the Engine
    // interface; the dispatcher in engine.ts already routes async langs to
    // the Worker.
    return {
      mesh: null,
      manifold: null,
      error: 'BREP/replicad requires async execution — use the worker path.',
    };
  },

  validate(jsCode: string): ValidateResult {
    // Same parse check as manifold-js: build the Function without executing.
    // Catches syntax errors before paying the WASM round-trip.
    try {
      new Function('api', `"use strict";\n${jsCode}`);
      return { valid: true };
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      return {
        valid: false,
        error,
        diagnostics: e instanceof SyntaxError ? javaScriptSyntaxDiagnostics(jsCode, error, e) : runtimeDiagnostic(error, undefined, 'JavaScript'),
      };
    }
  },
};

/** Async run for the worker. The source is JS that uses `api.BREP` to build a
 *  BrepShape and must `return` it. We tessellate the BREP to mesh, round-trip
 *  through `Manifold.ofMesh()` so downstream Partwright features (slice,
 *  stats, paint persistence) keep working, and stash the live BrepShape in
 *  `lastShape` so STEP export can find it. */
export async function runReplicadAsync(jsCode: string): Promise<MeshResult> {
  if (!manifoldModule || !getBrepNamespace()) {
    const error = 'BREP/replicad engine not initialised.';
    return { mesh: null, manifold: null, error };
  }

  const BREP = getBrepNamespace();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Manifold = manifoldModule.Manifold;

  // Engines run inside the worker where `window.partwright` is undefined; the
  // manifold-js engine has its own check for the "paint inside model code"
  // misconception, but the same trap exists here so we replicate the guard.
  // We also catch bare `exportSTEP(` — agents see it documented as
  // `partwright.exportSTEP()` and sometimes drop the prefix inside the
  // sandbox where it shows up as a bare ReferenceError that doesn't
  // explain the boundary.
  if (/\bpartwright\s*\./.test(jsCode)) {
    const error = 'Model code cannot call paint tools like partwright.paintByLabel or partwright.exportSTEP from inside the BREP session. They are separate tool calls — invoke them between code runs (after runAndSave), not inside the code.';
    return {
      mesh: null,
      manifold: null,
      error,
      diagnostics: runtimeDiagnostic(error, 'Remove the partwright.* call from the model code and invoke the tool separately.', 'JavaScript'),
    };
  }
  // Bare `exportSTEP(` — same misconception, no `partwright.` prefix.
  if (/\bexportSTEP\s*\(/.test(jsCode)) {
    const error = 'exportSTEP is a tool call (partwright.exportSTEP), not a sandbox API. Call it AFTER runAndSave returns — between tool calls — not from inside the model code.';
    return {
      mesh: null,
      manifold: null,
      error,
      diagnostics: runtimeDiagnostic(error, 'Remove the exportSTEP() call from the model code; invoke partwright.exportSTEP() after the run completes.', 'JavaScript'),
    };
  }

  // BREP sessions get two parallel `imports`-like things:
  //   - `api.imports[i]` — BrepShapes from STEP imports. These survive across
  //     runs (the user iterates against `return api.imports[0].fillet(2)`).
  //     This is the BREP-native import surface and the one most code reaches
  //     for inside a replicad session.
  //   - `api.meshImports[i]` — mesh data from STL imports (and any other
  //     mesh-only sources). Kept under a separate name so the BREP-native
  //     `api.imports` array isn't polluted with `{vertProperties, triVerts}`
  //     objects the AI would have to special-case.
  const brepImports = getPendingBrepImports().map(({ shape }) => shape);
  const meshImports = getActiveImports().map(m => ({
    numProp: m.numProp,
    vertProperties: m.vertProperties,
    triVerts: m.triVerts,
  }));

  const api = {
    BREP,
    Manifold,
    CrossSection: manifoldModule.CrossSection,
    imports: brepImports,
    meshImports,
  };

  // Same per-run BREP allocation drain pattern as the manifold-js engine —
  // see brepRuntime's resource note. We snapshot the list before the user's
  // code runs (in case anything was queued earlier) and drain again after.
  consumeBrepAllocations();
  let shape: BrepShape | null = null;
  let userScriptError: { error: string; diagnostics?: ReturnType<typeof runtimeDiagnostic> } | null = null;
  try {
    const fn = new Function('api', `"use strict";\n${jsCode}`);
    const result = fn(api) as unknown;
    if (!result || typeof result !== 'object' || !('_shape' in result)) {
      const error = 'BREP code must `return` a BREP shape (from api.BREP.box/cylinder/sphere/etc., optionally piped through .fillet/.chamfer/.fuse/.cut/.intersect).';
      userScriptError = {
        error,
        diagnostics: runtimeDiagnostic(error, 'Add a final `return` that returns a BREP shape.', 'JavaScript'),
      };
    } else {
      shape = result as BrepShape;
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    const isSyntaxError = e instanceof SyntaxError;
    userScriptError = {
      error: msg,
      diagnostics: isSyntaxError ? javaScriptSyntaxDiagnostics(jsCode, msg, e) : runtimeDiagnostic(msg, undefined, 'JavaScript'),
    };
  }

  if (userScriptError || !shape) {
    // The script failed before producing a shape — free every BREP shape it
    // allocated along the way (e.g. `BREP.box(...).fillet(...)` chains whose
    // final step threw).
    disposeBrepAllocationsExcept(consumeBrepAllocations(), null);
    return {
      mesh: null,
      manifold: null,
      error: userScriptError?.error ?? 'BREP code did not produce a shape.',
      diagnostics: userScriptError?.diagnostics,
    };
  }

  // From here `shape` is non-null — TS doesn't infer this through the
  // userScriptError branch but the guard above makes it true.
  const liveShape: BrepShape = shape;

  // Tessellate + Manifold round-trip. If Manifold rejects the mesh (e.g.
  // because OCCT produced a non-watertight tessellation at the chosen
  // tolerance), we still return the raw mesh so the user sees something
  // rather than a black viewport.
  try {
    // Free every intermediate the script allocated, sparing the returned shape
    // (which becomes lastShape below). Doing this BEFORE tessellation means a
    // tessellation error frees the right set — the catch block below assumes
    // only `shape` and the lastShape replacement are still live.
    disposeBrepAllocationsExcept(consumeBrepAllocations(), liveShape);
    const brepMesh = liveShape.toMesh();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let manifold: any = null;
    try {
      manifold = Manifold.ofMesh({
        numProp: brepMesh.numProp,
        vertProperties: brepMesh.vertProperties,
        triVerts: brepMesh.triVerts,
      });
    } catch {
      // Fall through to raw-mesh return below.
    }

    // Replace the previously-retained shape so STEP export can find this one.
    disposeLast();
    lastShape = liveShape;

    // Pull BREP-side labels off the returned shape so `paintByLabel` works
    // in replicad-language sessions without the user having to also build
    // the geometry as labeled Manifolds. Empty map → undefined (engine
    // convention for "no labels this run"). Triangle ids are the pre-
    // Manifold-roundtrip ids; manifold-js's canonicalizer can reorder, but
    // for this engine the BREP→Manifold step happens only via ofMesh
    // (no boolean ops on the resulting Manifold) so ordering is preserved.
    const brepLabels = extractLabelMap(liveShape);
    const labelMap = brepLabels.size > 0 ? brepLabels : undefined;

    if (manifold) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const canonical = (manifold as any).getMesh();
      return {
        mesh: {
          vertProperties: canonical.vertProperties as Float32Array,
          triVerts: canonical.triVerts as Uint32Array,
          numVert: canonical.numVert as number,
          numTri: canonical.numTri as number,
          numProp: canonical.numProp as number,
          mergeFromVert: canonical.mergeFromVert as Uint32Array | undefined,
          mergeToVert: canonical.mergeToVert as Uint32Array | undefined,
        },
        manifold,
        error: null,
        labelMap,
      };
    }
    // Non-manifold tessellation — render the raw triangles.
    return {
      mesh: {
        vertProperties: brepMesh.vertProperties,
        triVerts: brepMesh.triVerts,
        numVert: brepMesh.numVert,
        numTri: brepMesh.numTri,
        numProp: brepMesh.numProp,
      },
      manifold: null,
      error: null,
      labelMap,
    };
  } catch (e: unknown) {
    // Tessellation failure — free the shape so we don't leak it.
    try { liveShape.delete(); } catch { /* already freed */ }
    const msg = e instanceof Error ? e.message : String(e);
    return {
      mesh: null,
      manifold: null,
      error: `BREP tessellation failed: ${msg}`,
      diagnostics: runtimeDiagnostic(msg, undefined, 'JavaScript'),
    };
  }
}

/** Convenience for callers (e.g. the main-thread STEP export tool) to clear
 *  the retained shape — used when closing a session or switching engines. */
export function clearLastBrepShape(): void {
  disposeLast();
}
