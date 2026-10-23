// The Character Creator's data model: a plain, serialisable description of a
// figure (body proportions, pose, face, hair, clothing, colours). The panel
// edits a `CharacterSpec`; `characterCodegen.ts` turns one into self-contained
// `api.sdf.figure` model code. The spec is also embedded verbatim as a
// `// @character v1 {json}` header comment in the generated code, so re-opening
// the panel restores every control exactly (and the code stays hand-editable).
//
// Every enum here is a real, validated option of the figure API
// (`src/geometry/sdfFigure.ts`) — keep them in sync with the assertEnum lists
// there. Pure data + helpers, no DOM/engine, so it unit-tests in the vitest tier.

export const SPEC_VERSION = 1;

export type Build = 'slim' | 'average' | 'stocky';
export type Sex = 'neutral' | 'male' | 'female';
export type FaceShape = 'oval' | 'round' | 'square' | 'long' | 'heart' | 'diamond';
export type LidStyle = 'none' | 'upper' | 'hooded' | 'half' | 'closed' | 'almond' | 'tapered';
export type Gaze = 'middle' | 'center' | 'left' | 'right' | 'up' | 'down';
export type NoseType = 'straight' | 'button' | 'snub' | 'roman' | 'aquiline' | 'broad' | 'pointed' | 'bulbous';
export type Expression = 'bigSmile' | 'smile' | 'slightSmile' | 'neutral' | 'slightFrown' | 'frown' | 'deepFrown';
export type LipShape = 'natural' | 'full' | 'thin' | 'wide' | 'rosebud' | 'flat';
export type EarType = 'round' | 'pointed' | 'detailed';
export type BrowShape = 'natural' | 'thin' | 'bushy' | 'arched' | 'flat' | 'angled' | 'rounded' | 'straight';
export type HairStyle =
  | 'bald' | 'short' | 'long' | 'bob' | 'bun' | 'bangs' | 'ponytail'
  | 'afro' | 'braids' | 'spiked' | 'locs' | 'cornrows' | 'boxBraids';
export type HairLength = 'short' | 'mid' | 'long';
export type Sleeve = 'none' | 'short' | 'long';
export type TopLength = 'shirt' | 'dress';
export type PantsLeg = 'slim' | 'cargo';
export type PantsRise = 'low' | 'mid' | 'high';
export type PantsLength = 'full' | 'briefs';
export type FootwearKind = 'shoes' | 'boots';

/** A single FK joint. All angles in degrees; 0 is neutral. */
export interface Joint {
  raiseSide: number;
  raiseFwd: number;
  bend: number;
  twist: number;
}

export interface HeadPose { yaw: number; pitch: number; roll: number }
export interface SpinePose { lean: number; turn: number; side: number }

export interface PoseSpec {
  /** UI-only label of the last applied preset (codegen ignores it; the joint
   *  values below are the source of truth). */
  preset: string;
  armL: Joint;
  armR: Joint;
  legL: Joint;
  legR: Joint;
  spine: SpinePose;
  head: HeadPose;
}

export interface BodySpec {
  height: number;
  headsTall: number;
  build: Build;
  sex: Sex;
  age: number;
  weight: number;
  muscle: number;
  bust: number;
  belly: number;
}

export interface FaceSpec {
  shape: FaceShape;
  lids: LidStyle;
  gaze: Gaze;
  nose: NoseType;
  expression: Expression;
  lipShape: LipShape;
  ears: EarType;
  brows: BrowShape;
}

export interface HairSpec {
  style: HairStyle;
  length: HairLength;
  volume: number;
}

export interface ClothingSpec {
  top: { on: boolean; sleeve: Sleeve; length: TopLength };
  pants: { on: boolean; leg: PantsLeg; rise: PantsRise; length: PantsLength };
  feet: { on: boolean; kind: FootwearKind };
}

export interface ColorsSpec {
  skin: string;
  eyes: string;
  iris: string;
  pupil: string;
  lips: string;
  brows: string;
  hair: string;
  top: string;
  pants: string;
  feet: string;
  base: string;
}

export interface CharacterSpec {
  body: BodySpec;
  pose: PoseSpec;
  face: FaceSpec;
  hair: HairSpec;
  clothing: ClothingSpec;
  colors: ColorsSpec;
  /** Include a circular stand under the figure. */
  base: boolean;
}

