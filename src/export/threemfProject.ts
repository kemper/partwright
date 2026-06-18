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
//       - Colour: each object has a base extruder (its dominant AMS slot), and
//         triangles whose slot differs carry a per-triangle paint_color (Bambu's
//         MMU segmentation attribute) so hand-paint / api.label regions show WITHIN
//         a part. Colours map onto the 3 AMS slots the H2C config defines (no
//         m:colorgroup/pid/p1 here — that's the generic mode's material extension).
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

// Bambu assigns each object to a plate by WORLD POSITION (the plate-grid cell its
// footprint falls in), NOT by the model_instance binding (verified: stacking all
// parts at one point leaves the other plates empty → load rejected). So each part's
// <item> must sit at the CENTRE of the plate cell BambuStudio lays out. The grid is
// taken verbatim from BambuStudio's PartPlateList source (src/slic3r/GUI/PartPlate):
//   - COLUMNS: compute_colum_count(N) == ⌈√N⌉.
//   - STRIDE is PER-AXIS: plate_stride_x = width·(1+1/5), plate_stride_y = depth·(1+1/5)
//     (LOGICAL_PART_PLATE_GAP = 1/5). For the 330×320 H2C bed that's 396 / 384 mm —
//     NOT a single value, which is why a uniform 410 mm stride drifted parts right
//     (410>396) and forward (410>384), worse at higher plate indices.
//   - Plate origin is the cell CORNER (col·stride_x, −row·stride_y); the printable
//     area starts there, so the cell centre is origin + (bedW/2, bedH/2).
const PLATE_GAP_FACTOR = 1 + 1 / 5;   // BambuStudio LOGICAL_PART_PLATE_GAP
const plateGridCols = (n: number) => Math.max(1, Math.ceil(Math.sqrt(n)));

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

