// The Character Creator's data model: a plain, serialisable description of a
// figure (body proportions, pose, face, hair, clothing, colours). The panel
// edits a `CharacterSpec`; `characterCodegen.ts` turns one into self-contained
// `api.sdf.figure` model code. The spec is also embedded verbatim as a
// `// @character v2 {json}` header comment in the generated code, so re-opening
// the panel restores every control exactly (and the code stays hand-editable).
// Older headers (`@character v1`) migrate through `normalizeSpec` with defaults
// that regenerate their original code.
//
// Every enum here is a real, validated option of the figure API
// (`src/geometry/sdfFigure.ts`) — keep them in sync with the assertEnum lists
// there. Pure data + helpers, no DOM/engine, so it unit-tests in the vitest tier.

export const SPEC_VERSION = 2;

// Enum value lists — the single source for the spec types, the validator, the
// panel's dropdowns and the AI tool's JSON schema. Each mirrors (or, for gaze,
// is a subset of) an assertEnum list in sdfFigure.ts; tests/unit/
// characterCodegen.test.ts asserts they stay in sync with the library.
export const BUILDS = ['slim', 'average', 'stocky'] as const;
export const SEXES = ['neutral', 'male', 'female'] as const;
/** Body plan. 'realistic' = the human canon (no `proportions` key emitted);
 *  'chibi' / 'funko' map to `rig({ proportions })`. */
export const PROPORTIONS = ['realistic', 'chibi', 'funko'] as const;
export const FACE_SHAPES = ['oval', 'round', 'square', 'long', 'heart', 'diamond'] as const;
export const LID_STYLES = ['none', 'upper', 'hooded', 'half', 'closed', 'almond', 'tapered'] as const;
export const GAZES = ['middle', 'center', 'left', 'right', 'up', 'down'] as const;
export const NOSE_TYPES = ['straight', 'button', 'snub', 'roman', 'aquiline', 'broad', 'pointed', 'bulbous'] as const;
export const EXPRESSIONS = ['bigSmile', 'smile', 'slightSmile', 'neutral', 'slightFrown', 'frown', 'deepFrown'] as const;
export const LIP_SHAPES = ['natural', 'full', 'thin', 'wide', 'rosebud', 'flat'] as const;
export const EAR_TYPES = ['round', 'pointed', 'detailed'] as const;
export const BROW_SHAPES = ['natural', 'thin', 'bushy', 'arched', 'flat', 'angled', 'rounded', 'straight'] as const;
export const HAIR_STYLES = [
  'bald', 'short', 'long', 'bob', 'bun', 'bangs', 'ponytail',
  'afro', 'braids', 'spiked', 'locs', 'cornrows', 'boxBraids', 'mop', 'anime', 'shag', 'captured',
] as const;
export const HAIR_LENGTHS = ['short', 'mid', 'long'] as const;
export const LOCK_SHAPES = ['ribbon', 'tube'] as const;
/** 'shag' crown: 5 sharp back-fanning spikes + 2 side-up spikes, or small random locks. */
export const HAIR_CROWNS = ['spiky', 'tousled'] as const;
export const SLEEVES = ['none', 'short', 'long'] as const;
export const TOP_LENGTHS = ['shirt', 'dress'] as const;
export const PANTS_LEGS = ['slim', 'cargo'] as const;
export const PANTS_RISES = ['low', 'mid', 'high'] as const;
export const PANTS_LENGTHS = ['full', 'briefs'] as const;
export const FOOTWEAR_KINDS = ['shoes', 'boots'] as const;
export const HOLD_KINDS = ['none', 'ball'] as const;
export const HOLD_CUPS = ['sides', 'under'] as const;

export type Build = typeof BUILDS[number];
export type Sex = typeof SEXES[number];
export type Proportions = typeof PROPORTIONS[number];
export type FaceShape = typeof FACE_SHAPES[number];
export type LidStyle = typeof LID_STYLES[number];
export type Gaze = typeof GAZES[number];
export type NoseType = typeof NOSE_TYPES[number];
export type Expression = typeof EXPRESSIONS[number];
export type LipShape = typeof LIP_SHAPES[number];
export type EarType = typeof EAR_TYPES[number];
export type BrowShape = typeof BROW_SHAPES[number];
export type HairStyle = typeof HAIR_STYLES[number];
export type HairLength = typeof HAIR_LENGTHS[number];
export type LockShape = typeof LOCK_SHAPES[number];
export type HairCrown = typeof HAIR_CROWNS[number];
export type Sleeve = typeof SLEEVES[number];
export type TopLength = typeof TOP_LENGTHS[number];
export type PantsLeg = typeof PANTS_LEGS[number];
export type PantsRise = typeof PANTS_RISES[number];
export type PantsLength = typeof PANTS_LENGTHS[number];
export type FootwearKind = typeof FOOTWEAR_KINDS[number];
export type HoldKind = typeof HOLD_KINDS[number];
export type HoldCup = typeof HOLD_CUPS[number];

