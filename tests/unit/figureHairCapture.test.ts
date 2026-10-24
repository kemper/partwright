// Unit tests for the 'captured' hair style: the pure field format
// (src/geometry/hairCapture/field.ts), the mesh capture
// (src/geometry/hairCapture/capture.ts) and the figure glue
// (src/geometry/figureHairCapture.ts). Pure logic — nothing is meshed.

import { describe, it, expect } from 'vitest';
import {
  assertGridSize, bakeField, blurGrid, bytesToB64, cellDir, decodePreset, DEFAULT_KNOBS, dilateGrid, fieldValue, quantizeRadii, sampleCubic, sourceDir,
  type HairCapturePreset, type HairGrids,
} from '../../src/geometry/hairCapture/field';
import { captureHair, landmarksFromParts, removeSmallIslands, toLandmark, type HeadLandmarks } from '../../src/geometry/hairCapture/capture';
import { HAIR_PRESETS } from '../../src/geometry/hairCapture/presets';
import { carryField, measureHeadLandmarks } from '../../src/geometry/figureHairCapture';
import { __figureTestables__, createFigureNamespace } from '../../src/geometry/sdfFigure';
import { __testables__ as sdfT } from '../../src/geometry/sdf';
import type { SdfApi, Vec3 } from '../../src/geometry/sdfFigure';

const { buildRig, buildHair, buildHead } = __figureTestables__;
const api: SdfApi = {
  sphere: sdfT.primSphere,
  ellipsoid: sdfT.primEllipsoid,
  box: sdfT.primBox,
  roundedBox: sdfT.primRoundedBox,
  cylinder: sdfT.primCylinder,
  roundedCylinder: sdfT.primRoundedCylinder,
  capsule: sdfT.primCapsule,
  union: (...nodes) => nodes.reduce((a, b) => sdfT.opUnion(a, b)),
  __fineHands: (node, regions) => sdfT.opFineHands(node, regions),
} as unknown as SdfApi;
createFigureNamespace(api);

/** A small synthetic preset: radius = f(az, el), mask = el − 10 (hair above 10°). */
function synthPreset(f: (az: number, el: number) => number): HairCapturePreset {
  const nAz = 32, nEl = 16, g = { nAz, nEl, elMin: -90, elMax: 90 };
  const rb = new Uint8Array(nAz * nEl), mb = new Int8Array(nAz * nEl);
  for (let j = 0; j < nEl; j++) for (let i = 0; i < nAz; i++) {
    const [az, el] = cellDir(g, i, j);
    rb[j * nAz + i] = Math.round(((f(az, el) - 1) / 1) * 255);
    mb[j * nAz + i] = Math.max(-127, Math.min(127, Math.round((el - 10) * 4)));
  }
  return {
    name: 'synth', source: 'test', nAz, nEl, elMin: -90, elMax: 90, centre: [0, 0, 0], shape: [1, 1, 1],
    rMin: 1, rMax: 2, maskScale: 4, radius: bytesToB64(rb), mask: bytesToB64(new Uint8Array(mb.buffer)),
  };
}

/** A UV-sphere triangle soup (radius r about c), keeping triangles whose centroid passes `keep`. */
function sphereSoup(r: number, c: Vec3, keep: (p: Vec3) => boolean, nu = 48, nv = 24): Float32Array {
  const P = (u: number, v: number): Vec3 => {
    const th = (u / nu) * 2 * Math.PI, ph = -Math.PI / 2 + (v / nv) * Math.PI;
    return [c[0] + r * Math.cos(ph) * Math.cos(th), c[1] + r * Math.cos(ph) * Math.sin(th), c[2] + r * Math.sin(ph)];
  };
  const out: number[] = [];
  for (let v = 0; v < nv; v++) for (let u = 0; u < nu; u++) {
    const a = P(u, v), b = P(u + 1, v), cc = P(u + 1, v + 1), d = P(u, v + 1);
    for (const t of [[a, b, cc], [a, cc, d]]) {
      const m: Vec3 = [(t[0][0] + t[1][0] + t[2][0]) / 3, (t[0][1] + t[1][1] + t[2][1]) / 3, (t[0][2] + t[1][2] + t[2][2]) / 3];
      if (keep(m)) out.push(...t[0], ...t[1], ...t[2]);
    }
  }
  return new Float32Array(out);
}

