import { describe, it, expect } from 'vitest';
import {
  viewAxes,
  carveVisualHull,
  imageToMask,
  silhouetteCoverage,
  type SilhouetteView,
} from '../../src/recon/visualHull';

// --- synthetic silhouette helpers -------------------------------------------

/** A solid filled disc centred in a w×h frame, radius as a fraction of half-min. */
function discView(azimuth: number, elevation: number, size = 64, radiusFrac = 0.9): SilhouetteView {
  const mask = new Uint8Array(size * size);
  const cx = size / 2, cy = size / 2;
  const r = (size / 2) * radiusFrac;
  const r2 = r * r;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
      if (dx * dx + dy * dy <= r2) mask[y * size + x] = 1;
    }
  return { width: size, height: size, mask, azimuth, elevation };
}

/** Turntable of disc silhouettes at evenly spaced azimuths + a couple tilts. */
function discTurntable(n: number): SilhouetteView[] {
  const views: SilhouetteView[] = [];
  for (let i = 0; i < n; i++) views.push(discView((360 / n) * i, 0));
  views.push(discView(0, 60), discView(0, -60));
  return views;
}

describe('viewAxes', () => {
  it('produces an orthonormal right-handed screen basis', () => {
    for (const [az, el] of [[0, 0], [90, 0], [45, 30], [180, -20], [270, 45]]) {
      const { camDir, xAxis, yAxis } = viewAxes(az, el);
      const len = (v: number[]) => Math.hypot(v[0], v[1], v[2]);
      expect(len(camDir)).toBeCloseTo(1, 6);
      expect(len(xAxis)).toBeCloseTo(1, 6);
      expect(len(yAxis)).toBeCloseTo(1, 6);
      // screen axes are perpendicular to each other and to the view direction
      const d = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
      expect(d(xAxis, yAxis)).toBeCloseTo(0, 6);
      expect(d(xAxis, camDir)).toBeCloseTo(0, 6);
      expect(d(yAxis, camDir)).toBeCloseTo(0, 6);
    }
  });

  it('matches the renderer convention: front looks down -Y, right down -X', () => {
    // azimuth 0 = front (+Y): camera sits on +Y, screen-right is -X (=(−1,0,0))
    const front = viewAxes(0, 0);
    expect(front.camDir[1]).toBeCloseTo(1, 6);
    expect(front.xAxis[0]).toBeCloseTo(-1, 6);
    // azimuth 90 = right (+X): camera sits on +X
    const right = viewAxes(90, 0);
    expect(right.camDir[0]).toBeCloseTo(1, 6);
  });
});

