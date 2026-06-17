// Multi-part 3MF export — bundles several Session Parts into ONE 3MF. Two modes:
//
//   bambu: false (GENERIC) — multiple `<object>` + `<build><item>` with an
//     `<m:colorgroup>` material list, parts grid-arranged so they don't overlap.
//     No Bambu metadata. Any slicer/viewer (Cura, PrusaSlicer, MS 3D Viewer)
//     opens it and sees every part + colour.
//
//   bambu: true (BAMBU/ORCA PROJECT) — adds the `BambuStudio-` Application
//     marker (project mode), `Metadata/model_settings.config` with one `<plate>`
//     per part + per-object `extruder`, and per-triangle `paint_color`. Each part
//     is positioned on its own build PLATE. Plate membership in Bambu/Orca is
//     decided by WORLD POSITION (bbox overlap with the plate's box), not the
//     `<model_instance>` grouping, so parts are tiled one-per-plate using the
//     slicer's plate stride (bed × 1.2). The file stays a valid generic 3MF too.
//
// We deliberately do NOT emit `Metadata/project_settings.config`: it makes Bambu
// run preset validation and pop the "customized filament or printer presets …
// confirm the G-code is safe" dialog. Colours still import + map to filaments
// from the `<m:colorgroup>` + per-object `extruder` + `paint_color` in the model
// itself. The per-plate `.json`/`.png`/`.gcode` files are post-slice artifacts
// and are omitted. See the PR description for the source-grounded format spec.

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
  /** Emit the Bambu/Orca project layer (Application marker, model_settings.config
   *  with one plate per part, per-object `extruder`, per-triangle `paint_color`),
   *  and tile parts one-per-plate. When false, a GENERIC multi-object 3MF: parts
   *  grid-arranged, `m:colorgroup` colour only, no Bambu metadata. Default true. */
  bambu?: boolean;
  /** Build-plate size `[x, y]` in mm — drives the per-plate world stride in Bambu
   *  mode so each part lands on its plate's centre. Default `[256, 256]`. */
  bedSize?: [number, number];
  /** Gap (mm) between parts in the GENERIC grid layout. Default 10. */
  gridGapMm?: number;
}

// Bambu/Orca tile build plates in one shared world space with a gap of 20% of
// the bed size between plate origins (OrcaSlicer `LOGICAL_PART_PLATE_GAP = 1/5`,
// PartPlate.cpp), so the centre-to-centre stride is `bed × 1.2`. Structural
// constant from the slicer source, not a user-tunable knob.
const PLATE_GAP_FACTOR = 1.2;

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

interface PreparedPart {
  name: string;
  objectId: number;
  vertices: string[];   // <vertex .../> lines
  triangles: string[];  // <triangle .../> lines
  faceCount: number;
  extruder: number;     // 1-based dominant filament for the whole object
  // Bounding-box geometry, used to position the part (placement is a second pass).
  cx: number; cy: number; minZ: number; width: number; depth: number;
  transform: string;    // 12-value row-major item transform (filled in pass 2)
}

/**
 * Build a multi-part 3MF blob. See the module header for the two modes. Colours
 * are shared across all parts via a single `m:colorgroup` so a given colour maps
 * to the same material/filament index on every part.
 */