/** Per-axis head multiplier (x = width, y = depth, z = height), or one number
 *  for all three. `null` in the spec = the style's default. */
export type HeadScale = number | { x: number; y: number; z: number };

/** Hair styles built from seeded locks — the only ones the lock knobs apply to. */
export const LOCK_HAIR_STYLES: readonly HairStyle[] = ['mop', 'anime', 'shag'];

/** A single FK joint. All angles in degrees; 0 is neutral. */
export interface Joint {
  raiseSide: number;
  raiseFwd: number;
  bend: number;
  twist: number;
}

export interface HeadPose { yaw: number; pitch: number; roll: number }
export interface SpinePose { lean: number; turn: number; side: number }

/** Two-hand held object. 'ball' solves both arms onto a sphere
 *  (`rig({ pose: { hold } })`), so armL/armR are ignored while it's on. */
export interface HoldSpec {
  kind: HoldKind;
  /** Ball radius, world units. */
  radius: number;
  /** 'sides' = palms on the ball's lower sides; 'under' = cradled from below. */
  cup: HoldCup;
  /** The soccer-panel (pentagon) colour; the ball's base colour is `colors.ball`. */
  color: string;
}

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
  hold: HoldSpec;
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
  /** Body plan: 'realistic' (default) | 'chibi' | 'funko'. */
  proportions: Proportions;
  /** Head size multiplier; null = the style's default. */
  headScale: HeadScale | null;
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
  /** Eye placement: `eyeSpread` × the lateral offset (0.5–2), `eyeHeight` in
   *  head half-heights (−0.6–0.6). null = the style's default. */
  layout: { eyeSpread: number | null; eyeHeight: number | null };
  /** Eye size multiplier (0.5–3; 1 = the library default radius). Big glossy
   *  bead eyes are most of a vinyl toy's likeness. */
  eyeSize: number;
  /** Build the lip ridge. Off for a mouthless vinyl-toy face. */
  mouth: boolean;
}

export interface HairSpec {
  style: HairStyle;
  length: HairLength;
  volume: number;
  // Lock-style knobs — emitted only for the styles that read them:
  // 'mop' + 'anime' + 'shag' share fringe/seed; chunk/spike are 'anime' + 'shag';
  // lockShape/swoop are 'anime'-only; crown/layers/raggedness/flare 'shag'-only.
  /** Anime lock cross-section: flat 'ribbon' (default) or round 'tube'. */
  lockShape: LockShape;
  /** Anime / shag lock width multiplier (0.4–2.5). */
  chunk: number;
  /** Anime / shag crown-lock (spike) lift (0–3). */
  spike: number;
  /** Anime sideways sweep of the fringe (−1–3). */
  swoop: number;
  /** Fringe amount over the forehead (0–1.5). */
  fringe: number;
  /** Lock layout seed (same seed ⇒ same hair). */
  seed: number;
  /** Shag crown: 'spiky' (back-fanning spikes) or 'tousled'. */
  crown: HairCrown;
  /** Shag: overlapping lock layers over the sides + back (1–3). */
  layers: number;
  /** Shag: jitter of lock length / lean / hem (0–2). */
  raggedness: number;
  /** Shag: mop mass above the ears (0–3). */
  flare: number;
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
  /** Held ball base colour (the panels are `pose.hold.color`). */
  ball: string;
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
  /** Finish with `F.place(model, rig, { face: '+X' })` — bottom at z = 0,
   *  facing +X (the figure-library convention). v1 specs migrate to false, the
   *  legacy builder frame (−Y front, soles at z = 0), so their code is unchanged. */
  place: boolean;
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
    hold: noHold(),
  };
}

function noHold(): HoldSpec {
  return { kind: 'none', radius: 7, cup: 'sides', color: '#161616' };
}

