// Pure parser for model-declared region colors (`api.label(shape, name, { color })`).
// Kept dependency-free (only the shared hex normalizer) so it can run inside the
// geometry Worker sandbox AND be unit-tested in the node tier without a browser.

import { normalizeHexColor } from '../geometry/params';

/**
 * Parse a model-declared region color into normalized RGB in the 0..1 range
 * used everywhere downstream (`ColorRegion.color`, `buildTriColors`).
 *
 * Accepts either:
 *  - a hex string (`'#rgb'` / `'#rrggbb'`, via the same normalizer the `color`
 *    param type uses — so `api.label(s, n, { color: p.accent })` round-trips a
 *    color param directly), or
 *  - an `[r, g, b]` array of three finite numbers in 0..1 (matching the
 *    `ColorRegion.color` convention; values are clamped to 0..1).
 *
 * Returns `null` for anything unparseable; the caller decides whether that's a
 * hard error (the `api.label` validator throws) or a silent skip.
 */
export function parseLabelColor(input: unknown): [number, number, number] | null {
  const hex = normalizeHexColor(input);
  if (hex) {
    return [
      parseInt(hex.slice(1, 3), 16) / 255,
      parseInt(hex.slice(3, 5), 16) / 255,
      parseInt(hex.slice(5, 7), 16) / 255,
    ];
  }
  if (
    Array.isArray(input) &&
    input.length === 3 &&
    input.every((n) => typeof n === 'number' && Number.isFinite(n))
  ) {
    const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
    return [clamp01(input[0]), clamp01(input[1]), clamp01(input[2])];
  }
  return null;
}
