// Single choke point for turning model-code source into a callable (#1127).
//
// Every JS engine (manifold-js, voxel, replicad) compiles the user's model code
// through `compileModelCode(code)`. Until a compiler is installed that is
// EXACTLY the legacy `new Function('api', '"use strict";\n' + code)`. The
// engine Worker installs the SES compiler (sesSandbox.ts) during its init
// handshake — after `lockdown()` and before any model code — so model code is
// evaluated in a fresh Hardened JavaScript `Compartment` per run: it sees only
// `api` plus a few hardened endowments, and every shared built-in is frozen.
// With the kill switch on (sesSandboxFlag.ts), or outside the engine Worker
// (Node `model:preview`, unit tests), nothing is installed and the legacy path
// runs unchanged.
//
// `hardenModelShared(x)` is the companion hook for objects that model code can
// reach and that outlive one run (embind classes, namespace singletons): the
// engines call it on their run's `api`, and it deep-freezes that graph when the
// SES compiler is installed. Without SES it is the identity function, so the
// engines' behaviour is unchanged.
//
// This module is a dependency-free leaf on purpose: the engines import it, and
// only the Worker's SES bootstrap (loaded on demand) imports `ses`.

/** The callable a compiled model becomes: `fn(api)` returns the model result. */
export type ModelFn = (api: unknown) => unknown;

type Compiler = (jsCode: string) => ModelFn;
type Hardener = <T>(x: T) => T;

let compiler: Compiler | null = null;
let hardener: Hardener | null = null;
let compilerName: 'function' | 'ses-compartment' = 'function';

/** Install the compiler (and the matching `harden`) used for every later
 *  compile. One-shot: the SES bootstrap calls it once, before any model code
 *  has run. */
export function installModelCompiler(c: Compiler, harden: Hardener): void {
  if (compiler !== null) throw new Error('model compiler already installed');
  compiler = c;
  hardener = harden;
  compilerName = 'ses-compartment';
}

/** 'function' (legacy `new Function`) or 'ses-compartment'. */
export function modelCompilerName(): 'function' | 'ses-compartment' {
  return compilerName;
}

/** Compile (but don't run) model code. The returned function takes `api`.
 *  Throws the engine's SyntaxError for unparsable source. */
export function compileModelCode(jsCode: string): ModelFn {
  if (compiler !== null) return compiler(jsCode);
  return new Function('api', `"use strict";\n${jsCode}`) as ModelFn;
}

/** Deep-freeze `x` (and everything reachable from it through properties and
 *  prototypes) when model code runs in SES compartments, so one run can't
 *  patch an object a later run — or the engine — uses. Identity otherwise. */
export function hardenModelShared<T>(x: T): T {
  return hardener !== null ? hardener(x) : x;
}

/** Lock down a run's list of bulk-data records (imported meshes: a few
 *  numbers plus typed arrays) WITHOUT walking the typed arrays.
 *
 *  `hardenModelShared` must never reach a big typed array: hardening one lists
 *  every element as an own key, so a 1.8M-triangle import (8M elements) cost
 *  about 10 s on EVERY run, before the model code started. And it buys
 *  nothing there — elements can't be frozen, and these arrays are copied for
 *  each execute request, so nothing written to them reaches a later request.
 *  So this does by hand what harden would have done to them: the list and
 *  each record are frozen, each typed array is made non-extensible, and
 *  anything else a record holds (any own key, accessors included) is hardened
 *  as usual.
 *
 *  The caller must expose the list on `api` through an ACCESSOR
 *  (`get imports() { return list; }`). harden freezes an accessor's functions
 *  but does not call them, so the walk stops there; a plain data property
 *  would be walked. No-op without SES, like hardenModelShared. */
export function sealBulkRecords<T extends object>(list: T[]): T[] {
  if (hardener === null) return list;
  const lock = (value: unknown): void => {
    if (ArrayBuffer.isView(value)) Object.preventExtensions(value);
    else if (value !== null && (typeof value === 'object' || typeof value === 'function')) hardener!(value);
  };
  for (const record of list) {
    for (const key of Reflect.ownKeys(record)) {
      const d = Object.getOwnPropertyDescriptor(record, key)!;
      if ('value' in d) lock(d.value);
      else { lock(d.get); lock(d.set); }
    }
    Object.freeze(record);
  }
  return Object.freeze(list) as T[];
}