describe('captured hair — field decode / interpolation', () => {
  it('decodes the bundled preset to grids in range, and fits the size budget', () => {
    for (const p of Object.values(HAIR_PRESETS)) {
      const g = decodePreset(p);
      expect(g.radius.length).toBe(p.nAz * p.nEl);
      for (const v of g.radius) { expect(v).toBeGreaterThanOrEqual(p.rMin - 1e-9); expect(v).toBeLessThanOrEqual(p.rMax + 1e-9); }
      // Hair over the crown, none straight down the face.
      expect(sampleCubic(g.mask, g, 180, 60)).toBeGreaterThan(0);
      expect(sampleCubic(g.mask, g, 0, -40)).toBeLessThan(0);
      expect(p.radius.length + p.mask.length).toBeLessThan(25000);
    }
  });

  it('round-trips quantized grids and interpolates exactly at cell centres', () => {
    const f = (az: number, el: number): number => 1.5 + 0.3 * Math.cos((az * Math.PI) / 180) * Math.cos((el * Math.PI) / 180);
    const g = decodePreset(synthPreset(f));
    for (let j = 1; j < g.nEl - 1; j += 3) for (let i = 0; i < g.nAz; i += 5) {
      const [az, el] = cellDir(g, i, j);
      expect(sampleCubic(g.radius, g, az, el)).toBeCloseTo(g.radius[j * g.nAz + i], 9);
      expect(Math.abs(g.radius[j * g.nAz + i] - f(az, el))).toBeLessThan(0.5 / 255 + 1e-9);
    }
  });

  it('is smooth between cells, wraps azimuth and never rings past its neighbours when clamped', () => {
    const g = decodePreset(synthPreset((az) => 1.5 + 0.4 * Math.sin((az * Math.PI) / 180)));
    // Continuity across the ±180 seam.
    expect(sampleCubic(g.radius, g, 179.9, 20)).toBeCloseTo(sampleCubic(g.radius, g, -179.9, 20), 2);
    // A smooth function is reproduced between centres to near quantization error.
    for (const az of [-133.3, -12.7, 41.1, 97.9]) {
      expect(Math.abs(sampleCubic(g.radius, g, az, 20) - (1.5 + 0.4 * Math.sin((az * Math.PI) / 180)))).toBeLessThan(0.01);
    }
    // A cliff: the clamped sample stays inside its 2×2 neighbourhood (no overshoot).
    const cliff: HairGrids = { ...g, radius: g.radius.map((_, k) => ((k % g.nAz) < g.nAz / 2 ? 1 : 2)) };
    for (let az = -179; az < 180; az += 3.7) {
      const v = sampleCubic(cliff.radius, cliff, az, 0, true);
      expect(v).toBeGreaterThanOrEqual(1 - 1e-12);
      expect(v).toBeLessThanOrEqual(2 + 1e-12);
    }
  });

  it('blur and dilation behave', () => {
    const g = decodePreset(synthPreset(() => 1.5));
    const spike = new Float64Array(g.radius.length); spike[8 * g.nAz + 5] = 1;
    const d = dilateGrid(spike, g, 1);
    expect(d[8 * g.nAz + 6]).toBe(1);
    expect(d[9 * g.nAz + 4]).toBe(1);
    expect(d[8 * g.nAz + 8]).toBe(0);
    const b = blurGrid(g.radius, g, 2);
    for (const v of b) expect(v).toBeCloseTo(g.radius[0], 9);   // constant stays constant
  });
});

describe('captured hair — robustness', () => {
  it('rejects odd, zero and NaN grid sizes with a clear error', () => {
    for (const [a, e] of [[127, 64], [128, 63], [0, 64], [NaN, 64], [128, 0.5]] as const) {
      expect(() => assertGridSize(a, e, 'test')).toThrow(/positive even integers/);
      expect(() => decodePreset({ ...HAIR_PRESETS.tsubasa, nAz: a, nEl: e })).toThrow(/positive even integers/);
    }
    const lm: HeadLandmarks = { origin: [0, 0, 0], forward: [1, 0, 0], left: [0, 1, 0], up: [0, 0, 1], W: 1, H: 1 };
    const tris = sphereSoup(1.5, [0, 0, 0], (p) => p[2] > 0, 12, 6);
    expect(() => captureHair(tris, lm, { name: 'x', source: 't', nAz: 63, nEl: 32 })).toThrow(/positive even integers/);
    expect(() => captureHair(tris, lm, { name: 'x', source: 't', nAz: 64, nEl: NaN })).toThrow(/positive even integers/);
    expect(() => assertGridSize(64, 32, 'test')).not.toThrow();
  });

  it('quantizes a constant radius field without dividing by zero', () => {
    const q = quantizeRadii(new Float64Array(16).fill(1.25));
    expect(q.rMax).toBeGreaterThan(q.rMin);
    for (const b of q.bytes) expect(Number.isFinite(b)).toBe(true);
    const g = decodePreset({ ...synthPreset(() => 1.5), rMin: q.rMin, rMax: q.rMax });
    for (const v of g.radius) expect(Number.isFinite(v)).toBe(true);
  });

  it('carries the field exactly, grows the bounds only by pad, and treats NaN as outside', () => {
    const box = sdfT.primBox(4) as unknown as Parameters<typeof carryField>[0];
    const ball = carryField(box, (x, y, z) => Math.hypot(x, y, z) - 1, 0.25);
    expect(ball.evaluate(0, 0, 0)).toBeCloseTo(-1, 9);
    expect(ball.evaluate(1.5, 0, 0)).toBeCloseTo(0.5, 9);
    expect((ball as unknown as { bounds(): { max: number[] } }).bounds().max[0]).toBeCloseTo(2.25, 9);
    const broken = carryField(box, () => NaN, 0.25);
    expect(broken.evaluate(0, 0, 0)).toBeGreaterThan(1e6);
    expect(carryField(box, () => Infinity, 0.25).evaluate(0.3, 0, 0)).toBeGreaterThan(1e6);
  });
});