const NEUTRAL_JOINT: Joint = { raiseSide: 0, raiseFwd: 0, bend: 0, twist: 0 };
const j = (p: Partial<Joint> = {}): Joint => ({ ...NEUTRAL_JOINT, ...p });

/** A relaxed standing pose: arms a touch off the body, a slight stance. */
function standingPose(): PoseSpec {
  return {
    preset: 'standing',
    armL: j({ raiseSide: 8, bend: 6 }),
    armR: j({ raiseSide: 8, bend: 6 }),
    legL: j({ raiseSide: 6 }),
    legR: j({ raiseSide: 6 }),
    spine: { lean: 0, turn: 0, side: 0 },
    head: { yaw: 0, pitch: 0, roll: 0 },
  };
}

export const DEFAULT_SPEC: CharacterSpec = {
  body: { height: 60, headsTall: 7, build: 'average', sex: 'neutral', age: 25, weight: 0.5, muscle: 0, bust: 0, belly: 0 },
  pose: standingPose(),
  face: { shape: 'oval', lids: 'almond', gaze: 'center', nose: 'straight', expression: 'slightSmile', lipShape: 'natural', ears: 'detailed', brows: 'natural' },
  hair: { style: 'short', length: 'mid', volume: 1 },
  clothing: {
    top: { on: true, sleeve: 'short', length: 'shirt' },
    pants: { on: true, leg: 'slim', rise: 'mid', length: 'full' },
    feet: { on: true, kind: 'shoes' },
  },
  colors: {
    skin: '#c68642', eyes: '#f7f6f2', iris: '#5b3a21', pupil: '#161616', lips: '#a85b4b',
    brows: '#2a1d14', hair: '#2a1d14', top: '#2f6f8f', pants: '#2c3144', feet: '#202024', base: '#4a4a4a',
  },
  base: true,
};

/** Named pose presets. Each returns a fresh PoseSpec the panel drops into the
 *  spec when the user picks it (after which the joint sliders can be tweaked). */
export const POSE_PRESETS: Record<string, () => PoseSpec> = {
  standing: standingPose,
  tpose: () => ({
    preset: 'tpose',
    armL: j({ raiseSide: 90 }), armR: j({ raiseSide: 90 }),
    legL: j({ raiseSide: 6 }), legR: j({ raiseSide: 6 }),
    spine: { lean: 0, turn: 0, side: 0 }, head: { yaw: 0, pitch: 0, roll: 0 },
  }),
  armsUp: () => ({
    preset: 'armsUp',
    armL: j({ raiseSide: 150, bend: 18 }), armR: j({ raiseSide: 150, bend: 18 }),
    legL: j({ raiseSide: 7 }), legR: j({ raiseSide: 7 }),
    spine: { lean: 0, turn: 0, side: 0 }, head: { yaw: 0, pitch: -6, roll: 0 },
  }),
  contrapposto: () => ({
    preset: 'contrapposto',
    armL: j({ raiseSide: 9, bend: 12 }), armR: j({ raiseSide: 11, bend: 8 }),
    legL: j({ raiseSide: 5 }), legR: j({ raiseSide: 9, bend: 14 }),
    spine: { lean: 0, turn: 4, side: 6 }, head: { yaw: -10, pitch: 0, roll: -3 },
  }),
  walking: () => ({
    preset: 'walking',
    armL: j({ raiseFwd: 24, bend: 18 }), armR: j({ raiseFwd: -22, bend: 14 }),
    legL: j({ raiseFwd: 22, bend: 16 }), legR: j({ raiseFwd: -18, bend: 6 }),
    spine: { lean: 4, turn: 0, side: 0 }, head: { yaw: 0, pitch: 0, roll: 0 },
  }),
  waving: () => ({
    preset: 'waving',
    armL: j({ raiseSide: 8, bend: 8 }), armR: j({ raiseSide: 148, bend: 42 }),
    legL: j({ raiseSide: 6 }), legR: j({ raiseSide: 6 }),
    spine: { lean: 0, turn: 0, side: 0 }, head: { yaw: 8, pitch: -4, roll: 4 },
  }),
};

export const POSE_PRESET_LABELS: Record<string, string> = {
  standing: 'Standing', tpose: 'T-pose', armsUp: 'Arms up',
  contrapposto: 'Contrapposto', walking: 'Walking', waving: 'Waving',
};

