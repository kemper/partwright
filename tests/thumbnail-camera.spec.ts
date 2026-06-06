// Golden path for the per-session thumbnail-camera pin
// (partwright.setThumbnailCamera / getThumbnailCamera). Pinning an angle should
// (a) persist on the session, (b) be readable back, and (c) actually change the
// captured thumbnail so a catalog tile can show a chosen 3/4 angle instead of
// the default iso view — the fix for "authors bake orientation into geometry".
// Also covers the richer runAndSave/saveVersion stats added alongside it: the
// per-region paint summary (`colorRegions`) and the voxel `voxelCount`.

import { test, expect, type Page } from 'playwright/test';

async function waitForEngine(page: Page) {
  await page.waitForFunction(
    () => !!(window as unknown as { partwright?: { runAndSave?: unknown } }).partwright?.runAndSave,
    { timeout: 30_000 },
  );
}

test.describe('thumbnail camera pin', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('partwright-tour-completed', '1'));
  });

  test('pins the camera, persists it, and changes the captured thumbnail', async ({ page }) => {
    await page.goto('/editor');
    await waitForEngine(page);

    const out = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;

      // Asymmetric, labelled model so front vs back differ visibly and we can
      // paint a region byLabel.
      const code = `
        const { Manifold } = api;
        const body = api.label(Manifold.cube([20,20,20], true), 'body');
        const nose = api.label(Manifold.cube([6,6,6], true).translate([0,-12,0]), 'nose');
        return body.add(nose);
      `;

      await pw.createSession('thumb-camera-spec');
      await pw.runAndSave(code, 'default-iso', {});
      const e0 = await pw.exportSession(undefined, { includeThumbnails: true });
      const t0 = e0.versions[e0.versions.length - 1].thumbnail as string;

      // Pin, read back, re-save → tile should differ.
      const setRes = await pw.setThumbnailCamera({ azimuth: 225, elevation: 25 });
      const got = pw.getThumbnailCamera();
      await new Promise((r) => setTimeout(r, 300));
      await pw.saveVersion('pinned');
      const e1 = await pw.exportSession(undefined, { includeThumbnails: true });
      const t1 = e1.versions[e1.versions.length - 1].thumbnail as string;

      // The pin round-trips through the exported session (schema 1.11).
      const exportedCamera = e1.session.thumbCamera;

      // Clearing returns to the default.
      await pw.setThumbnailCamera(null);
      const cleared = pw.getThumbnailCamera();

      // Per-region paint summary on saveVersion.
      await pw.paintByLabels([{ label: 'nose', color: [0.88, 0.33, 0.23] }]);
      await new Promise((r) => setTimeout(r, 300));
      const painted = await pw.saveVersion('painted');

      // voxelCount in geometry stats for a voxel run.
      await pw.setActiveLanguage('voxel');
      const rv = await pw.runAndSave(
        'const v = api.voxels(); v.fillBox([0,0,0],[9,9,9], "#6cf"); return v;',
        'voxels', {},
      );

      return {
        setRes, got, exportedCamera, cleared,
        thumbsDiffer: !!t0 && !!t1 && t0 !== t1,
        paintedRegions: painted?.colorRegions ?? null,
        voxelCount: rv?.geometry?.voxelCount ?? null,
      };
    });

    expect(out.setRes).toEqual({ thumbCamera: { azimuth: 225, elevation: 25 } });
    expect(out.got).toEqual({ azimuth: 225, elevation: 25 });
    expect(out.exportedCamera).toEqual({ azimuth: 225, elevation: 25 });
    expect(out.cleared).toBeNull();
    expect(out.thumbsDiffer).toBe(true);
    expect(out.paintedRegions).toEqual([
      { name: 'nose', kind: 'byLabel', label: 'nose', triangleCount: 10 },
    ]);
    expect(out.voxelCount).toBe(1000);
  });

  test('"current" captures the live viewport angle (default framing ≈ iso)', async ({ page }) => {
    await page.goto('/editor');
    await waitForEngine(page);

    const out = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      await pw.createSession('current-capture-spec');
      await pw.runAndSave('return api.Manifold.cube([20,20,20], true);', 'box', {});
      // Freshly-run framing is the iso 3/4 view; capturing it should resolve to
      // the iso default (azimuth 135, elevation ~35) after the convention
      // conversion from the viewport's mirrored azimuth.
      const res = await pw.setThumbnailCamera('current');
      const got = pw.getThumbnailCamera();
      return { res, got };
    });

    expect(out.got).not.toBeNull();
    expect(Math.abs(out.got.azimuth - 135)).toBeLessThan(1);
    expect(Math.abs(out.got.elevation - 35.26)).toBeLessThan(1);
  });
});
