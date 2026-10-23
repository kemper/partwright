// Golden path for undelete: deleting an object moves it (with its versions) to
// the session's deleted-objects bin and deleting a part/piece writes a removal
// line into the code — both come back from the delete's Undo toast, and later
// from the Objects rail's "Recover deleted" modal. Also covers the console twins
// (listDeleted / restoreObject / restoreObjectPart).

import { test, expect, type Page } from 'playwright/test';

type PW = {
  createSession(n: string): Promise<unknown>;
  runAndSave(c: string, l: string): Promise<unknown>;
  createObject(n?: string): Promise<unknown>;
  getCode(): string;
  listObjects(): { id: string; name: string }[];
  listVersions(): Promise<{ label: string }[]>;
  getCurrentObject(): { id: string; name: string } | null;
  listObjectParts(): { parts: { name: string }[]; pieces: unknown[] };
  deleteObject(t: unknown): Promise<unknown>;
  deleteObjectPart(t: unknown): Promise<{ ok?: boolean; call?: string; error?: string }>;
  listDeleted(): Promise<{ objects: { id: string; name: string; versionCount: number }[]; parts: { object: { name: string }; kind: string; name?: string; label?: string; call: string }[] }>;
  restoreObject(t: unknown): Promise<{ restored?: { name: string }[]; droppedBlank?: boolean; error?: string }>;
  restoreObjectPart(t: unknown): Promise<{ ok?: boolean; restored?: string; error?: string }>;
};

async function waitForEngine(page: Page) {
  await page.waitForSelector('text=Ready', { timeout: 20_000 });
  await page.waitForFunction(
    () => !!(window as unknown as { partwright?: { listDeleted?: unknown } }).partwright?.listDeleted,
    { timeout: 20_000 },
  );
}

const cube = (marker: string, x = 0) =>
  `// ${marker}\nconst { Manifold } = api; return Manifold.cube([10, 10, 10], true).translate([${x}, 0, 0]);`;

// Two labelled parts plus a separate piece (the "coaster").
const MUG = `const { Manifold } = api;
const body = Manifold.cylinder(30, 20, 20, 48);
const handle = Manifold.cube([8, 4, 16], true).translate([22, 0, 15]);
const coaster = Manifold.cylinder(3, 26, 26, 48).translate([-70, 0, 0]);
return api.label(body, 'body', { color: '#3b82f6' })
  .add(api.label(handle, 'handle', { color: '#f97316' }))
  .add(api.label(coaster, 'coaster', { color: '#a8a29e' }));`;

