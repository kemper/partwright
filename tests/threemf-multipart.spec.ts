import { test, expect } from 'playwright/test';

// Multi-part 3MF export: validates the generic + Bambu "project" 3MF builder
// (multiple objects, one plate per part, m:colorgroup + paint_color colour) and
// the part-selection modal it's driven from.

test.describe('multi-part 3MF export', () => {
  test.beforeEach(async ({ page }) => {
    // Suppress the first-run guided tour — its backdrop intercepts clicks.
    await page.addInitScript(() => { try { localStorage.setItem('partwright-tour-completed', '1'); } catch { /* ignore */ } });
  });

  test('build3MFProject emits multiple objects, plates and colour bindings', async ({ page }) => {
    await page.goto('/editor');
    await page.waitForTimeout(3000); // let the module graph + engine settle

    const report = await page.evaluate(async () => {
      const { build3MFProject } = await import('/src/export/threemfProject.ts');

      // Build a part from a flat list of per-triangle colours. Two verts shared
      // across triangles keeps it valid; colours drive the material mapping.
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
        // A two-colour part → the non-dominant colour gets a paint_color (Bambu).
        makePart('Body', [[255, 0, 0], [0, 0, 255]]),
        makePart('Lid', [[0, 0, 255]]),
      ];
      const decode = (b: Blob) => b.arrayBuffer().then(a => new TextDecoder('utf-8').decode(new Uint8Array(a)));
      // ZIP is STORE (uncompressed) so file contents appear verbatim in the bytes.
      const bambu = build3MFProject(parts, { bambu: true, bedSize: [256, 256] });
      const generic = build3MFProject(parts, { bambu: false });
      return { filename: bambu.filename, bambu: await decode(bambu.blob), generic: await decode(generic.blob) };
    });

    expect(report.filename).toMatch(/\.3mf$/);

    // ── Bambu/Orca project mode ──
    const b = report.bambu;
    expect(b).toContain('<object id="1" type="model">');
    expect(b).toContain('<object id="2" type="model">');
    expect((b.match(/<item objectid=/g) ?? []).length).toBe(2);
    // Project marker (flips Bambu into multi-plate / filament-binding mode).
    expect(b).toContain('<metadata name="Application">BambuStudio-');
    // Generic material colours (read by non-Bambu slicers) + Bambu per-triangle paint.
    expect(b).toContain('<m:colorgroup');
    expect(b).toContain('#FF0000FF');
    expect(b).toContain('#0000FFFF');
    expect(b).toContain('paint_color=');
    // model_settings.config with one plate per part.
    expect(b).toContain('Metadata/model_settings.config');
    expect((b.match(/<plate>/g) ?? []).length).toBe(2);
    expect(b).toContain('key="plater_id" value="1"');
    expect(b).toContain('key="plater_id" value="2"');
    expect(b).toContain('key="extruder"');
    // We do NOT emit project_settings.config: a minimal one crashes Bambu's
    // project loader, a full one reintroduces the preset warning. So no preset
    // ids either. Colours come via colorgroup + extruder + paint_color.
    expect(b).not.toContain('Metadata/project_settings.config');
    expect(b).not.toContain('filament_settings_id');
    expect(b).not.toContain('printer_settings_id');
    // Each part on its OWN plate: Bambu assigns by world position, so the two
    // <item> X translations must differ AND match the plate stride (bed × 1.2 =
    // 307.2 for a 256 bed). Transform = "1 0 0 0 1 0 0 0 1 TX TY TZ".
    const bTxs = [...b.matchAll(/<item objectid="\d+" transform="([^"]+)"/g)]
      .map(m => parseFloat(m[1].trim().split(/\s+/)[9]));
    expect(bTxs.length).toBe(2);
    expect(Math.abs((bTxs[1] - bTxs[0]) - 256 * 1.2)).toBeLessThan(5); // plate stride

    // ── Generic multi-object mode ──
    const g = report.generic;
    expect(g).toContain('<object id="1" type="model">');
    expect(g).toContain('<object id="2" type="model">');
    expect((g.match(/<item objectid=/g) ?? []).length).toBe(2);
    expect(g).toContain('<m:colorgroup'); // colours still present for any slicer
    // No Bambu-specific metadata at all.
    expect(g).not.toContain('BambuStudio-');
    expect(g).not.toContain('Metadata/model_settings.config');
    expect(g).not.toContain('Metadata/project_settings.config');
    expect(g).not.toContain('paint_color=');
    // Grid-arranged → the two parts have distinct X positions (no overlap).
    const gTxs = [...g.matchAll(/<item objectid="\d+" transform="([^"]+)"/g)]
      .map(m => m[1].trim().split(/\s+/)[9]);
    expect(gTxs.length).toBe(2);
    expect(gTxs[0]).not.toBe(gTxs[1]);
  });

  test('part picker lets you choose parts and export a multi-plate 3MF', async ({ page }) => {
    await page.goto('/editor');
    await page.waitForTimeout(4000);

    // Build a 2-part session through the console API. Set units to mm so the
    // export-confirm (unitless) modal doesn't precede the part picker.
    const partCount = await page.evaluate(async () => {
      const pw = (window as unknown as { partwright: any }).partwright;
      const units = await import('/src/geometry/units.ts');
      units.setUnits('mm');
      await pw.runAndSave('return api.Manifold.cube([10,10,10], true);', 'box');
      await pw.createPart('Pyramid');
      await pw.runAndSave('return api.Manifold.cube([8,8,8], true);', 'pyramid');
      return pw.listParts ? pw.listParts().length : 2;
    });
    expect(partCount).toBeGreaterThan(1);
    await page.waitForTimeout(1500);

    // Trigger the Bambu/Orca multi-plate export (distinct from the generic 3MF).
    await page.locator('#btn-export').click();
    await page.locator('#export-dropdown').getByText('3MF — Bambu/Orca', { exact: true }).click();

    // The part picker should appear for a multi-part session.
    const modal = page.getByRole('dialog');
    await expect(modal.getByText(/Export parts to 3MF/i)).toBeVisible({ timeout: 10000 });
    await page.screenshot({ path: 'test-results/multipart-3mf-modal.png' });

    // Select all and export; intercept the download.
    await modal.getByRole('button', { name: /select all/i }).click();
    const downloadPromise = page.waitForEvent('download', { timeout: 30000 }).catch(() => null);
    await modal.getByRole('button', { name: /export/i }).click();
    const download = await downloadPromise;
    expect(download).not.toBeNull();
    expect(download!.suggestedFilename()).toMatch(/\.3mf$/);
  });

  test('export3MFPartsData bundles real parts through the full bake pipeline', async ({ page }) => {
    await page.goto('/editor');
    await page.waitForTimeout(4000);

    // Build 3 real coloured parts, then read the Bambu 3MF back via the
    // bytes-returning API (no browser download) and inspect the actual output —
    // this exercises the off-editor bake (bakeColoredMeshForPart) + the builder.
    const out = await page.evaluate(async () => {
      const pw = (window as unknown as { partwright: any }).partwright;
      (await import('/src/geometry/units.ts')).setUnits('mm');
      await pw.runAndSave('return api.label(api.Manifold.cube([20,20,20], true), "red", { color: [1,0,0] });', 'red');
      await pw.createPart('Green');
      await pw.runAndSave('return api.label(api.Manifold.sphere(12, 48), "green", { color: [0,1,0] });', 'green');
      await pw.createPart('Blue');
      await pw.runAndSave('return api.label(api.Manifold.cylinder(24, 10, 10, 48), "blue", { color: [0,0,1] });', 'blue');

      const r = await pw.export3MFPartsData(undefined, 'probe', { bambu: true });
      if (r.error) return { error: r.error };
      const bin = atob(r.base64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return { parts: r.parts, text: new TextDecoder('latin1').decode(bytes) };
    });

    expect((out as { error?: string }).error).toBeUndefined();
    const o = out as { parts: number; text: string };
    expect(o.parts).toBe(3);
    // Real bake produced 3 objects, 3 plates, the project_settings.config that
    // makes Bambu build the plate list, and no preset-id keys (warning guard).
    expect((o.text.match(/<object id="\d+" type="model">/g) ?? []).length).toBe(3);
    expect((o.text.match(/<plate>/g) ?? []).length).toBe(3);
    expect(o.text).not.toContain('Metadata/project_settings.config');
    expect(o.text).not.toContain('filament_settings_id');
    // Colours from api.label survived the off-editor bake → distinct material colours.
    expect(o.text).toContain('<m:colorgroup');
    const colors = [...o.text.matchAll(/<m:color color="(#[0-9A-F]{8})"/g)].map(m => m[1]);
    expect(new Set(colors).size).toBeGreaterThanOrEqual(3);
  });
});
