// The Character Creator's Realistic family: a spec the panel edits, compiled
// to `api.human({...})` code (kemper/partwright#1170). The Avatar family is the
// `api.sdf.figure` spec in src/figure/characterSpec.ts; both stay, and the
// panel switches between them.
//
// Like the Avatar spec, the generated code carries the spec as a header
// comment (`// @human-character v1 {json}`) so re-opening the panel restores
// every control. The Avatar header is `// @character vN`, so the two never
// match each other's pattern.
//
// Pure data and string building — no DOM, no engine — so it unit-tests in the
// vitest tier (tests/unit/humanCharacter.test.ts).

import { STYLE_PRESETS, type StylePreset } from './humanStyle';
import { HAIR_STYLES, HAIR_FRINGES, BEARD_STYLES, type HairStyle } from './humanHair';
import { ARMOR_ITEMS } from './humanWear';
import { HAT_ITEMS, PROP_ITEMS } from './humanGear';
import { EXPRESSION_PRESETS } from './humanModel';
import type { CharacterSpec } from '../figure/characterSpec';

export const CHARACTER_FAMILIES = ['realistic', 'avatar'] as const;
export type CharacterFamily = typeof CHARACTER_FAMILIES[number];

export const HUMAN_TOPS = ['none', 'tshirt', 'shirt', 'top', 'sweater', 'jacket', 'coat'] as const;
export const HUMAN_SLEEVES = ['none', 'cap', 'short', 'elbow', 'three-quarter', 'long'] as const;
export const HUMAN_NECKLINES = ['crew', 'scoop', 'v', 'turtle', 'boat'] as const;
export const HUMAN_BOTTOMS = ['none', 'pants', 'jeans', 'shorts', 'leggings', 'skirt', 'briefs'] as const;
export const HUMAN_SKIRT_LENGTHS = ['mini', 'knee', 'midi', 'maxi'] as const;
export const HUMAN_SHOES = ['none', 'shoes', 'sneakers', 'boots'] as const;
export const HUMAN_HATS = ['none', ...HAT_ITEMS] as const;
export const HUMAN_EYEWEAR = ['none', 'glasses', 'sunglasses'] as const;
export const HUMAN_PROPS = ['none', ...PROP_ITEMS] as const;
export const HUMAN_EXPRESSIONS = Object.keys(EXPRESSION_PRESETS);
export const HUMAN_POSES = ['relaxed', 'wave', 'cheer', 'armsOut', 'walking', 'aPose'] as const;
export const HUMAN_ARMOR = ARMOR_ITEMS;

export type HumanPosePreset = typeof HUMAN_POSES[number];

export interface HumanCharacterSpec {
  family: 'realistic';
  /** Print height, soles → crown. */
  height: number;
  style: StylePreset;
  body: { gender: number; age: number; muscle: number; weight: number; stature: number; breast: number };
  torso: { vShape: number; belly: number };
  face: { jawWidth: number; chin: number; cheekbones: number; noseWidth: number; noseLength: number; mouthWidth: number; eyeSize: number; headSquare: number };
  expression: string;
  pose: HumanPosePreset;
  hair: { style: HairStyle; fringe: typeof HAIR_FRINGES[number]; beard: typeof BEARD_STYLES[number]; length: number; volume: number };
  wear: {
    top: typeof HUMAN_TOPS[number]; sleeve: typeof HUMAN_SLEEVES[number]; neckline: typeof HUMAN_NECKLINES[number];
    bottom: typeof HUMAN_BOTTOMS[number]; skirtLength: typeof HUMAN_SKIRT_LENGTHS[number];
    shoes: typeof HUMAN_SHOES[number];
    socks: boolean; gloves: boolean; belt: boolean; scarf: boolean;
  };
  /** Armor pieces worn over the clothes, in ARMOR_ITEMS order. */
  armor: string[];
  hat: typeof HUMAN_HATS[number];
  eyewear: typeof HUMAN_EYEWEAR[number];
  necklace: boolean;
  backpack: boolean;
  cape: boolean;
  hold: { L: typeof HUMAN_PROPS[number]; R: typeof HUMAN_PROPS[number] };
  colors: { skin: string; iris: string; lips: string; hair: string; top: string; bottom: string; shoes: string; armor: string; accent: string };
  base: boolean;
}