/** Library defaults of the lock-style hair knobs (none are emitted at these values). */
function lockDefaults(): Pick<HairSpec, 'lockShape' | 'chunk' | 'spike' | 'swoop' | 'fringe' | 'seed' | 'crown' | 'layers' | 'raggedness' | 'flare'> {
  return { lockShape: 'ribbon', chunk: 1, spike: 1, swoop: 1, fringe: 1, seed: 1, crown: 'spiky', layers: 3, raggedness: 1, flare: 1 };
}

export const DEFAULT_SPEC: CharacterSpec = {
  body: { height: 60, headsTall: 7, build: 'average', sex: 'neutral', age: 25, weight: 0.5, muscle: 0, bust: 0, belly: 0, proportions: 'realistic', headScale: null },
  pose: standingPose(),
  face: { shape: 'oval', lids: 'almond', gaze: 'center', nose: 'straight', expression: 'slightSmile', lipShape: 'natural', ears: 'detailed', brows: 'natural', layout: { eyeSpread: null, eyeHeight: null }, eyeSize: 1, mouth: true },
  hair: { style: 'short', length: 'mid', volume: 1, ...lockDefaults() },
  clothing: {
    top: { on: true, sleeve: 'short', length: 'shirt' },
    pants: { on: true, leg: 'slim', rise: 'mid', length: 'full' },
    feet: { on: true, kind: 'shoes' },
  },
  colors: {
    skin: '#c68642', eyes: '#f7f6f2', iris: '#5b3a21', pupil: '#161616', lips: '#a85b4b',
    brows: '#2a1d14', hair: '#2a1d14', top: '#2f6f8f', pants: '#2c3144', feet: '#202024', base: '#4a4a4a', ball: '#f7f7f7',
  },
  base: true,
  place: true,
};

/** Named pose presets. Each returns a fresh PoseSpec the panel drops into the
 *  spec when the user picks it (after which the joint sliders can be tweaked). */
export const POSE_PRESETS: Record<string, () => PoseSpec> = {
  standing: standingPose,
  tpose: () => ({
    preset: 'tpose',
    armL: j({ raiseSide: 90 }), armR: j({ raiseSide: 90 }),
    legL: j({ raiseSide: 6 }), legR: j({ raiseSide: 6 }),
    spine: { lean: 0, turn: 0, side: 0 }, head: { yaw: 0, pitch: 0, roll: 0 }, hold: noHold(),
  }),
  armsUp: () => ({
    preset: 'armsUp',
    armL: j({ raiseSide: 150, bend: 18 }), armR: j({ raiseSide: 150, bend: 18 }),
    legL: j({ raiseSide: 7 }), legR: j({ raiseSide: 7 }),
    spine: { lean: 0, turn: 0, side: 0 }, head: { yaw: 0, pitch: -6, roll: 0 }, hold: noHold(),
  }),
  contrapposto: () => ({
    preset: 'contrapposto',
    armL: j({ raiseSide: 9, bend: 12 }), armR: j({ raiseSide: 11, bend: 8 }),
    legL: j({ raiseSide: 5 }), legR: j({ raiseSide: 9, bend: 14 }),
    spine: { lean: 0, turn: 4, side: 6 }, head: { yaw: -10, pitch: 0, roll: -3 }, hold: noHold(),
  }),
  walking: () => ({
    preset: 'walking',
    armL: j({ raiseFwd: 24, bend: 18 }), armR: j({ raiseFwd: -22, bend: 14 }),
    legL: j({ raiseFwd: 22, bend: 16 }), legR: j({ raiseFwd: -18, bend: 6 }),
    spine: { lean: 4, turn: 0, side: 0 }, head: { yaw: 0, pitch: 0, roll: 0 }, hold: noHold(),
  }),
  waving: () => ({
    preset: 'waving',
    armL: j({ raiseSide: 8, bend: 8 }), armR: j({ raiseSide: 148, bend: 42 }),
    legL: j({ raiseSide: 6 }), legR: j({ raiseSide: 6 }),
    spine: { lean: 0, turn: 0, side: 0 }, head: { yaw: 8, pitch: -4, roll: 4 }, hold: noHold(),
  }),
};

export const POSE_PRESET_LABELS: Record<string, string> = {
  standing: 'Standing', tpose: 'T-pose', armsUp: 'Arms up',
  contrapposto: 'Contrapposto', walking: 'Walking', waving: 'Waving',
};

