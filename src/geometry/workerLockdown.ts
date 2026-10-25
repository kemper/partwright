// Engine-Worker realm lockdown (#1090).
//
// Model code (manifold-js / voxel / BREP JS, typed by the user, written by an
// AI, or arriving in a forked share link / imported .partwright.json) runs via
// `new Function('api', code)` inside the geometry Worker. A Worker shares the
// page's origin, so without this lockdown that code could open IndexedDB (where
// AI provider keys live), read Cache Storage / OPFS, and exfiltrate anything it
// found with `fetch` — the app's CSP `connect-src` allows `https:` for the
// Custom AI endpoint and Import-from-URL.
//
// `lockdownGlobalScope(self)` runs ONCE, after the Worker's init handshake and
// before the first message that can evaluate model code. It permanently:
//   1. Removes the network / storage / cross-context globals in
//      LOCKDOWN_GLOBALS from the global object AND every object up its
//      prototype chain (DedicatedWorkerGlobalScope.prototype →
//      WorkerGlobalScope.prototype → EventTarget.prototype → Object.prototype),
//      then pins each name on the global as a non-writable, non-configurable
//      `undefined` so it can't be re-added. `self.fetch`,
//      `Object.getPrototypeOf(self).fetch`, `self.constructor.prototype.fetch`,
//      a hand-rolled prototype walk — all read `undefined`.
//   2. Does the same for the storage / device accessors on `navigator`
//      (NAVIGATOR_PROPS — `navigator.storage`, `navigator.locks`, …).
//   3. Replaces a few functions with frozen throwing stubs (STUBBED_FUNCTIONS,
//      plus URL.createObjectURL / URL.revokeObjectURL — URL_STATIC_STUBS — whose
//      blob: URLs land in the origin-wide blob registry).
//      `importScripts` stays a *function* on purpose: Emscripten glue (the OCCT
//      build) detects "am I in a Worker?" via `typeof importScripts ==
//      'function'`, and module Workers already make it throw.
//   4. Pins `onmessage` / `postMessage` as non-writable own properties so model
//      code can't hijack the Worker's message channel for later runs.
//   5. Runs an ALLOWLIST audit (default deny): every remaining property — string
//      and symbol keys — on the global's prototype chain and on navigator's is
//      checked against workerGlobalAllowlist.ts; anything not listed and not
//      inert (a primitive data value) is removed and pinned the same way. A
//      denylist can't know about the capability a newer browser ships; the
//      audit does. `verifyLockdown` re-runs it, so a name that can't be removed
//      fails the lockdown closed. The removals are returned as
//      `defaultDenied` (engineWorker logs them with console.debug).
//
// Engines still need to load assets lazily AFTER lockdown (OCCT WASM, BOSL2
// sources, fonts). Before removing `fetch` the lockdown captures a private,
// pre-bound reference in this module's scope. It is never placed on the global
// object or on `api`; the only door to it is `fetchAppAsset(url)`, which only
// issues same-origin GETs, with redirects refused, for normalized paths under a
// short allow-list of static-asset prefixes (`<base>assets/`,
// `<base>openscad-libs/`, plus `<base>node_modules/` in dev) — no `.`/`..`
// segments, no `//`, no query. Even if model code reaches that function (e.g.
// via `import()` of the bundled chunk) or steers a loader's inputs by patching
// built-ins, the most it can cause is a same-origin GET of a public static
// asset. URL validation deliberately uses only operations model code cannot
// monkey-patch (typeof, primitive string indexing/length, comparisons, loops
// over frozen arrays) — never String.prototype methods, Reflect, or
// Function#call, which could otherwise be hooked to receive the native fetch
// or rewrite the URL after validation. The fetch options are a null-prototype
// literal, so a polluted Object.prototype can't inject method/body/headers.
//
// What this can't remove: dynamic `import()` is syntax, not a global. It is
// bounded by CSP `script-src` ('self' + the fixed Cloudflare analytics host;
// no `blob:`/`data:`), so it can only load same-origin modules — no
// cross-origin read or attacker-controlled endpoint.

