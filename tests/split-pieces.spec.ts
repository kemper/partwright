// splitIntoPieces / api.splitParts — cut a labelled model into separate
// printable pieces along its part boundaries (flat, medial and plug seams),
// preview without saving, save, undo; plus the modal's golden path.

import { test, expect, type Page } from 'playwright/test';
import { openSharedEditor } from './helpers/sharedPage';

interface PW {
  createSession: (n?: string) => Promise<unknown>;
  runAndSave: (code: string, label: string) => Promise<unknown>;
  getCode: () => string;
  getGeometryData: () => Promise<{ isManifold?: boolean; componentCount?: number } | null>;
  listObjectParts: () => { parts?: { name: string; triangleCount: number }[]; pieces?: { index: number; part?: string }[] };
  listVersions: () => Promise<unknown[]>;
  splitIntoPieces: (o?: Record<string, unknown>) => Promise<Record<string, unknown>>;
}

const FIGURE = [
  'const { Manifold } = api;',
  "const body = api.label(Manifold.sphere(20, 64).scale([1, 0.8, 1.2]), 'body');",
  "const head = api.label(Manifold.sphere(13, 64).translate([0, 0, 30]), 'head');",
  "const arm = api.label(Manifold.cylinder(30, 5, 4, 32).rotate([0, 12, 0]).translate([17, 0, -14]), 'arm');",
  "const eye = api.label(Manifold.sphere(4, 32).translate([0, -11.5, 33]), 'eye');",
  'return body.add(head).add(arm).add(eye);',
].join('\n');

let page: Page;
test.beforeAll(async ({ browser }, testInfo) => {
  page = await openSharedEditor(browser, testInfo);
});
test.afterAll(async () => {
  await page?.context().close();
});

test.describe('split into printable pieces', () => {
  test('preview, save and undo a split along part seams (flat / medial / plug)', async () => {
    test.setTimeout(180_000);
    const out = await page.evaluate(async (figure) => {
      const api = (window as unknown as { partwright: PW }).partwright;
      await api.createSession('split-pieces');
      await api.runAndSave(figure, 'figure');
      const versionsBefore = (await api.listVersions()).length;
      const preview = await api.splitIntoPieces({ seams: { eye: 'plug' }, render: false });
      const previewGeo = await api.getGeometryData();
      const versionsAfterPreview = (await api.listVersions()).length;
      const saved = await api.splitIntoPieces({ seams: { eye: 'plug' }, preview: false });
      const geo = await api.getGeometryData();
      const view = api.listObjectParts();
      const code = api.getCode();
      const bad = await api.splitIntoPieces({ seams: { nope: 'flat' }, render: false });
      const removed = await api.splitIntoPieces({ remove: true });
      const afterRemove = await api.getGeometryData();
      return {
        versionsBefore, versionsAfterPreview,
        preview: { ok: preview.ok, saved: preview.saved, pieces: preview.pieces, components: previewGeo?.componentCount },
        saved: { ok: saved.ok, saved: saved.saved, warnings: saved.warnings ?? null, pieces: saved.pieces },
        manifold: geo?.isManifold, components: geo?.componentCount,
        parts: Object.fromEntries((view.parts ?? []).map(p => [p.name, p.triangleCount])),
        pieceParts: (view.pieces ?? []).map(p => p.part ?? null).sort(),
        code,
        badError: (bad as { error?: string }).error ?? null,
        removed: removed.removed, componentsAfterRemove: afterRemove?.componentCount,
      };
    }, FIGURE);

    // Preview: pieces apart, nothing saved.
    expect(out.preview.ok).toBe(true);
    expect(out.preview.saved).toBe(false);
    expect(out.preview.components).toBe(4);
    expect(out.versionsAfterPreview).toBe(out.versionsBefore);
    // Seam modes: the plug was honoured, the planar neck auto-picked flat, the arm medial.
    const modes = Object.fromEntries((out.saved.pieces as { name: string; mode: string }[]).map(p => [p.name, p.mode]));
    expect(modes).toEqual({ eye: 'plug', arm: 'medial', head: 'flat', body: 'kept' });
    // Saved: four separate, watertight pieces, one part each, cut faces labelled.
    expect(out.saved.saved).toBe(true);
    expect(out.saved.warnings).toBeNull();
    expect(out.manifold).toBe(true);
    expect(out.components).toBe(4);
    expect(out.pieceParts).toEqual(['arm', 'body', 'eye', 'head']);
    for (const n of ['body', 'head', 'arm', 'eye']) expect(out.parts[n]).toBeGreaterThan(0);
    expect(out.code).toContain("return api.splitParts(body.add(head).add(arm).add(eye), { seams: { eye: 'plug' } });");
    // Bad options come back as an error, and the code is restored.
    expect(out.badError).toMatch(/no piece named "nope"/);
    // Undo the split: back to one solid.
    expect(out.removed).toBe(true);
    expect(out.componentsAfterRemove).toBe(1);
  });

  test('unlisted parts ride along with their piece and keep their labels; clearance keeps pieces whole', async () => {
    test.setTimeout(180_000);
    const out = await page.evaluate(async (figure) => {
      const api = (window as unknown as { partwright: PW }).partwright;
      await api.createSession('split-unlisted');
      await api.runAndSave(figure, 'figure');
      const two = await api.splitIntoPieces({ parts: ['head', 'body'], render: false });
      const twoGeo = await api.getGeometryData();
      const twoParts = Object.fromEntries((api.listObjectParts().parts ?? []).map(p => [p.name, p.triangleCount]));
      const gap = await api.splitIntoPieces({ seams: { eye: 'plug' }, clearance: 0.3, render: false });
      const gapGeo = await api.getGeometryData();
      return { twoWarnings: two.warnings ?? null, twoComponents: twoGeo?.componentCount, twoParts, gapWarnings: gap.warnings ?? null, gapComponents: gapGeo?.componentCount, gapManifold: gapGeo?.isManifold };
    }, FIGURE);
    expect(out.twoWarnings).toBeNull();
    expect(out.twoComponents).toBe(2);
    // The eye goes with the head and the arm with the body, labels intact.
    for (const n of ['body', 'head', 'arm', 'eye']) expect(out.twoParts[n]).toBeGreaterThan(0);
    expect(out.gapWarnings).toBeNull();
    expect(out.gapComponents).toBe(4);
    expect(out.gapManifold).toBe(true);
  });

  test('the Split modal previews pieces from the Tools menu', async () => {
    test.setTimeout(180_000);
    await page.evaluate(async (figure) => {
      const api = (window as unknown as { partwright: PW }).partwright;
      await api.createSession('split-modal');
      await api.runAndSave(figure, 'figure');
    }, FIGURE);
    await page.evaluate(() => (document.getElementById('split-pieces-viewport-toggle') as HTMLButtonElement).click());
    const dialog = page.getByRole('dialog', { name: 'Split into printable pieces' });
    await expect(dialog).toBeVisible();
    await dialog.locator('select[data-split-seam="eye"]').selectOption('plug');
    await dialog.locator('#split-preview').click();
    await expect(dialog.locator('#split-status')).toContainText('4 pieces', { timeout: 120_000 });
    await expect(dialog.locator('#split-status')).toContainText('eye (plug)');
    await page.screenshot({ path: 'test-results/split-pieces-modal.png' });
  });
});