/** A handful of complete starting characters, surfaced as one-click presets in
 *  the panel — the fastest path for a non-coder. Each is a deep-merge patch over
 *  DEFAULT_SPEC so it stays terse and forward-compatible with new fields. */
export interface CharacterPreset { id: string; label: string; patch: () => CharacterSpec }

function withSpec(patch: (s: CharacterSpec) => void): () => CharacterSpec {
  return () => { const s = cloneSpec(DEFAULT_SPEC); patch(s); return s; };
}

export const CHARACTER_PRESETS: CharacterPreset[] = [
  { id: 'adultF', label: 'Adult woman', patch: withSpec(s => {
    s.body = { ...s.body, height: 64, headsTall: 7.5, sex: 'female', bust: 0.5 };
    s.face = { ...s.face, shape: 'oval', lipShape: 'full', lids: 'almond', expression: 'slightSmile' };
    s.hair = { style: 'long', length: 'long', volume: 1.1, ...lockDefaults() };
    s.clothing.top = { on: true, sleeve: 'short', length: 'dress' };
    s.clothing.pants = { on: false, leg: 'slim', rise: 'mid', length: 'full' };
    s.colors = { ...s.colors, top: '#a8466a', hair: '#3a2417' };
  }) },
  { id: 'adultM', label: 'Adult man', patch: withSpec(s => {
    s.body = { ...s.body, height: 66, headsTall: 7.5, sex: 'male', build: 'average', muscle: 0.35 };
    s.face = { ...s.face, shape: 'square', nose: 'straight', brows: 'flat', expression: 'neutral' };
    s.hair = { style: 'short', length: 'short', volume: 0.8, ...lockDefaults() };
    s.colors = { ...s.colors, top: '#356a4a', pants: '#33374a' };
  }) },
  { id: 'child', label: 'Child', patch: withSpec(s => {
    s.body = { ...s.body, height: 38, headsTall: 5, age: 7, build: 'slim' };
    s.face = { ...s.face, shape: 'round', nose: 'button', expression: 'smile', lids: 'none' };
    s.hair = { style: 'short', length: 'short', volume: 1, ...lockDefaults() };
    s.colors = { ...s.colors, top: '#e0a93b', pants: '#3b6ea0' };
  }) },
  { id: 'chibi', label: 'Chibi', patch: withSpec(s => {
    s.body = { ...s.body, height: 36, headsTall: 3.2, build: 'average' };
    s.face = { ...s.face, shape: 'round', nose: 'button', expression: 'bigSmile', lids: 'none' };
    s.hair = { style: 'bob', length: 'mid', volume: 1.2, ...lockDefaults() };
    s.colors = { ...s.colors, top: '#d65a7a' };
  }) },
  { id: 'athlete', label: 'Athlete', patch: withSpec(s => {
    s.body = { ...s.body, height: 66, headsTall: 7.5, build: 'average', muscle: 0.6 };
    s.pose = POSE_PRESETS.contrapposto();
    s.face = { ...s.face, expression: 'slightSmile' };
    s.hair = { style: 'ponytail', length: 'long', volume: 0.9, ...lockDefaults() };
    s.clothing.top = { on: true, sleeve: 'none', length: 'shirt' };
    s.clothing.pants = { on: true, leg: 'slim', rise: 'mid', length: 'briefs' };
    s.colors = { ...s.colors, top: '#c43d3d', pants: '#1f2330' };
  }) },
  { id: 'dancer', label: 'Dancer', patch: withSpec(s => {
    s.body = { ...s.body, height: 70, headsTall: 8, build: 'slim', sex: 'female', bust: 0.35 };
    s.pose = POSE_PRESETS.armsUp();
    s.face = { ...s.face, lipShape: 'full', expression: 'slightSmile' };
    s.hair = { style: 'bun', length: 'mid', volume: 1, ...lockDefaults() };
    s.clothing.top = { on: true, sleeve: 'none', length: 'shirt' };
    s.clothing.pants = { on: true, leg: 'slim', rise: 'high', length: 'briefs' };
    s.colors = { ...s.colors, top: '#c45c93', pants: '#c45c93' };
  }) },
];

/** Structured deep clone (the spec is plain JSON, so this is exact). */
export function cloneSpec(spec: CharacterSpec): CharacterSpec {
  return JSON.parse(JSON.stringify(spec));
}

