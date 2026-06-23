// Dependency-free leaf module so BOTH browser code and Node scripts (via vite
// SSR) can compute the same hash. statsComputation.ts re-exports it for its
// existing importers, but anything that can't afford that module's transitive
// browser deps (localStorage via units/perTabPref) should import from here.

/** Stable, short content hash. Used to stamp the geometry-data payload so
 *  callers can detect when an unchanged code re-render produced the same
 *  output. Not cryptographic — collisions are acceptable. */
export function simpleHash(str: string): string {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
