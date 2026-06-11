// Rotating editor starters — one simple, self-coloured primitive per engine.
//
// A fresh session/part (or a language switch) seeds the next starter in the
// engine's rotation, so the editor opens on a plain cube / sphere / cylinder /
// cone / pyramid rather than always the same model. Each is deliberately a
// SINGLE primitive (not a finished design) wrapped with a label so it can be
// recoloured in one click, and given a basic starting colour:
//
//   - manifold-js & voxel carry colour in code (api.label{color} / per-voxel),
//   - scad & replicad can't, so they declare a label + a `paint` descriptor the
//     editor applies via paintByLabel once the run registers the label.
//
// Pure data + helpers (no DOM/WASM) so it unit-tests in the vitest tier.

import type { Language } from '../geometry/engine';

export interface StarterPaint {
  /** Label name to paint (matches the label declared in `code`). */
  label: string;
  /** Basic starting colour as a hex string; the seam converts it to 0..1 RGB. */
  colorHex: string;
}

export interface Starter {
  code: string;
  /** Post-run paint for engines without in-code colour (scad, replicad). */
  paint?: StarterPaint;
}

// Basic, distinct primitive colours shared across engines.
const BLUE = '#3b82f6';
const ORANGE = '#f97316';
const GREEN = '#22c55e';
const RED = '#ef4444';
const PURPLE = '#a855f7';

// --- manifold-js: one labelled, self-coloured primitive each ----------------
const MANIFOLD_JS: Starter[] = [
  { code: `// A labelled, self-coloured cube — the simplest manifold-js starter. Each
// starter wraps one primitive in api.label(shape, name, { color }) so it renders
// and exports coloured with no separate paint step. Edit a value and re-run.
const { Manifold } = api;
return api.label(Manifold.cube([20, 20, 20], true).translate([0, 0, 10]), 'cube', { color: '${BLUE}' });
` },
  { code: `// A labelled, self-coloured sphere. Edit the radius or colour and re-run.
const { Manifold } = api;
return api.label(Manifold.sphere(12, 64).translate([0, 0, 12]), 'sphere', { color: '${ORANGE}' });
` },
  { code: `// A labelled, self-coloured cylinder. Edit the radius/height or colour and re-run.
const { Manifold } = api;
return api.label(Manifold.cylinder(24, 9, 9, 64), 'cylinder', { color: '${GREEN}' });
` },
  { code: `// A labelled, self-coloured cone (a cylinder whose top radius is 0).
const { Manifold } = api;
return api.label(Manifold.cylinder(24, 11, 0, 64), 'cone', { color: '${RED}' });
` },
  { code: `// A labelled, self-coloured square pyramid (a 4-sided cone). Edit and re-run.
const { Manifold } = api;
return api.label(Manifold.cylinder(22, 14, 0, 4), 'pyramid', { color: '${PURPLE}' });
` },
];

// --- voxel: one coloured primitive each (voxels are coloured per cell) -------
const VOXEL: Starter[] = [
  { code: `// A single coloured voxel cube — the simplest voxel starter. Voxels are
// coloured per cell; edit the size or colour and re-run.
const { voxels } = api;
const v = voxels();
v.fillBox([-6, -6, 0], [5, 5, 11], '${BLUE}');
return v;
` },
  { code: `// A single coloured voxel sphere. Edit the radius or colour and re-run.
const { voxels } = api;
const v = voxels();
v.sphere([0, 0, 8], 8, '${ORANGE}');
return v;
` },
  { code: `// A single coloured voxel cylinder. Edit the radius/height or colour and re-run.
const { voxels } = api;
const v = voxels();
v.cylinder([0, 0, 0], 7, 16, '${GREEN}');
return v;
` },
  { code: `// A coloured stepped voxel pyramid. Edit the base size or colour and re-run.
const { voxels } = api;
const v = voxels();
for (let z = 0; z <= 11; z++) {
  const r = 11 - z;
  v.fillBox([-r, -r, z], [r, r, z], '${PURPLE}');
}
return v;
` },
];

