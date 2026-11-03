// The Character Creator's 🎲 Random: a seeded generator of coherent
// CharacterSpecs. Pure data, no DOM/engine, so it unit-tests in the vitest tier.
//
// Single-source rules — what to touch when the spec grows:
//  • Enum OPTIONS come from the exported lists in characterSpec.ts (BUILDS,
//    HAIR_STYLES, …) through `pickEnum`, which filters RANDOM_EXCLUDED_VALUES.
//    A value added to a list is therefore rolled automatically (at the default
//    weight) unless it is excluded here, and tests/unit/characterRandom.test.ts
//    asserts every non-excluded value actually comes up.
//  • FIELDS are enumerated from SPEC_FIELDS (`specLeaves()`). The same test
//    fails when a spec field is neither varied by `randomSpec` nor listed in
//    RANDOM_FIXED_FIELDS — so adding a field forces a decision here instead of
//    silently never being randomized.
//  • Builds are checked headlessly with `npm run bake:character-presets --
//    --random N` (manifold, one piece, every face feature visible).

import {
  type CharacterSpec,
  type PrintSpec,
  DEFAULT_SPEC,
  POSE_PRESETS,
  PRINT_DEFAULT,
  applyStyle,
  cloneSpec,
  BUILDS, SEXES, PROPORTIONS, FACE_SHAPES, LID_STYLES, GAZES, NOSE_TYPES, EXPRESSIONS,
  LIP_SHAPES, EAR_TYPES, BROW_SHAPES, HAIR_STYLES, HAIR_LENGTHS, LOCK_SHAPES, HAIR_CROWNS,
  HAIR_PRESETS, SLEEVES, TOP_LENGTHS, PANTS_LEGS, PANTS_RISES, PANTS_LENGTHS, FOOTWEAR_KINDS,
  HOLD_KINDS, HOLD_CUPS, SHOE_STYLES, PRINT_PLACES, PRINT_FONTS, LOCK_HAIR_STYLES,
} from './characterSpec';

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

/** Enum values a one-click roll never picks, by spec path. They stay
 *  selectable by hand in the panel; each is here because the figure builder
 *  currently renders it badly. */
export const RANDOM_EXCLUDED_VALUES: Readonly<Record<string, readonly string[]>> = {
  // Strands detach from the head → a multi-piece print (kemper/partwright#1066).
  'hair.style': ['locs', 'boxBraids'],
  // Hooded and tapered lids can swallow most of the pupil; closed hides the eyes.
  'face.lids': ['hooded', 'tapered', 'closed'],
  // An up/down gaze tucks the pupil under a lid; 'middle' is an alias of 'center'.
  'face.gaze': ['up', 'down', 'middle'],
  // Thin brows can sink under the brow ridge (0 paintable triangles).
  'face.brows': ['thin'],
  // Unappealing as a surprise default; still one click away.
  'face.expression': ['deepFrown'],
};

/** Spec fields (or whole sub-trees, by path prefix) a roll deliberately leaves
 *  at the default. Every other SPEC_FIELDS leaf must vary across rolls — the
 *  drift test enforces it, so a newly added field lands here or in randomSpec. */
export const RANDOM_FIXED_FIELDS: readonly string[] = [
  'base', 'place',                              // print-setup choices, not "who"
  'body.headScale',                             // null = the style's own head
  'pose.armL.twist', 'pose.armR.twist', 'pose.legL.twist', 'pose.legR.twist', // no named pose twists a joint
  'pose.hold.cupL', 'pose.hold.cupR',           // per-hand overrides: null = cup
  'face.layout',                                // null = the style's eye layout
  'face.eyeAspect', 'face.highlight',           // bead-eye fine tuning
  'face.chin',                                  // see the realistic-face note in randomSpec
  'hair.tipWidth', 'hair.tilt', 'hair.windowScale',
  'clothing.socks.stripeSpan',
  'colors.eyeHighlight', 'colors.ball', 'colors.base',
];

type Rng = () => number;

