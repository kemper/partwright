// Projection (screen-space) paintbrush — "paint exactly what I see".
//
// With edge smoothing OFF, the regular brush footprint is the set of triangles
// *visible* under the brush disk, found by rendering an offscreen triangle-id
// buffer and reading back the pixels under the cursor (src/color/projectionPaint
// .ts). This replaces the old 3D-ball centroid scan. The committed region stores
// base-mesh triangle ids, so it stays put when a later smooth stroke refines the
// mesh (no horizontal-band smear).
//
// Covers: a non-smooth brush drag paints visible triangles without subdividing
// the mesh, the colour renders, and a regular region stays spatially localized
// after a subsequent smooth stroke refines the mesh under a different spot.

import { test, expect } from 'playwright/test';

// A 40×40 slab whose top face has a seam of 120 short sliver quads 0.01 wide at
// x ≈ 0 (the kind a smooth-edge or part-boundary cut leaves), fanned to the
// outer edges. Each sliver is far thinner than a pixel, so it usually covers no
// pixel centre in the projection's id buffer.
const SLIVER_SEAM_SLAB = `
const { Manifold } = api;
const W = 0.005, N = 120, ys = [];
for (let i = 0; i <= N; i++) ys.push(-20 + 40 * i / N);
const verts = [], idx = {};
const vid = (x, y, z) => { const k = x + ',' + y + ',' + z; if (idx[k] === undefined) { idx[k] = verts.length / 3; verts.push(x, y, z); } return idx[k]; };
const tris = [];
const P = i => [verts[i*3], verts[i*3+1], verts[i*3+2]];
const tri = (a, b, c, n) => {
  const pa = P(a), pb = P(b), pc = P(c);
  const u = [pb[0]-pa[0], pb[1]-pa[1], pb[2]-pa[2]], v = [pc[0]-pa[0], pc[1]-pa[1], pc[2]-pa[2]];
  const cr = [u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]];
  if (cr[0]*n[0] + cr[1]*n[1] + cr[2]*n[2] < 0) tris.push(a, c, b); else tris.push(a, b, c);
};
const quad = (a, b, c, d, n) => { tri(a, b, c, n); tri(a, c, d, n); };
for (const [z, n] of [[3, [0,0,1]], [0, [0,0,-1]]]) {
  // Strip: N short sliver quads between x = -W and x = +W.
  for (let i = 0; i < N; i++) quad(vid(-W, ys[i], z), vid(W, ys[i], z), vid(W, ys[i+1], z), vid(-W, ys[i+1], z), n);
  // Big halves: fan from the outer edge to every strip vertex.
  for (const [xo, xi] of [[-20, -W], [20, W]]) {
    for (let i = 0; i < N; i++) tri(vid(xo, ys[i] < 0 ? -20 : 20, z), vid(xi, ys[i], z), vid(xi, ys[i+1], z), n);
    tri(vid(xo, -20, z), vid(xo, 20, z), vid(xi, 0, z), n);
  }
}
for (const [x0, x1] of [[-20, -W], [-W, W], [W, 20]]) {
  quad(vid(x0,-20,0), vid(x1,-20,0), vid(x1,-20,3), vid(x0,-20,3), [0,-1,0]);
  quad(vid(x0,20,0), vid(x1,20,0), vid(x1,20,3), vid(x0,20,3), [0,1,0]);
}
quad(vid(-20,-20,0), vid(-20,20,0), vid(-20,20,3), vid(-20,-20,3), [-1,0,0]);
quad(vid(20,-20,0), vid(20,20,0), vid(20,20,3), vid(20,-20,3), [1,0,0]);
return Manifold.ofMesh({ numProp: 3, vertProperties: new Float32Array(verts), triVerts: new Uint32Array(tris) });
`;

async function openSlabEditor(page: import('playwright/test').Page) {
  await page.goto('/editor');
  await page.waitForSelector('text=Ready', { timeout: 15000 });
  await page.evaluate(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pw = (window as any).partwright;
    // A wide flat slab fills the viewport so canvas-dispatched coordinates
    // reliably hit the model after auto-framing.
    await pw.run('const { Manifold } = api; return Manifold.cube([40, 40, 3], true);');
    pw.setBrushSize(4);
    pw.setBrushSmooth(false); // non-smooth → projection footprint path
  });
  await page.locator('#paint-toggle').dispatchEvent('click');
  await page.waitForSelector('#paint-picker-panel:not(.hidden)');
  await page.locator('#paint-picker-panel button:has-text("Brush")').dispatchEvent('click');
  // Let the viewport auto-frame the new mesh so the centre ray hits it.
  await page.waitForTimeout(200);
}

