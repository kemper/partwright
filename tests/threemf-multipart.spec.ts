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

      const built = build3MFProject([
        // A two-colour part → the non-dominant colour gets a paint_color.
        makePart('Body', [[255, 0, 0], [0, 0, 255]]),
        makePart('Lid', [[0, 0, 255]]),
      ]);
      const buf = new Uint8Array(await built.blob.arrayBuffer());
      // ZIP is STORE (uncompressed) so file contents appear verbatim in the bytes.
      const text = new TextDecoder('utf-8').decode(buf);
      return { filename: built.filename, text, size: buf.length };
    });

    expect(report.filename).toMatch(/\.3mf$/);
    // Two objects + two build items.
    expect(report.text).toContain('<object id="1" type="model">');
    expect(report.text).toContain('<object id="2" type="model">');
    expect((report.text.match(/<item objectid=/g) ?? []).length).toBe(2);
    // Bambu project marker (flips Bambu into multi-plate / filament-binding mode).
    expect(report.text).toContain('<metadata name="Application">BambuStudio-');
    // Generic material colours (read by non-Bambu slicers).
    expect(report.text).toContain('<m:colorgroup');
    expect(report.text).toContain('#FF0000FF');
    expect(report.text).toContain('#0000FFFF');
    // Bambu per-triangle paint_color (the non-dominant colour gets one).
    expect(report.text).toContain('paint_color=');
    // model_settings.config with one plate per part.
    expect(report.text).toContain('Metadata/model_settings.config');
    expect((report.text.match(/<plate>/g) ?? []).length).toBe(2);
    expect(report.text).toContain('key="plater_id" value="1"');
    expect(report.text).toContain('key="plater_id" value="2"');
    expect(report.text).toContain('key="extruder"');
    // project_settings.config pins filament colours WITHOUT preset-id keys (those
    // trigger Bambu's "customized presets / unsafe G-code" warning).
    expect(report.text).toContain('Metadata/project_settings.config');
    expect(report.text).toContain('filament_colour');
    expect(report.text).not.toContain('filament_settings_id');
    expect(report.text).not.toContain('printer_settings_id');
    // Each part must sit on its OWN plate: Bambu assigns by world position, so the
    // two <item> transforms must have DISTINCT X translations (else both stack on
    // plate 1). Transform is "1 0 0 0 1 0 0 0 1 TX TY TZ".
    const txs = [...report.text.matchAll(/<item objectid="\d+" transform="([^"]+)"/g)]
      .map(m => m[1].trim().split(/\s+/)[9]); // 12-value row-major matrix; index 9 = TX
    expect(txs.length).toBe(2);
    expect(txs[0]).not.toBe(txs[1]);
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
});