// ---- Style (body plan) defaults ---------------------------------------------

export interface StyleDefaults {
  headsTall: number;
  build: Build;
  headScale: { x: number; y: number; z: number };
  faceLayout: { eyeSpread: number; eyeHeight: number };
}

/** What each style means for the rig. chibi/funko mirror `PROPORTION_PRESETS`
 *  in sdfFigure.ts (a unit test keeps them in sync); realistic is the human
 *  canon (unscaled head, the default eye layout). The panel shows these as the
 *  value of a `null` headScale / layout field. */
export const STYLE_DEFAULTS: Record<Proportions, StyleDefaults> = {
  realistic: { headsTall: 7, build: 'average', headScale: { x: 1, y: 1, z: 1 }, faceLayout: { eyeSpread: 1, eyeHeight: 0 } },
  chibi: { headsTall: 3, build: 'average', headScale: { x: 1.4, y: 1.25, z: 1.25 }, faceLayout: { eyeSpread: 1.1, eyeHeight: -0.12 } },
  funko: { headsTall: 3, build: 'slim', headScale: { x: 2.5, y: 1.8, z: 1.7 }, faceLayout: { eyeSpread: 1.25, eyeHeight: -0.35 } },
};

/** The head scale the rig will actually use (a null field = the style default). */
export function resolvedHeadScale(spec: CharacterSpec): { x: number; y: number; z: number } {
  const hs = spec.body.headScale;
  if (hs === null || hs === undefined) return { ...STYLE_DEFAULTS[spec.body.proportions].headScale };
  if (typeof hs === 'number') return { x: hs, y: hs, z: hs };
  return { ...hs };
}

/** Bead-black for the vinyl-toy eyes (white, iris and pupil all one gloss). */
const BEAD = '#0b0b0d';
/** Style eye-size defaults: anime chibi eyes run big, vinyl-toy beads bigger. */
const CHIBI_EYE_SIZE = 1.4;
const FUNKO_EYE_SIZE = 1.8;

/** Switch the body plan and apply that style's sensible defaults: the rig's
 *  head count + build, the style's own head scale / eye layout (cleared to
 *  null), and a face that suits it — Funko gets bead eyes, no lids, a button
 *  nose, a painted-out mouth, arched brows and round ears. Mutates `spec`. */
export function applyStyle(spec: CharacterSpec, style: Proportions): void {
  const d = STYLE_DEFAULTS[style];
  const D = DEFAULT_SPEC;
  const wasBead = spec.colors.eyes === BEAD && spec.colors.iris === BEAD;
  spec.body.proportions = style;
  spec.body.headsTall = d.headsTall;
  spec.body.build = d.build;
  spec.body.headScale = null;
  spec.face.layout = { eyeSpread: null, eyeHeight: null };
  if (style === 'funko') {
    spec.face = { ...spec.face, shape: 'round', lids: 'none', nose: 'button', expression: 'neutral', brows: 'arched', ears: 'round', eyeSize: FUNKO_EYE_SIZE, mouth: false };
    spec.colors.eyes = BEAD; spec.colors.iris = BEAD; spec.colors.pupil = BEAD;
    return;
  }
  if (wasBead) { spec.colors.eyes = D.colors.eyes; spec.colors.iris = D.colors.iris; spec.colors.pupil = D.colors.pupil; }
  if (style === 'chibi') {
    spec.face = { ...spec.face, shape: 'round', lids: 'none', nose: 'button', expression: 'smile', ears: 'round', eyeSize: CHIBI_EYE_SIZE, mouth: true };
  } else {
    spec.face = { ...D.face, layout: { eyeSpread: null, eyeHeight: null } };
  }
}

// ---- normalize / migrate ----------------------------------------------------

/** Deep-merge a partial spec over the defaults so a decoded older/partial spec
 *  fills in any field added since it was written (forward-compat), migrating
 *  from `fromVersion` (default: a numeric `version` key on the spec, else the
 *  current SPEC_VERSION). v1 → v2: every new field's default already
 *  reproduces v1 output except `place`, which a v1 spec gets as false — so a
 *  v1 header regenerates byte-identical code below the header line. */
