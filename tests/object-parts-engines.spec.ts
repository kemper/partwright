// Deleting parts and pieces from the object list beyond manifold-js (#1058):
// OpenSCAD (`remove_part` / `remove_piece`), BREP (`api.removePart` →
// BREP.label returns an empty shape), parts detected on an imported mesh
// (triangles dropped + opening capped), and voxel pieces. Each delete writes a
// removal line into the code, re-runs, and saves a version.

import { test, expect, type Page } from 'playwright/test';

type Listed = { parts: { name: string; triangleCount: number }[]; pieces: { index: number; triangleCount: number; part?: string }[]; lostParts: string[] };
type PW = {
  createSession(n: string): Promise<unknown>;
  setActiveLanguage(l: string): Promise<unknown>;
  runAndSave(c: string, l: string): Promise<unknown>;
  getCode(): string;
  getGeometryData(): { triangleCount: number; volume: number; isManifold: boolean; status: string };
  listObjectParts(): Listed;
  deleteObjectPart(t: unknown): Promise<{ ok?: boolean; call?: string; error?: string }>;
  exportSTLData(): Promise<{ base64: string }>;
  importMeshData(b64: string, name: string): Promise<{ error?: string }>;
  detectParts(o: unknown): Promise<{ error?: string }>;
  acceptParts(): Promise<{ error?: string }>;
};

async function start(page: Page, name: string, lang?: string): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 1200 });
  await page.goto('/editor');
  await page.waitForSelector('text=Ready', { timeout: 30_000 });
  await page.waitForFunction(() => !!(window as unknown as { partwright?: { deleteObjectPart?: unknown } }).partwright?.deleteObjectPart);
  await page.evaluate(async ({ name, lang }) => {
    const pw = (window as unknown as { partwright: PW }).partwright;
    await pw.createSession(name);
    if (lang) await pw.setActiveLanguage(lang);
  }, { name, lang });
}

const pw = (page: Page) => ({
  list: () => page.evaluate(() => (window as unknown as { partwright: PW }).partwright.listObjectParts()),
  code: () => page.evaluate(() => (window as unknown as { partwright: PW }).partwright.getCode()),
  geo: () => page.evaluate(() => (window as unknown as { partwright: PW }).partwright.getGeometryData()),
  del: (t: unknown) => page.evaluate((t) => (window as unknown as { partwright: PW }).partwright.deleteObjectPart(t), t),
  save: (code: string) => page.evaluate((c) => (window as unknown as { partwright: PW }).partwright.runAndSave(c, 'v1'), code),
});

