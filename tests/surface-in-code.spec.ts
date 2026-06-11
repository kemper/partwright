// api.surface.* — surface textures declared in code. The op chain is recorded
// during the run but applied (and memoized) on the MAIN thread.
//
// Explicit/console runs (partwright.run / runAndSave, the Run button, version
// loads) FORCE the memoized compute and return the textured mesh — so an
// AI/console caller gets the real result with no extra step (it can't press the
// in-UI pill). Only the editor's live-typing auto-run is gated behind the
// "Re-apply" pill. See src/surface/surfaceOps.ts + applySurfaceTextures.

import { test, expect, type Page } from 'playwright/test';

async function waitForEngine(page: Page) {
  await page.waitForSelector('text=Ready', { timeout: 20_000 });
  await page.waitForFunction(
    () => !!(window as unknown as { partwright?: { run?: unknown } }).partwright?.run,
    { timeout: 20_000 },
  );
}

type PW = {
  createSession: (n?: string) => Promise<unknown>;
  run: (code: string) => Promise<{ error?: string | null; triangleCount?: number } | unknown>;
  getGeometryData: () => { triangleCount?: number };
};

test.describe('api.surface.* (textures declared in code)', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('partwright-tour-completed', '1');
      // Keep the code pane visible (the AI drawer auto-open collapses it),
      // so the stale-export test can click into .cm-content.
      try {
        localStorage.setItem('partwright-ai-settings-v1', JSON.stringify({ editorCollapsed: false }));
      } catch { /* ignore */ }
    });
  });

  test('a console run force-applies the texture and returns the textured mesh', async ({ page }) => {
    await page.goto('/editor');
    await waitForEngine(page);

    const out = await page.evaluate(async () => {
      const pw = (window as unknown as { partwright: PW }).partwright;
      await pw.createSession('surface-in-code');
      // Base sphere triangle count, no texture.
      const plain = await pw.run([
        'const { Manifold } = api;',
        'return Manifold.sphere(10, 48);',
      ].join('\n')) as { triangleCount?: number };
      // Same geometry + a cable texture: the console run must compute it inline
      // (not gate) so the returned stats reflect the textured, subdivided mesh.
      const textured = await pw.run([
        'const { Manifold } = api;',
        'api.surface.cable({ cableWidth: 1.6, amplitude: 0.5 });',
        'return Manifold.sphere(10, 48);',
      ].join('\n')) as { triangleCount?: number };
      return { plainTris: plain.triangleCount ?? 0, texturedTris: textured.triangleCount ?? 0 };
    });

    expect(out.plainTris).toBeGreaterThan(0);
    // The texture subdivides + displaces, so triangle count grows substantially.
    expect(out.texturedTris).toBeGreaterThan(out.plainTris);

    // No "Re-apply" pill on a console/explicit run — the texture was applied.
    await expect(page.getByRole('button', { name: /Re-apply/ })).toBeHidden();
    await page.screenshot({ path: 'test-results/surface-in-code-textured.png' });
  });

  test('exporting while textures are stale carries a warning', async ({ page }) => {
    await page.goto('/editor');
    await waitForEngine(page);

    // Put api.surface code in the editor WITHOUT running it, then trigger the
    // live-typing auto-run by typing. The un-cached chain renders the base mesh
    // and raises the Re-apply pill — the one state where an export would carry
    // the untextured mesh.
    await page.evaluate(async () => {
      const pw = (window as unknown as { partwright: PW & { setCode: (c: string) => void } }).partwright;
      await pw.createSession('surface-stale-export');
      pw.setCode([
        'const { Manifold } = api;',
        'api.surface.fuzzy({ amplitude: 0.5 });',
        'return Manifold.sphere(10, 32);',
      ].join('\n'));
    });
    await page.click('.cm-content');
    await page.keyboard.press('Control+End');
    await page.keyboard.type('\n// touch');
    await expect(page.getByRole('button', { name: /Re-apply/ })).toBeVisible({ timeout: 15_000 });

    const out = await page.evaluate(async () => {
      const pw = (window as unknown as { partwright: { exportSTLData: () => Promise<{ warning?: string }> } }).partwright;
      return await pw.exportSTLData();
    });
    expect(out.warning ?? '').toContain('untextured');

    // An explicit run clears the pill — and with it, the warning.
    const after = await page.evaluate(async () => {
      const pw = (window as unknown as { partwright: PW & { getCode: () => string; exportSTLData: () => Promise<{ warning?: string }> } }).partwright;
      await pw.run(pw.getCode());
      return await pw.exportSTLData();
    });
    expect(after.warning).toBeUndefined();
    await expect(page.getByRole('button', { name: /Re-apply/ })).toBeHidden();
  });

  test('a saved texture persists with the version and a reload renders it with no pill', async ({ page }) => {
    await page.goto('/editor');
    await waitForEngine(page);

    const code = [
      'const { Manifold } = api;',
      'api.surface.cable({ cableWidth: 1.6, amplitude: 0.5 });',
      'return Manifold.sphere(10, 48);',
    ].join('\n');

    const saved = await page.evaluate(async (src) => {
      const pw = (window as unknown as { partwright: PW & {
        runAndSave: (c: string, l?: string) => Promise<{ geometry: { triangleCount?: number }; version: { id: string } | null }>;
      } }).partwright;
      await pw.createSession('surface-persist');
      const r = await pw.runAndSave(src, 'textured');
      // The saved version record must carry the computed texture: the
      // full-chain memo key plus the textured mesh, typed arrays intact
      // (IndexedDB structured clone).
      const db = await import('/src/storage/db.ts');
      const v = await db.getVersionById(r.version!.id) as {
        surfaceTexture?: { key?: string; mesh?: { numTri?: number; vertProperties?: unknown } };
      } | null;
      return {
        texturedTris: r.geometry.triangleCount ?? 0,
        persistedKey: v?.surfaceTexture?.key ?? '',
        persistedTris: v?.surfaceTexture?.mesh?.numTri ?? 0,
        persistedIsTyped: v?.surfaceTexture?.mesh?.vertProperties instanceof Float32Array,
      };
    }, code);

    expect(saved.texturedTris).toBeGreaterThan(10_000); // cable subdivides well past the base sphere
    expect(saved.persistedKey).not.toBe('');
    expect(saved.persistedTris).toBe(saved.texturedTris);
    expect(saved.persistedIsTyped).toBe(true);

    // Reload: the in-memory memo cache is gone, but the version load seeds it
    // from the persisted texture — the session must come back textured (same
    // triangle count) with no Re-apply pill and no recompute pass.
    await page.reload();
    await waitForEngine(page);
    await page.waitForFunction(
      (tris) => {
        const el = document.getElementById('geometry-data');
        if (!el?.textContent) return false;
        try { return JSON.parse(el.textContent).triangleCount === tris; } catch { return false; }
      },
      saved.texturedTris,
      { timeout: 20_000 },
    );
    await expect(page.getByRole('button', { name: /Re-apply/ })).toBeHidden();
  });

  test('a persisted texture round-trips session export and import', async ({ page }) => {
    await page.goto('/editor');
    await waitForEngine(page);

    const out = await page.evaluate(async () => {
      const pw = (window as unknown as { partwright: PW & {
        runAndSave: (c: string, l?: string) => Promise<{ geometry: { triangleCount?: number }; version: { id: string } | null }>;
        exportSessionData: () => Promise<{ data: string }>;
        importSessionData: (d: string) => Promise<{ sessionId?: string; error?: string }>;
      } }).partwright;
      await pw.createSession('surface-export-roundtrip');
      const r = await pw.runAndSave([
        'const { Manifold } = api;',
        'api.surface.fuzzy({ amplitude: 0.5 });',
        'return Manifold.sphere(10, 32);',
      ].join('\n'), 'textured');

      // Export: the texture is embedded with base64-encoded buffers (1.14).
      const exported = await pw.exportSessionData();
      const payload = (typeof exported.data === 'string' ? JSON.parse(exported.data) : exported.data) as {
        versions?: { surfaceTexture?: { key?: unknown; vertProperties?: unknown; triVerts?: unknown } }[];
      };
      const exportedTex = payload.versions?.[0]?.surfaceTexture;

      // Import the JSON back: the texture must land on the new session's
      // version as live typed arrays again.
      const imported = await pw.importSessionData(exported.data);
      const db = await import('/src/storage/db.ts');
      const reVersion = imported.sessionId
        ? await db.getSessionLatestVersion(imported.sessionId) as {
            surfaceTexture?: { key?: string; mesh?: { numTri?: number; vertProperties?: unknown } };
          } | null
        : null;
      return {
        texturedTris: r.geometry.triangleCount ?? 0,
        exportedKeyIsString: typeof exportedTex?.key === 'string',
        exportedVertsAreBase64: typeof exportedTex?.vertProperties === 'string',
        exportedTrisAreBase64: typeof exportedTex?.triVerts === 'string',
        importError: imported.error ?? null,
        reimportedTris: reVersion?.surfaceTexture?.mesh?.numTri ?? 0,
        reimportedIsTyped: reVersion?.surfaceTexture?.mesh?.vertProperties instanceof Float32Array,
      };
    });

    expect(out.importError).toBeNull();
    expect(out.texturedTris).toBeGreaterThan(0);
    expect(out.exportedKeyIsString).toBe(true);
    expect(out.exportedVertsAreBase64).toBe(true);
    expect(out.exportedTrisAreBase64).toBe(true);
    expect(out.reimportedTris).toBe(out.texturedTris);
    expect(out.reimportedIsTyped).toBe(true);
  });

  test('rejects unknown surface options with an actionable error', async ({ page }) => {
    await page.goto('/editor');
    await waitForEngine(page);

    const err = await page.evaluate(async () => {
      const pw = (window as unknown as { partwright: PW }).partwright;
      await pw.createSession('surface-in-code-errors');
      const r = await pw.run([
        'const { Manifold } = api;',
        'api.surface.knit({ stitchWidth: 1, nope: 2 });',
        'return Manifold.cube([10, 10, 10]);',
      ].join('\n')) as { error?: string | null };
      return r?.error ?? '';
    });
    expect(err).toContain('nope');
  });
});
