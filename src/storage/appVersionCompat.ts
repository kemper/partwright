// App-version provenance + cross-major compatibility — the pure, dependency-free
// seam that records which app (semver) version authored a session/file and
// decides what to do when that differs from the running build.
//
// This is deliberately split out of sessionManager.ts (which can't be imported
// under the node unit tier — it drags in IndexedDB, the engine, and the DOM),
// mirroring languageFallback.ts. Keep it free of browser/engine deps so
// tests/unit/appVersionCompat.test.ts can exercise it directly.
//
// IMPORTANT distinction: this is the **app** version (package.json `version`,
// e.g. "1.0.0", surfaced via buildInfo.version) — NOT the export **schema**
// version (`partwright: "1.15"`, handled by parseSchemaVersion in
// sessionManager). The two axes move independently.
//
// MIGRATION SEAM: when the first breaking major ships, the forward-migration
// codemod hooks in at appVersionCompatibility() below — see the `older` branch.

import { buildInfo } from '../buildInfo';

/** The structural slice of an exported session this module reads. Defined
 *  locally (not imported from sessionManager) so the dependency graph stays
 *  acyclic — sessionManager imports us, never the reverse. */
export interface AppVersionedExport {
  /** App semver the file was exported with (top-level, schema 1.15+). */
  appVersion?: string;
  /** Per-version app-version stamps; used as a fallback provenance source. */
  versions?: { appVersion?: string }[];
}

/** Parse the major component of a semver-ish string, or null if unusable
 *  (empty, 'unknown', non-numeric). */
export function parseAppMajor(version: string | null | undefined): number | null {
  if (!version || version === 'unknown') return null;
  const major = parseInt(String(version).split('.')[0], 10);
  return Number.isFinite(major) ? major : null;
}

/** Compare two semver-ish strings. Returns >0 if a is newer, <0 if older, 0 if
 *  equal/incomparable. Missing components count as 0 (so "1.2" === "1.2.0").
 *  Assumes plain numeric `X.Y.Z` (this project's release scheme); a pre-release
 *  tag like "1.2.0-rc1" would coerce its tagged component to 0 — only the major
 *  ultimately drives any decision (via parseAppMajor), so that's harmless, but
 *  revisit here if pre-release versions ever ship. */
function compareSemver(a: string, b: string): number {
  const pa = a.split('.').map(n => parseInt(n, 10) || 0);
  const pb = b.split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** The app (semver) version recorded on an exported file, or null if it
 *  predates app-version stamping (schema < 1.15). Top-level wins; falls back to
 *  the newest per-version stamp so a hand-assembled or partial file still
 *  yields a sensible "authored with" value. */
export function exportedAppVersion(data: AppVersionedExport): string | null {
  if (typeof data.appVersion === 'string' && data.appVersion && data.appVersion !== 'unknown') {
    return data.appVersion;
  }
  let newest: string | null = null;
  for (const v of data.versions ?? []) {
    const ver = v?.appVersion;
    if (typeof ver !== 'string' || !ver || ver === 'unknown') continue;
    if (newest === null || compareSemver(ver, newest) > 0) newest = ver;
  }
  return newest;
}

export interface AppVersionCompatibility {
  /** How the file's authoring major relates to the running build. 'unknown'
   *  when the file predates stamping or either version is unparseable. */
  relation: 'same' | 'newer' | 'older' | 'unknown';
  /** App semver recorded on the file, if any. */
  fileVersion: string | null;
  /** The running build's app semver. */
  runningVersion: string;
  /** A user-facing warning, or null when none is warranted. Only the 'newer'
   *  case warns today (forward-incompatible); 'older' is silent — it's where a
   *  future major will run its migration codemod instead. */
  warning: string | null;
}

/**
 * Classify an exported file's authoring app version against the running build.
 *
 * - **newer major** ⇒ warn (the file may use capabilities/schema this build
 *   doesn't understand; best-effort import, unknown fields dropped).
 * - **older major** ⇒ silent today. THIS IS THE MIGRATION SEAM: when v2 ships,
 *   branch here to run the forward codemod on `data` before it's imported.
 * - **same major / no stamp / unparseable** ⇒ silent.
 *
 * `runningVersion` defaults to the build's version but is injectable for tests.
 */
export function appVersionCompatibility(
  data: AppVersionedExport,
  runningVersion: string = buildInfo.version,
): AppVersionCompatibility {
  const fileVersion = exportedAppVersion(data);
  const fileMajor = parseAppMajor(fileVersion);
  const runningMajor = parseAppMajor(runningVersion);

  if (fileMajor === null || runningMajor === null) {
    return { relation: 'unknown', fileVersion, runningVersion, warning: null };
  }
  if (fileMajor > runningMajor) {
    return {
      relation: 'newer',
      fileVersion,
      runningVersion,
      warning:
        `This file was created with a newer major version of Partwright ` +
        `(v${fileVersion}). You're on v${runningVersion}; some data may be ` +
        `missing or import incorrectly.`,
    };
  }
  if (fileMajor < runningMajor) {
    return { relation: 'older', fileVersion, runningVersion, warning: null };
  }
  return { relation: 'same', fileVersion, runningVersion, warning: null };
}
