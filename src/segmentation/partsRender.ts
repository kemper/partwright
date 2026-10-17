// Numbered part renders ("set-of-marks"): the model drawn with each part in
// its overlay colour and the part's 1-based id printed on a VISIBLE spot of
// that part in every view — so a user or a vision model can say "part 4 is
// actually his arm". Browser-only (offscreen WebGL via multiview).
//
// Visibility is decided with a coarse software depth buffer over triangle
// centroids (O(triangles) per view) instead of per-label raycasts, which are
// far too slow on 400k+ triangle scans. Parts with no visible triangles in a
// view get no number there; `visibleIn` reports where each part showed up,
// so a part hidden from every view (an inner arm behind a ball) is flagged.

import * as THREE from 'three';
import { getConfig } from '../config/appConfig';
import type { MeshData } from '../geometry/types';
import { buildViewCamera, renderSingleViewCanvas } from '../renderer/multiview';

export interface PartsRenderView { label: string; elevation: number; azimuth: number }

export const PARTS_RENDER_VIEWS: Record<string, PartsRenderView> = {
  front: { label: 'Front', elevation: 5, azimuth: 0 },
  back: { label: 'Back', elevation: 5, azimuth: 180 },
  left: { label: 'Left', elevation: 5, azimuth: 270 },
  right: { label: 'Right', elevation: 5, azimuth: 90 },
  top: { label: 'Top', elevation: 89, azimuth: 0 },
  bottom: { label: 'Bottom', elevation: -60, azimuth: 30 },
  iso: { label: 'Iso', elevation: 30, azimuth: 315 },
  backIso: { label: 'Back iso', elevation: 30, azimuth: 135 },
};
export const DEFAULT_PARTS_VIEWS = ['front', 'right', 'back', 'iso'];

export interface PartLegendEntry { id: number; name: string; color: string }


export function renderNumberedParts(
  mesh: MeshData,
  triColors: Uint8Array,
  /** Part index per displayed triangle (−1 = none). */
  triPartDisplayed: Int32Array,
  legend: PartLegendEntry[],
  opts: { views: string[]; size: number; numbered: boolean },
): { dataUrl: string; visibleIn: Record<number, string[]> } {
  const tile = opts.size;
  const views = opts.views.map((v) => PARTS_RENDER_VIEWS[v]);
  const cols = views.length <= 2 ? views.length : 2;
  const rows = Math.ceil(views.length / cols);
  const legendW = 190;
  const out = document.createElement('canvas');
  out.width = cols * tile + legendW;
  out.height = Math.max(rows * tile, 28 + legend.length * 18);
  const ctx = out.getContext('2d')!;
  ctx.fillStyle = '#1e1e1e';
  ctx.fillRect(0, 0, out.width, out.height);
  const visibleIn: Record<number, string[]> = {};

  const colored: MeshData = { ...mesh, triColors };
  const centroids = triangleCentroids(mesh);
  views.forEach((v, i) => {
    const canvas = renderSingleViewCanvas(colored, { elevation: v.elevation, azimuth: v.azimuth, size: tile, edges: 'none' });
    const x0 = (i % cols) * tile, y0 = Math.floor(i / cols) * tile;
    ctx.drawImage(canvas, x0, y0);
    ctx.fillStyle = '#ddd';
    ctx.font = '13px sans-serif';
    ctx.fillText(v.label, x0 + 8, y0 + 18);
    const camera = buildViewCamera(mesh, { elevation: v.elevation, azimuth: v.azimuth });
    const anchors = visibleAnchors(centroids, triPartDisplayed, legend.length, camera);
    anchors.forEach((a, partIdx) => {
      if (!a) return;
      (visibleIn[partIdx + 1] ??= []).push(v.label);
      if (opts.numbered) drawTag(ctx, x0 + a[0] * tile, y0 + a[1] * tile, String(partIdx + 1), legend[partIdx].color);
    });
  });

  // Legend column.
  const lx = cols * tile + 10;
  ctx.font = '12px sans-serif';
  ctx.fillStyle = '#ddd';
  ctx.fillText('Parts', lx, 18);
  legend.forEach((p, i) => {
    const y = 36 + i * 18;
    ctx.fillStyle = p.color;
    ctx.fillRect(lx, y - 10, 12, 12);
    ctx.fillStyle = visibleIn[p.id] ? '#eee' : '#888';
    ctx.fillText(`${p.id}  ${p.name}${visibleIn[p.id] ? '' : ' (hidden)'}`.slice(0, 26), lx + 18, y);
  });
  return { dataUrl: out.toDataURL('image/png'), visibleIn };
}

