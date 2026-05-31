// Image stamp onto mesh triangles — click-to-stamp using a tangent-frame UV
// projection centred on a hit point. The image is preprocessed
// (brightness/contrast/saturation/levels) and optionally background-masked
// before sampling. Returns per-triangle colors as a Map and a compact
// serializable entry array for the descriptor.

import type { MeshData } from '../geometry/types';
import type { PreprocessOptions } from '../relief/types';
import { preprocessRgb, detectBackgroundMask, bgMaskFromColor } from '../relief/imageToRelief';

export interface StampImageOptions {
  hitPoint: [number, number, number];
  hitNormal: [number, number, number];
  size: number;        // stamp diameter in world units
  rotationDeg: number; // around hit normal, degrees
  preprocess: PreprocessOptions;
  removeBackground: boolean;
  manualBgColor?: [number, number, number]; // 0-255
  bgTolerance: number; // sum-of-squared-dist threshold, default 36*36*3
}

export interface ImagePaintResult {
  /** Per-triangle colors: tri index → [r, g, b] in 0–1 range */
  perTriColors: Map<number, [number, number, number]>;
  /** Average color across painted triangles, 0–1 */
  avgColor: [number, number, number];
  /** Serializable: flat [triIdx, r, g, b, …] with r/g/b in 0–255 */
  entries: number[];
}

/** Stamp an image onto the mesh, centred on `opts.hitPoint` and oriented
 *  according to `opts.hitNormal`. Only triangles whose face normal has a
 *  positive dot-product with hitNormal are painted. The stamp covers a square
 *  region of side `opts.size` world units, rotated by `opts.rotationDeg`
 *  around the normal axis. Returns per-triangle colors sampled from the
 *  preprocessed + masked image. */