test.describe('Object list — deleting parts and pieces on other engines', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('partwright-tour-completed', '1'));
  });

  test('OpenSCAD: remove_part / remove_piece', async ({ page }) => {
    test.setTimeout(120_000);
    await start(page, 'scad delete', 'scad');
    const p = pw(page);
    await p.save(`label("base") cube([20, 20, 4]);
label("peg") translate([5, 5, 4]) cube([4, 4, 10]);
translate([40, 0, 0]) cube([5, 5, 5]);`);
    let listed = await p.list();
    expect(listed.parts.map(x => x.name)).toEqual(['base', 'peg']);
    expect(listed.pieces.length).toBe(3);

    const r1 = await p.del('peg');
    expect(r1.error).toBeUndefined();
    expect(r1.call).toBe('remove_part("peg");');
    listed = await p.list();
    expect(listed.parts.map(x => x.name)).toEqual(['base']);
    expect(listed.lostParts).toEqual([]);
    expect(await p.code()).toMatch(/^remove_part\("peg"\);/);

    // The loose cube is the only piece no part covers.
    const loose = listed.pieces.find(pc => !pc.part)!;
    expect(loose).toBeDefined();
    const r2 = await p.del({ piece: loose.index });
    expect(r2.error).toBeUndefined();
    expect(r2.call).toMatch(/^remove_piece\(\[/);
    listed = await p.list();
    expect(listed.pieces.length).toBe(1);
    expect(listed.parts.map(x => x.name)).toEqual(['base']);
  });

  test('BREP: a fused part is removed; pieces explain why they cannot be', async ({ page }) => {
    test.setTimeout(180_000);
    await start(page, 'brep delete', 'replicad');
    const p = pw(page);
    await p.save(`const { BREP } = api;
const base = BREP.label(BREP.box([20, 20, 4]), 'base');
const peg = BREP.label(BREP.cylinder(3, 10).translate([0, 0, 4]), 'peg');
const loose = BREP.label(BREP.box([4, 4, 4]).translate([30, 0, 0]), 'loose');
return base.fuse(peg).fuse(loose);`);
    let listed = await p.list();
    expect(listed.parts.map(x => x.name).sort()).toEqual(['base', 'loose', 'peg']);
    const before = await p.geo();

    const r = await p.del('peg');
    expect(r.error).toBeUndefined();
    expect(r.call).toBe('api.removePart("peg");');
    listed = await p.list();
    expect(listed.parts.map(x => x.name).sort()).toEqual(['base', 'loose']);
    const after = await p.geo();
    expect(after.volume).toBeLessThan(before.volume);

    // Piece delete is blocked up front with a reason on the ✕ and from the API.
    const section = page.locator('#parts-rail #object-parts');
    const pieceDel = section.locator('[data-delete-object-part="piece:1"]');
    await expect(pieceDel).toHaveAttribute('aria-disabled', 'true');
    await expect(pieceDel).toHaveAttribute('title', /BREP objects can't delete a separate piece/);
    const blocked = await p.del({ piece: 1 });
    expect(blocked.error).toMatch(/BREP objects can't delete a separate piece/);
  });

  test('BREP labels index the displayed mesh (#1061)', async ({ page }) => {
    test.setTimeout(180_000);
    await start(page, 'brep labels', 'replicad');
    const p = pw(page);
    await p.save(`const { BREP } = api;
const base = BREP.label(BREP.box([20, 20, 4]), 'base');
const peg = BREP.label(BREP.cylinder(3, 10).translate([0, 0, 4]), 'peg');
const loose = BREP.label(BREP.box([4, 4, 4]).translate([30, 0, 0]), 'loose');
return base.fuse(peg).fuse(loose);`);
    const listed = await p.list();
    // The separate cube is its own piece, and every triangle of it is "loose".
    const loosePart = listed.parts.find(x => x.name === 'loose')!;
    const loosePiece = listed.pieces.find(pc => pc.triangleCount === loosePart.triangleCount)!;
    expect(loosePiece).toBeDefined();
    expect(loosePiece.part).toBe('loose');
    // The fused box keeps a holed top face, so it's more than a plain 12-tri box.
    expect(listed.parts.find(x => x.name === 'base')!.triangleCount).toBeGreaterThan(12);
    const main = listed.pieces.find(pc => pc !== loosePiece)!;
    expect(['base', 'peg']).toContain(main.part);
  });

  test('BREP.toManifold labels survive later booleans in a JS session (#1061)', async ({ page }) => {
    test.setTimeout(180_000);
    await start(page, 'brep in js');
    const p = pw(page);
    await p.save(`const { Manifold, BREP } = api;
const brep = BREP.toManifold(BREP.label(BREP.box([4, 4, 4]), 'brepbox'), Manifold).translate([30, 0, 0]);
return api.label(Manifold.cube([20, 20, 4], true), 'plate').add(brep);`);
    const listed = await p.list();
    expect(listed.parts.map(x => x.name).sort()).toEqual(['brepbox', 'plate']);
    const box = listed.parts.find(x => x.name === 'brepbox')!;
    const boxPiece = listed.pieces.find(pc => pc.part === 'brepbox')!;
    expect(boxPiece).toBeDefined();
    expect(boxPiece.triangleCount).toBe(box.triangleCount);
  });

  test('imported mesh: a detected part is removed and the opening capped', async ({ page }) => {
    test.setTimeout(180_000);
    await start(page, 'import delete');
    const imported = await page.evaluate(async () => {
      const w = (window as unknown as { partwright: PW }).partwright;
      await w.runAndSave(`const { Manifold } = api;
return Manifold.cube([20, 20, 10]).add(Manifold.cube([10, 10, 10]).translate([5, 5, 10])).refine(4);`, 'block');
      const stl = await w.exportSTLData();
      return w.importMeshData(stl.base64, 'block.stl');
    });
    expect(imported.error).toBeUndefined();
    await page.waitForFunction(() => /api\.imports\[0\]/.test(String((window as unknown as { partwright: PW }).partwright.getCode())));
    await page.waitForSelector('text=Ready', { timeout: 30_000 });
    const det = await page.evaluate(() => (window as unknown as { partwright: PW }).partwright.detectParts({
      algorithm: 'crease-watershed',
      seeds: [{ label: 'base', point: [10, 10, 0] }, { label: 'top', point: [10, 10, 20] }],
    }));
    expect(det.error).toBeUndefined();
    const acc = await page.evaluate(() => (window as unknown as { partwright: PW }).partwright.acceptParts());
    expect(acc.error).toBeUndefined();
    const p = pw(page);
    await expect.poll(async () => (await p.list()).parts.map(x => x.name).sort()).toEqual(['base', 'top']);

    const r = await p.del('top');
    expect(r.error).toBeUndefined();
    expect(r.call).toBe('api.removePart("top");');
    const listed = await p.list();
    expect(listed.parts.map(x => x.name)).toEqual(['base']);
    const geo = await p.geo();
    expect(geo.isManifold).toBe(true);
    // The base block alone, with its top closed by a flat cap.
    expect(geo.volume).toBeCloseTo(4000, 0);
  });

  test('voxel: a separate piece is removed', async ({ page }) => {
    test.setTimeout(120_000);
    await start(page, 'voxel delete', 'voxel');
    const p = pw(page);
    await p.save(`const v = api.voxels();
v.fillBox([0, 0, 0], [3, 3, 3], '#ef4444');
v.fillBox([8, 0, 0], [9, 1, 1], '#22c55e');
return v;`);
    let listed = await p.list();
    expect(listed.pieces.length).toBe(2);
    const small = [...listed.pieces].sort((a, b) => a.triangleCount - b.triangleCount)[0];
    const r = await p.del({ piece: small.index });
    expect(r.error).toBeUndefined();
    expect(r.call).toMatch(/^api\.removePiece\(\[/);
    listed = await p.list();
    expect(listed.pieces.length).toBe(1);
    expect(await p.code()).toMatch(/^api\.removePiece\(/);
  });
});
