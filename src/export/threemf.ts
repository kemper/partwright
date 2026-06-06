import type { MeshData } from '../geometry/types';
import { get3MFUnitString } from '../geometry/units';
import { downloadBlob, getExportFilename, getExportTitle } from './download';
import type { BuiltExport } from './gltf';
import { buildZip } from './zip';
import { assertFiniteMesh, cleanMeshForExport, triColorHex, hasAnyPainted } from './meshClean';
import { listFilaments } from '../color/palette';

/** Build a 3MF export blob without triggering a download. */
export function build3MF(meshData: MeshData, customName?: string): BuiltExport {
  assertFiniteMesh(meshData);
  const { triVerts, triColors } = meshData;

  const { remap, uniquePositions, validTris } = cleanMeshForExport(meshData);

  // Build vertices XML (deduplicated, 6dp precision)
  const numUniqueVerts = uniquePositions.length / 3;
  const vertices: string[] = [];
  for (let i = 0; i < numUniqueVerts; i++) {
    const x = uniquePositions[i * 3].toFixed(6);
    const y = uniquePositions[i * 3 + 1].toFixed(6);
    const z = uniquePositions[i * 3 + 2].toFixed(6);
    vertices.push(`          <vertex x="${x}" y="${y}" z="${z}" />`);
  }

  // Collect distinct colors for m:colorgroup. Order matters: a slicer (Bambu
  // Studio / Orca) maps each m:color to a filament in declaration order, so we
  // emit the colours of the *filament-palette slots that are actually used*
  // first, in slot order — making the 3MF material index follow the user's
  // AMS slot order. Any remaining painted colours (custom/ad-hoc, plus the
  // default colour of unpainted faces) follow in first-encounter order. Only
  // colours that actually appear in the mesh are emitted (no phantom filaments).
  const hasColors = triColors != null && hasAnyPainted(triColors, validTris);
  const colorMap = new Map<string, number>(); // hex -> material index
  const materialColors: string[] = [];

  if (hasColors && triColors) {
    const pushMaterial = (hex: string) => {
      if (!colorMap.has(hex)) {
        colorMap.set(hex, materialColors.length);
        materialColors.push(hex);
      }
    };

    // Which painted colours actually appear in the mesh.
    const usedHexes = new Set<string>();
    for (const t of validTris) usedHexes.add(triColorHex(triColors, t));

    // 1) Used palette slots, in slot order → material index follows AMS order.
    for (const slot of listFilaments()) {
      const hex = slot.hex.toLowerCase();
      if (usedHexes.has(hex)) pushMaterial(hex);
    }
    // 2) Everything else (custom colours + the unpainted default), in
    //    first-encounter order.
    for (const t of validTris) pushMaterial(triColorHex(triColors, t));
  }

  // Build triangles XML (remapped vertex indices, filtered for degenerates)
  const triangles: string[] = [];
  for (const t of validTris) {
    const v1 = remap[triVerts[t * 3]];
    const v2 = remap[triVerts[t * 3 + 1]];
    const v3 = remap[triVerts[t * 3 + 2]];

    if (hasColors && triColors) {
      const hex = triColorHex(triColors, t);
      const matIdx = colorMap.get(hex) ?? 0;
      triangles.push(`          <triangle v1="${v1}" v2="${v2}" v3="${v3}" pid="2" p1="${matIdx}" />`);
    } else {
      triangles.push(`          <triangle v1="${v1}" v2="${v2}" v3="${v3}" />`);
    }
  }

  // Build m:colorgroup XML block
  let colorgroupXml = '';
  if (hasColors) {
    const colors = materialColors.map(hex =>
      `      <m:color color="${hex.toUpperCase()}FF" />`
    ).join('\n');
    colorgroupXml = `
    <m:colorgroup id="2">
${colors}
    </m:colorgroup>`;
  }

  // Escape XML special chars in title
  const title = getExportTitle().replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const nsAttr = hasColors ? ' xmlns:m="http://schemas.microsoft.com/3dmanufacturing/material/2015/02"' : '';

  const modelXml = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="${get3MFUnitString()}" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"${nsAttr}>
  <metadata name="Title">${title}</metadata>
  <metadata name="Application">Partwright (https://www.partwrightstudio.com)</metadata>
  <metadata name="Designer">Partwright</metadata>
  <metadata name="LicenseTerms">Created with Partwright — https://www.partwrightstudio.com</metadata>
  <resources>${colorgroupXml}
    <object id="1" type="model"${hasColors ? ' pid="2" pindex="0"' : ''}>
      <mesh>
        <vertices>
${vertices.join('\n')}
        </vertices>
        <triangles>
${triangles.join('\n')}
        </triangles>
      </mesh>
    </object>
  </resources>
  <build>
    <item objectid="1" />
  </build>
</model>`;

  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml" />
  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml" />
</Types>`;

  const relsXml = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel" />
</Relationships>`;

  const zip = buildZip([
    { name: '[Content_Types].xml', data: new TextEncoder().encode(contentTypesXml) },
    { name: '_rels/.rels', data: new TextEncoder().encode(relsXml) },
    { name: '3D/3dmodel.model', data: new TextEncoder().encode(modelXml) },
  ]);

  const mimeType = 'application/vnd.ms-package.3dmanufacturing';
  const blob = new Blob([zip], { type: mimeType });
  return { blob, filename: getExportFilename('3mf', customName), mimeType };
}

export function export3MF(meshData: MeshData, customName?: string): string {
  const built = build3MF(meshData, customName);
  downloadBlob(built.blob, built.filename, '3MF');
  return built.filename;
}
