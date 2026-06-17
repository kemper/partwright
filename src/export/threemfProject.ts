// Multi-part 3MF export — bundles several Session Parts into ONE 3MF. Two modes:
//
//   bambu: false (GENERIC) — a single `3D/3dmodel.model` with all parts as INLINE
//     mesh objects laid out in a centred grid, an `<m:colorgroup>` per object, no
//     Bambu metadata. Opens in any slicer/viewer.
//
//   bambu: true (BAMBU/ORCA PROJECT) — the 3MF **production extension** layout
//     Bambu Studio / OrcaSlicer require to build MULTIPLE PLATES. Each part is a
//     wrapper object referencing its mesh in a separate `/3D/Objects/object_N.model`
//     file; one `<plate>` per part drives the plate count; a minimal
//     `project_settings.config` is REQUIRED or the project loader refuses to build
//     the plate list (it falls back to a single plate). This layout + the 5-key
//     project config is verified to load with N plates in OrcaSlicer 2.3.2 headless.
//
//     WHY the split files: with `<plate>` blocks present, the loader only assembles
//     objects stored as production-extension components — inline meshes make it
//     report "0 objects" and abort (the load crash). See the PR for the full
//     source-grounded spec + the headless validation recipe.

import type { MeshData } from '../geometry/types';
import { get3MFUnitString } from '../geometry/units';
import { getExportFilename, getExportTitle } from './download';
import type { BuiltExport } from './gltf';
import { buildZip } from './zip';
import { assertFiniteMesh, assertExportableMesh, cleanMeshForExport, triColorHex, hasAnyPainted } from './meshClean';
import { listFilaments } from '../color/palette';
import { encodePaintColorState } from './paintColor3mf';

/** One selected Session Part, with its baked (optionally coloured) mesh. */
export interface PartExport {
  /** Display name — becomes the object/plate name in the 3MF. */
  name: string;
  /** The part's mesh. `triColors` (if present) drives the per-triangle colour. */
  mesh: MeshData;
}

export interface Build3MFProjectOptions {
  /** Override the download filename stem. */
  customName?: string;
  /** Emit the Bambu/Orca project layer (production-extension split files, one
   *  plate per part). When false, a GENERIC inline multi-object 3MF (grid). */
  bambu?: boolean;
  /** Build-plate size `[x, y]` mm — reserved for future per-bed tuning of the
   *  generic grid. (Bambu plate placement uses the validated fixed grid below.) */
  bedSize?: [number, number];
  /** Gap (mm) between parts in the GENERIC grid layout. Default 10. */
  gridGapMm?: number;
}

const CORE_NS = 'http://schemas.microsoft.com/3dmanufacturing/core/2015/02';
const MAT_NS = 'http://schemas.microsoft.com/3dmanufacturing/material/2015/02';
const PROD_NS = 'http://schemas.microsoft.com/3dmanufacturing/production/2015/06';
const BBS_NS = 'http://schemas.bambulab.com/package/2021';
const REL_TYPE = 'http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel';

// Bambu/Orca lay plates out in a 2-column grid; with the declared printer profile
// the validated slot positions are a 240 mm stride with a 90 mm corner offset
// (col → X = 90 + col·240, row → Y = 90 − row·240). Each part's <item> lands in a
// distinct plate slot so plates aren't empty. Verified against OrcaSlicer 2.3.2.
const PLATE_STRIDE = 240;
const PLATE_OFFSET = 90;

function escXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/** Format a coordinate: 6dp with trailing zeros stripped (the form Bambu/Orca's
 *  exporter writes; avoids parser edge cases with long zero runs). */
function fmtCoord(v: number): string {
  return v.toFixed(6).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
}

const enc = (s: string) => new TextEncoder().encode(s);

interface PreparedPart {
  name: string;
  vertices: string[];   // <vertex .../> lines
  triangles: string[];  // <triangle .../> lines
  faceCount: number;
  extruder: number;     // 1-based dominant filament (global index)
  cx: number; cy: number; minZ: number; width: number; depth: number;
}

/**
 * Build a multi-part 3MF blob. See the module header for the two modes.
 */
