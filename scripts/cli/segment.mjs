// `partwright segment` — headless part detection on an STL (#1025).
// Boots Vite SSR (no browser), runs a registered detector on the mesh, and
// writes a colour-coded multi-view PNG + the draft summary/quality JSON. The
// same SegmentationRunner the app's Worker uses, so results match the panel.
import { readFileSync } from 'node:fs';
import { createServer } from 'vite';

/** Boot Vite SSR and load the headless segmentation entry. Caller closes. */
export async function loadSegmentModule() {
  const server = await createServer({ configFile: false, server: { middlewareMode: true, watch: null }, appType: 'custom', logLevel: 'silent', optimizeDeps: { noDiscovery: true } });
  const mod = await server.ssrLoadModule('/src/tools/segmentMesh.ts');
  return { mod, close: () => server.close() };
}

/** Run a detector on an STL file. `seedsFile` is a JSON array of
 *  { label, point: [x,y,z] }. Returns the segmentMesh output. */
export async function runSegment(file, { algorithm, params = {}, seedsFile, smoothRadius }) {
  const { mod, close } = await loadSegmentModule();
  try {
    const mesh = mod.stlToSegMesh(new Uint8Array(readFileSync(file)));
    const seeds = seedsFile ? JSON.parse(readFileSync(seedsFile, 'utf8')) : undefined;
    const featureOptions = smoothRadius !== undefined ? { normalSmoothRadius: Number(smoothRadius) } : undefined;
    return mod.segmentMesh(mesh, { algorithm, params, seeds, featureOptions });
  } finally {
    await close();
  }
}
