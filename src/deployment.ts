// Single source of truth for *where this build is mounted* — the deployment
// base path and the major version it serves. The versioned-deployment strategy
// (see .plans/versioned-deployments-design.md) will eventually serve each major
// under its own path base (`/v1/`, `/v2/`, …) on one origin, with the site root
// a launcher. Today the app is mounted at `/` (major 1, unprefixed).
//
// Vite injects the build-time base as `import.meta.env.BASE_URL` (from the
// `base` config). NOTHING in the app read it before — every path was a literal
// or built from `location.origin` — so changing `base` alone fixed nothing.
// This module is the seam that makes paths base-aware. At base `/` every helper
// is the identity (a true no-op), so wiring it in changes no current behavior.
//
// The pure functions take the base explicitly so they're unit-testable without
// stubbing import.meta.env; the exported convenience wrappers bind the build's
// actual base.

/** Normalize a raw base to always have a single leading and trailing slash:
 *  '' → '/', '/v2' → '/v2/', '/v2/' → '/v2/'. */
export function normalizeBase(raw: string | undefined | null): string {
  let b = (raw ?? '/').trim();
  if (b === '') b = '/';
  if (!b.startsWith('/')) b = '/' + b;
  if (!b.endsWith('/')) b = b + '/';
  return b;
}

/** The major version a base path serves: `/v2/` → 2, `/` (or any non-versioned
 *  base) → 1. The unversioned root deploy is, by definition, major 1. */
export function majorFromBase(base: string): number {
  const m = normalizeBase(base).match(/^\/v(\d+)\//);
  return m ? parseInt(m[1], 10) : 1;
}

/** Join an app-relative route or asset path onto a base. The route may be given
 *  with or without a leading slash; '/' maps to the base itself.
 *    joinBase('/',   '/editor') → '/editor'
 *    joinBase('/v2/', '/editor') → '/v2/editor'
 *    joinBase('/v2/', '/')       → '/v2/' */
export function joinBase(base: string, route: string): string {
  const b = normalizeBase(base);
  const r = route.startsWith('/') ? route.slice(1) : route;
  return b + r; // b already ends with '/'
}

/** Strip the base off a `location.pathname` to get the app-relative route
 *  (always leading-slash). The base itself maps to '/'. A path outside the base
 *  is returned unchanged (defensive — shouldn't happen in practice).
 *    routeFromPath('/',    '/editor')    → '/editor'
 *    routeFromPath('/v2/', '/v2/editor') → '/editor'
 *    routeFromPath('/v2/', '/v2/')       → '/'
 *    routeFromPath('/v2/', '/v2')        → '/' */
export function routeFromPath(base: string, pathname: string): string {
  const b = normalizeBase(base);
  if (b === '/') return pathname === '' ? '/' : pathname;
  const bNoSlash = b.slice(0, -1); // '/v2'
  if (pathname === b || pathname === bNoSlash) return '/';
  if (pathname.startsWith(b)) return '/' + pathname.slice(b.length);
  return pathname;
}

/** The build's normalized base path ('/', '/v2/', …). */
export const BASE: string = normalizeBase(
  typeof import.meta !== 'undefined' ? import.meta.env?.BASE_URL : '/',
);

/** The major version this build serves (1 for the unversioned root deploy). */
export function currentMajor(): number {
  return majorFromBase(BASE);
}

/** An app route resolved to a full path under this build's base. Use when
 *  writing history entries / building links. '/editor' → BASE+'editor'. */
export function appPath(route: string): string {
  return joinBase(BASE, route);
}

/** The app-relative route for a `location.pathname` under this build's base.
 *  Use in route predicates instead of comparing pathname to a literal. */
export function appRoute(pathname: string): string {
  return routeFromPath(BASE, pathname);
}

/** The URL for a public/ asset under this build's base. Use for `fetch()` of
 *  static files (ai.md, catalog manifest, OpenSCAD libs, fonts) so they resolve
 *  under `/vN/` instead of the origin root. '/ai.md' → BASE+'ai.md'. */
export function assetPath(path: string): string {
  return joinBase(BASE, path);
}