export function stampImageOntoMesh(
  mesh: MeshData,
  imageData: ImageData,
  opts: StampImageOptions,
): ImagePaintResult {
  const { numTri, numProp, vertProperties, triVerts } = mesh;
  const { hitPoint, hitNormal, size, rotationDeg, preprocess, removeBackground, manualBgColor, bgTolerance } = opts;

  const imgW = imageData.width;
  const imgH = imageData.height;
  const pixelCount = imgW * imgH;

  // Copy image pixels into Float32 RGB (0–255) and preprocess
  const rgb = new Float32Array(pixelCount * 3);
  const src = imageData.data;
  for (let i = 0; i < pixelCount; i++) {
    rgb[i * 3]     = src[i * 4];
    rgb[i * 3 + 1] = src[i * 4 + 1];
    rgb[i * 3 + 2] = src[i * 4 + 2];
  }
  preprocessRgb(rgb, imgW, imgH, preprocess);

  // Build background mask if requested
  let bgMask: Uint8Array | null = null;
  if (removeBackground) {
    const colorsU8 = new Uint8Array(pixelCount * 3);
    for (let i = 0; i < pixelCount * 3; i++) colorsU8[i] = clamp255(rgb[i]);
    bgMask = manualBgColor
      ? bgMaskFromColor(colorsU8, imgW, imgH, manualBgColor, bgTolerance)
      : detectBackgroundMask(colorsU8, imgW, imgH);
  }

  // Build orthogonal tangent frame from hitNormal [nx, ny, nz]
  const [nx, ny, nz] = hitNormal;
  // Use world-Y as reference for mostly-vertical normals so top faces get
  // T=[1,0,0], B=[0,1,0] and the image projects without rotation.
  // Fall back to world-Z for mostly-horizontal normals.
  const useYRef = Math.abs(nz) > 0.5;
  const refX = 0;
  const refY = useYRef ? 1 : 0;
  const refZ = useYRef ? 0 : 1;

  // T = normalize(ref × N)
  let tX = refY * nz - refZ * ny;
  let tY = refZ * nx - refX * nz;
  let tZ = refX * ny - refY * nx;
  const tLen = Math.sqrt(tX * tX + tY * tY + tZ * tZ);
  if (tLen > 0) { tX /= tLen; tY /= tLen; tZ /= tLen; }

  // B = N × T
  const bX = ny * tZ - nz * tY;
  const bY = nz * tX - nx * tZ;
  const bZ = nx * tY - ny * tX;

  // Apply rotation θ around hit normal
  const θ = (rotationDeg * Math.PI) / 180;
  const cosθ = Math.cos(θ);
  const sinθ = Math.sin(θ);
  // Tr = T*cosθ - B*sinθ
  const trX = tX * cosθ - bX * sinθ;
  const trY = tY * cosθ - bY * sinθ;
  const trZ = tZ * cosθ - bZ * sinθ;
  // Br = T*sinθ + B*cosθ
  const brX = tX * sinθ + bX * cosθ;
  const brY = tY * sinθ + bY * cosθ;
  const brZ = tZ * sinθ + bZ * cosθ;

  const halfSize = size / 2;
  const [hpX, hpY, hpZ] = hitPoint;

  const perTriColors = new Map<number, [number, number, number]>();
  const entries: number[] = [];
  let sumR = 0, sumG = 0, sumB = 0, paintedCount = 0;

  for (let t = 0; t < numTri; t++) {
    const v0 = triVerts[t * 3];
    const v1 = triVerts[t * 3 + 1];
    const v2 = triVerts[t * 3 + 2];

    const x0 = vertProperties[v0 * numProp], y0 = vertProperties[v0 * numProp + 1], z0 = vertProperties[v0 * numProp + 2];
    const x1 = vertProperties[v1 * numProp], y1 = vertProperties[v1 * numProp + 1], z1 = vertProperties[v1 * numProp + 2];
    const x2 = vertProperties[v2 * numProp], y2 = vertProperties[v2 * numProp + 1], z2 = vertProperties[v2 * numProp + 2];

    // Skip back-facing triangles (dot of face normal with hitNormal ≤ 0)
    const ex = x1 - x0, ey = y1 - y0, ez = z1 - z0;
    const fx = x2 - x0, fy = y2 - y0, fz = z2 - z0;
    const fnX = ey * fz - ez * fy;
    const fnY = ez * fx - ex * fz;
    const fnZ = ex * fy - ey * fx;
    if (fnX * nx + fnY * ny + fnZ * nz <= 0) continue;

    // Triangle centroid
    const cx = (x0 + x1 + x2) / 3;
    const cy = (y0 + y1 + y2) / 3;
    const cz = (z0 + z1 + z2) / 3;

    // Delta from hit point to centroid
    const dx = cx - hpX;
    const dy = cy - hpY;
    const dz = cz - hpZ;

    // Project onto rotated tangent frame, normalised to [-1, 1]
    const u = (dx * trX + dy * trY + dz * trZ) / halfSize;
    const v = (dx * brX + dy * brY + dz * brZ) / halfSize;

    if (u < -1 || u > 1 || v < -1 || v > 1) continue;

    // Map to image coordinates (image is top-down, v flipped)
    const imgU = (u + 1) / 2;
    const imgV = (1 - v) / 2;

    // Nearest-neighbor sample
    const px = Math.max(0, Math.min(imgW - 1, Math.floor(imgU * imgW)));
    const py = Math.max(0, Math.min(imgH - 1, Math.floor(imgV * imgH)));
    const pidx = py * imgW + px;

    if (bgMask && bgMask[pidx] === 0) continue;

    const r = clamp255(rgb[pidx * 3]);
    const g = clamp255(rgb[pidx * 3 + 1]);
    const b = clamp255(rgb[pidx * 3 + 2]);

    const color: [number, number, number] = [r / 255, g / 255, b / 255];
    perTriColors.set(t, color);
    entries.push(t, r, g, b);
    sumR += r; sumG += g; sumB += b;
    paintedCount++;
  }

  const avgColor: [number, number, number] = paintedCount > 0
    ? [sumR / paintedCount / 255, sumG / paintedCount / 255, sumB / paintedCount / 255]
    : [0.5, 0.5, 0.5];

  return { perTriColors, avgColor, entries };
}

/** Reconstruct perTriColors from a stored entries array, expanding via
 *  parentToChildren if the mesh was subdivided since stamping. */
export function entriesToPerTriColors(
  entries: number[],
  parentToChildren: Map<number, number[]> | null,
): { triangles: Set<number>; perTriColors: Map<number, [number, number, number]> } {
  const triangles = new Set<number>();
  const perTriColors = new Map<number, [number, number, number]>();

  for (let i = 0; i < entries.length; i += 4) {
    const baseTri = entries[i];
    const color: [number, number, number] = [entries[i + 1] / 255, entries[i + 2] / 255, entries[i + 3] / 255];

    if (parentToChildren) {
      const children = parentToChildren.get(baseTri);
      if (children) {
        for (const child of children) {
          triangles.add(child);
          perTriColors.set(child, color);
        }
        continue;
      }
    }
    triangles.add(baseTri);
    perTriColors.set(baseTri, color);
  }

  return { triangles, perTriColors };
}

