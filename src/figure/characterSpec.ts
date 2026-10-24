// The Character Creator's data model: a plain, serialisable description of a
// figure (body proportions, pose, face, hair, clothing, colours). The panel
// edits a `CharacterSpec`; `characterCodegen.ts` turns one into self-contained
// `api.sdf.figure` model code. The spec is also embedded verbatim as a
// `// @character v2 {json}` header comment in the generated code, so re-opening
// the panel restores every control exactly (and the code stays hand-editable).
// Older headers (`@character v1`) migrate through `normalizeSpec` with defaults
// that regenerate their original code. Fields added since (the #1059 details:
// head sink, per-hand cup, bead eyes, brow weight, shag/captured knobs, trim,
// print, socks, toy shoes, shorts) are ADDITIVE v2 fields whose defaults
// reproduce the code the spec generated before they existed, so an older v2
// header regenerates byte-identical code below the header line
// (tests/unit/fixtures/characterV2Code.json) — no version bump needed.
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
/** 'shag' crown: 7 big needle-pointed spikes spread round the back + sides of the crown (sized by `crownSize`), or 7 small random locks. */
export const HAIR_CROWNS = ['spiky', 'tousled'] as const;
export const SLEEVES = ['none', 'short', 'long'] as const;
export const TOP_LENGTHS = ['shirt', 'dress'] as const;
export const PANTS_LEGS = ['slim', 'cargo'] as const;
export const PANTS_RISES = ['low', 'mid', 'high'] as const;
/** 'shorts' = knee-length (cut at `pants.hem` along the thigh); 'briefs' = no legs. */
export const PANTS_LENGTHS = ['full', 'shorts', 'briefs'] as const;
export const FOOTWEAR_KINDS = ['shoes', 'boots'] as const;
export const HOLD_KINDS = ['none', 'ball'] as const;
export const HOLD_CUPS = ['sides', 'under'] as const;
/** 'iris' = white dome + iris + pupil (+ optional lids); 'bead' = the glossy
 *  vinyl-toy bead with a specular glint (labels 'eyes' + 'eyeHighlight'). */
export const EYE_STYLES = ['iris', 'bead'] as const;
/** Captured-hair presets (`F.hair({ style: 'captured', preset })`). */
export const HAIR_PRESETS = ['tsubasa'] as const;
/** 'fitted' hugs the foot; 'toy' = a chunky vinyl-toy sneaker (shoes only). */
export const SHOE_STYLES = ['fitted', 'toy'] as const;
/** Where a garment print sits: the chest (front) or the back. */
export const PRINT_PLACES = ['chest', 'back'] as const;
export const PRINT_FONTS = ['bold', 'regular', 'italic', 'bold-italic'] as const;

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
export type EyeStyle = typeof EYE_STYLES[number];
export type HairPreset = typeof HAIR_PRESETS[number];
export type ShoeStyle = typeof SHOE_STYLES[number];
export type PrintPlace = typeof PRINT_PLACES[number];
export type PrintFont = typeof PRINT_FONTS[number];

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
  /** Per-hand cup override (null = `cup`) — e.g. right hand under, left on the side. */
  cupL: HoldCup | null;
  cupR: HoldCup | null;
  /** Hand size the hold solve assumes (0.5–2.5); big vinyl mitten hands ≈ 1.3. */
  handScale: number;
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
  /** Lower the head onto the shoulders by this × the neck length (0–1.5) —
   *  the neckless vinyl-toy look. 0 = a normal neck. */
  headSink: number;
  /** Fingerless vinyl-toy mitten hands (`F.hands({ fingers: false })`). */
  mittens: boolean;
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
  /** 'iris' (default) or the glossy vinyl-toy 'bead' (ignores lids / gaze / iris / pupil). */
  eyeStyle: EyeStyle;
  /** Bead height ÷ width (0.5–2). */
  eyeAspect: number;
  /** Bead glint size (0 = none, 0.2–3; 1 = the default glint). */
  highlight: number;
  /** Brow weight multiplier (0.1–5) — bold toy brows ≈ 3. */
  browThickness: number;
  /** Brow span multiplier (0.3–2). */
  browWidth: number;
  /** Head-shape multipliers on the face shape: jaw width (0.5–1.6), chin
   *  (0.5–1.6) and cheek fullness (0.3–1.8). A Funko's wide lower face ≈ jaw 1.4, cheek 1.1. */
  jaw: number;
  chin: number;
  cheek: number;
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
  /** Shag crown: 'spiky' (7 spikes round the crown) or 'tousled'. */
  crown: HairCrown;
  /** Shag: overlapping lock layers over the sides + back (1–3). */
  layers: number;
  /** Shag: jitter of lock length / lean / hem (0–2). */
  raggedness: number;
  /** Shag: mop mass above the ears (0–3). */
  flare: number;
  /** Shag: a notched (toothed) fringe hairline (default true). */
  notched: boolean;
  /** Shag: crown-spike size (0.3–2.5). */
  crownSize: number;
  /** Shag: how far the side/back layers stand off the skull (0.3–1.6). */
  backWidth: number;
  /** Shag: side/back lock tip width × root width (0–0.8). */
  tipWidth: number;
  // Captured-only knobs ('captured' replays a hairdo measured off a real mesh).
  /** Which captured hairdo. */
  preset: HairPreset;
  /** Captured: spike sharpness (0–3). */
  spikiness: number;
  /** Captured: smooths the captured relief (0–1). */
  smooth: number;
  /** Captured: mirror the hairdo left↔right. */
  mirror: boolean;
  /** Captured: tilt the hairdo forward(+)/back (−40–40 deg). */
  tilt: number;
  /** Captured: face-window size multiplier (0.5–2). */
  windowScale: number;
  /** Captured: fringe amount (0.3–2). Separate from the lock styles' `fringe`,
   *  which 'captured' ignored before it had its own knob — so an older spec
   *  carrying a lock fringe still regenerates the same captured code. */
  capturedFringe: number;
}

