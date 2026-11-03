// SES (Hardened JavaScript) evaluation for model code — engine Worker only
// (#1127). Default ON; the kill switch is sesSandboxFlag.ts.
//
// During the Worker's init handshake, BEFORE any engine initialises
// (engineWorker.ts), `enableSesSandbox()`:
//   1. loads the `ses` shim (its own lazy chunk; never loaded with the kill
//      switch on),
//   2. calls `lockdown(SES_LOCKDOWN_OPTIONS)` — every shared intrinsic
//      (Object, Array, Function.prototype, Math, …) is frozen, so model code
//      can no longer monkey-patch the built-ins the engines rely on,
//   3. installs a compiler into modelEval.ts that evaluates each run's model
//      code in a FRESH `Compartment`: its global object holds only the
//      language intrinsics plus a few hardened endowments, so `self`,
//      `postMessage`, `navigator`, timers and the rest of the Worker global
//      are simply not nameable, and nothing a run stores on its global
//      survives into the next run. `api` is passed in as before.
//   4. self-tests the result and throws if anything is off — the Worker then
//      fails closed through the #1119 lockdown-refusal path.
//
// The engine realm (engines, Emscripten glue, loaders) keeps the Worker global;
// workerLockdown.ts still strips network/storage globals from it afterwards, as
// defence in depth.

import { installModelCompiler, type ModelFn } from './modelEval';
import { ValidationError } from '../validation/apiValidation';
import {
  SES_LOCKDOWN_OPTIONS,
  analyzeFreeGlobals,
  type FreeGlobals,
  explainSesRejection,
  neutralizeSesRejections,
  preludeNames,
  rewriteFreeTypeof,
  wrapModelSource,
} from './sesModelSource';

export interface SesReport {
  /** Wall time of import + lockdown + compiler setup. */
  ms: number;
  /** The compartment globals bound by the prelude. */
  globals: string[];
}

type G = Record<string, unknown>;
type CompartmentCtor = new (options: unknown) => { evaluate(src: string): unknown; globalThis: object };

/** Console methods model code may call (forwarded to the Worker console). */
const CONSOLE_METHODS: readonly string[] = Object.freeze([
  'log', 'info', 'warn', 'error', 'debug', 'trace', 'dir', 'table', 'group', 'groupCollapsed',
  'groupEnd', 'time', 'timeEnd', 'timeLog', 'count', 'countReset', 'assert',
]);

/** Extra globals model code gets on top of the compartment's own (see
 *  docs/engine-sandbox.md → "What model code can name"). Everything here is
 *  hardened and capability-free. */
function buildEndowments(g: G, harden: <T>(x: T) => T): G {
  const out: G = {};
  // SES compartments get a Math without `random` and a Date whose `now()` /
  // `new Date()` throw, and omit the float typed arrays (a NaN-bits side
  // channel). Model code uses all of them (seeded noise, Float32Array buffers)
  // and determinism isn't a security property here, so share the start
  // compartment's — lockdown already hardened them.
  for (const name of ['Math', 'Date', 'Float16Array', 'Float32Array', 'Float64Array']) {
    if (g[name] !== undefined) out[name] = harden(g[name]);
  }
  // console: forwarders, so model code can log but can't swap the Worker's
  // console (or reach it — the methods are fresh functions). Each call looks
  // the method up on the real console at call time, so the engine's per-run
  // capture (modelConsole.ts swaps console.log & co. around each run) sees it.
  const realConsole = g.console as Record<string, unknown> | undefined;
  const consoleOut: Record<string, (...a: unknown[]) => void> = {};
  for (const k of CONSOLE_METHODS) {
    if (typeof realConsole?.[k] !== 'function') continue;
    consoleOut[k] = (...a: unknown[]) => {
      const f = realConsole[k];
      if (typeof f !== 'function') return;
      try { Reflect.apply(f, realConsole, a); } catch { /* ignore */ }
    };
  }
  out.console = harden(consoleOut);
  // performance.now() only — model code that times itself keeps working.
  const perf = g.performance as { now?: () => number } | undefined;
  if (perf && typeof perf.now === 'function') {
    const now = perf.now.bind(perf);
    out.performance = harden({ now: () => now() });
  }
  return out;
}

/** Load SES, lock the realm down, and route model compilation through fresh
 *  Compartments. Must run before any engine initialises and before any model
 *  code. Throws (caller fails closed) when anything doesn't check out. */
export interface SesOptions {
  /** Model code longer than this skips the undeclared-name analysis. */
  undeclaredCheckMaxChars: number;
}

