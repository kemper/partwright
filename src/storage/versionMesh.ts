// The model snapshot a save records with a version: a geometry fingerprint
// (every version) and the displayed mesh (each object's newest version only).
//
// A version stores code, and opening it re-runs that code on the current
// engine. The fingerprint lets a later open notice that the code now builds a
// different model (see src/geometry/modelFingerprint.ts). The mesh lets the user
// get the saved model back: it is what the version showed when it was saved,
// colours included. Only the newest version of each object keeps one (a save
// drops the previous holder's), so storage grows with objects, not history.
//
// No mesh is stored when the version's model already IS stored mesh data: an
// imported or baked mesh (`importedMeshes`), an in-code surface texture
// (`surfaceTexture` holds the finished mesh), or a baked voxel grid (the grid is
// inlined in the code as `voxels.decode(…)`).
//
// Pure and dependency-free so the unit tier can test it.

import type { ModelFingerprint } from '../geometry/modelFingerprint';

/** A stored mesh: positions, triangles and (when painted) per-triangle RGB. */
export interface SavedMesh {
  vertProperties: Float32Array;
  triVerts: Uint32Array;
  numVert: number;
  numTri: number;
  numProp: number;
  /** numTri × 3 bytes of RGB, when the model was painted or coloured. */
  triColors?: Uint8Array;
}

/** What one save records about the model it saves. */
export interface VersionSnapshot {
  fingerprint?: ModelFingerprint;
  mesh?: SavedMesh;
}

/** The slice of a version this module reads. */
export interface MeshBackingProbe {
  code: string;
  language?: string;
  importedMeshes?: unknown[] | null;
  surfaceTexture?: unknown;
}

/** Baked voxel grids are inlined in the code as `voxels.decode("…")`. */
const VOXEL_DECODE = /\bvoxels\s*\.\s*decode\s*\(/;

/** True when the version's model is already stored as mesh data, so storing
 *  its displayed mesh again would only duplicate it. */
export function isMeshBackedVersion(v: MeshBackingProbe): boolean {
  if (Array.isArray(v.importedMeshes) && v.importedMeshes.length > 0) return true;
  if (v.surfaceTexture) return true;
  if (v.language === 'voxel' && VOXEL_DECODE.test(v.code)) return true;
  return false;
}

/** A SavedMesh of a mesh: positions only (x, y, z per vertex — a mesh with
 *  extra vertex properties is compacted, since a restore re-imports it as a
 *  3-property mesh), triangles and colours, without the engine-only fields
 *  (merge vectors, label runs). Shares the arrays when nothing needs copying. */
export function toSavedMesh(mesh: SavedMesh): SavedMesh {
  let vertProperties = mesh.vertProperties;
  if (mesh.numProp !== 3) {
    vertProperties = new Float32Array(mesh.numVert * 3);
    for (let i = 0; i < mesh.numVert; i++) {
      vertProperties[i * 3] = mesh.vertProperties[i * mesh.numProp];
      vertProperties[i * 3 + 1] = mesh.vertProperties[i * mesh.numProp + 1];
      vertProperties[i * 3 + 2] = mesh.vertProperties[i * mesh.numProp + 2];
    }
  }
  return {
    vertProperties,
    triVerts: mesh.triVerts,
    numVert: mesh.numVert,
    numTri: mesh.numTri,
    numProp: 3,
    ...(mesh.triColors ? { triColors: mesh.triColors } : {}),
  };
}

/** Validate a stored mesh read back from IndexedDB or a file; null when it
 *  isn't a usable one (so a corrupt record is just ignored). */
export function parseSavedMesh(raw: unknown): SavedMesh | null {
  if (!raw || typeof raw !== 'object') return null;
  const m = raw as Record<string, unknown>;
  const int = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;
  if (!(m.vertProperties instanceof Float32Array) || !(m.triVerts instanceof Uint32Array)) return null;
  if (!int(m.numVert) || !int(m.numTri) || !int(m.numProp) || m.numProp < 3) return null;
  if (m.vertProperties.length < m.numVert * m.numProp || m.triVerts.length < m.numTri * 3) return null;
  // Every triangle must reference a real vertex: a file can carry anything.
  const nv = m.numVert, tv = m.triVerts;
  for (let i = 0, n = m.numTri * 3; i < n; i++) if (tv[i] >= nv) return null;
  const triColors = m.triColors instanceof Uint8Array && m.triColors.length >= m.numTri * 3 ? m.triColors : undefined;
  return toSavedMesh({
    vertProperties: m.vertProperties,
    triVerts: m.triVerts,
    numVert: m.numVert,
    numTri: m.numTri,
    numProp: m.numProp,
    ...(triColors ? { triColors } : {}),
  });
}