/** One piece of lettering on the top (`F.emboss`), e.g. a chest initial or a
 *  back number. Sizes and offsets are in chest half-widths (`rig.r.chestX`), so
 *  they scale with the figure. Each print paints its own `color`. */
export interface PrintSpec {
  text: string;
  where: PrintPlace;
  /** Lettering height in chest half-widths (0.1–2.5). */
  size: number;
  /** Sideways offset (+ = the figure's left), chest half-widths (−1.5–1.5). */
  x: number;
  /** Vertical offset from the chest line (+ = up), chest half-widths (−2–2). */
  z: number;
  color: string;
  font: PrintFont;
}

export interface ClothingSpec {
  top: {
    on: boolean; sleeve: Sleeve; length: TopLength;
    /** Contrast trim (colour `colors.trim`): a collar band and/or sleeve cuffs. */
    trim: { collar: boolean; cuffs: boolean };
    /** Lettering / numbers on the top. */
    print: PrintSpec[];
  };
  /** `hem` (length 'shorts' only): where the leg is cut, as a fraction of the
   *  hip→knee bone (0.2–1.2; 0.9 = just above the knee). */
  pants: { on: boolean; leg: PantsLeg; rise: PantsRise; length: PantsLength; hem: number };
  /** Socks up the shin (colour `colors.socks`), optionally with `stripes`
   *  contrast bands (`colors.sockStripe`) over the top `stripeSpan`. */
  socks: {
    on: boolean;
    /** Sock height as a fraction of the shin (0.2–1.4; 1.1 = just over the knee). */
    height: number;
    /** Contrast bands at the sock top (0 = plain, 1 = one band, n = hoops). */
    stripes: number;
    /** How much of the shin (from the sock top) the bands cover (0.05–1.4). */
    stripeSpan: number;
  };
  /** `style`/`height`/`cleats` apply to shoes only; `size` scales either. */
  feet: { on: boolean; kind: FootwearKind; style: ShoeStyle; size: number; height: number; cleats: number };
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
  /** Collar / cuff trim. */
  trim: string;
  socks: string;
  sockStripe: string;
  /** Footwear sole; null = the same as `feet`. */
  sole: string | null;
  /** Bead-eye glint. */
  eyeHighlight: string;
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
  return { kind: 'none', radius: 7, cup: 'sides', color: '#161616', cupL: null, cupR: null, handScale: 1 };
}

type LockKnob = 'lockShape' | 'chunk' | 'spike' | 'swoop' | 'fringe' | 'seed' | 'crown' | 'layers' | 'raggedness' | 'flare'
  | 'notched' | 'crownSize' | 'backWidth' | 'tipWidth' | 'preset' | 'spikiness' | 'smooth' | 'mirror' | 'tilt' | 'windowScale' | 'capturedFringe';

/** Library defaults of the lock-style + captured hair knobs (none are emitted at these values). */
function lockDefaults(): Pick<HairSpec, LockKnob> {
  return {
    lockShape: 'ribbon', chunk: 1, spike: 1, swoop: 1, fringe: 1, seed: 1, crown: 'spiky', layers: 3, raggedness: 1, flare: 1,
    notched: true, crownSize: 1, backWidth: 1, tipWidth: 0.4,
    preset: 'tsubasa', spikiness: 1, smooth: 0, mirror: false, tilt: 0, windowScale: 1, capturedFringe: 1,
  };
}

/** Defaults filled into each `clothing.top.print` item that omits a field. */
export const PRINT_DEFAULT: PrintSpec = { text: '10', where: 'chest', size: 0.6, x: 0, z: 0, color: '#1a1a1a', font: 'bold' };