/** Drive a real brush drag across the canvas, offset from centre by (ox, oy). */
async function dragBrush(page: import('playwright/test').Page, ox = 0, oy = 0) {
  await page.evaluate(async ({ ox, oy }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pw = (window as any).partwright;
    const canvas = document.querySelector('#viewport-container canvas')!;
    const r = canvas.getBoundingClientRect();
    const cx = r.left + r.width / 2 + ox, cy = r.top + r.height / 2 + oy;
    const fire = (t: string, x: number, y: number) =>
      canvas.dispatchEvent(new PointerEvent(t, { bubbles: true, clientX: x, clientY: y, button: 0, buttons: 1, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
    fire('pointermove', cx, cy);
    fire('pointerdown', cx, cy);
    for (let dx = 6; dx <= 30; dx += 6) fire('pointermove', cx + dx, cy);
    fire('pointerup', cx + 30, cy);
    await pw.waitForPaint();
  }, { ox, oy });
}

test.describe('projection paintbrush', () => {
  test('a non-smooth brush drag paints visible triangles without subdividing', async ({ page }) => {
    await openSlabEditor(page);

    const out = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return { before: (window as any).partwright.getMesh().numTri };
    });
    await dragBrush(page);
    const result = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      const regions = pw.listRegions();
      return { after: pw.getMesh().numTri, regions };
    });

    // Exactly one region, with real painted triangles — projection found the
    // visible faces under the disk.
    expect(result.regions.length).toBe(1);
    expect(result.regions[0].triangles).toBeGreaterThan(0);
    expect(result.regions[0].source).toBe('paintbrush');
    // Projection paint never subdivides — the mesh is untouched (unlike the
    // smooth brush, which grows the triangle count).
    expect(result.after).toBe(out.before);

    // Capture a screenshot artifact for eyes-on verification (dismiss the
    // first-run tour backdrop first so the painted slab is clearly visible).
    const skip = page.locator('button:has-text("Skip")');
    if (await skip.count()) await skip.first().click().catch(() => {});
    await page.waitForTimeout(150);
    await page.screenshot({ path: 'test-results/projection-brush.png' });

    // The paint renders: a tri-view composite should show the red-dominant patch.
    const dataUrl = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return await (window as any).partwright.renderViews({ views: 'tri', size: 200 });
    });
    const redFrac = await page.evaluate(async (url: string) => {
      const img = await new Promise<HTMLImageElement>((res, rej) => {
        const el = new Image(); el.onload = () => res(el); el.onerror = () => rej(new Error('decode')); el.src = url;
      });
      const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
      const ctx = c.getContext('2d')!; ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(0, 0, img.width, img.height).data;
      let red = 0, total = 0;
      for (let i = 0; i < d.length; i += 4) { total++; if (d[i] > 100 && d[i] - d[i + 1] > 40 && d[i] - d[i + 2] > 40) red++; }
      return red / total;
    }, dataUrl);
    expect(redFrac).toBeGreaterThan(0.005);
  });

  test('regular paint stays localized after a later smooth stroke refines the mesh', async ({ page }) => {
    await openSlabEditor(page);

    // Paint a regular (projection) region near the centre.
    await dragBrush(page, -40, 0);
    const before = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      const reg = pw.listRegions()[0];
      return { id: reg.id, bbox: reg.bbox, tris: reg.triangles, numTri: pw.getMesh().numTri };
    });
    expect(before.bbox).not.toBeNull();
    const bboxSpan = (b: { min: number[]; max: number[] }) =>
      Math.hypot(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]);
    const spanBefore = bboxSpan(before.bbox);

    // Now run a smooth stroke elsewhere that subdivides the mesh — this is the
    // scenario that used to smear refined-space ids of the regular region.
    const refined = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      const r = pw.paintStroke({ points: [[10, 0, 1.5]], radius: 3, maxEdge: 0.3, color: [0.2, 0.4, 0.9] });
      await pw.waitForPaint();
      return { err: r.error, numTri: pw.getMesh().numTri };
    });
    expect(refined.err).toBeFalsy();
    expect(refined.numTri).toBeGreaterThan(before.numTri); // the smooth stroke refined the mesh

    // The regular region must still be a single localized patch — its bbox span
    // should be close to what it was, NOT exploded into bands across the slab.
    const after = await page.evaluate((id: number) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const reg = (window as any).partwright.listRegions().find((r: { id: number }) => r.id === id);
      return reg ? { bbox: reg.bbox, tris: reg.triangles } : null;
    }, before.id);
    expect(after).not.toBeNull();
    const spanAfter = bboxSpan(after!.bbox);
    // A smear would blow the span up toward the 40-unit slab diagonal (~56).
    // Require it to stay within a small multiple of the original footprint.
    expect(spanAfter).toBeLessThan(spanBefore + 6);
  });

  test('painting a regular stroke ON an already-refined mesh maps to base ids and stays localized', async ({ page }) => {
    // A finely-tessellated sphere (many triangles per face) so a brush paints a
    // *localized* cap — unlike a slab face, which is two giant triangles. This is
    // what lets a smear (scattered base ids) be told apart from a clean patch.
    await page.goto('/editor');
    await page.waitForSelector('text=Ready', { timeout: 15000 });
    await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      await pw.run('const { Manifold } = api; return Manifold.sphere(20, 96);');
      pw.setBrushSize(3);
      pw.setBrushSmooth(false);
    });
    await page.locator('#paint-toggle').dispatchEvent('click');
    await page.waitForSelector('#paint-picker-panel:not(.hidden)');
    await page.locator('#paint-picker-panel button:has-text("Brush")').dispatchEvent('click');
    await page.waitForTimeout(200);

    // Refine the mesh first (smooth stroke on the far side). Now the working mesh
    // != the pristine base, so the regular paint below exercises the current→base
    // triangle mapping (baseRemap closest-point lookup) — the path that must NOT
    // reorder/corrupt the base mesh or return wrong parent ids.
    const refined = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      const r = pw.paintStroke({ points: [[0, 0, 20]], radius: 4, maxEdge: 0.5, color: [0.2, 0.4, 0.9] });
      await pw.waitForPaint();
      return { err: r.error, numTri: pw.getMesh().numTri };
    });
    expect(refined.err).toBeFalsy();

    // Regular (projection) brush dab on the front of the now-refined sphere.
    await dragBrush(page);

    // The regular region resolves through the base→child remap on the rebuild
    // that an append-while-refined triggers — so a wrong base id from the
    // current→base lookup would scatter it across the sphere instead of a patch.
    const result = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      const regions = pw.listRegions();
      const regular = regions.reduce((a: { id: number }, b: { id: number }) => (b.id > a.id ? b : a));
      return { count: regions.length, regular };
    });

    expect(result.count).toBe(2);
    expect(result.regular.triangles).toBeGreaterThan(0);
    expect(result.regular.bbox).not.toBeNull();
    const b = result.regular.bbox;
    const span = Math.hypot(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]);
    // A localized cap on a radius-20 sphere; a smear would approach the sphere's
    // ~40-unit extent (and the bbox would also balloon in Z).
    expect(span).toBeLessThan(18);
  });
  test('sub-pixel slivers along a seam under the brush get painted (no leftover hairline)', async ({ page }) => {
    await page.goto('/editor');
    await page.waitForSelector('text=Ready', { timeout: 15000 });
    await page.evaluate(async (code) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      await pw.run(code);
      pw.setBrushSize(4);
      pw.setBrushSmooth(false);
      pw.setBrushWrapAngle(180);
    }, SLIVER_SEAM_SLAB);
    await page.locator('#paint-toggle').dispatchEvent('click');
    await page.waitForSelector('#paint-picker-panel:not(.hidden)');
    await page.locator('#paint-picker-panel button:has-text("Brush")').dispatchEvent('click');
    await page.waitForTimeout(200);

    // A drag across the seam from left of centre to right of it.
    await dragBrush(page, -30, 0);

    // Centroid y of every painted seam sliver (top face, |x| < 0.01).
    const ys = await page.evaluate(async () => {
      const { getCurrentMesh } = await import('/src/color/paintMode.ts');
      const { getRegions } = await import('/src/color/regions.ts');
      const m = getCurrentMesh()!;
      const out: number[] = [];
      for (const t of getRegions()[0]?.triangles ?? []) {
        let mx = 0, y = 0, z = 0;
        for (let k = 0; k < 3; k++) {
          const o = m.triVerts[t * 3 + k] * m.numProp;
          mx = Math.max(mx, Math.abs(m.vertProperties[o]));
          y += m.vertProperties[o + 1];
          z += m.vertProperties[o + 2];
        }
        if (mx < 0.01 && z > 8.9) out.push(y / 3);
      }
      return out.sort((a, b) => a - b);
    });
    // Without sliver absorption only the odd sliver that happened to cover a
    // pixel centre was painted — a scattered handful with long unpainted gaps.
    // Now the seam under the stroke is painted as one contiguous run.
    expect(ys.length).toBeGreaterThan(10);
    let maxGap = 0;
    for (let i = 1; i < ys.length; i++) maxGap = Math.max(maxGap, ys[i] - ys[i - 1]);
    expect(maxGap).toBeLessThan(0.3); // segments are 0.33 long, 2 slivers each
  });
});
