/**
 * BOSL2 loader for the OpenSCAD engine.
 *
 * BOSL2 (Belfry OpenScad Library v2) is the de-facto standard library for
 * advanced OpenSCAD work: paths, beziers, skin/loft, sweep, rounding masks,
 * screws, gears, attachments. It's BSD-2-Clause licensed and bundled with the
 * app under `public/openscad-libs/BOSL2/`.
 *
 * OpenSCAD WASM uses MEMFS, an in-memory filesystem. To make `use <BOSL2/...>`
 * resolve at compile time, we fetch the BOSL2 source files (lazy on first
 * SCAD run that references them) and write each one into MEMFS at /BOSL2/.
 *
 * Source bytes are cached at module scope across runs — the WASM instance is
 * fresh each run, but the JS-side fetch only happens once per page load.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

interface Bosl2Manifest {
  files: string[];
}

const BOSL2_PREFIX = '/openscad-libs/BOSL2';
const MEMFS_DIR = '/BOSL2';

let manifestPromise: Promise<Bosl2Manifest> | null = null;
let filesPromise: Promise<Map<string, string>> | null = null;

/**
 * Does this SCAD source reference BOSL2? Matches both `use <BOSL2/...>` and
 * `include <BOSL2/...>`, with optional whitespace.
 */
export function sourceUsesBosl2(source: string): boolean {
  return /\b(?:use|include)\s*<\s*BOSL2\//.test(source);
}

async function loadManifest(): Promise<Bosl2Manifest> {
  if (!manifestPromise) {
    manifestPromise = (async () => {
      const resp = await fetch(`${BOSL2_PREFIX}/_manifest.json`);
      if (!resp.ok) throw new Error(`Failed to fetch BOSL2 manifest: ${resp.status}`);
      return resp.json();
    })();
  }
  return manifestPromise;
}

async function loadAllFiles(): Promise<Map<string, string>> {
  if (!filesPromise) {
    filesPromise = (async () => {
      const manifest = await loadManifest();
      const entries: [string, string][] = await Promise.all(
        manifest.files.map(async (name) => {
          const r = await fetch(`${BOSL2_PREFIX}/${name}`);
          if (!r.ok) throw new Error(`Failed to fetch BOSL2/${name}: ${r.status}`);
          return [name, await r.text()] as [string, string];
        }),
      );
      return new Map(entries);
    })();
  }
  return filesPromise;
}

/**
 * Make BOSL2 available to a fresh OpenSCAD WASM instance by mirroring all
 * library files into `/BOSL2/` in MEMFS. Idempotent per instance.
 */
export async function ensureBosl2InMemfs(instance: any): Promise<void> {
  const files = await loadAllFiles();
  const fs = instance.FS;
  // mkdir is idempotent for the purposes here, but Emscripten's MEMFS throws
  // if the directory already exists, so guard.
  try {
    fs.stat(MEMFS_DIR);
  } catch {
    fs.mkdir(MEMFS_DIR);
  }
  for (const [name, contents] of files) {
    fs.writeFile(`${MEMFS_DIR}/${name}`, contents);
  }
}