function roller(rng: Rng) {
  const unit = (): number => rng();
  const range = (lo: number, hi: number, step: number): number =>
    Number((lo + Math.round((unit() * (hi - lo)) / step) * step).toFixed(4));
  const int = (lo: number, hi: number): number => lo + Math.min(hi - lo, Math.floor(unit() * (hi - lo + 1)));
  const chance = (p: number): boolean => unit() < p;
  const pick = <T>(xs: readonly T[]): T => xs[Math.min(xs.length - 1, Math.floor(unit() * xs.length))];
  const weighted = <T>(pairs: readonly (readonly [T, number])[]): T => {
    const total = pairs.reduce((a, [, w]) => a + w, 0);
    let r = unit() * total;
    for (const [v, w] of pairs) { if ((r -= w) < 0) return v; }
    return pairs[pairs.length - 1][0];
  };
  /** Pick from an exported enum list, skipping RANDOM_EXCLUDED_VALUES[path].
   *  `weights` tunes known values; any value NOT named (e.g. one added to the
   *  list later) gets `otherWeight`, so new options are rolled automatically.
   *  `only` narrows to a subset (e.g. kid-friendly noses) for this roll. */
  const pickEnum = <T extends string>(
    path: string, values: readonly T[],
    weights: Partial<Record<T, number>> = {}, otherWeight = 1, only?: readonly T[],
  ): T => {
    const excluded = RANDOM_EXCLUDED_VALUES[path] ?? [];
    const pool = values.filter(v => !excluded.includes(v) && (!only || only.includes(v)));
    return weighted(pool.map(v => [v, weights[v] ?? otherWeight] as const));
  };
  return { range, int, chance, pick, weighted, pickEnum };
}

// Palettes the randomizer draws from. Skin matches the figure API's named
// tones (sdfFigure SKIN_TONES); hair/iris are natural ranges plus a few fun
// dyes; clothing is a curated set that reads well printed or painted.
const SKIN_PALETTE = ['#f5d8c6', '#f1c9a8', '#e8b48c', '#dba37a', '#cf9163', '#bd7c4f', '#aa6b3d', '#945634', '#7c472b', '#643622', '#4a281b', '#34201a'];
const HAIR_NATURAL = ['#120d0a', '#1c1410', '#2a1d14', '#3a2417', '#5a3a22', '#7a4a26', '#a0522d', '#c9923f', '#e8d9a8'];
const HAIR_GREY = ['#c8c6c2', '#a9a6a0', '#e6e4df', '#8a8782'];
const HAIR_DYED = ['#d6247a', '#2f7fd6', '#7a3fd6', '#2fae6a', '#e25a2a', '#f0a030'];
const IRIS_PALETTE = ['#5b3a21', '#3d2614', '#3d6e9e', '#3f7a4a', '#6b7a3a', '#7a7f86', '#8a5a2a'];
const LIP_PALETTE = ['#a85b4b', '#b46a5e', '#8a4a40', '#c47a70', '#6a3a30', '#9a4a5a'];
const CLOTH_PALETTE = [
  '#2f6f8f', '#356a4a', '#a8466a', '#c43d3d', '#e0a93b', '#3b6ea0', '#6b4f8a', '#d0672f',
  '#2f9b8f', '#18181b', '#e9e4dc', '#7a5a3c', '#1f2a44', '#c45c93', '#6b6a4a', '#f3c94b',
];
const PANTS_PALETTE = ['#2c3144', '#1f2330', '#33374a', '#4b4b52', '#6b6a4a', '#3a4a6a', '#26262c', '#4b3a26', '#e8e1d2', '#1f3d8a'];
const FEET_PALETTE = ['#202024', '#151518', '#3a2a20', '#5a3b26', '#e9e9e9', '#c42e2e', '#2b2b30', '#f4f4f4'];
const SOLE_PALETTE = ['#e6e6e6', '#d8c7a6', '#2b2b30', '#c42e2e'];
const SOCK_PALETTE = ['#f4f4f4', '#18181b', '#c43d3d', '#1f5fc8', '#e0a93b'];
const BALL_PANELS = ['#111111', '#1f5fc8', '#c43d3d'];
const PRINT_LETTERS = 'ABCDEFGHJKLMNPRSTVWXYZ';

/** Darken a #rrggbb colour by `k` (0 = unchanged, 1 = black). */
function darken(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (shift: number) => Math.round(((n >> shift) & 0xff) * (1 - k)).toString(16).padStart(2, '0');
  return `#${ch(16)}${ch(8)}${ch(0)}`;
}

/** Generate a random but coherent character. A body-plan style (realistic /
 *  chibi / funko, applied with the panel's own `applyStyle`) and, for realistic
 *  figures, an age archetype drive the proportions; the rest of the body, face,
 *  hair, clothing and colours are drawn from the spec's enum lists and sensible
 *  ranges. The pose is a named preset so the Pose dropdown still reads right.
 *  Pass a seeded `rng` (`seededRandom(n)`) for a reproducible result. */
