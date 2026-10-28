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