export const DEFAULT_HUMAN_SPEC: HumanCharacterSpec = {
  family: 'realistic',
  height: 60,
  style: 'realistic',
  body: { gender: 0.5, age: 25, muscle: 0.5, weight: 0.5, stature: 0.5, breast: 0 },
  torso: { vShape: 0, belly: 0 },
  face: { jawWidth: 0, chin: 0, cheekbones: 0, noseWidth: 0, noseLength: 0, mouthWidth: 0, eyeSize: 0, headSquare: 0 },
  expression: 'smile',
  pose: 'relaxed',
  hair: { style: 'short', fringe: 'none', beard: 'none', length: 1, volume: 1 },
  wear: { top: 'tshirt', sleeve: 'short', neckline: 'crew', bottom: 'jeans', skirtLength: 'knee', shoes: 'sneakers', socks: false, gloves: false, belt: false, scarf: false },
  armor: [],
  hat: 'none',
  eyewear: 'none',
  necklace: false,
  backpack: false,
  cape: false,
  hold: { L: 'none', R: 'none' },
  colors: {
    skin: '#c68642', iris: '#5b3a21', lips: '#a3584a', hair: '#3b2a1e',
    top: '#2f6f8f', bottom: '#3b5675', shoes: '#f2f2f2', armor: '#9aa3ad', accent: '#b03a2e',
  },
  base: true,
};

export function cloneHumanSpec(s: HumanCharacterSpec): HumanCharacterSpec {
  return JSON.parse(JSON.stringify(s)) as HumanCharacterSpec;
}

// --- Validation -------------------------------------------------------------

/** Numeric fields: [path, min, max]. */
const NUMBERS: [string, number, number][] = [
  ['height', 5, 2000],
  ['body.gender', 0, 1], ['body.age', 1, 90], ['body.muscle', 0, 1], ['body.weight', 0, 1], ['body.stature', 0, 1], ['body.breast', 0, 1],
  ['torso.vShape', -1, 1], ['torso.belly', -1, 1],
  ['face.jawWidth', -1, 1], ['face.chin', -1, 1], ['face.cheekbones', -1, 1], ['face.noseWidth', -1, 1], ['face.noseLength', -1, 1],
  ['face.mouthWidth', -1, 1], ['face.eyeSize', -1, 1], ['face.headSquare', 0, 1],
  ['hair.length', 0.3, 2.5], ['hair.volume', 0.3, 2.5],
];
/** Enum fields: [path, allowed values]. */
const ENUMS: [string, readonly string[]][] = [
  ['style', STYLE_PRESETS], ['expression', HUMAN_EXPRESSIONS], ['pose', HUMAN_POSES],
  ['hair.style', HAIR_STYLES], ['hair.fringe', HAIR_FRINGES], ['hair.beard', BEARD_STYLES],
  ['wear.top', HUMAN_TOPS], ['wear.sleeve', HUMAN_SLEEVES], ['wear.neckline', HUMAN_NECKLINES],
  ['wear.bottom', HUMAN_BOTTOMS], ['wear.skirtLength', HUMAN_SKIRT_LENGTHS], ['wear.shoes', HUMAN_SHOES],
  ['hat', HUMAN_HATS], ['eyewear', HUMAN_EYEWEAR], ['hold.L', HUMAN_PROPS], ['hold.R', HUMAN_PROPS],
];
const BOOLEANS = ['wear.socks', 'wear.gloves', 'wear.belt', 'wear.scarf', 'necklace', 'backpack', 'cape', 'base'];
const COLOR_KEYS = Object.keys(DEFAULT_HUMAN_SPEC.colors);
const HEX = /^#[0-9a-fA-F]{6}$/;