export async function enableSesSandbox(opts: SesOptions): Promise<SesReport> {
  const t0 = performance.now();
  await import('./sesLoader.js');
  const g = globalThis as unknown as G;
  const lockdown = g.lockdown as ((o: Record<string, string>) => void) | undefined;
  const Compartment = g.Compartment as CompartmentCtor | undefined;
  if (typeof lockdown !== 'function' || typeof Compartment !== 'function') {
    throw new Error('the SES shim did not install lockdown/Compartment');
  }
  // lockdown() REPLACES a few start-compartment constructors (Error, Date,
  // RegExp) with tamed ones and leaves the originals unfrozen — the original
  // Error still holds V8's live `prepareStackTrace` hook (which receives raw
  // CallSites: receivers and functions of engine frames). Engine modules
  // evaluated before lockdown captured the originals: `class ValidationError
  // extends Error` makes the original Error its [[Prototype]], so model code
  // holding a thrown ValidationError could reach it. Remember them, then
  // harden them below. (No engine code assigns Error.prepareStackTrace /
  // stackTraceLimit, so freezing them is invisible.)
  const feral: Array<[string, unknown]> = ['Error', 'Date', 'RegExp'].map((n) => [n, g[n]]);
  lockdown({ ...SES_LOCKDOWN_OPTIONS });
  // `harden` only exists once lockdown() has run.
  const harden = g.harden as (<T>(x: T) => T) | undefined;
  if (typeof harden !== 'function') throw new Error('lockdown() did not install harden');
  for (const [name, original] of feral) {
    if (original && g[name] !== original) harden(original);
    if (original && !Object.isFrozen(original)) throw new Error(`the original ${name} constructor is not frozen after lockdown()`);
  }
  // Engine-realm classes whose instances model code receives and that no
  // engine run hardens through its `api`: the error class api validation
  // throws, and Blob (BREP `blobSTEP()`) — a host prototype lockdown doesn't
  // touch. tests/engine-ses.spec.ts ("no shared mutable state") walks
  // what model code can reach and fails on anything missed here.
  harden(ValidationError);
  if (typeof g.Blob === 'function') harden(g.Blob);
  for (const [name, o] of [['Object.prototype', Object.prototype], ['Array.prototype', Array.prototype], ['Function.prototype', Function.prototype], ['Math', Math]] as const) {
    if (!Object.isFrozen(o)) throw new Error(`${name} is not frozen after lockdown()`);
  }

  const endowments = buildEndowments(g, harden);
  const newCompartment = () => new Compartment({ globals: endowments, __options__: true });
  const globalNames = Object.getOwnPropertyNames(newCompartment().globalThis);
  const names = preludeNames(globalNames);
  // Plus everything the compartment global inherits (toString,
  // hasOwnProperty, …): a bare read of those resolves, so they're never free.
  const known = new Set<string>([...globalNames, ...Object.getOwnPropertyNames(Object.prototype), 'api', 'arguments', 'undefined', 'NaN', 'Infinity']);
  const SKIPPED: FreeGlobals = { names: [], firstLine: new Map(), typeofOperands: [], globalThisEscapes: true };

  // The free-global analysis parses the source (~0.5 ms per KB: ~8 ms for
  // cat_calico, ~176 ms for the 363 KB benchy-reconstruction entry). Sources
  // past `undeclaredCheckMaxChars` (AppConfig geometry.sesUndeclaredCheckMaxChars)
  // skip it — undeclared names then read as undefined. validate() and the run
  // that follows compile the same text, so remember the last few results.
  const freeCache = new Map<string, FreeGlobals>();
  const freeGlobalsOf = (jsCode: string): FreeGlobals => {
    let r = freeCache.get(jsCode);
    if (r) {
      freeCache.delete(jsCode);
    } else {
      r = jsCode.length > opts.undeclaredCheckMaxChars ? SKIPPED : analyzeFreeGlobals(jsCode, known);
      if (freeCache.size >= 4) freeCache.delete(freeCache.keys().next().value as string);
    }
    freeCache.set(jsCode, r);
    return r;
  };

  const compile = (jsCode: string): ModelFn => {
    // A fresh compartment per run: nothing one run stores on its global
    // object survives into the next run.
    const c = newCompartment();
    // Strict-JS ReferenceErrors for undeclared names (SES reads them as
    // undefined): a throwing accessor per free global on this run's
    // compartment global — shadowed by any local binding, so it fires only
    // when such a read actually executes — and `typeof <name>` rewritten so it
    // still answers 'undefined'. See analyzeFreeGlobals.
    const free = freeGlobalsOf(jsCode);
    for (const name of free.names) installFreeGlobalTrap(c.globalThis, name, free.firstLine.get(name) ?? 1, free.globalThisEscapes);
    if (free.typeofOperands.length > 0) installFreeTypeof(c.globalThis);
    const src = rewriteFreeTypeof(jsCode, free.typeofOperands, (name) => `${FREE_TYPEOF}(${JSON.stringify(name)})`);
    let fn: ModelFn;
    try {
      fn = c.evaluate(wrapModelSource(neutralizeSesRejections(src), names)) as ModelFn;
    } catch (e) {
      throw explainCompileError(e);
    }
    return fn;
  };

  // Self-test before anything relies on it: model code must not see the
  // Worker global, and the wrapper must hand `api` through.
  const probe = compile('return [typeof globalThis.postMessage, typeof globalThis.self, typeof globalThis.navigator, typeof self, api];')(42) as unknown[];
  if (!Array.isArray(probe) || probe.slice(0, 4).some((t) => t !== 'undefined') || probe[4] !== 42) {
    throw new Error(`compartment self-test failed (${JSON.stringify(probe)})`);
  }
  const undeclaredProbe = 'return postMessage;';
  if (undeclaredProbe.length <= opts.undeclaredCheckMaxChars) {
    let undeclared: unknown = null;
    try { compile(undeclaredProbe)(null); } catch (e) { undeclared = e; }
    if (!(undeclared instanceof ReferenceError)) throw new Error('compartment self-test failed (an undeclared name did not throw ReferenceError)');
  }

  installModelCompiler(compile, harden);
  return { ms: Math.round((performance.now() - t0) * 10) / 10, globals: names };
}

