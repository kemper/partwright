// Engine-Worker global ALLOWLIST (#1090 follow-up).
//
// workerLockdown.ts removes a DENYLIST of known network / storage /
// cross-context globals. A denylist can't anticipate the next capability a
// browser ships (a new storage API, a new transport), so after those removals
// the lockdown also runs an allowlist audit: every property name — strings and
// symbols — on the Worker global, on each object up its prototype chain
// (DedicatedWorkerGlobalScope.prototype → WorkerGlobalScope.prototype →
// EventTarget.prototype → Object.prototype), and on `navigator` and its chain,
// is compared against the lists below. Anything that is not inert (see below)
// and not listed is deleted and pinned to `undefined` (default deny); if it
// can't be removed the Worker refuses to run model code.
//
// Inert bindings are accepted for ANY name and are never listed: a data
// property holding a primitive (`undefined`, `null`, a number, string, boolean,
// bigint or symbol) carries no capability — there is nothing to call. That
// covers every name the lockdown already neutralised (deleted + pinned to
// `undefined`) — listing e.g. `fetch` here would only weaken the audit, since it
// would then also accept a live `fetch` — as well as WebIDL constants, which
// are non-configurable and so can't be deleted anyway
// (`DedicatedWorkerGlobalScope.prototype.TEMPORARY`/`PERSISTENT`), and plain
// counters libraries park on the global (style-mod's `Symbol.for("ͼ")`).
// Objects, functions and accessors (an accessor can return anything) are
// never inert.
//
// This module is pure data + a pure planner so the unit tier can test it and
// the e2e tier can re-run the same check on names enumerated inside the real
// Worker (tests/engine-lockdown.spec.ts). It must not import anything.
//
// ── Adding an entry ─────────────────────────────────────────────────────────
// The Worker logs `[lockdown] default-deny removed N non-allowlisted globals: …`
// (console.debug), so a capability a new Chromium ships shows up there and in
// the e2e log. When an engine (or a Chromium upgrade) needs a name the audit
// removes — the engine e2e specs fail, or the e2e test "the Worker global holds
// only allowlisted names" names something that couldn't be removed — add the
// name to the group it belongs to below (or a new group with a one-line `why`)
// ONLY if it grants no network, storage, or cross-context capability. A
// capability an engine needs but model code must not have (like `fetch`)
// instead gets captured privately in workerLockdown.ts before the removal, the
// way `fetchAppAsset` captures `fetch`. See docs/architecture-notes.md →
// "Allowlist audit".

export interface AllowlistGroup {
  /** One-line justification for the whole group. */
  readonly why: string;
  readonly names: readonly string[];
}

/** Label for a symbol-keyed property. Well-known symbols get their spec name
 *  (`[Symbol.toStringTag]`), registry symbols `[Symbol.for(<key>)]`; anything
 *  else is `[Symbol(<description>)]`, which no allowlist entry uses (a unique
 *  symbol's description proves nothing about who created it). */
export function symbolLabel(sym: symbol): string {
  const wk = WELL_KNOWN_SYMBOLS;
  for (let i = 0; i < wk.length; i++) {
    if ((Symbol as unknown as Record<string, unknown>)[wk[i]] === sym) return `[Symbol.${wk[i]}]`;
  }
  const key = Symbol.keyFor(sym);
  if (key !== undefined) return `[Symbol.for(${key})]`;
  return `[Symbol(${sym.description ?? ''})]`;
}

const WELL_KNOWN_SYMBOLS: readonly string[] = Object.freeze([
  'asyncIterator', 'hasInstance', 'isConcatSpreadable', 'iterator', 'match', 'matchAll',
  'replace', 'search', 'species', 'split', 'toPrimitive', 'toStringTag', 'unscopables',
  'dispose', 'asyncDispose',
]);

/** Names allowed on Object.prototype — it ends BOTH chains (global and
 *  navigator), so both allowlists include this group. */
const OBJECT_PROTOTYPE: AllowlistGroup = {
  why: 'Object.prototype members (ECMAScript) — the shared root of both prototype chains.',
  names: [
    'constructor', '__defineGetter__', '__defineSetter__', 'hasOwnProperty', '__lookupGetter__',
    '__lookupSetter__', 'isPrototypeOf', 'propertyIsEnumerable', 'toString', 'valueOf',
    '__proto__', 'toLocaleString',
  ],
};

