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
    s.hair = { style: 'long', length: 'long', volume: 1.1 };
    s.clothing.top = { on: true, sleeve: 'short', length: 'dress' };
    s.clothing.pants = { on: false, leg: 'slim', rise: 'mid', length: 'full' };
    s.colors = { ...s.colors, top: '#a8466a', hair: '#3a2417' };
  }) },
  { id: 'adultM', label: 'Adult man', patch: withSpec(s => {
    s.body = { ...s.body, height: 66, headsTall: 7.5, sex: 'male', build: 'average', muscle: 0.35 };
    s.face = { ...s.face, shape: 'square', nose: 'straight', brows: 'flat', expression: 'neutral' };
    s.hair = { style: 'short', length: 'short', volume: 0.8 };
    s.colors = { ...s.colors, top: '#356a4a', pants: '#33374a' };
  }) },
  { id: 'child', label: 'Child', patch: withSpec(s => {
    s.body = { ...s.body, height: 38, headsTall: 5, age: 7, build: 'slim' };
    s.face = { ...s.face, shape: 'round', nose: 'button', expression: 'smile', lids: 'none' };
    s.hair = { style: 'short', length: 'short', volume: 1 };
    s.colors = { ...s.colors, top: '#e0a93b', pants: '#3b6ea0' };
  }) },
  { id: 'chibi', label: 'Chibi', patch: withSpec(s => {
    s.body = { ...s.body, height: 36, headsTall: 3.2, build: 'average' };
    s.face = { ...s.face, shape: 'round', nose: 'button', expression: 'bigSmile', lids: 'none' };
    s.hair = { style: 'bob', length: 'mid', volume: 1.2 };
    s.colors = { ...s.colors, top: '#d65a7a' };
  }) },
  { id: 'athlete', label: 'Athlete', patch: withSpec(s => {
    s.body = { ...s.body, height: 66, headsTall: 7.5, build: 'average', muscle: 0.6 };
    s.pose = POSE_PRESETS.contrapposto();
    s.face = { ...s.face, expression: 'slightSmile' };
    s.hair = { style: 'ponytail', length: 'long', volume: 0.9 };
    s.clothing.top = { on: true, sleeve: 'none', length: 'shirt' };
    s.clothing.pants = { on: true, leg: 'slim', rise: 'mid', length: 'briefs' };
    s.colors = { ...s.colors, top: '#c43d3d', pants: '#1f2330' };
  }) },
  { id: 'dancer', label: 'Dancer', patch: withSpec(s => {
    s.body = { ...s.body, height: 70, headsTall: 8, build: 'slim', sex: 'female', bust: 0.35 };
    s.pose = POSE_PRESETS.armsUp();
    s.face = { ...s.face, lipShape: 'full', expression: 'slightSmile' };
    s.hair = { style: 'bun', length: 'mid', volume: 1 };
    s.clothing.top = { on: true, sleeve: 'none', length: 'shirt' };
    s.clothing.pants = { on: true, leg: 'slim', rise: 'high', length: 'briefs' };
    s.colors = { ...s.colors, top: '#c45c93', pants: '#c45c93' };
  }) },
];

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