export function normalizeSpec(partial: unknown, fromVersion?: number): CharacterSpec {
  const base = cloneSpec(DEFAULT_SPEC);
  if (!partial || typeof partial !== 'object' || Array.isArray(partial)) return base;
  const p = { ...(partial as Record<string, unknown>) };
  const declared = typeof p.version === 'number' ? p.version : undefined;
  delete p.version;
  const version = fromVersion ?? declared ?? SPEC_VERSION;
  if (version < 2) base.place = false;
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
  // Detach from the caller's objects (merge assigns new sub-objects by reference).
  return cloneSpec(base);
}

// ---- validation + JSON schema -----------------------------------------------

type FieldSpec =
  | { t: 'enum'; values: readonly string[]; d: string }
  | { t: 'num'; min?: number; max?: number; nullable?: boolean; d: string }
  | { t: 'bool'; d: string }
  | { t: 'color'; d: string }
  | { t: 'str'; d: string }
  | { t: 'headScale'; d: string }
  | { t: 'obj'; fields: Record<string, FieldSpec>; d: string };

const e = (values: readonly string[], d: string): FieldSpec => ({ t: 'enum', values, d });
const n = (d: string, min?: number, max?: number, nullable?: boolean): FieldSpec => ({ t: 'num', min, max, nullable, d });
const c = (d: string): FieldSpec => ({ t: 'color', d });
const o = (fields: Record<string, FieldSpec>, d: string): FieldSpec => ({ t: 'obj', fields, d });
const joint = (d: string): FieldSpec => o({
  raiseSide: n('Lift sideways (deg).'), raiseFwd: n('Swing forward(+)/back(−) (deg).'),
  bend: n('Elbow/knee flexion (deg).'), twist: n('Axial roll (deg).'),
}, d);