function get(o: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((x, k) => (x && typeof x === 'object' ? (x as Record<string, unknown>)[k] : undefined), o);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** Merge a (possibly partial) spec onto the defaults. Only known keys are
 *  copied, and never `__proto__` / `constructor` (the header is user-editable
 *  text). Values are not checked here: run validateHumanSpec on the result. */
export function normalizeHumanSpec(raw: unknown): HumanCharacterSpec {
  const out = cloneHumanSpec(DEFAULT_HUMAN_SPEC);
  if (!isPlainObject(raw)) return out;
  const merge = (dst: Record<string, unknown>, src: Record<string, unknown>) => {
    for (const k of Object.keys(dst)) {
      if (!Object.prototype.hasOwnProperty.call(src, k)) continue;
      const v = src[k];
      if (isPlainObject(dst[k]) && isPlainObject(v)) merge(dst[k] as Record<string, unknown>, v);
      else dst[k] = Array.isArray(v) ? [...v] : v;
    }
  };
  merge(out as unknown as Record<string, unknown>, raw);
  out.family = 'realistic';
  return out;
}

/** Every problem with a spec, as `path: message` strings (empty when valid).
 *  Unknown keys are reported too, so a typo isn't silently dropped. */
export function validateHumanSpec(spec: unknown): string[] {
  const problems: string[] = [];
  if (!isPlainObject(spec)) return ['spec must be an object'];
  const walkUnknown = (shape: Record<string, unknown>, given: Record<string, unknown>, prefix: string) => {
    for (const k of Object.keys(given)) {
      if (k === 'version' && prefix === '') continue;
      if (!Object.prototype.hasOwnProperty.call(shape, k)) { problems.push(`${prefix}${k}: unknown key`); continue; }
      if (isPlainObject(shape[k]) && isPlainObject(given[k])) walkUnknown(shape[k] as Record<string, unknown>, given[k] as Record<string, unknown>, `${prefix}${k}.`);
    }
  };
  walkUnknown(DEFAULT_HUMAN_SPEC as unknown as Record<string, unknown>, spec, '');
  const s = normalizeHumanSpec(spec);
  // A section given as null (or anything not an object) replaces the default
  // wholesale; report it instead of reading fields off it.
  for (const k of ['body', 'torso', 'face', 'hair', 'wear', 'hold', 'colors'] as const) {
    if (!isPlainObject(s[k])) problems.push(`${k}: must be an object`);
  }
  if (problems.some(p => p.endsWith('must be an object'))) return problems;
  if (spec.family !== undefined && spec.family !== 'realistic') problems.push(`family: must be "realistic" here`);
  for (const [path, lo, hi] of NUMBERS) {
    const v = get(s, path);
    if (typeof v !== 'number' || !Number.isFinite(v) || v < lo || v > hi) problems.push(`${path}: must be a number ${lo}–${hi}`);
  }
  for (const [path, values] of ENUMS) {
    const v = get(s, path);
    if (typeof v !== 'string' || !values.includes(v)) problems.push(`${path}: must be one of ${values.join(', ')}`);
  }
  for (const path of BOOLEANS) if (typeof get(s, path) !== 'boolean') problems.push(`${path}: must be true or false`);
  if (!Array.isArray(s.armor) || s.armor.some(a => !(HUMAN_ARMOR as readonly string[]).includes(a))) {
    problems.push(`armor: must be a list of ${HUMAN_ARMOR.join(', ')}`);
  } else if (new Set(s.armor).size !== s.armor.length) problems.push('armor: lists a piece twice');
  for (const k of COLOR_KEYS) {
    const v = (s.colors as Record<string, unknown>)[k];
    if (typeof v !== 'string' || !HEX.test(v)) problems.push(`colors.${k}: must be "#rrggbb"`);
  }
  return problems;
}

// --- Code generation --------------------------------------------------------

/** Each pose preset's `api.human` pose (undefined = the default relaxed arms). */
const POSES: Record<HumanPosePreset, unknown> = {
  relaxed: undefined,
  wave: { armR: { raiseSide: 150, bend: 50, twist: 60 }, handR: 'open', head: { yaw: -8 } },
  cheer: { armL: { raiseSide: 155, bend: 20 }, armR: { raiseSide: 155, bend: 20 }, handL: 'fist', handR: 'fist' },
  armsOut: { armL: { raiseSide: 90 }, armR: { raiseSide: 90 }, handL: 'open', handR: 'open' },
  walking: { armL: { raiseFwd: -18, bend: 12 }, armR: { raiseFwd: 18, bend: 12 }, legL: { raiseFwd: 14, bend: 6 }, legR: { raiseFwd: -12, bend: 10 } },
  aPose: 'rest',
};

export const HUMAN_POSE_LABELS: Record<HumanPosePreset, string> = {
  relaxed: 'Relaxed', wave: 'Wave', cheer: 'Cheer', armsOut: 'Arms out', walking: 'Walking', aPose: 'A-pose',
};

/** Only the keys of `o` that differ from `d`. */
function changed<T extends Record<string, unknown>>(o: T, d: T): Partial<T> {
  const out: Partial<T> = {};
  for (const k of Object.keys(o) as (keyof T)[]) if (o[k] !== d[k]) out[k] = o[k];
  return out;
}

/** The `api.human` options object for a spec. */
export function humanSpecToOptions(spec: HumanCharacterSpec): Record<string, unknown> {
  const d = DEFAULT_HUMAN_SPEC;
  const opts: Record<string, unknown> = { height: spec.height };
  if (spec.style !== 'realistic') opts.style = spec.style;
  opts.body = { ...spec.body };
  const torso = changed(spec.torso, d.torso);
  if (Object.keys(torso).length) opts.torso = torso;
  const face = changed(spec.face, d.face);
  if (Object.keys(face).length) opts.face = face;
  if (spec.expression !== 'neutral') opts.expression = spec.expression;
  if (POSES[spec.pose] !== undefined) opts.pose = POSES[spec.pose];

  const hair: Record<string, unknown> = { style: spec.hair.style, color: spec.colors.hair };
  if (spec.hair.fringe !== 'none') hair.fringe = spec.hair.fringe;
  if (spec.hair.beard !== 'none') hair.beard = spec.hair.beard;
  if (spec.hair.length !== 1) hair.length = spec.hair.length;
  if (spec.hair.volume !== 1) hair.volume = spec.hair.volume;
  opts.hair = hair;

  // Innermost first: socks, then legs, then the top (a skirt over a top reads
  // as a dress), then shoes and the small items, then armor over everything.
  const w = spec.wear;
  const wear: unknown[] = [];
  if (w.socks) wear.push({ item: 'socks', color: '#f2f2f2' });
  if (w.bottom !== 'none' && w.bottom !== 'skirt') wear.push({ item: w.bottom, color: spec.colors.bottom });
  if (w.top !== 'none') {
    const top: Record<string, unknown> = { item: w.top, color: spec.colors.top };
    if (w.sleeve !== 'short') top.sleeve = w.sleeve;
    if (w.neckline !== 'crew') top.neckline = w.neckline;
    wear.push(top);
  }
  if (w.bottom === 'skirt') wear.push({ item: 'skirt', color: spec.colors.bottom, length: w.skirtLength });
  if (w.shoes !== 'none') wear.push({ item: w.shoes, color: spec.colors.shoes });
  if (w.belt) wear.push({ item: 'belt', color: '#3b2a1e' });
  if (w.gloves) wear.push({ item: 'gloves', color: spec.colors.accent });
  if (w.scarf) wear.push({ item: 'scarf', color: spec.colors.accent });
  for (const a of HUMAN_ARMOR) if (spec.armor.includes(a)) wear.push({ item: a, color: spec.colors.armor });
  if (wear.length) opts.wear = wear;

  const hold: Record<string, string> = {};
  for (const side of ['L', 'R'] as const) if (spec.hold[side] !== 'none') hold[side] = spec.hold[side];
  if (Object.keys(hold).length) opts.hold = hold;

  const acc: unknown[] = [];
  if (spec.hat !== 'none') acc.push({ item: spec.hat, color: spec.hat === 'crown' || spec.hat === 'tiara' ? '#d4a017' : spec.colors.accent });
  if (spec.eyewear !== 'none') acc.push(spec.eyewear);
  if (spec.necklace) acc.push('necklace');
  if (spec.backpack) acc.push('backpack');
  if (spec.cape) acc.push({ item: 'cape', color: spec.colors.accent });
  if (acc.length) opts.accessories = acc;

  opts.colors = { skin: spec.colors.skin, iris: spec.colors.iris, lips: spec.colors.lips };
  if (spec.base) opts.base = true;
  return opts;
}

/** A JS literal for `v`: bare keys where valid, single-quoted strings,
 *  objects on one line when short. */
function lit(v: unknown, indent = ''): string {
  if (v === null || typeof v !== 'object') return typeof v === 'string' ? `'${v.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'` : String(v);
  const inner = indent + '  ';
  const parts = Array.isArray(v)
    ? v.map(x => lit(x, inner))
    : Object.entries(v as Record<string, unknown>).map(([k, x]) => `${/^[A-Za-z_$][\w$]*$/.test(k) ? k : `'${k}'`}: ${lit(x, inner)}`);
  const [open, close] = Array.isArray(v) ? ['[', ']'] : ['{ ', ' }'];
  const flat = Array.isArray(v) ? `[${parts.join(', ')}]` : `${open}${parts.join(', ')}${close}`;
  if (flat.length + indent.length <= 100) return flat;
  return `${Array.isArray(v) ? '[' : '{'}\n${parts.map(p => `${inner}${p},`).join('\n')}\n${indent}${Array.isArray(v) ? ']' : '}'}`;
}

export const HUMAN_SPEC_VERSION = 1;
const HEADER_RE = /^\s*\/\/\s*@human-character\s+v(\d+)\s+(\{.*\})\s*$/m;

export function encodeHumanSpecComment(spec: HumanCharacterSpec): string {
  // `<` as < and line separators escaped, so the one-line JSON can't
  // close a comment or break the header across lines.
  const json = JSON.stringify(spec).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  return `// @human-character v${HUMAN_SPEC_VERSION} ${json}`;
}

/** The spec in a code's `// @human-character` header, or null — also when
 *  the header is from an unknown version or (hand-edited) fails validation, so
 *  a broken header reads as "not a character" instead of breaking the panel. */
export function decodeHumanSpecComment(code: string): HumanCharacterSpec | null {
  const m = HEADER_RE.exec(code);
  if (!m || Number(m[1]) !== HUMAN_SPEC_VERSION) return null;
  try {
    const raw: unknown = JSON.parse(m[2]);
    return validateHumanSpec(raw).length === 0 ? normalizeHumanSpec(raw) : null;
  } catch {
    return null;
  }
}

/** Self-contained model code for a spec. */
export function humanSpecToCode(spec: HumanCharacterSpec): string {
  return [
    encodeHumanSpecComment(spec),
    '// Made with the Character Creator (Realistic). Re-open the panel to edit it,',
    '// or edit the api.human options below by hand (see /ai/human.md).',
    `return api.human(${lit(humanSpecToOptions(spec))});`,
    '',
  ].join('\n');
}

// --- Presets ----------------------------------------------------------------

export interface HumanPreset {
  id: string;
  label: string;
  description: string;
  patch: () => HumanCharacterSpec;
}

function preset(id: string, label: string, description: string, edit: (s: HumanCharacterSpec) => void): HumanPreset {
  return { id, label, description, patch: () => { const s = cloneHumanSpec(DEFAULT_HUMAN_SPEC); edit(s); return s; } };
}

export const HUMAN_PRESETS: HumanPreset[] = [
  preset('h-woman', 'Woman', 'Adult woman in a top and jeans', s => {
    s.body = { ...s.body, gender: 0.05, breast: 0.45, weight: 0.45 };
    s.hair = { ...s.hair, style: 'long', fringe: 'side' };
    s.wear = { ...s.wear, top: 'top', neckline: 'scoop' };
    s.colors = { ...s.colors, hair: '#6b3a1e', top: '#b54a5f' };
  }),
  preset('h-man', 'Man', 'Adult man in a shirt and trousers', s => {
    s.body = { ...s.body, gender: 0.95, muscle: 0.6 };
    s.hair = { ...s.hair, style: 'short', beard: 'stubble' };
    s.wear = { ...s.wear, top: 'shirt', bottom: 'pants', shoes: 'shoes', belt: true };
    s.colors = { ...s.colors, top: '#e8e4da', bottom: '#2c3144', shoes: '#2a2420' };
  }),
  preset('h-child', 'Child', 'A child of about eight', s => {
    s.height = 40;
    s.body = { ...s.body, age: 8, gender: 0.6 };
    s.hair = { ...s.hair, style: 'short', fringe: 'bangs' };
    s.wear = { ...s.wear, bottom: 'shorts', socks: true };
    s.expression = 'grin';
    s.colors = { ...s.colors, top: '#e0a020', bottom: '#556070' };
  }),
  preset('h-elder', 'Elder', 'An older man with a full beard', s => {
    s.body = { ...s.body, age: 75, gender: 0.9, weight: 0.6 };
    s.torso = { ...s.torso, belly: 0.4 };
    s.hair = { ...s.hair, style: 'buzz', beard: 'full' };
    s.wear = { ...s.wear, top: 'sweater', sleeve: 'long', bottom: 'pants', shoes: 'shoes' };
    s.colors = { ...s.colors, hair: '#c8c8c4', top: '#8a3b3b', bottom: '#4a4a4a', shoes: '#2a2420' };
  }),
  preset('h-knight', 'Knight', 'Armored knight with sword and shield', s => {
    s.body = { ...s.body, gender: 0.9, muscle: 0.7 };
    s.expression = 'neutral';
    s.hair = { ...s.hair, style: 'short' };
    s.wear = { ...s.wear, top: 'sweater', sleeve: 'long', bottom: 'pants', shoes: 'boots' };
    s.armor = ['cuirass', 'pauldrons', 'vambraces', 'gauntlets', 'greaves', 'helmet'];
    s.hold = { L: 'shield', R: 'sword' };
    s.colors = { ...s.colors, top: '#5a2a2a', bottom: '#3a3a3a', shoes: '#4a3424' };
  }),
  preset('h-wizard', 'Wizard', 'Robed wizard with a staff', s => {
    s.body = { ...s.body, age: 65, gender: 0.85 };
    s.hair = { ...s.hair, style: 'long', beard: 'full' };
    s.wear = { ...s.wear, top: 'coat', sleeve: 'long', bottom: 'pants', shoes: 'boots' };
    s.hat = 'wizardhat';
    s.hold = { L: 'none', R: 'staff' };
    s.colors = { ...s.colors, hair: '#d8d8d4', top: '#3b3f8f', accent: '#3b3f8f', bottom: '#2a2a3a', shoes: '#3a2a20' };
  }),
  preset('h-anime', 'Anime hero', 'Anime proportions, spiky hair', s => {
    s.style = 'anime';
    s.body = { ...s.body, age: 17, gender: 0.75 };
    s.hair = { ...s.hair, style: 'spiky' };
    s.wear = { ...s.wear, top: 'jacket', sleeve: 'long', bottom: 'pants' };
    s.colors = { ...s.colors, hair: '#e0b030', iris: '#3b6ea5', top: '#d06020', bottom: '#2a2a3a' };
  }),
  preset('h-chibi', 'Chibi', 'Big head, small body', s => {
    s.style = 'chibi';
    s.height = 45;
    s.body = { ...s.body, gender: 0.1, breast: 0.2 };
    s.hair = { ...s.hair, style: 'pigtails', fringe: 'bangs' };
    s.wear = { ...s.wear, top: 'tshirt', bottom: 'skirt', skirtLength: 'knee', shoes: 'shoes' };
    s.colors = { ...s.colors, hair: '#2a1d14', top: '#f0c0d0', bottom: '#6a3d7a', shoes: '#2a2420' };
  }),
  preset('h-toy', 'Vinyl toy', 'A Funko-style vinyl figure', s => {
    s.style = 'funko';
    s.height = 50;
    s.expression = 'neutral';
    s.hair = { ...s.hair, style: 'bob' };
    s.colors = { ...s.colors, hair: '#1c1c1c', top: '#c03030', bottom: '#2c3144' };
  }),
];

// --- Random -----------------------------------------------------------------

/** A random but coherent Realistic character from `rand` (0–1). */
export function randomHumanSpec(rand: () => number): HumanCharacterSpec {
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length) % xs.length];
  const between = (lo: number, hi: number) => Math.round((lo + rand() * (hi - lo)) * 100) / 100;
  const s = cloneHumanSpec(DEFAULT_HUMAN_SPEC);
  s.style = rand() < 0.6 ? 'realistic' : pick(['anime', 'chibi', 'funko', 'heroic'] as const);
  const female = rand() < 0.5;
  const age = rand() < 0.15 ? Math.round(between(6, 14)) : rand() < 0.15 ? Math.round(between(60, 85)) : Math.round(between(18, 50));
  s.body = {
    gender: female ? between(0, 0.2) : between(0.8, 1), age,
    muscle: between(0.3, 0.8), weight: between(0.3, 0.7), stature: between(0.3, 0.7),
    breast: female && age >= 16 ? between(0.2, 0.6) : 0,
  };
  s.height = age < 15 ? 40 : 60;
  s.expression = pick(['neutral', 'smile', 'grin', 'smile', 'surprised'] as const);
  s.pose = pick(['relaxed', 'relaxed', 'wave', 'cheer', 'walking'] as const);
  s.hair = {
    style: female ? pick(['long', 'bob', 'ponytail', 'bun', 'pigtails', 'afro'] as const) : pick(['short', 'buzz', 'spiky', 'afro', 'mohawk', 'bald'] as const),
    fringe: pick(HAIR_FRINGES), beard: !female && age >= 18 ? pick(['none', 'none', 'stubble', 'short', 'full', 'goatee'] as const) : 'none',
    length: 1, volume: 1,
  };
  const top = pick(['tshirt', 'shirt', 'top', 'sweater', 'jacket'] as const);
  s.wear = {
    ...s.wear, top,
    sleeve: top === 'tshirt' ? 'short' : top === 'top' ? pick(['none', 'short'] as const) : 'long',
    bottom: female ? pick(['jeans', 'skirt', 'pants', 'shorts'] as const) : pick(['jeans', 'pants', 'shorts'] as const),
    shoes: pick(['sneakers', 'shoes', 'boots'] as const),
  };
  const SKIN = ['#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#5c3a21', '#ffdbac'];
  const HAIR = ['#2a1d14', '#3b2a1e', '#6b3a1e', '#a0522d', '#d8b060', '#1c1c1c', '#c8c8c4'];
  const CLOTH = ['#2f6f8f', '#b54a5f', '#3a4a3a', '#8a3b3b', '#e0a020', '#6a3d7a', '#e8e4da', '#2c3144', '#3b5675'];
  s.colors = {
    ...s.colors,
    skin: pick(SKIN), hair: age >= 60 ? '#c8c8c4' : pick(HAIR), iris: pick(['#5b3a21', '#3b6ea5', '#4a7a3a', '#6b6b6b']),
    top: pick(CLOTH), bottom: pick(CLOTH), shoes: pick(['#f2f2f2', '#2a2420', '#4a3424']),
  };
  return s;
}