export const DEFAULT_SPEC: CharacterSpec = {
  body: { height: 60, headsTall: 7, build: 'average', sex: 'neutral', age: 25, weight: 0.5, muscle: 0, bust: 0, belly: 0, proportions: 'realistic', headScale: null, headSink: 0, mittens: false },
  pose: standingPose(),
  face: {
    shape: 'oval', lids: 'almond', gaze: 'center', nose: 'straight', expression: 'slightSmile', lipShape: 'natural', ears: 'detailed', brows: 'natural', layout: { eyeSpread: null, eyeHeight: null }, eyeSize: 1, mouth: true,
    eyeStyle: 'iris', eyeAspect: 1.06, highlight: 1, browThickness: 1, browWidth: 1, jaw: 1, chin: 1, cheek: 1,
  },
  hair: { style: 'short', length: 'mid', volume: 1, ...lockDefaults() },
  clothing: {
    top: { on: true, sleeve: 'short', length: 'shirt', trim: { collar: false, cuffs: false }, print: [] },
    pants: { on: true, leg: 'slim', rise: 'mid', length: 'full', hem: 0.9 },
    socks: { on: false, height: 1.1, stripes: 1, stripeSpan: 0.34 },
    feet: { on: true, kind: 'shoes', style: 'fitted', size: 1, height: 1, cleats: 0 },
  },
  colors: {
    skin: '#c68642', eyes: '#f7f6f2', iris: '#5b3a21', pupil: '#161616', lips: '#a85b4b',
    brows: '#2a1d14', hair: '#2a1d14', top: '#2f6f8f', pants: '#2c3144', feet: '#202024', base: '#4a4a4a', ball: '#f7f7f7',
    trim: '#1f5fc8', socks: '#f4f4f4', sockStripe: '#1f5fc8', sole: null, eyeHighlight: '#ffffff',
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
  // Every patch SPREADS over the default sub-objects (never replaces them
  // wholesale), so a field added to the spec later defaults in every preset.
  { id: 'adultF', label: 'Adult woman', description: 'Long hair, short-sleeve dress', patch: withSpec(s => {
    s.body = { ...s.body, height: 64, headsTall: 7.5, sex: 'female', bust: 0.5 };
    s.face = { ...s.face, shape: 'oval', lipShape: 'full', lids: 'almond', expression: 'slightSmile' };
    s.hair = { ...s.hair, style: 'long', length: 'long', volume: 1.1 };
    s.clothing.top = { ...s.clothing.top, sleeve: 'short', length: 'dress' };
    s.clothing.pants = { ...s.clothing.pants, on: false };
    s.colors = { ...s.colors, top: '#a8466a', hair: '#3a2417' };
  }) },
  { id: 'adultM', label: 'Adult man', description: 'Short hair, tee and slim pants', patch: withSpec(s => {
    s.body = { ...s.body, height: 66, headsTall: 7.5, sex: 'male', build: 'average', muscle: 0.35 };
    s.face = { ...s.face, shape: 'square', nose: 'straight', brows: 'flat', expression: 'neutral' };
    s.hair = { ...s.hair, style: 'short', length: 'short', volume: 0.8 };
    s.colors = { ...s.colors, top: '#356a4a', pants: '#33374a' };
  }) },
  { id: 'child', label: 'Child', description: 'Seven years old, big grin', patch: withSpec(s => {
    s.body = { ...s.body, height: 38, headsTall: 5, age: 7, build: 'slim' };
    s.face = { ...s.face, shape: 'round', nose: 'button', expression: 'smile', lids: 'none' };
    s.hair = { ...s.hair, style: 'short', length: 'short', volume: 1 };
    s.colors = { ...s.colors, top: '#e0a93b', pants: '#3b6ea0' };
  }) },
  { id: 'chibi', label: 'Chibi', description: 'Big head, tiny body, bob cut', patch: withSpec(s => {
    s.body = { ...s.body, height: 36, headsTall: 3.2, build: 'average' };
    s.face = { ...s.face, shape: 'round', nose: 'button', expression: 'bigSmile', lids: 'none' };
    s.hair = { ...s.hair, style: 'bob', length: 'mid', volume: 1.2 };
    s.colors = { ...s.colors, top: '#d65a7a' };
  }) },
  { id: 'athlete', label: 'Athlete', description: 'Toned, ponytail, running kit', patch: withSpec(s => {
    s.body = { ...s.body, height: 66, headsTall: 7.5, build: 'average', muscle: 0.6 };
    s.pose = POSE_PRESETS.contrapposto();
    s.face = { ...s.face, expression: 'slightSmile' };
    s.hair = { ...s.hair, style: 'ponytail', length: 'long', volume: 0.9 };
    s.clothing.top = { ...s.clothing.top, sleeve: 'none' };
    s.clothing.pants = { ...s.clothing.pants, length: 'briefs' };
    s.colors = { ...s.colors, top: '#c43d3d', pants: '#1f2330' };
  }) },
  { id: 'dancer', label: 'Dancer', description: 'Slim, arms raised, hair in a bun', patch: withSpec(s => {
    s.body = { ...s.body, height: 70, headsTall: 8, build: 'slim', sex: 'female', bust: 0.35 };
    s.pose = POSE_PRESETS.armsUp();
    s.face = { ...s.face, lipShape: 'full', expression: 'slightSmile' };
    s.hair = { ...s.hair, style: 'bun', length: 'mid', volume: 1 };
    s.clothing.top = { ...s.clothing.top, sleeve: 'none' };
    s.clothing.pants = { ...s.clothing.pants, rise: 'high', length: 'briefs' };
    s.colors = { ...s.colors, top: '#c45c93', pants: '#c45c93' };
  }) },
  { id: 'toddler', label: 'Toddler', description: 'Three years old, waving hello', patch: withSpec(s => {
    s.body = { ...s.body, height: 30, headsTall: 4, age: 3, build: 'average', weight: 0.6 };
    s.pose = POSE_PRESETS.waving();
    s.face = { ...s.face, shape: 'round', nose: 'button', expression: 'bigSmile', lids: 'none', brows: 'rounded' };
    s.hair = { ...s.hair, style: 'short', length: 'short', volume: 1.1 };
    s.clothing.pants = { ...s.clothing.pants, rise: 'high' };
    s.colors = { ...s.colors, skin: '#f1c9a8', hair: '#c9923f', brows: '#a8782f', iris: '#3d6e9e', top: '#f3c94b', pants: '#4f8fcf' };
  }) },
  { id: 'teen', label: 'Teenager', description: 'Lanky, bangs, hoodie-blue top', patch: withSpec(s => {
    s.body = { ...s.body, height: 58, headsTall: 6.75, age: 15, build: 'slim' };
    s.pose = POSE_PRESETS.contrapposto();
    s.face = { ...s.face, shape: 'oval', expression: 'neutral', gaze: 'left' };
    s.hair = { ...s.hair, style: 'bangs', length: 'mid', volume: 1 };
    s.clothing.top = { ...s.clothing.top, sleeve: 'long' };
    s.colors = { ...s.colors, skin: '#dba37a', hair: '#1c1410', top: '#3d5fa8', pants: '#26262c', feet: '#e9e9e9' };
  }) },
  { id: 'grandpa', label: 'Grandpa', description: 'Bald, bushy brows, cardigan', patch: withSpec(s => {
    s.body = { ...s.body, height: 62, headsTall: 7, age: 76, build: 'average', weight: 0.6, belly: 0.6, sex: 'male' };
    s.face = { ...s.face, shape: 'long', nose: 'bulbous', brows: 'bushy', lids: 'upper', expression: 'slightSmile', ears: 'round' };
    s.hair = { ...s.hair, style: 'bald', length: 'short' };
    s.clothing.top = { ...s.clothing.top, sleeve: 'long' };
    s.clothing.pants = { ...s.clothing.pants, rise: 'high' };
    s.colors = { ...s.colors, skin: '#e8b48c', brows: '#d6d3cc', top: '#7a5a3c', pants: '#4b4b52', feet: '#3a2a20' };
  }) },
  { id: 'grandma', label: 'Grandma', description: 'Silver bun, long-sleeve dress', patch: withSpec(s => {
    s.body = { ...s.body, height: 58, headsTall: 6.75, age: 72, sex: 'female', bust: 0.45, weight: 0.6, belly: 0.3 };
    s.face = { ...s.face, shape: 'round', nose: 'snub', lids: 'upper', brows: 'natural', expression: 'smile' };
    s.hair = { ...s.hair, style: 'bun', length: 'mid', volume: 1.1 };
    s.clothing.top = { ...s.clothing.top, sleeve: 'long', length: 'dress' };
    s.clothing.pants = { ...s.clothing.pants, on: false };
    s.colors = { ...s.colors, skin: '#cf9163', hair: '#c8c6c2', brows: '#a9a6a0', top: '#6b4f8a', feet: '#2b2b30' };
  }) },
  { id: 'bodybuilder', label: 'Bodybuilder', description: 'Stocky, maximum muscle', patch: withSpec(s => {
    s.body = { ...s.body, height: 68, headsTall: 7.5, build: 'stocky', sex: 'male', muscle: 1, weight: 0.6 };
    s.pose = POSE_PRESETS.armsUp();
    s.face = { ...s.face, shape: 'square', brows: 'angled', expression: 'bigSmile' };
    s.hair = { ...s.hair, style: 'short', length: 'short', volume: 0.7 };
    s.clothing.top = { ...s.clothing.top, sleeve: 'none' };
    s.clothing.pants = { ...s.clothing.pants, length: 'briefs' };
    s.colors = { ...s.colors, skin: '#945634', hair: '#161210', brows: '#161210', top: '#f0f0ea', pants: '#1f3d8a' };
  }) },
  { id: 'hiker', label: 'Hiker', description: 'Cargo pants and boots, mid-stride', patch: withSpec(s => {
    s.body = { ...s.body, height: 65, headsTall: 7.5, build: 'average', muscle: 0.3 };
    s.pose = POSE_PRESETS.walking();
    s.face = { ...s.face, nose: 'roman', expression: 'smile' };
    s.hair = { ...s.hair, style: 'ponytail', length: 'mid', volume: 1 };
    s.clothing.top = { ...s.clothing.top, sleeve: 'long' };
    s.clothing.pants = { ...s.clothing.pants, leg: 'cargo' };
    s.clothing.feet = { ...s.clothing.feet, kind: 'boots' };
    s.colors = { ...s.colors, skin: '#bd7c4f', hair: '#5a3a22', top: '#d0672f', pants: '#6b6a4a', feet: '#5a3b26' };
  }) },
  { id: 'punk', label: 'Punk rocker', description: 'Spiked magenta hair, black boots', patch: withSpec(s => {
    s.body = { ...s.body, height: 64, headsTall: 7.5, build: 'slim' };
    s.pose = POSE_PRESETS.contrapposto();
    s.face = { ...s.face, shape: 'diamond', brows: 'angled', lids: 'tapered', expression: 'slightFrown', ears: 'pointed' };
    s.hair = { ...s.hair, style: 'spiked', length: 'mid', volume: 1.3 };
    s.clothing.top = { ...s.clothing.top, sleeve: 'none' };
    s.clothing.feet = { ...s.clothing.feet, kind: 'boots' };
    s.colors = { ...s.colors, skin: '#f5d8c6', hair: '#d6247a', brows: '#2a1d14', lips: '#5a2840', top: '#18181b', pants: '#2b2f3a', feet: '#101012' };
  }) },
  { id: 'elf', label: 'Elf ranger', description: 'Pointed ears, long hair, forest green', patch: withSpec(s => {
    s.body = { ...s.body, height: 72, headsTall: 8, build: 'slim', muscle: 0.25 };
    s.face = { ...s.face, shape: 'heart', ears: 'pointed', brows: 'arched', lids: 'almond', nose: 'pointed', expression: 'neutral' };
    s.hair = { ...s.hair, style: 'long', length: 'long', volume: 1 };
    s.clothing.top = { ...s.clothing.top, sleeve: 'long', trim: { collar: true, cuffs: true } };
    s.clothing.feet = { ...s.clothing.feet, kind: 'boots' };
    s.colors = { ...s.colors, skin: '#f1c9a8', hair: '#e8d9a8', brows: '#c4ae74', iris: '#3f7a4a', top: '#2f5a32', trim: '#b8954a', pants: '#4b3a26', feet: '#3b2a1a' };
  }) },
  { id: 'hero', label: 'Superhero', description: 'Heroic build, chest emblem, red boots', patch: withSpec(s => {
    s.body = { ...s.body, height: 72, headsTall: 8, build: 'average', muscle: 0.8 };
    s.pose = POSE_PRESETS.contrapposto();
    s.face = { ...s.face, shape: 'square', brows: 'straight', expression: 'slightSmile' };
    s.hair = { ...s.hair, style: 'short', length: 'short', volume: 0.9 };
    s.clothing.top = { ...s.clothing.top, sleeve: 'long', print: [{ ...PRINT_DEFAULT, text: 'H', size: 0.8, z: 0.15, color: '#f2c230' }] };
    s.clothing.pants = { ...s.clothing.pants, rise: 'high' };
    s.clothing.feet = { ...s.clothing.feet, kind: 'boots' };
    s.colors = { ...s.colors, skin: '#aa6b3d', hair: '#161210', top: '#2a4fb0', pants: '#2a4fb0', feet: '#c42e2e' };
  }) },
  { id: 'office', label: 'Office worker', description: 'Long sleeves, navy slacks', patch: withSpec(s => {
    s.body = { ...s.body, height: 64, headsTall: 7.5, sex: 'female', bust: 0.4, weight: 0.45 };
    s.face = { ...s.face, shape: 'oval', brows: 'arched', expression: 'slightSmile' };
    s.hair = { ...s.hair, style: 'bob', length: 'mid', volume: 1 };
    s.clothing.top = { ...s.clothing.top, sleeve: 'long', trim: { collar: true, cuffs: false } };
    s.clothing.pants = { ...s.clothing.pants, rise: 'high' };
    s.colors = { ...s.colors, skin: '#7c472b', hair: '#1a1210', top: '#e9e4dc', trim: '#1f2a44', pants: '#1f2a44', feet: '#151518' };
  }) },
  { id: 'afro', label: 'Afro & sneakers', description: 'Big afro, relaxed stance', patch: withSpec(s => {
    s.body = { ...s.body, height: 66, headsTall: 7.5, sex: 'male', muscle: 0.3 };
    s.pose = POSE_PRESETS.contrapposto();
    s.face = { ...s.face, shape: 'oval', nose: 'broad', lipShape: 'full', expression: 'smile' };
    s.hair = { ...s.hair, style: 'afro', length: 'mid', volume: 1.2 };
    s.colors = { ...s.colors, skin: '#4a281b', hair: '#120d0a', brows: '#120d0a', lips: '#5a3028', top: '#e2b23a', pants: '#3a4a6a', feet: '#f0f0f0' };
  }) },
  { id: 'braids', label: 'Long braids', description: 'Braided hair, waving hello', patch: withSpec(s => {
    s.body = { ...s.body, height: 64, headsTall: 7.5, sex: 'female', bust: 0.45 };
    s.pose = POSE_PRESETS.waving();
    s.face = { ...s.face, shape: 'heart', lipShape: 'full', expression: 'bigSmile', brows: 'rounded' };
    s.hair = { ...s.hair, style: 'braids', length: 'long', volume: 1 };
    s.colors = { ...s.colors, skin: '#643622', hair: '#1a1210', brows: '#1a1210', lips: '#6a3a30', top: '#2f9b8f', pants: '#e8e1d2', feet: '#c9a24a' };
  }) },
  { id: 'animeHero', label: 'Anime hero', description: 'Chibi body, flowing anime locks', patch: withSpec(s => {
    applyStyle(s, 'chibi');
    s.body = { ...s.body, height: 40 };
    s.pose = POSE_PRESETS.contrapposto();
    s.face = { ...s.face, expression: 'bigSmile', brows: 'angled' };
    s.hair = { ...s.hair, style: 'anime', length: 'mid', spike: 1.4, swoop: 1.6, seed: 7 };
    s.clothing.top = { ...s.clothing.top, trim: { collar: true, cuffs: true } };
    s.clothing.pants = { ...s.clothing.pants, length: 'shorts' };
    s.clothing.feet = { ...s.clothing.feet, style: 'toy', size: 1.2 };
    s.colors = { ...s.colors, skin: '#f1c9a8', hair: '#f0a030', brows: '#a8681c', iris: '#2f6fb0', top: '#e8452c', trim: '#1c1c22', pants: '#1c1c22', feet: '#f4f4f4' };
  }) },
  { id: 'vinylToy', label: 'Vinyl toy', description: 'Funko-style head, shaggy mop, toy shoes', patch: withSpec(s => {
    applyStyle(s, 'funko');
    s.body = { ...s.body, height: 60 };
    s.face = { ...s.face, browThickness: 2.4 };
    s.hair = { ...s.hair, style: 'shag', seed: 4, flare: 1.1 };
    s.clothing.feet = { ...s.clothing.feet, style: 'toy', size: 1.25 };
    s.colors = { ...s.colors, skin: '#e8b48c', hair: '#101012', brows: '#101012', top: '#7a3fd6', pants: '#26262c', feet: '#f4f4f4' };
  }) },
  { id: 'soccerStar', label: 'Soccer star', description: 'Funko footballer holding a ball', patch: withSpec(s => {
    // The Captain Tsubasa Funko spec from public/ai/figure.md.
    applyStyle(s, 'funko');
    s.body = { ...s.body, height: 100, sex: 'male', headScale: { x: 2.3, y: 1.8, z: 2.1 }, headSink: 0.42 };
    s.pose = { ...s.pose, legL: { ...s.pose.legL, raiseSide: 8, twist: 26 }, legR: { ...s.pose.legR, raiseSide: 8, twist: 26 },
      hold: { ...s.pose.hold, kind: 'ball', radius: 10.5, cupR: 'under', handScale: 1.3, color: '#111111' } };
    s.face = { ...s.face, nose: 'straight', eyeSize: 1.65, browThickness: 3, browWidth: 1.5, jaw: 1.4, cheek: 1.1 };
    s.hair = { ...s.hair, style: 'shag', seed: 11, spike: 0.55, flare: 0.8, backWidth: 0.7 };
    s.clothing.top = { ...s.clothing.top, trim: { collar: true, cuffs: true }, print: [
      { ...PRINT_DEFAULT, text: 'N', x: 0.55, z: 0.24, size: 0.55, color: '#1f5fc8' },
      { ...PRINT_DEFAULT, text: '10', where: 'back', z: 0.08, size: 0.95, color: '#1f5fc8' },
    ] };
    s.clothing.pants = { ...s.clothing.pants, length: 'shorts', hem: 0.94 };
    s.clothing.socks = { ...s.clothing.socks, on: true, height: 1.12 };
    s.clothing.feet = { ...s.clothing.feet, style: 'toy', size: 1.3, cleats: 6 };
    s.colors = { ...s.colors, skin: '#f0c9a2', brows: '#0e0e10', hair: '#101012', top: '#f6f6f6', trim: '#1f5fc8', pants: '#1f5fc8',
      socks: '#f6f6f6', sockStripe: '#1f5fc8', feet: '#f4f4f4', sole: '#e6e6e6', base: '#8a8d92' };
  }) },
  { id: 'mannequin', label: 'Mannequin', description: 'Bare T-posed base to build on', patch: withSpec(s => {
    s.pose = POSE_PRESETS.tpose();
    s.face = { ...s.face, expression: 'neutral' };
    s.hair = { ...s.hair, style: 'bald' };
    s.clothing.top.on = false;
    s.clothing.pants.on = false;
    s.clothing.feet.on = false;
    s.colors = { ...s.colors, skin: '#d9d4cc', lips: '#c9b8aa', brows: '#a39a8f' };
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
/** Funko toys have no visible neck: the style sinks the head onto the shoulders. */
const FUNKO_HEAD_SINK = 0.4;

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
    // Glossy bead eyes with a glint, and the head sunk onto the shoulders.
    spec.face = { ...spec.face, shape: 'round', lids: 'none', nose: 'button', expression: 'neutral', brows: 'arched', ears: 'round', eyeSize: FUNKO_EYE_SIZE, mouth: false, eyeStyle: 'bead' };
    spec.colors.eyes = BEAD; spec.colors.iris = BEAD; spec.colors.pupil = BEAD;
    spec.body.headSink = FUNKO_HEAD_SINK;
    spec.body.mittens = true;
    return;
  }
  if (spec.body.headSink === FUNKO_HEAD_SINK) spec.body.headSink = 0;
  spec.body.mittens = false;
  if (wasBead) { spec.colors.eyes = D.colors.eyes; spec.colors.iris = D.colors.iris; spec.colors.pupil = D.colors.pupil; }
  if (style === 'chibi') {
    spec.face = { ...spec.face, shape: 'round', lids: 'none', nose: 'button', expression: 'smile', ears: 'round', eyeSize: CHIBI_EYE_SIZE, mouth: true, eyeStyle: 'iris' };
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
  // Arrays replace wholesale; fill each print item's omitted fields from the
  // defaults (non-object items are left for validateSpec to report).
  const print = (base.clothing?.top as { print?: unknown } | undefined)?.print;
  if (Array.isArray(print)) {
    base.clothing.top.print = print.map(item => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
      const filled = { ...PRINT_DEFAULT } as Record<string, unknown>;
      merge(filled, item);
      return filled;
    }) as PrintSpec[];
  }
  // Detach from the caller's objects (merge assigns new sub-objects by reference).
  return cloneSpec(base);
}

// ---- validation + JSON schema -----------------------------------------------

type FieldSpec =
  | { t: 'enum'; values: readonly string[]; nullable?: boolean; d: string }
  | { t: 'num'; min?: number; max?: number; nullable?: boolean; d: string }
  | { t: 'bool'; d: string }
  | { t: 'color'; nullable?: boolean; d: string }
  | { t: 'str'; minLen?: number; maxLen?: number; printable?: boolean; d: string }
  | { t: 'headScale'; d: string }
  | { t: 'list'; item: FieldSpec; max: number; d: string }
  | { t: 'obj'; fields: Record<string, FieldSpec>; d: string };

const e = (values: readonly string[], d: string, nullable?: boolean): FieldSpec => ({ t: 'enum', values, nullable, d });
const n = (d: string, min?: number, max?: number, nullable?: boolean): FieldSpec => ({ t: 'num', min, max, nullable, d });
const c = (d: string, nullable?: boolean): FieldSpec => ({ t: 'color', nullable, d });
const b = (d: string): FieldSpec => ({ t: 'bool', d });
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
    headSink: n('Lower the head onto the shoulders by this × the neck length, 0–1.5 (Funko "no neck" ≈ 0.4; 0 = a normal neck).', 0, 1.5),
    mittens: b('Fingerless vinyl-toy mitten hands.'),
  }, 'Body proportions.'),
  pose: o({
    preset: { t: 'str', maxLen: 32, d: 'UI label of the last pose preset (ignored by codegen).' },
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
      cupL: e(HOLD_CUPS, 'Left-hand cup override (null = cup).', true),
      cupR: e(HOLD_CUPS, "Right-hand cup override (null = cup) — e.g. cupR 'under' + cupL 'sides'.", true),
      handScale: n('Hand size the hold assumes, 0.5–2.5 (big vinyl mitten hands ≈ 1.3).', 0.5, 2.5),
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
    mouth: b('Build the lips (false = mouthless vinyl-toy face).'),
    eyeStyle: e(EYE_STYLES, "'iris' = white eye + iris + pupil; 'bead' = glossy vinyl-toy bead with a white glint (paints colors.eyes + colors.eyeHighlight; ignores lids/gaze/iris/pupil)."),
    eyeAspect: n('bead only: height ÷ width 0.5–2 (1.06).', 0.5, 2),
    highlight: n('bead only: glint size, 0 = none, 0.2–3 (1).', 0, 3),
    browThickness: n('Brow weight 0.1–5 (1; bold toy brows ≈ 3).', 0.1, 5),
    browWidth: n('Brow span 0.3–2 (1).', 0.3, 2),
    jaw: n('Jaw width × the face shape 0.5–1.6 (1; a Funko\'s wide lower face ≈ 1.4).', 0.5, 1.6),
    chin: n('Chin × the face shape 0.5–1.6 (1).', 0.5, 1.6),
    cheek: n('Cheek fullness × the face shape 0.3–1.8 (1).', 0.3, 1.8),
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
    crown: e(HAIR_CROWNS, "shag only: 'spiky' = 7 big needle-pointed spikes spread round the back + sides of the crown, arching up past the dome (spike = lift, crownSize = size); 'tousled' = 7 small random crown locks."),
    layers: n('shag only: overlapping lock layers over the sides + back, integer 1–3.', 1, 3),
    raggedness: n('shag only: jitter of lock length / lean / hem 0–2.', 0, 2),
    flare: n('shag only: mop mass above the ears 0–3.', 0, 3),
    notched: b('shag only: notched (toothed) fringe hairline (default true).'),
    crownSize: n('shag only: crown-spike size 0.3–2.5 (1).', 0.3, 2.5),
    backWidth: n('shag only: how far the side/back layers stand off the skull 0.3–1.6 (1; narrower back silhouette < 1).', 0.3, 1.6),
    tipWidth: n('shag only: side/back lock tip width × root 0–0.8 (0.4).', 0, 0.8),
    preset: e(HAIR_PRESETS, 'captured only: which captured hairdo.'),
    spikiness: n('captured only: spike sharpness 0–3 (1).', 0, 3),
    smooth: n('captured only: smooth the captured relief 0–1 (0).', 0, 1),
    mirror: b('captured only: mirror the hairdo left↔right.'),
    tilt: n('captured only: tilt the hairdo forward(+)/back (deg) −40–40.', -40, 40),
    windowScale: n('captured only: face-window size 0.5–2 (1).', 0.5, 2),
    capturedFringe: n('captured only: fringe amount 0.3–2 (1). (`fringe` is the lock styles\' knob.)', 0.3, 2),
  }, 'Hair (captured also reads volume and length).'),
  clothing: o({
    top: o({
      on: b('Wear a top.'), sleeve: e(SLEEVES, 'Sleeves.'), length: e(TOP_LENGTHS, "'dress' drops the hem to mid-thigh."),
      trim: o({ collar: b('Contrast collar band (colors.trim).'), cuffs: b('Contrast sleeve cuffs (colors.trim; needs sleeves).') }, 'Collar / cuff trim.'),
      print: { t: 'list', max: 6, d: "Lettering / numbers on the top, e.g. [{ text: 'N', where: 'chest', x: 0.55 }, { text: '10', where: 'back', size: 1 }]. Each paints its own colour.", item: o({
        text: { t: 'str', minLen: 1, maxLen: 12, printable: true, d: 'The letters / digits (1–12 characters: letters, numbers, punctuation, symbols and spaces; not blank).' },
        where: e(PRINT_PLACES, "'chest' (front) or 'back'."),
        size: n('Lettering height in chest half-widths 0.1–2.5 (0.6; a big back number ≈ 1).', 0.1, 2.5),
        x: n("Sideways offset in chest half-widths, + = the figure's left (−1.5–1.5).", -1.5, 1.5),
        z: n('Vertical offset from the chest line in chest half-widths, + = up (−2–2).', -2, 2),
        color: c('Print colour.'),
        font: e(PRINT_FONTS, 'Font (bold).'),
      }, 'One print.') },
    }, 'Top.'),
    pants: o({
      on: b('Wear pants.'), leg: e(PANTS_LEGS, 'Leg cut.'), rise: e(PANTS_RISES, 'Waist rise.'),
      length: e(PANTS_LENGTHS, "'full' trousers, 'shorts' knee-length (cut at hem), 'briefs' no legs."),
      hem: n("shorts only: leg cut as a fraction of the hip→knee bone 0.2–1.2 (0.9 = just above the knee).", 0.2, 1.2),
    }, 'Pants.'),
    socks: o({
      on: b('Wear socks up the shin (colors.socks).'),
      height: n('Sock height as a fraction of the shin 0.2–1.4 (1.1 = just over the knee).', 0.2, 1.4),
      stripes: n('Contrast bands at the sock top, integer 0–12 (0 = plain, 1 = one band, 3+ = hoops; colors.sockStripe).', 0, 12),
      stripeSpan: n('How much of the shin, from the sock top, the bands cover 0.05–1.4 (0.34).', 0.05, 1.4),
    }, 'Socks.'),
    feet: o({
      on: b('Wear footwear.'), kind: e(FOOTWEAR_KINDS, 'Footwear.'),
      style: e(SHOE_STYLES, "shoes only: 'fitted' hugs the foot; 'toy' = chunky vinyl-toy sneaker."),
      size: n('Footprint scale 0.5–2 (1; toy shoes ≈ 1.3).', 0.5, 2),
      height: n('toy shoes only: upper height 0.4–2.5 (1).', 0.4, 2.5),
      cleats: n('toy shoes only: studs under the sole, 0 = none or an integer 2–12.', 0, 12),
    }, 'Footwear.'),
  }, 'Clothing.'),
  colors: o({
    skin: c('Skin.'), eyes: c('Eye whites (the whole bead for bead eyes).'), iris: c('Iris.'), pupil: c('Pupil.'), lips: c('Lips.'),
    brows: c('Brows.'), hair: c('Hair.'), top: c('Top.'), pants: c('Pants.'), feet: c('Footwear.'),
    base: c('Stand.'), ball: c('Held ball base colour.'),
    trim: c('Collar / cuff trim.'), socks: c('Socks.'), sockStripe: c('Sock bands.'),
    sole: c('Footwear sole (null = same as feet).', true), eyeHighlight: c('Bead-eye glint.'),
  }, "Paint colours, '#rrggbb'."),
  base: b('Include a round stand.'),
  place: b("Finish with F.place (bottom at z = 0, facing +X). Default true; v1 specs migrate to false."),
};

