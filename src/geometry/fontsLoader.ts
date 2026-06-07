/**
 * Liberation Sans font loader for the OpenSCAD engine.
 *
 * OpenSCAD's text() primitive requires fontconfig + font files to be present
 * in the WASM virtual filesystem before compilation. This module fetches the
 * Liberation Sans TTF files (the default OpenSCAD font family) from
 * public/openscad-libs/fonts/, caches them in JS memory, and exposes a
 * synchronous preRun hook that writes them into a fresh WASM instance's MEMFS
 * and sets FONTCONFIG_FILE so fontconfig can find them.
 *
 * The preRun hook must be passed to createOpenSCAD() via the preRun option —
 * fontconfig reads FONTCONFIG_FILE during WASM module initialization, before
 * callMain() runs, so setting ENV after the fact has no effect.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

const FONTS_PREFIX = '/openscad-libs/fonts';
const FONT_MEMFS_DIR = '/usr/share/fonts';
const FONTCONFIG_FILE_PATH = '/etc/fonts/fonts.conf';
const FONTS_CONF_XML = `<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd">
<fontconfig>
  <dir>${FONT_MEMFS_DIR}</dir>
  <cachedir>/tmp/fc-cache</cachedir>
</fontconfig>`;

const FONT_FILES = [
  'LiberationSans-Regular.ttf',
  'LiberationSans-Bold.ttf',
  'LiberationSans-Italic.ttf',
  'LiberationSans-BoldItalic.ttf',
];

let fontsPromise: Promise<Map<string, Uint8Array>> | null = null;
let loadedFonts: Map<string, Uint8Array> | null = null;

export function sourceUsesText(source: string): boolean {
  return /\btext\s*\(/.test(source);
}

export async function preloadFonts(): Promise<void> {
  if (loadedFonts) return;
  if (!fontsPromise) {
    fontsPromise = (async () => {
      const entries: [string, Uint8Array][] = await Promise.all(
        FONT_FILES.map(async (name) => {
          const r = await fetch(`${FONTS_PREFIX}/${name}`);
          if (!r.ok) throw new Error(`Failed to fetch font ${name}: ${r.status}`);
          return [name, new Uint8Array(await r.arrayBuffer())] as [string, Uint8Array];
        }),
      );
      return new Map(entries);
    })();
  }
  loadedFonts = await fontsPromise;
}

function mkdirp(fs: any, path: string): void {
  const parts = path.split('/').filter(Boolean);
  let cur = '';
  for (const p of parts) {
    cur += '/' + p;
    try { fs.mkdir(cur); } catch { /* already exists */ }
  }
}

/** Synchronous preRun hook: writes cached font data into MEMFS.
 *  Must only be called after preloadFonts() has resolved. */
export function injectFontsIntoMemfs(mod: any): void {
  if (!loadedFonts) return;
  mkdirp(mod.FS, '/etc/fonts');
  mkdirp(mod.FS, FONT_MEMFS_DIR);
  mod.FS.writeFile(FONTCONFIG_FILE_PATH, FONTS_CONF_XML);
  for (const [name, data] of loadedFonts) {
    mod.FS.writeFile(`${FONT_MEMFS_DIR}/${name}`, data);
  }
  mod.ENV['FONTCONFIG_FILE'] = FONTCONFIG_FILE_PATH;
}
