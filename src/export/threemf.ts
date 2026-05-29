import type { MeshData } from '../geometry/types';
import { get3MFUnitString } from '../geometry/units';
import { downloadBlob, getExportFilename, getExportTitle } from './download';
import type { BuiltExport } from './gltf';
import { buildZip } from './zip';
import { assertFiniteMesh, cleanMeshForExport, DEFAULT_COLOR_HEX, triColorHex, hasAnyPainted } from './meshClean';
import { paintColorForMaterial } from './bambuPaint';

/** Escape XML special chars for attribute values / text content. */
function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

interface ModelXmlResult {
  /** The full 3D/3dmodel.model XML — identical for the standard and Bambu writers. */
  modelXml: string;
  /** Distinct material colors in m:colorgroup order ('#rrggbb', lowercase). The
   *  index is the filament/extruder slot each triangle's `p1` points at. Empty
   *  when the model has no painted regions (a single uncolored object). */
  materialColors: string[];
}

/** Build the shared 3dmodel.model XML (vertices, triangles, optional
 *  m:colorgroup). Used verbatim by both {@link build3MF} (standard/portable)
 *  and {@link build3MFBambu} (which wraps the same model in Bambu project
 *  metadata). */
interface MeshExportCore {
  /** Deduplicated, remapped triangle indices plus the material slot each
   *  triangle resolves to (0 = the base/default color). */
  tris: { v1: number; v2: number; v3: number; matIdx: number }[];
  /** Flat xyz of deduplicated vertices (model space). */
  positions: ArrayLike<number>;
  /** Distinct colors in slot order — index 0 is the base/default color, 1+ are
   *  painted colors. Empty when the model has no painted regions. */
  materialColors: string[];
  /** True when the model carries painted regions. */
  hasColors: boolean;
  /** Axis-aligned bounds for plate placement (model space). */
  bbox: { cx: number; cy: number; minZ: number };
}

/** Shared mesh prep for both 3MF writers: dedup vertices, drop degenerate
 *  triangles, and resolve each surviving triangle to a material slot. The
 *  standard writer turns this into `m:colorgroup` + `pid`/`p1`; the Bambu writer
 *  turns it into `paint_color`. Keeping it in one place stops the two paths from
 *  drifting apart. */
function buildMeshCore(meshData: MeshData): MeshExportCore {
  const { triVerts, triColors } = meshData;
  const { remap, uniquePositions, validTris } = cleanMeshForExport(meshData);

  const hasColors = triColors != null && hasAnyPainted(triColors, validTris);
  const colorMap = new Map<string, number>(); // hex -> material slot
  const materialColors: string[] = [];
  if (hasColors && triColors) {
    colorMap.set(DEFAULT_COLOR_HEX, 0);
    materialColors.push(DEFAULT_COLOR_HEX);
    for (const t of validTris) {
      const hex = triColorHex(triColors, t);
      if (hex !== DEFAULT_COLOR_HEX && !colorMap.has(hex)) {
        colorMap.set(hex, materialColors.length);
        materialColors.push(hex);
      }
    }
  }

  const tris = validTris.map(t => ({
    v1: remap[triVerts[t * 3]],
    v2: remap[triVerts[t * 3 + 1]],
    v3: remap[triVerts[t * 3 + 2]],
    matIdx: hasColors && triColors ? (colorMap.get(triColorHex(triColors, t)) ?? 0) : 0,
  }));

  // Axis-aligned bounds for plate placement.
  const numVerts = uniquePositions.length / 3;
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < numVerts; i++) {
    const x = uniquePositions[i * 3], y = uniquePositions[i * 3 + 1], z = uniquePositions[i * 3 + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z;
  }
  const bbox = {
    cx: numVerts ? (minX + maxX) / 2 : 0,
    cy: numVerts ? (minY + maxY) / 2 : 0,
    minZ: numVerts ? minZ : 0,
  };

  return { tris, positions: uniquePositions, materialColors, hasColors, bbox };
}