// --- scad: labelled primitive; the editor paints the label after the run ----
const SCAD: Starter[] = [
  { code: `// A labelled cube. SCAD can't carry colour in code, so the editor paints the
// "cube" label a basic colour for you after the first run. Edit and re-run.
label("cube") translate([0, 0, 10]) cube([20, 20, 20], center = true);
`, paint: { label: 'cube', colorHex: BLUE } },
  { code: `// A labelled sphere; the editor paints its "sphere" label after the first run.
$fn = 48;
label("sphere") translate([0, 0, 12]) sphere(r = 12);
`, paint: { label: 'sphere', colorHex: ORANGE } },
  { code: `// A labelled cylinder; the editor paints its "cylinder" label after the run.
$fn = 48;
label("cylinder") cylinder(h = 24, r = 9);
`, paint: { label: 'cylinder', colorHex: GREEN } },
  { code: `// A labelled cone; the editor paints its "cone" label after the first run.
$fn = 48;
label("cone") cylinder(h = 24, r1 = 11, r2 = 0);
`, paint: { label: 'cone', colorHex: RED } },
  { code: `// A labelled square pyramid (a 4-sided cone); painted after the first run.
label("pyramid") cylinder(h = 22, r1 = 14, r2 = 0, $fn = 4);
`, paint: { label: 'pyramid', colorHex: PURPLE } },
];

// --- replicad / BREP: labelled primitive; painted after the run -------------
const REPLICAD: Starter[] = [
  { code: `// A labelled BREP box. replicad can't carry colour in code, so the editor
// paints the "cube" label a basic colour after the first run. Edit and re-run.
const { BREP } = api;
return BREP.label(BREP.box([20, 20, 20]).translate([0, 0, 10]), 'cube');
`, paint: { label: 'cube', colorHex: BLUE } },
  { code: `// A labelled BREP sphere; the editor paints its "sphere" label after the run.
const { BREP } = api;
return BREP.label(BREP.sphere(12).translate([0, 0, 12]), 'sphere');
`, paint: { label: 'sphere', colorHex: ORANGE } },
  { code: `// A labelled BREP cylinder; the editor paints its "cylinder" label after the run.
const { BREP } = api;
return BREP.label(BREP.cylinder(9, 24), 'cylinder');
`, paint: { label: 'cylinder', colorHex: GREEN } },
  { code: `// A labelled BREP cone; the editor paints its "cone" label after the first run.
const { BREP } = api;
return BREP.label(BREP.cone(11, 0, 24), 'cone');
`, paint: { label: 'cone', colorHex: RED } },
];

export const STARTERS: Record<Language, Starter[]> = {
  'manifold-js': MANIFOLD_JS,
  voxel: VOXEL,
  scad: SCAD,
  replicad: REPLICAD,
};

const ROTATION_KEY_PREFIX = 'partwright:starter-rotation:';

/** The next starter in `lang`'s rotation, advancing a per-language persisted
 *  index so successive fresh sessions/parts open on different primitives.
 *  Storage failures (private mode) degrade to no rotation (always the first). */
export function nextStarter(lang: Language): Starter {
  const set = STARTERS[lang];
  if (!set || set.length === 0) {
    return { code: '// Write your model here.\nconst { Manifold } = api;\nreturn Manifold.cube([10, 10, 10], true);\n' };
  }
  const key = ROTATION_KEY_PREFIX + lang;
  let idx = 0;
  try {
    idx = parseInt(localStorage.getItem(key) ?? '0', 10);
  } catch { /* no storage */ }
  if (!Number.isInteger(idx) || idx < 0) idx = 0;
  const starter = set[idx % set.length];
  try {
    localStorage.setItem(key, String((idx + 1) % set.length));
  } catch { /* ignore */ }
  return starter;
}

/** Whitespace-insensitive comparison key. Auto-format (js-beautify) and the
 *  editor reflow only whitespace, so stripping it lets a seeded-then-formatted
 *  starter still match its source while any real token edit still differs. */
function normalize(code: string): string {
  return code.replace(/\s+/g, '');
}

const STARTER_KEYS: Set<string> = new Set(
  Object.values(STARTERS).flat().map((s) => normalize(s.code)),
);

/** True when `code` is an untouched starter (any engine) — used to decide a
 *  part is an "expendable" starter that an import may overwrite. Also matches
 *  the legacy `Manifold.cube([10, 10, 10])` stub for back-compat with old
 *  drafts. Empty code counts as a blank starter. */
export function isStarterCode(code: string): boolean {
  const t = code.trim();
  if (!t) return true;
  if (STARTER_KEYS.has(normalize(code))) return true;
  return /^(\/\/ (New session|New part)\n)?const \{ Manifold \} = api;\nreturn Manifold\.cube\(\[10, 10, 10\], true\);$/.test(t);
}
