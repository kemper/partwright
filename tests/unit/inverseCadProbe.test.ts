// Unit tests for the inverse-CAD probe layer: slicing, 2D fits, polygon
// simplification, code emission, and the probe subcommand internals.
import { describe, expect, it } from 'vitest';
// @ts-expect-error — plain .mjs module without type declarations
import { sliceMesh, fitCircle2D, douglasPeucker, cleanShortEdges, polygonSignedArea, contourStats } from '../../scripts/inverse-cad/slice.mjs';
// @ts-expect-error — plain .mjs module without type declarations
import { contoursToCode } from '../../scripts/inverse-cad/trace2code.mjs';
// @ts-expect-error — plain .mjs module without type declarations
import { cmdFit, cmdRay, meshVolume, meshTopology } from '../../scripts/inverse-cad/probe.mjs';

// ---- procedural mesh helpers (triangle soups) ----

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

/** A 10mm cube with a square 2x2 through-hole along Z (genus 1). */
function cubeWithHole(): number[] {
  const soup: number[] = [];
  const o = 0, s = 10, h0 = 4, h1 = 6; // hole from 4..6 in x and y
  // Outer walls
  quad(soup, [o, o, 0], [s, o, 0], [s, o, s], [o, o, s]); // -y
  quad(soup, [o, s, 0], [o, s, s], [s, s, s], [s, s, 0]); // +y
  quad(soup, [o, o, 0], [o, o, s], [o, s, s], [o, s, 0]); // -x
  quad(soup, [s, o, 0], [s, s, 0], [s, s, s], [s, o, s]); // +x
  // Inner tube walls (normals point INTO the hole = out of the solid)
  quad(soup, [h0, h0, 0], [h0, h0, s], [h1, h0, s], [h1, h0, 0]); // hole -y side
  quad(soup, [h0, h1, 0], [h1, h1, 0], [h1, h1, s], [h0, h1, s]); // hole +y side
  quad(soup, [h0, h0, 0], [h0, h1, 0], [h0, h1, s], [h0, h0, s]); // hole -x side
  quad(soup, [h1, h0, 0], [h1, h0, s], [h1, h1, s], [h1, h1, 0]); // hole +x side
  // Top and bottom annulus (4 quads each)
  for (const [z, flip] of [
    [0, true],
    [s, false],
  ] as const) {
    const ring: Array<[number[], number[], number[], number[]]> = [
      [[o, o, z], [s, o, z], [s, h0, z], [o, h0, z]],
      [[o, h1, z], [s, h1, z], [s, s, z], [o, s, z]],
      [[o, h0, z], [h0, h0, z], [h0, h1, z], [o, h1, z]],
      [[h1, h0, z], [s, h0, z], [s, h1, z], [h1, h1, z]],
    ];
    for (const [a, b, c, d] of ring) {
      if (flip) quad(soup, a, d, c, b);
      else quad(soup, a, b, c, d);
    }
  }
  return soup;
}

/**
 * Square torus (genus 1) with matched vertices everywhere — unlike
 * cubeWithHole above, whose outer walls have T-junctions against the
 * annulus edges (fine for slicing, wrong for Euler-characteristic tests).
 */
function squareTorusSoup(): number[] {
  const center = [5, 5];
  const corners = [
    [2, 2],
    [8, 2],
    [8, 8],
    [2, 8],
  ];
  const w = 1.2, h = 3;
  // Section corner offsets: [radialSign, z]
  const section: Array<[number, number]> = [
    [1, 0],
    [1, h],
    [-1, h],
    [-1, 0],
  ];
  const vert = (i: number, j: number): number[] => {
    const [cx, cy] = corners[i];
    let dx = cx - center[0], dy = cy - center[1];
    const dl = Math.hypot(dx, dy);
    dx /= dl; dy /= dl;
    const [s, z] = section[j];
    return [cx + dx * w * s, cy + dy * w * s, z];
  };
  const soup: number[] = [];
  for (let i = 0; i < 4; i++) {
    const i2 = (i + 1) % 4;
    for (let j = 0; j < 4; j++) {
      const j2 = (j + 1) % 4;
      quad(soup, vert(i, j), vert(i2, j), vert(i2, j2), vert(i, j2));
    }
  }
  return soup;
}

function circlePts(cx: number, cy: number, r: number, n: number): Float64Array {
  const out = new Float64Array(n * 2);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * 2 * Math.PI;
    out[i * 2] = cx + r * Math.cos(a);
    out[i * 2 + 1] = cy + r * Math.sin(a);
  }
  return out;
}

/** Open cylinder wall soup (no caps needed for local surface fitting). */
function cylinderWallSoup(r: number, h: number, segments: number): number[] {
  const soup: number[] = [];
  for (let i = 0; i < segments; i++) {
    const a0 = (i / segments) * 2 * Math.PI;
    const a1 = ((i + 1) / segments) * 2 * Math.PI;
    const p0 = [r * Math.cos(a0), r * Math.sin(a0)];
    const p1 = [r * Math.cos(a1), r * Math.sin(a1)];
    quad(soup, [p0[0], p0[1], 0], [p1[0], p1[1], 0], [p1[0], p1[1], h], [p0[0], p0[1], h]);
  }
  return soup;
}

