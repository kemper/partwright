/** Runtime companion-file registry for SCAD sessions.
 *
 * Keys are MEMFS-relative paths (e.g. "models.scad",
 * "hkern0_scad/BOSL2_utils.scad") — exactly what appears after the `<` in
 * `include <path>`, with a leading `./` stripped. Values are the source text.
 *
 * `setCompanionFiles` is called by the session manager whenever a version is
 * opened, so the registry always reflects the version currently in the editor.
 * `getCompanionFiles` is read by the engine client when dispatching an execute
 * message to the Worker, which writes the files into OpenSCAD's MEMFS.
 */

let active: Record<string, string> = {};

export function getCompanionFiles(): Record<string, string> {
  return active;
}

export function setCompanionFiles(files: Record<string, string>): void {
  active = { ...files };
}

export function addCompanionFile(path: string, content: string): void {
  active = { ...active, [path]: content };
}

export function removeCompanionFile(path: string): void {
  const copy = { ...active };
  delete copy[path];
  active = copy;
}

export function updateCompanionFile(path: string, content: string): void {
  active = { ...active, [path]: content };
}

/** Compare two companion-file maps for equality (same keys, same content) so a
 *  save or draft-restore that only touches a companion file is still detected as
 *  a change. */
export function companionFilesEqual(
  a: Record<string, string> | undefined,
  b: Record<string, string> | undefined,
): boolean {
  const aKeys = a ? Object.keys(a).sort() : [];
  const bKeys = b ? Object.keys(b).sort() : [];
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((k, i) => bKeys[i] === k && a![k] === b![k]);
}

/** Normalize a user- or import-supplied name into a MEMFS-relative companion
 *  key: trim, strip a leading `./`, and ensure a `.scad` extension — so it
 *  matches what an `include <name>` in the main source resolves against. */
export function normalizeCompanionPath(name: string): string {
  let p = name.trim();
  if (p.startsWith('./')) p = p.slice(2);
  if (!p.endsWith('.scad')) p += '.scad';
  return p;
}

/** Parse non-BOSL2 `include`/`use` paths out of a SCAD source string.
 *  Returns MEMFS-relative paths (leading `./` stripped, BOSL2 and builtins
 *  excluded). */
export function detectMissingIncludes(source: string): string[] {
  const found: string[] = [];
  const re = /\b(?:use|include)\s*<\s*([^>]+?)\s*>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    const raw = m[1].trim();
    if (raw.startsWith('BOSL2/')) continue;
    if (raw === 'builtins.scad') continue;
    const path = raw.startsWith('./') ? raw.slice(2) : raw;
    found.push(path);
  }
  return [...new Set(found)];
}