/** A library of complete starting characters, surfaced as a scrollable
 *  pick-list in the panel — the fastest path for a non-coder. Each is a
 *  deep-merge patch over DEFAULT_SPEC so it stays terse and forward-compatible
 *  with new fields. Keep labels distinct (no label a substring of another) so
 *  the panel's buttons stay unambiguous by accessible name. */
export interface CharacterPreset { id: string; label: string; description: string; patch: () => CharacterSpec }

function withSpec(patch: (s: CharacterSpec) => void): () => CharacterSpec {
  return () => { const s = cloneSpec(DEFAULT_SPEC); patch(s); return s; };
}

export const CHARACTER_PRESETS: CharacterPreset[] = [
  { id: 'adultF', label: 'Adult woman', description: 'Long hair, short-sleeve dress', patch: withSpec(s => {
    s.body = { ...s.body, height: 64, headsTall: 7.5, sex: 'female', bust: 0.5 };
    s.face = { ...s.face, shape: 'oval', lipShape: 'full', lids: 'almond', expression: 'slightSmile' };
    s.hair = { style: 'long', length: 'long', volume: 1.1 };
    s.clothing.top = { on: true, sleeve: 'short', length: 'dress' };
    s.clothing.pants = { on: false, leg: 'slim', rise: 'mid', length: 'full' };
    s.colors = { ...s.colors, top: '#a8466a', hair: '#3a2417' };
  }) },
  { id: 'adultM', label: 'Adult man', description: 'Short hair, tee and slim pants', patch: withSpec(s => {
    s.body = { ...s.body, height: 66, headsTall: 7.5, sex: 'male', build: 'average', muscle: 0.35 };
    s.face = { ...s.face, shape: 'square', nose: 'straight', brows: 'flat', expression: 'neutral' };
    s.hair = { style: 'short', length: 'short', volume: 0.8 };
    s.colors = { ...s.colors, top: '#356a4a', pants: '#33374a' };
  }) },
  { id: 'child', label: 'Child', description: 'Seven years old, big grin', patch: withSpec(s => {
    s.body = { ...s.body, height: 38, headsTall: 5, age: 7, build: 'slim' };
    s.face = { ...s.face, shape: 'round', nose: 'button', expression: 'smile', lids: 'none' };
    s.hair = { style: 'short', length: 'short', volume: 1 };
    s.colors = { ...s.colors, top: '#e0a93b', pants: '#3b6ea0' };
  }) },
  { id: 'chibi', label: 'Chibi', description: 'Big head, tiny body, bob cut', patch: withSpec(s => {
    s.body = { ...s.body, height: 36, headsTall: 3.2, build: 'average' };
    s.face = { ...s.face, shape: 'round', nose: 'button', expression: 'bigSmile', lids: 'none' };
    s.hair = { style: 'bob', length: 'mid', volume: 1.2 };
    s.colors = { ...s.colors, top: '#d65a7a' };
  }) },
  { id: 'athlete', label: 'Athlete', description: 'Toned, ponytail, running kit', patch: withSpec(s => {
    s.body = { ...s.body, height: 66, headsTall: 7.5, build: 'average', muscle: 0.6 };
    s.pose = POSE_PRESETS.contrapposto();
    s.face = { ...s.face, expression: 'slightSmile' };
    s.hair = { style: 'ponytail', length: 'long', volume: 0.9 };
    s.clothing.top = { on: true, sleeve: 'none', length: 'shirt' };
    s.clothing.pants = { on: true, leg: 'slim', rise: 'mid', length: 'briefs' };
    s.colors = { ...s.colors, top: '#c43d3d', pants: '#1f2330' };
  }) },
  { id: 'dancer', label: 'Dancer', description: 'Slim, arms raised, hair in a bun', patch: withSpec(s => {
    s.body = { ...s.body, height: 70, headsTall: 8, build: 'slim', sex: 'female', bust: 0.35 };
    s.pose = POSE_PRESETS.armsUp();
    s.face = { ...s.face, lipShape: 'full', expression: 'slightSmile' };
    s.hair = { style: 'bun', length: 'mid', volume: 1 };
    s.clothing.top = { on: true, sleeve: 'none', length: 'shirt' };
    s.clothing.pants = { on: true, leg: 'slim', rise: 'high', length: 'briefs' };
    s.colors = { ...s.colors, top: '#c45c93', pants: '#c45c93' };
  }) },
  { id: 'toddler', label: 'Toddler', description: 'Three years old, waving hello', patch: withSpec(s => {
    s.body = { ...s.body, height: 30, headsTall: 4, age: 3, build: 'average', weight: 0.6 };
    s.pose = POSE_PRESETS.waving();
    s.face = { ...s.face, shape: 'round', nose: 'button', expression: 'bigSmile', lids: 'none', brows: 'rounded' };
    s.hair = { style: 'short', length: 'short', volume: 1.1 };
    s.clothing.pants = { on: true, leg: 'slim', rise: 'high', length: 'full' };
    s.colors = { ...s.colors, skin: '#f1c9a8', hair: '#c9923f', brows: '#a8782f', iris: '#3d6e9e', top: '#f3c94b', pants: '#4f8fcf' };
  }) },
  { id: 'teen', label: 'Teenager', description: 'Lanky, bangs, hoodie-blue top', patch: withSpec(s => {
    s.body = { ...s.body, height: 58, headsTall: 6.75, age: 15, build: 'slim' };
    s.pose = POSE_PRESETS.contrapposto();
    s.face = { ...s.face, shape: 'oval', expression: 'neutral', gaze: 'left' };
    s.hair = { style: 'bangs', length: 'mid', volume: 1 };
    s.clothing.top = { on: true, sleeve: 'long', length: 'shirt' };
    s.colors = { ...s.colors, skin: '#dba37a', hair: '#1c1410', top: '#3d5fa8', pants: '#26262c', feet: '#e9e9e9' };
  }) },
  { id: 'grandpa', label: 'Grandpa', description: 'Bald, bushy brows, cardigan', patch: withSpec(s => {
    s.body = { ...s.body, height: 62, headsTall: 7, age: 76, build: 'average', weight: 0.6, belly: 0.6, sex: 'male' };
    s.face = { ...s.face, shape: 'long', nose: 'bulbous', brows: 'bushy', lids: 'upper', expression: 'slightSmile', ears: 'round' };
    s.hair = { style: 'bald', length: 'short', volume: 1 };
    s.clothing.top = { on: true, sleeve: 'long', length: 'shirt' };
    s.clothing.pants = { on: true, leg: 'slim', rise: 'high', length: 'full' };
    s.colors = { ...s.colors, skin: '#e8b48c', brows: '#d6d3cc', top: '#7a5a3c', pants: '#4b4b52', feet: '#3a2a20' };
  }) },
  { id: 'grandma', label: 'Grandma', description: 'Silver bun, long-sleeve dress', patch: withSpec(s => {
    s.body = { ...s.body, height: 58, headsTall: 6.75, age: 72, sex: 'female', bust: 0.45, weight: 0.6, belly: 0.3 };
    s.face = { ...s.face, shape: 'round', nose: 'snub', lids: 'upper', brows: 'natural', expression: 'smile' };
    s.hair = { style: 'bun', length: 'mid', volume: 1.1 };
    s.clothing.top = { on: true, sleeve: 'long', length: 'dress' };
    s.clothing.pants = { on: false, leg: 'slim', rise: 'mid', length: 'full' };
    s.colors = { ...s.colors, skin: '#cf9163', hair: '#c8c6c2', brows: '#a9a6a0', top: '#6b4f8a', feet: '#2b2b30' };
  }) },
  { id: 'bodybuilder', label: 'Bodybuilder', description: 'Stocky, maximum muscle', patch: withSpec(s => {
    s.body = { ...s.body, height: 68, headsTall: 7.5, build: 'stocky', sex: 'male', muscle: 1, weight: 0.6 };
    s.pose = POSE_PRESETS.armsUp();
    s.face = { ...s.face, shape: 'square', brows: 'angled', expression: 'bigSmile' };
    s.hair = { style: 'short', length: 'short', volume: 0.7 };
    s.clothing.top = { on: true, sleeve: 'none', length: 'shirt' };
    s.clothing.pants = { on: true, leg: 'slim', rise: 'mid', length: 'briefs' };
    s.colors = { ...s.colors, skin: '#945634', hair: '#161210', brows: '#161210', top: '#f0f0ea', pants: '#1f3d8a' };
  }) },
  { id: 'hiker', label: 'Hiker', description: 'Cargo pants and boots, mid-stride', patch: withSpec(s => {
    s.body = { ...s.body, height: 65, headsTall: 7.5, build: 'average', muscle: 0.3 };
    s.pose = POSE_PRESETS.walking();
    s.face = { ...s.face, nose: 'roman', expression: 'smile' };
    s.hair = { style: 'ponytail', length: 'mid', volume: 1 };
    s.clothing.top = { on: true, sleeve: 'long', length: 'shirt' };
    s.clothing.pants = { on: true, leg: 'cargo', rise: 'mid', length: 'full' };
    s.clothing.feet = { on: true, kind: 'boots' };
    s.colors = { ...s.colors, skin: '#bd7c4f', hair: '#5a3a22', top: '#d0672f', pants: '#6b6a4a', feet: '#5a3b26' };
  }) },
  { id: 'punk', label: 'Punk rocker', description: 'Spiked magenta hair, black boots', patch: withSpec(s => {
    s.body = { ...s.body, height: 64, headsTall: 7.5, build: 'slim' };
    s.pose = POSE_PRESETS.contrapposto();
    s.face = { ...s.face, shape: 'diamond', brows: 'angled', lids: 'tapered', expression: 'slightFrown', ears: 'pointed' };
    s.hair = { style: 'spiked', length: 'mid', volume: 1.3 };
    s.clothing.top = { on: true, sleeve: 'none', length: 'shirt' };
    s.clothing.feet = { on: true, kind: 'boots' };
    s.colors = { ...s.colors, skin: '#f5d8c6', hair: '#d6247a', brows: '#2a1d14', lips: '#5a2840', top: '#18181b', pants: '#2b2f3a', feet: '#101012' };
  }) },
  { id: 'elf', label: 'Elf ranger', description: 'Pointed ears, long hair, forest green', patch: withSpec(s => {
    s.body = { ...s.body, height: 72, headsTall: 8, build: 'slim', muscle: 0.25 };
    s.face = { ...s.face, shape: 'heart', ears: 'pointed', brows: 'arched', lids: 'almond', nose: 'pointed', expression: 'neutral' };
    s.hair = { style: 'long', length: 'long', volume: 1 };
    s.clothing.top = { on: true, sleeve: 'long', length: 'shirt' };
    s.clothing.feet = { on: true, kind: 'boots' };
    s.colors = { ...s.colors, skin: '#f1c9a8', hair: '#e8d9a8', brows: '#c4ae74', iris: '#3f7a4a', top: '#2f5a32', pants: '#4b3a26', feet: '#3b2a1a' };
  }) },
  { id: 'hero', label: 'Superhero', description: 'Heroic build, red and blue suit', patch: withSpec(s => {
    s.body = { ...s.body, height: 72, headsTall: 8, build: 'average', muscle: 0.8 };
    s.pose = POSE_PRESETS.contrapposto();
    s.face = { ...s.face, shape: 'square', brows: 'straight', expression: 'slightSmile' };
    s.hair = { style: 'short', length: 'short', volume: 0.9 };
    s.clothing.top = { on: true, sleeve: 'long', length: 'shirt' };
    s.clothing.pants = { on: true, leg: 'slim', rise: 'high', length: 'full' };
    s.clothing.feet = { on: true, kind: 'boots' };
    s.colors = { ...s.colors, skin: '#aa6b3d', hair: '#161210', top: '#2a4fb0', pants: '#2a4fb0', feet: '#c42e2e' };
  }) },
  { id: 'office', label: 'Office worker', description: 'Long sleeves, navy slacks', patch: withSpec(s => {
    s.body = { ...s.body, height: 64, headsTall: 7.5, sex: 'female', bust: 0.4, weight: 0.45 };
    s.face = { ...s.face, shape: 'oval', brows: 'arched', expression: 'slightSmile', lipShape: 'natural' };
    s.hair = { style: 'bob', length: 'mid', volume: 1 };
    s.clothing.top = { on: true, sleeve: 'long', length: 'shirt' };
    s.clothing.pants = { on: true, leg: 'slim', rise: 'high', length: 'full' };
    s.colors = { ...s.colors, skin: '#7c472b', hair: '#1a1210', top: '#e9e4dc', pants: '#1f2a44', feet: '#151518' };
  }) },
  { id: 'afro', label: 'Afro & sneakers', description: 'Big afro, relaxed stance', patch: withSpec(s => {
    s.body = { ...s.body, height: 66, headsTall: 7.5, sex: 'male', muscle: 0.3 };
    s.pose = POSE_PRESETS.contrapposto();
    s.face = { ...s.face, shape: 'oval', nose: 'broad', lipShape: 'full', expression: 'smile' };
    s.hair = { style: 'afro', length: 'mid', volume: 1.2 };
    s.colors = { ...s.colors, skin: '#4a281b', hair: '#120d0a', brows: '#120d0a', lips: '#5a3028', top: '#e2b23a', pants: '#3a4a6a', feet: '#f0f0f0' };
  }) },
  { id: 'braids', label: 'Long braids', description: 'Braided hair, waving hello', patch: withSpec(s => {
    s.body = { ...s.body, height: 64, headsTall: 7.5, sex: 'female', bust: 0.45 };
    s.pose = POSE_PRESETS.waving();
    s.face = { ...s.face, shape: 'heart', lipShape: 'full', expression: 'bigSmile', brows: 'rounded' };
    s.hair = { style: 'braids', length: 'long', volume: 1 };
    s.colors = { ...s.colors, skin: '#643622', hair: '#1a1210', brows: '#1a1210', lips: '#6a3a30', top: '#2f9b8f', pants: '#e8e1d2', feet: '#c9a24a' };
  }) },
  { id: 'mannequin', label: 'Mannequin', description: 'Bare T-posed base to build on', patch: withSpec(s => {
    s.pose = POSE_PRESETS.tpose();
    s.face = { ...s.face, expression: 'neutral' };
    s.hair = { style: 'bald', length: 'short', volume: 1 };
    s.clothing.top.on = false;
    s.clothing.pants.on = false;
    s.clothing.feet.on = false;
    s.colors = { ...s.colors, skin: '#d9d4cc', lips: '#c9b8aa', brows: '#a39a8f' };
  }) },
];