describe('captured hair — knob math', () => {
  const src = decodePreset(HAIR_PRESETS.tsubasa);

  it('default knobs are the identity', () => {
    for (const [az, el] of [[0, 0], [120, -40], [-75, 60]]) expect(sourceDir(az, el, DEFAULT_KNOBS)).toEqual([az, el]);
    const f = bakeField(src, DEFAULT_KNOBS);
    for (let k = 0; k < src.radius.length; k += 97) {
      expect(f.radius[k]).toBeCloseTo(src.radius[k], 9);
      expect(f.mask[k]).toBeCloseTo(src.mask[k], 9);
    }
  });

  it('mirror flips the hairdo left ↔ right exactly', () => {
    const a = bakeField(src, DEFAULT_KNOBS), b = bakeField(src, { ...DEFAULT_KNOBS, mirror: true });
    for (let j = 0; j < src.nEl; j += 5) for (let i = 0; i < src.nAz; i += 7) {
      const im = src.nAz - 1 - i;   // cell at −az
      expect(b.radius[j * src.nAz + i]).toBeCloseTo(a.radius[j * src.nAz + im], 9);
      expect(b.mask[j * src.nAz + i]).toBeCloseTo(a.mask[j * src.nAz + im], 9);
    }
  });

  it('volume scales the thickness above the skin monotonically', () => {
    const skin = new Float64Array(src.radius.length).fill(0.8);
    const r = [0.6, 1, 1.5].map((volume) => bakeField(src, { ...DEFAULT_KNOBS, volume }, skin, 0.01).radius);
    for (let k = 0; k < skin.length; k += 13) {
      if (src.mask[k] <= 0) continue;
      expect(r[1][k]).toBeGreaterThan(r[0][k]);
      expect(r[2][k]).toBeGreaterThan(r[1][k]);
    }
  });

  it('the skull guard lifts hair where the target skull pokes through', () => {
    const skin = new Float64Array(src.radius.length).fill(1.05);   // a skull bigger than most of the capture
    const f = bakeField(src, DEFAULT_KNOBS, skin, 0.02);
    for (let k = 0; k < skin.length; k++) if (src.mask[k] > 2) expect(f.radius[k]).toBeGreaterThan(skin[k]);
  });

  it('length / fringe / windowScale / tilt warp the right directions', () => {
    // A longer hem samples the source HIGHER up (so hair reaches lower) at the back, not at the face.
    expect(sourceDir(180, -40, { ...DEFAULT_KNOBS, length: 1.5 })[1]).toBeGreaterThan(-40);
    expect(sourceDir(0, -40, { ...DEFAULT_KNOBS, length: 1.5 })[1]).toBeCloseTo(-40, 6);
    // A longer fringe drops the front hair (samples higher), leaves the back alone.
    expect(sourceDir(0, 10, { ...DEFAULT_KNOBS, fringe: 1.4 })[1]).toBeGreaterThan(10);
    expect(sourceDir(180, 10, { ...DEFAULT_KNOBS, fringe: 1.4 })[1]).toBeCloseTo(10, 6);
    // A bigger window samples the source nearer its centre (the opening grows).
    const [az] = sourceDir(40, -12, { ...DEFAULT_KNOBS, windowScale: 1.3 });
    expect(az).toBeLessThan(40);
    // Tilt is a rotation about the left axis: the left/right poles are fixed.
    const [a90, e90] = sourceDir(90, 0, { ...DEFAULT_KNOBS, tilt: 20 });
    expect(a90).toBeCloseTo(90, 6); expect(e90).toBeCloseTo(0, 6);
    expect(sourceDir(0, 0, { ...DEFAULT_KNOBS, tilt: 20 })[1]).toBeCloseTo(-20, 6);
  });

  it('spikiness amplifies and smooth calms the detail', () => {
    const rough = (r: Float64Array): number => {
      let s = 0;
      for (let k = 1; k < r.length; k++) s += Math.abs(r[k] - r[k - 1]);
      return s;
    };
    const base = rough(bakeField(src, DEFAULT_KNOBS).radius);
    expect(rough(bakeField(src, { ...DEFAULT_KNOBS, spikiness: 2 }).radius)).toBeGreaterThan(base * 1.3);
    expect(rough(bakeField(src, { ...DEFAULT_KNOBS, smooth: 0.8 }).radius)).toBeLessThan(base * 0.8);
  });
});

