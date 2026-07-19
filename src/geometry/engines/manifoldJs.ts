import type { Engine, MeshResult, ValidateResult } from './types';
import { javaScriptSyntaxDiagnostics, runtimeDiagnostic } from '../sourceDiagnostics';
import { createCurvesNamespace } from '../curves';
import { createMeshOpsNamespace } from '../meshOps';
import { createParamCapture } from '../params';
import { preloadTextFonts } from '../textGlyphs';
import { getDefaultCircularSegments } from '../qualitySettings';
import { getActiveImports } from '../../import/importedMesh';
import { createSdfNamespace, SdfNode } from '../sdf';
import { createGeom2dNamespace } from '../geom2d';
import { createFastenersNamespace } from '../fasteners';
import { createJointsNamespace } from '../joints';
import { createGearsNamespace } from '../gears';
import { createThreadsNamespace } from '../threads';
import { createEnclosureNamespace } from '../enclosure';
import { createKnurlNamespace } from '../knurl';
import { createSculptOps } from '../sculpt';
import { getBrepNamespace, consumeBrepAllocations, disposeBrepAllocationsExcept, consumeBrepToManifoldLabels, consumeBrepToManifoldLabelColors } from '../brepRuntime';
import { parseLabelColor } from '../../color/labelColor';
import type { RegionDescriptor } from '../../color/regions';
import { COLOR_PATTERN_KINDS, type ColorPatternKind, type PatternScope } from '../../color/colorPattern';
import { SURFACE_OP_FIELDS, isSurfaceOpId, parseSurfaceOpts, type SurfaceOp, type SurfaceOpId } from '../../surface/surfaceOpSpec';
import { isMaterialPresetName, MATERIAL_PRESET_NAMES, type MaterialSpec } from '../../renderer/materialSpec';
import { wasmFaultHint } from '../workerFaults';
import { assertNumber, assertNumberTuple, ValidationError } from '../../validation/apiValidation';

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
// Memoized init so two concurrent first-callers (e.g. a direct initEngine()
// racing replicadEngine.init(), which also calls this) share ONE WASM
// instantiation instead of each loading the module and rebuilding every
// namespace singleton — the second clobbering the first mid-flight. Mirrors the
// OpenSCAD engine / ensureBrepLoaded pattern.
let manifoldInitPromise: Promise<void> | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let curvesNamespace: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let meshOpsNamespace: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let fastenersNamespace: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let jointsNamespace: any = null;
// Deprecated back-compat alias — old saved sessions call api.printFit.*; it
// spreads both the fasteners and joints namespaces. Never remove.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let printFitAlias: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let geom2dNamespace: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let gearsNamespace: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let threadsNamespace: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let enclosureNamespace: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let knurlNamespace: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let sculptNamespace: any = null;

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