/** Remap perTriColors through a parentToChildren map (for mesh subdivision). */
export function remapPerTriColors(
  perTriColors: Map<number, [number, number, number]> | undefined,
  parentToChildren: Map<number, number[]> | null,
): Map<number, [number, number, number]> | undefined {
  if (!perTriColors || !parentToChildren) return perTriColors;
  const out = new Map<number, [number, number, number]>();
  for (const [parent, color] of perTriColors) {
    const children = parentToChildren.get(parent);
    if (children) {
      for (const child of children) out.set(child, color);
    } else {
      out.set(parent, color);
    }
  }
  return out;
}

/** Load ImageData from a data URL (async — requires a browser Document). */
export function loadImageDataFromUrl(dataUrl: string): Promise<ImageData> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) { reject(new Error('Canvas 2D not available')); return; }
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(img.src.startsWith('blob:') ? img.src : '');
      resolve(ctx.getImageData(0, 0, canvas.width, canvas.height));
    };
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = dataUrl;
  });
}

/** Scale an ImageData so its longer dimension ≤ maxDim. */
export function resizeImageData(imageData: ImageData, maxDim: number): ImageData {
  const { width, height } = imageData;
  if (width <= maxDim && height <= maxDim) return imageData;
  const scale = maxDim / Math.max(width, height);
  const dw = Math.max(1, Math.round(width * scale));
  const dh = Math.max(1, Math.round(height * scale));
  const src = document.createElement('canvas');
  src.width = width; src.height = height;
  const sCtx = src.getContext('2d')!;
  sCtx.putImageData(imageData, 0, 0);
  const dst = document.createElement('canvas');
  dst.width = dw; dst.height = dh;
  const dCtx = dst.getContext('2d')!;
  dCtx.drawImage(src, 0, 0, dw, dh);
  return dCtx.getImageData(0, 0, dw, dh);
}

/** Convert an ImageData to a JPEG data URL at the given quality. */
export function imageDataToDataUrl(imageData: ImageData, quality = 0.75): string {
  const canvas = document.createElement('canvas');
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL('image/jpeg', quality);
}

/** Return default no-op preprocess options. */
export function defaultPreprocess(): PreprocessOptions {
  return { brightness: 0, contrast: 0, saturation: 0, levelsLow: 0, levelsHigh: 255 };
}

/** Build the rotated tangent frame for a stamp, returning the two in-plane axes
 *  (tr, br) and the surface normal. Used by the hover-preview overlay. */
export function buildTangentFrame(
  hitNormal: [number, number, number],
  rotationDeg: number,
): { tr: [number, number, number]; br: [number, number, number]; n: [number, number, number] } {
  const [nx, ny, nz] = hitNormal;
  const useYRef = Math.abs(nz) > 0.5;
  const refX = 0, refY = useYRef ? 1 : 0, refZ = useYRef ? 0 : 1;
  let tX = refY * nz - refZ * ny;
  let tY = refZ * nx - refX * nz;
  let tZ = refX * ny - refY * nx;
  const tLen = Math.sqrt(tX * tX + tY * tY + tZ * tZ);
  if (tLen > 0) { tX /= tLen; tY /= tLen; tZ /= tLen; }
  const bX = ny * tZ - nz * tY;
  const bY = nz * tX - nx * tZ;
  const bZ = nx * tY - ny * tX;
  const θ = (rotationDeg * Math.PI) / 180;
  const cosθ = Math.cos(θ), sinθ = Math.sin(θ);
  return {
    tr: [tX * cosθ - bX * sinθ, tY * cosθ - bY * sinθ, tZ * cosθ - bZ * sinθ],
    br: [tX * sinθ + bX * cosθ, tY * sinθ + bY * cosθ, tZ * sinθ + bZ * cosθ],
    n: [nx, ny, nz],
  };
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function clamp255(v: number): number {
  const r = Math.round(v);
  return r < 0 ? 0 : r > 255 ? 255 : r;
}