function buildModelXml(meshData: MeshData): ModelXmlResult {
  const core = buildMeshCore(meshData);
  const { positions, materialColors, hasColors } = core;

  // Build vertices XML (deduplicated, 6dp precision)
  const numUniqueVerts = positions.length / 3;
  const vertices: string[] = [];
  for (let i = 0; i < numUniqueVerts; i++) {
    const x = positions[i * 3].toFixed(6);
    const y = positions[i * 3 + 1].toFixed(6);
    const z = positions[i * 3 + 2].toFixed(6);
    vertices.push(`          <vertex x="${x}" y="${y}" z="${z}" />`);
  }

  // Build triangles XML (remapped vertex indices, filtered for degenerates)
  const triangles = core.tris.map(t =>
    hasColors
      ? `          <triangle v1="${t.v1}" v2="${t.v2}" v3="${t.v3}" pid="2" p1="${t.matIdx}" />`
      : `          <triangle v1="${t.v1}" v2="${t.v2}" v3="${t.v3}" />`
  );

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

  const title = escapeXml(getExportTitle());

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

  return { modelXml, materialColors };
}

const CONTENT_TYPES_XML = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml" />
  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml" />
</Types>`;

const RELS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel" />
</Relationships>`;

const MIME_3MF = 'application/vnd.ms-package.3dmanufacturing';

/** Build a standard, portable 3MF export blob (no download). Geometry plus
 *  native color via the Microsoft material `m:colorgroup` extension — imports
 *  cleanly into Bambu Studio, OrcaSlicer, PrusaSlicer, etc. The 3MF format has
 *  no concept of filament *type*, so a slicer assigns each color a filament by
 *  its own rules (Bambu nearest-color-matches your existing presets, which is
 *  why types come in mixed). Use {@link build3MFBambu} for a Bambu project file
 *  that pins every filament to PLA. */
export function build3MF(meshData: MeshData, customName?: string): BuiltExport {
  assertFiniteMesh(meshData);
  const { modelXml } = buildModelXml(meshData);

  const enc = new TextEncoder();
  const zip = buildZip([
    { name: '[Content_Types].xml', data: enc.encode(CONTENT_TYPES_XML) },
    { name: '_rels/.rels', data: enc.encode(RELS_XML) },
    { name: '3D/3dmodel.model', data: enc.encode(modelXml) },
  ]);

  const blob = new Blob([zip], { type: MIME_3MF });
  return { blob, filename: getExportFilename('3mf', customName), mimeType: MIME_3MF };
}

export function export3MF(meshData: MeshData, customName?: string): string {
  const built = build3MF(meshData, customName);
  downloadBlob(built.blob, built.filename, '3MF');
  return built.filename;
}

// --- Bambu Studio project variant ------------------------------------------
//
// A *standard* 3MF carries color but no filament *type*, so Bambu Studio /
// OrcaSlicer guess a type per color by nearest-matching the user's existing
// presets — which is why colors come in as a mix of PLA/ABS. Bambu only honors
// declared filaments when it recognizes the file as one of its own *projects*,
// and that takes more than dropping in a config file — the whole package has to
// look like a Bambu project. So this writer emits the full Bambu shape:
//
//   • 3D/3dmodel.model               production-extension root with the
//                                    `BambuStudio:3mfVersion` marker + a
//                                    <component> into a separate object part
//   • 3D/Objects/object_1.model      the mesh; per-triangle color rides in
//                                    Bambu's `paint_color` MMU bitstream (see
//                                    bambuPaint.ts), not `m:colorgroup`
//   • Metadata/model_settings.config object/part wiring (default extruder)
//   • Metadata/project_settings.config  one PLA filament per color slot
//   • Metadata/slice_info.config     minimal (unsliced) header
//
// project_settings.config declares only filaments (no printer/process keys), so
// opening the file loads the all-PLA list against the user's *current* printer
// rather than clobbering their machine setup. Painted color slot m maps to
// extruder (m+1); the base/default slot (0) is the part's default extruder (1)
// and carries no paint_color. Reverse-engineered from a real Bambu project
// (BambuStudio 02.05) — the format is proprietary and version sensitive, so a
// broken import is a sign Bambu's shape has shifted.

