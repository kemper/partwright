import { describe, it, expect } from 'vitest';
import { photoMatch, estimateBackground, buildTriangleRegions, parseColor, combinePhotoMatches, type Rgb, type RgbaImage } from '../../src/tools/photoMatch';
// @ts-expect-error — plain .mjs CLI helper (no types)
import { parsePhotoSpec, parseMergeGroups, pairPerView, indexedPath } from '../../scripts/cli/photoMatch.mjs';

// Synthetic "figure": a head disc (hair-coloured cap over a skin face) on a
// jersey torso over shorts and two shoes. Shapes are expressed in figure-local
// units (0..100 tall) so scaling/narrowing variants are one parameter away.
interface FigOpts {
  W?: number; H?: number; bg?: Rgb; scale?: number; offX?: number; offY?: number;
  hairWidth?: number; shoeWidth?: number; shortsColor?: Rgb; noise?: number;
  /** A ball disc drawn on top (figure units): centre u/v, radius r. */
  ball?: { u: number; v: number; r: number; color?: Rgb };
  /** Per-pixel backdrop (overrides bg) — e.g. a busy halftone. */
  bgFn?: (x: number, y: number) => Rgb;
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
    let c: Rgb = o.bgFn ? o.bgFn(x, y) : bg;
    // head: ellipse centred v=25, radius 25 (wide) — hair on top third
    const hx = u / hairW, hy = (v - 25) / 25;
    if (hx * hx + hy * hy <= 1) c = v < 15 ? C.hair : C.skin;
    else if (v >= 50 && v < 75 && Math.abs(u) < 18) c = C.jersey;
    else if (v >= 75 && v < 88 && Math.abs(u) < 16) c = o.shortsColor ?? C.shorts;
    else if (v >= 88 && v < 100 && Math.abs(Math.abs(u) - 9) < shoeW / 2) c = C.shoes;
    if (o.ball && (u - o.ball.u) ** 2 + (v - o.ball.v) ** 2 <= o.ball.r ** 2) c = o.ball.color ?? C.jersey;
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

// A model render + exact labels for a figure (regions listed in REGIONS
// order, plus 'ball' when drawn).
function labelled(o: FigOpts, regions: { name: string; color: Rgb }[]): { model: RgbaImage; labels: Int32Array } {
  const model = figure({ ...o, bg: [255, 0, 255] });
  // Draw the ball in a unique key colour first so its pixels can be labelled.
  const key = figure({ ...o, bg: [255, 0, 255], ball: o.ball ? { ...o.ball, color: [1, 2, 3] } : undefined });
  const labels = new Int32Array(model.width * model.height).fill(-2);
  for (let p = 0; p < labels.length; p++) {
    const c = [key.data[p * 4], key.data[p * 4 + 1], key.data[p * 4 + 2]];
    if (c[0] === 1 && c[1] === 2 && c[2] === 3) { labels[p] = regions.findIndex((r) => r.name === 'ball'); continue; }
    const i = regions.findIndex((r) => r.name !== 'ball' && r.color[0] === c[0] && r.color[1] === c[1] && r.color[2] === c[2]);
    if (i >= 0) labels[p] = i;
  }
  return { model, labels };
}

describe('photoMatch — outline & bands', () => {
  it('honours a custom band count and reports per-band edge offsets', () => {
    const r = photoMatch({ reference: figure(), model: figure({ hairWidth: 22, bg: [255, 255, 255] }), regions: REGIONS, tuning: { bands: 20 } });
    expect(r.bands).toHaveLength(20);
    // The narrower head: the photo extends past the model on BOTH sides there.
    const head = r.bands.slice(3, 8);
    for (const b of head) { expect(b.left).toBeLessThan(-1.5); expect(b.right).toBeLessThan(-1.5); }
    // Legs/shoes match: edges within a pixel or so.
    for (const b of r.bands.slice(17)) { expect(Math.abs(b.left)).toBeLessThan(2); expect(Math.abs(b.right)).toBeLessThan(2); }
    const text = r.outline.join('\n');
    expect(text).toMatch(/photo-only at bands \d+–\d+ left: up to [\d.]+% of height \([^)]*skin[^)]*\) → grow/);
    expect(text).toMatch(/photo-only at bands \d+–\d+ right/);
    expect(r.outline.length).toBeLessThanOrEqual(8);
  });

  it('reports model-only edges and interior gaps', () => {
    // Model shoes wider than the photo's → model-only at the bottom; and the
    // gap between the photo's shoes is filled by the model (interior).
    const r = photoMatch({ reference: figure({ shoeWidth: 8 }), model: figure({ shoeWidth: 18, bg: [255, 255, 255] }), regions: REGIONS, tuning: { bands: 20 } });
    const bottom = r.bands[19];
    expect(bottom.left + bottom.right).toBeGreaterThan(2);
    expect(bottom.innerModelOnly).toBeGreaterThan(1);
    expect(r.outline.join('\n')).toMatch(/model-only/);
  });

