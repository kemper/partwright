// Pure helpers for resolving a version's modeling language. Lives in its own
// file (with no engine or DOM imports) so the resolution logic can be unit-
// tested directly.

export type Language = 'manifold-js' | 'scad' | 'replicad' | 'voxel';

/** Default modeling language used when neither the version nor the session
 *  carries one. Mirrors the engine's DEFAULT_LANGUAGE; kept inline here so this
 *  module has no runtime dependencies. */
export const DEFAULT_LANGUAGE: Language = 'manifold-js';

/** Narrow an unknown value to a known {@link Language}. Use at trust
 *  boundaries (importing a `.partwright.json`, restoring a stale draft) so a
 *  junk value like `"python"` doesn't propagate to the engine and editor and
 *  crash a downstream call expecting one of the supported engines. */
export function asLanguage(v: unknown): Language | undefined {
  return v === 'manifold-js' || v === 'scad' || v === 'replicad' || v === 'voxel' ? v : undefined;
}

/** Minimal shape needed to resolve a version's language. */
type VersionLike = { language?: Language } | null | undefined;
type SessionLike = { language?: Language } | null | undefined;

/** Resolve a version's modeling language with the historical fallback chain:
 *  per-version → session-level → default. Use this everywhere read paths need
 *  to know what engine to run; both fields are optional on disk (per-version
 *  was added in schema 1.8; session-level was missing on legacy data). */
export function effectiveVersionLanguage(version: VersionLike, session: SessionLike): Language {
  return version?.language ?? session?.language ?? DEFAULT_LANGUAGE;
}
