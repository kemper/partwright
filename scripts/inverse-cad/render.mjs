// Turn a triangle-soup STL mesh into the (positions, triVerts, triColors, bbox)
// tuple the model-preview rasterizer consumes, and provide a comparison
// composer that stacks two 4-view grids (target above, candidate below).

import sharp from 'sharp';
import { weldVertices } from './mesh.mjs';
import { meshBBox } from './stl.mjs';
import { composePng } from '../cli/preview.mjs';

// Convert a triangle-soup mesh (float32[9N]) into the indexed form the
// composePng rasterizer expects. `color` is [r,g,b] 0..255 applied to every
// triangle.
export function meshToRenderInputs(mesh, color = [200, 200, 210]) {
  const welded = weldVertices(mesh);
  const positions = new Float32Array(welded.vertices);
  const triVerts = new Uint32Array(welded.triangles); // 3 verts per tri
  const triCount = triVerts.length / 3;
  const triColors = new Uint8Array(triCount * 3);
  for (let i = 0; i < triCount; i++) {
    triColors[i * 3] = color[0];
    triColors[i * 3 + 1] = color[1];
    triColors[i * 3 + 2] = color[2];
  }
  const bbox = meshBBox(mesh);
  return { positions, triVerts, triColors, bbox };
}

// Render a mesh to a 4-view (or custom-views) grid PNG buffer.
export async function renderMeshGrid(mesh, opts = {}) {
  const size = opts.size ?? 384;
  const views = opts.views;
  const color = opts.color ?? [200, 200, 210];
  const inputs = meshToRenderInputs(mesh, color);
  return composePng(inputs.positions, inputs.triVerts, inputs.triColors, inputs.bbox, size, views).toBuffer();
}

// Combined bbox around both meshes so the two grids share the same camera
// framing. Otherwise a tighter candidate zooms in past the target.
function unionBBox(a, b) {
  const min = [
    Math.min(a.min[0], b.min[0]),
    Math.min(a.min[1], b.min[1]),
    Math.min(a.min[2], b.min[2]),
  ];
  const max = [
    Math.max(a.max[0], b.max[0]),
    Math.max(a.max[1], b.max[1]),
    Math.max(a.max[2], b.max[2]),
  ];
  return { min, max, size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]], center: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2] };
}

// Compose a side-by-side comparison PNG. Both grids share the same bbox
// framing so the two rows are directly comparable. Target is rendered from
// the parsed STL (triangle soup); candidate comes from a preview `render`
// (positions/triVerts/triColors/bbox already in the correct shape).
export async function composeComparison({ target, candidate, size = 384, views, label }) {
  const shared = unionBBox(target.bbox, candidate.bbox);
  const [tBuf, cBuf] = await Promise.all([
    composePng(target.positions, target.triVerts, target.triColors, shared, size, views).png().toBuffer(),
    composePng(candidate.positions, candidate.triVerts, candidate.triColors, shared, size, views).png().toBuffer(),
  ]);
  const meta = await sharp(tBuf).metadata();
  const width = meta.width, height = meta.height;
  const gap = 6;
  const overlays = [
    { input: tBuf, top: 0, left: 0 },
    { input: cBuf, top: height + gap, left: 0 },
  ];
  if (label) {
    const svg = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height * 2 + gap}">` +
      `<rect x="0" y="0" width="260" height="26" fill="rgba(255,255,255,0.9)"/>` +
      `<rect x="0" y="${height + gap}" width="260" height="26" fill="rgba(255,255,255,0.9)"/>` +
      `<text x="8" y="19" font-family="sans-serif" font-size="16" fill="#111">${label.top ?? 'target'}</text>` +
      `<text x="8" y="${height + gap + 19}" font-family="sans-serif" font-size="16" fill="#111">${label.bottom ?? 'candidate'}</text>` +
      `</svg>`
    );
    overlays.push({ input: svg, top: 0, left: 0 });
  }
  return sharp({
    create: { width, height: height * 2 + gap, channels: 3, background: { r: 220, g: 220, b: 220 } },
  }).composite(overlays).png();
}
