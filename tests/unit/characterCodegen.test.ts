import { describe, it, expect } from 'vitest';
import { specToCode } from '../../src/figure/characterCodegen';
import {
  DEFAULT_SPEC,
  cloneSpec,
  decodeSpecComment,
  normalizeSpec,
  CHARACTER_PRESETS,
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
