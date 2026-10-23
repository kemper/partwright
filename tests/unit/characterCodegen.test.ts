import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { specToCode } from '../../src/figure/characterCodegen';
import {
  DEFAULT_SPEC,
  cloneSpec,
  decodeSpecComment,
  normalizeSpec,
  CHARACTER_PRESETS,
  POSE_PRESETS,
  randomSpec,
  seededRandom,
  type CharacterSpec,
} from '../../src/figure/characterSpec';

describe('characterCodegen', () => {
  it('generates the canonical figure recipe for the default spec', () => {
    const code = specToCode(DEFAULT_SPEC);
    expect(code).toContain('const { sdf } = api;');
    expect(code).toContain('const F = sdf.figure;');
    expect(code).toContain('F.rig({');
    expect(code).toContain("F.weld(rig, [");
    expect(code).toContain(".label('skin')");
    expect(code).toContain('F.faceDetail(rig)');
    expect(code).toContain('F.handDetail(rig)');
    // Returns a built union of the labelled regions.
    expect(code).toMatch(/return sdf\.union\([^)]*\)\s*\n\s*\.build\(/);
  });

  it('embeds the spec as a round-trippable header comment', () => {
    const code = specToCode(DEFAULT_SPEC);
    expect(code.split('\n')[0]).toMatch(/^\/\/ @character v1 \{/);
    const decoded = decodeSpecComment(code);
    expect(decoded).toEqual(normalizeSpec(DEFAULT_SPEC));
  });

  it('round-trips every built-in character preset', () => {
    for (const preset of CHARACTER_PRESETS) {
      const spec = preset.patch();
      const decoded = decodeSpecComment(specToCode(spec));
      expect(decoded, preset.id).toEqual(normalizeSpec(spec));
    }
  });

  it('paints every region it builds, and only those', () => {
    const code = specToCode(DEFAULT_SPEC);
    for (const label of ['skin', 'lids', 'eyes', 'iris', 'pupil', 'lips', 'brows', 'hair', 'top', 'pants', 'feet', 'sole', 'base']) {
      expect(code, label).toContain(`api.paint.label('${label}'`);
    }
  });

  it('omits hair entirely when bald (no call, no paint)', () => {
    const spec = cloneSpec(DEFAULT_SPEC);
    spec.hair.style = 'bald';
    const code = specToCode(spec);
    expect(code).not.toContain('F.hair(');
    expect(code).not.toContain("api.paint.label('hair'");
    expect(code).not.toContain(', hair,');
  });

  it('drops clothing layers that are turned off', () => {
    const spec = cloneSpec(DEFAULT_SPEC);
    spec.clothing.top.on = false;
    spec.clothing.pants.on = false;
    spec.clothing.feet.on = false;
    spec.base = false;
    const code = specToCode(spec);
    expect(code).not.toContain('F.clothing.top(');
    expect(code).not.toContain('F.clothing.pants(');
    expect(code).not.toContain('F.clothing.shoes(');
    expect(code).not.toContain('F.base(');
    expect(code).not.toContain("api.paint.label('top'");
    expect(code).not.toContain("api.paint.label('base'");
  });

  it('derives a dress hem from the rig joints', () => {
    const spec = cloneSpec(DEFAULT_SPEC);
    spec.clothing.top.length = 'dress';
    const code = specToCode(spec);
    expect(code).toContain('const dressHemZ = rig.joints.lowerLegL[2]');
    expect(code).toContain('hemZ: dressHemZ');
  });

  it('selects boots when the footwear kind is boots', () => {
    const spec = cloneSpec(DEFAULT_SPEC);
    spec.clothing.feet.kind = 'boots';
    const code = specToCode(spec);
    expect(code).toContain("F.clothing.boots(rig, { label: 'feet' })");
  });

  it('omits neutral pose joints from the rig but keeps posed ones', () => {
    const spec = cloneSpec(DEFAULT_SPEC);
    spec.pose.armL = { raiseSide: 150, raiseFwd: 0, bend: 0, twist: 0 };
    spec.pose.armR = { raiseSide: 0, raiseFwd: 0, bend: 0, twist: 0 };
    spec.pose.legL = { raiseSide: 0, raiseFwd: 0, bend: 0, twist: 0 };
    spec.pose.legR = { raiseSide: 0, raiseFwd: 0, bend: 0, twist: 0 };
    spec.pose.spine = { lean: 0, turn: 0, side: 0 };
    spec.pose.head = { yaw: 0, pitch: 0, roll: 0 };
    const code = specToCode(spec);
    expect(code).toContain('armL: { raiseSide: 150 }');
    // A fully-neutral joint contributes nothing.
    expect(code).not.toContain('armR:');
    expect(code).not.toContain('legL:');
  });
});

describe('characterSpec normalize/decode', () => {
  it('fills missing fields from the default (forward-compat)', () => {
    const partial = { body: { height: 80 }, colors: { skin: '#abcdef' } };
    const norm = normalizeSpec(partial);
    expect(norm.body.height).toBe(80);
    expect(norm.colors.skin).toBe('#abcdef');
    // Untouched fields keep defaults.
    expect(norm.body.headsTall).toBe(DEFAULT_SPEC.body.headsTall);
    expect(norm.clothing.top.on).toBe(DEFAULT_SPEC.clothing.top.on);
  });

  it('returns null decoding code without a header', () => {
    expect(decodeSpecComment('return api.cube();')).toBeNull();
  });

  it('does not pollute the prototype from a crafted spec', () => {
    normalizeSpec(JSON.parse('{"__proto__":{"polluted":true},"constructor":{"x":1}}'));
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect((Object.prototype as Record<string, unknown>).polluted).toBeUndefined();
  });
});

// Every enum value the figure API accepts (mirrors the sdfFigure assertEnum
// lists) — a random or preset spec must never step outside these.
const ENUMS = {
  build: ['slim', 'average', 'stocky'],
  sex: ['neutral', 'male', 'female'],
  shape: ['oval', 'round', 'square', 'long', 'heart', 'diamond'],
  lids: ['none', 'upper', 'hooded', 'half', 'closed', 'almond', 'tapered'],
  gaze: ['middle', 'center', 'left', 'right', 'up', 'down'],
  nose: ['straight', 'button', 'snub', 'roman', 'aquiline', 'broad', 'pointed', 'bulbous'],
  expression: ['bigSmile', 'smile', 'slightSmile', 'neutral', 'slightFrown', 'frown', 'deepFrown'],
  lipShape: ['natural', 'full', 'thin', 'wide', 'rosebud', 'flat'],
  ears: ['round', 'pointed', 'detailed'],
  brows: ['natural', 'thin', 'bushy', 'arched', 'flat', 'angled', 'rounded', 'straight'],
  hairStyle: ['bald', 'short', 'long', 'bob', 'bun', 'bangs', 'ponytail', 'afro', 'braids', 'spiked', 'locs', 'cornrows', 'boxBraids'],
  hairLength: ['short', 'mid', 'long'],
};

function expectValidSpec(s: CharacterSpec, tag: string): void {
  const b = s.body;
  expect(ENUMS.build, tag).toContain(b.build);
  expect(ENUMS.sex, tag).toContain(b.sex);
  expect(b.height, tag).toBeGreaterThanOrEqual(24);
  expect(b.height, tag).toBeLessThanOrEqual(90);
  expect(b.headsTall, tag).toBeGreaterThanOrEqual(2.5);
  expect(b.headsTall, tag).toBeLessThanOrEqual(9);
  for (const k of ['weight', 'muscle'] as const) {
    expect(b[k], `${tag} ${k}`).toBeGreaterThanOrEqual(0);
    expect(b[k], `${tag} ${k}`).toBeLessThanOrEqual(1);
  }
  for (const k of ['bust', 'belly'] as const) {
    expect(b[k], `${tag} ${k}`).toBeGreaterThanOrEqual(0);
    expect(b[k], `${tag} ${k}`).toBeLessThanOrEqual(2);
  }
  expect(Object.keys(POSE_PRESETS), tag).toContain(s.pose.preset);
  expect(ENUMS.shape, tag).toContain(s.face.shape);
  expect(ENUMS.lids, tag).toContain(s.face.lids);
  expect(ENUMS.gaze, tag).toContain(s.face.gaze);
  expect(ENUMS.nose, tag).toContain(s.face.nose);
  expect(ENUMS.expression, tag).toContain(s.face.expression);
  expect(ENUMS.lipShape, tag).toContain(s.face.lipShape);
  expect(ENUMS.ears, tag).toContain(s.face.ears);
  expect(ENUMS.brows, tag).toContain(s.face.brows);
  expect(ENUMS.hairStyle, tag).toContain(s.hair.style);
  expect(ENUMS.hairLength, tag).toContain(s.hair.length);
  for (const [k, hex] of Object.entries(s.colors)) expect(hex, `${tag} colors.${k}`).toMatch(/^#[0-9a-f]{6}$/);
  // Same shape as the default — no missing or stray keys.
  expect(normalizeSpec(s), tag).toEqual(s);
}

describe('character presets', () => {
  it('have unique ids and labels, none a substring of another', () => {
    const ids = CHARACTER_PRESETS.map(p => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    const labels = CHARACTER_PRESETS.map(p => p.label);
    for (const a of labels) for (const b of labels) if (a !== b) expect(b.includes(a), `${a} in ${b}`).toBe(false);
    for (const p of CHARACTER_PRESETS) expect(p.description.length, p.id).toBeGreaterThan(0);
  });

  it('each ship a baked thumbnail (npm run bake:character-presets)', () => {
    for (const p of CHARACTER_PRESETS) {
      expect(existsSync(`public/character-presets/${p.id}.webp`), p.id).toBe(true);
    }
  });

  it('are all valid specs', () => {
    for (const p of CHARACTER_PRESETS) expectValidSpec(p.patch(), p.id);
  });
});

describe('randomSpec', () => {
  it('is deterministic for a seed and varies across seeds', () => {
    expect(randomSpec(seededRandom(7))).toEqual(randomSpec(seededRandom(7)));
    const distinct = new Set(Array.from({ length: 20 }, (_, i) => JSON.stringify(randomSpec(seededRandom(i)))));
    expect(distinct.size).toBe(20);
  });

  it('always produces a valid, codegen-able spec', () => {
    for (let i = 0; i < 300; i++) {
      const s = randomSpec(seededRandom(i));
      expectValidSpec(s, `seed ${i}`);
      expect(decodeSpecComment(specToCode(s)), `seed ${i}`).toEqual(normalizeSpec(s));
    }
  });

  it('keeps rolls coherent and clear of known-bad combos', () => {
    for (let i = 0; i < 300; i++) {
      const s = randomSpec(seededRandom(i));
      if (s.body.headsTall < 6) {
        expect(s.body.bust, `seed ${i}`).toBe(0);
        expect(s.body.muscle, `seed ${i}`).toBe(0);
      }
      expect(s.colors.pants, `seed ${i}`).not.toBe(s.colors.top);
      // Combos that currently bury a painted feature or detach hair strands in
      // the figure builder are kept out of one-click rolls.
      expect(s.face.lids, `seed ${i}`).not.toBe('hooded');
      expect(['center', 'left', 'right'], `seed ${i}`).toContain(s.face.gaze);
      expect(s.face.brows, `seed ${i}`).not.toBe('thin');
      expect(['locs', 'boxBraids'], `seed ${i}`).not.toContain(s.hair.style);
    }
  });

  it('covers a spread of hair styles and age groups', () => {
    const styles = new Set<string>();
    let kids = 0, elders = 0;
    for (let i = 0; i < 300; i++) {
      const s = randomSpec(seededRandom(i));
      styles.add(s.hair.style);
      if (s.body.age < 12) kids++;
      if (s.body.age > 60) elders++;
    }
    expect(styles.size).toBeGreaterThanOrEqual(10);
    expect(kids).toBeGreaterThan(0);
    expect(elders).toBeGreaterThan(0);
  });
});