export function build3MFProject(parts: PartExport[], opts: Build3MFProjectOptions = {}): BuiltExport {
  if (parts.length === 0) throw new Error('Cannot export: no parts selected.');
  const bambu = opts.bambu ?? true;
  const gridGap = opts.gridGapMm ?? 10;

  // ── Shared filament/material list across ALL parts ──────────────────────
  // Same ordering as the single-part exporter: used palette slots in AMS-slot
  // order first, then remaining colours first-encounter. A colour's index here
  // is its material index (pid/p1) AND its 1-based filament index (extruder /
  // paint_color) everywhere, so a colour maps to the same filament on every part.
  const cleaned = parts.map(p => {
    assertFiniteMesh(p.mesh);
    const c = cleanMeshForExport(p.mesh);
    assertExportableMesh(c.validTris);
    return c;
  });
  const anyColour = parts.some((p, i) => p.mesh.triColors != null && hasAnyPainted(p.mesh.triColors, cleaned[i].validTris));
  const colorMap = new Map<string, number>();
  const materialColors: string[] = [];
  const pushMaterial = (hex: string) => { if (!colorMap.has(hex)) { colorMap.set(hex, materialColors.length); materialColors.push(hex); } };
  if (anyColour) {
    const used = new Set<string>();
    for (let i = 0; i < parts.length; i++) { const tc = parts[i].mesh.triColors; if (tc) for (const t of cleaned[i].validTris) used.add(triColorHex(tc, t)); }
    for (const slot of listFilaments()) { const hex = slot.hex.toLowerCase(); if (used.has(hex)) pushMaterial(hex); }
    for (let i = 0; i < parts.length; i++) { const tc = parts[i].mesh.triColors; if (tc) for (const t of cleaned[i].validTris) pushMaterial(triColorHex(tc, t)); }
  }

  // Colorgroup id: distinct from object ids. Generic uses one shared model so it
  // must dodge object ids 1..N; Bambu puts one object per file so a small const
  // is safe (it only shares a file with mesh id 100+i).
  const colorGroupId = bambu ? 2 : parts.length + 1;

  // ── Per-part geometry + colour ──────────────────────────────────────────
  const prepared: PreparedPart[] = parts.map((part, i) => {
    const { mesh } = part;
    const { remap, uniquePositions, validTris } = cleaned[i];
    const tc = anyColour ? mesh.triColors ?? null : null;

    const numV = uniquePositions.length / 3;
    let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity;
    const vertices: string[] = [];
    for (let v = 0; v < numV; v++) {
      const x = uniquePositions[v * 3], y = uniquePositions[v * 3 + 1], z = uniquePositions[v * 3 + 2];
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (z < minZ) minZ = z;
      vertices.push(`          <vertex x="${fmtCoord(x)}" y="${fmtCoord(y)}" z="${fmtCoord(z)}" />`);
    }

    // Dominant colour → object extruder (global 1-based filament index).
    let extruder = 1;
    if (tc) {
      const counts = new Map<number, number>();
      for (const t of validTris) { const idx = colorMap.get(triColorHex(tc, t)) ?? 0; counts.set(idx, (counts.get(idx) ?? 0) + 1); }
      let best = 0, bestN = -1;
      for (const [idx, n] of counts) if (n > bestN) { bestN = n; best = idx; }
      extruder = best + 1;
    }

    const triangles: string[] = [];
    for (const t of validTris) {
      const v1 = remap[mesh.triVerts[t * 3]], v2 = remap[mesh.triVerts[t * 3 + 1]], v3 = remap[mesh.triVerts[t * 3 + 2]];
      if (tc) {
        const matIdx = colorMap.get(triColorHex(tc, t)) ?? 0;
        // Bambu only: per-triangle filament via paint_color (omitted where it
        // matches the object's base extruder). Generic relies on pid/p1 alone.
        const paint = bambu && (matIdx + 1) !== extruder ? ` paint_color="${encodePaintColorState(matIdx + 1)}"` : '';
        triangles.push(`          <triangle v1="${v1}" v2="${v2}" v3="${v3}" pid="${colorGroupId}" p1="${matIdx}" p2="${matIdx}" p3="${matIdx}"${paint} />`);
      } else {
        triangles.push(`          <triangle v1="${v1}" v2="${v2}" v3="${v3}" />`);
      }
    }

    const cx = Number.isFinite(minX) ? (minX + maxX) / 2 : 0;
    const cy = Number.isFinite(minY) ? (minY + maxY) / 2 : 0;
    return {
      name: part.name, vertices, triangles, faceCount: validTris.length, extruder,
      cx, cy, minZ: Number.isFinite(minZ) ? minZ : 0,
      width: Number.isFinite(minX) ? maxX - minX : 0, depth: Number.isFinite(minY) ? maxY - minY : 0,
    };
  });

  const colorgroupXml = anyColour
    ? `    <m:colorgroup id="${colorGroupId}">\n${materialColors.map(h => `      <m:color color="${h.toUpperCase()}FF" />`).join('\n')}\n    </m:colorgroup>`
    : '';

  const built = bambu
    ? buildBambuPackage(prepared, colorgroupXml, anyColour, colorGroupId)
    : buildGenericPackage(prepared, colorgroupXml, anyColour, colorGroupId, gridGap);

  const mimeType = 'application/vnd.ms-package.3dmanufacturing';
  return { blob: new Blob([built], { type: mimeType }), filename: getExportFilename('3mf', opts.customName), mimeType };
}

