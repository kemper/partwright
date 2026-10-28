// A compact geometry fingerprint for a saved version: enough to tell, on a
// later open, whether the version's code still builds the same model.
//
// Saved versions store code, and opening one re-runs that code on the current
// engine. A builder change in any release (a figure tweak, a new default) can
// therefore change a saved model silently, and its thumbnail stops matching.
// The fingerprint is stored with each version (about 100 bytes) and compared
// against the rebuilt mesh when the version is opened.
//
// Two layers:
//  - `hash` is an exact content hash, so an unchanged model matches instantly.
//  - The measurements (volume, area, bounds, surface centroid and spread) are
//    order-independent and compared with small tolerances, so float noise
//    between browsers (a `Math.sin` that differs in the last bit) never reads
//    as a change, while a real edit does.
//
// Versions saved before fingerprints existed are compared on the stats every
// version already stores (`fingerprintFromStats`), so drift detection also
// covers old saves.
//
// Pure and dependency-free (unit-tested in tests/unit/modelFingerprint.test.ts).

import type { MeshData } from './types';

export interface ModelFingerprint {
  /** Format version of this record. */
  v: 1;
  tris: number;
  verts: number;
  volume: number;
  area: number;
  /** [minX, minY, minZ, maxX, maxY, maxZ]. */
  bbox: [number, number, number, number, number, number];
  /** Area-weighted centroid of the surface. Absent on stats-derived prints. */
  centroid?: [number, number, number];
  /** Area-weighted second moments of the surface about its centroid, divided
   *  by the total area: [xx, yy, zz, xy, xz, yz]. Absent on stats-derived. */
  spread?: [number, number, number, number, number, number];
  /** Exact content hash of positions + triangles. Absent on stats-derived. */
  hash?: string;
}

/** Relative tolerance for scalar measurements (volume, area, spread). Float
 *  noise across engines is ~1e-12; a real edit moves these far more. */
const REL_TOL = 1e-5;
/** Triangle-count changes at or below this fraction (and at most one triangle)
 *  are treated as noise: a level-set sign flip can add or drop a sliver. */
const TRI_TOL = 1e-4;

function fnv(h: number, bytes: Uint8Array): number {
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193);
  }
  return h;
}

