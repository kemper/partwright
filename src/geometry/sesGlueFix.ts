// Build-time rewrite of the Emscripten/embind glue for SES (#1127).
//
// The engine Worker runs SES `lockdown()` before any engine initialises, with
// `overrideTaming: 'min'` (see SES_LOCKDOWN_OPTIONS in sesModelSource.ts).
// After lockdown every shared intrinsic is frozen, which trips JavaScript's
// "override mistake": assigning a property that an object INHERITS as
// non-writable throws in strict code (and silently fails in sloppy code),
// even though the target object itself is extensible. The glue does exactly
// that on objects whose prototype chain reaches a frozen intrinsic:
//
//   errorClass.prototype.constructor = errorClass;   // embind extendError
//   errorClass.prototype.toString = function () {…};
//   this.message = message;                         // inside those errors
//   this.constructor = constructor;                 // embind RegisteredClass
//   FS.ErrnoError.prototype.constructor = FS.ErrnoError;
//
// `rewriteOverrideMistakes()` turns each such assignment into an own-property
// define with the same result (`__sesOvr(obj, "prop").v = value`): an existing
// own property is assigned as before; a missing one is created as a writable,
// enumerable, configurable data property — exactly what the assignment does
// on unfrozen intrinsics. Semantics are identical with SES off.
//
// It is scoped to the manifold-3d and replicad-opencascadejs glue
// (`isSesGlueModule`). openscad-wasm-prebuilt needs no rewrite. The unit test
// (tests/unit/sesGlueFix.test.ts) runs it over the installed glue and pins the
// number of rewrites per file, so a dependency bump that changes the glue
// fails CI instead of breaking BREP (or manifold-3d init) at runtime.
//
// Pure (no imports) — vite.config.ts and the unit tier both use it.

/** Prepended to a rewritten module. Uses `Object.prototype.hasOwnProperty`
 *  and `Object.defineProperty` read at call time — this is engine glue, not
 *  model code, and runs before any model code exists. */
const HELPER = 'function __sesOvr(o,k){return{set v(x){if(Object.prototype.hasOwnProperty.call(o,k))o[k]=x;else Object.defineProperty(o,k,{value:x,writable:true,enumerable:true,configurable:true})}}}\n';

// `X.prototype.constructor|toString|message = …` and
// `this.constructor|toString|message = …` — but not `==`/`===` comparisons.
const ASSIGNMENT = /\b(this|[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\.prototype)\.(constructor|toString|message)\s*=(?!=)/g;

/** True for a module id (path, possibly with a query) whose code is
 *  manifold-3d's or replicad-opencascadejs's Emscripten glue, including Vite's
 *  pre-bundled copies (node_modules/.vite/deps, or VITE_CACHE_DIR's). */
export function isSesGlueModule(id: string): boolean {
  if (!/\.m?js(\?|$)/.test(id)) return false;
  const path = id.replace(/\\/g, '/');
  return /\/node_modules\/(?:manifold-3d\/|replicad-opencascadejs\/)/.test(path)
    // Vite's dependency pre-bundle (`<cacheDir>/deps/<pkg>_<path>.js`).
    || /\/deps(?:_[^/]+)?\/(?:manifold-3d|replicad-opencascadejs)[^/]*\.js(\?|$)/.test(path);
}

/** Rewrite the override-mistake assignments in `code`. Returns the new code
 *  and how many assignments were rewritten (0 → `code` unchanged). */
export function rewriteOverrideMistakes(code: string): { code: string; count: number } {
  let count = 0;
  const out = code.replace(ASSIGNMENT, (_m, obj: string, prop: string) => {
    count++;
    return `__sesOvr(${obj},"${prop}").v=`;
  });
  return count > 0 ? { code: HELPER + out, count } : { code, count: 0 };
}
