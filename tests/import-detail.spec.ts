// Import-detail (mesh reduction) step:
//  - A heavy manifold STL (> 20k triangles) triggers the "Import detail" modal.
//  - The "Max triangles" control reduces the stored mesh toward a target count
//    (a sphere reduces smoothly, so intermediate counts are achievable).
//  - "Full detail" (the default) keeps every triangle — and confirms imports
//    are exempt from the global mesh-detail refine factor.

import { test, expect } from 'playwright/test';
import Module from 'manifold-3d';

// Build a watertight, correctly-oriented sphere STL straight from manifold-3d so
// the import forms a clean manifold and reduces predictably.
let stlBuf: Buffer;
let originalTris = 0;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function meshToBinarySTL(mesh: any): Buffer {
  const { vertProperties, triVerts, numProp, numTri } = mesh;
  const buf = new ArrayBuffer(84 + numTri * 50);
  const dv = new DataView(buf);
  dv.setUint32(80, numTri, true);
  let off = 84;
  for (let t = 0; t < numTri; t++) {
    off += 12; // normal left zero
    for (let k = 0; k < 3; k++) {
      const vi = triVerts[t * 3 + k];
      dv.setFloat32(off, vertProperties[vi * numProp], true); off += 4;
      dv.setFloat32(off, vertProperties[vi * numProp + 1], true); off += 4;
      dv.setFloat32(off, vertProperties[vi * numProp + 2], true); off += 4;
    }
    dv.setUint16(off, 0, true); off += 2;
  }
  return Buffer.from(new Uint8Array(buf));
}

test.beforeAll(async () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const m: any = await (Module as unknown as () => Promise<any>)();
  m.setup();
  const sph = m.Manifold.sphere(5, 256); // ~30k+ triangles, well over the 20k gate
  const mesh = sph.getMesh();
  originalTris = mesh.numTri;
  stlBuf = meshToBinarySTL(mesh);
  sph.delete();
});

async function importSphere(page: import('playwright/test').Page): Promise<void> {
  await page.goto('/editor?view=ai');
  await page.waitForFunction(
    () => !!(window as unknown as { partwright?: { run?: unknown } }).partwright?.run,
    { timeout: 20_000 },
  );
  await page.locator('#import-wrapper input[type="file"]').setInputFiles({
    name: 'sphere.stl',
    mimeType: 'application/octet-stream',
    buffer: stlBuf,
  });
  await expect(page.getByRole('heading', { name: 'Import detail' })).toBeVisible();
}

async function geometry(page: import('playwright/test').Page) {
  await page.waitForFunction(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => ((window as any).partwright?.getCode?.() ?? '').includes('Manifold.ofMesh(api.imports[0])'),
    undefined,
    { timeout: 15000 },
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return page.evaluate(() => (window as any).partwright.getGeometryData());
}

test.describe('Import detail reduction', () => {
  test('reduces an STL toward a target triangle count', async ({ page }) => {
    expect(originalTris).toBeGreaterThan(20_000); // sanity: the modal gate
    await importSphere(page);

    // Default state shows the full count.
    await expect(page.locator('#import-target-result')).toContainText('Full detail');

    // Ask for a precise target and confirm the live preview reports a reduction.
    await page.locator('#import-target-input').fill('6000');
    await page.locator('#import-target-input').dispatchEvent('change');
    await expect(page.locator('#import-target-result')).toContainText('of original');

    await page.getByRole('button', { name: 'Import', exact: true }).click();

    const geo = await geometry(page);
    expect(geo.triangleCount).toBeLessThan(originalTris / 2);
    expect(geo.triangleCount).toBeGreaterThan(1500); // landed near the 6k target
    expect(geo.volume).toBeGreaterThan(480); // sphere r=5 ⇒ ~523, preserved within tolerance
    expect(geo.volume).toBeLessThan(560);
  });

  test('Full detail keeps every triangle (imports are exempt from global refine)', async ({ page }) => {
    await importSphere(page);

    // Default selection is full detail — import without reducing.
    await page.getByRole('button', { name: 'Import', exact: true }).click();

    const geo = await geometry(page);
    expect(geo.triangleCount).toBe(originalTris);
  });
});