// ---- Random character ------------------------------------------------------

/** Small seeded PRNG (mulberry32) → uniform [0, 1). Deterministic per seed so a
 *  random character is reproducible (`randomSpec(seededRandom(42))`). */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Palettes the randomizer draws from. Skin matches the figure API's named
// tones (sdfFigure SKIN_TONES); hair/iris are natural ranges plus a few fun
// dyes; clothing is a curated set that reads well printed or painted.
const SKIN_PALETTE = ['#f5d8c6', '#f1c9a8', '#e8b48c', '#dba37a', '#cf9163', '#bd7c4f', '#aa6b3d', '#945634', '#7c472b', '#643622', '#4a281b', '#34201a'];
const HAIR_NATURAL = ['#120d0a', '#1c1410', '#2a1d14', '#3a2417', '#5a3a22', '#7a4a26', '#a0522d', '#c9923f', '#e8d9a8'];
const HAIR_GREY = ['#c8c6c2', '#a9a6a0', '#e6e4df', '#8a8782'];
const HAIR_DYED = ['#d6247a', '#2f7fd6', '#7a3fd6', '#2fae6a', '#e25a2a'];
const IRIS_PALETTE = ['#5b3a21', '#3d2614', '#3d6e9e', '#3f7a4a', '#6b7a3a', '#7a7f86', '#8a5a2a'];
const LIP_PALETTE = ['#a85b4b', '#b46a5e', '#8a4a40', '#c47a70', '#6a3a30', '#9a4a5a'];
const CLOTH_PALETTE = [
  '#2f6f8f', '#356a4a', '#a8466a', '#c43d3d', '#e0a93b', '#3b6ea0', '#6b4f8a', '#d0672f',
  '#2f9b8f', '#18181b', '#e9e4dc', '#7a5a3c', '#1f2a44', '#c45c93', '#6b6a4a', '#f3c94b',
];
const PANTS_PALETTE = ['#2c3144', '#1f2330', '#33374a', '#4b4b52', '#6b6a4a', '#3a4a6a', '#26262c', '#4b3a26', '#e8e1d2', '#1f3d8a'];
const FEET_PALETTE = ['#202024', '#151518', '#3a2a20', '#5a3b26', '#e9e9e9', '#c42e2e', '#2b2b30'];

