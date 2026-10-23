import { describe, it, expect } from 'vitest';
import { photoMatch, estimateBackground, buildTriangleRegions, parseColor, type Rgb, type RgbaImage } from '../../src/tools/photoMatch';

// Synthetic "figure": a head disc (hair-coloured cap over a skin face) on a
// jersey torso over shorts and two shoes. Shapes are expressed in figure-local
// units (0..100 tall) so scaling/narrowing variants are one parameter away.
interface FigOpts {
  W?: number; H?: number; bg?: Rgb; scale?: number; offX?: number; offY?: number;
  hairWidth?: number; shoeWidth?: number; shortsColor?: Rgb; noise?: number;
}
const C = {
  hair: [20, 20, 22] as Rgb,
  skin: [240, 201, 162] as Rgb,
  jersey: [246, 246, 246] as Rgb,
  shorts: [31, 95, 200] as Rgb,
  shoes: [235, 235, 235] as Rgb,
};
function figure(o: FigOpts = {}): RgbaImage {
  const W = o.W ?? 240, H = o.H ?? 260, bg = o.bg ?? [0, 0, 0];
  const s = o.scale ?? 2, ox = (o.offX ?? 0) + W / 2, oy = (o.offY ?? 0) + 20;
  const hairW = o.hairWidth ?? 30, shoeW = o.shoeWidth ?? 12;
  const data = new Uint8ClampedArray(W * H * 4);
  let seed = 12345;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff - 0.5; };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const u = (x - ox) / s, v = (y - oy) / s; // figure units, v down from top
    let c: Rgb = bg;
    // head: ellipse centred v=25, radius 25 (wide) — hair on top third
    const hx = u / hairW, hy = (v - 25) / 25;
    if (hx * hx + hy * hy <= 1) c = v < 15 ? C.hair : C.skin;
    else if (v >= 50 && v < 75 && Math.abs(u) < 18) c = C.jersey;
    else if (v >= 75 && v < 88 && Math.abs(u) < 16) c = o.shortsColor ?? C.shorts;
    else if (v >= 88 && v < 100 && Math.abs(Math.abs(u) - 9) < shoeW / 2) c = C.shoes;
    const n = o.noise ?? 0;
    const o4 = (y * W + x) * 4;
    data[o4] = c[0] + rnd() * n; data[o4 + 1] = c[1] + rnd() * n; data[o4 + 2] = c[2] + rnd() * n; data[o4 + 3] = 255;
  }
  return { width: W, height: H, data };
}
const REGIONS = Object.entries(C).map(([name, color]) => ({ name, color }));

describe('photoMatch', () => {
  it('identical shape scores IoU ≈ 1 with no findings', () => {
    const img = figure();
    const r = photoMatch({ reference: img, model: figure({ bg: [255, 0, 255] }), modelBg: [255, 0, 255], regions: REGIONS });
    expect(r.silhouetteIoU).toBeGreaterThan(0.97);
    expect(Math.abs(r.aspect.ratio - 1)).toBeLessThan(0.03);
    for (const reg of r.regions) expect(reg.iou).toBeGreaterThan(0.85);
    expect(r.worst).toEqual(['no significant mismatch found']);
  });

  it('is invariant to scale and position (normalised by bbox), and robust to noise', () => {
    const ref = figure({ scale: 2, noise: 18 });
    const model = figure({ scale: 1.3, offX: 30, offY: 10, bg: [255, 255, 255] });
    const r = photoMatch({ reference: ref, model, regions: REGIONS });
    expect(r.silhouetteIoU).toBeGreaterThan(0.93);
  });

  it('flags a narrower head in the top bands', () => {
    const r = photoMatch({ reference: figure(), model: figure({ hairWidth: 22, bg: [255, 255, 255] }), regions: REGIONS });
    expect(r.silhouetteIoU).toBeLessThan(0.95);
    // Head occupies the top half of the figure → bands 0..4.
    const top = r.bands.slice(1, 4);
    for (const b of top) expect(b.widthDiffPct).toBeLessThan(-12);
    const bottom = r.bands.slice(6);
    for (const b of bottom) expect(Math.abs(b.widthDiffPct)).toBeLessThan(25);
    expect(r.worst.join('\n')).toMatch(/narrower/);
    const hair = r.regions.find((x) => x.name === 'hair')!;
    expect(hair.widthRatio!).toBeLessThan(0.85);
  });

  it('flags smaller shoes as a region finding', () => {
    const r = photoMatch({ reference: figure({ shoeWidth: 14 }), model: figure({ shoeWidth: 7, bg: [255, 255, 255] }), regions: REGIONS });
    const shoes = r.regions.find((x) => x.name === 'shoes')!;
    expect(shoes.areaRatio!).toBeLessThan(0.7);
    expect(r.worst.join('\n')).toMatch(/shoes/);
  });

  it('detects a region colour mismatch', () => {
    const r = photoMatch({ reference: figure({ shortsColor: [200, 30, 30] }), model: figure({ bg: [255, 255, 255] }), regions: REGIONS });
    const shorts = r.regions.find((x) => x.name === 'shorts')!;
    expect(shorts.colorShift!).toBeGreaterThan(40);
    expect(r.worst.join('\n')).toMatch(/shorts: colour mismatch/);
  });

  it('accepts an exact model label buffer', () => {
    const model = figure({ bg: [255, 255, 255] });
    const labels = new Int32Array(model.width * model.height).fill(-2);
    for (let p = 0; p < labels.length; p++) {
      const c = [model.data[p * 4], model.data[p * 4 + 1], model.data[p * 4 + 2]];
      const i = REGIONS.findIndex((r) => r.color[0] === c[0] && r.color[1] === c[1] && r.color[2] === c[2]);
      if (i >= 0) labels[p] = i;
    }
    const r = photoMatch({ reference: figure(), model, modelLabels: labels, regions: REGIONS });
    expect(r.silhouetteIoU).toBeGreaterThan(0.97);
    expect(r.regions.find((x) => x.name === 'shoes')!.iou).toBeGreaterThan(0.8);
  });

  it('honours a crop rect', () => {
    // Pad the reference with a big red block on the right; cropping it away
    // restores the match.
    const base = figure({ W: 240 });
    const W = 400, H = base.height;
    const data = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4;
      if (x < 240) { const s = (y * 240 + x) * 4; for (let c = 0; c < 4; c++) data[o + c] = base.data[s + c]; }
      else { data[o] = 0; data[o + 1] = 0; data[o + 2] = 0; data[o + 3] = 255; if (x > 300 && x < 380 && y > 60 && y < 200) data[o] = 220; }
    }
    const ref = { width: W, height: H, data };
    const model = figure({ bg: [255, 255, 255] });
    const bad = photoMatch({ reference: ref, model, regions: REGIONS });
    const good = photoMatch({ reference: ref, crop: { x: 0, y: 0, w: 240, h: H }, model, regions: REGIONS });
    expect(good.silhouetteIoU).toBeGreaterThan(0.97);
    expect(good.silhouetteIoU).toBeGreaterThan(bad.silhouetteIoU - 1e-9);
  });

  it('uses an explicit bg colour + tolerance', () => {
    const ref = figure({ bg: [30, 80, 200] });
    const r = photoMatch({ reference: ref, bg: '#1e50c8', bgTolerance: 30, model: figure({ bg: [255, 255, 255] }), regions: REGIONS });
    // Shorts (31,95,200) are within tolerance of the backdrop → they drop out,
    // but the rest of the figure still segments.
    expect(r.segmentation.photo.bgColors).toEqual(['#1e50c8']);
    expect(r.silhouetteIoU).toBeGreaterThan(0.6);
  });
});

