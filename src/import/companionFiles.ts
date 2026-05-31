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