/** Darken a #rrggbb colour by `k` (0 = unchanged, 1 = black). */
function darken(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (shift: number) => Math.round(((n >> shift) & 0xff) * (1 - k)).toString(16).padStart(2, '0');
  return `#${ch(16)}${ch(8)}${ch(0)}`;
}

/** Generate a random but coherent character: an age archetype drives the
 *  proportions (a toddler gets a big head and short stature, an elder greyer
 *  hair), the remaining body/face/hair/clothing/colour choices are drawn from
 *  the same validated enums the panel exposes, and the pose is one of the named
 *  presets so the Pose dropdown still reads sensibly. Pass a seeded `rng`
 *  (`seededRandom(n)`) for a reproducible result. */
export function randomSpec(rng: () => number = Math.random): CharacterSpec {
  const pick = <T>(xs: readonly T[]): T => xs[Math.min(xs.length - 1, Math.floor(rng() * xs.length))];
  const range = (lo: number, hi: number, step: number): number =>
    Number((lo + Math.round((rng() * (hi - lo)) / step) * step).toFixed(4));
  const chance = (p: number): boolean => rng() < p;
  // Weighted pick over [value, weight] pairs.
  const weighted = <T>(pairs: readonly [T, number][]): T => {
    const total = pairs.reduce((a, [, w]) => a + w, 0);
    let r = rng() * total;
    for (const [v, w] of pairs) { if ((r -= w) < 0) return v; }
    return pairs[pairs.length - 1][0];
  };

  const s = cloneSpec(DEFAULT_SPEC);
  const archetype = weighted<'adult' | 'child' | 'teen' | 'elder' | 'chibi'>([
    ['adult', 55], ['child', 10], ['teen', 10], ['elder', 13], ['chibi', 12],
  ]);
  const sex = weighted<CharacterSpec['body']['sex']>([['female', 40], ['male', 40], ['neutral', 20]]);
  const young = archetype === 'child' || archetype === 'chibi';

  const b = s.body;
  b.sex = sex;
  b.build = weighted([['slim', 35], ['average', 45], ['stocky', 20]]);
  switch (archetype) {
    case 'child': b.age = range(4, 11, 1); b.height = range(30, 44, 1); b.headsTall = range(4.5, 6, 0.25); break;
    case 'chibi': b.age = 25; b.height = range(30, 40, 1); b.headsTall = range(2.75, 3.75, 0.25); break;
    case 'teen': b.age = range(13, 17, 1); b.height = range(52, 64, 1); b.headsTall = range(6.5, 7.25, 0.25); break;
    case 'elder': b.age = range(62, 85, 1); b.height = range(56, 66, 1); b.headsTall = range(6.75, 7.5, 0.25); break;
    default: b.age = range(20, 55, 1); b.height = range(58, 74, 1); b.headsTall = range(7, 8, 0.25);
  }
  b.weight = range(0.25, 0.8, 0.05);
  b.muscle = young ? 0 : range(0, sex === 'male' ? 0.8 : 0.5, 0.05);
  b.bust = sex === 'female' && !young && archetype !== 'teen' ? range(0.2, 0.7, 0.05) : 0;
  b.belly = young || archetype === 'teen' ? 0 : chance(0.3) ? range(0.1, archetype === 'elder' ? 0.8 : 0.5, 0.05) : 0;

  s.pose = POSE_PRESETS[weighted([['standing', 30], ['contrapposto', 25], ['walking', 20], ['waving', 15], ['armsUp', 10]])]();

  const f = s.face;
  f.shape = young ? pick(['round', 'oval', 'heart'] as const) : pick(['oval', 'round', 'square', 'long', 'heart', 'diamond'] as const);
  // Lids / gaze / brows avoid the combos that bury a painted feature in the
  // figure builder (0 paintable triangles): hooded lids and an upward gaze can
  // swallow the pupil under the lid, thin brows can sink under the brow ridge.
  // They stay available by hand in the panel; a one-click roll skips them.
  f.lids = young ? pick(['none', 'almond', 'upper'] as const) : weighted([['almond', 35], ['upper', 25], ['none', 20], ['tapered', 15], ['half', 5]]);
  f.gaze = weighted([['center', 76], ['left', 12], ['right', 12]]);
  f.nose = young ? pick(['button', 'snub', 'straight'] as const) : pick(['straight', 'button', 'snub', 'roman', 'aquiline', 'broad', 'pointed', 'bulbous'] as const);
  f.expression = weighted([['bigSmile', 15], ['smile', 25], ['slightSmile', 30], ['neutral', 20], ['slightFrown', 7], ['frown', 3]]);
  f.lipShape = pick(['natural', 'full', 'thin', 'wide', 'rosebud', 'flat'] as const);
  f.ears = weighted([['detailed', 60], ['round', 30], ['pointed', 10]]);
  f.brows = archetype === 'elder' && chance(0.4) ? 'bushy' : pick(['natural', 'bushy', 'arched', 'flat', 'angled', 'rounded', 'straight'] as const);

  const h = s.hair;
  h.style = weighted<CharacterSpec['hair']['style']>([
    ['short', 18], ['long', sex === 'male' ? 5 : 14], ['bob', sex === 'male' ? 3 : 10], ['bun', archetype === 'elder' ? 12 : 7],
    // locs / boxBraids are left out: their strands can currently detach from
    // the head (a multi-piece print), which a one-click roll shouldn't risk.
    ['bangs', 7], ['ponytail', 8], ['afro', 6], ['braids', 8], ['spiked', 5], ['cornrows', 5],
    ['bald', archetype === 'elder' && sex !== 'female' ? 25 : young ? 0 : 3],
  ]);
  h.length = h.style === 'long' || h.style === 'braids' ? weighted([['long', 70], ['mid', 30]]) : pick(['short', 'mid', 'long'] as const);
  h.volume = h.style === 'afro' ? range(1, 1.5, 0.1) : range(0.8, 1.3, 0.1);

  const c = s.clothing;
  c.top.on = chance(0.94);
  c.top.sleeve = pick(['none', 'short', 'long'] as const);
  c.top.length = c.top.on && chance(sex === 'female' ? 0.3 : 0.04) ? 'dress' : 'shirt';
  // A dress usually replaces the pants (the hem covers the thigh either way).
  c.pants.on = c.top.length === 'dress' ? chance(0.2) : chance(0.97);
  c.pants.leg = chance(0.25) ? 'cargo' : 'slim';
  c.pants.rise = pick(['low', 'mid', 'high'] as const);
  c.pants.length = chance(0.2) ? 'briefs' : 'full';
  c.feet.on = chance(0.92);
  c.feet.kind = chance(0.35) ? 'boots' : 'shoes';

  const col = s.colors;
  col.skin = pick(SKIN_PALETTE);
  col.hair = archetype === 'elder' ? pick(HAIR_GREY) : chance(0.1) ? pick(HAIR_DYED) : pick(HAIR_NATURAL);
  col.brows = archetype === 'elder' ? darken(col.hair, 0.15) : HAIR_DYED.includes(col.hair) ? pick(HAIR_NATURAL.slice(0, 5)) : darken(col.hair, 0.2);
  col.iris = pick(IRIS_PALETTE);
  col.lips = pick(LIP_PALETTE);
  col.top = pick(CLOTH_PALETTE);
  // Pants contrast with the top (never the identical colour).
  col.pants = pick(PANTS_PALETTE.filter(x => x !== col.top));
  col.feet = pick(FEET_PALETTE);
  return s;
}