// --- Switching families -----------------------------------------------------

const AVATAR_TO_HUMAN_HAIR: Partial<Record<string, HairStyle>> = {
  bald: 'bald', short: 'short', long: 'long', bob: 'bob', bun: 'bun', bangs: 'short', ponytail: 'ponytail',
  afro: 'afro', braids: 'pigtails', spiked: 'spiky', locs: 'long', cornrows: 'buzz', boxBraids: 'long',
  mop: 'short', anime: 'spiky', shag: 'spiky', captured: 'short',
};
const HUMAN_TO_AVATAR_HAIR: Record<HairStyle, string> = {
  bald: 'bald', buzz: 'short', short: 'short', bob: 'bob', long: 'long', ponytail: 'ponytail',
  pigtails: 'braids', bun: 'bun', afro: 'afro', mohawk: 'spiked', spiky: 'spiked',
};
const AVATAR_TO_HUMAN_EXPRESSION: Record<string, string> = {
  bigSmile: 'grin', smile: 'smile', slightSmile: 'smile', neutral: 'neutral', slightFrown: 'sad', frown: 'frown', deepFrown: 'angry',
};
const HUMAN_TO_AVATAR_EXPRESSION: Record<string, string> = {
  grin: 'bigSmile', laugh: 'bigSmile', smile: 'smile', wink: 'smile', neutral: 'neutral', sleepy: 'neutral', kiss: 'neutral',
  surprised: 'neutral', sad: 'slightFrown', frown: 'frown', angry: 'deepFrown',
};

