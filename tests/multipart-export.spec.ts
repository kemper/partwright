import { test, expect } from 'playwright/test';

// Multi-part OBJ / STL / GLB export: validates the format-specific multi-part
// builders (named objects in one OBJ, a .zip of per-part STLs, named nodes in one
// GLB) and the full part-bake pipeline driven through the console API.

test.describe('multi-part OBJ / STL / GLB export', () => {
  test.beforeEach(async ({ page }) => {
    // Suppress the first-run guided tour — its backdrop intercepts clicks.
    await page.addInitScript(() => { try { localStorage.setItem('partwright-tour-completed', '1'); localStorage.setItem('editor-auto-format', 'false'); } catch { /* ignore */ } });
  });

  test('builders emit named objects / per-part files / named nodes', async ({ page }) => {
    await page.goto('/editor');
    await page.waitForTimeout(4000); // let the module graph + engine settle

    const report = await page.evaluate(async () => {
      const { buildOBJProject } = await import('/src/export/obj.ts');
      const { buildSTLProject } = await import('/src/export/stl.ts');
      const { buildGLBProject } = await import('/src/export/gltf.ts');

      // A part built from a flat list of per-triangle colours (mirrors the 3MF
      // multipart test): each triangle gets 3 fresh verts so colours are valid.
      const makePart = (name: string, triRgb: [number, number, number][]) => {
        const verts: number[] = [];
        const tris: number[] = [];
        const colors: number[] = [];
        triRgb.forEach((rgb, i) => {
          const base = i * 3;
          verts.push(0, 0, i, 10, 0, i, 0, 10, i);
          tris.push(base, base + 1, base + 2);
          colors.push(rgb[0], rgb[1], rgb[2]);
        });
        const triColors = new Uint8Array(colors);
        (triColors as Uint8Array & { _painted?: Uint8Array })._painted = new Uint8Array(triRgb.length).fill(1);
        return {
          name,
          mesh: {
            vertProperties: new Float32Array(verts), triVerts: new Uint32Array(tris),
            numVert: triRgb.length * 3, numTri: triRgb.length, numProp: 3, triColors,
          },
        };
      };

      const parts = [
        makePart('Body', [[255, 0, 0], [0, 0, 255]]),
        makePart('Lid', [[0, 0, 255]]),
      ];

      const bytes = (b: Blob) => b.arrayBuffer().then(a => new Uint8Array(a));
      const text = (b: Blob) => b.arrayBuffer().then(a => new TextDecoder('latin1').decode(new Uint8Array(a)));

      const obj = buildOBJProject(parts);
      const stl = buildSTLProject(parts);
      const glb = buildGLBProject(parts);

      // Pull the JSON chunk out of the GLB to inspect the scene graph. GLB layout:
      // 12-byte header, then a JSON chunk (length @12, type @16, data @20).
      const glbBuilt = await glb;
      const glbBytes = await bytes(glbBuilt.blob);
      const dv = new DataView(glbBytes.buffer);
      const jsonLen = dv.getUint32(12, true);
      const glbJson = JSON.parse(new TextDecoder().decode(glbBytes.subarray(20, 20 + jsonLen)));

      return {
        obj: { filename: obj.filename, mime: obj.mimeType, text: await text(obj.blob) },
        stl: { filename: stl.filename, mime: stl.mimeType, text: await text(stl.blob) },
        glb: { filename: glbBuilt.filename, mime: glbBuilt.mimeType, json: glbJson },
      };
    });

    // ── OBJ: named objects in one file, grid-arranged, colours → .mtl in a .zip ──
    expect(report.obj.mime).toBe('application/zip'); // painted → OBJ+MTL bundle
    expect(report.obj.filename).toMatch(/\.zip$/);
    const o = report.obj.text;
    // One `o <part>` per part — the named, separable objects OBJ supports natively.
    expect((o.match(/^o Body/m) ?? []).length).toBe(1);
    expect((o.match(/^o Lid/m) ?? []).length).toBe(1);
    // Shared material library + per-colour groups (red + blue from Body).
    expect(o).toContain('mtllib');
    expect(o).toContain('newmtl');
    expect((o.match(/^usemtl /gm) ?? []).length).toBeGreaterThanOrEqual(2);
    // Cumulative vertex indexing: the Lid's faces must reference verts past the
    // Body's 6 unique verts (a face index > 6 proves the offset was applied).
    const faceIdx = [...o.matchAll(/^f (\d+) (\d+) (\d+)/gm)].flatMap(m => [Number(m[1]), Number(m[2]), Number(m[3])]);
    expect(Math.max(...faceIdx)).toBeGreaterThan(6);
    // Grid layout: the two parts occupy distinct X columns, so some vertices carry
    // a negative X (left cell) and some a positive X (right cell) — no overlap.
    const xs = [...o.matchAll(/^v (-?[\d.]+) /gm)].map(m => Number(m[1]));
    expect(Math.min(...xs)).toBeLessThan(0);
    expect(Math.max(...xs)).toBeGreaterThan(0);

    // ── STL: a .zip with one .stl per part (no soup merge) ──
    expect(report.stl.mime).toBe('application/zip');
    expect(report.stl.filename).toMatch(/\.zip$/);
    // Both part filenames appear in the ZIP (central directory / local headers).
    expect(report.stl.text).toContain('Body.stl');
    expect(report.stl.text).toContain('Lid.stl');

    // ── GLB: each part a named node/mesh in one scene ──
    expect(report.glb.mime).toBe('model/gltf-binary');
    expect(report.glb.filename).toMatch(/\.glb$/);
    const names = (report.glb.json.nodes ?? []).map((n: { name?: string }) => n.name);
    expect(names).toContain('Body');
    expect(names).toContain('Lid');
    expect(report.glb.json.meshes.length).toBe(2);
    // Grid layout: the two nodes sit at different X positions (no overlap). The
    // exporter may write the position as `translation` (TRS) or baked into a
    // `matrix` (element 12 = translation X) — accept either form.
    const xPos = (report.glb.json.nodes ?? []).map((n: { translation?: number[]; matrix?: number[] }) =>
      n.translation ? n.translation[0] : (n.matrix ? n.matrix[12] : 0));
    expect(new Set(xPos).size).toBeGreaterThan(1);
  });

  test('exportOBJ/STL/GLBPartsData bundle real parts through the full bake pipeline', async ({ page }) => {
    await page.goto('/editor');
    await page.waitForTimeout(4000);

    const out = await page.evaluate(async () => {
      const pw = (window as unknown as { partwright: any }).partwright;
      (await import('/src/geometry/units.ts')).setUnits('mm');
      // Three real coloured parts.
      await pw.runAndSave('return api.label(api.Manifold.cube([20,20,20], true), "red", { color: [1,0,0] });', 'red');
      await pw.createPart('Green');
      await pw.runAndSave('return api.label(api.Manifold.sphere(12, 48), "green", { color: [0,1,0] });', 'green');
      await pw.createPart('Blue');
      await pw.runAndSave('return api.label(api.Manifold.cylinder(24, 10, 10, 48), "blue", { color: [0,0,1] });', 'blue');

      const obj = await pw.exportOBJPartsData(undefined, 'probe');
      const stl = await pw.exportSTLPartsData(undefined, 'probe');
      const glb = await pw.exportGLBPartsData(undefined, 'probe');
      return { obj, stl, glb };
    });

    // Each API twin baked all 3 parts and returned bytes (no download).
    for (const r of [out.obj, out.stl, out.glb]) {
      expect((r as { error?: string }).error).toBeUndefined();
      expect((r as { parts: number }).parts).toBe(3);
      expect((r as { base64: string }).base64.length).toBeGreaterThan(0);
    }
    expect(out.obj.mimeType).toBe('application/zip');   // painted → OBJ+MTL .zip
    expect(out.stl.mimeType).toBe('application/zip');   // .zip of 3 .stl
    expect(out.glb.mimeType).toBe('model/gltf-binary');
  });

  test('OBJ part picker exports a multi-object file from a multi-part session', async ({ page }) => {
    await page.goto('/editor');
    await page.waitForTimeout(4000);

    // Build a 2-part session through the console API (mm so the unitless confirm
    // modal doesn't precede the part picker).
    await page.evaluate(async () => {
      const pw = (window as unknown as { partwright: any }).partwright;
      (await import('/src/geometry/units.ts')).setUnits('mm');
      await pw.runAndSave('return api.Manifold.cube([10,10,10], true);', 'box');
      await pw.createPart('Pyramid');
      await pw.runAndSave('return api.Manifold.cube([8,8,8], true);', 'pyramid');
    });
    await page.waitForTimeout(1500);

    await page.locator('#btn-export').click();
    await page.locator('#export-dropdown').getByText('OBJ', { exact: true }).click();

    // The part picker should appear, titled for OBJ.
    const modal = page.getByRole('dialog');
    await expect(modal.getByText(/Export parts to OBJ/i)).toBeVisible({ timeout: 10000 });
    await page.screenshot({ path: 'test-results/multipart-obj-modal.png' });

    await modal.getByRole('button', { name: /select all/i }).click();
    const downloadPromise = page.waitForEvent('download', { timeout: 30000 }).catch(() => null);
    await modal.getByRole('button', { name: /export/i }).click();
    const download = await downloadPromise;
    expect(download).not.toBeNull();
    // Painted? No — plain cubes → plain .obj. Either way the multi-part OBJ path ran.
    expect(download!.suggestedFilename()).toMatch(/\.(obj|zip)$/);
  });
});
