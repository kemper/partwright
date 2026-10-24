// Multi-object import: a Bambu-style 3MF with three objects on two build
// plates opens the "Import 3MF" chooser (objects listed under their plates),
// and imports one object per 3MF object (grouped by plate) or one per plate.
// A multi-body STL can be split into one object per piece from the post-import
// part proposal. The console twins (importMeshData split / inspectMeshData)
// are covered too.

import { test, expect, type Page } from 'playwright/test';
import { buildZip } from '../src/export/zip';

const enc = (s: string) => new TextEncoder().encode(s);

type PW = Record<string, (...args: unknown[]) => unknown>;

const RELS = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
 <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>`;

/** Corners of an axis-aligned box ([min, max]) as outward-wound triangles. */
function boxTris(a: number[], b: number[]): number[][][] {
  const v = (i: number) => [i & 1 ? b[0] : a[0], i & 2 ? b[1] : a[1], i & 4 ? b[2] : a[2]];
  const quads = [[0, 2, 3, 1], [4, 5, 7, 6], [0, 1, 5, 4], [2, 6, 7, 3], [0, 4, 6, 2], [1, 3, 7, 5]];
  return quads.flatMap(([p, q, r, s]) => [[v(p), v(q), v(r)], [v(p), v(r), v(s)]]);
}

function boxMeshXml(a: number[], b: number[]): string {
  const tris = boxTris(a, b);
  const verts: string[] = [];
  const index = new Map<string, number>();
  const faces = tris.map(t => t.map(p => {
    const k = p.join(',');
    if (!index.has(k)) { index.set(k, verts.length); verts.push(`<vertex x="${p[0]}" y="${p[1]}" z="${p[2]}"/>`); }
    return index.get(k)!;
  }));
  return `<mesh><vertices>${verts.join('')}</vertices><triangles>${faces.map(f => `<triangle v1="${f[0]}" v2="${f[1]}" v3="${f[2]}"/>`).join('')}</triangles></mesh>`;
}

/** Three objects on two plates: "Base" + "Peg" on plate 1, "Lid" on plate 2 ("Lids"). */
function twoPlateProject(): Buffer {
  const root = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
  <metadata name="Application">BambuStudio-02.00.01.50</metadata>
  <metadata name="Title">Peg Kit</metadata>
  <resources>
    <object id="1" type="model">${boxMeshXml([0, 0, 0], [30, 30, 10])}</object>
    <object id="2" type="model">${boxMeshXml([0, 0, 0], [8, 8, 20])}</object>
    <object id="3" type="model">${boxMeshXml([0, 0, 0], [24, 24, 4])}</object>
  </resources>
  <build>
    <item objectid="1" transform="1 0 0 0 1 0 0 0 1 100 110 0"/>
    <item objectid="2" transform="1 0 0 0 1 0 0 0 1 150 120 0"/>
    <item objectid="3" transform="1 0 0 0 1 0 0 0 1 420 110 0"/>
  </build>
</model>`;
  const instance = (id: number) => `<model_instance><metadata key="object_id" value="${id}"/><metadata key="instance_id" value="0"/></model_instance>`;
  const settings = `<?xml version="1.0" encoding="UTF-8"?>
<config>
  <object id="1"><metadata key="name" value="Base"/><metadata key="extruder" value="1"/></object>
  <object id="2"><metadata key="name" value="Peg"/><metadata key="extruder" value="2"/></object>
  <object id="3"><metadata key="name" value="Lid"/><metadata key="extruder" value="3"/></object>
  <plate><metadata key="plater_id" value="1"/><metadata key="plater_name" value=""/>${instance(1)}${instance(2)}</plate>
  <plate><metadata key="plater_id" value="2"/><metadata key="plater_name" value="Lids"/>${instance(3)}</plate>
</config>`;
  const project = JSON.stringify({ filament_colour: ['#E8E8E8', '#C02525', '#2452C0'], filament_type: ['PLA', 'PLA', 'PLA'] });
  return Buffer.from(buildZip([
    { name: '_rels/.rels', data: enc(RELS) },
    { name: '3D/3dmodel.model', data: enc(root) },
    { name: 'Metadata/model_settings.config', data: enc(settings) },
    { name: 'Metadata/project_settings.config', data: enc(project) },
  ]));
}

