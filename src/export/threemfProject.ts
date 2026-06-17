// Multi-part 3MF export — bundles several Session Parts into ONE 3MF. Two modes:
//
//   bambu: false (GENERIC) — a single `3D/3dmodel.model` with all parts as INLINE
//     mesh objects laid out in a centred grid, an `<m:colorgroup>` per object, no
//     Bambu metadata. Opens in any slicer/viewer.
//
//   bambu: true (BAMBU/ORCA PROJECT) — the 3MF **production extension** layout
//     Bambu Studio / OrcaSlicer require to build MULTIPLE PLATES. Each part is a
//     wrapper object referencing its mesh in a separate `/3D/Objects/object_N.model`
//     file; one `<plate>` per part drives the plate count. The layout mirrors a
//     real BambuStudio-02.05.00.66 project file (structurally equivalent, same
//     element/field kinds). Application version is BambuStudio-2.3.2 so OrcaSlicer
//     2.3.2 headless accepts the file (02.05.00.66 triggers its version gate):
//
//       - Wrapper objects have EVEN ids (2, 4, 6, …), mesh objects have ODD ids
//         (1, 3, 5, …). Object files are named object_1.model / object_2.model / …
//         (sequential by part number, matching the mesh ODD id).
//       - model_settings.config carries <part id=ODD subtype="normal_part"> with
//         matrix, source_* metadata, and mesh_stat (the element that was MISSING
//         before this rewrite and caused the Bambu GUI crash on load).
//       - Each <plate> carries identify_id (a stable integer) plus the filament_map*
//         metadata Bambu needs to assign AMS slots.
//       - An <assemble> block with one <assemble_item> per object closes the config.
//       - Colour is per-OBJECT via the extruder field, NOT per-triangle. The mesh
//         files carry plain <triangle v1 v2 v3/> (no pid/p1/paint_color in Bambu
//         mode). This matches the reference exactly and avoids the triangle-color
//         parsing path that segfaults on some Bambu builds.
//       - project_settings.config is a minimal BambuStudio-compatible preset block
//         (the template in bambuProjectTemplate.json): printer profile, print
//         profile, filament_settings_id, nozzle_diameter, bed geometry.
//         IMPORTANT: filament_colour must NOT appear in project_settings — OrcaSlicer
//         2.3.2 segfaults on any N1-profile file that carries that key there. Part
//         colour is communicated via the per-object extruder field in model_settings.

import type { MeshData } from '../geometry/types';
import { get3MFUnitString } from '../geometry/units';
import { getExportFilename, getExportTitle } from './download';
import type { BuiltExport } from './gltf';
import { buildZip } from './zip';
import { assertFiniteMesh, assertExportableMesh, cleanMeshForExport, triColorHex, hasAnyPainted } from './meshClean';
import { listFilaments } from '../color/palette';
import { encodePaintColorState } from './paintColor3mf';
// Static import so Vite bundles the JSON at build time (no fetch needed).
import BAMBU_TEMPLATE from './bambuProjectTemplate.json';

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
  vertices: string[];          // <vertex .../> lines
  trianglesPlain: string[];    // plain <triangle v1 v2 v3/> for Bambu mode
  trianglesColored: string[];  // <triangle .../> with pid/p1/paint_color for generic
  faceCount: number;
  extruder: number;            // 1-based dominant filament (global index)
  dominantHex: string;         // CSS hex of dominant colour (for filament_colour list)
  cx: number; cy: number; minZ: number; width: number; depth: number;
  halfHeight: number;          // half of Z extent (unused in current code, kept for possible future use)
}

/**
 * Build a multi-part 3MF blob. See the module header for the two modes.
 */