/** One leaf of the spec field tree: its dotted path, kind, and (enums) the
 *  allowed values. Lists and head scales count as single leaves. */
export interface SpecLeaf { path: string; kind: FieldSpec['t']; values?: readonly string[]; nullable?: boolean }

/** Every leaf field of the spec, walked from SPEC_FIELDS — the one tree that
 *  also drives `validateSpec` and `specJsonSchema`. Consumers that must cover
 *  every field (the randomizer's drift test) enumerate this instead of keeping
 *  their own list, so a field added to SPEC_FIELDS reaches them automatically. */
export function specLeaves(): SpecLeaf[] {
  const out: SpecLeaf[] = [];
  const walk = (f: FieldSpec, path: string): void => {
    if (f.t === 'obj') { for (const [k, sub] of Object.entries(f.fields)) walk(sub, path ? `${path}.${k}` : k); return; }
    out.push({
      path, kind: f.t,
      values: f.t === 'enum' ? f.values : undefined,
      nullable: 'nullable' in f ? f.nullable : undefined,
    });
  };
  walk({ t: 'obj', fields: SPEC_FIELDS, d: '' }, '');
  return out;
}

const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
/** Lettering allow-list: Unicode letters / numbers / punctuation / symbols and
 *  plain spaces only — no control, format or line/paragraph-separator
 *  characters (U+2028/U+2029 are JS line terminators). */
