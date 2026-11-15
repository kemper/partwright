// Per-triangle colours for the layered-print painted export, taken from the
// SOURCE PHOTO rather than the predicted layer-swap blend. A painted print
// puts a real filament on every region, so the target is the photo's colour —
// the predicted blend of translucent layers greys out hues that only exist
// through translucency (a dusty blue becomes grey once snapped). Also the
// side-band colouring for the "layer stripes" option. Pure; unit-tested.

import type { MeshData } from '../../geometry/types';
import type { LayeredPrintPlanRecord } from '../types';
import { hexToRgb01, layerBottom } from './optics';

/** RGBA pixels, row 0 = top of the image (ImageData layout). */
export interface PhotoPixels {
  width: number;
  height: number;
  data: Uint8ClampedArray | Uint8Array;
}

/** How far outside the plan's rounded width/depth (mm) a triangle may sit and
 *  still count as part of the print (the record rounds sizes to 0.1 mm). */
const FOOTPRINT_TOL_MM = 0.25;
/** Most photo pixels averaged per axis for one triangle (keeps big top
 *  triangles of a composed model cheap). */
const MAX_SAMPLES_PER_AXIS = 8;
/** |normal.z| below this = a side (wall/cliff); below −this = the underside. */
const SIDE_NZ = 0.5;

interface TriGeom { nz: number; cx: number; cy: number; minX: number; maxX: number; minY: number; maxY: number; maxZ: number; topX: number; topY: number }

function triGeom(mesh: MeshData, t: number): TriGeom {
  const vp = mesh.vertProperties, np = mesh.numProp, tv = mesh.triVerts;
  const a = tv[t * 3] * np, b = tv[t * 3 + 1] * np, c = tv[t * 3 + 2] * np;
  const e1x = vp[b] - vp[a], e1y = vp[b + 1] - vp[a + 1], e1z = vp[b + 2] - vp[a + 2];
  const e2x = vp[c] - vp[a], e2y = vp[c + 1] - vp[a + 1], e2z = vp[c + 2] - vp[a + 2];
  const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nzr = e1x * e2y - e1y * e2x;
  const nz = nzr / (Math.hypot(nx, ny, nzr) || 1);
  let top = a;
  if (vp[b + 2] > vp[top + 2]) top = b;
  if (vp[c + 2] > vp[top + 2]) top = c;
  return {
    nz,
    cx: (vp[a] + vp[b] + vp[c]) / 3,
    cy: (vp[a + 1] + vp[b + 1] + vp[c + 1]) / 3,
    minX: Math.min(vp[a], vp[b], vp[c]), maxX: Math.max(vp[a], vp[b], vp[c]),
    minY: Math.min(vp[a + 1], vp[b + 1], vp[c + 1]), maxY: Math.max(vp[a + 1], vp[b + 1], vp[c + 1]),
    maxZ: vp[top + 2], topX: vp[top], topY: vp[top + 1],
  };
}

function meshMinZ(mesh: MeshData): number {
  let minZ = Infinity;
  for (let v = 0; v < mesh.numVert; v++) minZ = Math.min(minZ, mesh.vertProperties[v * mesh.numProp + 2]);
  return minZ;
}

/** Average photo colour (alpha composited over white, like the solver) over
 *  a model-space XY box. The print is centred on the origin, image top = +Y. */
function samplePhoto(photo: PhotoPixels, w: number, d: number, x0: number, x1: number, y0: number, y1: number): [number, number, number] {
  const sw = photo.width, sh = photo.height, px = photo.data;
  const toU = (x: number) => Math.max(0, Math.min(sw - 1, Math.floor(((x + w / 2) / w) * sw)));
  const toV = (y: number) => Math.max(0, Math.min(sh - 1, Math.floor(((d / 2 - y) / d) * sh)));
  const u0 = toU(x0), u1 = toU(x1), v0 = toV(y1), v1 = toV(y0);
  const su = Math.max(1, Math.ceil((u1 - u0 + 1) / MAX_SAMPLES_PER_AXIS));
  const sv = Math.max(1, Math.ceil((v1 - v0 + 1) / MAX_SAMPLES_PER_AXIS));
  let r = 0, g = 0, b = 0, n = 0;
  for (let v = v0; v <= v1; v += sv) {
    for (let u = u0; u <= u1; u += su) {
      const o = (v * sw + u) * 4;
      const al = px[o + 3] / 255;
      r += px[o] * al + 255 * (1 - al);
      g += px[o + 1] * al + 255 * (1 - al);
      b += px[o + 2] * al + 255 * (1 - al);
      n++;
    }
  }
  return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
}