describe('estimateBackground', () => {
  const ring = (W: number, H: number, fill: (x: number, y: number) => Rgb) => {
    const rgb = new Float32Array(W * H * 3);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const c = fill(x, y); rgb.set(c, (y * W + x) * 3); }
    return { width: W, height: H, rgb };
  };
  it('finds a dark background with a tight tolerance (dark hair stays foreground)', () => {
    let s = 1; const n = () => { s = (s * 16807) % 2147483647; return (s / 2147483647) * 3; };
    const r = estimateBackground(ring(200, 120, () => [n(), n(), n()]), 10);
    expect(r.colors.length).toBe(1);
    expect(Math.max(...r.colors[0])).toBeLessThan(5);
    expect(r.tol[0]).toBeLessThan(18);
  });
  it('finds a light background', () => {
    const r = estimateBackground(ring(200, 120, () => [240, 238, 236]), 10);
    expect(r.colors[0][0]).toBeGreaterThan(230);
  });
  it('finds both colours of a two-tone halftone backdrop', () => {
    const r = estimateBackground(ring(200, 120, (x, y) => ((x >> 2) + (y >> 2)) % 3 === 0 ? [5, 10, 30] : [30, 80, 210]), 10);
    expect(r.colors.length).toBe(2);
  });
  it('ignores a thin frame at the outer edge', () => {
    const r = estimateBackground(ring(300, 160, (x, y) => (x < 2 || y < 2 || x > 297 || y > 157) ? [200, 180, 60] : [0, 0, 0]), 10);
    expect(r.colors).toEqual([[0, 0, 0]]);
  });
  it('figure on a light background segments as well as on a dark one', () => {
    const light = photoMatch({ reference: figure({ bg: [235, 235, 240], noise: 10 }), model: figure({ bg: [0, 0, 0] }), regions: REGIONS });
    expect(light.silhouetteIoU).toBeGreaterThan(0.8);
  });
});

describe('buildTriangleRegions', () => {
  it('groups by label, falls back to colour, and excludes labels', () => {
    const triColors = new Uint8Array([255, 0, 0, 255, 0, 0, 0, 0, 255, 10, 10, 10]);
    const triLabel = new Int32Array([0, 0, -1, 1]);
    const r = buildTriangleRegions(4, triColors, triLabel, ['shirt', 'base'], ['base']);
    expect(r.regions).toEqual([{ name: 'shirt', color: '#ff0000' }, { name: 'color #0000ff', color: '#0000ff' }]);
    expect([...r.triRegion]).toEqual([0, 0, 1, -3]);
  });
  it('parses colours', () => {
    expect(parseColor('#fff')).toEqual([255, 255, 255]);
    expect(parseColor([0.5, 0.25, 1])).toEqual([128, 64, 255]);
    expect(parseColor('nope')).toBeNull();
  });
});