// Each shared setting maps both ways. A field keeps the target's current
// value whenever that value already maps to the source's, so switching
// families and back leaves both characters as they were (a "slight smile"
// isn't rounded to "smile", anime hair isn't swapped for spikes).

/** `cur` if it already maps (through `back`) to `src`, else `fwd(src)`. */
function pick<T, S>(cur: T, back: (t: T) => S, src: S, fwd: (s: S) => T): T {
  return back(cur) === src ? cur : fwd(src);
}
const id = <T>(x: T): T => x;
const clamp = (lo: number, hi: number) => (x: number): number => Math.min(hi, Math.max(lo, x));
/** '#abc' → '#aabbcc' (the Avatar spec accepts the short form; Realistic doesn't). */
function hex6(c: string): string {
  return /^#[0-9a-fA-F]{3}$/.test(c) ? `#${c[1]}${c[1]}${c[2]}${c[2]}${c[3]}${c[3]}` : c;
}

type Sex = CharacterSpec['body']['sex'];
const genderToSex = (g: number): Sex => (g >= 0.7 ? 'male' : g <= 0.3 ? 'female' : 'neutral');
const sexToGender = (x: Sex): number => (x === 'male' ? 0.95 : x === 'female' ? 0.05 : 0.5);
const styleToProportions = (st: StylePreset): CharacterSpec['body']['proportions'] => (st === 'anime' || st === 'heroic' ? 'realistic' : st);
const muscleToAvatar = (m: number): number => Math.max(0, (m - 0.5) * 2);
const muscleToHuman = (m: number): number => Math.min(1, 0.5 + m / 2);
type HumanSleeve = HumanCharacterSpec['wear']['sleeve'];
type AvatarSleeve = CharacterSpec['clothing']['top']['sleeve'];
const sleeveToAvatar = (sl: HumanSleeve): AvatarSleeve => (sl === 'none' || sl === 'short' || sl === 'long' ? sl : sl === 'cap' ? 'short' : 'long');

