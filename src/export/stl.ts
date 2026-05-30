import type { MeshData } from '../geometry/types';
import { downloadBlob, getExportFilename, getExportTitle } from './download';
import { assertFiniteMesh } from './meshClean';
import type { BuiltExport } from './gltf';

/** Build the binary STL blob for a mesh without triggering a download. */
export function buildSTL(meshData: MeshData, customName?: string): BuiltExport {
  assertFiniteMesh(meshData);
  const { vertProperties, triVerts, numTri, numProp } = meshData;

  // Binary STL format
  const headerSize = 80;
  const triangleSize = 50; // 12 (normal) + 36 (3 vertices) + 2 (attribute)
  const bufferSize = headerSize + 4 + numTri * triangleSize;
  const buffer = new ArrayBuffer(bufferSize);
  const view = new DataView(buffer);

  // Header (80 bytes) — include session name if available, plus a Partwright
  // attribution suffix when it fits. The header must be plain ASCII: setUint8
  // truncates each code unit to one byte, so a multi-byte char (e.g. the
  // em-dash getExportTitle puts between "name — label") would otherwise write
  // garbage. Normalize dashes and drop other non-ASCII.
  //
  // CRITICAL: the header is fixed at 80 bytes and byte 80 holds the triangle
  // count — the header must NEVER exceed 80 bytes or the count is corrupted.
  // The attribution is only appended when the title + suffix still fits; the
  // loop below caps at 80 as a final backstop regardless.
  const title = getExportTitle()
    .replace(/[‒-―]/g, '-')
    .replace(/[^\x20-\x7E]/g, '?');
  const ATTRIBUTION = 'Partwright partwrightstudio.com';
  const header = (title.length + 3 + ATTRIBUTION.length <= 80)
    ? `${title} - ${ATTRIBUTION}`
    : title;
  for (let i = 0; i < Math.min(header.length, 80); i++) {
    view.setUint8(i, header.charCodeAt(i));
  }

  // Number of triangles
  view.setUint32(80, numTri, true);

  let offset = 84;
  for (let t = 0; t < numTri; t++) {
    const i0 = triVerts[t * 3];
    const i1 = triVerts[t * 3 + 1];
    const i2 = triVerts[t * 3 + 2];

    const v0x = vertProperties[i0 * numProp];
    const v0y = vertProperties[i0 * numProp + 1];
    const v0z = vertProperties[i0 * numProp + 2];
    const v1x = vertProperties[i1 * numProp];
    const v1y = vertProperties[i1 * numProp + 1];
    const v1z = vertProperties[i1 * numProp + 2];
    const v2x = vertProperties[i2 * numProp];
    const v2y = vertProperties[i2 * numProp + 1];
    const v2z = vertProperties[i2 * numProp + 2];

    // Compute face normal
    const ax = v1x - v0x, ay = v1y - v0y, az = v1z - v0z;
    const bx = v2x - v0x, by = v2y - v0y, bz = v2z - v0z;
    let nx = ay * bz - az * by;
    let ny = az * bx - ax * bz;
    let nz = ax * by - ay * bx;
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    nx /= len; ny /= len; nz /= len;

    // Normal
    view.setFloat32(offset, nx, true); offset += 4;
    view.setFloat32(offset, ny, true); offset += 4;
    view.setFloat32(offset, nz, true); offset += 4;

    // Vertex 1
    view.setFloat32(offset, v0x, true); offset += 4;
    view.setFloat32(offset, v0y, true); offset += 4;
    view.setFloat32(offset, v0z, true); offset += 4;

    // Vertex 2
    view.setFloat32(offset, v1x, true); offset += 4;
    view.setFloat32(offset, v1y, true); offset += 4;
    view.setFloat32(offset, v1z, true); offset += 4;

    // Vertex 3
    view.setFloat32(offset, v2x, true); offset += 4;
    view.setFloat32(offset, v2y, true); offset += 4;
    view.setFloat32(offset, v2z, true); offset += 4;

    // Attribute byte count
    view.setUint16(offset, 0, true); offset += 2;
  }

  const mimeType = 'application/octet-stream';
  const blob = new Blob([buffer], { type: mimeType });
  return { blob, filename: getExportFilename('stl', customName), mimeType };
}

export function exportSTL(meshData: MeshData, customName?: string): string {
  const built = buildSTL(meshData, customName);
  downloadBlob(built.blob, built.filename, 'STL');
  return built.filename;
}