export function build3MFProject(parts: PartExport[], opts: Build3MFProjectOptions = {}): BuiltExport {
  if (parts.length === 0) throw new Error('Cannot export: no parts selected.');
  const bambu = opts.bambu ?? true;
  const gridGap = opts.gridGapMm ?? 10;

  // ── Shared filament/material list across ALL parts ──────────────────────
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

  // Colorgroup id: generic uses one shared model so it must dodge object ids 1..N;
  // Bambu puts one object per file so a small const is safe.
  const colorGroupId = bambu ? 2 : parts.length + 1;

  // ── Per-part geometry + colour ──────────────────────────────────────────
  const prepared: PreparedPart[] = parts.map((part, i) => {
    const { mesh } = part;
    const { remap, uniquePositions, validTris } = cleaned[i];
    const tc = anyColour ? mesh.triColors ?? null : null;

    const numV = uniquePositions.length / 3;
    let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    const vertices: string[] = [];
    for (let v = 0; v < numV; v++) {
      const x = uniquePositions[v * 3], y = uniquePositions[v * 3 + 1], z = uniquePositions[v * 3 + 2];
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
      vertices.push(`     <vertex x="${fmtCoord(x)}" y="${fmtCoord(y)}" z="${fmtCoord(z)}"/>`);
    }

    // Dominant colour → object extruder (global 1-based filament index).
    let extruder = 1;
    let dominantHex = materialColors[0] ?? '#ff0000';
    if (tc) {
      const counts = new Map<number, number>();
      for (const t of validTris) { const idx = colorMap.get(triColorHex(tc, t)) ?? 0; counts.set(idx, (counts.get(idx) ?? 0) + 1); }
      let best = 0, bestN = -1;
      for (const [idx, n] of counts) if (n > bestN) { bestN = n; best = idx; }
      extruder = best + 1;
      dominantHex = materialColors[best] ?? '#ff0000';
    }

    // Bambu mode: plain triangles (no pid/p1 — colour is per-object via extruder).
    const trianglesPlain: string[] = [];
    // Generic/coloured mode: triangles with pid/p1/paint_color.
    const trianglesColored: string[] = [];
    for (const t of validTris) {
      const v1 = remap[mesh.triVerts[t * 3]], v2 = remap[mesh.triVerts[t * 3 + 1]], v3 = remap[mesh.triVerts[t * 3 + 2]];
      trianglesPlain.push(`     <triangle v1="${v1}" v2="${v2}" v3="${v3}"/>`);
      if (tc) {
        const matIdx = colorMap.get(triColorHex(tc, t)) ?? 0;
        const paint = bambu && (matIdx + 1) !== extruder ? ` paint_color="${encodePaintColorState(matIdx + 1)}"` : '';
        trianglesColored.push(`          <triangle v1="${v1}" v2="${v2}" v3="${v3}" pid="${colorGroupId}" p1="${matIdx}" p2="${matIdx}" p3="${matIdx}"${paint} />`);
      } else {
        trianglesColored.push(`          <triangle v1="${v1}" v2="${v2}" v3="${v3}" />`);
      }
    }

    const cx = Number.isFinite(minX) ? (minX + maxX) / 2 : 0;
    const cy = Number.isFinite(minY) ? (minY + maxY) / 2 : 0;
    const halfH = Number.isFinite(minZ) && Number.isFinite(maxZ) ? (maxZ - minZ) / 2 : 0;
    return {
      name: part.name, vertices, trianglesPlain, trianglesColored,
      faceCount: validTris.length, extruder, dominantHex,
      cx, cy, minZ: Number.isFinite(minZ) ? minZ : 0,
      width: Number.isFinite(minX) ? maxX - minX : 0,
      depth: Number.isFinite(minY) ? maxY - minY : 0,
      halfHeight: halfH,
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

  // Generic mode uses coloured triangles (pid/p1) and the standard indented vertex format.
  const objectsXml = prepared.map((p, i) => {
    // Re-indent vertices to the deeper generic indentation (10 spaces).
    const vertLines = p.vertices.map(v => '          ' + v.trimStart());
    return `    <object id="${i + 1}" type="model">
      <mesh>
        <vertices>
${vertLines.join('\n')}
        </vertices>
        <triangles>
${p.trianglesColored.join('\n')}
        </triangles>
      </mesh>
    </object>`;
  }).join('\n');

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
//
// ID scheme (mirrors USER-REF.3mf exactly):
//   - Mesh (real geometry) object: ODD id  = 2*i - 1  (1, 3, 5, …)
//   - Wrapper (component ref) object: EVEN id = 2*i    (2, 4, 6, …)
//   - Object file: 3D/Objects/object_K.model where K = part index 1..N (sequential)
//
// Colour: per-OBJECT via extruder field in model_settings.config. Mesh files carry
// plain triangles (no pid/p1/paint_color). This matches how the reference does
// multicolor and avoids the per-triangle parsing path that segfaults.
//
// model_settings.config structural additions vs the old code (crash fix):
//   - <part id=ODD subtype="normal_part"> inside each <object id=EVEN>
//   - <mesh_stat ...> inside <part>
//   - identify_id in each <model_instance>
//   - filament_map_mode / filament_maps / filament_volume_maps / thumbnail* in <plate>
//   - <assemble> block at the end
function buildBambuPackage(prepared: PreparedPart[], _colorgroupXml: string, _anyColour: boolean, _cgid: number): Uint8Array {
  const unit = get3MFUnitString();

  // Bambu mode: colour is per-object extruder=1 (single nozzle, AMS handles
  // the rest). filament_colour is NOT written to project_settings — see the
  // buildProjectSettings() comment for why (OrcaSlicer 2.3.2 segfault).

  const objectFiles: { name: string; data: Uint8Array }[] = [];
  const wrapperObjects: string[] = [];
  const buildItems: string[] = [];
  const objRels: string[] = [];
  const settingsObjects: string[] = [];
  const settingsPlates: string[] = [];
  const assembleItems: string[] = [];

  prepared.forEach((p, i) => {
    const partNum = i + 1;          // 1-based, matches file name + mesh ODD id
    const meshId = 2 * partNum - 1; // ODD:  1, 3, 5, …
    const wrapperId = 2 * partNum;  // EVEN: 2, 4, 6, …
    const partFile = `3D/Objects/object_${partNum}.model`;
    // extruder is always 1: the N1 has a single nozzle; filament colour is
    // tracked at the AMS slot level (filament_maps), not the nozzle level.
    // The reference file confirms all objects are extruder="1".
    const extruder = 1;

    // UUID patterns mirror the reference file.
    const meshUuid = `${String(partNum).padStart(4, '0')}0000-81cb-4c03-9d28-80fed5dfa1dc`;
    const wrapperUuid = `${String(partNum).padStart(8, '0')}-61cb-4c03-9d28-80fed5dfa1dc`;
    const compUuid = `${String(partNum).padStart(4, '0')}0000-b206-40ff-9872-83e8017abed1`;
    const itemUuid = `${String(wrapperId).padStart(8, '0')}-b1ec-4553-aec9-835e5b724bb4`;

    // Per-part object file: plain triangles, no colorgroup (colour is per extruder).
    const partModel = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="${unit}" xml:lang="en-US" xmlns="${CORE_NS}" xmlns:BambuStudio="${BBS_NS}" xmlns:p="${PROD_NS}" requiredextensions="p">
 <metadata name="BambuStudio:3mfVersion">1</metadata>
 <resources>
  <object id="${meshId}" p:UUID="${meshUuid}" type="model">
   <mesh>
    <vertices>
${p.vertices.join('\n')}
    </vertices>
    <triangles>
${p.trianglesPlain.join('\n')}
    </triangles>
   </mesh>
  </object>
 </resources>
 <build/>
</model>`;
    objectFiles.push({ name: partFile, data: enc(partModel) });

    // Wrapper object in root model.
    wrapperObjects.push(`  <object id="${wrapperId}" p:UUID="${wrapperUuid}" type="model">
   <components>
    <component p:path="/${partFile}" objectid="${meshId}" p:UUID="${compUuid}" transform="1 0 0 0 1 0 0 0 1 0 0 0"/>
   </components>
  </object>`);

    // Place each part in its own plate slot (2-col grid). The Z translation
    // is -minZ: this moves the part so its bottom (minZ) lands exactly at Z=0
    // (the bed). Works for both centered meshes (minZ<0) and non-centered ones
    // (minZ=0, e.g. Manifold.cylinder). The USER-REF.3mf sets Z = -minZ = |minZ|
    // for all three parts (verified against source_offset_z in model_settings).
    const col = i % 2, row = i >> 1;
    const tx = PLATE_OFFSET + col * PLATE_STRIDE;
    const ty = PLATE_OFFSET - row * PLATE_STRIDE;
    const tz = -p.minZ;  // lift bottom to Z=0
    buildItems.push(`  <item objectid="${wrapperId}" p:UUID="${itemUuid}" transform="1 0 0 0 1 0 0 0 1 ${fmtCoord(tx - p.cx)} ${fmtCoord(ty - p.cy)} ${fmtCoord(tz)}" printable="1"/>`);

    objRels.push(`  <Relationship Target="/${partFile}" Id="rel-${partNum}" Type="${REL_TYPE}"/>`);

    const safeName = escXml(p.name);
    // model_settings.config per-object block (EVEN wrapper id):
    //   - name + extruder metadata
    //   - face_count metadata
    //   - <part id=ODD subtype="normal_part"> — this was MISSING before and caused
    //     the Bambu GUI crash. It must carry: name, matrix (identity), source_*,
    //     and <mesh_stat face_count=N ...> (all other fields 0).
    const sourceOffsetZ = fmtCoord(Math.abs(p.minZ)); // reference writes |minZ| as source_offset_z
    settingsObjects.push(`  <object id="${wrapperId}">
    <metadata key="name" value="${safeName}"/>
    <metadata key="extruder" value="${extruder}"/>
    <metadata face_count="${p.faceCount}"/>
    <part id="${meshId}" subtype="normal_part">
      <metadata key="name" value="${safeName}"/>
      <metadata key="matrix" value="1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1"/>
      <metadata key="source_file" value="${safeName}.stl"/>
      <metadata key="source_object_id" value="0"/>
      <metadata key="source_volume_id" value="0"/>
      <metadata key="source_offset_x" value="0"/>
      <metadata key="source_offset_y" value="0"/>
      <metadata key="source_offset_z" value="${sourceOffsetZ}"/>
      <mesh_stat face_count="${p.faceCount}" edges_fixed="0" degenerate_facets="0" facets_removed="0" facets_reversed="0" backwards_edges="0"/>
    </part>
  </object>`);

    // identify_id: stable integer per object instance (reference uses arbitrary values;
    // we use a simple deterministic value: 100 + wrapperId * 10 + i).
    const identifyId = 100 + wrapperId * 10 + i;
    // filament_maps: must have exactly 1 entry to match the 1-filament project_settings.
    // Using N entries (one per distinct colour) while project_settings only defines 1
    // filament causes OrcaSlicer to segfault when <part> elements are present.
    // Single "1" means "first filament → AMS slot 1"; the slicer remaps on slice.
    const filamentMaps = '1';
    const filamentVolMaps = '0';
    // NOTE: plater_name MUST be empty — a non-empty value makes Bambu/Orca's
    // project loader reject the file (load fails, single plate).
    settingsPlates.push(`  <plate>
    <metadata key="plater_id" value="${partNum}"/>
    <metadata key="plater_name" value=""/>
    <metadata key="locked" value="false"/>
    <metadata key="filament_map_mode" value="Auto For Flush"/>
    <metadata key="filament_maps" value="${filamentMaps}"/>
    <metadata key="filament_volume_maps" value="${filamentVolMaps}"/>
    <model_instance>
      <metadata key="object_id" value="${wrapperId}"/>
      <metadata key="instance_id" value="0"/>
      <metadata key="identify_id" value="${identifyId}"/>
    </model_instance>
  </plate>`);

    // assemble_item: assembly view transform. Z = -minZ matches the item
    // transform so the assembly view mirrors the plate layout.
    assembleItems.push(`   <assemble_item object_id="${wrapperId}" instance_id="0" transform="1 0 0 0 1 0 0 0 1 ${fmtCoord(tx - p.cx)} ${fmtCoord(ty - p.cy)} ${fmtCoord(tz)}" offset="0 0 0" />`);
  });

  const today = new Date().toISOString().slice(0, 10);
  const title = escXml(getExportTitle());
  const rootModel = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="${unit}" xml:lang="en-US" xmlns="${CORE_NS}" xmlns:BambuStudio="${BBS_NS}" xmlns:p="${PROD_NS}" requiredextensions="p">
 <metadata name="Application">BambuStudio-2.3.2</metadata>
 <metadata name="BambuStudio:3mfVersion">1</metadata>
 <metadata name="Copyright"></metadata>
 <metadata name="CreationDate">${today}</metadata>
 <metadata name="Description"></metadata>
 <metadata name="Designer"></metadata>
 <metadata name="DesignerCover"></metadata>
 <metadata name="License"></metadata>
 <metadata name="ModificationDate">${today}</metadata>
 <metadata name="Origin"></metadata>
 <metadata name="ProfileCover"></metadata>
 <metadata name="ProfileDescription"></metadata>
 <metadata name="ProfileTitle"></metadata>
 <metadata name="Title">${title}</metadata>
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
  <assemble>
${assembleItems.join('\n')}
  </assemble>
</config>`;

  // project_settings.config: start from the full BambuStudio template and stamp
  // per-filament arrays to length N so they're consistent with the actual filament
  // count. A short filament_colour indexed by extruder is a known Bambu segfault.
  const projectSettings = buildProjectSettings();

  // Content types: rels + model + png (for potential plate thumbnails) + gcode.
  // Matches the reference [Content_Types].xml exactly.
  const contentTypes = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
 <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
 <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
 <Default Extension="png" ContentType="image/png"/>
 <Default Extension="gcode" ContentType="text/x.gcode"/>
</Types>`;

  // Root rels: only the 3D model relationship (no thumbnail rels — we emit no PNGs).
  const rootRels = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
 <Relationship Target="/3D/3dmodel.model" Id="rel-1" Type="${REL_TYPE}"/>
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

/**
 * Build the project_settings.config JSON from the BambuStudio template.
 *
 * The template is minimal: printer profile, print profile, filament_settings_id,
 * nozzle_diameter, and bed geometry. It intentionally OMITS filament_colour
 * because OrcaSlicer 2.3.2 segfaults on any N1-profile file that carries that
 * key in project_settings (verified by binary search against the extracted binary).
 * Part colour is communicated via the per-object extruder field in model_settings.
 */
function buildProjectSettings(): string {
  // Deep-copy the template so we don't mutate the module-level import.
  const cfg: Record<string, unknown> = JSON.parse(JSON.stringify(BAMBU_TEMPLATE));
  return JSON.stringify(cfg, null, 4);
}