/** "#rrggbb" (any case, optional #) → Bambu's "#RRGGBB" form. */
function toBambuHex(hex: string): string { return '#' + hex.replace(/^#/, '').toUpperCase(); }
function hexRgb(hex: string): [number, number, number] {
  const h = hex.replace(/^#/, '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
/** Index of the palette colour nearest `hex` in RGB space (for >3-colour snap). */
function nearestSlotIndex(hex: string, palette: string[]): number {
  const [r, g, b] = hexRgb(hex);
  let best = 0, bestD = Infinity;
  palette.forEach((p, i) => {
    const [pr, pg, pb] = hexRgb(p);
    const d = (r - pr) ** 2 + (g - pg) ** 2 + (b - pb) ** 2;
    if (d < bestD) { bestD = d; best = i; }
  });
  return best;
}

const enc = (s: string) => new TextEncoder().encode(s);

interface PreparedPart {
  name: string;
  vertices: string[];          // <vertex .../> lines
  trianglesBambu: string[];    // <triangle v1 v2 v3 [paint_color=…]/> for Bambu mode
  trianglesColored: string[];  // <triangle .../> with pid/p1 for generic
  faceCount: number;
  extruder: number;            // 1-based base AMS slot (Bambu) / material index (generic)
  dominantHex: string;         // CSS hex of dominant colour
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

  // ── Bambu AMS palette: ≤3 filament slots from the most-used colours ─────────
  // Bambu colour is per-filament, and the H2C config defines exactly 3 filaments
  // (see buildProjectSettings — we never resize that array). Map every triangle
  // colour to one of 3 slots: the 3 most-frequent colours across all parts become
  // the slots; any others snap to the nearest. Each object's base extruder is its
  // dominant slot, and triangles whose slot differs carry a per-triangle
  // paint_color — so hand-painted brush marks and api.label regions WITHIN a part
  // survive in Bambu, not just the dominant colour. (>3 distinct colours collapse
  // to the nearest of 3; lifting that cap needs a validated config resize — #729.)
  const bambuSlotOf = new Map<string, number>();   // triColorHex → 0..2
  let bambuFilamentColors = ['#D9D9D9', '#D9D9D9', '#D9D9D9'];
  if (bambu && anyColour) {
    const freq = new Map<string, number>();
    for (let i = 0; i < parts.length; i++) {
      const t = parts[i].mesh.triColors;
      if (t) for (const tr of cleaned[i].validTris) { const h = triColorHex(t, tr); freq.set(h, (freq.get(h) ?? 0) + 1); }
    }
    const palette = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(e => e[0]);
    palette.forEach((h, idx) => bambuSlotOf.set(h, idx));
    for (const h of freq.keys()) if (!bambuSlotOf.has(h)) bambuSlotOf.set(h, nearestSlotIndex(h, palette));
    while (palette.length < 3) palette.push(palette[palette.length - 1] ?? '#d9d9d9');
    bambuFilamentColors = palette.map(toBambuHex);
  }

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

    // Dominant colour → object base extruder. Bambu uses the dominant AMS slot
    // (1..3); generic uses the global material index.
    let extruder = 1;
    let dominantHex = materialColors[0] ?? '#ff0000';
    if (tc) {
      const counts = new Map<number, number>();
      for (const t of validTris) {
        const idx = bambu ? (bambuSlotOf.get(triColorHex(tc, t)) ?? 0) : (colorMap.get(triColorHex(tc, t)) ?? 0);
        counts.set(idx, (counts.get(idx) ?? 0) + 1);
      }
      let best = 0, bestN = -1;
      for (const [idx, n] of counts) if (n > bestN) { bestN = n; best = idx; }
      extruder = best + 1;
      dominantHex = bambu ? (bambuFilamentColors[best] ?? '#ff0000') : (materialColors[best] ?? '#ff0000');
    }

    // Bambu mode: triangles carry a per-triangle paint_color when their AMS slot
    // differs from the object's base extruder (this is what makes hand-paint and
    // api.label regions show WITHIN a part); same-as-base triangles stay plain.
    const trianglesBambu: string[] = [];
    // Generic/coloured mode: triangles with pid/p1 (m:colorgroup material extension).
    const trianglesColored: string[] = [];
    for (const t of validTris) {
      const v1 = remap[mesh.triVerts[t * 3]], v2 = remap[mesh.triVerts[t * 3 + 1]], v3 = remap[mesh.triVerts[t * 3 + 2]];
      if (tc) {
        const slot = bambuSlotOf.get(triColorHex(tc, t)) ?? 0;
        const paint = (slot + 1) !== extruder ? ` paint_color="${encodePaintColorState(slot + 1)}"` : '';
        trianglesBambu.push(`     <triangle v1="${v1}" v2="${v2}" v3="${v3}"${paint}/>`);
        const matIdx = colorMap.get(triColorHex(tc, t)) ?? 0;
        trianglesColored.push(`          <triangle v1="${v1}" v2="${v2}" v3="${v3}" pid="${colorGroupId}" p1="${matIdx}" p2="${matIdx}" p3="${matIdx}" />`);
      } else {
        trianglesBambu.push(`     <triangle v1="${v1}" v2="${v2}" v3="${v3}"/>`);
        trianglesColored.push(`          <triangle v1="${v1}" v2="${v2}" v3="${v3}" />`);
      }
    }

    const cx = Number.isFinite(minX) ? (minX + maxX) / 2 : 0;
    const cy = Number.isFinite(minY) ? (minY + maxY) / 2 : 0;
    const halfH = Number.isFinite(minZ) && Number.isFinite(maxZ) ? (maxZ - minZ) / 2 : 0;
    return {
      name: part.name, vertices, trianglesBambu, trianglesColored,
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
    ? buildBambuPackage(prepared, bambuFilamentColors)
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
// Colour: object base extruder (dominant AMS slot) in model_settings.config, plus
// per-triangle paint_color in the mesh for triangles whose slot differs from the
// base — so painted regions within a part survive. Colours map onto 3 AMS slots.
//
// model_settings.config structural additions vs the old code (crash fix):
//   - <part id=ODD subtype="normal_part"> inside each <object id=EVEN>
//   - <mesh_stat ...> inside <part>
//   - identify_id in each <model_instance>
//   - filament_map_mode / filament_maps / filament_volume_maps / thumbnail* in <plate>
//   - <assemble> block at the end
function buildBambuPackage(prepared: PreparedPart[], filamentColors: string[]): Uint8Array {
  const unit = get3MFUnitString();
  const [bedW, bedH] = bedSizeFromTemplate();
  const gridCols = plateGridCols(prepared.length);  // ⌈√N⌉ to match Bambu's plate grid
  const strideX = bedW * PLATE_GAP_FACTOR;          // BambuStudio plate_stride_x (width·1.2)
  const strideY = bedH * PLATE_GAP_FACTOR;          // BambuStudio plate_stride_y (depth·1.2)

  // Bambu mode: each object's base colour is its `extruder` (dominant AMS slot,
  // 1..3), and per-triangle paint_color (built in build3MFProject) colours regions
  // within the part — so hand-paint and api.label survive, not just the dominant.
  // Slot colours go in project_settings' filament_colour; the complete H2C config
  // keeps all per-filament arrays sized to 3 so load_files binds without
  // null-derefing (the prior crash). >3 distinct colours snap to the nearest slot.

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
    // Per-object extruder = the part's AMS slot (1..3), assigned in build3MFProject
    // from its dominant colour. The reference confirms this field drives object
    // colour in Bambu; values >1 are the minimal extension of its all-"1" layout.
    const extruder = p.extruder;

    // UUID patterns mirror the reference file.
    const meshUuid = `${String(partNum).padStart(4, '0')}0000-81cb-4c03-9d28-80fed5dfa1dc`;
    const wrapperUuid = `${String(partNum).padStart(8, '0')}-61cb-4c03-9d28-80fed5dfa1dc`;
    const compUuid = `${String(partNum).padStart(4, '0')}0000-b206-40ff-9872-83e8017abed1`;
    const itemUuid = `${String(wrapperId).padStart(8, '0')}-b1ec-4553-aec9-835e5b724bb4`;

    // Per-part object file: triangles carry paint_color where the slot differs from
    // the base extruder (per-triangle colour); no m:colorgroup (that's generic mode).
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
${p.trianglesBambu.join('\n')}
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

    // Place each part at the CENTRE of its plate cell: cell-corner origin
    // (col·strideX, −row·strideY) plus half the bed, so the part sits dead-centre
    // on the plate Bambu lays out for that index. The Z translation is -minZ:
    // moves the part so its bottom (minZ) lands exactly at Z=0 (the bed). Works for
    // both centered meshes (minZ<0) and non-centered (minZ=0, e.g. Manifold.cylinder).
    const col = i % gridCols, row = Math.floor(i / gridCols);
    const tx = bedW / 2 + col * strideX;
    const ty = bedH / 2 - row * strideY;
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

  // project_settings.config: the complete H2C template with filament_colour set to
  // the part palette (see buildProjectSettings).
  const projectSettings = buildProjectSettings(filamentColors);

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
 * Build the project_settings.config JSON from the BambuStudio template, stamping
 * the part-colour palette into filament_colour.
 *
 * The template is a COMPLETE Bambu Lab H2C profile (536 keys, copied verbatim from
 * a real known-good project export). Completeness is load-critical: Bambu's GUI
 * `Plater::priv::load_files` indexes the per-filament arrays (filament_colour,
 * filament_type, filament_ids, filament_map, …) when binding objects to filaments,
 * and a partial config makes that index null-deref → SIGSEGV on project open. We
 * therefore only overwrite filament_colour's VALUES (keeping its length at 3, the
 * template's filament count) — never resize any array.
 */
function buildProjectSettings(filamentColors: string[]): string {
  // Deep-copy the template so we don't mutate the module-level import.
  const cfg: Record<string, unknown> = JSON.parse(JSON.stringify(BAMBU_TEMPLATE));
  const existing = cfg.filament_colour;
  if (Array.isArray(existing) && filamentColors.length === existing.length) {
    cfg.filament_colour = filamentColors;
  }
  return JSON.stringify(cfg, null, 4);
}