/** Fingerprint a mesh. Linear in its size (a few ms for 100k triangles). */
export function computeModelFingerprint(mesh: MeshData): ModelFingerprint {
  const vp = mesh.vertProperties;
  const tv = mesh.triVerts;
  const np = mesh.numProp;
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < mesh.numVert; i++) {
    const x = vp[i * np], y = vp[i * np + 1], z = vp[i * np + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  if (mesh.numVert === 0) { minX = minY = minZ = maxX = maxY = maxZ = 0; }

  let volume = 0, area = 0;
  let sx = 0, sy = 0, sz = 0;
  let sxx = 0, syy = 0, szz = 0, sxy = 0, sxz = 0, syz = 0;
  for (let t = 0; t < mesh.numTri; t++) {
    const a = tv[t * 3] * np, b = tv[t * 3 + 1] * np, c = tv[t * 3 + 2] * np;
    const ax = vp[a], ay = vp[a + 1], az = vp[a + 2];
    const bx = vp[b], by = vp[b + 1], bz = vp[b + 2];
    const cx = vp[c], cy = vp[c + 1], cz = vp[c + 2];
    // Signed tetra volume against the origin (divergence theorem).
    volume += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const wx = cx - ax, wy = cy - ay, wz = cz - az;
    const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
    const ar = Math.hypot(nx, ny, nz) / 2;
    area += ar;
    const px = ax + bx + cx, py = ay + by + cy, pz = az + bz + cz;
    sx += ar * px / 3; sy += ar * py / 3; sz += ar * pz / 3;
    // Exact second moments of the triangle, ∫ x xᵀ dA = A/12 (Σ v vᵀ + (Σ v)(Σ v)ᵀ),
    // so any triangulation of the same surface gives the same spread.
    const k = ar / 12;
    sxx += k * (ax * ax + bx * bx + cx * cx + px * px);
    syy += k * (ay * ay + by * by + cy * cy + py * py);
    szz += k * (az * az + bz * bz + cz * cz + pz * pz);
    sxy += k * (ax * ay + bx * by + cx * cy + px * py);
    sxz += k * (ax * az + bx * bz + cx * cz + px * pz);
    syz += k * (ay * az + by * bz + cy * cz + py * pz);
  }
  const inv = area > 0 ? 1 / area : 0;
  const cxm = sx * inv, cym = sy * inv, czm = sz * inv;
  const spread: ModelFingerprint['spread'] = [
    sxx * inv - cxm * cxm, syy * inv - cym * cym, szz * inv - czm * czm,
    sxy * inv - cxm * cym, sxz * inv - cxm * czm, syz * inv - cym * czm,
  ];

  let h = 0x811c9dc5;
  h = fnv(h, new Uint8Array(vp.buffer, vp.byteOffset, vp.byteLength));
  h = fnv(h, new Uint8Array(tv.buffer, tv.byteOffset, tv.byteLength));

  return {
    v: 1,
    tris: mesh.numTri,
    verts: mesh.numVert,
    volume,
    area,
    bbox: [minX, minY, minZ, maxX, maxY, maxZ],
    centroid: [cxm, cym, czm],
    spread,
    hash: `${(h >>> 0).toString(36)}-${mesh.numVert}-${mesh.numTri}`,
  };
}

/** A partial fingerprint from a version's stored geometry stats (the
 *  `geometryData` every version has had since long before fingerprints), or
 *  null when the stats are missing or from a failed run. Volume and area here
 *  come from Manifold, so compare a stats print only with another stats print. */
export function fingerprintFromStats(stats: Record<string, unknown> | null | undefined): ModelFingerprint | null {
  if (!stats || stats.status !== 'ok') return null;
  const tris = stats.triangleCount, verts = stats.vertexCount;
  const volume = stats.volume, area = stats.surfaceArea;
  const bb = stats.boundingBox as { x?: unknown; y?: unknown; z?: unknown } | null | undefined;
  if (typeof tris !== 'number' || typeof verts !== 'number' || typeof volume !== 'number' || typeof area !== 'number') return null;
  const axis = (v: unknown): [number, number] | null =>
    Array.isArray(v) && v.length >= 2 && typeof v[0] === 'number' && typeof v[1] === 'number' ? [v[0], v[1]] : null;
  const x = axis(bb?.x), y = axis(bb?.y), z = axis(bb?.z);
  if (!x || !y || !z) return null;
  return { v: 1, tris, verts, volume, area, bbox: [x[0], y[0], z[0], x[1], y[1], z[1]] };
}

/** Validate a fingerprint read back from storage or a file; null when it isn't
 *  one (so a corrupt record just skips drift detection). */
export function parseModelFingerprint(raw: unknown): ModelFingerprint | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  const nums = (v: unknown, n: number): v is number[] => Array.isArray(v) && v.length === n && v.every(num);
  if (r.v !== 1 || !num(r.tris) || !num(r.verts) || !num(r.volume) || !num(r.area) || !nums(r.bbox, 6)) return null;
  return {
    v: 1,
    tris: r.tris,
    verts: r.verts,
    volume: r.volume,
    area: r.area,
    bbox: r.bbox as ModelFingerprint['bbox'],
    ...(nums(r.centroid, 3) ? { centroid: r.centroid as ModelFingerprint['centroid'] } : {}),
    ...(nums(r.spread, 6) ? { spread: r.spread as ModelFingerprint['spread'] } : {}),
    ...(typeof r.hash === 'string' ? { hash: r.hash } : {}),
  };
}

export interface FingerprintComparison {
  /** True when the rebuilt model differs from the saved one beyond float noise. */
  changed: boolean;
  /** Plain-words differences, largest first (empty when unchanged). */
  diffs: string[];
}