test.describe('Recover deleted', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('partwright-tour-completed', '1');
      try {
        localStorage.setItem('partwright-ai-settings-v1', JSON.stringify({ codeView: 'full' }));
      } catch { /* ignore */ }
    });
  });

  test('deleted objects come back from the Undo toast and the Recover deleted modal', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto('/editor');
    await waitForEngine(page);
    await page.evaluate(async ({ a, b }) => {
      const p = (window as unknown as { partwright: PW }).partwright;
      await p.createSession('Recover objects');
      await p.runAndSave(a, 'alpha v1');
      await p.createObject('Beta');
      await p.runAndSave(b, 'beta v1');
      await p.runAndSave(b.replace('BETA', 'BETA2'), 'beta v2');
    }, { a: cube('ALPHA'), b: cube('BETA', 20) });

    const list = page.locator('#parts-list');
    const recover = page.locator('#btn-recover-deleted');
    await expect(recover).toHaveText('↺ Recover deleted (0)');

    // Rail ✕ deletes at once (no confirm) and offers Undo.
    const beta = list.locator('[data-part-id]', { hasText: 'Beta' });
    await beta.hover();
    await beta.getByTitle(/Delete this object/).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(list.locator('[data-part-id]', { hasText: 'Beta' })).toHaveCount(0);
    await expect(recover).toHaveText('↺ Recover deleted (1)');
    await page.locator('[data-toast-action]').click();
    await expect(list.locator('[data-part-id]')).toHaveCount(2);
    await expect(list.locator('[data-part-id]').nth(1)).toContainText('Beta');
    await expect(recover).toHaveText('↺ Recover deleted (0)');

    // Delete again, let the toast go, and restore from the modal instead.
    await beta.hover();
    await beta.getByTitle(/Delete this object/).click();
    await expect(recover).toHaveText('↺ Recover deleted (1)');
    await recover.click();
    const modal = page.getByRole('dialog', { name: 'Recover deleted' });
    const row = modal.locator('[data-recover-object]');
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('Beta');
    await expect(row).toContainText('2 versions');
    await page.screenshot({ path: 'test-results/recover-deleted-objects.png' });
    await row.getByRole('button', { name: 'Restore' }).click();
    await expect(modal).toContainText('No deleted objects in this session.');
    await modal.getByRole('button', { name: 'Close' }).click();

    const after = await page.evaluate(async () => {
      const p = (window as unknown as { partwright: PW }).partwright;
      return { names: p.listObjects().map(o => o.name), deleted: await p.listDeleted() };
    });
    expect(after.names).toEqual(['Object 1', 'Beta']);
    expect(after.deleted.objects).toEqual([]);
    await list.locator('[data-part-id]', { hasText: 'Beta' }).click();
    await expect(page.locator('#editor-title')).toHaveText('Beta');
    const versions = await page.evaluate(async () =>
      (await (window as unknown as { partwright: PW }).partwright.listVersions()).map(v => v.label));
    expect(versions).toEqual(expect.arrayContaining(['beta v1', 'beta v2']));
  });

  test('restoring after deleting the last object replaces the blank placeholder', async ({ page }) => {
    await page.goto('/editor');
    await waitForEngine(page);
    await page.evaluate(async (code) => {
      const p = (window as unknown as { partwright: PW }).partwright;
      await p.createSession('Recover last');
      await p.runAndSave(code, 'only v1');
    }, cube('ONLY'));
    const r = await page.evaluate(async () => {
      const p = (window as unknown as { partwright: PW }).partwright;
      await p.deleteObject(0);
      const blank = p.listObjects().map(o => o.name);
      const deleted = await p.listDeleted();
      const restored = await p.restoreObject(deleted.objects[0].id);
      return { blank, deleted: deleted.objects.map(o => o.versionCount), restored, objects: p.listObjects().map(o => o.name), code: p.getCode() };
    });
    expect(r.blank).toEqual(['Object 1']);
    expect(r.deleted).toEqual([1]);
    expect(r.restored.droppedBlank).toBe(true);
    expect(r.objects).toEqual(['Object 1']);
    expect(r.code).toContain('ONLY');
    await expect(page.locator('#parts-list [data-part-id]')).toHaveCount(1);
  });

  test('removed parts and pieces come back from Undo, the modal, and the API', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto('/editor');
    await waitForEngine(page);
    await page.evaluate(async ({ mug, other }) => {
      const p = (window as unknown as { partwright: PW }).partwright;
      await p.createSession('Recover parts');
      await p.runAndSave(other, 'other v1');
      await p.createObject('Mug');
      await p.runAndSave(mug, 'mug');
    }, { mug: MUG, other: cube('OTHER') });

    const section = page.locator('#parts-rail #object-parts');
    const recover = page.locator('#btn-recover-deleted');

    // Part ✕ → Undo puts the handle back (and saves a restore version).
    await section.locator('[data-object-part="part:handle"]').hover();
    await section.locator('[data-delete-object-part="part:handle"]').click();
    await expect(section.locator('[data-object-part="part:handle"]')).toHaveCount(0);
    await page.locator('[data-toast-action]').click();
    await expect(section.locator('[data-object-part="part:handle"]')).toBeVisible();
    await expect.poll(() => page.evaluate(async () =>
      (await (window as unknown as { partwright: PW }).partwright.listVersions()).map(v => v.label)))
      .toContain('restore part "handle"');

    // Piece ✕ → it lists in the modal under its comment name, even from another object.
    await section.locator('[data-object-part="piece:1"]').hover();
    await section.locator('[data-delete-object-part="piece:1"]').click();
    await expect(section).not.toContainText('Pieces');
    await expect(recover).toHaveText('↺ Recover deleted (1)');
    await page.locator('#parts-list [data-part-id]', { hasText: 'Object 1' }).click();
    await expect(page.locator('#editor-title')).toHaveText('Object 1');
    await recover.click();
    const modal = page.getByRole('dialog', { name: 'Recover deleted' });
    const row = modal.locator('[data-recover-part]');
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('Mug ▸ piece 2 ("coaster")');
    await page.screenshot({ path: 'test-results/recover-deleted-parts.png' });
    await row.getByRole('button', { name: 'Restore (opens Mug)' }).click();
    await expect(modal).toContainText('No removed parts or pieces');
    await modal.getByRole('button', { name: 'Close' }).click();
    await expect(page.locator('#editor-title')).toHaveText('Mug');
    await expect(section).toContainText('Pieces · 2');

    // Console twins: delete, list, restore by name.
    const api = await page.evaluate(async () => {
      const p = (window as unknown as { partwright: PW }).partwright;
      await p.deleteObjectPart('handle');
      const listed = await p.listDeleted();
      const restored = await p.restoreObjectPart('handle');
      const missing = await p.restoreObjectPart('handle');
      return { listed: listed.parts, restored, missing, code: p.getCode(), parts: p.listObjectParts().parts.map(x => x.name) };
    });
    expect(api.listed).toEqual([{ object: expect.objectContaining({ name: 'Mug' }), kind: 'part', name: 'handle', call: 'api.removePart("handle");' }]);
    expect(api.restored.ok).toBe(true);
    expect(api.missing.error).toContain('nothing removed matches');
    expect(api.code).not.toContain('api.remove');
    expect(api.parts).toEqual(['body', 'handle', 'coaster']);
  });

  test('OpenSCAD remove_part / remove_piece lines are restorable too', async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto('/editor');
    await waitForEngine(page);
    const r = await page.evaluate(async () => {
      const p = (window as unknown as { partwright: PW & { setActiveLanguage(l: string): Promise<unknown>; listObjectParts(): { parts: { name: string }[]; pieces: { index: number; part?: string }[] } } }).partwright;
      await p.createSession('Recover scad');
      await p.setActiveLanguage('scad');
      await p.runAndSave(`label("base") cube([20, 20, 4]);
label("peg") translate([5, 5, 4]) cube([4, 4, 10]);
translate([40, 0, 0]) cube([5, 5, 5]);`, 'v1');
      await p.deleteObjectPart('peg');
      const loose = p.listObjectParts().pieces.find(pc => !pc.part)!;
      await p.deleteObjectPart({ piece: loose.index });
      const listed = (await p.listDeleted()).parts.map(x => ({ kind: x.kind, call: x.call, label: x.label }));
      const part = await p.restoreObjectPart('peg');
      const piece = await p.restoreObjectPart(listed.find(x => x.kind === 'piece')!.call);
      const after = p.listObjectParts();
      return { listed, part, piece, code: p.getCode(), parts: after.parts.map(x => x.name), pieces: after.pieces.length };
    });
    expect(r.listed).toEqual([
      { kind: 'piece', call: expect.stringMatching(/^remove_piece\(\[/), label: expect.stringMatching(/^piece \d+$/) },
      { kind: 'part', call: 'remove_part("peg");', label: undefined },
    ]);
    expect(r.part.ok).toBe(true);
    expect(r.piece.ok).toBe(true);
    expect(r.code).not.toMatch(/remove_p/);
    expect(r.parts).toEqual(['base', 'peg']);
    expect(r.pieces).toBe(3);
  });
});