// ── Generic: single inline model, parts grid-arranged ─────────────────────
function buildGenericPackage(prepared: PreparedPart[], colorgroupXml: string, anyColour: boolean, _cgid: number, gridGap: number): Uint8Array {
  const N = prepared.length;
  const cols = Math.ceil(Math.sqrt(N));
  const rows = Math.ceil(N / cols);
  const pitch = Math.max(1, ...prepared.map(p => Math.max(p.width, p.depth))) + gridGap;

  const objectsXml = prepared.map((p, i) => `    <object id="${i + 1}" type="model">
      <mesh>
        <vertices>
${p.vertices.join('\n')}
        </vertices>
        <triangles>
${p.triangles.join('\n')}
        </triangles>
      </mesh>
    </object>`).join('\n');

  const buildItems = prepared.map((p, i) => {
    const col = i % cols, row = Math.floor(i / cols);
    const cellX = col * pitch - (cols - 1) * pitch / 2;
    const cellY = row * pitch - (rows - 1) * pitch / 2;
    return `    <item objectid="${i + 1}" transform="1 0 0 0 1 0 0 0 1 ${fmtCoord(cellX - p.cx)} ${fmtCoord(cellY - p.cy)} ${fmtCoord(-p.minZ)}" printable="1" />`;
  }).join('\n');

  const matNs = anyColour ? ` xmlns:m="${MAT_NS}"` : '';
  const title = escXml(getExportTitle());
  const today = new Date().toISOString().slice(0, 10);
  const modelXml = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="${get3MFUnitString()}" xml:lang="en-US" xmlns="${CORE_NS}"${matNs}>
  <metadata name="Application">Partwright (https://www.partwrightstudio.com)</metadata>
  <metadata name="Title">${title}</metadata>
  <metadata name="CreationDate">${today}</metadata>
  <resources>${anyColour ? '\n' + colorgroupXml : ''}
${objectsXml}
  </resources>
  <build>
${buildItems}
  </build>
</model>`;

  const contentTypes = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml" />
  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml" />
</Types>`;
  const rels = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="${REL_TYPE}" />
</Relationships>`;
  return buildZip([
    { name: '[Content_Types].xml', data: enc(contentTypes) },
    { name: '_rels/.rels', data: enc(rels) },
    { name: '3D/3dmodel.model', data: enc(modelXml) },
  ]);
}

// ── Bambu/Orca: production-extension split files, one plate per part ──────
function buildBambuPackage(prepared: PreparedPart[], colorgroupXml: string, anyColour: boolean, cgid: number): Uint8Array {
  const unit = get3MFUnitString();
  const matNs = anyColour ? ` xmlns:m="${MAT_NS}"` : '';
  const pidAttr = anyColour ? ` pid="${cgid}" pindex="0"` : '';
  const cgBlock = anyColour ? `\n${colorgroupXml}` : '';

  const objectFiles: { name: string; data: Uint8Array }[] = [];
  const wrapperObjects: string[] = [];
  const buildItems: string[] = [];
  const objRels: string[] = [];
  const settingsObjects: string[] = [];
  const settingsPlates: string[] = [];

  prepared.forEach((p, i) => {
    const wrapperId = i + 1;
    const meshId = 100 + i;
    const partFile = `3D/Objects/object_${meshId}.model`;

    // Per-part object file: full model carrying the actual mesh (+ colorgroup).
    const meshUuid = `${String(i).padStart(4, '0')}0000-81cb-4c03-9d28-80fed5dfa1dc`;
    const partModel = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="${unit}" xml:lang="en-US" xmlns="${CORE_NS}" xmlns:BambuStudio="${BBS_NS}" xmlns:p="${PROD_NS}"${matNs} requiredextensions="p">
 <metadata name="BambuStudio:3mfVersion">1</metadata>
 <resources>${cgBlock}
  <object id="${meshId}" p:UUID="${meshUuid}" type="model"${pidAttr}>
   <mesh>
    <vertices>
${p.vertices.join('\n')}
    </vertices>
    <triangles>
${p.triangles.join('\n')}
    </triangles>
   </mesh>
  </object>
 </resources>
 <build/>
</model>`;
    objectFiles.push({ name: partFile, data: enc(partModel) });

    const wrapperUuid = `${String(wrapperId).padStart(8, '0')}-61cb-4c03-9d28-80fed5dfa1dc`;
    const compUuid = `${String(wrapperId).padStart(4, '0')}${String(meshId).padStart(4, '0')}-b206-40ff-9872-83e8017abed1`;
    wrapperObjects.push(`  <object id="${wrapperId}" p:UUID="${wrapperUuid}" type="model">
   <components>
    <component p:path="/${partFile}" objectid="${meshId}" p:UUID="${compUuid}" transform="1 0 0 0 1 0 0 0 1 0 0 0"/>
   </components>
  </object>`);

    // Place each part in its own plate slot (2-col grid) and rest it on z=0.
    const col = i % 2, row = i >> 1;
    const tx = PLATE_OFFSET + col * PLATE_STRIDE;
    const ty = PLATE_OFFSET - row * PLATE_STRIDE;
    const itemUuid = `${String(wrapperId).padStart(8, '0')}-b1ec-4553-aec9-835e5b724bb4`;
    buildItems.push(`  <item objectid="${wrapperId}" p:UUID="${itemUuid}" transform="1 0 0 0 1 0 0 0 1 ${fmtCoord(tx - p.cx)} ${fmtCoord(ty - p.cy)} ${fmtCoord(-p.minZ)}" printable="1"/>`);

    objRels.push(`  <Relationship Target="/${partFile}" Id="relObj${i}" Type="${REL_TYPE}"/>`);

    const safeName = escXml(p.name);
    settingsObjects.push(`  <object id="${wrapperId}">
    <metadata key="name" value="${safeName}"/>
    <metadata key="extruder" value="${p.extruder}"/>
  </object>`);
    // NOTE: plater_name MUST be empty — a non-empty value makes Bambu/Orca's
    // project loader reject the file (load fails, single plate). The part name
    // already rides on the <object> name; the plate is named by the slicer.
    settingsPlates.push(`  <plate>
    <metadata key="plater_id" value="${i + 1}"/>
    <metadata key="plater_name" value=""/>
    <metadata key="locked" value="false"/>
    <model_instance>
      <metadata key="object_id" value="${wrapperId}"/>
      <metadata key="instance_id" value="0"/>
    </model_instance>
  </plate>`);
  });

  const today = new Date().toISOString().slice(0, 10);
  const title = escXml(getExportTitle());
  const rootModel = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="${unit}" xml:lang="en-US" xmlns="${CORE_NS}" xmlns:BambuStudio="${BBS_NS}" xmlns:p="${PROD_NS}" requiredextensions="p">
 <metadata name="Application">BambuStudio-02.00.00.00</metadata>
 <metadata name="BambuStudio:3mfVersion">1</metadata>
 <metadata name="Title">${title}</metadata>
 <metadata name="CreationDate">${today}</metadata>
 <resources>