/** Structured deep clone (the spec is plain JSON, so this is exact). */
export function cloneSpec(spec: CharacterSpec): CharacterSpec {
  return JSON.parse(JSON.stringify(spec));
}

/** Deep-merge a partial spec over DEFAULT_SPEC so a decoded older/partial spec
 *  fills in any field added since it was written (forward-compat). */
export function normalizeSpec(partial: unknown): CharacterSpec {
  const base = cloneSpec(DEFAULT_SPEC);
  if (!partial || typeof partial !== 'object') return base;
  const p = partial as Record<string, unknown>;
  const merge = (dst: Record<string, unknown>, src: unknown): void => {
    if (!src || typeof src !== 'object') return;
    for (const [k, v] of Object.entries(src as Record<string, unknown>)) {
      // Guard against prototype pollution: a spec can arrive from an untrusted
      // `// @character` header, so never let it write __proto__/constructor.
      if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
      if (v && typeof v === 'object' && !Array.isArray(v) && dst[k] && typeof dst[k] === 'object') {
        merge(dst[k] as Record<string, unknown>, v);
      } else if (v !== undefined) {
        dst[k] = v;
      }
    }
  };
  merge(base as unknown as Record<string, unknown>, p);
  return base;
}

const HEADER_RE = /^\s*\/\/\s*@character\s+v(\d+)\s+(\{.*\})\s*$/m;

/** The one-line header comment that embeds the spec in generated code. */
export function encodeSpecComment(spec: CharacterSpec): string {
  return `// @character v${SPEC_VERSION} ${JSON.stringify(spec)}`;
}

/** Recover a spec from generated code's header comment, or null if absent. */
export function decodeSpecComment(code: string): CharacterSpec | null {
  const m = HEADER_RE.exec(code);
  if (!m) return null;
  try {
    return normalizeSpec(JSON.parse(m[2]));
  } catch {
    return null;
  }
}
