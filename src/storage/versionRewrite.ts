// Canonical "rewrite a saved version's code" helper.
//
// A saved version couples several fields that must move together when its
// `code` is rewritten (paint migration, mechanical refactors, codegen):
//
//   - `code`                        — the source text itself
//   - `geometryData.codeHash`       — the cached-stats staleness signal: the
//     app compares `simpleHash(code) !== geometryData.codeHash` on load and
//     re-runs the engine on mismatch. Forgetting this restamp makes every
//     rewritten entry load flagged stale (a spurious re-run).
//   - `geometryData.colorRegions`   — the primary paint-region store
//   - `colorRegions`                — the export-layer mirror promoted at
//     schema 1.1 (present on exported `.partwright.json` versions, absent on
//     live IndexedDB records)
//
// Hand-rolling this sync is how the May-2026 catalog migration initially
// missed `codeHash` — use this helper instead. Dependency-free apart from the
// simpleHash leaf, so it loads in the browser AND in Node scripts (via vite
// ssrLoadModule — see scripts/convert-catalog-paint.mjs).
import { simpleHash } from '../geometry/simpleHash';

/** Structural shape of a rewritable version — satisfied by both the live db
 *  `Version` (src/storage/db.ts) and the exported `.partwright.json` version
 *  records (which add the promoted top-level `colorRegions`). */
export interface RewritableVersion {
  code: string;
  /** Export-layer mirror of `geometryData.colorRegions` (schema ≥ 1.1). */
  colorRegions?: unknown[];
  geometryData?: (Record<string, unknown> & { codeHash?: unknown; colorRegions?: unknown }) | null;
}

/**
 * Rewrite a version's code in place, keeping the coupled fields consistent.
 * Returns the same object for chaining.
 *
 * CONTRACT: the new code must produce the same geometry the cached
 * `geometryData` describes (text-only / equivalence-preserving transforms —
 * e.g. moving paint into `api.paint.*` calls). Under that contract the cached
 * stats stay valid, so the staleness hash is restamped to the new code — but
 * ONLY if the old hash matched the old code. If the stats were already stale
 * (hash mismatch before the rewrite), the mismatch is preserved so the app
 * still re-runs rather than trusting stats of unknown provenance.
 *
 * Pass `opts.colorRegions` to atomically replace the paint regions in the
 * same edit: the top-level export mirror AND `geometryData.colorRegions` are
 * both set, so no reader (schema 1.0 geometryData path or schema 1.1 promoted
 * field) sees a stale copy.
 */
export function rewriteVersionCode<V extends RewritableVersion>(
  version: V,
  newCode: string,
  opts: { colorRegions?: unknown[] } = {},
): V {
  const oldCode = version.code;
  version.code = newCode;

  const geo = version.geometryData;
  if (geo && typeof geo === 'object') {
    const hadFreshHash = typeof geo.codeHash === 'string' && geo.codeHash === simpleHash(oldCode);
    if (hadFreshHash) geo.codeHash = simpleHash(newCode);
    if (opts.colorRegions !== undefined) geo.colorRegions = opts.colorRegions;
  }
  if (opts.colorRegions !== undefined) version.colorRegions = opts.colorRegions;
  return version;
}
