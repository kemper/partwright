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
//   3. Replaces a few functions with frozen throwing stubs (STUBBED_FUNCTIONS).
//      `importScripts` stays a *function* on purpose: Emscripten glue (the OCCT
//      build) detects "am I in a Worker?" via `typeof importScripts ==
//      'function'`, and module Workers already make it throw.
//   4. Pins `onmessage` / `postMessage` as non-writable own properties so model
//      code can't hijack the Worker's message channel for later runs.
//
// Engines still need to load assets lazily AFTER lockdown (OCCT WASM, BOSL2
// sources, fonts). Before removing `fetch` the lockdown captures a private,
// pre-bound reference in this module's scope. It is never placed on the global
// object or on `api`; the only door to it is `fetchAppAsset(url)`, which only
// issues same-origin GETs for plain path-absolute URLs. Even if model code
// reaches that function (e.g. via `import()` of the bundled chunk), it can't
// talk to any other origin. URL validation deliberately uses only operations
// model code cannot monkey-patch (typeof, primitive string indexing/length,
// comparisons) — never String.prototype methods, Reflect, or Function#call,
// which could otherwise be hooked to receive the native fetch or rewrite the
// URL after validation.
//
// What this can't remove: dynamic `import()` is syntax, not a global. It is
// bounded by CSP `script-src` ('self' + the fixed Cloudflare analytics host;
// no `blob:`/`data:`), so it can only load same-origin modules — no
// cross-origin read or attacker-controlled endpoint.

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

export interface LockdownReport {
  /** Every `owner.name` that was deleted or overwritten. */
  removed: string[];
  /** Names that are still reachable with a non-undefined value afterwards —
   *  a non-empty list means the lockdown FAILED and model code must not run. */
  stillReachable: string[];
}

type Bag = Record<string, unknown>;

// The private network handle. Set once, by the first lockdown of the real
// `globalThis`, from the pristine pre-user-code `fetch`, pre-bound so calling
// it never looks up `call`/`apply` (which model code could hook).
let boundFetch: ((input: string) => Promise<Response>) | null = null;
let lockedOrigin: string | null = null;

const lockedGlobals: object[] = [];

function describe(o: object, root: object, rootLabel: string): string {
  if (o === root) return rootLabel;
  const ctor = (Object.getOwnPropertyDescriptor(o, 'constructor')?.value as { name?: unknown } | undefined)?.name;
  return typeof ctor === 'string' && ctor ? `${ctor}.prototype` : `${rootLabel}<proto>`;
}

/** Delete `name` from `root` and every object on its prototype chain, then pin
 *  it on `root` as `replacement` (non-writable, non-configurable). */