/** What each family's legs and feet read as, in shared terms. */
type Legs = 'none' | 'skirt' | 'shorts' | 'briefs' | 'long';
const humanLegs = (b: HumanCharacterSpec['wear']['bottom']): Legs =>
  b === 'none' || b === 'skirt' || b === 'shorts' || b === 'briefs' ? b : 'long';
function avatarLegs(a: CharacterSpec): Legs {
  const c = a.clothing;
  if (c.top.on && c.top.length === 'dress') return 'skirt';
  if (!c.pants.on) return 'none';
  return c.pants.length === 'full' ? 'long' : c.pants.length;
}
type Feet = 'none' | 'boots' | 'shoes';
const humanFeet = (sh: HumanCharacterSpec['wear']['shoes']): Feet => (sh === 'none' || sh === 'boots' ? sh : 'shoes');
const avatarFeet = (a: CharacterSpec): Feet => (!a.clothing.feet.on ? 'none' : a.clothing.feet.kind === 'boots' ? 'boots' : 'shoes');
const humanTopOn = (h: HumanCharacterSpec): boolean => h.wear.top !== 'none' || h.wear.bottom === 'skirt';

/** The Realistic character for an Avatar one: `start` with the settings both
 *  families share (height, body, style, expression, hair style, clothes,
 *  colours) brought in line with `a`. */