/** The whole spec as a field tree — drives `validateSpec` and `specJsonSchema`. */
const SPEC_FIELDS: Record<string, FieldSpec> = {
  body: o({
    height: n('Total height, world units (the base adds a little below).', 1),
    headsTall: n('Heads tall (realistic ≈ 7, chibi/funko 3).', 2, 12),
    build: e(BUILDS, 'Body build.'),
    sex: e(SEXES, 'Body sex.'),
    age: n('Age in years.', 1, 90),
    weight: n('Body weight 0–1.', 0, 1),
    muscle: n('Muscle 0–1.', 0, 1),
    bust: n('Bust 0–2.', 0, 2),
    belly: n('Belly 0–2.', 0, 2),
    proportions: e(PROPORTIONS, "Body plan: 'realistic' human canon, 'chibi' big round head, 'funko' vinyl-pop toy (huge wide head, short body)."),
    headScale: { t: 'headScale', d: 'Head size multiplier {x: width, y: depth, z: height} (0.3–4 each; a number = uniform). null/omit = the style default (funko {2.5,1.8,1.7}, chibi {1.4,1.25,1.25}).' },
  }, 'Body proportions.'),
  pose: o({
    preset: { t: 'str', d: 'UI label of the last pose preset (ignored by codegen).' },
    armL: joint('Left arm (ignored while holding a ball).'),
    armR: joint('Right arm (ignored while holding a ball).'),
    legL: joint('Left leg.'),
    legR: joint('Right leg.'),
    spine: o({ lean: n('Lean forward (deg).'), turn: n('Twist (deg).'), side: n('Side bend (deg).') }, 'Spine.'),
    head: o({ yaw: n('Turn (deg).'), pitch: n('Nod (deg).'), roll: n('Tilt (deg).') }, 'Head.'),
    hold: o({
      kind: e(HOLD_KINDS, "'ball' = both hands hold a soccer ball (arms are solved automatically)."),
      radius: n('Ball radius, world units (≈ 0.1 × height).', 0.1),
      cup: e(HOLD_CUPS, "'sides' = palms on the ball's lower sides; 'under' = cradled from below."),
      color: c('Ball panel (pentagon) colour; the base colour is colors.ball.'),
    }, 'Two-hand held object.'),
  }, 'Pose (joint angles in degrees, 0 = neutral).'),
  face: o({
    shape: e(FACE_SHAPES, 'Face shape.'),
    lids: e(LID_STYLES, 'Eyelids.'),
    gaze: e(GAZES, 'Gaze direction.'),
    nose: e(NOSE_TYPES, 'Nose type.'),
    expression: e(EXPRESSIONS, 'Mouth expression.'),
    lipShape: e(LIP_SHAPES, 'Lip shape.'),
    ears: e(EAR_TYPES, 'Ear type.'),
    brows: e(BROW_SHAPES, 'Brow shape.'),
    layout: o({
      eyeSpread: n('Eye spacing multiplier (0.5–2); null = style default.', 0.5, 2, true),
      eyeHeight: n('Eye height in head half-heights (−0.6–0.6, negative = lower); null = style default.', -0.6, 0.6, true),
    }, 'Eye placement on the face.'),
    eyeSize: n('Eye size multiplier 0.5–3 (1 = default; funko bead eyes ≈ 1.8).', 0.5, 3),
    mouth: { t: 'bool', d: 'Build the lips (false = mouthless vinyl-toy face).' },
  }, 'Face.'),
  hair: o({
    style: e(HAIR_STYLES, "Hair style. 'anime' = flat swoopy ribbon locks (vinyl-toy/anime spiky bob); 'shag' = shaggy layered ribbon-lock mop with a messy fringe and a spiky or tousled crown (vinyl-toy jet-black mop); 'mop' = curly shag of seeded locks; 'captured' = a hairdo captured from a real mesh (the Captain Tsubasa Funko)."),
    length: e(HAIR_LENGTHS, 'Hair length.'),
    volume: n('Hair volume 0.3–4.', 0.3, 4),
    lockShape: e(LOCK_SHAPES, "anime only: flat 'ribbon' locks or round 'tube' locks."),
    chunk: n('anime/shag: lock width 0.4–2.5.', 0.4, 2.5),
    spike: n('anime/shag: crown-lock (spike) lift 0–3.', 0, 3),
    swoop: n('anime only: fringe sideways sweep −1–3.', -1, 3),
    fringe: n('mop/anime/shag: fringe amount 0–1.5.', 0, 1.5),
    seed: n('mop/anime/shag: lock layout seed (integer).'),
    crown: e(HAIR_CROWNS, "shag only: 'spiky' = 5 sharp back-fanning spikes + 2 side-up spikes; 'tousled' = small random crown locks."),
    layers: n('shag only: overlapping lock layers over the sides + back, integer 1–3.', 1, 3),
    raggedness: n('shag only: jitter of lock length / lean / hem 0–2.', 0, 2),
    flare: n('shag only: mop mass above the ears 0–3.', 0, 3),
  }, 'Hair.'),
  clothing: o({
    top: o({ on: { t: 'bool', d: 'Wear a top.' }, sleeve: e(SLEEVES, 'Sleeves.'), length: e(TOP_LENGTHS, "'dress' drops the hem to mid-thigh.") }, 'Top.'),
    pants: o({ on: { t: 'bool', d: 'Wear pants.' }, leg: e(PANTS_LEGS, 'Leg cut.'), rise: e(PANTS_RISES, 'Waist rise.'), length: e(PANTS_LENGTHS, "'briefs' = shorts.") }, 'Pants.'),
    feet: o({ on: { t: 'bool', d: 'Wear footwear.' }, kind: e(FOOTWEAR_KINDS, 'Footwear.') }, 'Footwear.'),
  }, 'Clothing.'),
  colors: o({
    skin: c('Skin.'), eyes: c('Eye whites.'), iris: c('Iris.'), pupil: c('Pupil.'), lips: c('Lips.'),
    brows: c('Brows.'), hair: c('Hair.'), top: c('Top.'), pants: c('Pants.'), feet: c('Footwear.'),
    base: c('Stand.'), ball: c('Held ball base colour.'),
  }, "Paint colours, '#rrggbb'."),
  base: { t: 'bool', d: 'Include a round stand.' },
  place: { t: 'bool', d: "Finish with F.place (bottom at z = 0, facing +X). Default true; v1 specs migrate to false." },
};

const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/** Validate a (normalized) spec against the field tree: enums, numeric ranges
 *  (the figure library's own bounds), colours, booleans and unknown keys.
 *  Returns every problem as a path-prefixed message (empty = valid). */