${wrapperObjects.join('\n')}
 </resources>
 <build p:UUID="2c7c17d8-22b5-4d84-8835-197602200001">
${buildItems.join('\n')}
 </build>
</model>`;

  const objRelsXml = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${objRels.join('\n')}
</Relationships>`;

  const modelSettings = `<?xml version="1.0" encoding="UTF-8"?>
<config>
${settingsObjects.join('\n')}
${settingsPlates.join('\n')}
</config>`;

  // Minimal project_settings.config — REQUIRED so the project loader builds the
  // plate list (it falls back to a single plate when no recognized config key
  // loads). These 5 keys make the config non-empty WITHOUT naming presets that
  // trip the "customized presets / confirm G-code" warning, and include
  // filament_diameter-adjacent keys the loader dereferences. Validated headless.
  const projectSettings = JSON.stringify({
    filament_settings_id: ['Bambu PLA Basic @BBL P1P'],
    nozzle_diameter: ['0.4'],
    print_settings_id: '0.20mm Standard @BBL N1',
    printable_area: ['0x0', '180x0', '180x180', '0x180'],
    printable_height: '180',
    printer_settings_id: 'Bambu Lab N1 0.4 nozzle',
  }, null, 2);

  // NOTE: no `config` content-type Default — the reference Bambu format omits it
  // (the loader finds .config files by path), and including it broke loading.
  const contentTypes = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
</Types>`;
  const rootRels = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="${REL_TYPE}"/>
</Relationships>`;

  const empty = new Uint8Array(0);
  return buildZip([
    { name: '[Content_Types].xml', data: enc(contentTypes) },
    { name: '3D/', data: empty },
    { name: '3D/Objects/', data: empty },
    { name: '3D/_rels/', data: empty },
    { name: 'Metadata/', data: empty },
    { name: '_rels/', data: empty },
    { name: '_rels/.rels', data: enc(rootRels) },
    { name: '3D/3dmodel.model', data: enc(rootModel) },
    ...objectFiles,
    { name: '3D/_rels/3dmodel.model.rels', data: enc(objRelsXml) },
    { name: 'Metadata/model_settings.config', data: enc(modelSettings) },
    { name: 'Metadata/project_settings.config', data: enc(projectSettings) },
  ]);
}