/** Name of the per-compartment helper `typeof <free name>` is rewritten to
 *  call (rewriteFreeTypeof). Not a valid name for model code to collide with
 *  by accident. */
const FREE_TYPEOF = '$partwrightFreeTypeof$';

/** `typeof x` for a free global `x` answers what plain JS would: 'undefined'
 *  while `x` is still the throwing accessor, or the type of the value once the
 *  code made `x` a real global (`globalThis[k] = …`, which the accessor's
 *  setter turns into a data property). */
function installFreeTypeof(g: object): void {
  Object.defineProperty(g, FREE_TYPEOF, {
    value: (name: string): unknown => {
      const d = Object.getOwnPropertyDescriptor(g, name);
      return d && 'value' in d ? d.value : undefined;
    },
    writable: false,
    enumerable: false,
    configurable: false,
  });
}

/** Make reading or assigning `name` on compartment global `g` throw
 *  `ReferenceError: <name> is not defined`, as strict JS does for an
 *  undeclared name (with the user's line in `modelLineNumber`, for the
 *  editor). When the code can create globals the analysis can't see
 *  (`globalThisEscapes`: `globalThis[k] = v`, `Object.assign(globalThis, …)`),
 *  assigning instead turns the name into an ordinary global — the one case
 *  where the assignment can't be told apart from `globalThis[k] = v`. */
function installFreeGlobalTrap(g: object, name: string, firstLine: number, assignCreates: boolean): void {
  const fail = (): never => {
    const err = new ReferenceError(`${name} is not defined`) as ReferenceError & { modelLineNumber?: number };
    err.modelLineNumber = modelLineFromStack(err.stack) ?? firstLine;
    throw err;
  };
  Object.defineProperty(g, name, {
    get: fail,
    set(v: unknown) {
      if (!assignCreates) fail();
      Object.defineProperty(g, name, { value: v, writable: true, enumerable: true, configurable: true });
    },
    enumerable: false,
    configurable: true,
  });
}

/** The user's line from a V8 stack thrown inside the free-global accessor:
 *  the first frame below the accessor that sits in compartment-evaluated code
 *  (`<anonymous>:L:C`, where the wrapper keeps user line N on line N). V8
 *  (Chromium) stacks only: Firefox and Safari format eval frames differently,
 *  return null here, and the error falls back to the name's first reference. */
function modelLineFromStack(stack: unknown): number | null {
  if (typeof stack !== 'string') return null;
  const lines = stack.split('\n');
  for (let i = 2; i < lines.length; i++) {
    const m = /<anonymous>:(\d+):\d+\)?\s*$/.exec(lines[i]);
    if (m) return Number(m[1]);
  }
  return null;
}

/** A compile-time error, with SES source rejections mapped to the user's
 *  line. `modelLineNumber` is read by sourceDiagnostics.ts. */
function explainCompileError(e: unknown): unknown {
  if (!(e instanceof SyntaxError)) return e;
  const mapped = explainSesRejection(e.message);
  if (mapped) {
    const err = new SyntaxError(mapped.message) as SyntaxError & { modelLineNumber?: number };
    err.modelLineNumber = mapped.line;
    return err;
  }
  // Engines that report a location (Firefox's `lineNumber`) count lines of the
  // evaluated source, where user line N is line N.
  const ln = (e as SyntaxError & { lineNumber?: unknown }).lineNumber;
  if (typeof ln === 'number') {
    try { (e as SyntaxError & { modelLineNumber?: number }).modelLineNumber = ln; } catch { /* frozen */ }
  }
  return e;
}