function pct(saved: number, now: number): string {
  if (saved === 0) return now > 0 ? 'appeared' : 'vanished';
  const p = ((now - saved) / Math.abs(saved)) * 100;
  const mag = Math.abs(p);
  const shown = mag >= 10 ? mag.toFixed(0) : mag >= 0.1 ? mag.toFixed(1) : mag.toPrecision(1);
  return `${p >= 0 ? '+' : '−'}${shown}%`;
}

/** Compare a saved fingerprint with the rebuilt one. Only fields both carry are
 *  compared, so a stats-derived print works against another stats print. */
export function compareModelFingerprints(saved: ModelFingerprint, now: ModelFingerprint): FingerprintComparison {
  if (saved.hash && now.hash && saved.hash === now.hash) return { changed: false, diffs: [] };
  const diag = Math.max(
    Math.hypot(saved.bbox[3] - saved.bbox[0], saved.bbox[4] - saved.bbox[1], saved.bbox[5] - saved.bbox[2]),
    Math.hypot(now.bbox[3] - now.bbox[0], now.bbox[4] - now.bbox[1], now.bbox[5] - now.bbox[2]),
    1e-9,
  );
  const lenTol = REL_TOL * diag;
  const scored: { weight: number; text: string }[] = [];
  const rel = (a: number, b: number, scale: number): number => Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), scale);

  const dVol = rel(saved.volume, now.volume, 1e-12 * diag ** 3);
  if (dVol > REL_TOL) scored.push({ weight: dVol, text: `volume ${pct(saved.volume, now.volume)}` });
  const dArea = rel(saved.area, now.area, 1e-12 * diag ** 2);
  if (dArea > REL_TOL) scored.push({ weight: dArea, text: `surface area ${pct(saved.area, now.area)}` });

  const axes = ['X', 'Y', 'Z'];
  for (let k = 0; k < 3; k++) {
    const sizeS = saved.bbox[k + 3] - saved.bbox[k];
    const sizeN = now.bbox[k + 3] - now.bbox[k];
    const moved = Math.max(Math.abs(saved.bbox[k] - now.bbox[k]), Math.abs(saved.bbox[k + 3] - now.bbox[k + 3]));
    if (moved <= lenTol) continue;
    if (Math.abs(sizeS - sizeN) > lenTol) {
      scored.push({ weight: Math.abs(sizeS - sizeN) / diag, text: `${axes[k]} size ${pct(sizeS, sizeN)}` });
    } else {
      scored.push({ weight: moved / diag, text: `moved along ${axes[k]}` });
    }
  }

  if (saved.centroid && now.centroid) {
    const d = Math.hypot(saved.centroid[0] - now.centroid[0], saved.centroid[1] - now.centroid[1], saved.centroid[2] - now.centroid[2]);
    if (d > lenTol) scored.push({ weight: d / diag, text: 'surface shifted' });
  }
  if (saved.spread && now.spread) {
    let d = 0;
    for (let k = 0; k < 6; k++) d = Math.max(d, Math.abs(saved.spread[k] - now.spread[k]));
    if (d > REL_TOL * diag * diag) scored.push({ weight: d / (diag * diag), text: 'shape changed' });
  }

  const dTri = Math.abs(saved.tris - now.tris);
  if (dTri > 1 && dTri > TRI_TOL * Math.max(saved.tris, now.tris)) {
    scored.push({
      // Ranked below shape changes: a different tessellation of the same shape
      // matters less to the user than a size or volume change.
      weight: 0.1 * dTri / Math.max(saved.tris, now.tris, 1),
      text: `${dTri.toLocaleString('en-US')} ${now.tris > saved.tris ? 'more' : 'fewer'} triangles`,
    });
  }

  scored.sort((a, b) => b.weight - a.weight);
  return { changed: scored.length > 0, diffs: scored.map(s => s.text) };
}