import { BASE } from '../deployment';
import {
  ALLOWED_GLOBAL,
  ALLOWED_NAVIGATOR,
  isInertDescriptor,
  planAllowlistAudit,
  symbolLabel,
  type Allowlist,
  type ChainEntry,
} from './workerGlobalAllowlist';

/** Global names removed from the Worker scope (and its prototype chain). */
export const LOCKDOWN_GLOBALS: readonly string[] = Object.freeze([
  // Network
  'fetch', 'fetchLater', 'XMLHttpRequest', 'WebSocket', 'WebSocketStream',
  'EventSource', 'WebTransport', 'RTCPeerConnection', 'webkitRTCPeerConnection',
  'RTCDataChannel',
  // Storage
  'indexedDB', 'IDBFactory', 'IDBDatabase', 'IDBObjectStore', 'IDBIndex',
  'IDBCursor', 'IDBCursorWithValue', 'IDBKeyRange', 'IDBRequest',
  'IDBOpenDBRequest', 'IDBTransaction', 'IDBVersionChangeEvent', 'IDBRecord',
  'caches', 'CacheStorage', 'Cache', 'cookieStore', 'CookieStore',
  'StorageManager', 'StorageBucketManager', 'StorageBucket',
  'LockManager', 'Lock',
  'webkitRequestFileSystem', 'webkitRequestFileSystemSync',
  'webkitResolveLocalFileSystemURL', 'webkitResolveLocalFileSystemSyncURL',
  // Cross-context / new realms
  'Worker', 'SharedWorker', 'BroadcastChannel', 'ServiceWorkerContainer',
  'ServiceWorkerRegistration', 'ShadowRealm',
  // Font loading by URL (font-src) and notifications
  'FontFace', 'fonts', 'Notification',
]);

/** Accessors removed from `navigator` (and its prototype chain). */
export const NAVIGATOR_PROPS: readonly string[] = Object.freeze([
  'storage', 'storageBuckets', 'locks', 'serviceWorker', 'sendBeacon',
  'usb', 'hid', 'serial', 'bluetooth',
]);

/** Functions kept as callable-but-inert stubs (see header, point 3). */
const STUBBED_FUNCTIONS: readonly string[] = Object.freeze(['importScripts', 'close']);

/** Static methods of the (allowlisted) `URL` constructor replaced with frozen
 *  throwing stubs. `URL.createObjectURL` registers a `blob:` URL in the
 *  origin-wide blob registry — a write channel any same-origin context can
 *  read — so model code must not have it. Nothing in the engine Worker graph
 *  calls either. */
export const URL_STATIC_STUBS: readonly string[] = Object.freeze(['createObjectURL', 'revokeObjectURL']);

export interface LockdownReport {
  /** Every `owner.name` that was deleted or overwritten. */
  removed: string[];
  /** The subset of `removed` taken out by the allowlist audit (default deny)
   *  rather than the explicit lists — a name showing up here is a capability
   *  the denylist didn't know about (e.g. one a newer browser added). */
  defaultDenied: string[];
  /** Names that are still reachable with a non-undefined value afterwards, or
   *  non-allowlisted, non-inert names the audit couldn't remove — a non-empty
   *  list means the lockdown FAILED and model code must not run. */
  stillReachable: string[];
}

type Bag = Record<string, unknown>;

// The private network handle. Set once, by the first lockdown of the real
// `globalThis`, from the pristine pre-user-code `fetch`, pre-bound so calling
// it never looks up `call`/`apply` (which model code could hook).
let boundFetch: ((input: string, init: RequestInit) => Promise<Response>) | null = null;
let lockedOrigin: string | null = null;

const lockedGlobals: object[] = [];

function describe(o: object, root: object, rootLabel: string): string {
  if (o === root) return rootLabel;
  const ctor = (Object.getOwnPropertyDescriptor(o, 'constructor')?.value as { name?: unknown } | undefined)?.name;
  return typeof ctor === 'string' && ctor ? `${ctor}.prototype` : `${rootLabel}<proto>`;
}

