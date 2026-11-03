import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseHumanAsset, buildHumanMesh, type HumanAssetMeta } from '../../src/human/humanModel';
import { resolveStyle, STYLE_PRESETS, isRealistic } from '../../src/human/humanStyle';

const meta = JSON.parse(readFileSync('public/human/hm08.json', 'utf8')) as HumanAssetMeta;
const pack = (file: string) => { const b = readFileSync(`public/human/${file}`); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
const asset = parseHumanAsset(meta, { core: pack(meta.packs.core), morphs: pack(meta.packs.morphs) });

/** Head height as a fraction of the whole figure (rest pose). */
function headFraction(style?: ReturnType<typeof resolveStyle>['style']): number {
  const mesh = buildHumanMesh(asset, { height: 60, pose: 'rest', style });
  const chin = mesh.joints.get('head____head')![2];
  const skin = mesh.parts.find((p) => p.label === 'skin')!.positions;
  let top = -Infinity;
  for (let i = 2; i < skin.length; i += 3) top = Math.max(top, skin[i]);
  return (top - chin) / 60;
}

describe('human style presets', () => {
  it('realistic is the identity; every other preset changes the rest pose', () => {
    expect(isRealistic(resolveStyle('realistic').style)).toBe(true);
    for (const p of STYLE_PRESETS) if (p !== 'realistic') expect(isRealistic(resolveStyle(p).style), p).toBe(false);
  });

  it("every preset's extra sliders exist in the asset", () => {
    for (const p of STYLE_PRESETS) for (const k of Object.keys(resolveStyle(p).morphs)) expect(asset.modifiers.has(k), `${p}: ${k}`).toBe(true);
  });

  it('chibi and funko make the head a much bigger share of the figure, at the same print height', () => {
    const real = headFraction();
    expect(headFraction(resolveStyle('chibi').style)).toBeGreaterThan(real * 1.8);
    expect(headFraction(resolveStyle('funko').style)).toBeGreaterThan(real * 2.2);
    expect(headFraction(resolveStyle('heroic').style)).toBeLessThan(real);
  });

  it('knobs override a preset', () => {
    const s = resolveStyle('chibi', { head: 1.5, eyeShape: 'real' }).style;
    expect(s.head).toBe(1.5);
    expect(s.eyeShape).toBe('real');
    expect(s.legs).toBe(resolveStyle('chibi').style.legs);
  });

  it("funko's toy face has no nose and no mouth: the mouth's pocket is smoothed shut", () => {
    // Depth of the skin behind the lips' front, across the lips' width, in eye
    // spacings: the mouth's inside makes it deep on a realistic face.
    const mouthDepth = (style?: ReturnType<typeof resolveStyle>) => {
      const mesh = buildHumanMesh(asset, { height: 60, pose: 'rest', style: style?.style, morphs: style?.morphs });
      const J = (n: string) => mesh.restJoints.get(`${n}____head`)!;
      const spacing = Math.abs(J('eye.L')[0] - J('eye.R')[0]);
      const corner = J('oris03.L');
      let front = Infinity, back = -Infinity;
      for (let t = 0; t < asset.nT; t++) {
        if (asset.triLabel[t] !== 0) continue;
        for (let c = 0; c < 3; c++) {
          const v = asset.triVerts[t * 3 + c], x = mesh.rest[v * 3], y = mesh.rest[v * 3 + 1], z = mesh.rest[v * 3 + 2];
          if (Math.abs(x) > Math.abs(corner[0]) * 0.6 || Math.abs(z - corner[2]) > spacing * 0.15 || y > J('head')[1]) continue;
          front = Math.min(front, y); back = Math.max(back, y);
        }
      }
      return (back - front) / spacing;
    };
    const real = mouthDepth(), toy = mouthDepth(resolveStyle('funko'));
    expect(toy).toBeLessThan(real * 0.35);
  });
});

