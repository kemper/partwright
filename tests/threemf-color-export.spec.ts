// Verify that exporting a model with N painted regions produces exactly N
// colors in the 3MF m:colorgroup — no extra "default" filament slot.
//
// Regression test for: "exported 3MF imported into Bambu Studio with many
// more colors than I actually painted." Bambu Studio (and similar slicers)
// create one filament per <m:color> entry. Including a default color the
// user never painted with would surface as an unwanted extra filament.

import { test, expect } from 'playwright/test';

interface ZipEntry {
  name: string;
  data: Uint8Array;
}

// Minimal STORE-method ZIP reader. Our 3MF builder uses no compression, so
// this is enough — we never compile DEFLATE here.
function readZip(bytes: Uint8Array): ZipEntry[] {
  const entries: ZipEntry[] = [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let off = 0;
  while (off + 30 < bytes.length) {
    const sig = view.getUint32(off, true);
    if (sig !== 0x04034b50) break; // end of local file headers
    const compression = view.getUint16(off + 8, true);
    const compressedSize = view.getUint32(off + 18, true);
    const nameLen = view.getUint16(off + 26, true);
    const extraLen = view.getUint16(off + 28, true);
    const nameStart = off + 30;
    const dataStart = nameStart + nameLen + extraLen;
    const name = new TextDecoder().decode(bytes.subarray(nameStart, nameStart + nameLen));
    if (compression !== 0) throw new Error(`unsupported compression ${compression}`);
    const data = bytes.subarray(dataStart, dataStart + compressedSize);
    entries.push({ name, data });
    off = dataStart + compressedSize;
  }
  return entries;
}

async function exportPaintedCube(page: import('playwright/test').Page, recipe: string) {
  await page.goto('/editor');
  await page.waitForSelector('text=Ready', { timeout: 15000 });
  return page.evaluate(async (script) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pw = (window as any).partwright;
    const fn = new Function('pw', 'api', `return (async () => { ${script} })();`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = await fn(pw, (pw as any));
    if (out && out.error) return out;
    const exported = await pw.export3MFData();
    if (exported.error) return { stage: 'export', error: exported.error };
    return { stage: 'done', base64: exported.base64 };
  }, recipe);
}

function inspectColorgroup(base64: string) {
  const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
  const entries = readZip(bytes);
  const modelEntry = entries.find(e => e.name === '3D/3dmodel.model');
  if (!modelEntry) throw new Error('missing 3D/3dmodel.model entry');
  const xml = new TextDecoder().decode(modelEntry.data);
  const colorMatches = xml.match(/<m:color\s+color="([^"]+)"/g) ?? [];
  return { xml, colorMatches };
}

test('two distinct painted colors → exactly 2 colorgroup entries', async ({ page }) => {
  const result = await exportPaintedCube(page, `
    await pw.run('return api.Manifold.cube([20, 20, 20]);');
    const top = pw.paintInBox({ box: { min: [-1, -1, 19], max: [21, 21, 21] }, color: [1, 0, 0] });
    if (top.error) return top;
    const bottom = pw.paintInBox({ box: { min: [-1, -1, -1], max: [21, 21, 1] }, color: [0, 0, 1] });
    if (bottom.error) return bottom;
  `);

  expect(result.error, JSON.stringify(result)).toBeUndefined();
  const { xml, colorMatches } = inspectColorgroup(result.base64!);
  expect(colorMatches.length, `expected 2 colors, got ${colorMatches.length}\n${xml.slice(0, 2000)}`).toBe(2);

  // Both painted colors are present, in any order.
  const hexes = colorMatches.map(m => m.match(/"([^"]+)"/)![1].toUpperCase()).sort();
  expect(hexes).toEqual(['#0000FFFF', '#FF0000FF']);
});

// Repeat the same color across multiple regions and verify dedup.
test('three regions sharing one color → exactly 1 colorgroup entry', async ({ page }) => {
  const result = await exportPaintedCube(page, `
    await pw.run('return api.Manifold.cube([20, 20, 20]);');
    const a = pw.paintInBox({ box: { min: [-1, -1, 19], max: [21, 21, 21] }, color: [1, 0, 0] });
    if (a.error) return a;
    const b = pw.paintInBox({ box: { min: [-1, -1, -1], max: [21, 21, 1] }, color: [1, 0, 0] });
    if (b.error) return b;
    const c = pw.paintInBox({ box: { min: [-1, -1, -1], max: [1, 21, 21] }, color: [1, 0, 0] });
    if (c.error) return c;
  `);

  expect(result.error, JSON.stringify(result)).toBeUndefined();
  const { xml, colorMatches } = inspectColorgroup(result.base64!);
  expect(colorMatches.length, `expected 1 color, got ${colorMatches.length}\n${xml.slice(0, 800)}`).toBe(1);
});