/** Delete `name` from `root` and every object on its prototype chain, then pin
 *  it on `root` as `replacement` (non-writable, non-configurable). `label` is
 *  how the name is reported (symbols have no plain string form). */
function scrub(root: object, name: PropertyKey, replacement: unknown, rootLabel: string, removed: string[], label: string = String(name)): void {
  for (let o: object | null = root; o !== null; o = Object.getPrototypeOf(o)) {
    const d = Object.getOwnPropertyDescriptor(o, name);
    if (!d) continue;
    if (d.configurable) {
      delete (o as Record<PropertyKey, unknown>)[name];
      removed.push(`${describe(o, root, rootLabel)}.${label}`);
    } else if ('value' in d && d.writable) {
      (o as Record<PropertyKey, unknown>)[name] = replacement;
      removed.push(`${describe(o, root, rootLabel)}.${label}`);
    }
    // A non-configurable, non-writable binding can't be touched — the
    // verification pass below reports it.
  }
  const own = Object.getOwnPropertyDescriptor(root, name);
  if (!own || own.configurable) {
    Object.defineProperty(root, name, { value: replacement, writable: false, enumerable: false, configurable: false });
  }
}

/** True when `name` still resolves to something other than `allowed` anywhere
 *  on `root`'s prototype chain. */
function reachable(root: object, name: string, allowed: unknown): boolean {
  for (let o: object | null = root; o !== null; o = Object.getPrototypeOf(o)) {
    const d = Object.getOwnPropertyDescriptor(o, name);
    if (!d) continue;
    if ('value' in d) {
      if (d.value !== undefined && d.value !== allowed) return true;
    } else {
      return true; // an accessor survived
    }
  }
  return false;
}

/** Every stub this module installed — verifyLockdown checks a pinned stub is
 *  ours, not a lookalike. */
const stubs = new WeakSet<object>();

function makeStub(name: string): () => never {
  const stub = (): never => {
    throw new TypeError(`${name}() is disabled in the geometry sandbox`);
  };
  Object.freeze(stub);
  stubs.add(stub);
  return stub;
}

/** The value of `g`'s own `name` data property (no getters run). */
function ownValue(g: object, name: string): unknown {
  const d = Object.getOwnPropertyDescriptor(g, name);
  return d && 'value' in d ? d.value : undefined;
}

/**
 * Permanently strip network, storage and cross-context capabilities from a
 * Worker global scope. Idempotent per global. Pure apart from mutating `g`
 * (and, when `g` is the real `globalThis`, capturing the private asset fetch),
 * so unit tests can drive it with a fake global that has a prototype chain.
 */