export function build3MFProject(parts: PartExport[], opts: Build3MFProjectOptions = {}): BuiltExport {
  if (parts.length === 0) throw new Error('Cannot export: no parts selected.');
  const bambu = opts.bambu ?? true;
  const [bedX, bedY] = opts.bedSize ?? [256, 256];
  const gridGap = opts.gridGapMm ?? 10;

  // ── 1. Shared filament list across ALL parts ────────────────────────────
  // The same ordering rule as the single-part exporter: used palette slots in
  // AMS-slot order first, then any remaining colours in first-encounter order.
  // A colour's index in this list is its filament/material index everywhere.
  const cleaned = parts.map(p => {
    assertFiniteMesh(p.mesh);
    const c = cleanMeshForExport(p.mesh);
    assertExportableMesh(c.validTris);
    return c;
  });

  const anyColour = parts.some((p, i) =>
    p.mesh.triColors != null && hasAnyPainted(p.mesh.triColors, cleaned[i].validTris));

  const colorMap = new Map<string, number>(); // hex -> material/filament index (0-based)
  const materialColors: string[] = [];
  const pushMaterial = (hex: string) => {
    if (!colorMap.has(hex)) { colorMap.set(hex, materialColors.length); materialColors.push(hex); }
  };

  if (anyColour) {
    const usedHexes = new Set<string>();
    for (let i = 0; i < parts.length; i++) {
      const tc = parts[i].mesh.triColors;
      if (!tc) continue;
      for (const t of cleaned[i].validTris) usedHexes.add(triColorHex(tc, t));
    }
    for (const slot of listFilaments()) {
      const hex = slot.hex.toLowerCase();
      if (usedHexes.has(hex)) pushMaterial(hex);
    }
    for (let i = 0; i < parts.length; i++) {
      const tc = parts[i].mesh.triColors;
      if (!tc) continue;
      for (const t of cleaned[i].validTris) pushMaterial(triColorHex(tc, t));
    }
  }

  const colorGroupId = parts.length + 1; // distinct from object ids 1..N

  // ── 2. Per-part geometry + colour (placement is pass 3) ─────────────────
  const prepared: PreparedPart[] = parts.map((part, i) => {
    const { mesh } = part;
    const { remap, uniquePositions, validTris } = cleaned[i];
    const tc = anyColour ? mesh.triColors ?? null : null;

    // Vertices + bounding box.
    const numUniqueVerts = uniquePositions.length / 3;
    let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity;
    const vertices: string[] = [];
    for (let v = 0; v < numUniqueVerts; v++) {
      const x = uniquePositions[v * 3], y = uniquePositions[v * 3 + 1], z = uniquePositions[v * 3 + 2];
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (z < minZ) minZ = z;
      vertices.push(`          <vertex x="${x.toFixed(6)}" y="${y.toFixed(6)}" z="${z.toFixed(6)}" />`);
    }

    // Dominant colour → object-level extruder (the part's "base" filament).
    let extruder = 1;
    if (tc) {
      const counts = new Map<number, number>();
      for (const t of validTris) {
        const idx = colorMap.get(triColorHex(tc, t)) ?? 0;
        counts.set(idx, (counts.get(idx) ?? 0) + 1);
      }
      let bestIdx = 0, bestN = -1;
      for (const [idx, n] of counts) if (n > bestN) { bestN = n; bestIdx = idx; }
      extruder = bestIdx + 1;
    }

    // Triangles. Generic colour via pid/p1 (face colour) in both modes; Bambu
    // colour additionally via paint_color (omitted where the triangle matches the
    // object's extruder, and omitted entirely in generic mode).
    const triangles: string[] = [];
    for (const t of validTris) {
      const v1 = remap[mesh.triVerts[t * 3]];
      const v2 = remap[mesh.triVerts[t * 3 + 1]];
      const v3 = remap[mesh.triVerts[t * 3 + 2]];
      if (tc) {
        const matIdx = colorMap.get(triColorHex(tc, t)) ?? 0;
        const filament = matIdx + 1;
        const paint = bambu && filament !== extruder ? ` paint_color="${encodePaintColorState(filament)}"` : '';
        triangles.push(`          <triangle v1="${v1}" v2="${v2}" v3="${v3}" pid="${colorGroupId}" p1="${matIdx}" p2="${matIdx}" p3="${matIdx}"${paint} />`);
      } else {
        triangles.push(`          <triangle v1="${v1}" v2="${v2}" v3="${v3}" />`);
      }
    }

    const cx = Number.isFinite(minX) ? (minX + maxX) / 2 : 0;
    const cy = Number.isFinite(minY) ? (minY + maxY) / 2 : 0;
    const width = Number.isFinite(minX) ? maxX - minX : 0;
    const depth = Number.isFinite(minY) ? maxY - minY : 0;
    const z0 = Number.isFinite(minZ) ? minZ : 0;
    return { name: part.name, objectId: i + 1, vertices, triangles, faceCount: validTris.length, extruder, cx, cy, minZ: z0, width, depth, transform: '' };
  });

  // ── 3. Placement ────────────────────────────────────────────────────────
  // Bambu: tile one part per plate along +X using the slicer's plate stride so
  //   each part's bbox falls in (and is centred on) its own plate's box.
  // Generic: lay parts out in a centred square grid spaced by the largest
  //   footprint + gap, so they never overlap.
  const N = prepared.length;
  if (bambu) {
    prepared.forEach((p, i) => {
      const plateCenterX = i * (bedX * PLATE_GAP_FACTOR) + bedX / 2;
      const plateCenterY = bedY / 2;
      p.transform = `1 0 0 0 1 0 0 0 1 ${(plateCenterX - p.cx).toFixed(6)} ${(plateCenterY - p.cy).toFixed(6)} ${(-p.minZ).toFixed(6)}`;
    });
  } else {
    const cols = Math.ceil(Math.sqrt(N));
    const rows = Math.ceil(N / cols);
    const pitch = Math.max(1, ...prepared.map(p => Math.max(p.width, p.depth))) + gridGap;
    prepared.forEach((p, i) => {
      const col = i % cols, row = Math.floor(i / cols);
      const cellX = col * pitch - (cols - 1) * pitch / 2;
      const cellY = row * pitch - (rows - 1) * pitch / 2;
      p.transform = `1 0 0 0 1 0 0 0 1 ${(cellX - p.cx).toFixed(6)} ${(cellY - p.cy).toFixed(6)} ${(-p.minZ).toFixed(6)}`;
    });
  }

  // ── 4. 3D/3dmodel.model ─────────────────────────────────────────────────
  const matNs = anyColour ? ' xmlns:m="http://schemas.microsoft.com/3dmanufacturing/material/2015/02"' : '';
  const bambuNs = bambu ? ' xmlns:BambuStudio="http://schemas.bambulab.com/package/2021"' : '';
  const colorgroupXml = anyColour
    ? `\n    <m:colorgroup id="${colorGroupId}">\n${materialColors.map(h => `      <m:color color="${h.toUpperCase()}FF" />`).join('\n')}\n    </m:colorgroup>`
    : '';

  const objectsXml = prepared.map(p => `    <object id="${p.objectId}" type="model">
      <mesh>
        <vertices>
${p.vertices.join('\n')}
        </vertices>
        <triangles>
${p.triangles.join('\n')}
        </triangles>
      </mesh>
    </object>`).join('\n');

  const buildItemsXml = prepared.map(p =>
    `    <item objectid="${p.objectId}" transform="${p.transform}" printable="1" />`).join('\n');

  const today = new Date().toISOString().slice(0, 10);
  const title = escapeXml(getExportTitle());
  // The `BambuStudio-` Application prefix is what flips Bambu/Orca into project
  // mode (plates + filament binding). Generic mode names Partwright instead.
  const appMeta = bambu
    ? '  <metadata name="Application">BambuStudio-02.00.00.00</metadata>\n  <metadata name="BambuStudio:3mfVersion">1</metadata>\n'
    : '  <metadata name="Application">Partwright (https://www.partwrightstudio.com)</metadata>\n';

  const modelXml = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="${get3MFUnitString()}" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"${matNs}${bambuNs}>
${appMeta}  <metadata name="Title">${title}</metadata>
  <metadata name="Designer">Partwright</metadata>
  <metadata name="CreationDate">${today}</metadata>
  <metadata name="ModificationDate">${today}</metadata>
  <metadata name="LicenseTerms">Created with Partwright — https://www.partwrightstudio.com</metadata>
  <resources>${colorgroupXml}
${objectsXml}
  </resources>
  <build>
${buildItemsXml}
  </build>
</model>`;

  // ── 5. Package ──────────────────────────────────────────────────────────
  const files: { name: string; data: Uint8Array }[] = [];
  const enc = new TextEncoder();

  const configType = bambu
    ? '\n  <Default Extension="config" ContentType="application/vnd.bambulab-package.settings+xml" />'
    : '';
  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml" />
  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml" />${configType}
</Types>`;

  const relsXml = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel" />
</Relationships>`;

  files.push({ name: '[Content_Types].xml', data: enc.encode(contentTypesXml) });
  files.push({ name: '_rels/.rels', data: enc.encode(relsXml) });
  files.push({ name: '3D/3dmodel.model', data: enc.encode(modelXml) });

  if (bambu) {
    // Metadata/model_settings.config — objects + per-part plates. This is what
    // creates the plate slots; placement (pass 3) is what actually distributes
    // the objects across them.
    const configObjects = prepared.map(p => {
      const safeName = escapeXml(p.name);
      return `  <object id="${p.objectId}">
    <metadata key="name" value="${safeName}"/>
    <metadata key="extruder" value="${p.extruder}"/>
    <part id="${p.objectId}" subtype="normal_part">
      <metadata key="name" value="${safeName}"/>
      <metadata key="matrix" value="1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1"/>
      <mesh_stat face_count="${p.faceCount}" edges_fixed="0" degenerate_facets="0" facets_removed="0" facets_reversed="0" backwards_edges="0"/>
    </part>
  </object>`;
    }).join('\n');

    const configPlates = prepared.map((p, i) => `  <plate>
    <metadata key="plater_id" value="${i + 1}"/>
    <metadata key="plater_name" value="${escapeXml(p.name)}"/>
    <metadata key="locked" value="false"/>
    <model_instance>
      <metadata key="object_id" value="${p.objectId}"/>
      <metadata key="instance_id" value="0"/>
    </model_instance>
  </plate>`).join('\n');

    const modelSettingsXml = `<?xml version="1.0" encoding="UTF-8"?>
<config>
${configObjects}
${configPlates}
</config>`;
    files.push({ name: 'Metadata/model_settings.config', data: enc.encode(modelSettingsXml) });

    // Metadata/project_settings.config — REQUIRED for Bambu to build the plate
    // list. On import the Plater sets `load_config = false` (→ a single plate via
    // reload_all_objects, NOT load_from_3mf_structure) whenever the project config
    // loads ZERO recognized DynamicPrintConfig keys. So an absent/empty config
    // collapses our N plates to one. We emit the MINIMAL config that flips
    // load_config true WITHOUT tripping the "customized presets / confirm G-code"
    // warning: `filament_diameter` is a recognized key (so the config isn't empty)
    // AND is dereferenced without a default in PresetBundle::validate_presets (so
    // omitting it would crash), while carrying NO `*_settings_id` / `inherits_group`
    // means validate_presets finds nothing to validate → no warning. Colours still
    // come from the model's m:colorgroup + extruder + paint_color, not from here.
    const filamentCount = Math.max(1, materialColors.length);
    const projectSettings = { filament_diameter: Array(filamentCount).fill('1.75') };
    files.push({ name: 'Metadata/project_settings.config', data: enc.encode(JSON.stringify(projectSettings, null, 4)) });
  }

  const zip = buildZip(files);
  const mimeType = 'application/vnd.ms-package.3dmanufacturing';
  const blob = new Blob([zip], { type: mimeType });
  return { blob, filename: getExportFilename('3mf', opts.customName), mimeType };
}