describe('carveVisualHull', () => {
  it('carves a disc turntable into a centred, roughly spherical blob', () => {
    const grid = carveVisualHull(discTurntable(16), { resolution: 48 });
    expect(grid.size).toBeGreaterThan(0);

    const b = grid.bounds()!;
    // Centred about the origin
    for (const axis of [0, 1, 2] as const) {
      expect(Math.abs(b.min[axis] + b.max[axis])).toBeLessThanOrEqual(4);
    }
    // Roughly isotropic (a hull of discs is a ball, not a slab)
    const ext = [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]];
    const maxExt = Math.max(...ext), minExt = Math.min(...ext);
    expect(minExt / maxExt).toBeGreaterThan(0.7);

    // Solid core occupied, far corner empty
    expect(grid.has(0, 0, 0)).toBe(true);
    expect(grid.has(b.max[0], b.max[1], b.max[2])).toBe(false);
  });

  it('removes any voxel that falls outside a silhouette in even one view', () => {
    // Front + right discs give a tall full-height hull, but a near-TOP view
    // that's a tiny disc looks down the Z axis — so it constrains the X/Y
    // FOOTPRINT, not the height. The footprint should be squeezed well below Z.
    const views = [discView(0, 0, 64, 0.9), discView(90, 0, 64, 0.9), discView(0, 80, 64, 0.25)];
    const grid = carveVisualHull(views, { resolution: 48 });
    const b = grid.bounds()!;
    const zExt = b.max[2] - b.min[2];
    const xExt = b.max[0] - b.min[0];
    const yExt = b.max[1] - b.min[1];
    expect(xExt).toBeLessThan(zExt);
    expect(yExt).toBeLessThan(zExt);
  });

  it('tightens toward the true shape as more views are added (monotone hull)', () => {
    const few = carveVisualHull(discTurntable(4), { resolution: 40 }).size;
    const many = carveVisualHull(discTurntable(24), { resolution: 40 }).size;
    // The visual hull only ever shrinks (or holds) with extra silhouettes.
    expect(many).toBeLessThanOrEqual(few);
  });

  it('throws on an empty silhouette rather than carving everything away', () => {
    const empty: SilhouetteView = { width: 16, height: 16, mask: new Uint8Array(256), azimuth: 0, elevation: 0 };
    expect(() => carveVisualHull([empty])).toThrow(/empty silhouette/);
  });

  it('colours voxels from the facing view when colorFromViews is set', () => {
    // Front disc is red, right disc is blue; carve a 2-view hull.
    const mk = (az: number, rgb: [number, number, number]): SilhouetteView => {
      const v = discView(az, 0, 48, 0.9);
      const rgba = new Uint8Array(48 * 48 * 4);
      for (let i = 0; i < 48 * 48; i++) {
        rgba[i * 4] = rgb[0]; rgba[i * 4 + 1] = rgb[1]; rgba[i * 4 + 2] = rgb[2]; rgba[i * 4 + 3] = 255;
      }
      return { ...v, rgba };
    };
    const grid = carveVisualHull([mk(0, [255, 0, 0]), mk(90, [0, 0, 255])], {
      resolution: 32, colorFromViews: true,
    });
    // A voxel on the +Y (front) face should read red; on +X (right) face, blue.
    const b = grid.bounds()!;
    const frontColor = grid.get(0, b.max[1], 0);
    const rightColor = grid.get(b.max[0], 0, 0);
    expect(frontColor).not.toBeNull();
    expect(rightColor).not.toBeNull();
    // red channel dominant on the front, blue channel dominant on the right
    expect((frontColor! >> 16) & 0xff).toBeGreaterThan(frontColor! & 0xff);
    expect(rightColor! & 0xff).toBeGreaterThan((rightColor! >> 16) & 0xff);
  });
});

describe('imageToMask', () => {
  it('uses the alpha channel when the image is transparent', () => {
    const rgba = new Uint8Array(4 * 4 * 4);
    // one opaque pixel, rest transparent
    rgba[3] = 255;
    const mask = imageToMask(rgba, 4, 4);
    expect(mask[0]).toBe(1);
    expect(silhouetteCoverage({ width: 4, height: 4, mask, azimuth: 0, elevation: 0 })).toBe(1);
  });

  it('chroma-keys an opaque image against an auto-detected background', () => {
    const w = 8, h = 8;
    const rgba = new Uint8Array(w * h * 4);
    // white background everywhere (opaque)
    for (let i = 0; i < w * h; i++) {
      rgba[i * 4] = 255; rgba[i * 4 + 1] = 255; rgba[i * 4 + 2] = 255; rgba[i * 4 + 3] = 255;
    }
    // a black subject block in the middle
    for (let y = 2; y < 6; y++)
      for (let x = 2; x < 6; x++) {
        const o = (y * w + x) * 4;
        rgba[o] = 0; rgba[o + 1] = 0; rgba[o + 2] = 0;
      }
    const mask = imageToMask(rgba, w, h);
    expect(mask[2 * w + 2]).toBe(1); // subject
    expect(mask[0]).toBe(0);         // corner background
    expect(silhouetteCoverage({ width: w, height: h, mask, azimuth: 0, elevation: 0 })).toBe(16);
  });
});