export function humanSpecFromAvatar(a: CharacterSpec, start: HumanCharacterSpec = DEFAULT_HUMAN_SPEC): HumanCharacterSpec {
  const s = cloneHumanSpec(start);
  const b = a.body;
  s.height = pick(s.height, id, b.height, clamp(5, 2000));
  s.style = pick(s.style, styleToProportions, b.proportions, id);
  s.body.gender = pick(s.body.gender, genderToSex, b.sex, sexToGender);
  s.body.age = pick(s.body.age, Math.round, b.age, clamp(1, 90));
  s.body.weight = pick(s.body.weight, id, b.weight, clamp(0, 1));
  s.body.muscle = pick(s.body.muscle, muscleToAvatar, b.muscle, muscleToHuman);
  s.body.breast = pick(s.body.breast, id, b.bust, clamp(0, 1));
  s.torso.belly = pick(s.torso.belly, x => Math.max(0, x), b.belly, clamp(0, 1));
  s.expression = pick(s.expression, x => HUMAN_TO_AVATAR_EXPRESSION[x], a.face.expression, x => AVATAR_TO_HUMAN_EXPRESSION[x] ?? s.expression);
  s.hair.style = pick(s.hair.style, x => HUMAN_TO_AVATAR_HAIR[x], a.hair.style, x => AVATAR_TO_HUMAN_HAIR[x] ?? s.hair.style);
  const c = a.clothing;
  const w = s.wear;
  w.bottom = pick(w.bottom, humanLegs, avatarLegs(a), legs => (legs === 'long' ? (w.bottom === 'none' || humanLegs(w.bottom) !== 'long' ? 'pants' : w.bottom) : legs));
  if (humanTopOn(s) !== c.top.on) w.top = c.top.on ? 'tshirt' : 'none';
  w.sleeve = pick(w.sleeve, sleeveToAvatar, c.top.sleeve, id);
  w.shoes = pick(w.shoes, humanFeet, avatarFeet(a), id);
  w.socks = c.socks.on;
  const k = s.colors;
  k.skin = pick(k.skin, id, a.colors.skin, hex6);
  k.iris = pick(k.iris, id, a.colors.iris, hex6);
  k.lips = pick(k.lips, id, a.colors.lips, hex6);
  k.hair = pick(k.hair, id, a.colors.hair, hex6);
  k.top = pick(k.top, id, a.colors.top, hex6);
  k.bottom = pick(k.bottom, id, a.colors.pants, hex6);
  k.shoes = pick(k.shoes, id, a.colors.feet, hex6);
  s.base = a.base;
  return s;
}

