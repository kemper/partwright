import { test, expect } from 'playwright/test';
import { readFileSync } from 'fs';

// Regression for the "buried unpainted triangle" paint bug.
//
// Repro (the user's real session): a square pyramid — `Manifold.cylinder(22,14,0,4)`,
// a 6-triangle coarse model where each slanted face is ONE ~25-unit triangle — painted
// with a looping edge-smoothing brush stroke (radius 1, maxEdge 1/64). The stroke's
// footprint is the union of disks along a curved/looping path, so it is *concave*:
// across a coarse triangle spanning the concave side the signed-distance field dips
// inside at the three corners yet bulges back outside in the middle. The classifier saw
// "all 3 vertices inside" → 'inside' → never subdivided it, and the centroid-based paint
// resolve then scored it outside → it rendered as a big unpainted triangle sitting inside
// the painted ring. The fix: brushClassifier also samples the triangle interior, so a
// poking triangle is treated as a straddle and refined down to maxEdge.
//
// Engine-dependent (the geodesic field + slab normals need the real meshed pyramid), so
// this runs the actual engine + refine pipeline in-page rather than in the pure unit tier.

test('edge-smoothing paint leaves no large unpainted triangle inside the footprint', async ({ page }) => {
  const fixture = JSON.parse(readFileSync('tests/fixtures/buried-triangle.json', 'utf8')) as {
    code: string;
    descriptor: unknown;
  };

  await page.goto('/editor');
  await page.waitForFunction(() => !!(window as unknown as { partwright?: unknown }).partwright, null, {
    timeout: 60000,
  });

  const result = await page.evaluate(async ({ code, descriptor }) => {
    const { manifoldJsEngine } = await import('/src/geometry/engines/manifoldJs.ts');
    const { refineMeshPipeline, buildBrushStrokeFromDescriptor } = await import('/src/color/refinePipeline.ts');
    const { strokeSignedDist } = await import('/src/color/subdivide.ts');

    await manifoldJsEngine.init();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const base = (manifoldJsEngine.run(code) as any).mesh;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const descriptors = [descriptor as any];
    const { mesh, brushStrokeTriangles } = refineMeshPipeline(base, base, descriptors);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const strokes = descriptors.map((d) => buildBrushStrokeFromDescriptor(d, base));

    const painted = new Set<number>();
    for (const arr of brushStrokeTriangles.values()) for (const t of arr) painted.add(t);

    const pt = (t: number, k: number): [number, number, number] => {
      const v = mesh.triVerts[t * 3 + k];
      return [mesh.vertProperties[v * 3], mesh.vertProperties[v * 3 + 1], mesh.vertProperties[v * 3 + 2]];
    };
    const longestEdge = (t: number): number => {
      const a = pt(t, 0), b = pt(t, 1), c = pt(t, 2);
      const e = (p: number[], q: number[]) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
      return Math.max(e(a, b), e(b, c), e(c, a));
    };

    // A triangle whose three vertices are all inside a stroke footprint but which is
    // not painted is the defect — unless it has been refined small (sub-maxEdge clip
    // slivers, which are invisible). A LARGE such triangle is the bug.
    let largestBuried = 0;
    for (let t = 0; t < mesh.numTri; t++) {
      if (painted.has(t)) continue;
      for (const s of strokes) {
        const fa = strokeSignedDist(...pt(t, 0), s);
        const fb = strokeSignedDist(...pt(t, 1), s);
        const fc = strokeSignedDist(...pt(t, 2), s);
        if (fa <= 0 && fb <= 0 && fc <= 0) {
          largestBuried = Math.max(largestBuried, longestEdge(t));
          break;
        }
      }
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const maxEdge = (descriptor as any).maxEdge as number;
    return { largestBuried, maxEdge, numTri: mesh.numTri, painted: painted.size };
  }, fixture);

  // Sanity: the stroke actually refined the coarse face and painted something.
  expect(result.numTri).toBeGreaterThan(1000);
  expect(result.painted).toBeGreaterThan(0);
  // No buried triangle larger than a small multiple of maxEdge survives. Before the
  // fix this was ~3.26 (a single huge face triangle); after, only sub-maxEdge slivers.
  expect(result.largestBuried).toBeLessThan(result.maxEdge * 8);
});