describe('captured hair — capture from a mesh', () => {
  const lm: HeadLandmarks = { origin: [0, 0, 0], forward: [1, 0, 0], left: [0, 1, 0], up: [0, 0, 1], W: 1, H: 1 };

  it('captures a hemispherical cap: radius = sphere radius, coverage edge at the equator', () => {
    const tris = sphereSoup(1.5, [0, 0, 0], (p) => p[2] > 0);
    const g = decodePreset(captureHair(tris, lm, { name: 'cap', source: 'test', nAz: 64, nEl: 32, centre: [0, 0, 0], shape: [1, 1, 1] }));
    for (const az of [-150, -60, 0, 45, 170]) {
      expect(sampleCubic(g.radius, g, az, 45)).toBeCloseTo(1.5, 1);
      expect(sampleCubic(g.mask, g, az, 30)).toBeGreaterThan(20);
      expect(sampleCubic(g.mask, g, az, -30)).toBeLessThan(-20);
      expect(Math.abs(sampleCubic(g.mask, g, az, 0))).toBeLessThan(4);
    }
  });

  it('flips pin-holes and specks smaller than the island size', () => {
    const nAz = 16, nEl = 8, grid = new Uint8Array(nAz * nEl).fill(1);
    grid[3 * nAz + 4] = 0;                       // a 1-sample hole
    for (let i = 0; i < 6; i++) grid[6 * nAz + i] = 0;   // a 6-sample gap
    removeSmallIslands(grid, nAz, nEl, 3);
    expect(grid[3 * nAz + 4]).toBe(1);
    expect(grid[6 * nAz + 2]).toBe(0);
  });

  it('measures mesh landmarks: front, face width and chin of a sphere head', () => {
    const skin = sphereSoup(10, [0, 0, 0], () => true, 96, 48);
    const eyes = new Float32Array([9, 3, 1, 9, 3.2, 1, 9, 3, 1.2, 9, -3, 1, 9, -3.2, 1, 9, -3, 1.2]);
    const m = landmarksFromParts(skin, eyes, [1, 0, 0], [0, 0, 1]);
    expect(m.origin[0]).toBeGreaterThan(9.5);
    expect(m.origin[1]).toBeCloseTo(0, 1);
    // The chin band (≤ 0.6 eye-separations behind the front, x > 6.2) leaves
    // the sphere at z = −√(100 − 6.2²) ≈ −7.8, so H ≈ 1.1 + 7.8.
    expect(m.H).toBeCloseTo(8.9, 0);
    // W: the widest eye-height crossing 0.38–0.93·H behind the front.
    expect(m.W).toBeGreaterThan(7);
    expect(m.W).toBeLessThan(10);
    expect(toLandmark(m, m.origin)).toEqual([0, 0, 0]);
  });
});