test('hi-poly sphere with one painted region → exactly 1 colorgroup entry', async ({ page }) => {
  // A sphere triangulates into many small faces. Painting one cap region
  // should still produce a single colorgroup entry.
  const result = await exportPaintedCube(page, `
    await pw.run('return api.Manifold.sphere(15, 64);');
    const r = pw.paintInBox({ box: { min: [-16, -16, 5], max: [16, 16, 16] }, color: [0.92, 0.26, 0.21] });
    if (r.error) return r;
  `);

  expect(result.error, JSON.stringify(result)).toBeUndefined();
  const { xml, colorMatches } = inspectColorgroup(result.base64!);
  expect(colorMatches.length, `expected 1 color, got ${colorMatches.length}\nfirst 1500 chars:\n${xml.slice(0, 1500)}`).toBe(1);
});

test('every entry in colorgroup is referenced by some triangle', async ({ page }) => {
  const result = await exportPaintedCube(page, `
    await pw.run('return api.Manifold.cube([20, 20, 20]);');
    const top = pw.paintInBox({ box: { min: [-1, -1, 19], max: [21, 21, 21] }, color: [1, 0, 0] });
    if (top.error) return top;
    const bottom = pw.paintInBox({ box: { min: [-1, -1, -1], max: [21, 21, 1] }, color: [0, 0, 1] });
    if (bottom.error) return bottom;
  `);

  expect(result.error, JSON.stringify(result)).toBeUndefined();
  const { xml, colorMatches } = inspectColorgroup(result.base64!);

  // Collect every p1 value referenced by triangles in the model.
  const used = new Set<string>();
  for (const m of xml.matchAll(/p1="(\d+)"/g)) used.add(m[1]);

  // Now check: is every index in the colorgroup actually used?
  const unused: number[] = [];
  for (let i = 0; i < colorMatches.length; i++) {
    if (!used.has(String(i))) unused.push(i);
  }

  expect(unused, `colorgroup entries ${unused.join(',')} are NEVER referenced by any triangle, yet still appear in the file:\n${xml.slice(0, 1500)}`).toEqual([]);
});

// Unpainted regions must NOT carry pid="2" attributes — that would put the
// triangle in the colorgroup and effectively assign it a filament slot.
test('unpainted triangles have no pid/p1 attributes', async ({ page }) => {
  const result = await exportPaintedCube(page, `
    await pw.run('return api.Manifold.cube([20, 20, 20]);');
    const top = pw.paintInBox({ box: { min: [-1, -1, 19], max: [21, 21, 21] }, color: [1, 0, 0] });
    if (top.error) return top;
  `);

  expect(result.error, JSON.stringify(result)).toBeUndefined();
  const bytes = Uint8Array.from(atob(result.base64!), c => c.charCodeAt(0));
  const xml = new TextDecoder().decode(readZip(bytes).find(e => e.name === '3D/3dmodel.model')!.data);

  const allTris = xml.match(/<triangle\b[^/]*\/>/g) ?? [];
  const taggedTris = allTris.filter(t => t.includes('pid="'));
  const untaggedTris = allTris.filter(t => !t.includes('pid="'));

  // A 20×20×20 cube has 6 faces × 2 = 12 triangles. The top face is 2
  // painted; the remaining 10 should be untagged.
  expect(taggedTris.length, `expected 2 painted triangles, got ${taggedTris.length}\n${xml}`).toBe(2);
  expect(untaggedTris.length, `expected 10 untagged triangles, got ${untaggedTris.length}\n${xml}`).toBe(10);
});

test('cube with subtract + 1 painted region → exactly 1 colorgroup entry', async ({ page }) => {
  const result = await exportPaintedCube(page, `
    await pw.run(\`
      const a = api.Manifold.cube([20, 20, 20], true);
      const b = api.Manifold.cube([10, 10, 30], true);
      return a.subtract(b);
    \`);
    const p = pw.paintInBox({ box: { min: [-11, -11, 9], max: [11, 11, 11] }, color: [1, 0, 0] });
    if (p.error) return p;
  `);

  expect(result.error, JSON.stringify(result)).toBeUndefined();
  const { xml, colorMatches } = inspectColorgroup(result.base64!);
  expect(colorMatches.length, `expected 1 color, got ${colorMatches.length}\n${xml.slice(0, 1500)}`).toBe(1);
});
