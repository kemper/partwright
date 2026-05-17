import type { Engine, MeshResult, ValidateResult } from './types';
import { javaScriptSyntaxDiagnostics, runtimeDiagnostic } from '../sourceDiagnostics';
import { getDefaultCircularSegments } from '../qualitySettings';
import { getActiveImports } from '../../import/importedMesh';

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
export function getManifoldModule(): any {
  return manifoldModule;
}

export const manifoldJsEngine: Engine = {
  id: 'manifold-js',

  async init() {
    if (manifoldModule) return;
    const Module = await import('manifold-3d');
    manifoldModule = await Module.default();
    manifoldModule.setup();
  },

  isReady() {
    return manifoldModule !== null;
  },

  run(jsCode: string): MeshResult {
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

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const label = (shape: any, name: unknown): any => {
      if (!shape || typeof shape.asOriginal !== 'function' || typeof shape.add !== 'function') {
        throw new Error('api.label(shape, name): shape must be a Manifold (returned by Manifold.cube/sphere/cylinder/extrude/etc.)');
      }
      if (typeof name !== 'string' || name.length === 0) {
        throw new Error('api.label(shape, name): name must be a non-empty string');
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
        throw new Error('api.labeledUnion(parts): non-empty array required, each element { name: string, shape: Manifold }');
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let acc: any = null;
      for (const p of parts) {
        if (!p || typeof p !== 'object') {
          throw new Error('api.labeledUnion: each entry must be { name: string, shape: Manifold }');
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const entry = p as { name?: unknown; shape?: any };
        const labelled = label(entry.shape, entry.name);
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

    const api = {
      Manifold,
      CrossSection,
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

    let result: InstanceType<typeof Manifold> | null = null;
    try {
      const fn = new Function('api', `"use strict";\n${jsCode}`);
      result = fn(api);

      if (!result || typeof result.getMesh !== 'function') {
        const error = 'Code must return a Manifold object. Did you forget to `return` the final Manifold? See /ai.md#before-you-start';
        return {
          mesh: null,
          manifold: null,
          error,
          diagnostics: runtimeDiagnostic(error, 'Add a final `return` statement that returns the Manifold you want to render.', 'JavaScript'),
        };
      }

      const mesh = result.getMesh();
      const labelMap = resolveLabelMap(mesh, labelRegistry);
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
      };
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
