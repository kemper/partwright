import type { MeshData } from '../geometry/types';
import { downloadBlob, getExportFilename, getExportTitle } from './download';
import type { BuiltExport } from './gltf';
import { buildZip } from './zip';
import { assertFiniteMesh, cleanMeshForExport, DEFAULT_COLOR_HEX, triColorHex, hasAnyPainted } from './meshClean';

/** Round a float to 6 decimal places (float32 has ~7 significant digits). */
function f6(v: number): string {
  return v.toFixed(6);
}

/**
 * Build an OBJ export blob without triggering a download.
 * If the mesh has painted color regions, the result is a ZIP bundling .obj + .mtl;
 * otherwise it's a plain text .obj.
 */
export function buildOBJ(meshData: MeshData, customName?: string): BuiltExport {
  assertFiniteMesh(meshData);
  const { triVerts, triColors } = meshData;
  const title = getExportTitle();

  const { remap, uniquePositions, validTris } = cleanMeshForExport(meshData);
  const hasColors = triColors != null && hasAnyPainted(triColors, validTris);

  const baseName = getExportFilename('obj', customName).replace(/\.obj$/, '');
  const lines: string[] = [`# ${title}`];

  const numUniqueVerts = uniquePositions.length / 3;
  const fv = (origVert: number) => remap[origVert] + 1;

  if (hasColors && triColors) {
    lines.push(`mtllib ${baseName}.mtl`);

    // Vertices (no per-vertex colors — they cause bleeding at shared vertices)
    for (let i = 0; i < numUniqueVerts; i++) {
      lines.push(`v ${f6(uniquePositions[i * 3])} ${f6(uniquePositions[i * 3 + 1])} ${f6(uniquePositions[i * 3 + 2])}`);
    }

    // Group triangles by color for usemtl face groups + MTL
    const colorGroups = new Map<string, number[]>();
    for (const t of validTris) {
      const hex = triColorHex(triColors, t);
      if (!colorGroups.has(hex)) colorGroups.set(hex, []);
      colorGroups.get(hex)!.push(t);
    }

    // Faces grouped by usemtl
    for (const [hex, tris] of colorGroups) {
      lines.push(`usemtl ${matName(hex)}`);
      for (const t of tris) {
        lines.push(`f ${fv(triVerts[t * 3])} ${fv(triVerts[t * 3 + 1])} ${fv(triVerts[t * 3 + 2])}`);
      }
    }

    // Generate MTL file with Kd diffuse colors
    const mtlLines: string[] = [`# ${title} — Materials`];
    for (const hex of colorGroups.keys()) {
      const r = parseInt(hex.slice(1, 3), 16) / 255;
      const g = parseInt(hex.slice(3, 5), 16) / 255;
      const b = parseInt(hex.slice(5, 7), 16) / 255;
      mtlLines.push(`newmtl ${matName(hex)}`);
      mtlLines.push(`Kd ${r.toFixed(6)} ${g.toFixed(6)} ${b.toFixed(6)}`);
      mtlLines.push(`Ka 0.100000 0.100000 0.100000`);
      mtlLines.push(`Ks 0.300000 0.300000 0.300000`);
      mtlLines.push(`Ns 40.000000`);
      mtlLines.push(`d 1.000000`);
      mtlLines.push('');
    }

    // Bundle OBJ + MTL in a ZIP
    const enc = new TextEncoder();
    const zip = buildZip([
      { name: `${baseName}.obj`, data: enc.encode(lines.join('\n') + '\n') },
      { name: `${baseName}.mtl`, data: enc.encode(mtlLines.join('\n') + '\n') },
    ]);

    const mimeType = 'application/zip';
    const blob = new Blob([zip], { type: mimeType });
    return { blob, filename: `${baseName}.zip`, mimeType };
  }

  // No colors — plain OBJ
  for (let i = 0; i < numUniqueVerts; i++) {
    lines.push(`v ${f6(uniquePositions[i * 3])} ${f6(uniquePositions[i * 3 + 1])} ${f6(uniquePositions[i * 3 + 2])}`);
  }

  for (const t of validTris) {
    lines.push(`f ${fv(triVerts[t * 3])} ${fv(triVerts[t * 3 + 1])} ${fv(triVerts[t * 3 + 2])}`);
  }

  const mimeType = 'text/plain';
  const blob = new Blob([lines.join('\n') + '\n'], { type: mimeType });
  return { blob, filename: getExportFilename('obj', customName), mimeType };
}

export function exportOBJ(meshData: MeshData, customName?: string): string {
  const built = buildOBJ(meshData, customName);
  downloadBlob(built.blob, built.filename, 'OBJ');
  return built.filename;
}

function matName(hex: string): string {
  return hex === DEFAULT_COLOR_HEX ? 'Default' : `Color_${hex.slice(1)}`;
}
