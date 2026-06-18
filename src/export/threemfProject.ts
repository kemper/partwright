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
//     element/field kinds, same Application version) so Bambu Studio's GUI loader
//     accepts it without crashing:
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
//       - project_settings.config is a COMPLETE BambuStudio preset block (the
//         template in bambuProjectTemplate.json — a full Bambu Lab H2C profile,
//         536 keys). This is load-CRITICAL: Bambu's GUI `Plater::priv::load_files`
//         indexes the per-filament arrays (filament_colour, filament_type,
//         filament_ids, filament_map, …) when binding each object's extruder to a
//         filament. A *partial* config (we previously shipped 6 keys, omitting the
//         filament arrays) makes that lookup dereference null → SIGSEGV on project
//         open. The crash is intermittent because load_files runs on a wxIdleEvent
//         racing the background user-preset loader. (A macOS crash report pinned it:
//         null read in load_files with the string "filament" live in a register.)
//         The Bambu CLI's --slice path uses a DIFFERENT loader and never hit this,
//         which is why headless slicing passed while the GUI crashed. The fix is to
//         mirror a real, known-good H2C project's full config verbatim.
//         NOTE: this targets Bambu Studio (the H2C profile is real and complete).
//         OrcaSlicer 2.3.2 is NOT a valid proxy for Bambu's loader (the real
//         reference itself fails to slice in Orca yet opens fine in Bambu).

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

// Bambu assigns each object to a plate by WORLD POSITION (which plate-grid cell the
// object's footprint falls in), NOT by the model_instance binding. So each part's
// <item> must sit at the CENTRE of a distinct plate cell, or the slicer reports
// "Object … partly inside, can not be sliced" (when it straddles a cell boundary).
// Plates tile in a 2-column grid: cell (col,row) origin = (col·STRIDE_X, −row·STRIDE_Y),
// and we centre the part in its cell at (bedW/2, bedH/2) within that origin.
// STRIDE must match BambuStudio's actual plate grid for the declared printer; the
// real H2C reference export places its 3 plates ~410 mm apart. Derived empirically
// (Bambu CLI catches mis-placement) and from the reference.
const PLATE_GRID_COLS = 2;
const PLATE_STRIDE = 410;        // mm between plate-cell origins (H2C grid)

/** Bed printable size [w, h] mm, parsed from the project template's printable_area
 *  (a list of "XxY" corner strings). Falls back to the H2C bed if unparseable. */
function bedSizeFromTemplate(): [number, number] {
  const area = (BAMBU_TEMPLATE as { printable_area?: string[] }).printable_area;
  if (Array.isArray(area)) {
    let w = 0, h = 0;
    for (const corner of area) {
      const [x, y] = String(corner).split('x').map(Number);
      if (Number.isFinite(x) && x > w) w = x;
      if (Number.isFinite(y) && y > h) h = y;
    }
    if (w > 0 && h > 0) return [w, h];
  }
  return [330, 320];
}

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
  const [bedW, bedH] = bedSizeFromTemplate();

  // Bambu mode: SINGLE-COLOUR crash-fix base. Every object is on extruder 1; the
  // complete H2C project_settings.config defines 3 filaments so load_files can bind
  // without null-derefing. Per-part colour (distinct extruder per part + matching
  // filament_colour) is the tracked follow-up (#729) — it requires resizing the
  // per-filament arrays, which can't be validated against Bambu's GUI loader
  // headlessly, so it lands once this stable base is user-confirmed.

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
    // extruder is always 1 for now (single-colour base). The reference file
    // confirms all objects are extruder="1"; per-part extruder assignment is #729.
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

    // Place each part at the CENTRE of its own plate cell (2-col grid). Centring
    // (not corner-offsetting) keeps small parts well clear of cell boundaries so
    // Bambu's per-plate "is this object inside?" check passes. The Z translation
    // is -minZ: moves the part so its bottom (minZ) lands exactly at Z=0 (the bed).
    // Works for both centered meshes (minZ<0) and non-centered (minZ=0, e.g.
    // Manifold.cylinder). The USER-REF.3mf sets Z = -minZ for all parts.
    const col = i % PLATE_GRID_COLS, row = Math.floor(i / PLATE_GRID_COLS);
    const tx = bedW / 2 + col * PLATE_STRIDE;
    const ty = bedH / 2 - row * PLATE_STRIDE;
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
    // filament_maps / filament_volume_maps: one entry PER FILAMENT in
    // project_settings.config (the H2C template defines 3), NOT per object. The
    // reference uses "2 1 1" / "0 0 0" (filament→nozzle map for the dual-nozzle
    // H2C); we mirror it so the plate's filament list stays consistent with the
    // config — a length mismatch here is another way load_files indexes past the
    // end of a filament array.
    const filamentMaps = '2 1 1';
    const filamentVolMaps = '0 0 0';
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
 <metadata name="Application">BambuStudio-02.05.00.66</metadata>
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

  // project_settings.config: the complete H2C template (see buildProjectSettings).
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
 * The template is a COMPLETE Bambu Lab H2C profile (536 keys, copied verbatim from
 * a real known-good project export, with filament_colour neutralized to greys for
 * the single-colour base). Completeness is load-critical: Bambu's GUI
 * `Plater::priv::load_files` indexes the per-filament arrays (filament_colour,
 * filament_type, filament_ids, filament_map, …) when binding objects to filaments,
 * and a partial config makes that index null-deref → SIGSEGV on project open.
 */
function buildProjectSettings(): string {
  // Deep-copy the template so we don't mutate the module-level import.
  const cfg: Record<string, unknown> = JSON.parse(JSON.stringify(BAMBU_TEMPLATE));
  return JSON.stringify(cfg, null, 4);
}
