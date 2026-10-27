// Mesh fixtures for import specs: binary STL boxes and a Bambu-style 3MF
// project, built in memory (no files on disk).

import { buildZip } from '../../src/export/zip';

const enc = (s: string) => new TextEncoder().encode(s);

const RELS = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
 <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>`;

/** Corners of an axis-aligned box ([min, max]) as outward-wound triangles. */
function boxTris(a: number[], b: number[]): number[][][] {
  const v = (i: number) => [i & 1 ? b[0] : a[0], i & 2 ? b[1] : a[1], i & 4 ? b[2] : a[2]];
  const quads = [[0, 2, 3, 1], [4, 5, 7, 6], [0, 1, 5, 4], [2, 6, 7, 3], [0, 4, 6, 2], [1, 3, 7, 5]];
  return quads.flatMap(([p, q, r, s]) => [[v(p), v(q), v(r)], [v(p), v(r), v(s)]]);
}

function boxMeshXml(a: number[], b: number[]): string {
  const tris = boxTris(a, b);
  const verts: string[] = [];
  const index = new Map<string, number>();
  const faces = tris.map(t => t.map(p => {
    const k = p.join(',');
    if (!index.has(k)) { index.set(k, verts.length); verts.push(`<vertex x="${p[0]}" y="${p[1]}" z="${p[2]}"/>`); }
    return index.get(k)!;
  }));
  return `<mesh><vertices>${verts.join('')}</vertices><triangles>${faces.map(f => `<triangle v1="${f[0]}" v2="${f[1]}" v3="${f[2]}"/>`).join('')}</triangles></mesh>`;
}

/** Three objects on two plates: "Base" + "Peg" on plate 1, "Lid" on plate 2 ("Lids"). */
export function twoPlateProject(): Buffer {
  const root = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
  <metadata name="Application">BambuStudio-02.00.01.50</metadata>
  <metadata name="Title">Peg Kit</metadata>
  <resources>
    <object id="1" type="model">${boxMeshXml([0, 0, 0], [30, 30, 10])}</object>
    <object id="2" type="model">${boxMeshXml([0, 0, 0], [8, 8, 20])}</object>
    <object id="3" type="model">${boxMeshXml([0, 0, 0], [24, 24, 4])}</object>
  </resources>
  <build>
    <item objectid="1" transform="1 0 0 0 1 0 0 0 1 100 110 0"/>
    <item objectid="2" transform="1 0 0 0 1 0 0 0 1 150 120 0"/>
    <item objectid="3" transform="1 0 0 0 1 0 0 0 1 420 110 0"/>
  </build>
</model>`;
  const instance = (id: number) => `<model_instance><metadata key="object_id" value="${id}"/><metadata key="instance_id" value="0"/></model_instance>`;
  const settings = `<?xml version="1.0" encoding="UTF-8"?>
<config>
  <object id="1"><metadata key="name" value="Base"/><metadata key="extruder" value="1"/></object>
  <object id="2"><metadata key="name" value="Peg"/><metadata key="extruder" value="2"/></object>
  <object id="3"><metadata key="name" value="Lid"/><metadata key="extruder" value="3"/></object>
  <plate><metadata key="plater_id" value="1"/><metadata key="plater_name" value=""/>${instance(1)}${instance(2)}</plate>
  <plate><metadata key="plater_id" value="2"/><metadata key="plater_name" value="Lids"/>${instance(3)}</plate>
</config>`;
  const project = JSON.stringify({ filament_colour: ['#E8E8E8', '#C02525', '#2452C0'], filament_type: ['PLA', 'PLA', 'PLA'] });
  return Buffer.from(buildZip([
    { name: '_rels/.rels', data: enc(RELS) },
    { name: '3D/3dmodel.model', data: enc(root) },
    { name: 'Metadata/model_settings.config', data: enc(settings) },
    { name: 'Metadata/project_settings.config', data: enc(project) },
  ]));
}

export function boxesStl(boxes: [number[], number[]][]): Buffer {
  const tris = boxes.flatMap(([a, b]) => boxTris(a, b));
  const buf = Buffer.alloc(84 + tris.length * 50);
  buf.writeUInt32LE(tris.length, 80);
  tris.forEach((t, i) => {
    const o = 84 + i * 50;
    t.forEach((p, k) => p.forEach((c, j) => buf.writeFloatLE(c, o + 12 + k * 12 + j * 4)));
  });
  return buf;
}

