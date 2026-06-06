// Literal find/replace patching for the forkVersion / modifyAndTest tools.
//
// Kept dependency-free (no engine/three imports) so it is unit-testable in
// isolation. The whole reason this module exists is that
// `String.prototype.replace(string, string)` is a silent data-loss trap for
// a patch API: it returns the input UNCHANGED when `find` is absent, and
// replaces only the FIRST of several matches. Either case lets a fork
// "succeed" having changed nothing — exactly the failure that made an agent
// believe it had removed a feature when the saved version was untouched.
// These helpers turn both cases into errors.

export interface Patch {
  find: string;
  replace: string;
}

/** Collapse whitespace and clip a find-string for an error message so a
 *  multi-line snippet doesn't dominate the tool result. */
export function truncateForError(s: string, max = 80): string {
  const oneLine = s.replace(/\s+/g, ' ').trim();
  return oneLine.length > max ? `${oneLine.slice(0, max)}…` : oneLine;
}

/** Escape regex special characters in a string literal. */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Try matching `find` against `code` using whitespace-normalized matching.
 *  Builds a regex from the find string's non-whitespace tokens separated by
 *  \s+, so code that was auto-reformatted (e.g. a multi-line declaration
 *  collapsed to one line) still matches. Returns the patched code on a unique
 *  match, null if there are zero or multiple matches. */
function tryWhitespaceFallback(code: string, find: string, replace: string): string | null {
  const tokens = find.split(/\s+/).filter(t => t.length > 0);
  if (tokens.length === 0) return null;
  const pattern = tokens.map(escapeRegex).join('\\s+');
  const regex = new RegExp(pattern, 'g');
  const matches = [...code.matchAll(regex)];
  if (matches.length !== 1) return null;
  const m = matches[0];
  return code.slice(0, m.index) + replace + code.slice(m.index! + m[0].length);
}

/** Apply ONE literal find/replace, requiring `find` to occur exactly once.
 *  Throws on a missing or ambiguous match. Replacement goes through
 *  split/join so `$`-sequences in `replace` are treated literally (unlike
 *  String.replace, which interprets `$&`, `$1`, etc.).
 *
 *  When an exact match fails, falls back to whitespace-normalized matching —
 *  the auto-formatter may reflow whitespace (e.g. expand/collapse multi-line
 *  declarations) so a find string copied from one render of the code fails
 *  against the reformatted version. The fallback matches if the tokens match
 *  in order with any whitespace between them, and it applies only when the
 *  match is unambiguous (exactly one occurrence). */
export function applyLiteralPatch(code: string, find: unknown, replace: unknown, idx?: number): string {
  const where = idx === undefined ? 'patch' : `patches[${idx}]`;
  if (typeof find !== 'string' || find.length === 0) {
    throw new Error(`${where}.find must be a non-empty string.`);
  }
  if (typeof replace !== 'string') {
    throw new Error(`${where}.replace must be a string.`);
  }
  const occurrences = code.split(find).length - 1;
  if (occurrences === 0) {
    // Exact match failed — try whitespace-normalized fallback before erroring
    const fallback = tryWhitespaceFallback(code, find, replace);
    if (fallback !== null) return fallback;
    throw new Error(`${where} find string not present in the code — nothing was changed. Read the current code and match the exact text including whitespace: "${truncateForError(find)}"`);
  }
  if (occurrences > 1) {
    throw new Error(`${where} find string matches ${occurrences} places — it must be unique. Include more surrounding context to disambiguate: "${truncateForError(find)}"`);
  }
  return code.split(find).join(replace);
}

/** Apply a sequence of patches, each requiring a unique match against the
 *  running result. Throws on the first patch that doesn't match exactly once. */
export function applyPatches(patches: Patch[], code: string): string {
  return patches.reduce((c, p, i) => applyLiteralPatch(c, p.find, p.replace, i), code);
}
