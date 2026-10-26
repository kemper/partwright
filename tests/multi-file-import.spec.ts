// Importing several mesh files at once: two STLs and a 3MF picked together
// open one "Import 3 files" dialog listing every model (a 3MF's objects under
// its file name). They import one object per model, or as one object whose
// models are named parts, laid out in a grid. Re-importing the same files
// leaves out the models already in the session. The console twin
// (importMeshFiles) is covered too.

import { test, expect, type Page } from 'playwright/test';
import { boxesStl, twoPlateProject } from './helpers/meshFixtures';

type PW = Record<string, (...args: unknown[]) => unknown>;

const cube = (s: number) => boxesStl([[[-s / 2, -s / 2, 0], [s / 2, s / 2, s]]]);
const files = () => [
  { name: 'cube.stl', mimeType: 'model/stl', buffer: cube(10) },
  { name: 'tower.stl', mimeType: 'model/stl', buffer: boxesStl([[[-3, -3, 0], [3, 3, 30]]]) },
  { name: 'peg-kit.3mf', mimeType: 'model/3mf', buffer: twoPlateProject() },
];

async function objects(page: Page): Promise<{ name: string; group?: string }[]> {
  return page.evaluate(() => ((window as unknown as { partwright: PW }).partwright.listObjects() as { name: string; group?: string }[])
    .map(o => ({ name: o.name, ...(o.group ? { group: o.group } : {}) })));
}