export function lockdownGlobalScope(g: object): LockdownReport {
  for (let i = 0; i < lockedGlobals.length; i++) {
    if (lockedGlobals[i] === g) return { removed: [], defaultDenied: [], stillReachable: verifyLockdown(g) };
  }
  const bag = g as Bag;

  // Capture the private fetch BEFORE removing it — real global only.
  if (g === globalThis && boundFetch === null && typeof bag.fetch === 'function') {
    boundFetch = Function.prototype.bind.call(bag.fetch as (...a: unknown[]) => unknown, g) as (input: string, init: RequestInit) => Promise<Response>;
    const origin = (bag.location as { origin?: unknown } | undefined)?.origin;
    lockedOrigin = typeof origin === 'string' && origin !== 'null' ? origin : null;
  }

  const removed: string[] = [];
  // navigator first: its accessor lives on WorkerGlobalScope.prototype, and we
  // keep `navigator` itself (hardwareConcurrency, userAgent, … are harmless;
  // the allowlist audit below strips the rest).
  const nav = bag.navigator;
  if (nav !== null && typeof nav === 'object') {
    for (const name of NAVIGATOR_PROPS) scrub(nav, name, undefined, 'navigator', removed);
  }
  for (const name of LOCKDOWN_GLOBALS) scrub(g, name, undefined, 'self', removed);
  for (const name of STUBBED_FUNCTIONS) scrub(g, name, makeStub(name), 'self', removed);

  // URL stays (asset paths are resolved with it) but loses its blob-registry
  // statics. They're configurable own properties of the constructor; a
  // non-configurable one is left for verifyLockdown to report.
  const urlCtor = ownValue(g, 'URL');
  if (typeof urlCtor === 'function') {
    for (const name of URL_STATIC_STUBS) {
      const d = Object.getOwnPropertyDescriptor(urlCtor, name);
      if (d && !d.configurable) continue;
      if (d) {
        delete (urlCtor as unknown as Bag)[name];
        removed.push(`URL.${name}`);
      }
      Object.defineProperty(urlCtor, name, { value: makeStub(`URL.${name}`), writable: false, enumerable: false, configurable: false });
    }
  }

  // Pin the message channel so model code can't swap the Worker's handler or
  // intercept the results of later runs. Event-handler IDL attributes are
  // accessors on the prototype; the handler is already registered by the
  // time we get here, so shadowing the accessor with an own data property
  // keeps it installed while making reassignment throw (strict mode).
  for (const name of ['onmessage', 'postMessage'] as const) {
    let current: unknown;
    try { current = bag[name]; } catch { continue; }
    if (current === undefined) continue;
    const own = Object.getOwnPropertyDescriptor(g, name);
    if (own && !own.configurable) continue;
    const value = name === 'postMessage' && typeof current === 'function'
      ? Function.prototype.bind.call(current as (...a: unknown[]) => unknown, g)
      : current;
    Object.defineProperty(g, name, { value, writable: false, enumerable: false, configurable: false });
  }

  // Allowlist audit (default deny): whatever the explicit lists above didn't
  // name — a capability a newer browser added, a vendor API — and isn't on the
  // allowlist in workerGlobalAllowlist.ts goes the same way. Runs last, after
  // every capability an engine needs has been captured privately (`fetch`
  // above); lazy engine loaders that run later see only allowlisted globals.
  const defaultDenied: string[] = [];
  if (nav !== null && typeof nav === 'object') auditChain(nav, 'navigator', ALLOWED_NAVIGATOR, defaultDenied);
  auditChain(g, 'self', ALLOWED_GLOBAL, defaultDenied);
  for (let i = 0; i < defaultDenied.length; i++) removed.push(defaultDenied[i]);

  lockedGlobals.push(g);
  return { removed, defaultDenied, stillReachable: verifyLockdown(g) };
}

/** Map key for a property key: string and symbol labels live in separate
 *  namespaces (a string key `@@x` is not the symbol `@@x`). */
const keyId = (symbol: boolean, label: string): string => (symbol ? 's:' : 'n:') + label;

/** Every own property (string and symbol keys) of `root` and of each object up
 *  its prototype chain, labelled for the allowlist. `keys` maps each keyId
 *  back to its property keys. Exported for the unit test that keeps the e2e
 *  tier's in-Worker copy (tests/helpers/enumerateChainSource.ts) in sync. */
export function enumerateChain(root: object, rootLabel: string): { entries: ChainEntry[]; keys: Map<string, PropertyKey[]> } {
  const entries: ChainEntry[] = [];
  // Distinct unique symbols can share a label (`@@unique(x)`), so a label can
  // map to several keys.
  const keys = new Map<string, PropertyKey[]>();
  for (let o: object | null = root; o !== null; o = Object.getPrototypeOf(o)) {
    const owner = describe(o, root, rootLabel);
    const own = Reflect.ownKeys(o);
    for (let i = 0; i < own.length; i++) {
      const key = own[i];
      const d = Object.getOwnPropertyDescriptor(o, key);
      if (!d) continue;
      const symbol = typeof key === 'symbol';
      const label = typeof key === 'symbol' ? symbolLabel(key) : key;
      const id = keyId(symbol, label);
      const same = keys.get(id);
      if (same === undefined) keys.set(id, [key]);
      else if (!same.includes(key)) same.push(key);
      entries.push({ owner, label, symbol, inert: isInertDescriptor(d) });
    }
  }
  return { entries, keys };
}