const BAMBU_GENERIC_PLA_ID = 'GFL99';      // Bambu/Orca "Generic PLA" filament_id
const BAMBU_GENERIC_PLA_NAME = 'Generic PLA';
const BAMBU_VERSION = '02.05.00.66';       // BambuStudio version this shape mirrors

/** RFC-4122-ish UUID for the production-extension `p:UUID` attributes. Uses the
 *  platform RNG when present, else a Math.random fallback (these IDs only need
 *  to be unique within the package, not cryptographically strong). */
function bambuUuid(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, ch => {
    const r = (Math.random() * 16) | 0;
    return (ch === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/** The mesh part (3D/Objects/object_1.model): plain vertices + triangles, each
 *  painted triangle carrying a `paint_color` bitstream. Base-color triangles
 *  are left bare so they print with the part's default extruder. */
function buildBambuObjectModel(core: MeshExportCore): string {
  const { positions } = core;
  const numVerts = positions.length / 3;
  const vertices: string[] = [];
  for (let i = 0; i < numVerts; i++) {
    vertices.push(`     <vertex x="${positions[i * 3].toFixed(6)}" y="${positions[i * 3 + 1].toFixed(6)}" z="${positions[i * 3 + 2].toFixed(6)}"/>`);
  }
  const triangles = core.tris.map(t => {
    const pc = paintColorForMaterial(t.matIdx);
    return pc
      ? `     <triangle v1="${t.v1}" v2="${t.v2}" v3="${t.v3}" paint_color="${pc}"/>`
      : `     <triangle v1="${t.v1}" v2="${t.v2}" v3="${t.v3}"/>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:BambuStudio="http://schemas.bambulab.com/package/2021" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06" requiredextensions="p">
 <metadata name="BambuStudio:3mfVersion">1</metadata>
 <resources>
  <object id="1" p:UUID="${bambuUuid()}" type="model">
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
</model>`;
}

/** The package root (3D/3dmodel.model): the Bambu marker + a components wrapper
 *  that references the mesh part and places it centered on the plate. */
function buildBambuRootModel(core: MeshExportCore): string {
  const today = new Date().toISOString().slice(0, 10);
  // Center the part's footprint on a generic plate and drop it onto the bed.
  const tx = (128 - core.bbox.cx).toFixed(6);
  const ty = (128 - core.bbox.cy).toFixed(6);
  const tz = (-core.bbox.minZ).toFixed(6);
  return `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:BambuStudio="http://schemas.bambulab.com/package/2021" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06" requiredextensions="p">
 <metadata name="Application">Partwright</metadata>
 <metadata name="BambuStudio:3mfVersion">1</metadata>
 <metadata name="CreationDate">${today}</metadata>
 <metadata name="ModificationDate">${today}</metadata>
 <resources>
  <object id="2" p:UUID="${bambuUuid()}" type="model">
   <components>
    <component p:path="/3D/Objects/object_1.model" objectid="1" p:UUID="${bambuUuid()}" transform="1 0 0 0 1 0 0 0 1 0 0 0"/>
   </components>
  </object>
 </resources>
 <build p:UUID="${bambuUuid()}">
  <item objectid="2" p:UUID="${bambuUuid()}" transform="1 0 0 0 1 0 0 0 1 ${tx} ${ty} ${tz}" printable="1"/>
 </build>
</model>`;
}

/** Object/part wiring Bambu reads alongside the mesh: names the part and pins
 *  its default extruder to 1 (the base color). */
function buildBambuModelSettings(faceCount: number, name: string): string {
  const n = escapeXml(name);
  return `<?xml version="1.0" encoding="UTF-8"?>
<config>
  <object id="2">
    <metadata key="name" value="${n}"/>
    <metadata key="extruder" value="1"/>
    <part id="1" subtype="normal_part">
      <metadata key="name" value="${n}"/>
      <metadata key="matrix" value="1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1"/>
      <mesh_stat face_count="${faceCount}" edges_fixed="0" degenerate_facets="0" facets_removed="0" facets_reversed="0" backwards_edges="0"/>
    </part>
  </object>
  <plate>
    <metadata key="plater_id" value="1"/>
    <metadata key="plater_name" value=""/>
    <metadata key="locked" value="false"/>
    <model_instance>
      <metadata key="object_id" value="2"/>
      <metadata key="instance_id" value="0"/>
    </model_instance>
  </plate>
</config>`;
}

/** The filament declaration: one Generic PLA entry per color slot, in slot
 *  order, every entry typed PLA. Only filament keys are written (no printer or
 *  process settings) so the user's current machine setup is left intact. An
 *  uncolored model still gets a single PLA filament. */
function buildBambuProjectConfig(materialColors: string[]): string {
  const colors = materialColors.length > 0 ? materialColors : [DEFAULT_COLOR_HEX];
  const n = colors.length;
  const config = {
    filament_colour: colors.map(hex => hex.toUpperCase()),
    filament_type: Array.from({ length: n }, () => 'PLA'),
    filament_ids: Array.from({ length: n }, () => BAMBU_GENERIC_PLA_ID),
    filament_settings_id: Array.from({ length: n }, () => BAMBU_GENERIC_PLA_NAME),
    from: 'project',
    version: BAMBU_VERSION,
  };
  return JSON.stringify(config, null, 4);
}

const BAMBU_OBJECT_RELS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
 <Relationship Target="/3D/Objects/object_1.model" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>`;

const BAMBU_SLICE_INFO_XML = `<?xml version="1.0" encoding="UTF-8"?>
<config>
  <header>
    <header_item key="X-BBL-Client-Type" value="slicer"/>
    <header_item key="X-BBL-Client-Version" value="${BAMBU_VERSION}"/>
  </header>
</config>`;

/** Build a Bambu Studio *project* 3MF (no download). Unlike {@link build3MF}'s
 *  portable colorgroup file, this mirrors a real Bambu project package so Bambu
 *  loads the declared all-PLA filaments directly (no nearest-color ABS guess).
 *  Per-triangle color rides in Bambu's `paint_color` bitstream (Orca/Prusa read
 *  it too); for maximum cross-slicer portability use {@link build3MF} instead. */
export function build3MFBambu(meshData: MeshData, customName?: string): BuiltExport {
  assertFiniteMesh(meshData);
  const core = buildMeshCore(meshData);
  const name = getExportTitle();

  const enc = new TextEncoder();
  const zip = buildZip([
    { name: '[Content_Types].xml', data: enc.encode(CONTENT_TYPES_XML) },
    { name: '_rels/.rels', data: enc.encode(RELS_XML) },
    { name: '3D/3dmodel.model', data: enc.encode(buildBambuRootModel(core)) },
    { name: '3D/_rels/3dmodel.model.rels', data: enc.encode(BAMBU_OBJECT_RELS_XML) },
    { name: '3D/Objects/object_1.model', data: enc.encode(buildBambuObjectModel(core)) },
    { name: 'Metadata/model_settings.config', data: enc.encode(buildBambuModelSettings(core.tris.length, name)) },
    { name: 'Metadata/project_settings.config', data: enc.encode(buildBambuProjectConfig(core.materialColors)) },
    { name: 'Metadata/slice_info.config', data: enc.encode(BAMBU_SLICE_INFO_XML) },
  ]);

  const blob = new Blob([zip], { type: MIME_3MF });
  // Suffix the download so it's distinguishable from the standard 3MF.
  const filename = getExportFilename('3mf', customName).replace(/\.3mf$/i, '_bambu.3mf');
  return { blob, filename, mimeType: MIME_3MF };
}

export function export3MFBambu(meshData: MeshData, customName?: string): string {
  const built = build3MFBambu(meshData, customName);
  downloadBlob(built.blob, built.filename, '3MF (Bambu)');
  return built.filename;
}