/**
 * Per-triangle RGB from the photo: every up-facing or side triangle of the
 * print takes the photo's colour where it sits (tops: averaged over the
 * triangle's footprint; sides: at their highest point, matching the
 * viewport's "a side reads as its region's colour"). The underside, and any
 * triangle outside the print — a frame, text above the surface, or the whole
 * print if the model moved it — keeps its `fallback` colour.
 */
export function photoTriColors(mesh: MeshData, plan: Pick<LayeredPrintPlanRecord, 'widthMm' | 'depthMm' | 'totalHeightMm' | 'layerHeight'>, photo: PhotoPixels, fallback: Uint8Array): { triColors: Uint8Array; fromPhoto: number } {
  const out = new Uint8Array(fallback.subarray(0, mesh.numTri * 3));
  if (photo.width < 1 || photo.height < 1 || mesh.numTri === 0) return { triColors: out, fromPhoto: 0 };
  const w = plan.widthMm, d = plan.depthMm;
  const hx = w / 2 + FOOTPRINT_TOL_MM, hy = d / 2 + FOOTPRINT_TOL_MM;
  const zTop = meshMinZ(mesh) + plan.totalHeightMm + plan.layerHeight / 2;
  let fromPhoto = 0;
  for (let t = 0; t < mesh.numTri; t++) {
    const g = triGeom(mesh, t);
    if (g.nz < -SIDE_NZ) continue; // underside: the base filament
    if (g.minX < -hx || g.maxX > hx || g.minY < -hy || g.maxY > hy || g.maxZ > zTop) continue;
    const c = g.nz < SIDE_NZ
      ? samplePhoto(photo, w, d, g.topX, g.topX, g.topY, g.topY)
      : samplePhoto(photo, w, d, g.minX, g.maxX, g.minY, g.maxY);
    out[t * 3] = c[0]; out[t * 3 + 1] = c[1]; out[t * 3 + 2] = c[2];
    fromPhoto++;
  }
  return { triColors: out, fromPhoto };
}

/** Z of each filament change, measured from the mesh's own bottom (the bed):
 *  the BOTTOM of the layer each block after the base starts on. */
export function planSwapPlanesZ(plan: Pick<LayeredPrintPlanRecord, 'blocks' | 'layerHeight' | 'firstLayerHeight'>, bedZ: number): number[] {
  const spec = { firstLayerHeight: plan.firstLayerHeight, layerHeight: plan.layerHeight };
  return plan.blocks.slice(1).map((b) => bedZ + layerBottom(b.startLayer, spec));
}

/** Is triangle `t` a side (wall or cliff) — what the layer stripes recolour. */
export function isSideTriangle(mesh: MeshData, t: number): boolean {
  const nz = triGeom(mesh, t).nz;
  return nz >= -SIDE_NZ && nz < SIDE_NZ;
}

/**
 * "Layer stripes": recolour the SIDE triangles of an already-split mesh (see
 * splitMeshAtZPlanes) with the filament loaded at their height, so each band
 * between swap heights shows the filament printed there. Other triangles keep
 * their colour. Bands above the print keep the top filament.
 */
export function stripeSideColors(mesh: MeshData, plan: Pick<LayeredPrintPlanRecord, 'blocks' | 'layerHeight' | 'firstLayerHeight'>, triColors: Uint8Array): { triColors: Uint8Array; striped: number } {
  const out = new Uint8Array(triColors);
  const bedZ = meshMinZ(mesh);
  const planes = planSwapPlanesZ(plan, bedZ);
  const cols = plan.blocks.map((b) => hexToRgb01(b.hex).map((v) => Math.round(v * 255)));
  const vp = mesh.vertProperties, np = mesh.numProp, tv = mesh.triVerts;
  let striped = 0;
  for (let t = 0; t < mesh.numTri; t++) {
    if (!isSideTriangle(mesh, t)) continue;
    const zc = (vp[tv[t * 3] * np + 2] + vp[tv[t * 3 + 1] * np + 2] + vp[tv[t * 3 + 2] * np + 2]) / 3;
    let k = 0;
    while (k < planes.length && zc >= planes[k]) k++;
    out[t * 3] = cols[k][0]; out[t * 3 + 1] = cols[k][1]; out[t * 3 + 2] = cols[k][2];
    striped++;
  }
  return { triColors: out, striped };
}