/** Delete + pin every non-allowlisted, non-inert name on `root`'s chain. */
function auditChain(root: object, rootLabel: string, allowed: Allowlist, removed: string[]): void {
  const { entries, keys } = enumerateChain(root, rootLabel);
  const plan = planAllowlistAudit(entries, allowed);
  const done = new Set<string>();
  for (const e of plan.offending) {
    const id = keyId(e.symbol, e.label);
    if (done.has(id)) continue;
    done.add(id);
    for (const key of keys.get(id) ?? []) {
      try {
        scrub(root, key, undefined, rootLabel, removed, e.label);
      } catch {
        // e.g. a non-extensible owner — verifyLockdown reports what survived.
      }
    }
  }
}

/** Labels on `root`'s chain that are present, not inert and not allowed —
 *  i.e. what the allowlist audit failed to remove. */
function unexpectedOnChain(root: object, rootLabel: string, allowed: Allowlist): string[] {
  return planAllowlistAudit(enumerateChain(root, rootLabel).entries, allowed).remove;
}

/** True when `URL.<name>` is anything but one of our pinned stubs. */
function urlStaticLive(urlCtor: object, name: string): boolean {
  const own = Object.getOwnPropertyDescriptor(urlCtor, name);
  return !own || own.configurable === true || !('value' in own) || own.writable === true || !stubs.has(own.value as object);
}

/** Names from the lockdown lists still reachable on `g` (or its navigator),
 *  plus anything the allowlist audit couldn't remove. Empty when the lockdown
 *  holds. */
export function verifyLockdown(g: object): string[] {
  const bad: string[] = [];
  for (const name of LOCKDOWN_GLOBALS) if (reachable(g, name, undefined)) bad.push(name);
  const own = Object.getOwnPropertyDescriptor(g, 'navigator');
  const nav = own && 'value' in own ? own.value : (g as Bag).navigator;
  if (nav !== null && typeof nav === 'object') {
    for (const name of NAVIGATOR_PROPS) if (reachable(nav, name, undefined)) bad.push(`navigator.${name}`);
  }
  for (const name of STUBBED_FUNCTIONS) {
    const d = Object.getOwnPropertyDescriptor(g, name);
    if (!d || d.configurable || d.writable) bad.push(name);
  }
  const urlCtor = ownValue(g, 'URL');
  if (typeof urlCtor === 'function') {
    for (const name of URL_STATIC_STUBS) if (urlStaticLive(urlCtor, name)) bad.push(`URL.${name}`);
  }
  for (const label of unexpectedOnChain(g, 'self', ALLOWED_GLOBAL)) {
    if (!bad.includes(label)) bad.push(label);
  }
  if (nav !== null && typeof nav === 'object') {
    for (const label of unexpectedOnChain(nav, 'navigator', ALLOWED_NAVIGATOR)) {
      if (!bad.includes(`navigator.${label}`)) bad.push(`navigator.${label}`);
    }
  }
  return bad;
}

// ── Private same-origin asset fetch ─────────────────────────────────────────

/** The only path prefixes fetchAppAsset will request: the build's hashed
 *  assets (OCCT WASM), the bundled OpenSCAD libraries + fonts, and — dev
 *  server only — node_modules (where Vite serves `?url` WASM). Frozen at module
 *  load, before any model code exists. */
const ASSET_PREFIXES: readonly string[] = Object.freeze([
  BASE + 'assets/',
  BASE + 'openscad-libs/',
  ...(import.meta.env?.DEV ? [BASE + 'node_modules/'] : []),
]);

function isAllowedPathChar(c: string): boolean {
  return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9')
    || c === '/' || c === '-' || c === '_' || c === '.' || c === '~';
}

function hasPrefix(s: string, prefix: string): boolean {
  if (s.length < prefix.length) return false;
  for (let i = 0; i < prefix.length; i++) if (s[i] !== prefix[i]) return false;
  return true;
}

