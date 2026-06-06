// Cross-origin isolation detection. manifold-3d (and the OpenSCAD / OCCT
// engines) need SharedArrayBuffer, which is only available when the page is
// cross-origin isolated (COOP + COEP headers). The coi-serviceworker.js shim
// installs those headers and reloads ONCE to gain isolation, so on a first
// visit `crossOriginIsolated` can be transiently false before that reload.
//
// These helpers are dependency-free so the decision logic can be unit-tested
// without a browser. The actual reload-gating in main.ts uses a sessionStorage
// flag so we don't flash the scary "not supported" message during the shim's
// one legitimate reload.

/** True when the environment can back a SharedArrayBuffer — the precondition
 *  for the WASM engines. Reads `crossOriginIsolated` and `SharedArrayBuffer`
 *  off the provided scope (defaults to globalThis) so tests can pass a stub. */
export function isolationSupported(
  scope: { crossOriginIsolated?: boolean; SharedArrayBuffer?: unknown } = globalThis as unknown as {
    crossOriginIsolated?: boolean;
    SharedArrayBuffer?: unknown;
  },
): boolean {
  return scope.crossOriginIsolated === true && typeof scope.SharedArrayBuffer !== 'undefined';
}
