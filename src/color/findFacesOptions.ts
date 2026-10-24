// Option-shape validation for `partwright.findFaces` (pure, unit-tested).
//
// Every filter is optional and omitting one means "don't filter on it". A key
// that is PRESENT but `undefined`/`null` is almost always a bug in the caller
// (`{ region: maybeId }` with an unset variable), and it used to fall through
// as "no filter" — so `findFaces({ region: undefined })` silently matched the
// whole mesh. Reject it, and reject unknown keys, with a message that says how
// to fix the call.

const FIND_FACES_KEYS = [
  'box', 'normal', 'normalTolerance', 'color', 'region', 'withinPart',
  'maxResults', 'coverageMode', 'maxTriangleArea',
] as const;

/** Error message for a malformed findFaces options object, or null. */
export function findFacesKeyError(opts: Record<string, unknown>): string | null {
  const allowed: readonly string[] = FIND_FACES_KEYS;
  for (const key of Object.keys(opts)) {
    if (!allowed.includes(key)) {
      return `findFaces: unknown option "${key}". Allowed: ${FIND_FACES_KEYS.join(', ')}.`;
    }
    const v = opts[key];
    if (v === undefined || v === null) {
      return `findFaces: "${key}" was passed as ${v === null ? 'null' : 'undefined'}. Omit the key to skip that filter; pass a value to filter by it.`;
    }
  }
  return null;
}