/** Allowlist for the Worker global object and its prototype chain. */
export const GLOBAL_ALLOWLIST: Readonly<Record<string, AllowlistGroup>> = Object.freeze({
  ecmascript: {
    why: 'ECMAScript built-ins — pure language runtime, no I/O. Model code and every engine rely on them.',
    names: [
      // Value properties + functions
      'globalThis', 'Infinity', 'NaN', 'undefined', 'eval', 'isFinite', 'isNaN', 'parseFloat',
      'parseInt', 'decodeURI', 'decodeURIComponent', 'encodeURI', 'encodeURIComponent', 'escape',
      'unescape',
      // Constructors
      'AggregateError', 'Array', 'ArrayBuffer', 'AsyncDisposableStack', 'BigInt', 'BigInt64Array',
      'BigUint64Array', 'Boolean', 'DataView', 'Date', 'DisposableStack', 'Error', 'EvalError',
      'FinalizationRegistry', 'Float16Array', 'Float32Array', 'Float64Array', 'Function',
      'Int8Array', 'Int16Array', 'Int32Array', 'Iterator', 'Map', 'Number', 'Object', 'Promise',
      'Proxy', 'RangeError', 'ReferenceError', 'RegExp', 'Set', 'String', 'SuppressedError',
      'Symbol', 'SyntaxError', 'TypeError', 'Uint8Array', 'Uint8ClampedArray', 'Uint16Array',
      'Uint32Array', 'URIError', 'WeakMap', 'WeakRef', 'WeakSet',
      // Namespaces
      'Atomics', 'Intl', 'JSON', 'Math', 'Reflect', 'Temporal',
      // Shared memory: the WASM engines need it (the app is cross-origin
      // isolated); it only shares memory with agents this Worker already talks to.
      'SharedArrayBuffer',
    ],
  },
  objectPrototype: OBJECT_PROTOTYPE,
  webAssembly: {
    why: 'WebAssembly — manifold-3d, OpenSCAD and OpenCASCADE compile/instantiate their modules through it (bytes come from fetchAppAsset or are inlined).',
    names: ['WebAssembly'],
  },
  scopeIdentity: {
    why: 'The global scope itself, its interface objects and the EventTarget plumbing engineWorker / the sandbox shim use (self.addEventListener, unhandledrejection). OpenSCAD detects a Worker via `typeof WorkerGlobalScope`.',
    names: [
      'self', 'DedicatedWorkerGlobalScope', 'WorkerGlobalScope', 'EventTarget',
      'addEventListener', 'removeEventListener', 'dispatchEvent',
    ],
  },
  scopeInfo: {
    why: 'Read-only facts about this Worker (no capability): Emscripten derives scriptDirectory from `location.href`; `navigator` itself is audited separately against NAVIGATOR_ALLOWLIST.',
    names: ['location', 'navigator', 'origin', 'name', 'isSecureContext', 'crossOriginIsolated'],
  },
  messageChannel: {
    why: 'The Worker↔app channel. workerLockdown pins `onmessage`/`postMessage` as own non-writable properties; the accessor/method they shadow stays on DedicatedWorkerGlobalScope.prototype. The app validates every message (workerMessageValidation.ts).',
    names: ['onmessage', 'postMessage', 'onmessageerror'],
  },
  errorEvents: {
    why: 'Error reporting into the Worker\'s own handlers (engineWorker forwards unhandled rejections to the app).',
    names: ['onerror', 'onunhandledrejection', 'onrejectionhandled', 'reportError'],
  },
  lockdownStubs: {
    why: 'Frozen throwing stubs installed by workerLockdown (verifyLockdown checks they stay pinned). `importScripts` stays a function for Emscripten\'s Worker detection.',
    names: ['importScripts', 'close'],
  },
  timers: {
    why: 'Timers and microtasks — scheduling inside this Worker only. The simplify/enhance loops and Emscripten\'s async glue yield with them.',
    names: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'queueMicrotask'],
  },
  dataUtilities: {
    why: 'In-memory encoding / copying utilities with no I/O. TextDecoder is used by every Emscripten glue (UTF8ToString); Blob carries STEP bytes (engineWorker importSTEP*, replicad blobSTEP); URL is needed to resolve asset paths.',
    names: [
      'TextEncoder', 'TextDecoder', 'atob', 'btoa', 'structuredClone', 'Blob', 'URL',
      'URLSearchParams', 'DOMException', 'Event',
    ],
  },
  performance: {
    why: 'performance.now() — run timers (workerMs) and Emscripten\'s clock. Exposes only this Worker\'s own timings.',
    names: ['performance'],
  },
  crypto: {
    why: '`crypto.getRandomValues` seeds Emscripten\'s /dev/urandom; `crypto.subtle` stays (pure computation — hashing/ciphers on caller-supplied bytes — no key persistence once IndexedDB is gone, no network).',
    names: ['crypto'],
  },
  console: {
    why: 'console.* — diagnostics only; output goes to DevTools, never off the device.',
    names: ['console'],
  },
});

