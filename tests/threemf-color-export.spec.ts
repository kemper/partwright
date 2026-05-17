// 3MF color export regression tests.
//
// History:
//   - User reported: exported 3MF imported into Bambu Studio with "many
//     more colors than I actually painted." Suspected over-counting in the
//     m:colorgroup.
//   - First fix attempt removed the default color from the colorgroup so
//     only painted colors remained. That broke Bambu's import-color dialog
//     entirely — Bambu's "Standard 3MF Import Color" trigger requires the
//     object to carry pid/pindex pointing at a valid colorgroup entry, and
//     unpainted triangles must have an explicit pid too. Reverted.
//   - These tests lock down the current behavior and double as a record of
//     what the format looks like, so the next iteration can refer to them.

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

async function exportPainted(page: import('playwright/test').Page, recipe: string) {
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

function inspectModelXml(base64: string) {
  const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
  const entries = readZip(bytes);
  const modelEntry = entries.find(e => e.name === '3D/3dmodel.model');
  if (!modelEntry) throw new Error('missing 3D/3dmodel.model entry');
  const xml = new TextDecoder().decode(modelEntry.data);
  const colorMatches = xml.match(/<m:color\s+color="([^"]+)"/g) ?? [];
  return { xml, colorMatches };
}

// Bambu Studio's import dialog requires the colorgroup to be referenced
// from the <object>. Verify we still emit that pid/pindex when colors exist.
test('object carries pid/pindex pointing at colorgroup when colors are present', async ({ page }) => {
  const result = await exportPainted(page, `
    await pw.run('return api.Manifold.cube([20, 20, 20]);');
    const top = pw.paintInBox({ box: { min: [-1, -1, 19], max: [21, 21, 21] }, color: [1, 0, 0] });
    if (top.error) return top;
  `);

  expect(result.error, JSON.stringify(result)).toBeUndefined();
  const { xml } = inspectModelXml(result.base64!);
  expect(xml).toMatch(/<object\s+id="1"\s+type="model"\s+pid="2"\s+pindex="0"/);
  expect(xml).toMatch(/<m:colorgroup\s+id="2">/);
});

// No paint regions → no colorgroup at all (and no pid on object).
test('plain mesh has no colorgroup and no pid on the object', async ({ page }) => {
  const result = await exportPainted(page, `
    await pw.run('return api.Manifold.cube([20, 20, 20]);');
  `);

  expect(result.error, JSON.stringify(result)).toBeUndefined();
  const { xml, colorMatches } = inspectModelXml(result.base64!);
  expect(colorMatches.length).toBe(0);
  expect(xml).toMatch(/<object\s+id="1"\s+type="model">/);
  expect(xml).not.toMatch(/pid=/);
});

// Same color painted across N regions → dedup to 1 painted entry in the
// colorgroup (plus the default at index 0).
test('same color across three regions dedupes to one painted entry', async ({ page }) => {
  const result = await exportPainted(page, `
    await pw.run('return api.Manifold.cube([20, 20, 20]);');
    const a = pw.paintInBox({ box: { min: [-1, -1, 19], max: [21, 21, 21] }, color: [1, 0, 0] });
    if (a.error) return a;
    const b = pw.paintInBox({ box: { min: [-1, -1, -1], max: [21, 21, 1] }, color: [1, 0, 0] });
    if (b.error) return b;
    const c = pw.paintInBox({ box: { min: [-1, -1, -1], max: [1, 21, 21] }, color: [1, 0, 0] });
    if (c.error) return c;
  `);

  expect(result.error, JSON.stringify(result)).toBeUndefined();
  const { xml, colorMatches } = inspectModelXml(result.base64!);
  // 1 default + 1 unique painted color = 2 entries.
  expect(colorMatches.length, `expected 2 colors (default + 1 painted), got ${colorMatches.length}\n${xml.slice(0, 1200)}`).toBe(2);
});

// Two distinct painted colors → 3 entries (default + 2 painted). Order:
// default first, painted in iteration order.
test('two distinct painted colors produce default + 2 entries', async ({ page }) => {
  const result = await exportPainted(page, `
    await pw.run('return api.Manifold.cube([20, 20, 20]);');
    const top = pw.paintInBox({ box: { min: [-1, -1, 19], max: [21, 21, 21] }, color: [1, 0, 0] });
    if (top.error) return top;
    const bottom = pw.paintInBox({ box: { min: [-1, -1, -1], max: [21, 21, 1] }, color: [0, 0, 1] });
    if (bottom.error) return bottom;
  `);

  expect(result.error, JSON.stringify(result)).toBeUndefined();
  const { xml, colorMatches } = inspectModelXml(result.base64!);
  expect(colorMatches.length, `expected 3 colors, got ${colorMatches.length}\n${xml.slice(0, 2000)}`).toBe(3);
  // Default is always the first entry.
  expect(colorMatches[0]).toContain('#4A9EFF');
});

// Every triangle must have an explicit pid/p1 when colors are present —
// otherwise Bambu loses the color assignment for unpainted faces.
test('every triangle has pid/p1 when colors are present', async ({ page }) => {
  const result = await exportPainted(page, `
    await pw.run('return api.Manifold.cube([20, 20, 20]);');
    const top = pw.paintInBox({ box: { min: [-1, -1, 19], max: [21, 21, 21] }, color: [1, 0, 0] });
    if (top.error) return top;
  `);

  expect(result.error, JSON.stringify(result)).toBeUndefined();
  const { xml } = inspectModelXml(result.base64!);
  const allTris = xml.match(/<triangle\b[^/]*\/>/g) ?? [];
  const taggedTris = allTris.filter(t => t.includes('pid="') && t.includes('p1="'));
  expect(taggedTris.length, `expected every triangle tagged; got ${taggedTris.length} of ${allTris.length}\n${xml.slice(0, 1500)}`).toBe(allTris.length);
});
