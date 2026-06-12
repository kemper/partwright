// Engrave/emboss letter-coloring coverage on a CURVED surface.
//
// Regression guard for the curved-stamp color bugs: a word embossed onto a
// sphere must color the *whole* raised relief (every wall, to the rim) without
// bleeding onto the untouched skin. The trap that kept recurring: classifying a
// baked triangle by the stamp projection's ink coverage `m` — on a curved face
// the projection's (u,v) is only valid at the surface, so for the raised relief
// the projected point drifts off the letter and `m` collapses to ~0, dropping
// whole walls of color. The fix classifies purely by displacement off the
// original surface (per most-displaced vertex). This test reproduces the curved
// emboss headlessly (real surface-nets carve, no browser) and asserts near-total
// coverage of the clearly-raised geometry with zero bleed.

import { describe, it, expect } from 'vitest';
import { applyEngrave } from '../../src/surface/modifiers';
import type { MeshData } from '../../src/geometry/types';

/** Axis-aligned cube [0,s]^3 (8 verts / 12 tris) — a coarse, flat, grid-aligned
 *  input, the worst case for the displacement classifier's flat-face speckle. */
function cube(s: number): MeshData {
  return {
    vertProperties: new Float32Array([0, 0, 0, s, 0, 0, s, s, 0, 0, s, 0, 0, 0, s, s, 0, s, s, s, s, 0, s, s]),
    triVerts: new Uint32Array([0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 2, 3, 7, 2, 7, 6, 1, 2, 6, 1, 6, 5, 0, 4, 7, 0, 7, 3]),
    numVert: 8, numTri: 12, numProp: 3,
  };
}

/** A pure-JS UV sphere mesh (no engine needed). */
function uvSphere(R: number, stacks: number, slices: number): MeshData {
  const verts: number[] = [];
  for (let i = 0; i <= stacks; i++) {
    const phi = (i / stacks) * Math.PI;
    for (let j = 0; j <= slices; j++) {
      const th = (j / slices) * 2 * Math.PI;
      verts.push(R * Math.sin(phi) * Math.cos(th), R * Math.sin(phi) * Math.sin(th), R * Math.cos(phi));
    }
  }
  const tris: number[] = [];
  const idx = (i: number, j: number) => i * (slices + 1) + j;
  for (let i = 0; i < stacks; i++) {
    for (let j = 0; j < slices; j++) {
      const a = idx(i, j), b = idx(i + 1, j), c = idx(i + 1, j + 1), d = idx(i, j + 1);
      tris.push(a, b, c, a, c, d);
    }
  }
  return { vertProperties: Float32Array.from(verts), triVerts: Uint32Array.from(tris), numVert: verts.length / 3, numTri: tris.length / 3, numProp: 3 };
}

/** An "H"-like mask (two vertical bars + a crossbar) — gives relief walls facing
 *  every direction, the orientations the curved projection drifts most. */
function hMask(w: number, h: number): { width: number; height: number; data: Uint8Array } {
  const data = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ink = (x > w * 0.12 && x < w * 0.30) || (x > w * 0.70 && x < w * 0.88) || (y > h * 0.40 && y < h * 0.60);
      if (ink) data[y * w + x] = 255;
    }
  }
  return { width: w, height: h, data };
}

describe('engrave color coverage (curved emboss)', () => {
  it('colors the whole raised relief with no bleed onto the skin', async () => {
    const R = 10;
    const res = await applyEngrave(uvSphere(R, 40, 60), {
      mask: hMask(130, 72),
      projection: { mode: 'planar', axis: 'z', side: 'max', curve: { axis: 'v', angleDeg: 130 } },
      through: false, raised: true, depth: 1.2, size: 14, resolution: 56, watertight: true,
      color: [0, 0, 1], // pure blue, so coloring is unambiguous to read back
    });
    const { vertProperties: vp, triVerts: tv, numProp, numTri } = res.mesh;
    const tc = res.mesh.triColors;
    expect(tc).toBeTruthy();
    const col = tc!;

    let clearRelief = 0, missed = 0, bleed = 0;
    for (let t = 0; t < numTri; t++) {
      const a = tv[t * 3], b = tv[t * 3 + 1], c = tv[t * 3 + 2];
      const cx = (vp[a * numProp] + vp[b * numProp] + vp[c * numProp]) / 3;
      const cy = (vp[a * numProp + 1] + vp[b * numProp + 1] + vp[c * numProp + 1]) / 3;
      const cz = (vp[a * numProp + 2] + vp[b * numProp + 2] + vp[c * numProp + 2]) / 3;
      const radial = Math.hypot(cx, cy, cz);
      const colored = col[t * 3 + 2] > 200 && col[t * 3] < 50;
      // Centroid clearly OUTSIDE the original sphere → unambiguously raised relief.
      if (radial > R + 0.35) {
        clearRelief++;
        if (!colored) missed++;
      } else if (radial < R - 0.2 && colored) {
        // Centroid clearly INSIDE the sphere but colored → bleed onto the skin.
        bleed++;
      }
    }

    // The relief was actually built (sanity), nearly all of it is colored (the
    // only misses are the sub-threshold sliver right at the rim), and the carve
    // didn't paint any skin below the surface. The pre-fix ink-gated classifier
    // dropped ~9% of the relief here; 5% cleanly separates fixed from broken.
    expect(clearRelief).toBeGreaterThan(500);
    expect(missed / clearRelief).toBeLessThan(0.05);
    expect(bleed).toBe(0);
  }, 60_000);

  it('does not speckle a flat face (emboss on a grid-aligned cube)', async () => {
    // A coarse, axis-aligned cube was the worst case: the displacement field is
    // a point-to-NEAREST-CENTROID-triangle distance, and on a flat densified face
    // a vertex projecting just outside that one triangle read the lateral gap as
    // "displacement" — a periodic grid of red specks across the whole face. The
    // distance must be the min over nearby triangles, so the face reads ~0.
    const S = 20;
    const res = await applyEngrave(cube(S), {
      mask: hMask(130, 72), projection: { mode: 'planar', axis: 'z', side: 'max' },
      through: false, raised: true, depth: 1.5, size: 14, resolution: 64, watertight: true,
      color: [1, 0, 0],
    });
    const { vertProperties: vp, triVerts: tv, numProp, numTri } = res.mesh;
    const col = res.mesh.triColors!;
    const eps = S / 64 * 0.5;
    let relief = 0, flatBleed = 0;
    for (let t = 0; t < numTri; t++) {
      const a = tv[t * 3], b = tv[t * 3 + 1], c = tv[t * 3 + 2];
      const cz = (vp[a * numProp + 2] + vp[b * numProp + 2] + vp[c * numProp + 2]) / 3;
      const colored = col[t * 3] > 200 && col[t * 3 + 2] < 50;
      if (!colored) continue;
      if (cz > S + 0.4) relief++;            // up the raised letters — expected
      else if (cz < S + 1.5 * eps) flatBleed++; // on the flat top face — speckle
    }
    expect(relief).toBeGreaterThan(500); // the relief itself is colored
    expect(flatBleed).toBe(0);           // …and the flat face is left clean
  }, 60_000);
});