describe('inverse-cad/slice.sliceMesh', () => {
  it('slices a 10mm cube into one square contour', () => {
    const contours = sliceMesh(mesh(boxSoup([0, 0, 0], [10, 10, 10])), 'z', 5);
    expect(contours.length).toBe(1);
    expect(contours[0].isHole).toBe(false);
    expect(contours[0].open).toBe(false);
    expect(contours[0].area).toBeCloseTo(100, 1);
    const st = contourStats(contours[0]);
    expect(st.perimeter).toBeCloseTo(40, 1);
    expect(st.centroid[0]).toBeCloseTo(5, 2);
  });

  it('flags the inner contour of a through-hole as a hole', () => {
    const contours = sliceMesh(mesh(cubeWithHole()), 'z', 5);
    expect(contours.length).toBe(2);
    const outer = contours.find((c: { isHole: boolean }) => !c.isHole);
    const hole = contours.find((c: { isHole: boolean }) => c.isHole);
    expect(outer).toBeTruthy();
    expect(hole).toBeTruthy();
    expect(outer!.area).toBeCloseTo(100, 1);
    expect(hole!.area).toBeCloseTo(4, 1);
  });
});

describe('inverse-cad/slice 2D fits + simplify', () => {
  it('fitCircle2D recovers a sampled circle', () => {
    const fit = fitCircle2D(circlePts(3, -2, 4.5, 256));
    expect(fit.cx).toBeCloseTo(3, 3);
    expect(fit.cy).toBeCloseTo(-2, 3);
    expect(fit.r).toBeCloseTo(4.5, 3);
    expect(fit.rmsResidual).toBeLessThan(1e-3);
  });

  it('douglasPeucker shrinks a dense circle while staying within tolerance', () => {
    const pts = circlePts(0, 0, 5, 1000);
    const simp = douglasPeucker(pts, 0.05);
    expect(simp.length / 2).toBeLessThan(120);
    // Every original point stays within ~tol of the simplified polygon's
    // radius envelope (crude but effective check for a circle).
    const fit = fitCircle2D(simp);
    expect(fit.r).toBeCloseTo(5, 1);
  });

  it('cleanShortEdges removes sub-minLen edges', () => {
    // A square with one corner chopped by a tiny 0.05mm edge.
    const pts = Float64Array.from([0, 0, 10, 0, 10, 9.95, 9.95, 10, 0, 10]);
    const cleaned = cleanShortEdges(pts, 0.15);
    expect(cleaned.length / 2).toBe(4);
    expect(Math.abs(polygonSignedArea(cleaned))).toBeCloseTo(100, 0);
  });
});

describe('inverse-cad/trace2code', () => {
  it('emits fromPoints + [1,1] extrude, holes subtracted', () => {
    const contours = sliceMesh(mesh(cubeWithHole()), 'z', 5);
    const code = contoursToCode(contours, { depth: 10, zBase: 0, name: 'test' });
    expect(code).toContain('geom.fromPoints');
    expect(code).toContain('.subtract(hole0)');
    expect(code).toContain('.extrude(10, 0, 0, [1, 1])');
    expect(code).not.toMatch(/\.extrude\([^)]*,\s*1\)\s*;/); // never scalar scaleTop
  });
});

describe('inverse-cad/probe internals', () => {
  it('meshVolume + meshTopology on the cube', () => {
    const m = mesh(boxSoup([0, 0, 0], [10, 10, 10]));
    expect(meshVolume(m)).toBeCloseTo(1000, 1);
    const topo = meshTopology(m);
    expect(topo.eulerCharacteristic).toBe(2);
    expect(topo.genus).toBe(0);
    expect(topo.components).toBe(1);
  });

  it('meshTopology detects genus 1 for a torus', () => {
    const topo = meshTopology(mesh(squareTorusSoup()));
    expect(topo.eulerCharacteristic).toBe(0);
    expect(topo.genus).toBe(1);
  });

  it('cylinder RANSAC recovers radius and axis', () => {
    const m = mesh(cylinderWallSoup(3, 8, 64));
    const res = cmdFit(m, { near: [3, 0, 4], r: 3.5 });
    const cyl = res.fits.find((f: { type: string }) => f.type === 'cylinder');
    expect(cyl).toBeTruthy();
    expect(cyl.r).toBeCloseTo(3, 1);
    expect(Math.abs(cyl.axisDir[2])).toBeGreaterThan(0.999); // axis ≈ Z
  });

  it('ray reports entering/exiting hits on a cube', () => {
    const m = mesh(boxSoup([0, 0, 0], [10, 10, 10]));
    const res = cmdRay(m, { from: [5, 5, 20], dir: [0, 0, -1], all: true });
    expect(res.hitCount).toBe(2);
    expect(res.hits[0].dist).toBeCloseTo(10, 3);
    expect(res.hits[0].entering).toBe(true);
    expect(res.hits[1].dist).toBeCloseTo(20, 3);
    expect(res.hits[1].entering).toBe(false);
  });
});
