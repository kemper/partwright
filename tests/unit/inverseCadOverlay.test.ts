// Unit tests for the inverse-CAD error-heatmap and slice-overlay renderers:
// numerics get real assertions (iou, maxDeviation), image outputs stay
// structural (buffer non-empty, sharp metadata dimensions) per the module's
// own no-pixel-perfect-asserts convention.

import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
// @ts-expect-error — plain .mjs module without type declarations
import { heatmapColors, composeHeatmap } from '../../scripts/inverse-cad/heatmap.mjs';
// @ts-expect-error — plain .mjs module without type declarations
import { renderSliceOverlay, composeSliceSheet } from '../../scripts/inverse-cad/sliceOverlay.mjs';
// @ts-expect-error — plain .mjs module without type declarations
import { buildTriBvh } from '../../scripts/inverse-cad/surfaceDistance.mjs';

// ---- procedural mesh helpers (triangle soups), same pattern as
// tests/unit/inverseCadProbe.test.ts ----

function quad(soup: number[], a: number[], b: number[], c: number[], d: number[]) {
  soup.push(...a, ...b, ...c, ...a, ...c, ...d);
}

/** Axis-aligned box soup from min corner + size, outward winding. */
function boxSoup(min: number[], size: number[]): number[] {
  const [x0, y0, z0] = min;
  const [x1, y1, z1] = [min[0] + size[0], min[1] + size[1], min[2] + size[2]];
  const soup: number[] = [];
  quad(soup, [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0]); // bottom (-z)
  quad(soup, [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]); // top (+z)
  quad(soup, [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]); // front (-y)
  quad(soup, [x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]); // back (+y)
  quad(soup, [x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]); // left (-x)
  quad(soup, [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]); // right (+x)
  return soup;
}

function mesh(soup: number[]) {
  return { triangles: Float32Array.from(soup) };
}

function cube(min: number[] = [0, 0, 0], size = 10) {
  return mesh(boxSoup(min, [size, size, size]));
}

describe('inverse-cad/heatmap.heatmapColors', () => {
  it('self-distance is ~0 for every triangle (neutral color, near-zero signed extremes)', () => {
    const m = cube();
    const bvh = buildTriBvh(m);
    const { triColors, stats } = heatmapColors(m, bvh, m, { scale_mm: 0.5 });
    expect(triColors.length).toBe((m.triangles.length / 9) * 3);
    expect(Math.abs(stats.minSigned)).toBeLessThan(1e-4);
    expect(Math.abs(stats.maxSigned)).toBeLessThan(1e-4);
    expect(stats.pctBeyondScale).toBe(0);
  });

  it('a cube translated +X reports both positive (excess) and negative (missing) signed triangles', () => {
    const target = cube([0, 0, 0], 10);
    const candidate = cube([0.5, 0, 0], 10);
    const bvhTarget = buildTriBvh(target);
    // scale_mm below the 0.5mm shift itself so the leading/trailing faces
    // (whose centroid signed distance is exactly the shift) count as
    // "beyond scale" — a scale_mm equal to the shift would sit right at the
    // boundary and not exceed it.
    const { stats } = heatmapColors(candidate, bvhTarget, target, { scale_mm: 0.3 });
    expect(stats.maxSigned).toBeGreaterThan(0.4);
    expect(stats.minSigned).toBeLessThan(-0.1);
    expect(stats.pctBeyondScale).toBeGreaterThan(0);
  });
});

describe('inverse-cad/heatmap.composeHeatmap', () => {
  it('composes a two-row PNG at the requested tile size (structural only)', async () => {
    const target = cube([0, 0, 0], 10);
    const candidate = cube([0.5, 0, 0], 10);
    const image = await composeHeatmap({ target, candidate, size: 120, views: [{ name: 'front', az: -90, el: 0 }], scale_mm: 0.3 });
    expect(image.stats).toBeTruthy();
    expect(image.stats.candidate.pctBeyondScale).toBeGreaterThan(0);
    const buf = await image.toBuffer();
    expect(buf.length).toBeGreaterThan(0);
    const meta = await sharp(buf).metadata();
    // one view per row -> width == tile size; height == 2*(label+tile) + rowGap + legend
    expect(meta.width).toBe(120);
    expect(meta.height).toBe((24 + 120) * 2 + 8 + 40);
  });
});

describe('inverse-cad/sliceOverlay.renderSliceOverlay', () => {
  it('identical cube slices: iou ~= 1, maxDeviation ~= 0', async () => {
    const m = cube([0, 0, 0], 10);
    const result = await renderSliceOverlay({ target: m, candidate: m, axis: 'z', at: 5, sizePx: 200 });
    expect(result.iou).toBeGreaterThan(0.98);
    expect(result.maxDeviation_mm).toBeLessThan(1e-3);
    expect(result.targetArea).toBeCloseTo(100, 0);
    expect(result.candArea).toBeCloseTo(100, 0);
    expect(result.png.length).toBeGreaterThan(0);
    const meta = await sharp(result.png).metadata();
    expect(meta.width).toBe(200);
    expect(meta.height).toBe(200 + 26);
  });

  it('cube vs translated cube: iou in a reduced-overlap band, maxDeviation ~= translation', async () => {
    const target = cube([0, 0, 0], 10);
    const candidate = cube([0.5, 0, 0], 10);
    const result = await renderSliceOverlay({ target, candidate, axis: 'z', at: 5, sizePx: 200 });
    // 0.5mm shift on a 10x10 square: overlap 9.5x10=95, union 10.5x10=105 -> iou ~0.905
    expect(result.iou).toBeGreaterThan(0.85);
    expect(result.iou).toBeLessThan(0.95);
    expect(result.maxDeviation_mm).toBeCloseTo(0.5, 1);
  });

  it('reports gracefully when neither mesh has geometry at the slice height', async () => {
    const m = cube([0, 0, 0], 10);
    const result = await renderSliceOverlay({ target: m, candidate: m, axis: 'z', at: 500, sizePx: 160 });
    expect(result.targetArea).toBe(0);
    expect(result.candArea).toBe(0);
    expect(result.iou).toBe(1);
    expect(result.maxDeviation_mm).toBeNull();
    expect(result.png.length).toBeGreaterThan(0);
  });
});

describe('inverse-cad/sliceOverlay.composeSliceSheet', () => {
  it('renders multiple slices and returns matching numerics (no PNG payload)', async () => {
    const target = cube([0, 0, 0], 10);
    const candidate = cube([0.5, 0, 0], 10);
    const numerics = await composeSliceSheet({
      target,
      candidate,
      slices: [
        { axis: 'z', at: 2.5, why: 'lower band' },
        { axis: 'z', at: 7.5, why: 'upper band' },
      ],
      sizePx: 160,
    });
    expect(numerics.length).toBe(2);
    for (const n of numerics) {
      expect(n.png).toBeUndefined();
      expect(n.iou).toBeGreaterThan(0.8);
      expect(n.maxDeviation_mm).toBeCloseTo(0.5, 1);
    }
  });
});
