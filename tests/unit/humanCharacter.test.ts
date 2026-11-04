import { describe, it, expect } from 'vitest';
import {
  DEFAULT_HUMAN_SPEC, HUMAN_PRESETS, cloneHumanSpec, normalizeHumanSpec, validateHumanSpec,
  humanSpecToCode, humanSpecToOptions, decodeHumanSpecComment, randomHumanSpec,
  humanSpecFromAvatar, applyHumanToAvatar,
} from '../../src/human/humanCharacter';
import { DEFAULT_SPEC, CHARACTER_PRESETS, decodeSpecComment, validateSpec, cloneSpec } from '../../src/figure/characterSpec';
import { seededRandom } from '../../src/figure/characterRandom';

describe('Realistic character spec', () => {
  it('the default and every preset are valid', () => {
    expect(validateHumanSpec(DEFAULT_HUMAN_SPEC)).toEqual([]);
    for (const p of HUMAN_PRESETS) expect(validateHumanSpec(p.patch()), p.id).toEqual([]);
  });

  it('lists every bad field, including unknown keys', () => {
    const bad = { body: { age: 200, gendr: 1 }, hair: { style: 'shag' }, colors: { skin: 'red' }, armor: ['cuirass', 'cuirass'] };
    const problems = validateHumanSpec(bad);
    expect(problems.join('\n')).toMatch(/body\.age/);
    expect(problems.join('\n')).toMatch(/body\.gendr: unknown key/);
    expect(problems.join('\n')).toMatch(/hair\.style/);
    expect(problems.join('\n')).toMatch(/colors\.skin/);
    expect(problems.join('\n')).toMatch(/armor: lists a piece twice/);
  });

  it('merges a partial spec onto the defaults and ignores __proto__', () => {
    const s = normalizeHumanSpec(JSON.parse('{"body":{"age":40},"__proto__":{"polluted":1}}'));
    expect(s.body.age).toBe(40);
    expect(s.body.gender).toBe(DEFAULT_HUMAN_SPEC.body.gender);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('generates api.human code whose header round-trips the spec', () => {
    const spec = HUMAN_PRESETS.find(p => p.id === 'h-knight')!.patch();
    const code = humanSpecToCode(spec);
    expect(code).toMatch(/^\/\/ @human-character v1 \{/);
    expect(code).toMatch(/return api\.human\(\{/);
    expect(decodeHumanSpecComment(code)).toEqual(spec);
    // An Avatar header reader never mistakes it for its own.
    expect(decodeSpecComment(code)).toBeNull();
    expect(decodeHumanSpecComment('// @character v2 {}\nreturn 1;')).toBeNull();
  });

  it('escapes the header so a hand-edited string cannot break out of the comment', () => {
    const spec = cloneHumanSpec(DEFAULT_HUMAN_SPEC);
    (spec as unknown as { expression: string }).expression = 'x\u2028return 1;</script>';
    const header = humanSpecToCode(spec).split('\n')[0];
    expect(header).not.toMatch(/[\u2028<]/);
  });

  it('builds the api.human options a preset needs', () => {
    const knight = humanSpecToOptions(HUMAN_PRESETS.find(p => p.id === 'h-knight')!.patch());
    expect(knight.hold).toEqual({ L: 'shield', R: 'sword' });
    const items = (knight.wear as { item: string }[]).map(w => w.item);
    expect(items).toContain('cuirass');
    // Armor goes over the clothes.
    expect(items.indexOf('cuirass')).toBeGreaterThan(items.indexOf('sweater'));
    const chibi = humanSpecToOptions(HUMAN_PRESETS.find(p => p.id === 'h-chibi')!.patch());
    expect(chibi.style).toBe('chibi');
    // A skirt goes over the top, so it reads as a dress.
    const chibiItems = (chibi.wear as { item: string }[]).map(w => w.item);
    expect(chibiItems.indexOf('skirt')).toBeGreaterThan(chibiItems.indexOf('tshirt'));
    expect(humanSpecToOptions(DEFAULT_HUMAN_SPEC).style).toBeUndefined();
  });

  it('random characters are valid and reproducible', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const s = randomHumanSpec(seededRandom(seed));
      expect(validateHumanSpec(s), `seed ${seed}`).toEqual([]);
      expect(randomHumanSpec(seededRandom(seed))).toEqual(s);
    }
  });
});

describe('switching families', () => {
  it('carries the shared settings from an Avatar to a Realistic character', () => {
    const a = cloneSpec(DEFAULT_SPEC);
    a.body.sex = 'female';
    a.body.age = 40;
    a.body.proportions = 'chibi';
    a.hair.style = 'ponytail';
    a.colors.skin = '#8d5524';
    a.colors.top = '#123456';
    a.clothing.pants.length = 'shorts';
    const h = humanSpecFromAvatar(a);
    expect(validateHumanSpec(h)).toEqual([]);
    expect(h.body.gender).toBeLessThan(0.3);
    expect(h.body.age).toBe(40);
    expect(h.style).toBe('chibi');
    expect(h.hair.style).toBe('ponytail');
    expect(h.colors.skin).toBe('#8d5524');
    expect(h.colors.top).toBe('#123456');
    expect(h.wear.bottom).toBe('shorts');
  });

  it('carries them back, keeping the Avatar-only settings', () => {
    const start = cloneSpec(DEFAULT_SPEC);
    start.face.eyeStyle = 'bead';
    const h = cloneHumanSpec(DEFAULT_HUMAN_SPEC);
    h.body.gender = 1;
    h.hair.style = 'afro';
    h.wear.bottom = 'skirt';
    h.colors.hair = '#abcdef';
    const a = applyHumanToAvatar(h, start);
    expect(validateSpec(a)).toEqual([]);
    expect(a.body.sex).toBe('male');
    expect(a.hair.style).toBe('afro');
    expect(a.clothing.top.length).toBe('dress');
    expect(a.colors.hair).toBe('#abcdef');
    expect(a.face.eyeStyle).toBe('bead');
  });

  it('every Avatar preset maps to a valid Realistic character and back', () => {
    for (const p of CHARACTER_PRESETS) {
      const h = humanSpecFromAvatar(p.patch());
      expect(validateHumanSpec(h), p.id).toEqual([]);
      expect(validateSpec(applyHumanToAvatar(h, p.patch())), p.id).toEqual([]);
    }
  });
});