  it('identical silhouettes give an empty outline', () => {
    const r = photoMatch({ reference: figure(), model: figure({ bg: [255, 255, 255] }), regions: REGIONS, tuning: { bands: 20 } });
    expect(r.outline).toEqual([]);
  });

  it('caps the outline at outlineMaxLines', () => {
    const r = photoMatch({ reference: figure({ shoeWidth: 8 }), model: figure({ hairWidth: 20, shoeWidth: 18, bg: [255, 255, 255] }), regions: REGIONS, tuning: { bands: 30, outlineMaxLines: 2 } });
    expect(r.outline).toHaveLength(2);
  });
});

describe('photoMatch — ambiguous regions, merge & ignore', () => {
  const WITH_BALL = [...REGIONS, { name: 'ball', color: [250, 250, 250] as Rgb }];
  const ballFig = { ball: { u: -14, v: 62, r: 8 } };

  it('flags same-colour touching parts as low-confidence and suppresses their shape findings', () => {
    // Photo ball sits lower than the model's: without the flag, the jersey/ball
    // split would produce bogus size findings.
    const { model, labels } = labelled({ ball: { u: -14, v: 56, r: 8 } }, WITH_BALL);
    const r = photoMatch({ reference: figure({ ball: { u: -14, v: 66, r: 8 } }), model, modelLabels: labels, regions: WITH_BALL });
    const jersey = r.regions.find((x) => x.name === 'jersey')!, ball = r.regions.find((x) => x.name === 'ball')!;
    expect(jersey.lowConfidence).toMatch(/ball \(same colour, touching\)/);
    expect(ball.lowConfidence).toMatch(/jersey/);
    expect(r.worst.join('\n')).not.toMatch(/^(jersey|ball): model (region|sits)/m);
    expect(r.warnings.join('\n')).toMatch(/low-confidence regions.*merge \[\["jersey","ball"\]\]/);
    // Shoes are the same white but don't touch the jersey: not flagged.
    expect(r.regions.find((x) => x.name === 'shoes')!.lowConfidence).toBeUndefined();
  });

  it('merge scores a group as one region and clears the flag', () => {
    const { model, labels } = labelled(ballFig, WITH_BALL);
    const r = photoMatch({ reference: figure(ballFig), model, modelLabels: labels, regions: WITH_BALL, merge: [['jersey', 'ball'], ['nope']] });
    const merged = r.regions.find((x) => x.name === 'jersey+ball')!;
    expect(merged).toBeDefined();
    expect(merged.lowConfidence).toBeUndefined();
    expect(merged.iou).toBeGreaterThan(0.85);
    expect(r.regions.some((x) => x.name === 'ball' || x.name === 'jersey')).toBe(false);
    expect(r.warnings.join('\n')).toMatch(/merge: no region named nope/);
  });

  it('ignore drops regions from the results but keeps the silhouette', () => {
    const r = photoMatch({ reference: figure({ shoeWidth: 14 }), model: figure({ shoeWidth: 7, bg: [255, 255, 255] }), regions: REGIONS, ignore: ['shoes', 'bogus'] });
    expect(r.regions.some((x) => x.name === 'shoes')).toBe(false);
    expect(r.worst.join('\n')).not.toMatch(/shoes: model region/);
    expect(r.silhouetteIoU).toBeLessThan(0.99);
    expect(r.warnings.join('\n')).toMatch(/ignore: no region named bogus/);
  });

  it('flags regions whose photo colours converge together', () => {
    // Photo: shorts painted the jersey's white; model: blue shorts. The two
    // clusters land on the same white → low confidence.
    const ref = figure({ shortsColor: [244, 244, 244] });
    const r = photoMatch({ reference: ref, model: figure({ bg: [255, 0, 255] }), modelBg: [255, 0, 255], regions: REGIONS });
    const shorts = r.regions.find((x) => x.name === 'shorts')!;
    expect(shorts.lowConfidence ?? '').toMatch(/photo colour matches jersey's/);
    const off = photoMatch({ reference: ref, model: figure({ bg: [255, 0, 255] }), modelBg: [255, 0, 255], regions: REGIONS, tuning: { ambiguousDeltaE: 0 } });
    expect(off.regions.every((x) => !x.lowConfidence)).toBe(true);
  });
});

describe('photoMatch — segmentation inputs', () => {
  // Busy backdrop: random tiles of four blues (no figure colour among them).
  const BLUES: Rgb[] = [[10, 30, 120], [40, 90, 220], [90, 150, 250], [20, 60, 170]];
  const busy = (x: number, y: number): Rgb => BLUES[((((x >> 3) * 7919) ^ ((y >> 3) * 104729)) % 4) & 3];

  it('a manual mask overrides background estimation (any mask resolution)', () => {
    const ref = figure({ bgFn: busy });
    // Mask at 2× the photo's resolution: white where the clean figure is.
    const clean = figure({ W: 480, H: 520, scale: 4, offY: 20 });
    const mask = { width: 480, height: 520, data: new Uint8ClampedArray(480 * 520 * 4) };
    for (let p = 0; p < 480 * 520; p++) {
      const fg = clean.data[p * 4] + clean.data[p * 4 + 1] + clean.data[p * 4 + 2] > 0;
      mask.data.fill(fg ? 255 : 0, p * 4, p * 4 + 3); mask.data[p * 4 + 3] = 255;
    }
    const r = photoMatch({ reference: ref, mask, model: figure({ bg: [255, 255, 255] }), regions: REGIONS });
    expect(r.segmentation.photo.method).toBe('mask');
    expect(r.silhouetteIoU).toBeGreaterThan(0.95);
  });

  it('auto mode falls back to the colour model on a busy backdrop', () => {
    const ref = figure({ bgFn: busy });
    const border = photoMatch({ reference: ref, model: figure({ bg: [255, 255, 255] }), regions: REGIONS, bgMode: 'border' });
    const auto = photoMatch({ reference: ref, model: figure({ bg: [255, 255, 255] }), regions: REGIONS });
    expect(auto.segmentation.photo.method).toBe('grabcut');
    expect(auto.warnings.join('\n')).toMatch(/colour model/);
    expect(auto.silhouetteIoU).toBeGreaterThan(0.85);
    expect(auto.silhouetteIoU).toBeGreaterThan(border.silhouetteIoU);
    // A clean backdrop stays on the border path.
    expect(photoMatch({ reference: figure(), model: figure({ bg: [255, 255, 255] }), regions: REGIONS }).segmentation.photo.method).toBe('border');
  });

  it('warns when the photo subject is too small to judge', () => {
    const small = photoMatch({ reference: figure({ W: 120, H: 130, scale: 1, offY: -10 }), model: figure({ bg: [255, 255, 255] }), regions: REGIONS });
    expect(small.segmentation.photo.subjectPx).toBeLessThan(120);
    expect(small.warnings.join('\n')).toMatch(/only \d+ px tall \(< 300\)/);
    const big = photoMatch({ reference: figure({ W: 500, H: 760, scale: 7, offY: 0 }), model: figure({ bg: [255, 255, 255] }), regions: REGIONS });
    expect(big.segmentation.photo.subjectPx).toBeGreaterThan(300);
    expect(big.warnings.join('\n')).not.toMatch(/px tall/);
  });
});

describe('photoMatch — multi-view', () => {
  it('combines per-view scores into a mean + interleaved findings', () => {
    const a = photoMatch({ reference: figure(), model: figure({ bg: [255, 255, 255] }), regions: REGIONS });
    const b = photoMatch({ reference: figure(), model: figure({ hairWidth: 20, bg: [255, 255, 255] }), regions: REGIONS });
    const c = combinePhotoMatches([{ label: 'front', result: a }, { label: 'back', result: b }]);
    expect(c.silhouetteIoU).toBeCloseTo((a.silhouetteIoU + b.silhouetteIoU) / 2, 2);
    expect(c.minIoU).toBe(b.silhouetteIoU);
    expect(c.views.map((v) => v.label)).toEqual(['front', 'back']);
    expect(c.worst[0]).toMatch(/^\[back\] /);
  });
});

describe('model:preview photo-match CLI helpers', () => {
  it('parses path@camera specs without eating @ in file names', () => {
    expect(parsePhotoSpec('f.png@0,0', () => false)).toEqual({ path: 'f.png', view: { name: '0,0', az: 0, el: 0 } });
    expect(parsePhotoSpec('b.png@-90.5,10', () => false).view).toEqual({ name: '-90.5,10', az: -90.5, el: 10 });
    expect(parsePhotoSpec('b.png@back', () => false).view.name).toBe('back');
    expect(parsePhotoSpec('photo@2x.png', () => false)).toEqual({ path: 'photo@2x.png', view: null });
    expect(parsePhotoSpec('odd@1,2', () => true)).toEqual({ path: 'odd@1,2', view: null });
    expect(parsePhotoSpec('x.png@sideways', () => false).error).toMatch(/neither/);
  });
  it('parses merge groups and pairs per-view flags', () => {
    expect(parseMergeGroups(['jersey+ball+socks', 'a,b;c+d'])).toEqual([['jersey', 'ball', 'socks'], ['a', 'b'], ['c', 'd']]);
    expect(pairPerView([], 2, '--x').values).toEqual([null, null]);
    expect(pairPerView(['a'], 3, '--x').values).toEqual(['a', 'a', 'a']);
    expect(pairPerView(['a'], 2, '--m', false).error).toMatch(/once per photo/);
    expect(pairPerView(['a', 'b'], 2, '--m', false).values).toEqual(['a', 'b']);
    expect(indexedPath('/t/o.png', 0)).toBe('/t/o.png');
    expect(indexedPath('/t/o.png', 2)).toBe('/t/o-2.png');
  });
});