/** The Avatar character for a Realistic one: `start` with the shared settings
 *  brought in line with `h` (everything the Realistic spec has no say in, like
 *  bead eyes or a held ball, is kept). */
export function applyHumanToAvatar(h: HumanCharacterSpec, start: CharacterSpec): CharacterSpec {
  const a = JSON.parse(JSON.stringify(start)) as CharacterSpec;
  const b = a.body;
  b.height = pick(b.height, clamp(5, 2000), h.height, id);
  b.proportions = pick(b.proportions, id, styleToProportions(h.style), id);
  b.sex = pick(b.sex, sexToGender, h.body.gender, genderToSex);
  b.age = pick(b.age, clamp(1, 90), h.body.age, Math.round);
  b.weight = pick(b.weight, clamp(0, 1), h.body.weight, id);
  b.muscle = pick(b.muscle, muscleToHuman, h.body.muscle, muscleToAvatar);
  b.bust = pick(b.bust, clamp(0, 1), h.body.breast, id);
  b.belly = pick(b.belly, clamp(0, 1), h.torso.belly, x => Math.max(0, x));
  a.face.expression = pick(a.face.expression, x => AVATAR_TO_HUMAN_EXPRESSION[x], h.expression,
    x => (HUMAN_TO_AVATAR_EXPRESSION[x] ?? a.face.expression) as CharacterSpec['face']['expression']);
  a.hair.style = pick(a.hair.style, x => AVATAR_TO_HUMAN_HAIR[x], h.hair.style, x => HUMAN_TO_AVATAR_HAIR[x as HairStyle] as CharacterSpec['hair']['style']);
  const c = a.clothing;
  const legs = humanLegs(h.wear.bottom);
  if (avatarLegs(a) !== legs) {
    c.top.length = legs === 'skirt' ? 'dress' : 'shirt';
    c.pants.on = legs !== 'none' && legs !== 'skirt';
    if (c.pants.on) c.pants.length = legs === 'long' ? 'full' : legs as 'shorts' | 'briefs';
  }
  c.top.on = pick(c.top.on, id, humanTopOn(h), id);
  c.top.sleeve = pick(c.top.sleeve, id, sleeveToAvatar(h.wear.sleeve), id);
  const feet = humanFeet(h.wear.shoes);
  if (avatarFeet(a) !== feet) {
    c.feet.on = feet !== 'none';
    if (c.feet.on) c.feet.kind = feet === 'boots' ? 'boots' : 'shoes';
  }
  c.socks.on = h.wear.socks;
  const k = a.colors;
  k.skin = pick(k.skin, hex6, h.colors.skin, id);
  k.iris = pick(k.iris, hex6, h.colors.iris, id);
  k.lips = pick(k.lips, hex6, h.colors.lips, id);
  k.hair = pick(k.hair, hex6, h.colors.hair, id);
  k.top = pick(k.top, hex6, h.colors.top, id);
  k.pants = pick(k.pants, hex6, h.colors.bottom, id);
  k.feet = pick(k.feet, hex6, h.colors.shoes, id);
  a.base = h.base;
  return a;
}