/** Allowlist for `navigator` (WorkerNavigator) and its prototype chain. */
export const NAVIGATOR_ALLOWLIST: Readonly<Record<string, AllowlistGroup>> = Object.freeze({
  objectPrototype: OBJECT_PROTOTYPE,
  identity: {
    why: 'The WorkerNavigator interface itself.',
    names: ['[Symbol.toStringTag]'],
  },
  environment: {
    why: 'Static environment facts (no capability): the Assembly pool and Emscripten size threads by hardwareConcurrency; glue code sniffs userAgent/platform.',
    names: [
      'hardwareConcurrency', 'userAgent', 'platform', 'language', 'languages', 'appCodeName',
      'appName', 'appVersion', 'product', 'onLine',
    ],
  },
});

/** Symbol-keyed properties allowed on the global chain. */
const GLOBAL_SYMBOLS: AllowlistGroup = {
  why: 'Interface brand tags (`[object DedicatedWorkerGlobalScope]`).',
  names: ['[Symbol.toStringTag]'],
};

function flatten(groups: Readonly<Record<string, AllowlistGroup>>, extra: AllowlistGroup[] = []): ReadonlySet<string> {
  const out = new Set<string>();
  for (const key of Object.keys(groups)) for (const n of groups[key].names) out.add(n);
  for (const g of extra) for (const n of g.names) out.add(n);
  return out;
}

/** Every allowed label for the global chain (string names and `[Symbol.x]`). */
export const ALLOWED_GLOBAL_NAMES: ReadonlySet<string> = flatten(GLOBAL_ALLOWLIST, [GLOBAL_SYMBOLS]);
/** Every allowed label for the navigator chain. */
export const ALLOWED_NAVIGATOR_NAMES: ReadonlySet<string> = flatten(NAVIGATOR_ALLOWLIST);

/** True for a property descriptor that grants nothing: a data property whose
 *  value is a primitive. Objects, functions and accessors are never inert. */
export function isInertDescriptor(d: PropertyDescriptor): boolean {
  if (!('value' in d)) return false;
  const v: unknown = d.value;
  return v === null || (typeof v !== 'object' && typeof v !== 'function');
}

/** One own property found while walking a prototype chain. */
export interface ChainEntry {
  /** Which object holds it, e.g. `self`, `WorkerGlobalScope.prototype`. */
  owner: string;
  /** Property label: the string key, or `[Symbol.x]` (see symbolLabel). */
  label: string;
  /** isInertDescriptor — a primitive data value (incl. a name the lockdown
   *  already pinned to `undefined`), accepted for any name. */
  inert: boolean;
}

export interface AllowlistPlan {
  /** Distinct labels to delete + pin (present, not inert, not allowed), sorted. */
  remove: string[];
  /** The entries behind `remove`, for diagnostics. */
  offending: ChainEntry[];
}

/**
 * Pure planner: given the own properties enumerated up one prototype chain and
 * an allowlist, return the labels that must be removed (default deny). Inert
 * entries are accepted for any name.
 */
export function planAllowlistAudit(entries: readonly ChainEntry[], allowed: ReadonlySet<string>): AllowlistPlan {
  const offending: ChainEntry[] = [];
  const labels = new Set<string>();
  for (const e of entries) {
    if (e.inert || allowed.has(e.label)) continue;
    offending.push(e);
    labels.add(e.label);
  }
  return { remove: [...labels].sort(), offending };
}