function boxesStl(boxes: [number[], number[]][]): Buffer {
  const tris = boxes.flatMap(([a, b]) => boxTris(a, b));
  const buf = Buffer.alloc(84 + tris.length * 50);
  buf.writeUInt32LE(tris.length, 80);
  tris.forEach((t, i) => {
    const o = 84 + i * 50;
    t.forEach((p, k) => p.forEach((c, j) => buf.writeFloatLE(c, o + 12 + k * 12 + j * 4)));
  });
  return buf;
}

async function objects(page: Page): Promise<{ name: string; group?: string }[]> {
  return page.evaluate(() => ((window as unknown as { partwright: PW }).partwright.listObjects() as { name: string; group?: string }[])
    .map(o => ({ name: o.name, ...(o.group ? { group: o.group } : {}) })));
}

test.describe('Multi-object mesh import', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('partwright-tour-completed', '1'));
    await page.goto('/editor');
    await page.waitForSelector('text=Ready', { timeout: 30_000 });
  });

  test('a two-plate 3MF imports one object per 3MF object, grouped by plate', async ({ page }) => {
    test.setTimeout(90_000);
    await page.locator('#import-wrapper input[type="file"]').setInputFiles({ name: 'peg-kit.3mf', mimeType: 'model/3mf', buffer: twoPlateProject() });

    const modal = page.getByRole('dialog', { name: 'Import 3MF' });
    await expect(modal).toBeVisible({ timeout: 20_000 });
    await expect(modal.getByText('Bambu Studio project · 2 plates · 3 objects')).toBeVisible();
    await expect(modal.locator('[data-plate="1"]').getByText('Plate 1')).toBeVisible();
    await expect(modal.locator('[data-plate="2"]').getByText('Lids')).toBeVisible();
    await expect(modal.locator('[data-mode="object"]')).toHaveAttribute('aria-checked', 'true');
    await page.screenshot({ path: 'test-results/threemf-split-modal.png' });

    await modal.getByRole('button', { name: 'Import 3 objects' }).click();
    await expect(page.getByText('Imported 3 objects from peg-kit.3mf')).toBeVisible({ timeout: 30_000 });
    expect(await objects(page)).toEqual([
      { name: 'Base', group: 'Plate 1' },
      { name: 'Peg', group: 'Plate 1' },
      { name: 'Lid', group: 'Lids' },
    ]);
    // The first object is open, recentred on its own origin, in its filament colour.
    const state = await page.evaluate(() => {
      const pw = (window as unknown as { partwright: PW }).partwright;
      const geo = pw.getGeometryData() as { boundingBox: { x: number[]; y: number[] } };
      return {
        current: (pw.getCurrentObject() as { name: string }).name,
        x: geo.boundingBox.x,
        regions: (pw.listRegions() as { name: string; triangles: number }[]).map(r => ({ name: r.name, triangles: r.triangles })),
      };
    });
    expect(state.current).toBe('Base');
    expect(state.x[0]).toBeCloseTo(-15, 3);
    expect(state.x[1]).toBeCloseTo(15, 3);
    expect(state.regions).toEqual([{ name: 'F1 PLA', triangles: 12 }]);
    await page.screenshot({ path: 'test-results/threemf-split-result.png' });
  });

  test('one object per plate, and unticked objects stay out', async ({ page }) => {
    test.setTimeout(90_000);
    await page.locator('#import-wrapper input[type="file"]').setInputFiles({ name: 'peg-kit.3mf', mimeType: 'model/3mf', buffer: twoPlateProject() });
    const modal = page.getByRole('dialog', { name: 'Import 3MF' });
    await expect(modal).toBeVisible({ timeout: 20_000 });
    await modal.locator('[data-mode="plate"]').click();
    await expect(modal.getByRole('button', { name: 'Import 2 objects' })).toBeVisible();
    await modal.getByLabel('Import Peg').uncheck();
    await expect(modal.getByLabel('Import everything on Plate 1')).toHaveJSProperty('indeterminate', true);
    await modal.getByRole('button', { name: 'Import 2 objects' }).click();
    await expect(page.getByText('Imported 2 objects from peg-kit.3mf')).toBeVisible({ timeout: 30_000 });
    expect(await objects(page)).toEqual([{ name: 'Plate 1' }, { name: 'Lids' }]);
    const tris = await page.evaluate(() => ((window as unknown as { partwright: PW }).partwright.getGeometryData() as { triangleCount: number }).triangleCount);
    expect(tris).toBe(12); // Base only — the Peg was left out
  });

  test('a multi-body STL splits into one object per piece', async ({ page }) => {
    test.setTimeout(90_000);
    await page.locator('#import-wrapper input[type="file"]').setInputFiles({
      name: 'blocks.stl',
      mimeType: 'model/stl',
      buffer: boxesStl([[[0, 0, 0], [10, 10, 10]], [[20, 0, 0], [26, 6, 6]], [[40, 0, 0], [52, 12, 12]]]),
    });
    const panel = page.getByRole('dialog', { name: 'Detect parts' });
    await expect(panel).toBeVisible({ timeout: 30_000 });
    await panel.getByRole('button', { name: 'Split into 3 objects' }).click();
    await expect(page.getByText('Split blocks.stl into 3 objects.')).toBeVisible({ timeout: 30_000 });
    // Largest first; the original object keeps the first piece as a new version.
    expect(await objects(page)).toEqual([
      { name: 'blocks · piece 1' },
      { name: 'blocks · piece 2' },
      { name: 'blocks · piece 3' },
    ]);
    const state = await page.evaluate(async () => {
      const pw = (window as unknown as { partwright: PW }).partwright;
      const versions = (await pw.listVersions()) as { label: string }[];
      return { current: (pw.getCurrentObject() as { name: string }).name, versions: versions.length, tris: (pw.getGeometryData() as { triangleCount: number }).triangleCount };
    });
    expect(state).toEqual({ current: 'blocks · piece 1', versions: 2, tris: 12 });
  });

  test('importMeshData splits by plate and inspectMeshData lists objects', async ({ page }) => {
    test.setTimeout(90_000);
    const b64 = twoPlateProject().toString('base64');
    const res = await page.evaluate(async (data) => {
      const pw = (window as unknown as { partwright: PW }).partwright;
      const info = await pw.inspectMeshData(data, 'kit.3mf');
      const bad = await pw.importMeshData(data, 'kit.3mf', { split: 'piece' });
      const r = await pw.importMeshData(data, 'kit.3mf', { split: 'object', objects: [0, 2], adoptPalette: false });
      return { info, bad, r };
    }, b64);
    expect(res.info).toMatchObject({
      format: '3mf',
      objects: [
        { index: 0, name: 'Base', triangleCount: 12, plate: 1 },
        { index: 1, name: 'Peg', triangleCount: 12, plate: 1 },
        { index: 2, name: 'Lid', triangleCount: 12, plate: 2 },
      ],
      plates: [{ id: 1, name: 'Plate 1', objectCount: 2 }, { id: 2, name: 'Lids', objectCount: 1 }],
      splitModes: ['none', 'object', 'plate'],
    });
    expect((res.bad as { error?: string }).error).toMatch(/'piece' is for STL/);
    expect(res.r).toMatchObject({
      isManifold: true,
      triangleCount: 24,
      importedObjects: [{ name: 'Base', group: 'Plate 1' }, { name: 'Lid', group: 'Lids' }],
    });
    expect(await objects(page)).toEqual([{ name: 'Base', group: 'Plate 1' }, { name: 'Lid', group: 'Lids' }]);
  });
});
