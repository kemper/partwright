import { describe, it, expect } from 'vitest';
import { prepImagePixels, parseImagePrepOptions, isNoopPrep, describeImagePrep, PREP_BACKGROUND_ALPHA, type PixelImage } from '../../src/imageTools/prep';
import { renderImageToolPreview } from '../../src/imageTools/preview';
import { isReliefObject } from '../../src/relief/reliefSettings';
import { formatImageToolHeader } from '../../src/imageTools/descriptor';
import type { ReliefSettings } from '../../src/relief/types';

/** w×h image: a flat backdrop with a centred square of `fg`. */
function synth(w: number, h: number, bg: [number, number, number], fg: [number, number, number]): PixelImage {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const inside = x >= w / 4 && x < (3 * w) / 4 && y >= h / 4 && y < (3 * h) / 4;
    const c = inside ? fg : bg;
    const o = (y * w + x) * 4;
    data[o] = c[0]; data[o + 1] = c[1]; data[o + 2] = c[2]; data[o + 3] = 255;
  }
  return { width: w, height: h, data };
}

describe('image prep', () => {
  it('crops to the normalised box', () => {
    const img = synth(40, 20, [250, 250, 250], [200, 30, 30]);
    const out = prepImagePixels(img, { crop: { left: 0.25, top: 0.25, right: 0.75, bottom: 0.75 } });
    expect(out.width).toBe(20);
    expect(out.height).toBe(10);
    // Fully inside the square.
    expect([out.data[0], out.data[1], out.data[2]]).toEqual([200, 30, 30]);
  });

  it('applies tone with the relief preprocessor (levels stretch)', () => {
    const img = synth(8, 8, [100, 100, 100], [100, 100, 100]);
    const out = prepImagePixels(img, { levelsLow: 50, levelsHigh: 150 });
    // (100 − 50) × 255 / 100 = 127.5
    expect(out.data[0]).toBeGreaterThanOrEqual(127);
    expect(out.data[0]).toBeLessThanOrEqual(128);
  });

  it('removes a flat backdrop (despite noise) and keeps the subject', () => {
    const img = synth(32, 32, [240, 240, 240], [20, 90, 200]);
    // JPEG-like noise on the backdrop.
    for (let i = 0; i < img.data.length; i += 4) if (img.data[i] > 200) img.data[i] -= (i / 4) % 3;
    const out = prepImagePixels(img, { removeBackground: true });
    expect(out.backgroundRemoved).toBe(true);
    expect(out.data[3]).toBe(PREP_BACKGROUND_ALPHA);              // corner → transparent
    const mid = (16 * 32 + 16) * 4;
    expect(out.data[mid + 3]).toBe(255);                          // subject kept
    expect([out.data[mid], out.data[mid + 1], out.data[mid + 2]]).toEqual([20, 90, 200]);
  });

  it('reports no removal when there is no clear backdrop', () => {
    const img: PixelImage = { width: 16, height: 16, data: new Uint8ClampedArray(16 * 16 * 4) };
    for (let i = 0; i < 256; i++) { img.data[i * 4] = (i * 37) % 256; img.data[i * 4 + 1] = (i * 91) % 256; img.data[i * 4 + 2] = (i * 13) % 256; img.data[i * 4 + 3] = 255; }
    expect(prepImagePixels(img, { removeBackground: true }).backgroundRemoved).toBe(false);
  });

  it('validates API options', () => {
    expect(parseImagePrepOptions({ contrast: 0.2, crop: { left: 0.1 } })).toEqual({ contrast: 0.2, crop: { left: 0.1, top: 0, right: 1, bottom: 1 } });
    expect(() => parseImagePrepOptions({ contrast: 2 })).toThrow(/contrast/);
    expect(() => parseImagePrepOptions({ blur: 1 })).toThrow(/unknown option "blur"/);
    expect(() => parseImagePrepOptions({ crop: { left: 0.6, right: 0.4 } })).toThrow(/crop/);
    expect(() => parseImagePrepOptions({ levelsLow: 200, levelsHigh: 100 })).toThrow(/levelsHigh/);
    expect(isNoopPrep({ crop: { left: 0, top: 0, right: 1, bottom: 1 }, brightness: 0 })).toBe(true);
    expect(isNoopPrep({ removeBackground: true })).toBe(false);
    expect(describeImagePrep({ contrast: 0.2, removeBackground: true })).toBe('contrast +0.2, background removed');
  });
});

describe('image tool preview', () => {
  const img = synth(120, 80, [240, 240, 240], [200, 40, 40]);

  it('caps every tool at maxPx', () => {
    for (const tool of ['tile', 'silhouette', 'steppedRelief', 'lithophane', 'voxel', 'layeredPrint'] as const) {
      const pv = renderImageToolPreview(tool, img, {}, 48);
      expect(Math.max(pv.width, pv.height)).toBeLessThanOrEqual(48);
      expect(pv.rgba.length).toBe(pv.width * pv.height * 4);
      expect(pv.caption.length).toBeGreaterThan(0);
    }
  });

  it('silhouette cuts the backdrop to a checkerboard', () => {
    const pv = renderImageToolPreview('silhouette', img, {}, 40);
    const corner = [pv.rgba[0], pv.rgba[1], pv.rgba[2]];
    const mid = ((pv.height >> 1) * pv.width + (pv.width >> 1)) * 4;
    expect(corner[0]).toBeLessThan(80);                     // checker shade, not the light backdrop
    expect(pv.rgba[mid]).toBeGreaterThan(pv.rgba[mid + 1]); // red subject
  });

  it('voxel previews the voxel count', () => {
    expect(renderImageToolPreview('voxel', img, { maxSize: 24 }, 160).caption).toMatch(/voxels/);
  });
});

describe('relief state per object', () => {
  const tile = formatImageToolHeader({ tool: 'tile', image: 'img1', params: {} }) + 'return 1;';
  const voxel = formatImageToolHeader({ tool: 'voxel', image: 'img1', params: {} }) + 'return v;';
  const layered = 'return api.layeredPrint(api.image("img1"), {});';
  const base: ReliefSettings = { isRelief: true, layerHeight: 0.08, baseThickness: 0.6, previewMode: 'flat' };

  it('the tool header decides', () => {
    expect(isReliefObject(null, 'p1', tile)).toBe(true);
    expect(isReliefObject({ ...base, objects: ['p1', 'p2'] }, 'p2', voxel)).toBe(false);
    expect(isReliefObject(base, 'p3', layered)).toBe(false);
  });

  it('header-less objects follow the per-object list', () => {
    const s = { ...base, objects: ['p1'] };
    expect(isReliefObject(s, 'p1', 'return 1;')).toBe(true);
    expect(isReliefObject(s, 'p2', 'return 1;')).toBe(false);
    expect(isReliefObject({ ...base, isRelief: false }, 'p1', 'return 1;')).toBe(false);
  });

  it('a legacy relief session (no list) counts every header-less object', () => {
    expect(isReliefObject(base, 'any', 'return 1;')).toBe(true);
    expect(isReliefObject(base, 'any', null)).toBe(true);
  });
});
