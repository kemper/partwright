// CharacterSpec v2 (issue #1059): the v1 → v2 migration (byte-identical code
// below the header for every v1 spec), codegen of each new field, validation,
// and that the spec's enum lists stay in sync with the figure library's own
// assertEnum lists (read back from the library's validation errors).

import { describe, it, expect } from 'vitest';
import { specToCode } from '../../src/figure/characterCodegen';
import {
  DEFAULT_SPEC, SPEC_VERSION, STYLE_DEFAULTS,
  BUILDS, SEXES, PROPORTIONS, FACE_SHAPES, LID_STYLES, GAZES, NOSE_TYPES, EXPRESSIONS,
  LIP_SHAPES, EAR_TYPES, BROW_SHAPES, HAIR_STYLES, HAIR_LENGTHS, LOCK_SHAPES, HAIR_CROWNS, SLEEVES,
  PANTS_LEGS, PANTS_RISES, PANTS_LENGTHS, HOLD_CUPS,
  applyStyle, cloneSpec, decodeSpecComment, encodeSpecComment, normalizeSpec,
  resolvedHeadScale, specJsonSchema, validateSpec,
  type CharacterSpec,
} from '../../src/figure/characterSpec';
import { __figureTestables__, createFigureNamespace, type SdfApi } from '../../src/geometry/sdfFigure';
import { __testables__ as sdfT } from '../../src/geometry/sdf';
import v1Fixture from './fixtures/characterV1Code.json';

const body = (code: string) => code.split('\n').slice(1).join('\n');
const v2 = (patch: (s: CharacterSpec) => void): CharacterSpec => { const s = cloneSpec(DEFAULT_SPEC); patch(s); return s; };