function scrub(root: object, name: string, replacement: unknown, rootLabel: string, removed: string[]): void {
  for (let o: object | null = root; o !== null; o = Object.getPrototypeOf(o)) {
    const d = Object.getOwnPropertyDescriptor(o, name);
    if (!d) continue;
    if (d.configurable) {
      delete (o as Bag)[name];
      removed.push(`${describe(o, root, rootLabel)}.${name}`);
    } else if ('value' in d && d.writable) {
      (o as Bag)[name] = replacement;
      removed.push(`${describe(o, root, rootLabel)}.${name}`);
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

function makeStub(name: string): () => never {
  const stub = (): never => {
    throw new TypeError(`${name}() is disabled in the geometry sandbox`);
  };
  return Object.freeze(stub);
}

/**
 * Permanently strip network, storage and cross-context capabilities from a
 * Worker global scope. Idempotent per global. Pure apart from mutating `g`
 * (and, when `g` is the real `globalThis`, capturing the private asset fetch),
 * so unit tests can drive it with a fake global that has a prototype chain.
 */
export function lockdownGlobalScope(g: object): LockdownReport {
  for (let i = 0; i < lockedGlobals.length; i++) {
    if (lockedGlobals[i] === g) return { removed: [], stillReachable: verifyLockdown(g) };
  }
  const bag = g as Bag;

  // Capture the private fetch BEFORE removing it — real global only.
  if (g === globalThis && boundFetch === null && typeof bag.fetch === 'function') {
    boundFetch = Function.prototype.bind.call(bag.fetch as (...a: unknown[]) => unknown, g) as (input: string) => Promise<Response>;
    const origin = (bag.location as { origin?: unknown } | undefined)?.origin;
    lockedOrigin = typeof origin === 'string' && origin !== 'null' ? origin : null;
  }

  const removed: string[] = [];
  // navigator first: its accessor lives on WorkerGlobalScope.prototype, and we
  // keep `navigator` itself (hardwareConcurrency, gpu, … are harmless).
  const nav = bag.navigator;
  if (nav !== null && typeof nav === 'object') {
    for (const name of NAVIGATOR_PROPS) scrub(nav, name, undefined, 'navigator', removed);
  }
  for (const name of LOCKDOWN_GLOBALS) scrub(g, name, undefined, 'self', removed);
  for (const name of STUBBED_FUNCTIONS) scrub(g, name, makeStub(name), 'self', removed);

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

  lockedGlobals.push(g);
  return { removed, stillReachable: verifyLockdown(g) };
}

/** Names from the lockdown lists still reachable on `g` (or its navigator).
 *  Empty when the lockdown holds. */
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
  return bad;
}

// ── Private same-origin asset fetch ─────────────────────────────────────────

function isAllowedPathChar(c: string): boolean {
  return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9')
    || c === '/' || c === '-' || c === '_' || c === '.' || c === '~'
    || c === '@' || c === '+' || c === ',' || c === '?' || c === '=' || c === '&';
}

/**
 * Normalize `url` to a same-origin, path-absolute URL (`/assets/x.wasm`), or
 * null when it isn't one. Accepts either a path (`/openscad-libs/…`) or an
 * absolute URL whose origin is exactly `origin`. Rejects protocol-relative
 * (`//host`), backslash tricks (`/\host`), whitespace/control characters (which
 * the URL parser strips — `/\t/host` would otherwise become `//host`), and
 * anything outside a conservative path character set.
 *
 * Implemented with primitive string indexing and comparisons only — no
 * String.prototype methods — so model code can't subvert it by patching
 * built-ins. Exported for unit tests.
 */
export function toAppAssetPath(url: unknown, origin: string | null): string | null {
  if (typeof url !== 'string') return null;
  let start = 0;
  if (origin !== null) {
    const prefix = origin + '/';
    let match = url.length >= prefix.length;
    for (let i = 0; match && i < prefix.length; i++) if (url[i] !== prefix[i]) match = false;
    if (match) start = origin.length;
  }
  let out = '';
  for (let i = start; i < url.length; i++) {
    const c = url[i];
    if (!isAllowedPathChar(c)) return null;
    out += c;
  }
  if (out.length < 2 || out[0] !== '/' || out[1] === '/') return null;
  return out;
}

/**
 * Fetch a same-origin static asset (WASM side-car, BOSL2 source, font) for an
 * engine's lazy loader. In the locked-down engine Worker this is the ONLY way
 * to reach the network, and it only issues same-origin GETs. Outside a
 * locked-down realm (main thread, Node SSR for `model:preview`, unit tests) it
 * defers to the live `globalThis.fetch`, so the CLI's public/ fetch shim keeps
 * working. Every new lazy loader that runs in the engine Worker must use this
 * instead of `fetch` (see docs/architecture-notes.md).
 */
export function fetchAppAsset(url: string): Promise<Response> {
  if (boundFetch === null) return globalThis.fetch(url);
  const path = toAppAssetPath(url, lockedOrigin);
  if (path === null) return Promise.reject(new TypeError('fetchAppAsset: only same-origin app assets can be loaded from the geometry sandbox'));
  return boundFetch(path);
}
