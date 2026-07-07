import { test, expect } from 'playwright/test';

// Multi-part 3MF export: validates the generic + Bambu "project" 3MF builder
// (multiple objects, one plate per part, m:colorgroup + paint_color colour) and
// the part-selection modal it's driven from.

test.describe('multi-part 3MF export', () => {
  test.beforeEach(async ({ page }) => {
    // Suppress the first-run guided tour — its backdrop intercepts clicks.
    await page.addInitScript(() => { try { localStorage.setItem('partwright-tour-completed', '1'); localStorage.setItem('editor-auto-format', 'false'); } catch { /* ignore */ } });
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

    // ── Bambu/Orca project mode (production-extension layout) ──
    // Mirrors a real BambuStudio-02.05.00.66 project (USER-REF.3mf). The structural
    // invariants below are exactly the ones that, if broken, make the real slicer
    // reject the file or crash — so this guards the headless-validated recipe.
    const b = report.bambu;
    // Production extension: each part is a wrapper -> separate /3D/Objects/*.model.
    expect(b).toContain('requiredextensions="p"');
    expect((b.match(/p:path="\/3D\/Objects\/object_\d+\.model"/g) ?? []).length).toBe(2);
    expect((b.match(/<component /g) ?? []).length).toBe(2);
    // Project marker (flips Bambu into project / multi-plate mode).
    expect(b).toContain('<metadata name="Application">BambuStudio-');
    // IN-PART COLOUR: Body is two-colour (red + blue), so the triangles whose AMS
    // slot differs from the object's base extruder carry a per-triangle paint_color
    // (Bambu's MMU attribute). This is what makes hand-paint / api.label regions show
    // WITHIN a part — no m:colorgroup/pid here (that's the generic material extension).
    expect(b).toContain('paint_color=');
    expect(b).not.toContain('<m:colorgroup');
    // model_settings.config: one <plate> per part.
    expect(b).toContain('Metadata/model_settings.config');
    expect((b.match(/<plate>/g) ?? []).length).toBe(2);
    expect(b).toContain('key="extruder"');
    // PER-PART COLOUR: each part maps to its own AMS filament slot, so the two
    // differently-coloured parts get DISTINCT extruders (Body→1 red, Lid→2 blue)
    // and the part palette lands in filament_colour. Regression guard against the
    // "all extruder 1 / grey filament_colour" single-colour base.
    expect(b).toContain('key="extruder" value="1"');
    expect(b).toContain('key="extruder" value="2"');
    expect(b).toContain('"filament_colour": [');
    expect(b).toMatch(/#FF0000/i); // Body's red made it into the filament palette
    // NO 3-COLOUR CAP: the config is resized to one filament per distinct colour.
    // Body uses red+blue, Lid blue → 2 distinct → filament_colour length 2, and the
    // per-filament arrays scale with it (nozzle_temperature is ×2 per extruder variant
    // → length 4). upward_compatible_machine is NOT per-filament so it stays length 3.
    // Guards the N-filament resize against regressing to a fixed 3.
    const arrLen = (key: string) => {
      const m = b.match(new RegExp(`"${key}":\\s*\\[([\\s\\S]*?)\\]`));
      return m ? (m[1].match(/"[^"]*"/g) ?? []).length : -1;
    };
    expect(arrLen('filament_colour')).toBe(2);
    expect(arrLen('nozzle_temperature')).toBe(4);
    expect(arrLen('upward_compatible_machine')).toBe(3);
    // CRASH FIX: <part id=ODD subtype="normal_part"> + <mesh_stat> must be present
    // (was missing before; caused Bambu GUI crash on project open).
    expect(b).toContain('<part ');
    expect(b).toContain('mesh_stat');
    // identify_id must be present in each <model_instance>.
    expect(b).toContain('identify_id');
    // LOAD-CRITICAL: plater_name MUST be empty — a non-empty value makes Orca's
    // loader reject the project (regression guard for the bug we hit).
    expect(b).not.toMatch(/plater_name" value="[^"]+"/);
    // REQUIRED: project_settings.config makes the loader build the plate list AND
    // carries the COMPLETE per-filament arrays. filament_colour MUST be present —
    // its absence is what made Bambu's GUI load_files null-deref (SIGSEGV) on open
    // (a partial config indexes past the end of the filament arrays). The config is
    // a full Bambu Lab H2C profile copied from a known-good reference.
    expect(b).toContain('Metadata/project_settings.config');
    expect(b).toContain('filament_settings_id');
    expect(b).toContain('"filament_colour"');
    expect(b).toContain('Bambu Lab H2C');
    // ID scheme: wrapper ids are EVEN (2,4,…), mesh ids are ODD (1,3,…).
    // Root model items reference the EVEN wrapper ids.
    expect(b).toContain('objectid="2"');
    expect(b).toContain('objectid="4"');
    // Object files are named object_1.model / object_2.model (sequential).
    expect(b).toContain('/3D/Objects/object_1.model');
    expect(b).toContain('/3D/Objects/object_2.model');
    // Each part placed in its own plate slot → distinct <item> X translations.
    const bTxs = [...b.matchAll(/<item objectid="\d+"[^>]*transform="([^"]+)"/g)]
      .map(m => m[1].trim().split(/\s+/)[9]);
    expect(bTxs.length).toBe(2);
    expect(bTxs[0]).not.toBe(bTxs[1]);

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

    // The Bambu export shows the printer/nozzle/filament dropdowns (not the generic).
    await expect(modal.getByText(/Bambu Studio settings/i)).toBeVisible();
    await expect(modal.locator('select')).toHaveCount(3);
    // Pick a single-nozzle printer to exercise the override path through the modal.
    await modal.locator('select').first().selectOption('p1s');

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
    // Real bake → 3 production-extension parts, 3 plates, project_settings.config
    // (builds the plate list), empty plater_name (load-critical).
    expect((o.text.match(/p:path="\/3D\/Objects\/object_\d+\.model"/g) ?? []).length).toBe(3);
    expect((o.text.match(/<plate>/g) ?? []).length).toBe(3);
    expect(o.text).toContain('Metadata/project_settings.config');
    expect(o.text).not.toMatch(/plater_name" value="[^"]+"/);
    // CRASH FIX: <part id=ODD subtype="normal_part"> + <mesh_stat> present in model_settings.
    expect(o.text).toContain('<part ');
    expect(o.text).toContain('mesh_stat');
    expect(o.text).toContain('identify_id');
    // Bambu mode: mesh triangles are plain (no per-triangle colorgroup/paint_color);
    // single-colour base puts every object on extruder 1.
    expect(o.text).not.toContain('paint_color=');
    // project_settings carries the COMPLETE filament arrays (crash fix — see above).
    expect(o.text).toContain('"filament_colour"');
    // ID scheme: EVEN wrapper ids (2,4,6), SEQUENTIAL object files (object_1/2/3.model).
    expect(o.text).toContain('/3D/Objects/object_1.model');
    expect(o.text).toContain('/3D/Objects/object_2.model');
    expect(o.text).toContain('/3D/Objects/object_3.model');
  });

  test('Bambu plates use BambuStudio\'s ⌈√N⌉-column grid with per-axis stride', async ({ page }) => {
    await page.goto('/editor');
    await page.waitForTimeout(3000);

    // 6 parts → ⌈√6⌉ = 3 columns × 2 rows, matching BambuStudio's PartPlateList.
    // Each part centres on its plate cell at (col·396 + 165, −row·384 + 160) for the
    // 330×320 H2C bed: plate_stride_x = width·1.2 = 396, plate_stride_y = depth·1.2 =
    // 384 (LOGICAL_PART_PLATE_GAP = 1/5). Asserting the PER-AXIS strides guards the
    // exact source-derived layout — a single uniform stride drifts parts off-centre.
    const cols = await page.evaluate(async () => {
      const { build3MFProject } = await import('/src/export/threemfProject.ts');
      const makePart = (name: string) => {
        const verts = [0, 0, 0, 10, 0, 0, 0, 10, 0];
        return {
          name,
          mesh: {
            vertProperties: new Float32Array(verts), triVerts: new Uint32Array([0, 1, 2]),
            numVert: 3, numTri: 1, numProp: 3,
          },
        };
      };
      const parts = Array.from({ length: 6 }, (_, i) => makePart('part' + i));
      const built = build3MFProject(parts, { bambu: true });
      const text = await built.blob.arrayBuffer().then(a => new TextDecoder().decode(new Uint8Array(a)));
      const items = [...text.matchAll(/<item objectid="\d+"[^>]*transform="([^"]+)"/g)]
        .map(m => m[1].trim().split(/\s+/));
      const xs = [...new Set(items.map(t => Number(t[9])))].sort((a, b) => a - b);
      const ys = [...new Set(items.map(t => Number(t[10])))].sort((a, b) => b - a);
      return { items: items.length, xCols: xs.length, yRows: ys.length, xs, ys };
    });
    // Per-axis strides (rounded to avoid float noise): X=396, Y=384.
    expect(Math.round(cols.xs[1] - cols.xs[0])).toBe(396);
    expect(Math.round(cols.ys[0] - cols.ys[1])).toBe(384);
    expect(cols.items).toBe(6);
    expect(cols.xCols).toBe(3); // ⌈√6⌉ columns
    expect(cols.yRows).toBe(2); // 2 rows
  });

  test('plateLayout controls how parts distribute across Bambu plates', async ({ page }) => {
    await page.goto('/editor');
    await page.waitForTimeout(3000);

    // 4 parts, two of them sharing a group ("A"), the other two ungrouped. The
    // three layout modes should produce distinct plate counts + placements.
    const out = await page.evaluate(async () => {
      const { build3MFProject } = await import('/src/export/threemfProject.ts');
      const makePart = (name: string, group?: string) => ({
        name, ...(group ? { group } : {}),
        mesh: {
          vertProperties: new Float32Array([0, 0, 0, 10, 0, 0, 0, 10, 0]),
          triVerts: new Uint32Array([0, 1, 2]), numVert: 3, numTri: 1, numProp: 3,
        },
      });
      const parts = [
        makePart('a1', 'A'), makePart('a2', 'A'), makePart('loose1'), makePart('loose2'),
      ];
      const decode = (built: { blob: Blob }) =>
        built.blob.arrayBuffer().then(a => new TextDecoder().decode(new Uint8Array(a)));
      const plateCount = (t: string) => (t.match(/<plate>/g) ?? []).length;
      // Distinct <item> X translations = distinct plate/sub-grid columns occupied.
      const distinctXs = (t: string) => new Set(
        [...t.matchAll(/<item objectid="\d+"[^>]*transform="([^"]+)"/g)]
          .map(m => Number(m[1].trim().split(/\s+/)[9]).toFixed(2)),
      ).size;

      const sep = await decode(build3MFProject(parts, { bambu: true, plateLayout: 'separate' }));
      const grid = await decode(build3MFProject(parts, { bambu: true, plateLayout: 'grid' }));
      const group = await decode(build3MFProject(parts, { bambu: true, plateLayout: 'group' }));
      const dflt = await decode(build3MFProject(parts, { bambu: true })); // default = separate
      return {
        sepPlates: plateCount(sep), gridPlates: plateCount(grid), groupPlates: plateCount(group),
        dfltPlates: plateCount(dflt),
        gridDistinctXs: distinctXs(grid),
      };
    });

    // separate → one plate per part; default matches separate.
    expect(out.sepPlates).toBe(4);
    expect(out.dfltPlates).toBe(4);
    // grid → all four on ONE plate (but still spread out in a sub-grid, so >1 column).
    expect(out.gridPlates).toBe(1);
    expect(out.gridDistinctXs).toBeGreaterThan(1);
    // group → group A (2 parts) + two ungrouped singletons = 3 plates.
    expect(out.groupPlates).toBe(3);
  });

  test('printer selection swaps the base + stamps identity/bed (H2C dual vs P1S single)', async ({ page }) => {
    await page.goto('/editor');
    await page.waitForTimeout(3000);

    const out = await page.evaluate(async () => {
      const { build3MFProject } = await import('/src/export/threemfProject.ts');
      const makePart = (name: string) => ({
        name,
        mesh: {
          vertProperties: new Float32Array([0, 0, 0, 10, 0, 0, 0, 10, 0]),
          triVerts: new Uint32Array([0, 1, 2]), numVert: 3, numTri: 1, numProp: 3,
        },
      });
      const decode = (built: { blob: Blob }) =>
        built.blob.arrayBuffer().then(a => new TextDecoder('latin1').decode(new Uint8Array(a)));
      const arrLen = (text: string, key: string) => {
        const m = text.match(new RegExp(`"${key}":\\s*\\[([\\s\\S]*?)\\]`));
        return m ? (m[1].match(/"[^"]*"/g) ?? []).length : -1;
      };
      const str = (text: string, key: string) => new RegExp(`"${key}":\\s*"([^"]*)"`).exec(text)?.[1];
      const parts = Array.from({ length: 4 }, (_, i) => makePart('p' + i));
      const h2c = await decode(build3MFProject(parts, { bambu: true })); // default
      const p1s = await decode(build3MFProject(parts, { bambu: true, printer: 'p1s', nozzle: '0.6' }));
      // H2S is single-nozzle (regression guard: was wrongly mapped to the dual base);
      // H2D is dual + a non-base printer (guards the print-process compatibility fix).
      const h2s = await decode(build3MFProject(parts, { bambu: true, printer: 'h2s' }));
      const h2d = await decode(build3MFProject(parts, { bambu: true, printer: 'h2d' }));
      return {
        h2cModel: str(h2c, 'printer_model'),
        h2cArea: /"printable_area":\s*\[([^\]]*)\]/.exec(h2c)?.[1].replace(/\s/g, ''),
        h2cNozzles: arrLen(h2c, 'nozzle_diameter'),
        p1sModel: str(p1s, 'printer_model'),
        p1sSettings: str(p1s, 'printer_settings_id'),
        p1sArea: /"printable_area":\s*\[([^\]]*)\]/.exec(p1s)?.[1].replace(/\s/g, ''),
        p1sNozzles: arrLen(p1s, 'nozzle_diameter'),
        h2sNozzles: arrLen(h2s, 'nozzle_diameter'),
        h2sProcess: str(h2s, 'print_settings_id'),
        h2sCompat: /"print_compatible_printers":\s*\[([^\]]*)\]/.exec(h2s)?.[1],
        h2dProcess: str(h2d, 'print_settings_id'),
        h2dCompat: /"print_compatible_printers":\s*\[([^\]]*)\]/.exec(h2d)?.[1],
      };
    });

    // Default = H2C dual-nozzle, 330×320 bed.
    expect(out.h2cModel).toBe('Bambu Lab H2C');
    expect(out.h2cNozzles).toBe(2);
    expect(out.h2cArea).toContain('330x320');
    // P1S = single-nozzle base, identity + bed + nozzle stamped from the picker.
    expect(out.p1sModel).toBe('Bambu Lab P1S');
    expect(out.p1sSettings).toBe('Bambu Lab P1S 0.6 nozzle');
    expect(out.p1sNozzles).toBe(1);
    expect(out.p1sArea).toContain('256x256');
    // H2S is SINGLE-nozzle (not the dual H2C base) — regression guard.
    expect(out.h2sNozzles).toBe(1);
    // Process + compatibility stamped to the target printer (the rc -17 fix): a
    // non-base printer must carry its own process + print_compatible_printers, else
    // Bambu rejects "printer not compatible with the process preset".
    expect(out.h2sProcess).toBe('0.20mm Standard @BBL H2S');
    expect(out.h2sCompat).toContain('Bambu Lab H2S');
    expect(out.h2dProcess).toBe('0.20mm Standard @BBL H2D');
    expect(out.h2dCompat).toContain('Bambu Lab H2D');
  });
});
