// Golden path for 3MF import: a Bambu-style project (production-extension
// component file, per-part extruders in model_settings.config, a per-triangle
// paint_color, and the filament palette in project_settings.config) imported
// through the toolbar file picker lands as a manifold mesh whose triangles carry
// the file's filament colours as paint regions, with its palette made active.
// The console API twin (importMeshData) is covered with a plain colorgroup 3MF.

import { test, expect } from 'playwright/test';
import { buildZip } from '../src/export/zip';

const enc = (s: string) => new TextEncoder().encode(s);

const RELS = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
 <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>`;

/** An axis-aligned closed box as 3MF mesh XML (12 outward-wound triangles). */
function boxMesh(x0: number, y0: number, z0: number, s: number, triAttr: (t: number) => string = () => ''): string {
  const v = [
    [x0, y0, z0], [x0 + s, y0, z0], [x0 + s, y0 + s, z0], [x0, y0 + s, z0],
    [x0, y0, z0 + s], [x0 + s, y0, z0 + s], [x0 + s, y0 + s, z0 + s], [x0, y0 + s, z0 + s],
  ];
  const f = [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [2, 3, 7], [2, 7, 6], [0, 4, 7], [0, 7, 3], [1, 2, 6], [1, 6, 5]];
  return `<mesh><vertices>${v.map(p => `<vertex x="${p[0]}" y="${p[1]}" z="${p[2]}"/>`).join('')}</vertices>
<triangles>${f.map((t, i) => `<triangle v1="${t[0]}" v2="${t[1]}" v3="${t[2]}" ${triAttr(i)}/>`).join('')}</triangles></mesh>`;
}

function bambuProject(): Buffer {
  const root = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"
  xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06" requiredextensions="p">
  <metadata name="Application">BambuStudio-02.00.01.50</metadata>
  <metadata name="Title">Two Boxes</metadata>
  <resources><object id="3" type="model"><components>
    <component p:path="/3D/Objects/object_1.model" objectid="1"/>
    <component p:path="/3D/Objects/object_1.model" objectid="2"/>
  </components></object></resources>
  <build><item objectid="3" transform="1 0 0 0 1 0 0 0 1 128 128 0"/></build>
</model>`;
  // Box 1 (filament 1) has its top two triangles painted filament 3 ("0C");
  // box 2 sits on filament 2 via its part extruder.
  const objects = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
  <resources>
    <object id="1" type="model">${boxMesh(0, 0, 0, 10, t => (t === 2 || t === 3 ? 'paint_color="0C"' : ''))}</object>
    <object id="2" type="model">${boxMesh(15, 0, 0, 10)}</object>
  </resources>
</model>`;
  const settings = `<?xml version="1.0" encoding="UTF-8"?>
<config><object id="3"><metadata key="name" value="Two Boxes"/><metadata key="extruder" value="1"/>
  <part id="1" subtype="normal_part"/>
  <part id="2" subtype="normal_part"><metadata key="extruder" value="2"/></part>
</object></config>`;
  const project = JSON.stringify({ filament_colour: ['#FFFFFF', '#C02525', '#2452C0'], filament_type: ['PLA', 'PLA', 'PLA'] });
  return Buffer.from(buildZip([
    { name: '_rels/.rels', data: enc(RELS) },
    { name: '3D/3dmodel.model', data: enc(root) },
    { name: '3D/Objects/object_1.model', data: enc(objects) },
    { name: 'Metadata/model_settings.config', data: enc(settings) },
    { name: 'Metadata/project_settings.config', data: enc(project) },
  ]));
}

function plainColorgroup3MF(): Buffer {
  const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"
  xmlns:m="http://schemas.microsoft.com/3dmanufacturing/material/2015/02">
  <resources>
    <m:colorgroup id="7"><m:color color="#11AA44FF"/><m:color color="#FFCC00FF"/></m:colorgroup>
    <object id="1" type="model" pid="7" pindex="0">${boxMesh(0, 0, 0, 8, t => (t < 2 ? 'pid="7" p1="1"' : ''))}</object>
  </resources>
  <build><item objectid="1"/></build>
</model>`;
  return Buffer.from(buildZip([
    { name: '_rels/.rels', data: enc(RELS) },
    { name: '3D/3dmodel.model', data: enc(model) },
  ]));
}

test.describe('3MF import', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('partwright-tour-completed', '1'));
  });

  test('Bambu project imports with filament colours and adopts its palette', async ({ page }) => {
    await page.goto('/editor');
    await page.waitForSelector('text=Ready', { timeout: 15000 });

    await page.locator('#import-wrapper input[type="file"]').setInputFiles({
      name: 'two-boxes.3mf',
      mimeType: 'model/3mf',
      buffer: bambuProject(),
    });
    await expect(page.getByText(/Imported two-boxes\.3mf: 24 triangles, 3 colours/)).toBeVisible({ timeout: 20000 });

    const state = await page.evaluate(async () => {
      const pw = (window as unknown as { partwright: Record<string, (...a: unknown[]) => unknown> }).partwright;
      const geo = pw.getGeometryData() as { isManifold: boolean; componentCount: number; boundingBox: { x: number[] } };
      const regions = pw.listRegions() as { name: string; triangles: number; color: number[] }[];
      const palette = await import('/src/color/palette.ts');
      return {
        code: pw.getCode() as string,
        isManifold: geo.isManifold,
        components: geo.componentCount,
        bboxX: geo.boundingBox.x,
        regions: regions.map(r => ({ name: r.name, triangles: r.triangles })),
        paletteName: palette.getActivePaletteName(),
        slots: palette.listFilaments().map(s => s.hex.toLowerCase()),
      };
    });
    expect(state.code).toContain('Manifold.ofMesh(api.imports[0])');
    expect(state.isManifold).toBe(true);
    expect(state.components).toBe(2);
    // Bed position (128,128) recentred on the origin.
    expect(state.bboxX[0]).toBeCloseTo(-12.5, 3);
    expect(state.bboxX[1]).toBeCloseTo(12.5, 3);
    expect(state.regions).toEqual([
      { name: 'F1 PLA', triangles: 10 },
      { name: 'F2 PLA', triangles: 12 },
      { name: 'F3 PLA', triangles: 2 },
    ]);
    expect(state.paletteName).toBe('Two Boxes (3MF)');
    expect(state.slots).toEqual(['#ffffff', '#c02525', '#2452c0']);
  });

  test('importMeshData imports a plain colour-group 3MF', async ({ page }) => {
    await page.goto('/editor');
    await page.waitForSelector('text=Ready', { timeout: 15000 });
    const b64 = plainColorgroup3MF().toString('base64');
    const res = await page.evaluate(async (data) => {
      const pw = (window as unknown as { partwright: Record<string, (...a: unknown[]) => Promise<unknown> | unknown> }).partwright;
      const r = await pw.importMeshData(data, 'plain.3mf', { adoptPalette: false });
      return { r, regions: (pw.listRegions() as { name: string; triangles: number }[]).map(x => ({ name: x.name, triangles: x.triangles })) };
    }, b64);
    expect(res.r).toMatchObject({
      isManifold: true,
      triangleCount: 12,
      format: '3mf',
      flavor: 'generic',
      colorSource: 'materials',
      palette: [{ name: 'Color 1', hex: '#ffcc00' }, { name: 'Color 2', hex: '#11aa44' }],
      colorRegions: 2,
      activePalette: null,
    });
    expect(res.regions).toEqual([
      { name: 'Color 1', triangles: 2 },
      { name: 'Color 2', triangles: 10 },
    ]);
  });
});
