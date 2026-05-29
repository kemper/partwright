import type { Engine, MeshResult, ValidateResult } from './types';
import { javaScriptSyntaxDiagnostics, runtimeDiagnostic } from '../sourceDiagnostics';
import { createCurvesNamespace } from '../curves';
import { createMeshOpsNamespace } from '../meshOps';
import { normalizeParamSchema, resolveParamValues, mergeParamSchemas, protectParamValues, type ParamSpec } from '../params';
import { getDefaultCircularSegments } from '../qualitySettings';
import { getActiveImports } from '../../import/importedMesh';
import { createSdfNamespace, SdfNode } from '../sdf';
import { getBrepNamespace, consumeBrepAllocations, disposeBrepAllocationsExcept, consumeBrepToManifoldLabels } from '../brepRuntime';
import { parseLabelColor } from '../../color/labelColor';

/** Marker the sandbox attaches to render-only proxies (see `renderMesh` below).
 *  The engine looks for it on the user-returned object to decide whether the
 *  result should be treated as a real Manifold (with volume, boolean ops, etc.)
 *  or just rendered as-is with manifold-dependent features disabled. */
const RENDER_ONLY_MARKER = '__partwrightRenderOnly';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function renderMesh(meshData: any) {
  if (!meshData || !meshData.vertProperties || !meshData.triVerts) {
    throw new Error('api.renderMesh: expected an object with vertProperties (Float32Array) and triVerts (Uint32Array).');
  }
  const numProp = meshData.numProp ?? 3;
  return {
    [RENDER_ONLY_MARKER]: true,
    getMesh() {
      return {
        vertProperties: meshData.vertProperties,
        triVerts: meshData.triVerts,
        numVert: meshData.numVert ?? meshData.vertProperties.length / numProp,
        numTri: meshData.numTri ?? meshData.triVerts.length / 3,
        numProp,
      };
    },
    delete() { /* no native resource to release */ },
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let manifoldModule: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let curvesNamespace: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let meshOpsNamespace: any = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getManifoldModule(): any {
  return manifoldModule;
}

// === Per-run WASM memory management ===
//
// manifold-3d objects live on the WASM heap and must be `.delete()`d by hand —
// JS GC never frees them. User code such as
// `Manifold.compose([Manifold.ofMesh(a), Manifold.ofMesh(b)])` allocates
// intermediate Manifolds that would otherwise leak on every run; because the
// editor auto-runs on each edit/undo, that heap growth eventually faults the
// module ("memory access out of bounds" / "null function"). To contain it we
// wrap the Manifold/CrossSection factory + instance methods for the duration of
// one run, record every object they hand back, and delete them all (except the
// value the user returned) once the result mesh has been extracted. The wrapping
// is scoped to the run and restored afterwards so other callers that share the
// same module on the main thread (stats, slicing, simplify) are unaffected.

type SavedMethod = [target: Record<string, unknown>, name: string, fn: unknown];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function wrapMethodsForTracking(target: any, track: (v: unknown) => void, saved: SavedMethod[]): void {
  if (!target) return;
  for (const name of Object.getOwnPropertyNames(target)) {
    if (name === 'constructor' || name === 'delete' || name === 'isDeleted') continue;
    let orig: unknown;
    try { orig = target[name]; } catch { continue; }
    if (typeof orig !== 'function') continue;
    try {
      target[name] = function (this: unknown, ...args: unknown[]) {
        const out = (orig as (...a: unknown[]) => unknown).apply(this, args);
        track(out);
        return out;
      };
      saved.push([target, name, orig]);
    } catch { /* non-writable Embind member — skip (rare; just won't be tracked) */ }
  }
}

function restoreMethods(saved: SavedMethod[]): void {
  for (const [target, name, fn] of saved) {
    try { target[name] = fn; } catch { /* ignore */ }
  }
}

function disposeAllExcept(allocated: Array<{ delete?: () => void }>, keep: unknown): void {
  for (const obj of allocated) {
    if (obj === keep) continue;
    try { obj.delete?.(); } catch { /* already freed by user code */ }
  }
}

export const manifoldJsEngine: Engine = {
  id: 'manifold-js',

  async init() {
    if (manifoldModule) return;
    const Module = await import('manifold-3d');
    manifoldModule = await Module.default();
    manifoldModule.setup();
    curvesNamespace = createCurvesNamespace(manifoldModule);
    meshOpsNamespace = createMeshOpsNamespace(manifoldModule);
  },

  isReady() {
    return manifoldModule !== null;
  },

  run(jsCode: string, paramOverrides?: Record<string, unknown>): MeshResult {
    if (!manifoldModule) {
      return { mesh: null, manifold: null, error: 'Engine not initialized' };
    }

    const {
      Manifold,
      CrossSection,
      setMinCircularAngle,
      setMinCircularEdgeLength,
      setCircularSegments,
    } = manifoldModule;

    // Apply the user's quality preset before running their code. This
    // is the default segment count for every sphere/cylinder/circle
    // unless the script overrides it via setCircularSegments() or
    // passes an explicit segment argument to a primitive.
    setCircularSegments(getDefaultCircularSegments());

    // Per-run registry mapping a fresh `originalID()` (assigned by
    // shape.asOriginal()) back to the human-readable name the user
    // passed to `api.label`. After the user's code finishes, we walk
    // the result mesh's `runOriginalID` array and build the inverse:
    // `{name -> Set<triangleId>}`. Cleared on every run.
    const labelRegistry = new Map<number, string>();
    // Optional per-label color declared in code via the 3rd arg to
    // `api.label(shape, name, { color })`. Keyed by label *name* (the same
    // granularity as labelMap): the main thread resolves each name's triangles
    // and renders/exports them as a derived "model color" underlay, so a model
    // is self-describing without a manual paint pass. Last write per name wins.
    const labelColors = new Map<string, [number, number, number]>();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const label = (shape: any, name: unknown, options?: unknown): any => {
      if (!shape || typeof shape.asOriginal !== 'function' || typeof shape.add !== 'function') {
        throw new Error('api.label(shape, name): shape must be a Manifold (returned by Manifold.cube/sphere/cylinder/extrude/etc.)');
      }
      if (typeof name !== 'string' || name.length === 0) {
        throw new Error('api.label(shape, name): name must be a non-empty string');
      }
      // Optional { color } — a hex string ('#rrggbb' / '#rgb', same form as a
      // `color` param so `{ color: p.accent }` works) or an [r,g,b] array 0..1.
      if (options !== undefined && options !== null) {
        if (typeof options !== 'object' || Array.isArray(options)) {
          throw new Error('api.label(shape, name, options): options must be an object like { color: "#rrggbb" }');
        }
        const { color, ...rest } = options as { color?: unknown };
        const unknownKeys = Object.keys(rest);
        if (unknownKeys.length > 0) {
          throw new Error(`api.label options: unknown key(s) ${unknownKeys.map(k => `"${k}"`).join(', ')}. Only { color } is supported.`);
        }
        if (color !== undefined) {
          const rgb = parseLabelColor(color);
          if (!rgb) {
            throw new Error('api.label color: expected a hex string like "#3b82f6" or an [r,g,b] array of three numbers in 0..1.');
          }
          labelColors.set(name, rgb);
        }
      }
      // asOriginal() returns a copy with a fresh, unique originalID().
      // We register that id against the user-supplied name. After
      // boolean ops the result mesh's runOriginalID array will carry
      // this id for every triangle that traces back to this input.
      const original = shape.asOriginal();
      const id = original.originalID();
      if (id < 0) {
        // Shouldn't happen — asOriginal() always produces a valid id —
        // but defensive in case manifold-3d's behavior changes.
        throw new Error('api.label(shape, name): asOriginal() did not produce a valid originalID; cannot register label.');
      }
      labelRegistry.set(id, name);
      return original;
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const labeledUnion = (parts: unknown): any => {
      if (!Array.isArray(parts) || parts.length === 0) {
        throw new Error('api.labeledUnion(parts): non-empty array required, each element { name: string, shape: Manifold, color? }');
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let acc: any = null;
      for (const p of parts) {
        if (!p || typeof p !== 'object') {
          throw new Error('api.labeledUnion: each entry must be { name: string, shape: Manifold, color? }');
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const entry = p as { name?: unknown; shape?: any; color?: unknown };
        const labelled = label(entry.shape, entry.name, entry.color !== undefined ? { color: entry.color } : undefined);
        acc = acc === null ? labelled : acc.add(labelled);
      }
      return acc;
    };

    // Imported meshes (STL etc.) attached to the active version are exposed as
    // `api.imports[i]` — each entry is shaped to pass straight into
    // `Manifold.ofMesh()`. Metadata (filename/format) is kept off this object
    // so Embind doesn't choke on unexpected fields; user code that needs the
    // source filename can read it from the generated code comment.
    const imports = getActiveImports().map(m => ({
      numProp: m.numProp,
      vertProperties: m.vertProperties,
      triVerts: m.triVerts,
    }));

    // SDF namespace is constructed per-run because it needs to close over
    // the run's `label` function (so labelled SDF subtrees register with
    // the same labelRegistry as `api.label`-tagged Manifold parts).
    const sdfNamespace = createSdfNamespace(Manifold, label);

    // `BREP` is only present when the engine Worker has lazy-loaded
    // OpenCASCADE.js — otherwise the namespace is undefined and the user
    // sees a normal "BREP is not defined" ReferenceError if they touch it
    // without the loader having run. The pre-scan in engineWorker.ts
    // (`sourceUsesBrep(code)`) is what triggers the load.
    const BREP = getBrepNamespace();

    // Customizer parameters. `api.params(schema)` declares the model's tweakable
    // knobs and returns their resolved values (the Customizer's overrides for
    // this run, falling back to each declared default). We record every call's
    // normalized schema so the caller can surface it to the Parameters panel; a
    // malformed *schema* throws a clear `api.params: …` error (author bug),
    // while bad *override values* degrade to defaults inside resolveParamValues.
    const overrides = paramOverrides ?? {};
    const capturedSchemas: ParamSpec[][] = [];
    const params = (schema: unknown): Record<string, number | boolean | string> => {
      const normalized = normalizeParamSchema(schema);
      capturedSchemas.push(normalized);
      // Guard the returned object so a typo'd read (p.widht) throws instead of
      // silently injecting `undefined`/NaN into the geometry.
      return protectParamValues(resolveParamValues(normalized, overrides));
    };
    const collectParamsSchema = (): ParamSpec[] | undefined =>
      capturedSchemas.length > 0 ? mergeParamSchemas(capturedSchemas) : undefined;

    const api = {
      Manifold,
      CrossSection,
      params,
      Curves: curvesNamespace,
      BREP,
      meshOps: meshOpsNamespace,
      sdf: sdfNamespace,
      // Flat aliases for the most-used meshOps verbs — agents reach for shorter
      // names like `api.intersects(a,b)` and `api.placeOn(part, table)` much more
      // often than they reach for the namespace, so we promote those to api.* too.
      // Predicates:
      intersects: meshOpsNamespace.intersects,
      contains: meshOpsNamespace.contains,
      pointInside: meshOpsNamespace.pointInside,
      bbox: meshOpsNamespace.bbox,
      componentBounds: meshOpsNamespace.componentBounds,
      volumeDelta: meshOpsNamespace.volumeDelta,
      // Alignment + patterns:
      alignTo: meshOpsNamespace.alignTo,
      placeOn: meshOpsNamespace.placeOn,
      mirrorAcross: meshOpsNamespace.mirrorAcross,
      mirrorCopy: meshOpsNamespace.mirrorCopy,
      linearPattern: meshOpsNamespace.linearPattern,
      circularPattern: meshOpsNamespace.circularPattern,
      spiralPattern: meshOpsNamespace.spiralPattern,
      // Robust booleans + heal:
      expectUnion: meshOpsNamespace.expectUnion,
      expectDifference: meshOpsNamespace.expectDifference,
      expectComponents: meshOpsNamespace.expectComponents,
      heal: meshOpsNamespace.heal,
      // ----
      setMinCircularAngle,
      setMinCircularEdgeLength,
      setCircularSegments,
      label,
      labeledUnion,
      imports,
      renderMesh,
    };

    // Catch the common misconception that paint tools can be called
    // from inside model code. Paint operations are tool calls (run on
    // window.partwright after the model executes); inside model code,
    // `partwright` is undefined and the user gets a generic
    // ReferenceError that doesn't explain the boundary. The agent's
    // instinct to batch paint calls inside runCode/runAndSave to save
    // round-trips is reasonable but wrong; this gives them an
    // actionable error the first time they try.
    if (/\bpartwright\s*\./.test(jsCode)) {
      const error = 'Model code (runCode / runAndSave / runIsolated) cannot call paint tools like partwright.paintByLabel or partwright.paintInBox. Paint operations are separate tool calls — invoke them between code runs, not inside the code. For batch painting, use partwright.paintByLabels([...]) as a single tool call after runAndSave.';
      return {
        mesh: null,
        manifold: null,
        error,
        diagnostics: runtimeDiagnostic(error, 'Remove the partwright.* call from the model code and invoke paint tools separately.', 'JavaScript'),
      };
    }
    // Bare `exportSTEP(` — same misconception as `partwright.exportSTEP`
    // but without the prefix the agent sometimes drops. Caught here too
    // (in addition to the BREP engine) because a manifold-js sandbox might
    // reach for BREP via `api.BREP` and then assume `exportSTEP` is on the
    // namespace, when it's actually a top-level tool call.
    if (/\bexportSTEP\s*\(/.test(jsCode)) {
      const error = 'exportSTEP is a tool call (partwright.exportSTEP), not a sandbox API. Call it AFTER runAndSave returns — between tool calls — not from inside the model code. Note: STEP export only works in the replicad (BREP) language session, not from manifold-js.';
      return {
        mesh: null,
        manifold: null,
        error,
        diagnostics: runtimeDiagnostic(error, 'Remove the exportSTEP() call from the model code; invoke partwright.exportSTEP() after the run completes (in a BREP session).', 'JavaScript'),
      };
    }

    let result: InstanceType<typeof Manifold> | null = null;

    // Track every Manifold/CrossSection the user's code creates so the
    // intermediates can be freed afterwards (see the memory-management note
    // above). Wrapping is installed now and reverted in `finally`.
    const allocated: Array<{ delete?: () => void }> = [];
    const savedMethods: SavedMethod[] = [];
    const isTrackable = (v: unknown): boolean =>
      v != null && typeof v === 'object' && (v instanceof Manifold || v instanceof CrossSection);
    const track = (v: unknown): void => {
      if (Array.isArray(v)) {
        for (const e of v) if (isTrackable(e)) allocated.push(e as { delete?: () => void });
      } else if (isTrackable(v)) {
        allocated.push(v as { delete?: () => void });
      }
    };
    wrapMethodsForTracking(Manifold, track, savedMethods);
    wrapMethodsForTracking(Manifold.prototype, track, savedMethods);
    wrapMethodsForTracking(CrossSection, track, savedMethods);
    wrapMethodsForTracking(CrossSection.prototype, track, savedMethods);

    try {
      const fn = new Function('api', `"use strict";\n${jsCode}`);
      result = fn(api);

      if (!result || typeof result.getMesh !== 'function') {
        // Common SDF mistake: returning the expression tree without
        // lowering it. Give a targeted hint instead of the generic
        // "did you forget to return" message.
        if (result instanceof SdfNode) {
          const error = 'Code returned an SDF expression, not a Manifold. Add `.build()` to lower it: `return someSdf.build({ edgeLength: 0.5 })`. See /ai/sdf.md.';
          return {
            mesh: null,
            manifold: null,
            error,
            diagnostics: runtimeDiagnostic(error, 'Append `.build()` (or `api.sdf.build(node)`) to the return value to mesh it through Manifold.levelSet.', 'JavaScript'),
          };
        }
        const error = 'Code must return a Manifold object. Did you forget to `return` the final Manifold? See /ai.md#before-you-start';
        return {
          mesh: null,
          manifold: null,
          error,
          diagnostics: runtimeDiagnostic(error, 'Add a final `return` statement that returns the Manifold you want to render.', 'JavaScript'),
        };
      }

      const mesh = result.getMesh();
      // Merge any BREP-side labels that flowed through `BREP.toManifold(...)`
      // calls during this run. Each call queued a `Map<label, Set<triangleId>>`
      // built against the welded BREP tessellation — the same mesh-data we
      // then handed to `Manifold.ofMesh`. As long as the user didn't run
      // further booleans on the resulting Manifold (which would remap
      // triangle ids), the ids are still valid in the final mesh. If the
      // same label name comes from both BREP and an `api.label` call, the
      // triangle sets union — friendliest answer.
      const labelMap = mergeLabelMaps(resolveLabelMap(mesh, labelRegistry), consumeBrepToManifoldLabels());
      // Render-only proxies (from `api.renderMesh`) carry the marker so we can
      // signal downstream "this isn't a real Manifold — skip volume/genus/slice".
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const renderOnly = (result as any)[RENDER_ONLY_MARKER] === true;
      return {
        mesh: {
          vertProperties: mesh.vertProperties,
          triVerts: mesh.triVerts,
          numVert: mesh.numVert,
          numTri: mesh.numTri,
          numProp: mesh.numProp,
          mergeFromVert: mesh.mergeFromVert,
          mergeToVert: mesh.mergeToVert,
          runIndex: mesh.runIndex,
          runOriginalID: mesh.runOriginalID,
        },
        manifold: renderOnly ? null : result,
        error: null,
        labelMap,
        labelColors: labelColors.size > 0 ? labelColors : undefined,
        paramsSchema: collectParamsSchema(),
        renderOnly,
      };
    } catch (e: unknown) {
      let msg = e instanceof Error ? e.message : String(e);
      const isSyntaxError = e instanceof SyntaxError;
      let hint: string | undefined;

      // Enhance common WASM error messages with actionable hints
      if (msg.includes('BindingError') && msg.includes('deleted object')) {
        hint = 'A Manifold or CrossSection was used after being deleted. Avoid calling .delete() on objects you still need, or store intermediate results before cleanup.';
      } else if (msg.includes('function _Cylinder called with')) {
        hint = 'Manifold.cylinder(height, radiusLow, radiusHigh?, segments?) — check argument count and order.';
      } else if (msg.includes('function _Cube called with')) {
        hint = 'Manifold.cube([x, y, z], center?) — first arg must be an array of 3 numbers.';
      } else if (msg.includes('Missing field')) {
        hint = 'You may have passed an array where an object was expected, or vice versa. Check the API signature.';
      } else if (msg.includes('unreachable') || msg.includes('RuntimeError')) {
        hint = 'WASM runtime error — likely caused by degenerate geometry, a self-intersection, or an invalid boolean. Try simplifying the operation or checking input dimensions.';
      }

      if (hint) msg += `\nHint: ${hint}`;
      return {
        mesh: null,
        manifold: null,
        error: msg,
        diagnostics: isSyntaxError ? javaScriptSyntaxDiagnostics(jsCode, msg, e) : runtimeDiagnostic(msg, hint, 'JavaScript'),
        paramsSchema: collectParamsSchema(),
      };
    } finally {
      // Stop tracking, then free every intermediate the run created. The value
      // the user returned (`result`) is spared — its lifecycle belongs to the
      // caller (the worker frees it after extracting the mesh; the sync path in
      // main.ts deletes it after querying volume/bbox).
      restoreMethods(savedMethods);
      disposeAllExcept(allocated, result);
      // BREP shapes don't pass through Manifold.* / CrossSection.* method
      // wrapping (they're created by `BREP.box(...).fillet(...)` chains
      // against a separate namespace), so they accumulate in their own list.
      // Drain it here so the editor's auto-run keystroke loop doesn't leak
      // OCCT shapes on every keystroke. The user's `result` is also spared in
      // case they returned a BrepShape directly without going through
      // BREP.toManifold (uncommon — the manifold-js engine rejects non-
      // Manifold returns above — but defensive).
      disposeBrepAllocationsExcept(consumeBrepAllocations(), result);
    }
  },

  validate(jsCode: string): ValidateResult {
    // Cheap parse check — try to construct the Function without executing.
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

/** Union-merge any number of `Map<label, Set<triangleId>>` into a single
 *  map. The primary use case is folding BREP `BREP.toManifold` labels in
 *  alongside manifold-js `api.label` labels so `paintByLabel` sees both —
 *  see the run() caller. Returns `undefined` only when every input was
 *  undefined / empty (keeps the existing "no labels this run" sentinel). */
function mergeLabelMaps(
  primary: Map<string, Set<number>> | undefined,
  extras: ReadonlyArray<Map<string, Set<number>>>,
): Map<string, Set<number>> | undefined {
  if (extras.length === 0) return primary;
  const out: Map<string, Set<number>> = primary ?? new Map();
  for (const m of extras) {
    for (const [name, tris] of m) {
      let set = out.get(name);
      if (!set) {
        set = new Set<number>();
        out.set(name, set);
      }
      for (const t of tris) set.add(t);
    }
  }
  return out.size === 0 ? undefined : out;
}

/** Walk the result mesh's `runOriginalID` + `runIndex` arrays and bucket
 *  triangles by the human-readable name registered for each id at
 *  `api.label()` time. Multiple runs may carry the same id (a labelled
 *  shape used in two places of the union) — the bucket merges them. */
function resolveLabelMap(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mesh: any,
  registry: Map<number, string>,
): Map<string, Set<number>> | undefined {
  if (registry.size === 0) return undefined;
  const out = new Map<string, Set<number>>();
  const runOriginalID: Uint32Array | undefined = mesh.runOriginalID;
  const runIndex: Uint32Array | undefined = mesh.runIndex;
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
