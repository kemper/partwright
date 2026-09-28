// Golden path for the per-session thumbnail-camera pin
// (partwright.setThumbnailCamera / getThumbnailCamera). Pinning an angle should
// (a) persist on the session, (b) be readable back, and (c) actually change the
// captured thumbnail so a catalog tile can show a chosen 3/4 angle instead of
// the default iso view — the fix for "authors bake orientation into geometry".
// Also covers the richer runAndSave/saveVersion stats added alongside it: the
// per-region paint summary (`colorRegions`) and the voxel `voxelCount`.

import { test, expect, type Page } from 'playwright/test';
import { openSharedEditor } from './helpers/sharedPage';

// Both tests create their own fresh session via createSession() and clear
// paint before running (createSession() keeps live paint regions and the
// engine language — the second test resets the language since the first
// ends on a voxel run), so the file
// shares one booted editor instead of paying a fresh page + WASM boot per test.
let page: Page;
test.beforeAll(async ({ browser }, testInfo) => {
  page = await openSharedEditor(browser, testInfo);
});
test.afterAll(async () => {
  await page?.context().close();
});

test.describe('thumbnail camera pin', () => {
  test('pins the camera, persists it, and changes the captured thumbnail', async () => {
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
      pw.clearColors();
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

  test('"current" captures the live viewport angle (default framing ≈ iso)', async () => {
    const out = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      // The previous test ends on a voxel-language run (for its voxelCount
      // check) and createSession() tags the new session with whatever engine
      // is currently active rather than resetting it — switch back explicitly
      // so this test's manifold-js code actually runs on the manifold-js engine.
      await pw.setActiveLanguage('manifold-js');
      await pw.createSession('current-capture-spec');
      pw.clearColors();
      await pw.runAndSave('return api.Manifold.cube([20,20,20], true);', 'box', {});
      // Freshly-run framing is the iso 3/4 view from the +X/−Y corner; capturing
      // it maps straight through to the iso default (azimuth 45, elevation ~35)
      // now that the viewport and thumbnail cameras share the −Y convention.
      const res = await pw.setThumbnailCamera('current');
      const got = pw.getThumbnailCamera();
      return { res, got };
    });

    expect(out.got).not.toBeNull();
    expect(Math.abs(out.got.azimuth - 45)).toBeLessThan(1);
    expect(Math.abs(out.got.elevation - 35.26)).toBeLessThan(1);
  });
});