export function randomSpec(rng: Rng = Math.random): CharacterSpec {
  const r = roller(rng);
  const s = cloneSpec(DEFAULT_SPEC);

  // --- Style + archetype -----------------------------------------------------
  const style = r.pickEnum('body.proportions', PROPORTIONS, { realistic: 70, chibi: 18, funko: 12 }, 6);
  applyStyle(s, style);
  const toy = style !== 'realistic';
  const archetype = toy ? 'toy' : r.weighted([['adult', 60], ['child', 12], ['teen', 12], ['elder', 16]] as const);
  const young = archetype === 'child' || toy;
  const elder = archetype === 'elder';

  const b = s.body;
  b.sex = r.pickEnum('body.sex', SEXES, { female: 40, male: 40, neutral: 20 });
  if (!toy) b.build = r.pickEnum('body.build', BUILDS, { slim: 35, average: 45, stocky: 20 }, 20);
  switch (archetype) {
    case 'child': b.age = r.range(4, 11, 1); b.height = r.range(30, 44, 1); b.headsTall = r.range(4.5, 6, 0.25); break;
    case 'teen': b.age = r.range(13, 17, 1); b.height = r.range(52, 64, 1); b.headsTall = r.range(6.5, 7.25, 0.25); break;
    case 'elder': b.age = r.range(62, 85, 1); b.height = r.range(56, 66, 1); b.headsTall = r.range(6.75, 7.5, 0.25); break;
    case 'adult': b.age = r.range(20, 55, 1); b.height = r.range(58, 74, 1); b.headsTall = r.range(7, 8, 0.25); break;
    default: b.height = style === 'funko' ? r.range(48, 70, 1) : r.range(32, 42, 1); // toy: keep the style's head count
  }
  b.weight = r.range(0.25, 0.8, 0.05);
  b.muscle = young ? 0 : r.range(0, b.sex === 'male' ? 0.8 : 0.5, 0.05);
  b.bust = b.sex === 'female' && !young && archetype !== 'teen' ? r.range(0.2, 0.7, 0.05) : 0;
  b.belly = young || archetype === 'teen' ? 0 : r.chance(0.3) ? r.range(0.1, elder ? 0.8 : 0.5, 0.05) : 0;

  // --- Pose (+ an occasional held ball) ------------------------------------
  s.pose = POSE_PRESETS[r.weighted([['standing', 30], ['contrapposto', 25], ['walking', 20], ['waving', 15], ['armsUp', 10]] as const)]();
  if (r.pickEnum('pose.hold.kind', HOLD_KINDS, { none: toy ? 85 : 94, ball: toy ? 15 : 6 }) === 'ball') {
    s.pose.hold = {
      ...s.pose.hold, kind: 'ball',
      radius: Number((b.height * r.range(0.09, 0.12, 0.005)).toFixed(2)),
      cup: r.pickEnum('pose.hold.cup', HOLD_CUPS),
      color: r.pick(BALL_PANELS),
      handScale: b.mittens ? 1.3 : 1,
    };
  }

  // --- Face -----------------------------------------------------------------
  const f = s.face;
  if (style === 'funko') {
    // applyStyle already set the bead-eyed, mouthless toy face.
    f.brows = r.pickEnum('face.brows', BROW_SHAPES, {}, 1, ['arched', 'flat', 'angled', 'rounded', 'straight', 'bushy']);
    f.browThickness = r.range(1.5, 3, 0.1);
    f.browWidth = r.range(1, 1.5, 0.05);
    f.eyeSize = r.range(1.5, 2, 0.05);
    f.jaw = r.range(1.1, 1.4, 0.05);
    f.cheek = r.range(1, 1.2, 0.05);
  } else {
    if (style === 'realistic') {
      // A round face on a grown, heavier body can bury the brows (kemper/partwright#1084); kids keep it.
      f.shape = young
        ? r.pickEnum('face.shape', FACE_SHAPES, {}, 1, ['round', 'oval', 'heart'])
        : r.pickEnum('face.shape', FACE_SHAPES, {}, 1, FACE_SHAPES.filter(x => x !== 'round'));
      f.lids = young
        ? r.pickEnum('face.lids', LID_STYLES, {}, 1, ['none', 'almond', 'upper'])
        : r.pickEnum('face.lids', LID_STYLES, { almond: 40, upper: 30, none: 22, half: 8 }, 8);
      f.nose = young ? r.pickEnum('face.nose', NOSE_TYPES, {}, 1, ['button', 'snub', 'straight']) : r.pickEnum('face.nose', NOSE_TYPES);
      f.ears = r.pickEnum('face.ears', EAR_TYPES, { detailed: 60, round: 30, pointed: 10 }, 10);
      // Head-shape multipliers stay at 1 on a human face: varying jaw / cheek /
      // brow span there sinks the brows into the brow ridge, and eyes below 1×
      // leave almost no eye-white showing (both measured with --random).
      f.eyeSize = r.range(1, 1.12, 0.02);
    } else {
      // chibi: applyStyle set the round face + button nose; vary the eyes a touch.
      f.eyeSize = r.range(1.25, 1.7, 0.05);
      f.cheek = r.range(1, 1.3, 0.05);
    }
    f.gaze = r.pickEnum('face.gaze', GAZES, { center: 76, left: 12, right: 12 });
    f.expression = r.pickEnum('face.expression', EXPRESSIONS, { bigSmile: 15, smile: 25, slightSmile: 30, neutral: 20, slightFrown: 7, frown: 3 }, 5);
    f.lipShape = r.pickEnum('face.lipShape', LIP_SHAPES);
    f.brows = elder && r.chance(0.4) ? 'bushy' : r.pickEnum('face.brows', BROW_SHAPES);
    // Thicker brows stand proud of the ridge; below 1× they can vanish.
    f.browThickness = r.range(1, 1.5, 0.05);
  }

  // --- Hair -----------------------------------------------------------------
  const h = s.hair;
  const male = b.sex === 'male';
  h.style = toy
    ? r.pickEnum('hair.style', HAIR_STYLES, { anime: 16, shag: 14, mop: 10, captured: 4, short: 10, bob: 8, spiked: 8, bald: 1 }, 4)
    : r.pickEnum('hair.style', HAIR_STYLES, {
      short: 18, long: male ? 5 : 14, bob: male ? 3 : 10, bun: elder ? 12 : 7, bangs: 7, ponytail: 8, afro: 6,
      braids: 8, spiked: 5, cornrows: 5, mop: 4, anime: 2, shag: 3, captured: 1,
      bald: elder && b.sex !== 'female' ? 25 : young ? 0 : 3,
    }, 2);
  h.length = h.style === 'long' || h.style === 'braids'
    ? r.pickEnum('hair.length', HAIR_LENGTHS, { long: 70, mid: 30, short: 0 })
    : r.pickEnum('hair.length', HAIR_LENGTHS);
  h.volume = h.style === 'afro' ? r.range(1, 1.5, 0.1) : r.range(0.8, 1.3, 0.1);
  if (LOCK_HAIR_STYLES.includes(h.style)) {
    h.seed = r.int(1, 999);
    h.fringe = r.range(0.5, 1.2, 0.05);
    h.chunk = r.range(0.8, 1.5, 0.05);
    h.spike = r.range(0.5, 1.8, 0.05);
    h.lockShape = r.pickEnum('hair.lockShape', LOCK_SHAPES);
    h.swoop = r.range(0, 2, 0.1);
    h.crown = r.pickEnum('hair.crown', HAIR_CROWNS);
    h.layers = r.int(2, 3);
    h.raggedness = r.range(0.5, 1.5, 0.05);
    h.flare = r.range(0.6, 1.4, 0.05);
    h.notched = r.chance(0.8);
    h.crownSize = r.range(0.7, 1.4, 0.05);
    h.backWidth = r.range(0.7, 1.2, 0.05);
  }
  if (h.style === 'captured') {
    h.preset = r.pickEnum('hair.preset', HAIR_PRESETS);
    h.volume = r.range(0.7, 1, 0.05);
    h.capturedFringe = r.range(0.6, 1.2, 0.05);
    h.spikiness = r.range(0.7, 1.5, 0.05);
    h.smooth = r.range(0, 0.4, 0.05);
    h.mirror = r.chance(0.5);
  }

  // --- Clothing -------------------------------------------------------------
  const c = s.clothing;
  c.top.on = r.chance(0.94);
  c.top.sleeve = r.pickEnum('clothing.top.sleeve', SLEEVES);
  c.top.length = c.top.on && b.sex === 'female' && r.chance(0.3) ? 'dress' : r.pickEnum('clothing.top.length', TOP_LENGTHS, { shirt: 96, dress: 4 });
  c.top.trim = { collar: r.chance(0.2), cuffs: c.top.sleeve !== 'none' && r.chance(0.15) };
  c.top.print = c.top.on && r.chance(0.12) ? randomPrints(r) : [];
  // A dress usually replaces the pants (the hem covers the thigh either way).
  c.pants.on = c.top.length === 'dress' ? r.chance(0.2) : true;
  c.pants.leg = r.pickEnum('clothing.pants.leg', PANTS_LEGS, { slim: 75, cargo: 25 }, 25);
  c.pants.rise = r.pickEnum('clothing.pants.rise', PANTS_RISES);
  c.pants.length = r.pickEnum('clothing.pants.length', PANTS_LENGTHS, { full: toy ? 45 : 65, shorts: toy ? 40 : 20, briefs: 15 }, 15);
  c.pants.hem = r.range(0.75, 1, 0.01);
  const bareShins = !c.pants.on || c.pants.length !== 'full';
  c.socks = { ...c.socks, on: r.chance(bareShins ? 0.5 : 0.1), height: r.range(0.9, 1.2, 0.02), stripes: r.int(0, 3) };
  c.feet.on = r.chance(0.92);
  c.feet.kind = r.pickEnum('clothing.feet.kind', FOOTWEAR_KINDS, { shoes: 65, boots: 35 }, 20);
  c.feet.style = c.feet.kind === 'shoes' ? r.pickEnum('clothing.feet.style', SHOE_STYLES, { fitted: toy ? 30 : 90, toy: toy ? 70 : 10 }, 10) : 'fitted';
  if (c.feet.style === 'toy') {
    c.feet.size = r.range(1.1, 1.35, 0.05);
    c.feet.height = r.range(0.9, 1.3, 0.05);
    c.feet.cleats = c.pants.length === 'shorts' && r.chance(0.3) ? 6 : 0;
  }

  // --- Colours --------------------------------------------------------------
  const col = s.colors;
  col.skin = r.pick(SKIN_PALETTE);
  col.hair = elder ? r.pick(HAIR_GREY) : r.chance(toy ? 0.25 : 0.1) ? r.pick(HAIR_DYED) : r.pick(HAIR_NATURAL);
  col.brows = elder ? darken(col.hair, 0.15) : HAIR_DYED.includes(col.hair) ? r.pick(HAIR_NATURAL.slice(0, 5)) : darken(col.hair, 0.2);
  // Bead eyes keep applyStyle's one-gloss black; only iris eyes get a colour.
  if (f.eyeStyle === 'iris') col.iris = r.pick(IRIS_PALETTE);
  col.lips = r.pick(LIP_PALETTE);
  col.top = r.pick(CLOTH_PALETTE);
  // Pants and trim contrast with the top (never the identical colour).
  col.pants = r.pick(PANTS_PALETTE.filter(x => x !== col.top));
  col.trim = r.pick(CLOTH_PALETTE.filter(x => x !== col.top));
  col.feet = r.pick(FEET_PALETTE);
  col.sole = r.chance(0.25) ? r.pick(SOLE_PALETTE.filter(x => x !== col.feet)) : null;
  col.socks = r.pick(SOCK_PALETTE);
  col.sockStripe = r.pick(SOCK_PALETTE.filter(x => x !== col.socks));
  return s;
}

/** A jersey-style print: a back number, sometimes with a chest initial. */
function randomPrints(r: ReturnType<typeof roller>): PrintSpec[] {
  const color = r.pick(['#1a1a1a', '#f4f4f4', '#1f5fc8', '#c43d3d', '#f2c230']);
  const font = r.pickEnum('clothing.top.print.font', PRINT_FONTS, { bold: 70 }, 10);
  const prints: PrintSpec[] = [{ ...PRINT_DEFAULT, text: String(r.int(1, 99)), where: r.pickEnum('clothing.top.print.where', PRINT_PLACES, { back: 70, chest: 30 }), size: r.range(0.7, 1, 0.05), color, font }];
  if (prints[0].where === 'back' && r.chance(0.5)) {
    prints.push({ ...PRINT_DEFAULT, text: r.pick([...PRINT_LETTERS]), where: 'chest', x: 0.55, z: 0.24, size: 0.55, color, font });
  }
  return prints;
}
