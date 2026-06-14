// Multi-part 3MF "project" export — bundles several Session Parts into ONE 3MF,
// each part on its own build PLATE, with colours pre-bound to filaments.
//
// The file is BOTH:
//   1. A valid GENERIC 3MF — multiple `<object>` + `<build><item>` with an
//      `<m:colorgroup>` material list, so any slicer/viewer (Cura, PrusaSlicer,
//      Microsoft 3D Viewer) opens it and sees every part + colour.
//   2. A Bambu Studio / OrcaSlicer PROJECT — the `Application` metadata marker
//      flips Bambu into project mode, `Metadata/model_settings.config` assigns
//      one part per plate (and per-object `extruder`), per-triangle `paint_color`
//      carries the painted multi-colour, and `Metadata/project_settings.config`
//      pre-populates the filament list so colours land on AMS slots.
//
// Plate recognition needs only the `<plate>` blocks in model_settings.config +
// the `BambuStudio-` Application marker; the per-plate gcode/json/png files are
// post-slice artifacts and are intentionally omitted. See the PR description for
// the source-grounded format spec.

import type { MeshData } from '../geometry/types';
import { get3MFUnitString } from '../geometry/units';
import { getExportFilename, getExportTitle } from './download';
import type { BuiltExport } from './gltf';
import { buildZip } from './zip';
import { assertFiniteMesh, assertExportableMesh, cleanMeshForExport, triColorHex, hasAnyPainted } from './meshClean';
import { listFilaments } from '../color/palette';
import { encodePaintColorState } from './paintColor3mf';
import { getConfig } from '../config/appConfig';

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
  /** Where each part is centred on its plate (mm). Defaults to the configured
   *  nominal bed centre. Each part sits on z=0; Bambu auto-drops to the bed. */
  platePositionMm?: number;
}

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
  transform: string;    // 12-value row-major item transform
}

/**
 * Build a multi-part Bambu/generic 3MF blob. Each part becomes one object on its
 * own plate. Colours are shared across all parts via a single filament list so a
 * given colour maps to the same AMS slot on every plate.
 */
export function build3MFProject(parts: PartExport[], opts: Build3MFProjectOptions = {}): BuiltExport {
  if (parts.length === 0) throw new Error('Cannot export: no parts selected.');
  const platePos = opts.platePositionMm ?? getConfig().export.platePositionMm;

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

  // ── 2. Per-part geometry + colour ───────────────────────────────────────
  const prepared: PreparedPart[] = parts.map((part, i) => {
    const { mesh } = part;
    const { remap, uniquePositions, validTris } = cleaned[i];
    const tc = anyColour ? mesh.triColors ?? null : null;

    // Vertices + bounding box (for plate centring).
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

    // Triangles. Generic colour via pid/p1 (face colour); Bambu colour via
    // paint_color, omitted where the triangle matches the object's extruder.
    const triangles: string[] = [];
    for (const t of validTris) {
      const v1 = remap[mesh.triVerts[t * 3]];
      const v2 = remap[mesh.triVerts[t * 3 + 1]];
      const v3 = remap[mesh.triVerts[t * 3 + 2]];
      if (tc) {
        const matIdx = colorMap.get(triColorHex(tc, t)) ?? 0;
        const filament = matIdx + 1;
        const paint = filament === extruder ? '' : ` paint_color="${encodePaintColorState(filament)}"`;
        triangles.push(`          <triangle v1="${v1}" v2="${v2}" v3="${v3}" pid="${colorGroupId}" p1="${matIdx}" p2="${matIdx}" p3="${matIdx}"${paint} />`);
      } else {
        triangles.push(`          <triangle v1="${v1}" v2="${v2}" v3="${v3}" />`);
      }
    }

    // Centre the part on its plate, resting on z=0.
    const cx = Number.isFinite(minX) ? (minX + maxX) / 2 : 0;
    const cy = Number.isFinite(minY) ? (minY + maxY) / 2 : 0;
    const tx = platePos - cx, ty = platePos - cy, tz = Number.isFinite(minZ) ? -minZ : 0;
    const transform = `1 0 0 0 1 0 0 0 1 ${tx.toFixed(6)} ${ty.toFixed(6)} ${tz.toFixed(6)}`;

    return { name: part.name, objectId: i + 1, vertices, triangles, faceCount: validTris.length, extruder, transform };
  });

  // ── 3. 3D/3dmodel.model ─────────────────────────────────────────────────
  const matNs = anyColour ? ' xmlns:m="http://schemas.microsoft.com/3dmanufacturing/material/2015/02"' : '';
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

  const modelXml = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="${get3MFUnitString()}" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"${matNs} xmlns:BambuStudio="http://schemas.bambulab.com/package/2021">
  <metadata name="Application">BambuStudio-02.00.00.00</metadata>
  <metadata name="BambuStudio:3mfVersion">1</metadata>
  <metadata name="Title">${title}</metadata>
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

  // ── 4. Metadata/model_settings.config (objects + per-part plates) ────────
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

  // ── 5. Metadata/project_settings.config (filament colours) ───────────────
  const files: { name: string; data: Uint8Array }[] = [];
  const enc = new TextEncoder();

  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml" />
  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml" />
  <Default Extension="config" ContentType="application/vnd.bambulab-package.settings+xml" />
  <Default Extension="json" ContentType="application/json" />
</Types>`;

  const relsXml = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel" />
</Relationships>`;

  files.push({ name: '[Content_Types].xml', data: enc.encode(contentTypesXml) });
  files.push({ name: '_rels/.rels', data: enc.encode(relsXml) });
  files.push({ name: '3D/3dmodel.model', data: enc.encode(modelXml) });
  files.push({ name: 'Metadata/model_settings.config', data: enc.encode(modelSettingsXml) });

  if (anyColour && materialColors.length > 0) {
    const upper = materialColors.map(h => h.toUpperCase());
    const projectSettings = {
      filament_colour: upper,
      filament_type: upper.map(() => 'PLA'),
      filament_settings_id: upper.map(() => 'Generic PLA'),
      filament_ids: upper.map(() => ''),
      version: '1',
      from: 'Partwright',
    };
    files.push({ name: 'Metadata/project_settings.config', data: enc.encode(JSON.stringify(projectSettings, null, 4)) });
  }

  const zip = buildZip(files);
  const mimeType = 'application/vnd.ms-package.3dmanufacturing';
  const blob = new Blob([zip], { type: mimeType });
  return { blob, filename: getExportFilename('3mf', opts.customName), mimeType };
}