test.describe('Multi-file mesh import', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('partwright-tour-completed', '1'));
    await page.goto('/editor');
    await page.waitForSelector('text=Ready', { timeout: 30_000 });
  });

  test('STL and 3MF files import together, one object per model', async ({ page }) => {
    test.setTimeout(120_000);
    await page.locator('#import-wrapper input[type="file"]').setInputFiles(files());

    const modal = page.getByRole('dialog', { name: 'Import 3 files' });
    await expect(modal).toBeVisible({ timeout: 30_000 });
    await expect(modal.getByText('2 STL · 1 3MF · 5 models · 60 triangles')).toBeVisible();
    await expect(modal.locator('[data-plate="2"]').getByText('peg-kit.3mf')).toBeVisible();
    await expect(modal.locator('[data-mode="object"]')).toHaveAttribute('aria-checked', 'true');
    await expect(modal.locator('[data-mode="file"]')).toBeVisible();
    // Separately made models around the origin: the grid is the default.
    await expect(modal.getByRole('radio', { name: /Arrange in a grid/ })).toBeChecked();
    await expect(modal.getByRole('radio', { name: /Mesh only/ })).toBeChecked();
    await page.screenshot({ path: 'test-results/multi-file-modal.png' });

    await modal.getByRole('button', { name: 'Import 5 objects' }).click();
    await expect(page.getByText('Imported 5 objects from 3 files.')).toBeVisible({ timeout: 60_000 });
    expect(await objects(page)).toEqual([
      { name: 'cube' },
      { name: 'tower' },
      { name: 'Base', group: 'peg-kit' },
      { name: 'Peg', group: 'peg-kit' },
      { name: 'Lid', group: 'peg-kit' },
    ]);
    // No convert-to-code / part detection panel pops up after a batch.
    await expect(page.getByRole('dialog', { name: 'Detect parts' })).toHaveCount(0);
    await expect(page.getByText('Convert model to code')).toHaveCount(0);
  });

  test('one object with each model a named part, in a grid', async ({ page }) => {
    test.setTimeout(120_000);
    await page.locator('#import-wrapper input[type="file"]').setInputFiles(files().slice(0, 2));
    const modal = page.getByRole('dialog', { name: 'Import 2 files' });
    await expect(modal).toBeVisible({ timeout: 30_000 });
    await modal.locator('[data-mode="none"]').click();
    await modal.getByRole('radio', { name: /Arrange in a grid/ }).check();
    await modal.getByRole('button', { name: 'Import 1 object' }).click();
    await expect(page.getByText('Imported 2 files as one object.')).toBeVisible({ timeout: 60_000 });
    const state = await page.evaluate(() => {
      const pw = (window as unknown as { partwright: PW }).partwright;
      const geo = pw.getGeometryData() as { boundingBox: { x: number[]; y: number[]; z: number[] }; componentCount: number };
      return {
        objects: (pw.listObjects() as { name: string }[]).map(o => o.name),
        parts: (pw.listObjectParts() as { parts: { name: string }[] }).parts.map(p => p.name),
        span: Math.max(geo.boundingBox.x[1] - geo.boundingBox.x[0], geo.boundingBox.y[1] - geo.boundingBox.y[0]),
        z: geo.boundingBox.z,
        components: geo.componentCount,
      };
    });
    expect(state.objects).toEqual(['cube and 1 more']);
    expect(state.parts).toEqual(['cube', 'tower']);
    expect(state.components).toBe(2);
    // Side by side (10 + gap + 6 along one axis), not piled on the origin (10).
    expect(state.span).toBeGreaterThan(16);
    expect(state.z[0]).toBeCloseTo(0, 3);
    await page.screenshot({ path: 'test-results/multi-file-one-object.png' });
  });

  test('re-importing leaves out the models already in the session', async ({ page }) => {
    test.setTimeout(150_000);
    const input = page.locator('#import-wrapper input[type="file"]');
    await input.setInputFiles(files().slice(0, 2));
    let modal = page.getByRole('dialog', { name: 'Import 2 files' });
    await expect(modal).toBeVisible({ timeout: 30_000 });
    await modal.getByRole('button', { name: 'Import 2 objects' }).click();
    await expect(page.getByText('Imported 2 objects from 2 files.')).toBeVisible({ timeout: 60_000 });

    await input.setInputFiles(files());
    modal = page.getByRole('dialog', { name: 'Import 3 files' });
    await expect(modal).toBeVisible({ timeout: 30_000 });
    await expect(modal.getByLabel('Import cube')).not.toBeChecked();
    await expect(modal.getByLabel('Import tower')).not.toBeChecked();
    await expect(modal.getByLabel('Import Base')).toBeChecked();
    await expect(modal.locator('[data-skip-note]')).toHaveCount(2);
    await page.screenshot({ path: 'test-results/multi-file-reimport.png' });
    await modal.getByRole('button', { name: 'Import 3 objects' }).click();
    await expect(page.getByText(/Imported 3 objects from 1 file\. Skipped 2 models already in this session/)).toBeVisible({ timeout: 60_000 });
    expect((await objects(page)).map(o => o.name)).toEqual(['cube', 'tower', 'Base', 'Peg', 'Lid']);
  });

  test('importMeshFiles: one object per file, converted to code, skipping existing models', async ({ page }) => {
    test.setTimeout(150_000);
    const payload = files().map(f => ({ filename: f.name, base64: f.buffer.toString('base64') }));
    const res = await page.evaluate(async (data) => {
      const pw = (window as unknown as { partwright: PW }).partwright;
      const bad = await pw.importMeshFiles([{ filename: 'a.obj', base64: 'AAAA' }]);
      const first = await pw.importMeshFiles(data.slice(0, 1), { convert: true }) as { importedObjects: { name: string }[]; converted: number };
      const code = pw.getCode() as string;
      const second = await pw.importMeshFiles(data, { target: 'new-object', mode: 'file', layout: 'keep' }) as {
        importedObjects: { name: string }[]; models: { name: string; imported: boolean; skipped?: string }[];
      };
      return { bad, first, code, second, objects: (pw.listObjects() as { name: string }[]).map(o => o.name) };
    }, payload);
    expect((res.bad as { error?: string }).error).toMatch(/only \.stl and \.3mf/);
    expect(res.first.converted).toBe(1);
    expect(res.first.importedObjects.map(o => o.name)).toEqual(['cube']);
    // Converted: the code rebuilds the shape without the import.
    expect(res.code).not.toContain('api.imports');
    expect(res.second.models.filter(m => !m.imported).map(m => [m.name, m.skipped])).toEqual([['cube', 'already imported']]);
    expect(res.second.importedObjects.map(o => o.name)).toEqual(['tower', 'peg-kit']);
    expect(res.objects).toEqual(['cube', 'tower', 'peg-kit']);
  });
});
