import type { MeshData } from '../geometry/types';
import { downloadBlob, getExportFilename, getExportTitle } from './download';
import type { BuiltExport } from './gltf';
import { buildZip } from './zip';
import { assertFiniteMesh, assertExportableMesh, cleanMeshForExport, DEFAULT_COLOR_HEX, triColorHex, hasAnyPainted } from './meshClean';
import { gridLayout, uniquePartStem, type ExportPart } from './multiPart';

/** Round a float to 6 decimal places (float32 has ~7 significant digits). */
function f6(v: number): string {
  return v.toFixed(6);
}

/** Build the `.mtl` text for a set of colour hexes (Kd diffuse + a flat ambient/
 *  specular), shared by the single-part and multi-part OBJ exporters. */
function buildMtl(hexes: Iterable<string>, title: string): string {
  const lines: string[] = ['# Partwright — https://www.partwrightstudio.com', `# ${title} — Materials`];
  for (const hex of hexes) {
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    lines.push(`newmtl ${matName(hex)}`);
    lines.push(`Kd ${r.toFixed(6)} ${g.toFixed(6)} ${b.toFixed(6)}`);
    lines.push(`Ka 0.100000 0.100000 0.100000`);
    lines.push(`Ks 0.300000 0.300000 0.300000`);
    lines.push(`Ns 40.000000`);
    lines.push(`d 1.000000`);
    lines.push('');
  }
  return lines.join('\n') + '\n';
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
  assertExportableMesh(validTris);
  const hasColors = triColors != null && hasAnyPainted(triColors, validTris);

  const baseName = getExportFilename('obj', customName).replace(/\.obj$/, '');
  const lines: string[] = ['# Partwright — https://www.partwrightstudio.com', `# ${title}`];

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

    // Bundle OBJ + MTL in a ZIP
    const enc = new TextEncoder();
    const zip = buildZip([
      { name: `${baseName}.obj`, data: enc.encode(lines.join('\n') + '\n') },
      { name: `${baseName}.mtl`, data: enc.encode(buildMtl(colorGroups.keys(), title)) },
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

/**
 * Build a multi-part OBJ: each Session Part becomes a named `o <part>` object in ONE
 * `.obj` file, grid-arranged in XY so the parts don't overlap. OBJ natively supports
 * named objects, so the parts stay distinct and individually selectable in any tool —
 * no triangle-soup merge. Vertex indices are cumulative across parts (OBJ's `f`
 * indices are global and 1-based). If any part is painted, the whole export bundles a
 * shared `.mtl` (OBJ + MTL in a `.zip`) and unpainted parts use the Default material;
 * with no colours anywhere it's a plain `.obj`.
 */
export function buildOBJProject(parts: ExportPart[], customName?: string, gridGapMm = 10): BuiltExport {
  if (parts.length === 0) throw new Error('Cannot export: no parts selected.');
  for (const p of parts) assertFiniteMesh(p.mesh);

  const title = getExportTitle();
  const slots = gridLayout(parts.map(p => p.mesh), gridGapMm);
  const baseName = getExportFilename('obj', customName).replace(/\.obj$/, '');

  // Clean each part once (drops degenerates + merges dup verts) — reused for the
  // colour scan and the emit below.
  const cleaned = parts.map(p => cleanMeshForExport(p.mesh));
  const anyColors = parts.some((p, i) => p.mesh.triColors != null && hasAnyPainted(p.mesh.triColors, cleaned[i].validTris));

  const lines: string[] = ['# Partwright — https://www.partwrightstudio.com', `# ${title}`];
  if (anyColors) lines.push(`mtllib ${baseName}.mtl`);

  const usedNames = new Set<string>();
  const usedHexes = new Set<string>();
  let vertOffset = 0; // cumulative unique-vertex count across emitted parts
  parts.forEach((p, i) => {
    const { remap, uniquePositions, validTris } = cleaned[i];
    if (validTris.length === 0) return; // skip empty parts (keeps vertOffset correct)
    const { triVerts, triColors } = p.mesh;
    lines.push(`o ${uniquePartStem(p.name, usedNames, `part_${i + 1}`)}`);

    const { dx, dy } = slots[i];
    const numV = uniquePositions.length / 3;
    for (let v = 0; v < numV; v++) {
      lines.push(`v ${f6(uniquePositions[v * 3] + dx)} ${f6(uniquePositions[v * 3 + 1] + dy)} ${f6(uniquePositions[v * 3 + 2])}`);
    }
    const fv = (origVert: number) => remap[origVert] + 1 + vertOffset;

    if (anyColors && triColors) {
      // Group this part's faces by colour for usemtl runs (unpainted tris fall into
      // the Default material via triColorHex).
      const groups = new Map<string, number[]>();
      for (const t of validTris) {
        const hex = triColorHex(triColors, t);
        let g = groups.get(hex);
        if (!g) groups.set(hex, g = []);
        g.push(t);
      }
      for (const [hex, tris] of groups) {
        lines.push(`usemtl ${matName(hex)}`);
        usedHexes.add(hex);
        for (const t of tris) lines.push(`f ${fv(triVerts[t * 3])} ${fv(triVerts[t * 3 + 1])} ${fv(triVerts[t * 3 + 2])}`);
      }
    } else {
      // Uncoloured part. When the export has an MTL (some other part is painted),
      // bind it to the Default material so it isn't left material-less.
      if (anyColors) { lines.push(`usemtl ${matName(DEFAULT_COLOR_HEX)}`); usedHexes.add(DEFAULT_COLOR_HEX); }
      for (const t of validTris) lines.push(`f ${fv(triVerts[t * 3])} ${fv(triVerts[t * 3 + 1])} ${fv(triVerts[t * 3 + 2])}`);
    }
    vertOffset += numV;
  });

  if (anyColors) {
    const enc = new TextEncoder();
    const zip = buildZip([
      { name: `${baseName}.obj`, data: enc.encode(lines.join('\n') + '\n') },
      { name: `${baseName}.mtl`, data: enc.encode(buildMtl(usedHexes, title)) },
    ]);
    const mimeType = 'application/zip';
    return { blob: new Blob([zip], { type: mimeType }), filename: `${baseName}.zip`, mimeType };
  }

  const mimeType = 'text/plain';
  return { blob: new Blob([lines.join('\n') + '\n'], { type: mimeType }), filename: getExportFilename('obj', customName), mimeType };
}

export function exportOBJ(meshData: MeshData, customName?: string): string {
  const built = buildOBJ(meshData, customName);
  downloadBlob(built.blob, built.filename, 'OBJ');
  return built.filename;
}

function matName(hex: string): string {
  return hex === DEFAULT_COLOR_HEX ? 'Default' : `Color_${hex.slice(1)}`;
}