function triangleCentroids(mesh: MeshData): Float32Array {
  const { vertProperties: vp, triVerts: tv, numProp, numTri } = mesh;
  const c = new Float32Array(numTri * 3);
  for (let t = 0; t < numTri; t++) {
    for (let k = 0; k < 3; k++) {
      const v = tv[t * 3 + k] * numProp;
      c[t * 3] += vp[v] / 3; c[t * 3 + 1] += vp[v + 1] / 3; c[t * 3 + 2] += vp[v + 2] / 3;
    }
  }
  return c;
}

/** Per part: a normalized [x, y] (0..1, y down) screen point on a visible
 *  triangle of that part — the visible triangle nearest the part's visible
 *  screen-space centroid — or null when nothing of it is visible. */
function visibleAnchors(
  centroids: Float32Array,
  triPart: Int32Array,
  partCount: number,
  camera: THREE.Camera,
): ([number, number] | null)[] {
  const VIS_GRID = getConfig().segmentation.labelGridResolution;
  camera.updateMatrixWorld();
  const m = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).elements;
  const n = triPart.length;
  const sx = new Float32Array(n), sy = new Float32Array(n);
  const depth = new Float32Array(VIS_GRID * VIS_GRID).fill(Infinity);
  const owner = new Int32Array(VIS_GRID * VIS_GRID).fill(-1);
  for (let t = 0; t < n; t++) {
    const x = centroids[t * 3], y = centroids[t * 3 + 1], z = centroids[t * 3 + 2];
    const w = m[3] * x + m[7] * y + m[11] * z + m[15];
    const nx = (m[0] * x + m[4] * y + m[8] * z + m[12]) / w;
    const ny = (m[1] * x + m[5] * y + m[9] * z + m[13]) / w;
    const nz = (m[2] * x + m[6] * y + m[10] * z + m[14]) / w;
    const px = (nx + 1) / 2, py = (1 - ny) / 2;
    sx[t] = px; sy[t] = py;
    if (px < 0 || px >= 1 || py < 0 || py >= 1) continue;
    const cell = Math.floor(py * VIS_GRID) * VIS_GRID + Math.floor(px * VIS_GRID);
    if (nz < depth[cell]) { depth[cell] = nz; owner[cell] = t; }
  }
  // Visible screen centroid per part (count of winning cells as weight).
  const ax = new Float64Array(partCount), ay = new Float64Array(partCount), cnt = new Int32Array(partCount);
  for (const t of owner) {
    if (t < 0) continue;
    const p = triPart[t];
    if (p < 0) continue;
    ax[p] += sx[t]; ay[p] += sy[t]; cnt[p]++;
  }
  const best: ([number, number] | null)[] = new Array(partCount).fill(null);
  const bestD = new Float64Array(partCount).fill(Infinity);
  for (const t of owner) {
    if (t < 0) continue;
    const p = triPart[t];
    if (p < 0 || cnt[p] < 3) continue; // ignore 1–2 stray cells
    const d = (sx[t] - ax[p] / cnt[p]) ** 2 + (sy[t] - ay[p] / cnt[p]) ** 2;
    if (d < bestD[p]) { bestD[p] = d; best[p] = [sx[t], sy[t]]; }
  }
  return best;
}

function drawTag(ctx: CanvasRenderingContext2D, x: number, y: number, text: string, color: string): void {
  ctx.font = 'bold 13px sans-serif';
  const w = Math.max(18, ctx.measureText(text).width + 8);
  ctx.fillStyle = 'rgba(0,0,0,0.75)';
  ctx.beginPath();
  ctx.roundRect(x - w / 2, y - 9, w, 18, 9);
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y + 0.5);
  ctx.textAlign = 'start';
  ctx.textBaseline = 'alphabetic';
}