// Argument guards for the dimension-taking primitive constructors. Several of
// these take a *required* positive dimension with no default —
// `Manifold.sphere(radius)`, `CrossSection.circle(radius)`,
// `Manifold.cylinder(height, radiusLow)`. Calling them with a missing or NaN
// argument (e.g. `Manifold.sphere()` while the user is still typing the radius,
// which the editor's live auto-run executes the moment they pause) does NOT
// throw in the WASM kernel: it coerces `undefined` to NaN and silently builds a
// degenerate zero-size solid — all vertices at the origin — that the kernel
// reports as a successful, non-empty result. That degenerate mesh then froze
// the viewport (its zero-size bounding box drove OrbitControls into a
// non-converging NaN damping loop). Validate the dimensions up front so the
// caller gets an actionable error instead. The renderer also guards against
// degenerate bounds as a backstop; this layer turns the common authoring
// mistake into a clear message at its source.
//
// Installed before `wrapMethodsForTracking` and restored after it (reverse
// order) so the validation and allocation-tracking wrappers compose cleanly.
function installPrimitiveGuards(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Manifold: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  CrossSection: any,
  saved: SavedMethod[],
): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const wrap = (target: any, name: string, validate: (args: unknown[]) => void): void => {
    const orig = target?.[name];
    if (typeof orig !== 'function') return;
    try {
      target[name] = function (this: unknown, ...args: unknown[]) {
        validate(args);
        return (orig as (...a: unknown[]) => unknown).apply(this, args);
      };
      saved.push([target, name, orig]);
    } catch { /* non-writable Embind member — skip */ }
  };

  // A `size` arg shaped `number | [..dims]`, optional because cube()/square()
  // default to a unit shape. Only validated when the caller passed something;
  // every component must be a finite positive number.
  const assertSize = (val: unknown, dims: number, paramName: string): void => {
    if (val === undefined) return;
    if (Array.isArray(val)) {
      const t = assertNumberTuple(val, dims, paramName);
      for (let i = 0; i < t.length; i++) {
        if (t[i] < 1e-6) {
          throw new ValidationError(`${paramName}[${i}] must be > 0, got ${t[i]}. See /ai.md#argument-validation`);
        }
      }
    } else {
      assertNumber(val, paramName, { min: 1e-6 });
    }
  };

  wrap(Manifold, 'sphere', (a) => { assertNumber(a[0], 'Manifold.sphere(radius)', { min: 1e-6 }); });
  wrap(Manifold, 'cylinder', (a) => {
    assertNumber(a[0], 'Manifold.cylinder(height)', { min: 1e-6 });
    assertNumber(a[1], 'Manifold.cylinder(radiusLow)', { min: 1e-6 });
    if (a[2] !== undefined) assertNumber(a[2], 'Manifold.cylinder(radiusHigh)', { min: 0 });
  });
  wrap(Manifold, 'cube', (a) => { assertSize(a[0], 3, 'Manifold.cube(size)'); });
  wrap(CrossSection, 'circle', (a) => { assertNumber(a[0], 'CrossSection.circle(radius)', { min: 1e-6 }); });
  wrap(CrossSection, 'square', (a) => { assertSize(a[0], 2, 'CrossSection.square(size)'); });
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
    if (manifoldInitPromise) return manifoldInitPromise;
    manifoldInitPromise = (async () => {
      const Module = await import('manifold-3d');
      const mod = await Module.default();
      mod.setup();
      curvesNamespace = createCurvesNamespace(mod);
      meshOpsNamespace = createMeshOpsNamespace(mod);
      // Fasteners shares the Curves text helper so its calibration coupon can
      // emboss values; Curves is constructed just above, so the dep is ready.
      fastenersNamespace = createFastenersNamespace(mod, { text: curvesNamespace.text });
      jointsNamespace = createJointsNamespace(mod);
      // Deprecated back-compat alias — old saved sessions call api.printFit.*
      // (the namespace that was split into fasteners + joints). Never remove.
      printFitAlias = Object.freeze({ ...fastenersNamespace, ...jointsNamespace });
      // 2D sketch-primitive namespace (api.geom). Only needs CrossSection, so
      // it's a module-level singleton like Curves/meshOps.
      geom2dNamespace = createGeom2dNamespace(mod);
      gearsNamespace = createGearsNamespace(mod);
      threadsNamespace = createThreadsNamespace(mod);
      // Enclosure composes the fasteners library (screw-lid bosses/holes,
      // standoff bores), so it's built after fastenersNamespace above.
      enclosureNamespace = createEnclosureNamespace(mod, { fasteners: fastenersNamespace });
      knurlNamespace = createKnurlNamespace(mod);
      sculptNamespace = createSculptOps(mod);
      // Publish the fully-built module only after every namespace is ready, so
      // a concurrent caller that sees `manifoldModule` set never observes a
      // half-initialised set of namespaces.
      manifoldModule = mod;
      // Kick off font pre-loading in the background so they're ready by the
      // time the first api.text() call hits, even if the per-run regex didn't
      // fire (e.g. destructured alias or api.Curves.text).
      preloadTextFonts().catch(() => { /* will surface as a clear error at call time */ });
    })();
    try {
      await manifoldInitPromise;
    } catch (e) {
      manifoldInitPromise = null; // allow a retry after a failed init
      throw e;
    }
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

    // Paint operations declared in code via `api.paint.*` (box / slab / cylinder /
    // label). Recorded here during evaluation — they intentionally do NOT touch
    // the mesh; the main thread resolves each descriptor's triangles against the
    // freshly-run mesh after tessellation (exactly like `api.label({color})`) and
    // renders them as the model-color underlay. The code is the source of truth,
    // so these are never written to the paint sidecar. Last-recorded wins on
    // overlap, in declaration order. Cleared on every run.
    const paintOps: { name: string; color: [number, number, number]; descriptor: RegionDescriptor }[] = [];
    let paintSeq = 0;

    // Viewport material declared in code via `api.material(...)` — a shading
    // preset (brass/glass/…) applied by the main thread's viewport after the
    // run. Recorded, not baked: geometry and exports are untouched, and because
    // it lives in the code it re-applies on every run/load with no schema
    // change. Last call wins. Cleared on every run.
    let materialSpec: MaterialSpec | null = null;

    // Surface textures declared in code via `api.surface.*` (fuzzy / knit / cable
    // / waffle / fur / woven / voronoi / smooth). Like `api.paint.*`, these do
    // NOT touch the mesh during evaluation — they record an ordered chain of
    // ops that the MAIN thread applies to the final returned mesh after the run
    // (reusing the existing modifier math, which is main-thread + WebGPU). The
    // code is the source of truth, so the textured result is never baked into
    // `api.imports[0]`; it's recomputed (and memoized) from these ops. Cleared
    // on every run. See `src/surface/surfaceOps.ts`.
    const surfaceOps: SurfaceOp[] = [];

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

    // === api.paint.* — paint declared in code (recorded, resolved post-run) ===
    //
    // Each call records a RegionDescriptor + color; the main thread resolves it
    // against the run's mesh and renders it as the model-color underlay. These
    // are the in-code counterparts of the `paintInBox` / `paintSlab` /
    // `paintInCylinder` / `paintByLabel` tools, so a model that returns geometry
    // can also describe its own colors without a separate paint pass.
    const paintColor = (color: unknown, where: string): [number, number, number] => {
      const rgb = parseLabelColor(color);
      if (!rgb) throw new Error(`${where}: color must be a hex string like "#3b82f6" or an [r,g,b] array of three numbers in 0..1.`);
      return rgb;
    };
    const paintVec3 = (v: unknown, where: string): [number, number, number] => {
      if (!Array.isArray(v) || v.length !== 3 || v.some(n => typeof n !== 'number' || !Number.isFinite(n))) {
        throw new Error(`${where}: expected an array of 3 finite numbers, e.g. [x, y, z].`);
      }
      return v as [number, number, number];
    };
    const paintNum = (v: unknown, where: string): number => {
      if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`${where}: expected a finite number.`);
      return v;
    };
    const paintObj = (opts: unknown, where: string): Record<string, unknown> => {
      if (!opts || typeof opts !== 'object' || Array.isArray(opts)) {
        throw new Error(`${where}: expects an options object.`);
      }
      return opts as Record<string, unknown>;
    };
    const paintRejectUnknown = (where: string, rest: Record<string, unknown>): void => {
      const keys = Object.keys(rest);
      if (keys.length > 0) throw new Error(`${where}: unknown key(s) ${keys.map(k => `"${k}"`).join(', ')}.`);
    };
    const AXIS_NORMAL: Record<string, [number, number, number]> = {
      x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1],
    };

    const paint = {
      /** Paint every triangle inside an axis-aligned box. `min`/`max` are world-space corners. */
      box(opts: unknown): void {
        const o = paintObj(opts, 'api.paint.box({ min, max, color })');
        const { min, max, color, ...rest } = o;
        paintRejectUnknown('api.paint.box', rest);
        const lo = paintVec3(min, 'api.paint.box min');
        const hi = paintVec3(max, 'api.paint.box max');
        const rgb = paintColor(color, 'api.paint.box');
        const center: [number, number, number] = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
        const size: [number, number, number] = [Math.abs(hi[0] - lo[0]), Math.abs(hi[1] - lo[1]), Math.abs(hi[2] - lo[2])];
        paintOps.push({ name: `paint·box ${++paintSeq}`, color: rgb, descriptor: { kind: 'box', center, size, quaternion: [0, 0, 0, 1], shape: 'box' } });
      },
      /** Paint a flat band (slab). Give `axis: 'x'|'y'|'z'` or an explicit `normal`,
       *  plus `offset` (signed distance along the normal to the band centre) and `thickness`. */
      slab(opts: unknown): void {
        const o = paintObj(opts, "api.paint.slab({ axis, offset, thickness, color })");
        const { axis, normal, offset, thickness, color, ...rest } = o;
        paintRejectUnknown('api.paint.slab', rest);
        let nrm: [number, number, number];
        if (axis !== undefined) {
          if (typeof axis !== 'string' || !(axis in AXIS_NORMAL)) throw new Error("api.paint.slab axis: expected 'x', 'y' or 'z' (or pass an explicit normal).");
          nrm = AXIS_NORMAL[axis];
        } else if (normal !== undefined) {
          nrm = paintVec3(normal, 'api.paint.slab normal');
        } else {
          throw new Error("api.paint.slab: provide either axis ('x'|'y'|'z') or an explicit normal [x, y, z].");
        }
        const off = paintNum(offset, 'api.paint.slab offset');
        const thk = paintNum(thickness, 'api.paint.slab thickness');
        if (thk <= 0) throw new Error('api.paint.slab thickness: must be > 0.');
        const rgb = paintColor(color, 'api.paint.slab');
        paintOps.push({ name: `paint·slab ${++paintSeq}`, color: rgb, descriptor: { kind: 'slab', normal: nrm, offset: off, thickness: thk } });
      },
      /** Paint a (possibly annular) vertical cylinder shell. `center` is [x, y];
       *  `rMin` (default 0) / `rMax` are radii; `zMin` / `zMax` bound the height. */
      cylinder(opts: unknown): void {
        const o = paintObj(opts, 'api.paint.cylinder({ center, rMin, rMax, zMin, zMax, color })');
        const { center, rMin, rMax, zMin, zMax, color, ...rest } = o;
        paintRejectUnknown('api.paint.cylinder', rest);
        if (!Array.isArray(center) || center.length !== 2 || center.some(n => typeof n !== 'number' || !Number.isFinite(n))) {
          throw new Error('api.paint.cylinder center: expected [x, y] (two finite numbers).');
        }
        const c = center as [number, number];
        const r0 = rMin === undefined ? 0 : paintNum(rMin, 'api.paint.cylinder rMin');
        const r1 = paintNum(rMax, 'api.paint.cylinder rMax');
        const z0 = paintNum(zMin, 'api.paint.cylinder zMin');
        const z1 = paintNum(zMax, 'api.paint.cylinder zMax');
        if (r0 < 0 || r1 <= r0) throw new Error('api.paint.cylinder: require 0 <= rMin < rMax.');
        if (z1 <= z0) throw new Error('api.paint.cylinder: require zMin < zMax.');
        const rgb = paintColor(color, 'api.paint.cylinder');
        paintOps.push({ name: `paint·cyl ${++paintSeq}`, color: rgb, descriptor: { kind: 'cylinder', center: c, rMin: r0, rMax: r1, zMin: z0, zMax: z1 } });
      },
      /** Recolour triangles belonging to an existing `api.label(shape, name)` region.
       *  Call as `api.paint.label('name', color)` or `api.paint.label({ label, color })`. */
      label(nameOrOpts: unknown, color?: unknown): void {
        let labelName: unknown;
        let col: unknown;
        if (typeof nameOrOpts === 'string') {
          labelName = nameOrOpts;
          col = color;
        } else {
          const o = paintObj(nameOrOpts, "api.paint.label('name', color)");
          const { label: l, color: c, ...rest } = o;
          paintRejectUnknown('api.paint.label', rest);
          labelName = l;
          col = c;
        }
        if (typeof labelName !== 'string' || labelName.length === 0) throw new Error('api.paint.label: label must be a non-empty string naming an api.label(...) region.');
        const rgb = paintColor(col, 'api.paint.label');
        paintOps.push({ name: `paint·label ${labelName}`, color: rgb, descriptor: { kind: 'byLabel', label: labelName } });
      },
      /** Algorithmic colourway — fill a scope with a procedural pattern, the colour
       *  twin of `api.surface.*` textures. Every triangle in `scope` gets ONE palette
       *  colour from a field, so the result stays multi-material printable.
       *  `api.paint.pattern({ pattern, colors, scope, scale, axis, warp, coverage, seed })`
       *   - pattern: 'stripes' (tabby/tiger/zebra/brindle) | 'spots' (leopard/dalmatian)
       *              | 'patches' (calico/cow/tortie) | 'gradient' (siamese points)
       *              | 'checker' (3D checkerboard by cell parity)
       *   - colors:  [base, mark, third?] — hex or [r,g,b]; ≥2 required
       *   - scope:   'labelName' (e.g. 'body', so it never touches eyes/nose) — omit = whole model */
      pattern(opts: unknown): void {
        const o = paintObj(opts, "api.paint.pattern({ pattern, colors, scope?, scale?, axis?, warp?, coverage?, seed?, anchors? })");
        const { pattern, colors, scope, scale, axis, warp, coverage, seed, anchors, ...rest } = o;
        paintRejectUnknown('api.paint.pattern', rest);
        if (typeof pattern !== 'string' || !COLOR_PATTERN_KINDS.includes(pattern as ColorPatternKind)) {
          throw new Error(`api.paint.pattern pattern: expected one of ${COLOR_PATTERN_KINDS.map(k => `'${k}'`).join(', ')}.`);
        }
        if (!Array.isArray(colors) || colors.length < 2) {
          throw new Error('api.paint.pattern colors: expected an array of at least 2 colors [base, mark, third?].');
        }
        const rgbColors = colors.map((c, i) => paintColor(c, `api.paint.pattern colors[${i}]`));
        let scopeObj: PatternScope | undefined;
        if (scope !== undefined) {
          if (typeof scope === 'string') {
            if (scope.length === 0) throw new Error('api.paint.pattern scope: label name must be non-empty.');
            scopeObj = { label: scope };
          } else if (scope && typeof scope === 'object' && !Array.isArray(scope)) {
            const { label: l, above, below, box, sphere, ...srest } = scope as Record<string, unknown>;
            paintRejectUnknown('api.paint.pattern scope', srest);
            const s: PatternScope = {};
            if (l !== undefined) {
              if (typeof l !== 'string' || l.length === 0) throw new Error('api.paint.pattern scope.label: must be a non-empty string.');
              s.label = l;
            }
            const parsePlane = (v: unknown, where: string): { axis: 'x' | 'y' | 'z'; at: number } => {
              const o = paintObj(v, where);
              const { axis: a, at, ...rest } = o;
              paintRejectUnknown(where, rest);
              if (typeof a !== 'string' || !(a in AXIS_NORMAL)) throw new Error(`${where}.axis: expected 'x', 'y' or 'z'.`);
              return { axis: a as 'x' | 'y' | 'z', at: paintNum(at, `${where}.at`) };
            };
            if (above !== undefined) s.above = parsePlane(above, 'api.paint.pattern scope.above');
            if (below !== undefined) s.below = parsePlane(below, 'api.paint.pattern scope.below');
            if (box !== undefined) {
              const o = paintObj(box, 'api.paint.pattern scope.box');
              const { min, max, ...rest } = o;
              paintRejectUnknown('api.paint.pattern scope.box', rest);
              s.box = { min: paintVec3(min, 'api.paint.pattern scope.box.min'), max: paintVec3(max, 'api.paint.pattern scope.box.max') };
            }
            if (sphere !== undefined) {
              const o = paintObj(sphere, 'api.paint.pattern scope.sphere');
              const { center, radius, ...rest } = o;
              paintRejectUnknown('api.paint.pattern scope.sphere', rest);
              const rad = paintNum(radius, 'api.paint.pattern scope.sphere.radius');
              if (rad <= 0) throw new Error('api.paint.pattern scope.sphere.radius: must be > 0.');
              s.sphere = { center: paintVec3(center, 'api.paint.pattern scope.sphere.center'), radius: rad };
            }
            scopeObj = Object.keys(s).length > 0 ? s : undefined;
          } else {
            throw new Error("api.paint.pattern scope: expected a label name string (e.g. 'body') or { label, above, below, box, sphere }.");
          }
        }
        if (axis !== undefined && (typeof axis !== 'string' || !(axis in AXIS_NORMAL))) {
          throw new Error("api.paint.pattern axis: expected 'x', 'y' or 'z'.");
        }
        let anchorPts: [number, number, number][] | undefined;
        if (anchors !== undefined) {
          if (!Array.isArray(anchors)) throw new Error('api.paint.pattern anchors: expected an array of [x, y, z] points.');
          anchorPts = anchors.map((a, i) => paintVec3(a, `api.paint.pattern anchors[${i}]`));
        }
        const descriptor: RegionDescriptor = {
          kind: 'pattern',
          pattern: pattern as ColorPatternKind,
          colors: rgbColors,
          ...(scopeObj ? { scope: scopeObj } : {}),
          ...(scale !== undefined ? { scale: paintNum(scale, 'api.paint.pattern scale') } : {}),
          ...(axis !== undefined ? { axis: axis as 'x' | 'y' | 'z' } : {}),
          ...(warp !== undefined ? { warp: paintNum(warp, 'api.paint.pattern warp') } : {}),
          ...(coverage !== undefined ? { coverage: paintNum(coverage, 'api.paint.pattern coverage') } : {}),
          ...(seed !== undefined ? { seed: paintNum(seed, 'api.paint.pattern seed') } : {}),
          ...(anchorPts ? { anchors: anchorPts } : {}),
        };
        paintOps.push({ name: `paint·pattern ${pattern} ${++paintSeq}`, color: rgbColors[0], descriptor });
      },
    };

    // === api.surface.* — surface textures declared in code (recorded, applied
    // post-run on the main thread, memoized). Each call appends one op to the
    // chain; the chain is applied to the final returned mesh. Unlike the Surface
    // panel's destructive bake, the parametric op stays in the code — edit a
    // param and press "Re-apply" to recompute. ===
    const recordSurfaceOp = (id: SurfaceOpId, params: unknown): void => {
      let opts: Record<string, unknown> = {};
      if (params !== undefined && params !== null) {
        if (typeof params !== 'object' || Array.isArray(params)) {
          throw new Error(`api.surface.${id}(options): options must be a plain object, e.g. { amplitude: 0.5 }.`);
        }
        opts = params as Record<string, unknown>;
      }
      // parseSurfaceOpts validates the scalar params AND the reserved scope keys
      // (label / region) — the single source of truth shared with the console
      // twin (applySurfaceTextureAsCode).
      const parsed = parseSurfaceOpts(id, opts);
      surfaceOps.push(parsed.scope ? { id, params: parsed.params, scope: parsed.scope } : { id, params: parsed.params });
    };
    const makeSurfaceFn = (id: SurfaceOpId) => (params?: unknown): void => recordSurfaceOp(id, params);
    const surface: Record<SurfaceOpId, (params?: unknown) => void> & { apply(id: unknown, params?: unknown): void } = {
      fuzzy: makeSurfaceFn('fuzzy'),
      knit: makeSurfaceFn('knit'),
      cable: makeSurfaceFn('cable'),
      waffle: makeSurfaceFn('waffle'),
      fur: makeSurfaceFn('fur'),
      woven: makeSurfaceFn('woven'),
      knurl: makeSurfaceFn('knurl'),
      voronoi: makeSurfaceFn('voronoi'),
      smooth: makeSurfaceFn('smooth'),
      /** Generic form: `api.surface.apply('knit', { … })` — handy for data-driven code. */
      apply(id: unknown, params?: unknown): void {
        if (!isSurfaceOpId(id)) {
          throw new Error(`api.surface.apply(id): id must be one of ${Object.keys(SURFACE_OP_FIELDS).join(', ')}.`);
        }
        recordSurfaceOp(id, params);
      },
    };

    // === api.material — declare the viewport shading material in code ===
    const material = (nameOrOpts: unknown): void => {
      const usage = `api.material(preset | { preset?, color?, metalness?, roughness?, clearcoat?, transmission?, opacity? }) — presets: ${MATERIAL_PRESET_NAMES.join(', ')}`;
      let spec: MaterialSpec;
      if (typeof nameOrOpts === 'string') {
        if (!isMaterialPresetName(nameOrOpts)) {
          throw new Error(`api.material: unknown preset "${nameOrOpts}". ${usage}`);
        }
        spec = { preset: nameOrOpts };
      } else if (nameOrOpts && typeof nameOrOpts === 'object' && !Array.isArray(nameOrOpts)) {
        const o = nameOrOpts as Record<string, unknown>;
        const { preset, color, metalness, roughness, clearcoat, transmission, opacity, ...rest } = o;
        const unknownKeys = Object.keys(rest);
        if (unknownKeys.length > 0) {
          throw new Error(`api.material: unknown key(s) ${unknownKeys.map(k => `"${k}"`).join(', ')}. ${usage}`);
        }
        spec = {};
        if (preset !== undefined) {
          if (!isMaterialPresetName(preset)) throw new Error(`api.material: unknown preset "${String(preset)}". ${usage}`);
          spec.preset = preset;
        }
        if (color !== undefined) {
          const rgb = parseLabelColor(color);
          if (!rgb) throw new Error('api.material color: expected a hex string like "#b87333" or an [r,g,b] array of three numbers in 0..1.');
          spec.color = rgb;
        }
        const unit = (v: unknown, name: string): number => {
          if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1) {
            throw new Error(`api.material ${name}: expected a number in 0..1.`);
          }
          return v;
        };
        if (metalness !== undefined) spec.metalness = unit(metalness, 'metalness');
        if (roughness !== undefined) spec.roughness = unit(roughness, 'roughness');
        if (clearcoat !== undefined) spec.clearcoat = unit(clearcoat, 'clearcoat');
        if (transmission !== undefined) spec.transmission = unit(transmission, 'transmission');
        if (opacity !== undefined) spec.opacity = unit(opacity, 'opacity');
        if (Object.keys(spec).length === 0) throw new Error(`api.material: options object is empty. ${usage}`);
      } else {
        throw new Error(`api.material: expected a preset name or an options object. ${usage}`);
      }
      materialSpec = spec;
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
    // this run, falling back to each declared default). The shared capture
    // records every call's normalized schema so we can surface it to the
    // Parameters panel via `paramCapture.collectSchema()` below — the same
    // helper the voxel and replicad JS engines use, so all three behave
    // identically.
    const paramCapture = createParamCapture(paramOverrides);

    const api = {
      Manifold,
      CrossSection,
      params: paramCapture.params,
      Curves: curvesNamespace,
      BREP,
      meshOps: meshOpsNamespace,
      sdf: sdfNamespace,
      geom: geom2dNamespace,
      fasteners: fastenersNamespace,
      joints: jointsNamespace,
      // Deprecated back-compat alias — old saved sessions call api.printFit.*. Never remove.
      printFit: printFitAlias,
      gears: gearsNamespace,
      threads: threadsNamespace,
      enclosure: enclosureNamespace,
      knurl: knurlNamespace,
      // Text helpers — flat aliases so agents can write api.text(...) directly.
      text: curvesNamespace.text,
      textSection: curvesNamespace.textSection,
      // 3D constructors — flat aliases so agents reach api.loft(...) /
      // api.sweep(...) / api.sweepArc(...) directly (they consistently try the
      // short name before the Curves namespace).
      loft: curvesNamespace.loft,
      sweep: curvesNamespace.sweep,
      sweepArc: curvesNamespace.sweepArc,
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
      // Surface scatter + named deforms + SDF rounding/welding (Blender-parity
      // verbs — see /ai/deform.md):
      scatter: meshOpsNamespace.scatter,
      wrapAround: meshOpsNamespace.wrapAround,
      bend: meshOpsNamespace.bend,
      twist: meshOpsNamespace.twist,
      taper: meshOpsNamespace.taper,
      alongCurve: meshOpsNamespace.alongCurve,
      round: meshOpsNamespace.round,
      smoothWeld: meshOpsNamespace.smoothWeld,
      // Declarative sculpt nudges (grab / inflate / flatten):
      sculpt: sculptNamespace,
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
      paint,
      surface,
      material,
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
    // Validate primitive dimensions before the tracking wrap so a degenerate
    // `Manifold.sphere()` / `cylinder()` / `circle()` fails with a clear error
    // instead of building a viewport-freezing zero-size solid. Restored after
    // the tracking wrap in `finally` (reverse install order).
    const savedGuards: SavedMethod[] = [];
    installPrimitiveGuards(Manifold, CrossSection, savedGuards);
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
      // Fold in any colors declared via `BREP.label(s, name, { color })` in this
      // run (Phase C). An `api.label` color for the same name wins (it's the
      // more direct manifold-side declaration), so only set names not already
      // colored above.
      for (const brepColors of consumeBrepToManifoldLabelColors()) {
        for (const [name, rgb] of brepColors) {
          if (!labelColors.has(name)) labelColors.set(name, rgb);
        }
      }
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
        paintOps: paintOps.length > 0 ? paintOps : undefined,
        surfaceOps: surfaceOps.length > 0 ? surfaceOps : undefined,
        materialSpec: materialSpec ?? undefined,
        paramsSchema: paramCapture.collectSchema(),
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
      } else if (wasmFaultHint(msg)) {
        // Fatal WASM trap — memory exhaustion ("memory access out of bounds") or
        // an abort. Give the memory-aware mitigation; the engine client recycles
        // the Worker so the next run starts from a clean module.
        hint = wasmFaultHint(msg);
      }

      if (hint) msg += `\nHint: ${hint}`;
      return {
        mesh: null,
        manifold: null,
        error: msg,
        diagnostics: isSyntaxError ? javaScriptSyntaxDiagnostics(jsCode, msg, e) : runtimeDiagnostic(msg, hint, 'JavaScript'),
        paramsSchema: paramCapture.collectSchema(),
      };
    } finally {
      // Stop tracking, then free every intermediate the run created. The value
      // the user returned (`result`) is spared — its lifecycle belongs to the
      // caller (the worker frees it after extracting the mesh; the sync path in
      // main.ts deletes it after querying volume/bbox).
      restoreMethods(savedMethods);
      restoreMethods(savedGuards);
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
      // Drain the BREP→Manifold label/color side-channels unconditionally. On
      // the success path above they're already consumed (so these return empty);
      // on the error path a `BREP.toManifold(...)` that queued labels/colors
      // before a later line threw would otherwise leave them queued and bleed
      // into the NEXT run's labelMap/labelColors (names like "body" collide
      // across unrelated models). Discard whatever's left here either way.
      consumeBrepToManifoldLabels();
      consumeBrepToManifoldLabelColors();
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