describe("captured hair — F.hair(rig, { style: 'captured' }) SDF", () => {
  const rig = buildRig({ height: 100, proportions: 'funko', headScale: { x: 2.05, y: 1.9, z: 2.3 } });
  const head = buildHead(api, rig, { faceShape: 'round', jaw: 1.6, cheek: 1.2 });
  const c = rig.joints.head as Vec3, f = rig.dir.headForward, U = rig.dir.headUp, L = rig.dir.headLeft;
  const hair = buildHair(api, rig, { style: 'captured', on: head });
  const at = (p: Vec3): number => hair.evaluate(p[0], p[1], p[2]);
  const P = (fw: number, lt: number, up: number): Vec3 => [0, 1, 2].map((i) => c[i] + f[i] * fw + L[i] * lt + U[i] * up) as Vec3;
  const lm = measureHeadLandmarks(head, rig);

  it('measures sensible head landmarks on the rig', () => {
    expect(lm.W).toBeGreaterThan(rig.r.headX * 0.8);
    expect(lm.W).toBeLessThan(rig.r.headX * 1.6);
    expect(lm.H).toBeGreaterThan(rig.r.headZ * 0.4);
    expect(lm.H).toBeLessThan(rig.r.headZ * 1.2);
  });

  it('is solid over the crown and back, open over the face, empty far away', () => {
    const top = rig.r.headZ;
    let tz = 0; while (head.evaluate(...P(0, 0, tz)) < 0) tz += 0.05;
    expect(at(P(0, 0, tz + 0.5))).toBeLessThan(0);                                   // just above the skull: hair
    let tb = 0; while (head.evaluate(...P(-tb, 0, 0)) < 0) tb += 0.05;
    expect(at(P(-tb - 0.5, 0, 0))).toBeLessThan(0);                                   // behind the skull: hair
    expect(at(P(lm.W * 2 + rig.r.head, 0, 0))).toBeGreaterThan(0);                  // far in front
    expect(at(P(0, 0, top * 3))).toBeGreaterThan(0);                                  // far above
    for (const e of [rig.face.eyeL, rig.face.eyeR]) {                               // the eyes stay bare
      const p = [0, 1, 2].map((i) => e[i] + f[i] * rig.r.head * 0.3) as Vec3;
      expect(at(p)).toBeGreaterThan(0);
    }
  });

  it('reports ≈ distance (|∇| ≈ 1) away from cliffs', () => {
    const p = P(-rig.r.head * 0.2, rig.r.headX * 0.3, rig.r.headZ * 1.4), h = 0.05;
    const g = [0, 1, 2].map((k) => { const a = [...p] as Vec3, b = [...p] as Vec3; a[k] += h; b[k] -= h; return (at(a) - at(b)) / (2 * h); });
    const n = Math.hypot(...g);
    expect(n).toBeGreaterThan(0.5);
    expect(n).toBeLessThan(1.5);
  });

  it('mirror is a left↔right reflection of the field', () => {
    const m = buildHair(api, rig, { style: 'captured', on: head, mirror: true });
    for (const [fw, lt, up] of [[-5, 20, 15], [-12, -18, 5], [3, 15, 22]]) {
      // The rig head is symmetric, so mirroring the options mirrors the solid.
      expect(Math.sign(m.evaluate(...P(fw, lt, up)))).toBe(Math.sign(at(P(fw, -lt, up))));
    }
  });

  it('volume grows the hair', () => {
    const big = buildHair(api, rig, { style: 'captured', on: head, volume: 1.5 });
    const inside = (n: { evaluate: (x: number, y: number, z: number) => number }): number => {
      let k = 0;
      for (let i = 0; i < 400; i++) {
        const a = i * 2.39996, e = Math.sin(i * 1.3) * 1.2, R = rig.r.headX * (1.0 + (i % 9) * 0.06);
        if (n.evaluate(c[0] + R * Math.cos(e) * Math.cos(a), c[1] + R * Math.cos(e) * Math.sin(a), c[2] + R * Math.sin(e)) < 0) k++;
      }
      return k;
    };
    expect(inside(big)).toBeGreaterThan(inside(hair));
  });

  it('validates its keys', () => {
    expect(() => buildHair(api, rig, { style: 'captured', preset: 'nope' })).toThrow(/preset/);
    expect(() => buildHair(api, rig, { style: 'captured', spikiness: 9 })).toThrow(/spikiness/);
    expect(() => buildHair(api, rig, { style: 'captured', mirror: 1 })).toThrow(/mirror/);
    expect(() => buildHair(api, rig, { style: 'captured', locks: 3 })).toThrow(/only apply to style/);
    expect(() => buildHair(api, rig, { style: 'shag', spikiness: 1 })).toThrow(/only apply to style 'captured'/);
  });

  it('fieldValue is negative inside the radius and positive outside', () => {
    const g = bakeField(decodePreset(synthPreset(() => 1.5)), DEFAULT_KNOBS);
    expect(fieldValue(g, [0, 0, 1.2]).d).toBeLessThan(0);
    expect(fieldValue(g, [0, 0, 1.8]).d).toBeGreaterThan(0);
    expect(fieldValue(g, [1.2, 0, -0.5]).d).toBeGreaterThan(0);   // below the 10° coverage edge
  });
});