export function validateSpec(spec: unknown): string[] {
  const errs: string[] = [];
  const walk = (v: unknown, f: FieldSpec, path: string): void => {
    switch (f.t) {
      case 'enum':
        if (typeof v !== 'string' || !f.values.includes(v)) errs.push(`${path} must be one of ${f.values.map(x => `'${x}'`).join(' | ')} (got ${JSON.stringify(v)})`);
        return;
      case 'num':
        if (v === null && f.nullable) return;
        if (typeof v !== 'number' || !Number.isFinite(v)) { errs.push(`${path} must be a finite number${f.nullable ? ' or null' : ''} (got ${JSON.stringify(v)})`); return; }
        if (f.min !== undefined && v < f.min) errs.push(`${path} must be ≥ ${f.min} (got ${v})`);
        if (f.max !== undefined && v > f.max) errs.push(`${path} must be ≤ ${f.max} (got ${v})`);
        return;
      case 'bool':
        if (typeof v !== 'boolean') errs.push(`${path} must be true or false (got ${JSON.stringify(v)})`);
        return;
      case 'color':
        if (typeof v !== 'string' || !HEX_RE.test(v)) errs.push(`${path} must be a hex colour like '#c68642' (got ${JSON.stringify(v)})`);
        return;
      case 'str':
        if (typeof v !== 'string') errs.push(`${path} must be a string`);
        return;
      case 'headScale': {
        if (v === null) return;
        const axis = (x: unknown, p: string) => walk(x, { t: 'num', min: 0.3, max: 4, d: '' }, p);
        if (typeof v === 'number') { axis(v, path); return; }
        if (!v || typeof v !== 'object' || Array.isArray(v)) { errs.push(`${path} must be null, a number, or {x, y, z}`); return; }
        const r = v as Record<string, unknown>;
        for (const k of Object.keys(r)) if (!['x', 'y', 'z'].includes(k)) errs.push(`${path}.${k} is not a known field (expected x, y, z)`);
        for (const k of ['x', 'y', 'z']) axis(r[k], `${path}.${k}`);
        return;
      }
      case 'obj': {
        if (!v || typeof v !== 'object' || Array.isArray(v)) { errs.push(`${path} must be an object`); return; }
        const r = v as Record<string, unknown>;
        for (const k of Object.keys(r)) {
          if (!(k in f.fields)) errs.push(`${path ? path + '.' : ''}${k} is not a known field (expected one of ${Object.keys(f.fields).join(', ')})`);
        }
        for (const [k, sub] of Object.entries(f.fields)) walk(r[k], sub, path ? `${path}.${k}` : k);
        return;
      }
    }
  };
  walk(spec, { t: 'obj', fields: SPEC_FIELDS, d: '' }, '');
  return errs;
}

/** JSON Schema for a (partial) spec — every field optional, enums and ranges
 *  included — for the in-app AI `buildCharacter` tool. Uses only the keywords
 *  every provider (incl. Gemini's OpenAPI subset) accepts. */
export function specJsonSchema(): Record<string, unknown> {
  const conv = (f: FieldSpec): Record<string, unknown> => {
    switch (f.t) {
      case 'enum': return { type: 'string', enum: [...f.values], description: f.d };
      case 'num': {
        const s: Record<string, unknown> = { type: 'number', description: f.d };
        if (f.min !== undefined) s.minimum = f.min;
        if (f.max !== undefined) s.maximum = f.max;
        return s;
      }
      case 'bool': return { type: 'boolean', description: f.d };
      case 'color': case 'str': return { type: 'string', description: f.d };
      case 'headScale': return {
        type: 'object', description: f.d,
        properties: { x: { type: 'number', minimum: 0.3, maximum: 4 }, y: { type: 'number', minimum: 0.3, maximum: 4 }, z: { type: 'number', minimum: 0.3, maximum: 4 } },
      };
      case 'obj': return {
        type: 'object', description: f.d,
        properties: Object.fromEntries(Object.entries(f.fields).map(([k, sub]) => [k, conv(sub)])),
      };
    }
  };
  return conv({ t: 'obj', fields: SPEC_FIELDS, d: 'Character spec — any subset; missing fields take the defaults.' });
}

// ---- header comment ---------------------------------------------------------

const HEADER_RE = /^\s*\/\/\s*@character\s+v(\d+)\s+(\{.*\})\s*$/m;

/** The one-line header comment that embeds the spec in generated code. */
export function encodeSpecComment(spec: CharacterSpec): string {
  return `// @character v${SPEC_VERSION} ${JSON.stringify(spec)}`;
}

/** Recover a spec from generated code's header comment (migrating an older
 *  header version to the current spec), or null if absent. */
export function decodeSpecComment(code: string): CharacterSpec | null {
  const m = HEADER_RE.exec(code);
  if (!m) return null;
  try {
    return normalizeSpec(JSON.parse(m[2]), Number(m[1]));
  } catch {
    return null;
  }
}