const PRINTABLE_RE = /^[\p{L}\p{N}\p{P}\p{S} ]+$/u;

/** True when `s` is printable garment lettering (see PRINTABLE_RE) and not blank. */
export function isPrintableText(s: string): boolean {
  return PRINTABLE_RE.test(s) && s.trim().length >= 1;
}

/** Validate a (normalized) spec against the field tree: enums, numeric ranges
 *  (the figure library's own bounds), colours, booleans and unknown keys.
 *  Returns every problem as a path-prefixed message (empty = valid). */
export function validateSpec(spec: unknown): string[] {
  const errs: string[] = [];
  const walk = (v: unknown, f: FieldSpec, path: string): void => {
    switch (f.t) {
      case 'enum':
        if (v === null && f.nullable) return;
        if (typeof v !== 'string' || !f.values.includes(v)) errs.push(`${path} must be one of ${f.values.map(x => `'${x}'`).join(' | ')}${f.nullable ? ' or null' : ''} (got ${JSON.stringify(v)})`);
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
        if (v === null && f.nullable) return;
        if (typeof v !== 'string' || !HEX_RE.test(v)) errs.push(`${path} must be a hex colour like '#c68642'${f.nullable ? ' or null' : ''} (got ${JSON.stringify(v)})`);
        return;
      case 'str':
        if (typeof v !== 'string') { errs.push(`${path} must be a string`); return; }
        if (f.printable && !isPrintableText(v)) {
          errs.push(`${path} must be letters, numbers, punctuation, symbols or spaces, with at least one non-space (got ${JSON.stringify(v)})`);
          return;
        }
        if (f.minLen !== undefined && v.length < f.minLen) errs.push(`${path} must have at least ${f.minLen} character(s)`);
        if (f.maxLen !== undefined && v.length > f.maxLen) errs.push(`${path} must have at most ${f.maxLen} characters (got ${v.length})`);
        return;
      case 'list':
        if (!Array.isArray(v)) { errs.push(`${path} must be an array`); return; }
        if (v.length > f.max) errs.push(`${path} must have at most ${f.max} items (got ${v.length})`);
        v.forEach((item, i) => walk(item, f.item, `${path}[${i}]`));
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
      case 'list': return { type: 'array', description: f.d, maxItems: f.max, items: conv(f.item) };
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
  // JSON.stringify leaves U+2028 / U+2029 raw, and JS treats both as line
  // terminators — a string field carrying one would end this `//` comment and
  // run the rest as code. Escape them (JSON.parse reads `\u2028` back exactly).
  const json = JSON.stringify(spec).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  return `// @character v${SPEC_VERSION} ${json}`;
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
