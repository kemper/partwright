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

/** Apply ONE literal find/replace, requiring `find` to occur exactly once.
 *  Throws on a missing or ambiguous match. Replacement goes through
 *  split/join so `$`-sequences in `replace` are treated literally (unlike
 *  String.replace, which interprets `$&`, `$1`, etc.). */
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
