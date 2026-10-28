// The metric head proxy (src/geometry/headform.ts) against real manifold-3d:
// it builds one watertight head at the stated size, every landmark sits on its
// surface close to where the measurements put it, and options are validated.

import { describe, it, expect, beforeAll } from 'vitest';
import { createHeadform, __headformTestables__ } from '../../src/geometry/headform';
import { createSdfNamespace } from '../../src/geometry/sdf';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let headform: any, sdf: any;

beforeAll(async () => {
  const Module = (await import('manifold-3d')).default;
  const mod = await Module();
  mod.setup();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sdf = createSdfNamespace(mod.Manifold, ((m: unknown) => m) as any);
  headform = createHeadform(sdf);
});

const OPTION_SETS = [{}, { sex: 'female', size: 'S' }, { sex: 'male', size: 'L' }];

describe('headform', () => {
  it('builds one watertight head at the stated size', () => {
    const m = headform({ neck: false });
    expect(m.status()).toBe('NoError');
    expect(m.decompose().length).toBe(1);
    expect(m.genus()).toBe(0);
    const bb = m.boundingBox();
    const { measurements: ms, points } = headform.landmarks({ neck: false });
    expect(bb.max[2]).toBeCloseTo(ms.vertexHeight, -0.5);
    expect(bb.min[1]).toBeCloseTo(points.pronasale[1], -0.5);
    // The skull's breadth (ears aside) and the girth above the brow.
    const slice = m.slice(points.glabella[2] + 8).toPolygons() as [number, number][][];
    const ring = slice.reduce((a, b) => (b.length > a.length ? b : a));
    let perimeter = 0, minX = Infinity, maxX = -Infinity;
    for (let i = 0; i < ring.length; i++) {
      const [ax, ay] = ring[i], [bx, by] = ring[(i + 1) % ring.length];
      perimeter += Math.hypot(bx - ax, by - ay);
      minX = Math.min(minX, ax); maxX = Math.max(maxX, ax);
    }
    expect(Math.abs(perimeter / ms.circumference - 1)).toBeLessThan(0.04);
    expect(Math.abs((maxX - minX) / ms.breadth - 1)).toBeLessThan(0.04);
  });

  it('puts every landmark on the surface, within 3 mm of its nominal spot', () => {
    const { resolve, landmarksOf, surfaceLandmarks, headformSdf } = __headformTestables__;
    for (const opts of OPTION_SETS) {
      const r = resolve(opts, 't');
      const node = headformSdf(sdf, r.measurements, true);
      const nominal = landmarksOf(r.measurements);
      const onSkin = surfaceLandmarks(node, r.measurements);
      for (const key of Object.keys(nominal) as (keyof typeof nominal)[]) {
        const p = onSkin[key], q = nominal[key];
        expect(Math.abs(node.evaluate(p[0], p[1], p[2])), `${key} on the surface`).toBeLessThan(0.01);
        expect(Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]), `${key} ${JSON.stringify(opts)}`).toBeLessThan(3);
      }
    }
  });

  it('reports what the mesh achieves: close to the presets, honest under overrides', () => {
    for (const opts of OPTION_SETS) {
      const { measurements: want, achieved } = headform.landmarks(opts);
      for (const [key, got] of Object.entries(achieved) as [string, number][]) {
        expect(Math.abs(got / (want as Record<string, number>)[key] - 1), `${key} ${JSON.stringify(opts)}`).toBeLessThan(0.05);
      }
    }
    // A longer head is a bigger girth, whatever `circumference` says.
    const long = headform.landmarks({ length: 215 });
    expect(long.measurements.circumference).toBe(567.8);
    expect(long.achieved.circumference).toBeGreaterThan(long.measurements.circumference + 25);
    expect(Math.abs(long.achieved.length - 215)).toBeLessThan(4);
  });

  it('uses the survey means: ANSUR II for the head, NIOSH 2003 for the nose and jaw', () => {
    const male = headform.landmarks({ sex: 'male' }).measurements;
    const female = headform.landmarks({ sex: 'female' }).measurements;
    // ANSUR II (2012) public data, means.
    expect(male).toMatchObject({ circumference: 574.4, length: 199.5, breadth: 154.3, faceHeight: 122.6, pupillaryDistance: 64 });
    expect(female).toMatchObject({ circumference: 561.1, length: 189.8, breadth: 147.8, faceHeight: 113.1, pupillaryDistance: 61.7 });
    // NIOSH head-and-face survey (Zhuang & Bradtmiller 2005, Table VI), means.
    expect(male).toMatchObject({ bigonialBreadth: 120.4, noseBreadth: 36.6, noseProtrusion: 21.1, noseLength: 52 });
    expect(female).toMatchObject({ bigonialBreadth: 110.1, noseBreadth: 33.2, noseProtrusion: 19.8, noseLength: 48.2 });
    // Neutral is the mean of the two.
    expect(headform.landmarks().measurements.noseBreadth).toBeCloseTo((36.6 + 33.2) / 2, 1);
  });

  it('builds a nose that stands proud of the cheeks', () => {
    const { resolve, surfaceLandmarks, headformSdf } = __headformTestables__;
    const r = resolve({}, 't');
    const node = headformSdf(sdf, r.measurements, true);
    const p = surfaceLandmarks(node, r.measurements);
    // Depth of the face surface at (x, z), walking in from the front.
    const front = (x: number, z: number) => {
      let lo = -30, hi = -180;
      for (let i = 0; i < 40; i++) {
        const mid = (lo + hi) / 2;
        if (node.evaluate(x, mid, z) > 0) hi = mid; else lo = mid;
      }
      return lo;
    };
    const midNose = (p.sellion[2] + p.subnasale[2]) / 2;
    // Mid-nose, the dorsum is well in front of the cheek 20 mm to the side;
    // at the tip, the nose stands ~25 mm proud of it.
    expect(front(20, midNose) - front(0, midNose)).toBeGreaterThan(10);
    expect(front(25, p.pronasale[2]) - p.pronasale[1]).toBeGreaterThan(20);
  });

  it('refuses to report a landmark it cannot put on the surface', () => {
    const { resolve, surfaceLandmarks } = __headformTestables__;
    // A solid that swallows every landmark's search range has no surface to find.
    expect(() => surfaceLandmarks(sdf.sphere(2000), resolve({}, 't').measurements)).toThrow(/couldn't place the \w+ landmark/);
  });

  it('sizes, sexes and overrides change the measurements; landmarks follow the frame', () => {
    const m = headform.landmarks().measurements;
    expect(headform.landmarks({ size: 'L' }).measurements.length).toBeCloseTo(m.length * 1.05, 0);
    expect(headform.landmarks({ sex: 'female' }).measurements.circumference).toBe(561.1);
    expect(headform.landmarks({ circumference: 600 }).measurements.length).toBeCloseTo(m.length * 600 / m.circumference, 0);
    expect(headform.landmarks({ pupillaryDistance: 70 }).measurements.pupillaryDistance).toBe(70);
    const p = headform.landmarks().points;
    expect(p.pupilL[0]).toBeGreaterThan(0);          // +X is the wearer's left
    expect(p.pronasale[1]).toBeLessThan(p.sellion[1]); // the face points −Y
    expect(p.vertex[2]).toBeGreaterThan(p.menton[2]);
    expect(p.tragionL[0]).toBeCloseTo(-p.tragionR[0], 3);
  });

  it('refuses bad options', () => {
    expect(() => headform({ size: 'XL' })).toThrow(/headform\(opts\)\.size/);
    expect(() => headform({ color: 'red' })).toThrow(/color/);
    expect(() => headform.landmarks({ pupillaryDistance: 200 })).toThrow(/don't describe a head/);
    expect(() => headform({ edgeLength: 0.5 })).toThrow(/edgeLength/);
  });
});