describe('CharacterSpec v1 → v2 migration', () => {
  it('is version 2 and writes a v2 header', () => {
    expect(SPEC_VERSION).toBe(2);
    expect(specToCode(DEFAULT_SPEC).split('\n')[0]).toMatch(/^\/\/ @character v2 \{/);
  });

  it('regenerates byte-identical code (below the header) for every captured v1 spec', () => {
    expect(v1Fixture.length).toBeGreaterThan(5);
    for (const c of v1Fixture as Array<{ name: string; spec: unknown; code: string }>) {
      // Via the header path (what re-opening an old character does)…
      const fromHeader = decodeSpecComment(c.code);
      expect(fromHeader, c.name).not.toBeNull();
      expect(body(specToCode(fromHeader!)), c.name).toBe(body(c.code));
      // …and via an explicit version on a spec object.
      expect(body(specToCode(normalizeSpec(c.spec, 1))), c.name).toBe(body(c.code));
      expect(body(specToCode(normalizeSpec({ ...(c.spec as object), version: 1 }))), c.name).toBe(body(c.code));
    }
  });

  it('migrates v1 with v1-reproducing defaults for every new field', () => {
    const m = decodeSpecComment((v1Fixture[0] as { code: string }).code)!;
    expect(m.place).toBe(false);
    expect(m.body.proportions).toBe('realistic');
    expect(m.body.headScale).toBeNull();
    expect(m.face.layout).toEqual({ eyeSpread: null, eyeHeight: null });
    expect(m.pose.hold.kind).toBe('none');
    expect(m.hair).toMatchObject({ lockShape: 'ribbon', chunk: 1, spike: 1, swoop: 1, fringe: 1, seed: 1, crown: 'spiky', layers: 3, raggedness: 1, flare: 1 });
    expect(typeof m.colors.ball).toBe('string');
    expect(validateSpec(m)).toEqual([]);
  });

  it('a migrated spec re-encodes as v2 and round-trips stably', () => {
    const m = decodeSpecComment((v1Fixture[0] as { code: string }).code)!;
    const code = specToCode(m);
    expect(code.startsWith('// @character v2 ')).toBe(true);
    expect(decodeSpecComment(code)).toEqual(m);
  });

  it('a current spec object without a version takes the v2 defaults (placed)', () => {
    expect(normalizeSpec({ body: { height: 50 } }).place).toBe(true);
    expect(decodeSpecComment(encodeSpecComment(DEFAULT_SPEC))).toEqual(DEFAULT_SPEC);
  });
});

describe('CharacterSpec v2 codegen', () => {
  it('emits proportions / headScale / faceLayout only when set', () => {
    const plain = specToCode(DEFAULT_SPEC);
    expect(plain).not.toContain('proportions:');
    expect(plain).not.toContain('headScale:');
    expect(plain).not.toContain('faceLayout:');
    const code = specToCode(v2(s => {
      s.body.proportions = 'funko';
      s.body.headScale = { x: 2.3, y: 1.8, z: 2.1 };
      s.face.layout = { eyeSpread: 1.3, eyeHeight: null };
    }));
    expect(code).toContain("  proportions: 'funko',");
    expect(code).toContain('  headScale: { x: 2.3, y: 1.8, z: 2.1 },');
    expect(code).toContain('  faceLayout: { eyeSpread: 1.3 },');
    expect(specToCode(v2(s => { s.body.headScale = 1.5; }))).toContain('  headScale: 1.5,');
  });

  it('seats brows on the real face for stylized heads only', () => {
    expect(specToCode(DEFAULT_SPEC)).toContain("F.face.brows(rig, { shape: 'natural' })");
    expect(specToCode(v2(s => { s.body.proportions = 'chibi'; }))).toContain("F.face.brows(rig, { shape: 'natural', on: face })");
  });

  it('emits the anime/mop knobs only for the styles that read them, off-default', () => {
    const anime = specToCode(v2(s => {
      s.hair = { ...s.hair, style: 'anime', lockShape: 'tube', chunk: 1.4, spike: 1, swoop: 0.5, fringe: 0.7, seed: 7 };
    }));
    expect(anime).toContain("F.hair(rig, { style: 'anime', length: 'mid', lockShape: 'tube', chunk: 1.4, swoop: 0.5, fringe: 0.7, seed: 7, on: head })");
    // mop ignores the anime-only knobs (the library rejects them on 'mop').
    const mop = specToCode(v2(s => { s.hair = { ...s.hair, style: 'mop', lockShape: 'tube', chunk: 2, spike: 2, swoop: 2, fringe: 1, seed: 3 }; }));
    expect(mop).toContain("F.hair(rig, { style: 'mop', length: 'mid', seed: 3, on: head })");
    // classic styles never see any lock knob.
    const short = specToCode(v2(s => { s.hair = { ...s.hair, style: 'short', seed: 9, fringe: 0.2 }; }));
    expect(short).toContain("F.hair(rig, { style: 'short', length: 'mid' })");
    // all-default anime: just style + on.
    expect(specToCode(v2(s => { s.hair.style = 'anime'; }))).toContain("F.hair(rig, { style: 'anime', length: 'mid', on: head })");
    // anime ignores the shag-only knobs.
    const animeShagKnobs = specToCode(v2(s => { s.hair = { ...s.hair, style: 'anime', crown: 'tousled', layers: 2, raggedness: 0.5, flare: 2 }; }));
    expect(animeShagKnobs).toContain("F.hair(rig, { style: 'anime', length: 'mid', on: head })");
  });

  it("emits the 'shag' knobs (crown/layers/raggedness/flare + chunk/spike) only off-default", () => {
    // all-default shag: just style + on (crown 'spiky', 3 layers are the library defaults).
    expect(specToCode(v2(s => { s.hair.style = 'shag'; }))).toContain("F.hair(rig, { style: 'shag', length: 'mid', on: head })");
    const shag = specToCode(v2(s => {
      s.hair = { ...s.hair, style: 'shag', crown: 'tousled', layers: 2, raggedness: 1.4, flare: 0.8, spike: 0.8, chunk: 1.2, swoop: 2, lockShape: 'tube', fringe: 0.6, seed: 11 };
    }));
    // swoop / lockShape are anime-only — never emitted for shag.
    expect(shag).toContain("F.hair(rig, { style: 'shag', length: 'mid', chunk: 1.2, spike: 0.8, crown: 'tousled', layers: 2, raggedness: 1.4, flare: 0.8, fringe: 0.6, seed: 11, on: head })");
    // A fractional layers value (hand-edited spec) is rounded to the integer the library needs.
    expect(specToCode(v2(s => { s.hair = { ...s.hair, style: 'shag', layers: 1.6 }; }))).toContain('layers: 2,');
    // Validation rejects a bad crown / out-of-range layers + raggedness, with paths.
    const errs = validateSpec(v2(s => { s.hair = { ...s.hair, style: 'shag', crown: 'mohawk' as never, layers: 5, raggedness: -1 }; })).join(' | ');
    expect(errs).toContain('hair.crown');
    expect(errs).toContain('hair.layers');
    expect(errs).toContain('hair.raggedness');
  });

  it('a held ball solves the arms, opens the hands, adds + patterns the ball', () => {
    const code = specToCode(v2(s => {
      s.pose.armL = { raiseSide: 40, raiseFwd: 0, bend: 10, twist: 0 };
      s.pose.hold = { kind: 'ball', radius: 10.5, cup: 'under', color: '#111111' };
      s.colors.ball = '#fafafa';
    }));
    expect(code).toContain("hold: { sphere: { radius: 10.5 }, cup: 'under' },");
    expect(code).not.toContain('armL:');
    expect(code).toContain("F.hands(rig, { grip: 'open' })");
    expect(code).toContain("const ball = F.heldSphere(rig).label('ball');");
    expect(code).toMatch(/sdf\.union\([^)]*\bball\b/);
    expect(code).toContain("api.paint.pattern({ pattern: 'soccer', withinPart: 'ball', colors: ['#fafafa', '#111111'] });");
    const none = specToCode(DEFAULT_SPEC);
    expect(none).not.toContain('heldSphere');
    expect(none).toContain("F.hands(rig, { grip: 'relaxed' })");
  });

  it('eyeSize scales the eye radius and mouth:false drops the lips + their paint', () => {
    expect(specToCode(DEFAULT_SPEC)).toContain("F.face.eyes(rig, { lids: 'almond', gaze: 'center' })");
    const code = specToCode(v2(s => { s.face.eyeSize = 1.8; s.face.mouth = false; }));
    expect(code).toContain("F.face.eyes(rig, { radius: rig.r.head * 0.288, lids: 'almond', gaze: 'center' })");
    expect(code).not.toContain('mouthAccents');
    expect(code).not.toContain("api.paint.label('lips'");
    expect(code).not.toMatch(/sdf\.union\([^)]*\blips\b/);
  });

  it('places v2 figures (z = 0, facing +X) and keeps the legacy return for v1', () => {
    const code = specToCode(DEFAULT_SPEC);
    expect(code).toMatch(/const model = sdf\.union\([^)]*\)\s*\n\s*\.build\(/);
    expect(code.trimEnd().endsWith("return F.place(model, rig, { face: '+X' });")).toBe(true);
    const legacy = specToCode(v2(s => { s.place = false; }));
    expect(legacy).toMatch(/return sdf\.union\([^)]*\)\s*\n\s*\.build\(/);
    expect(legacy).not.toContain('F.place');
  });
});

describe('CharacterSpec styles + validation', () => {
  it('applyStyle sets the style defaults and a fitting face', () => {
    const s = cloneSpec(DEFAULT_SPEC);
    applyStyle(s, 'funko');
    expect(s.body).toMatchObject({ proportions: 'funko', headsTall: 3, build: 'slim', headScale: null });
    expect(s.face.lids).toBe('none');
    expect(s.face).toMatchObject({ mouth: false, eyeSize: 1.8 });
    expect(resolvedHeadScale(s)).toEqual(STYLE_DEFAULTS.funko.headScale);
    applyStyle(s, 'realistic');
    expect(s.body).toMatchObject({ proportions: 'realistic', headsTall: 7, build: 'average' });
    expect(s.colors.eyes).toBe(DEFAULT_SPEC.colors.eyes);
    expect(s.face).toEqual(DEFAULT_SPEC.face);
    expect(validateSpec(s)).toEqual([]);
  });

  it('accepts the defaults and every preset-ish edit, rejects bad values with paths', () => {
    expect(validateSpec(DEFAULT_SPEC)).toEqual([]);
    const bad = normalizeSpec({
      body: { proportions: 'anime', headScale: { x: 9, w: 1 } },
      hair: { style: 'mohawk', chunk: 7 },
      pose: { hold: { kind: 'frisbee', cup: 'over' } },
      colors: { ball: 'white' },
      bogus: 1,
    });
    const errs = validateSpec(bad).join('\n');
    expect(errs).toContain('body.proportions must be one of');
    expect(errs).toContain('body.headScale.x must be ≤ 4');
    expect(errs).toContain('body.headScale.w is not a known field');
    expect(errs).toContain('hair.style must be one of');
    expect(errs).toContain('hair.chunk must be ≤ 2.5');
    expect(errs).toContain('pose.hold.kind must be one of');
    expect(errs).toContain('pose.hold.cup must be one of');
    expect(errs).toContain('colors.ball must be a hex colour');
    expect(errs).toContain('bogus is not a known field');
    expect(validateSpec(normalizeSpec({ body: { headScale: 2 }, face: { layout: { eyeSpread: 1.2 } } }))).toEqual([]);
  });

  it('the JSON schema carries every enum', () => {
    const s = specJsonSchema() as { properties: Record<string, { properties: Record<string, { enum?: string[]; properties?: Record<string, { enum?: string[] }> }> }> };
    expect(s.properties.body.properties.proportions.enum).toEqual([...PROPORTIONS]);
    expect(s.properties.hair.properties.style.enum).toEqual([...HAIR_STYLES]);
    expect(s.properties.pose.properties.hold.properties!.kind.enum).toEqual(['none', 'ball']);
  });
});

// ---- enum sync with the figure library --------------------------------------

const api = {
  sphere: sdfT.primSphere, ellipsoid: sdfT.primEllipsoid, box: sdfT.primBox,
  roundedBox: sdfT.primRoundedBox, cylinder: sdfT.primCylinder,
  roundedCylinder: sdfT.primRoundedCylinder, capsule: sdfT.primCapsule,
  union: (...nodes: unknown[]) => (nodes as never[]).reduce((a, b) => sdfT.opUnion(a, b)),
  __fineHands: (node: unknown, regions: unknown) => sdfT.opFineHands(node as never, regions as never),
} as unknown as SdfApi;
const F = createFigureNamespace(api);
const T = __figureTestables__;
const rig = T.buildRig({ height: 60 });

/** Call `fn` with a bogus enum value and read the allowed list out of the
 *  library's `X must be one of: "a" | "b". Got …` error. */
function libraryEnum(fn: () => unknown): string[] {
  try { fn(); } catch (err) {
    const m = /must be one of: (.*?)\. Got/.exec(String((err as Error).message));
    if (m) return [...m[1].matchAll(/"([^"]+)"/g)].map(x => x[1]);
    throw err;
  }
  throw new Error('expected the library to reject the bogus value');
}
const BOGUS = '__nope__';

describe('CharacterSpec enums match the figure library', () => {
  const same = (spec: readonly string[], lib: string[]) => expect([...spec].sort()).toEqual([...lib].sort());

  it('rig enums', () => {
    same(BUILDS, libraryEnum(() => T.buildRig({ build: BOGUS })));
    same(SEXES, libraryEnum(() => T.buildRig({ sex: BOGUS })));
    // 'realistic' is the spec's name for "no proportions key".
    same(PROPORTIONS.filter(p => p !== 'realistic'), libraryEnum(() => T.buildRig({ proportions: BOGUS })));
    same(HOLD_CUPS, libraryEnum(() => T.buildRig({ pose: { hold: { sphere: { radius: 5 }, cup: BOGUS } } })));
  });

  it('style defaults mirror the library proportion presets', () => {
    for (const p of ['funko', 'chibi'] as const) {
      const r = T.buildRig({ height: 60, proportions: p }) as unknown as { opts: { headsTall: number; build: string; headScale?: unknown } };
      expect(r.opts.headsTall, p).toBe(STYLE_DEFAULTS[p].headsTall);
      expect(r.opts.build, p).toBe(STYLE_DEFAULTS[p].build);
      expect(r.opts.headScale, p).toEqual(STYLE_DEFAULTS[p].headScale);
    }
  });

  it('face enums', () => {
    same(FACE_SHAPES, libraryEnum(() => T.buildHead(api, rig, { faceShape: BOGUS })));
    same(LID_STYLES, libraryEnum(() => F.face.eyes(rig, { lids: BOGUS })));
    same(NOSE_TYPES, libraryEnum(() => F.face.nose(rig, { type: BOGUS })));
    same(EXPRESSIONS, libraryEnum(() => F.face.mouthAccents(rig, { style: 'lips', expression: BOGUS })));
    same(LIP_SHAPES, libraryEnum(() => F.face.mouthAccents(rig, { style: 'lips', lipShape: BOGUS })));
    same(EAR_TYPES, libraryEnum(() => F.face.ears(rig, { type: BOGUS })));
    same(BROW_SHAPES, libraryEnum(() => F.face.brows(rig, { shape: BOGUS })));
    // The spec offers the cardinal gazes only — a subset of the library's.
    const gazes = libraryEnum(() => F.face.eyes(rig, { gaze: BOGUS }));
    for (const g of GAZES) expect(gazes, g).toContain(g);
  });

  it('hair + clothing enums', () => {
    same(HAIR_STYLES, libraryEnum(() => T.buildHair(api, rig, { style: BOGUS })));
    same(HAIR_LENGTHS, libraryEnum(() => T.buildHair(api, rig, { length: BOGUS })));
    same(LOCK_SHAPES, libraryEnum(() => T.buildHair(api, rig, { style: 'anime', lockShape: BOGUS })));
    same(HAIR_CROWNS, libraryEnum(() => T.buildHair(api, rig, { style: 'shag', crown: BOGUS })));
    same(SLEEVES, libraryEnum(() => F.clothing.top(rig, { sleeve: BOGUS })));
    same(PANTS_LEGS, libraryEnum(() => F.clothing.pants(rig, { leg: BOGUS })));
    same(PANTS_RISES, libraryEnum(() => F.clothing.pants(rig, { rise: BOGUS })));
    same(PANTS_LENGTHS, libraryEnum(() => F.clothing.pants(rig, { length: BOGUS })));
  });
});