/**
 * Normalize `url` to a same-origin static-asset path (`/assets/x.wasm`), or
 * null when it isn't one. Accepts either a path or an absolute URL whose
 * origin is exactly `origin`. The path must start with one of `prefixes`, use
 * only `[A-Za-z0-9/._~-]` (so no backslash, whitespace/control characters —
 * which the URL parser strips, turning `/\t/host` into `//host` — query or
 * fragment), and contain no empty (`//`), `.` or `..` segment.
 *
 * Implemented with primitive string indexing and comparisons only — no
 * String.prototype methods — so model code can't subvert it by patching
 * built-ins. Exported for unit tests.
 */
export function toAppAssetPath(url: unknown, origin: string | null, prefixes: readonly string[] = ASSET_PREFIXES): string | null {
  if (typeof url !== 'string') return null;
  let start = 0;
  if (origin !== null && hasPrefix(url, origin + '/')) start = origin.length;
  let out = '';
  let seg = '';
  for (let i = start; i < url.length; i++) {
    const c = url[i];
    if (!isAllowedPathChar(c)) return null;
    if (c === '/') {
      if (i > start && (seg === '' || seg === '.' || seg === '..')) return null;
      seg = '';
    } else {
      seg += c;
    }
    out += c;
  }
  if (seg === '' || seg === '.' || seg === '..') return null; // trailing slash / dot segment
  if (out.length < 2 || out[0] !== '/') return null;
  for (let i = 0; i < prefixes.length; i++) if (hasPrefix(out, prefixes[i])) return out;
  return null;
}

/**
 * Fetch a same-origin static asset (WASM side-car, BOSL2 source, font) for an
 * engine's lazy loader. In the locked-down engine Worker this is the ONLY way
 * to reach the network: a same-origin GET (redirects refused) of a path under
 * the asset allow-list. Outside a locked-down realm (main thread, Node SSR for
 * `model:preview`, unit tests) it defers to the live `globalThis.fetch`, so the
 * CLI's public/ fetch shim keeps working. Every new lazy loader that runs in
 * the engine Worker must use this instead of `fetch` (see
 * docs/architecture-notes.md).
 */
export function fetchAppAsset(url: string): Promise<Response> {
  if (boundFetch === null) return globalThis.fetch(url);
  const path = toAppAssetPath(url, lockedOrigin);
  if (path === null) return Promise.reject(new TypeError('fetchAppAsset: only same-origin app assets can be loaded from the geometry sandbox'));
  return boundFetch(path, { __proto__: null, redirect: 'error' } as unknown as RequestInit);
}

/** True for a bare asset file name (`ball_bearings.scad`): `[A-Za-z0-9._-]`,
 *  not starting with `.`. Primitive operations only (see toAppAssetPath) — the
 *  loaders vet names that arrive over the network (the BOSL2 manifest) with
 *  it before building URLs. */
export function isSafeAssetName(name: unknown): name is string {
  if (typeof name !== 'string' || name.length === 0 || name.length > 128 || name[0] === '.') return false;
  for (let i = 0; i < name.length; i++) {
    const c = name[i];
    if (!((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c === '.' || c === '_' || c === '-')) return false;
  }
  return true;
}

// ── Main-thread evaluation guard ────────────────────────────────────────────

/**
 * Throw when called in a document (main-thread) realm. Every engine entry
 * point that evaluates model code calls this first, so model code can only
 * ever run in the locked-down engine Worker (or in Node, for the headless
 * `model:preview` / segmentation CLIs, which run the user's own local files).
 * The main thread must go through the Worker (`executeCodeAsync`,
 * `runVoxelGridInWorker`) instead. (#1090)
 */
export function assertModelCodeRealm(what: string): void {
  if (typeof (globalThis as { document?: unknown }).document !== 'undefined') {
    throw new Error(`${what} must run in the sandboxed engine Worker, never on the main thread`);
  }
}
