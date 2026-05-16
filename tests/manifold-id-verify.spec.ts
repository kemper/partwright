// Phase 0 verification for the proposed labelled-construction feature
// (Tier 3 of the painting workflow improvements). Empirically tests:
//
//  1. Does a freshly-constructed `Manifold.cube(...)` have a valid
//     originalID()? Or is it -1 until asOriginal() is called?
//  2. After `a.add(b)`, does the result.getMesh() populate runOriginalID
//     and runIndex? Are the array lengths consistent?
//  3. Does `shape.asOriginal().translate([...])` preserve the originalID
//     through a boolean op?
//  4. With overlapping shapes, is each output triangle attributed to
//     exactly one input (i.e. is the run partition a proper covering)?
//
// This test exists to inform the labelled-construction design — if any
// of these answers is "no", the design changes. Once we ship and have
// confidence, we can delete this file.

import { test, expect } from 'playwright/test';

test.describe('manifold-3d ID propagation', () => {
  test('asOriginal / originalID / runIndex behavior', async ({ page }) => {
    await page.goto('/editor');
    // Wait for the WASM engine to load. The status badge flips to "Ready"
    // once init completes; we trigger a small run to be sure.
    await page.waitForSelector('text=Ready', { timeout: 15000 });

    // Run a tiny program to ensure manifold-3d is loaded into the page.
    const warmup = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      if (!pw?.runIsolated) return { ok: false, reason: 'partwright.runIsolated missing' };
      const r = await pw.runIsolated('return api.Manifold.cube([1,1,1]);');
      return { ok: !r?.error, reason: r?.error };
    });
    expect(warmup.ok, `warmup failed: ${warmup.reason}`).toBe(true);

    // Now load the manifold-3d module via the same path the app uses and
    // run the verification. Vite serves node_modules in dev with the
    // existing COEP/COOP headers, so the WASM threading works.
    const result = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const Module: any = await import('/node_modules/manifold-3d/manifold.js');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const m: any = await Module.default();
      m.setup();
      const { Manifold } = m;

      const out: Record<string, unknown> = {};

      // Q1: Does a fresh primitive have an originalID >= 0?
      const cube = Manifold.cube([10, 10, 10]);
      out.q1_freshCubeOriginalID = cube.originalID();

      // Q1b: Does asOriginal() yield a different/new id?
      const cubeOrig = cube.asOriginal();
      out.q1b_asOriginalID = cubeOrig.originalID();
      out.q1c_idsDiffer = cube.originalID() !== cubeOrig.originalID();

      // Q2: After boolean add, does the result mesh carry runOriginalID/runIndex?
      const a = Manifold.cube([10, 10, 10]).asOriginal();
      const b = Manifold.sphere(5).translate([5, 5, 15]).asOriginal();
      out.q2_a_id = a.originalID();
      out.q2_b_id = b.originalID();
      const sum = a.add(b);
      const sumMesh = sum.getMesh();
      out.q2_sumNumTri = sumMesh.numTri;
      out.q2_runOriginalID = sumMesh.runOriginalID
        ? Array.from(sumMesh.runOriginalID as Uint32Array)
        : null;
      out.q2_runIndex = sumMesh.runIndex
        ? Array.from(sumMesh.runIndex as Uint32Array)
        : null;
      out.q2_runIndexCoversAllTris =
        sumMesh.runIndex &&
        sumMesh.runIndex[sumMesh.runIndex.length - 1] === sumMesh.numTri * 3;

      // Q3: Does a translated labelled shape preserve its originalID after union?
      const c = Manifold.cube([5, 5, 5]).asOriginal();
      const cId = c.originalID();
      const cTranslated = c.translate([20, 0, 0]);
      // The translated copy: its originalID should match the un-translated
      // original (since transforms don't change identity).
      const sumWithTransform = Manifold.cube([10, 10, 10]).asOriginal().add(cTranslated);
      const stMesh = sumWithTransform.getMesh();
      out.q3_c_id_before_translate = cId;
      out.q3_runOriginalID = stMesh.runOriginalID
        ? Array.from(stMesh.runOriginalID as Uint32Array)
        : null;
      out.q3_transformedCubeIdPresent =
        stMesh.runOriginalID && Array.from(stMesh.runOriginalID as Uint32Array).includes(cId);

      // Q4: Overlapping shapes — is the run partition a proper covering?
      const head = Manifold.sphere(20, 64).asOriginal();
      const eye = Manifold.sphere(5, 32).translate([0, 18, 0]).asOriginal();
      const headEyeUnion = head.add(eye);
      const heMesh = headEyeUnion.getMesh();
      const heCovers =
        heMesh.runIndex &&
        heMesh.runIndex[heMesh.runIndex.length - 1] === heMesh.numTri * 3;
      // Each triangle is in exactly one run (by construction — runs are
      // contiguous and span the full triVerts array). Count how many
      // triangles are attributed to each input.
      const heCounts: Record<number, number> = {};
      if (heMesh.runOriginalID && heMesh.runIndex) {
        const oids = heMesh.runOriginalID as Uint32Array;
        const idxs = heMesh.runIndex as Uint32Array;
        for (let i = 0; i < oids.length; i++) {
          const tris = (idxs[i + 1] - idxs[i]) / 3;
          heCounts[oids[i]] = (heCounts[oids[i]] || 0) + tris;
        }
      }
      out.q4_headId = head.originalID();
      out.q4_eyeId = eye.originalID();
      out.q4_perInputTriCounts = heCounts;
      out.q4_runIndexCoversAllTris = heCovers;

      // Q5 (bonus): What if you DON'T call asOriginal — does the result mesh
      // still get runOriginalID, or is it empty? This tells us whether
      // asOriginal is *required* for labelling or merely useful.
      const noLabelA = Manifold.cube([1, 1, 1]);
      const noLabelB = Manifold.sphere(1).translate([2, 0, 0]);
      const noLabelSum = noLabelA.add(noLabelB);
      const nlMesh = noLabelSum.getMesh();
      out.q5_a_id = noLabelA.originalID();
      out.q5_b_id = noLabelB.originalID();
      out.q5_runOriginalID = nlMesh.runOriginalID
        ? Array.from(nlMesh.runOriginalID as Uint32Array)
        : null;
      out.q5_runIndex = nlMesh.runIndex
        ? Array.from(nlMesh.runIndex as Uint32Array)
        : null;

      return out;
    });

    // Print everything so the test output captures the empirical answers.
    // eslint-disable-next-line no-console
    console.log('manifold-3d ID verification results:', JSON.stringify(result, null, 2));

    // Assertions encode the behavior we EXPECT (per the docs); a failing
    // assertion is the interesting case — it means the design changes.
    expect(result.q1_freshCubeOriginalID, 'fresh primitives should have a valid originalID').toBeGreaterThanOrEqual(0);
    expect(result.q2_runOriginalID, 'union result mesh should carry runOriginalID').not.toBeNull();
    expect((result.q2_runOriginalID as number[]).length, 'union result should have >= 2 runs').toBeGreaterThanOrEqual(2);
    expect(result.q2_runIndexCoversAllTris, 'runIndex should cover the full triVerts array').toBe(true);
    expect(result.q3_transformedCubeIdPresent, 'translated copy of labelled shape should carry its originalID through the union').toBe(true);
    expect(result.q4_runIndexCoversAllTris, 'overlapping union runIndex should still cover all triangles').toBe(true);
    expect(Object.keys(result.q4_perInputTriCounts as object).length, 'overlapping union should attribute triangles to >= 2 distinct originalIDs').toBeGreaterThanOrEqual(2);
  });
});
